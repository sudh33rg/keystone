/**
 * Phase 7 QA remediation lifecycle tests (spec §52).
 *
 * Covers: scenario derivation, pattern discovery, location recommendation, generation plan,
 * deterministic failure classification, flaky intelligence, healing-policy safety invariants,
 * remediation proposal scope/policy screening, attempt limits, regression confirmation, and
 * restoration-after-restart (persistence). Implementations are deterministic and LLM-free.
 */
import { describe, expect, it } from "vitest";
import { TestScenarioDerivationService } from "../../../../src/core/intelligence/qa/TestScenarioDerivationService";
import {
  TestPatternDiscoveryService,
  TestLocationRecommendationService,
  type CandidateTest,
} from "../../../../src/core/intelligence/qa/TestPatternDiscoveryService";
import {
  TestGenerationPlanService,
  GeneratedTestProposalService,
} from "../../../../src/core/intelligence/qa/TestGenerationServices";
import {
  DeterministicFailureClassifier,
  FlakyTestIntelligenceService,
} from "../../../../src/core/intelligence/qa/FailureAnalysisServices";
import { TestHealingPolicyService } from "../../../../src/core/intelligence/qa/TestHealingPolicyService";
import { RemediationProposalService } from "../../../../src/core/intelligence/qa/RemediationServices";
import {
  AttemptLimitService,
  DiagnosticRerunService,
  RegressionConfirmationService,
} from "../../../../src/core/intelligence/qa/RemediationApplicationServices";
import { InMemoryQaStore } from "../../../../src/core/intelligence/qa/QaStore";
import {
  TestGenerationRequestSchema,
  DerivedScenarioSchema,
  ProposedChangeSchema,
  RemediationProposalSchema,
  type TestGenerationRequest,
  type TestPatternDiscoveryResult,
  type TestLocationRecommendation,
  type CoverageGap,
  type ParsedTestResult,
} from "../../../../src/shared/contracts/qaRemediation";
import {
  CoverageGapSchema,
  type ImpactAnalysis,
} from "../../../../src/shared/contracts/qaLifecycle";

function makeRequest(over: Partial<TestGenerationRequest> = {}): TestGenerationRequest {
  const now = new Date().toISOString();
  const base = {
    id: "req:1",
    qaCycleId: "cycle:1",
    trigger: { type: "coverage-gap" as const, sourceId: "gap:1", description: "uncovered branch" },
    targets: {
      productionEntityIds: ["svc"],
      flowIds: ["flow:1"],
      acceptanceCriterionIds: ["ac:1"],
      existingTestIds: [],
    },
    recommendation: { testLayer: "unit" as const, priority: "high" as const },
    status: "proposed" as const,
    metadata: { createdAt: now, updatedAt: now, contentHash: "h" },
  };
  return TestGenerationRequestSchema.parse({ ...base, ...over });
}

function makeGap(over: Partial<CoverageGap> = {}): CoverageGap {
  const now = new Date().toISOString();
  const base = {
    id: "gap:1",
    gapType: "changed-symbol-no-test" as const,
    proposedScenarioSummary: "validate input",
    risk: "medium" as const,
    recommendedTestLayer: "unit" as const,
    testGenerationRecommended: false,
    verificationStatus: "unmapped" as const,
    evidence: [{ id: "e1", kind: "symbol", statement: "changed" }],
    createdAt: now,
  };
  return CoverageGapSchema.parse({ ...base, ...over });
}

function makeResult(over: Partial<ParsedTestResult> = {}): ParsedTestResult {
  const base = {
    testFile: "a.test.ts",
    testCase: "passes normally",
    status: "passed" as const,
  };
  return { ...base, ...over } as ParsedTestResult;
}

describe("DeterministicFailureClassifier", () => {
  const base = {
    result: makeResult({ status: "failed", errorMessage: "boom" }),
    previouslyPassed: false,
    failureReproducesConsistently: false,
    failureIntersectsChangedCode: false,
    specificationChanged: false,
    contractChanged: false,
    rerunPassedWithoutChange: false,
    timingSensitive: false,
    orderDependent: false,
    sharedMutableState: false,
    serviceUnavailable: false,
    portConflict: false,
    missingRuntime: false,
    dependencyInstallFailed: false,
    testRunnerCrash: false,
    resourceExhaustion: false,
    environmentConfigFailure: false,
    fixtureMissing: false,
    mockContractMismatch: false,
  };

  it("classifies a product defect when failure intersects changed code, previously passed, reproduces", () => {
    const c = new DeterministicFailureClassifier();
    const r = c.classify({
      ...base,
      previouslyPassed: true,
      failureReproducesConsistently: true,
      failureIntersectsChangedCode: true,
      relatedSpecRevision: "rev:2",
    });
    expect(r.primary).toBe("product-defect");
    expect(r.confidence).toBeGreaterThan(0.5);
    expect(r.automaticRemediationAllowed).toBe(false);
    expect(r.recommendedNextAction).toContain("production");
  });

  it("classifies stale test when specification changed with revision evidence", () => {
    const c = new DeterministicFailureClassifier();
    const r = c.classify({ ...base, specificationChanged: true, relatedSpecRevision: "rev:3" });
    expect(r.primary).toBe("stale-test");
    expect(r.competingHypotheses.some((h) => h.category === "incorrect-expectation")).toBe(true);
  });

  it("classifies flaky behaviour on rerun-pass-without-change", () => {
    const c = new DeterministicFailureClassifier();
    const r = c.classify({ ...base, rerunPassedWithoutChange: true });
    expect(r.primary).toBe("flaky-behaviour");
  });

  it("classifies environment issue over product defect when service unavailable", () => {
    const c = new DeterministicFailureClassifier();
    const r = c.classify({
      ...base,
      serviceUnavailable: true,
      failureIntersectsChangedCode: true,
      previouslyPassed: true,
      failureReproducesConsistently: true,
    });
    expect(r.primary).toBe("environment-issue");
  });

  it("returns unknown with missing evidence instead of forcing a confident call", () => {
    const c = new DeterministicFailureClassifier();
    const r = c.classify({ ...base });
    expect(r.primary).toBe("unknown");
    expect(r.confidence).toBeLessThan(0.5);
    expect(r.missingEvidence.length).toBeGreaterThan(0);
  });
});

describe("FlakyTestIntelligenceService", () => {
  it("does not label flaky from a single failed-then-passed run", () => {
    const svc = new FlakyTestIntelligenceService();
    const a = svc.assess("t1", [
      makeResult({ status: "failed" }),
      makeResult({ status: "passed" }),
    ]);
    expect(a.classification).toBe("not-enough-evidence");
  });

  it("confirms flaky on alternating pass/fail across enough runs", () => {
    const svc = new FlakyTestIntelligenceService();
    const a = svc.assess("t2", [
      makeResult({ status: "passed" }),
      makeResult({ status: "failed", errorMessage: "E1" }),
      makeResult({ status: "passed" }),
      makeResult({ status: "failed", errorMessage: "E2" }),
      makeResult({ status: "passed" }),
    ]);
    expect(a.classification).toBe("confirmed");
    expect(a.evidence.totalRuns).toBe(5);
    expect(a.evidence.failureSignatureCount).toBe(2);
  });

  it("treats consistent failure signature as likely deterministic, not flaky", () => {
    const svc = new FlakyTestIntelligenceService();
    const a = svc.assess("t3", [
      makeResult({ status: "failed", errorMessage: "same" }),
      makeResult({ status: "failed", errorMessage: "same" }),
      makeResult({ status: "failed", errorMessage: "same" }),
    ]);
    expect(a.classification).toBe("unlikely");
  });
});

describe("TestGenerationPlanService + GeneratedTestProposalService", () => {
  it("builds a bounded plan with explicit scope, examples, and review gates", () => {
    const planSvc = new TestGenerationPlanService();
    const patterns: TestPatternDiscoveryResult = {
      examples: [
        {
          testId: "ref1",
          filePath: "src/core/order/order.test.ts",
          testLayer: "unit",
          rank: 0.9,
          reasons: ["same module"],
        },
      ],
      metadata: { createdAt: new Date().toISOString(), contentHash: "x" },
    };
    const location: TestLocationRecommendation = {
      proposedFile: "src/core/order/order.test.ts",
      createOrModify: "modify",
      testLayer: "unit",
      confidence: 0.8,
      reasoning: "adjacent module",
      alternativeLocations: [],
    };
    const plan = planSvc.build({
      request: makeRequest(),
      approvedScenarios: [],
      patterns,
      location,
      requiredValidationCommands: ["npm test -- order"],
    });
    expect(plan.permittedFiles).toContain("src/core/order/order.test.ts");
    expect(plan.reviewGates).toContain("manual-approval");
    expect(plan.selectedExecutionProfileId).toBe("test-generation-profile");
  });

  it("rejects a proposal that modifies unrelated production code", () => {
    const svc = new GeneratedTestProposalService();
    const p = svc.screen({
      id: "prop:gen:1",
      requestId: "req:1",
      planId: "plan:1",
      summary: "add test",
      scenariosImplemented: [],
      filesToCreate: ["src/core/order/order.test.ts"],
      filesToModify: [],
      productionFilesTouched: ["src/core/unrelated/OtherService.ts"],
      testFilesTouched: ["src/core/order/order.test.ts"],
      fixturesOrMocksAdded: [],
      assumptions: [],
      unresolvedQuestions: [],
      recommendedExecutionCommands: [],
      requirementMapping: [],
      metadata: {
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        contentHash: "h",
      },
    });
    expect(p.status).toBe("rejected");
    expect(p.violations.some((v) => v.includes("unrelated production"))).toBe(true);
  });

  it("marks a proposal failed (not validated) unless generated and related tests pass and gap resolved", () => {
    const svc = new GeneratedTestProposalService();
    const proposal = svc.screen({
      id: "prop:gen:2",
      requestId: "req:1",
      planId: "plan:1",
      summary: "x",
      scenariosImplemented: [],
      filesToCreate: ["a.test.ts"],
      filesToModify: [],
      productionFilesTouched: [],
      testFilesTouched: ["a.test.ts"],
      fixturesOrMocksAdded: [],
      assumptions: [],
      unresolvedQuestions: [],
      recommendedExecutionCommands: [],
      requirementMapping: [],
      metadata: {
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        contentHash: "h",
      },
    });
    expect(
      svc.validate(proposal, {
        generatedTestsPassed: true,
        relatedTestsPassed: true,
        gapResolved: true,
        blockingRegression: false,
      }),
    ).toBe("validated");
    expect(
      svc.validate(proposal, {
        generatedTestsPassed: false,
        relatedTestsPassed: true,
        gapResolved: true,
        blockingRegression: false,
      }),
    ).toBe("failed");
  });
});

// __APPEND3__

describe("TestHealingPolicyService (safety invariants)", () => {
  const change = (o: Partial<ReturnType<typeof ProposedChangeSchema.parse>>) =>
    ProposedChangeSchema.parse({
      filePath: "svc.test.ts",
      changeType: "modify",
      description: "update",
      ...o,
    });

  it("blocks automatic deletion of a test", () => {
    const p = new TestHealingPolicyService();
    const v = p.screenChange(change({ changeType: "delete" }), {});
    expect(v.some((x) => x.rule === "never-delete-test" && x.severity === "blocking")).toBe(true);
  });

  it("blocks assertion weakening", () => {
    const p = new TestHealingPolicyService();
    const v = p.screenChange(change({ assertionChange: true }), {});
    expect(v.some((x) => x.rule === "never-weaken-assertion")).toBe(true);
  });

  it("blocks disabling/skipping a test", () => {
    const p = new TestHealingPolicyService();
    const v = p.screenChange(change({ description: "add .skip to flaky" }), {});
    expect(v.some((x) => x.rule === "never-disable-test")).toBe(true);
  });

  it("blocks silent snapshot update without a diff", () => {
    const p = new TestHealingPolicyService();
    const v = p.screenChange(change({ snapshotChange: true }), {});
    expect(v.some((x) => x.rule === "never-silent-snapshot")).toBe(true);
  });

  it("blocks unsupported timeout increase (policy off, no evidence)", () => {
    const p = new TestHealingPolicyService();
    const v = p.screenChange(change({ timeoutChange: true }), {});
    expect(v.some((x) => x.rule === "timeout-policy" || x.rule === "timeout-evidence")).toBe(true);
  });

  it("allows a bounded timeout increase only with timing evidence and policy on", () => {
    const p = new TestHealingPolicyService({
      requireManualApprovalForAll: false,
      maxTimeoutIncreaseMs: 5000,
      allowLocalTimeoutChanges: true,
    });
    const v = p.screenChange(change({ timeoutChange: true }), { timeoutEvidenceMs: 1000 });
    expect(v.every((x) => x.rule !== "timeout-policy" && x.rule !== "timeout-evidence")).toBe(true);
  });

  it("requires approval for high-risk proposals", () => {
    const p = new TestHealingPolicyService();
    const proposal = RemediationProposalSchema.parse({
      id: "rp:1",
      failureAnalysisId: "fa:1",
      qaCycleId: "c:1",
      type: "production-fix",
      rationale: "x",
      scope: { allowedFiles: ["svc.ts"], prohibitedFiles: [], targetEntityIds: [] },
      changes: [change({ filePath: "svc.ts", productionCodeChange: true })],
      validation: { targetedTests: [], relatedTests: [], regressionScope: [] },
      risk: { level: "high", warnings: [] },
      policy: { violations: [], approvalRequired: false },
      status: "ready",
      metadata: {
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        contentHash: "h",
      },
    });
    const res = p.screenProposal(proposal, {});
    expect(res.approvalRequired).toBe(true);
  });

  it("blocks out-of-scope file modification", () => {
    const p = new TestHealingPolicyService();
    const proposal = RemediationProposalSchema.parse({
      id: "rp:2",
      failureAnalysisId: "fa:1",
      qaCycleId: "c:1",
      type: "test-fix",
      rationale: "x",
      scope: { allowedFiles: ["svc.test.ts"], prohibitedFiles: [], targetEntityIds: [] },
      changes: [change({ filePath: "unrelated.test.ts" })],
      validation: { targetedTests: [], relatedTests: [], regressionScope: [] },
      risk: { level: "low", warnings: [] },
      policy: { violations: [], approvalRequired: false },
      status: "ready",
      metadata: {
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        contentHash: "h",
      },
    });
    const res = p.screenProposal(proposal, {});
    expect(
      res.violations.some((v) => v.rule === "scope-violation" && v.severity === "blocking"),
    ).toBe(true);
  });
});

describe("RemediationProposalService", () => {
  it("marks a proposal blocked when a change violates the healing policy", () => {
    const svc = new RemediationProposalService();
    const prop = svc.build({
      failureAnalysisId: "fa:1",
      qaCycleId: "c:1",
      type: "test-fix",
      rationale: "weaken assertion to pass",
      classification: "incorrect-expectation",
      scope: { allowedFiles: ["svc.test.ts"], prohibitedFiles: [], targetEntityIds: [] },
      changes: [
        ProposedChangeSchema.parse({
          filePath: "svc.test.ts",
          changeType: "modify",
          description: "weaken",
          assertionChange: true,
        }),
      ],
      validation: { targetedTests: ["svc.test.ts"], relatedTests: [], regressionScope: [] },
      riskLevel: "medium",
      policyCtx: {},
    });
    expect(prop.status).toBe("blocked");
    expect(prop.policy.violations.some((v) => v.rule === "never-weaken-assertion")).toBe(true);
  });

  it("keeps a legitimate fixture fix ready and out of policy violation", () => {
    const svc = new RemediationProposalService();
    const prop = svc.build({
      failureAnalysisId: "fa:2",
      qaCycleId: "c:1",
      type: "fixture-fix",
      rationale: "missing fixture",
      classification: "fixture-problem",
      scope: { allowedFiles: ["fixtures/order.json"], prohibitedFiles: [], targetEntityIds: [] },
      changes: [
        ProposedChangeSchema.parse({
          filePath: "fixtures/order.json",
          changeType: "create",
          description: "add fixture",
          fixtureChange: true,
        }),
      ],
      validation: { targetedTests: ["svc.test.ts"], relatedTests: [], regressionScope: [] },
      riskLevel: "low",
      policyCtx: {},
    });
    expect(prop.status).toBe("ready");
    expect(prop.policy.violations.length).toBe(0);
  });
});

describe("AttemptLimitService", () => {
  it("exhausts after the configured maximum remediation applications", () => {
    const svc = new AttemptLimitService();
    let s = svc.init();
    s = svc.recordApplication(s);
    expect(s.exhausted).toBe(false);
    s = svc.recordApplication(s);
    expect(s.exhausted).toBe(true);
    expect(s.reason).toContain("limit");
  });

  it("exhausts after the configured maximum diagnostic reruns", () => {
    const svc = new AttemptLimitService();
    let s = svc.init();
    s = svc.recordRerun(s);
    s = svc.recordRerun(s);
    s = svc.recordRerun(s);
    expect(s.exhausted).toBe(true);
  });
});

describe("DiagnosticRerunService", () => {
  it("records code revision, environment, seed, order, and failure signature", () => {
    const svc = new DiagnosticRerunService();
    const r = svc.record({
      testId: "t1",
      mode: "isolated",
      codeRevision: "abc",
      environmentFingerprint: "env:1",
      seed: "42",
      order: "shuffle",
      command: "vitest t1",
      result: "failed",
      durationMs: 120,
      failureSignature: "E: timeout",
    });
    expect(r.codeRevision).toBe("abc");
    expect(r.seed).toBe("42");
    expect(r.failureSignature).toBe("E: timeout");
    expect(r.result).toBe("failed");
  });
});

describe("RegressionConfirmationService", () => {
  it("fails the QA decision when a required suite result fails", () => {
    const svc = new RegressionConfirmationService();
    const c = svc.build({
      remediationProposalId: "rp:1",
      qaCycleId: "c:1",
      targetedTestResult: "passed",
      relatedTestResults: ["passed"],
      impactedTestResults: ["passed"],
      requiredSuiteResults: ["passed", "failed"],
      coverageGapStatus: "resolved",
      affectedFlowValidation: "validated",
      remainingFailures: [],
      remainingFlakyRisk: false,
      remainingWarnings: [],
    });
    expect(c.qaDecisionImpact).toBe("failed");
  });

  it("passes (with warnings) when a flaky risk remains but required suites pass", () => {
    const svc = new RegressionConfirmationService();
    const c = svc.build({
      remediationProposalId: "rp:2",
      qaCycleId: "c:1",
      targetedTestResult: "passed",
      relatedTestResults: ["passed"],
      impactedTestResults: ["passed"],
      requiredSuiteResults: ["passed"],
      coverageGapStatus: "resolved",
      affectedFlowValidation: "validated",
      remainingFailures: [],
      remainingFlakyRisk: true,
      remainingWarnings: ["flaky"],
    });
    expect(c.qaDecisionImpact).toBe("passed-with-warnings");
  });
});

describe("QaStore Phase 7 persistence (restart recovery)", () => {
  it("round-trips generation request, scenario derivation, and remediation records", () => {
    const store = new InMemoryQaStore();
    const req = makeRequest();
    store.saveGenerationRequest(req);
    expect(store.getGenerationRequest("req:1")?.id).toBe("req:1");
    expect(store.listGenerationRequests("cycle:1").length).toBe(1);

    store.saveScenarioDerivation({
      requestId: "req:1",
      scenarios: [],
      categoriesConsidered: [],
      categoriesSelected: [],
      metadata: { createdAt: new Date().toISOString(), contentHash: "h" },
    });
    expect(store.getScenarioDerivation("req:1")).toBeDefined();

    const prop = RemediationProposalSchema.parse({
      id: "rp:persist",
      failureAnalysisId: "fa:1",
      qaCycleId: "c:1",
      type: "test-fix",
      rationale: "x",
      scope: { allowedFiles: ["svc.test.ts"], prohibitedFiles: [], targetEntityIds: [] },
      changes: [
        ProposedChangeSchema.parse({
          filePath: "svc.test.ts",
          changeType: "modify",
          description: "fix",
        }),
      ],
      validation: { targetedTests: [], relatedTests: [], regressionScope: [] },
      risk: { level: "low", warnings: [] },
      policy: { violations: [], approvalRequired: false },
      status: "ready",
      metadata: {
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        contentHash: "h",
      },
    });
    store.saveRemediationProposal(prop);
    expect(store.getRemediationProposal("rp:persist")?.id).toBe("rp:persist");
  });
});

// __APPEND3__

describe("TestScenarioDerivationService", () => {
  it("derives evidence-backed scenarios from a coverage gap and acceptance criterion", () => {
    const svc = new TestScenarioDerivationService();
    const result = svc.derive({
      request: makeRequest(),
      gaps: [makeGap()],
      acceptanceCriteria: [{ id: "ac:1", description: "user can create an order" }],
    });
    expect(result.scenarios.length).toBeGreaterThan(0);
    const happy = result.scenarios.find((s) => s.category === "happy-path");
    expect(happy).toBeDefined();
    expect(happy!.relatedRequirementId).toBe("ac:1");
    expect(happy!.expectedOutcome).toContain("order");
    for (const s of result.scenarios) {
      expect(s.testLayer).toBe("unit");
      expect(["low", "medium", "high", "critical"]).toContain(s.risk);
      expect(s.evidence.length).toBeGreaterThan(0);
      expect(DerivedScenarioSchema.safeParse(s).success).toBe(true);
    }
  });

  it("selects only categories supported by the actual change (no generic bucket)", () => {
    const svc = new TestScenarioDerivationService();
    const result = svc.derive({
      request: makeRequest({
        targets: {
          productionEntityIds: [],
          flowIds: [],
          acceptanceCriterionIds: ["ac:1"],
          existingTestIds: [],
        },
      }),
      gaps: [makeGap({ gapType: "affected-flow-no-integration-test" })],
      acceptanceCriteria: [{ id: "ac:1", description: "flow runs" }],
      impact: {
        flows: [
          {
            id: "flow:1",
            name: "checkout",
            sideEffects: ["publish OrderCreated"],
            relatedTestIds: [],
          },
        ],
      } as unknown as ImpactAnalysis,
    });
    expect(result.categoriesSelected).toContain("event-publication");
    expect(result.categoriesSelected).toContain("happy-path");
    expect(result.categoriesSelected).not.toContain("rollback-or-compensation");
  });

  it("derives regression-reproduction from defect evidence", () => {
    const svc = new TestScenarioDerivationService();
    const result = svc.derive({
      request: makeRequest({
        trigger: { type: "bug-regression", sourceId: "def:1", description: "off-by-one" },
      }),
      gaps: [],
      acceptanceCriteria: [{ id: "ac:1", description: "x" }],
      defectEvidence: [{ id: "def:1", kind: "defect", statement: "boundary off-by-one" }],
    });
    expect(result.categoriesSelected).toContain("regression-reproduction");
  });
});

describe("TestPatternDiscoveryService", () => {
  const candidates: CandidateTest[] = [
    {
      testId: "t1",
      filePath: "src/core/order/order.test.ts",
      frameworkId: "vitest",
      testLayer: "unit",
      userConfirmed: true,
    },
    {
      testId: "t2",
      filePath: "src/core/order/other.test.ts",
      frameworkId: "vitest",
      testLayer: "unit",
    },
    { testId: "t3", filePath: "src/ui/foo.spec.ts", frameworkId: "playwright", testLayer: "e2e" },
  ];

  it("ranks same-module, same-framework, user-confirmed tests highest", () => {
    const svc = new TestPatternDiscoveryService();
    const res = svc.discover(candidates, {
      productionEntityId: "order",
      testLayer: "unit",
      frameworkId: "vitest",
      modulePath: "src/core/order/order.ts",
    });
    expect(res.examples[0]!.testId).toBe("t1");
    expect(res.examples[0]!.rank).toBeGreaterThan(res.examples[1]!.rank);
  });

  it("returns bounded representative examples, not the whole suite", () => {
    const many = Array.from({ length: 40 }, (_, i) => ({
      testId: `x${i}`,
      filePath: `src/a/test${i}.test.ts`,
      testLayer: "unit" as const,
    }));
    const svc = new TestPatternDiscoveryService();
    const res = svc.discover(many, { testLayer: "unit" });
    expect(res.examples.length).toBeLessThanOrEqual(12);
  });
});

describe("TestLocationRecommendationService", () => {
  it("reuses the repository's existing test layout instead of inventing a pattern", () => {
    const svc = new TestLocationRecommendationService();
    const rec = svc.recommend({
      productionFilePath: "src/core/order/order.ts",
      productionEntityId: "order",
      testLayer: "unit",
      existingTestFiles: ["src/core/order/order.test.ts", "src/core/order/price.test.ts"],
    });
    expect(rec.proposedFile).toBe("src/core/order/order.test.ts");
    expect(rec.createOrModify).toBe("modify");
  });

  it("proposes a co-located test file when no convention exists", () => {
    const svc = new TestLocationRecommendationService();
    const rec = svc.recommend({
      productionFilePath: "src/core/new/thing.ts",
      productionEntityId: "thing",
      testLayer: "unit",
      existingTestFiles: [],
    });
    expect(rec.proposedFile).toBe("src/core/new/thing.test.ts");
    expect(rec.createOrModify).toBe("create");
  });
});
