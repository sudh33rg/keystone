import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { TestFailureClassifier } from "../../../src/core/impactQa/TestFailureClassifier";
import { FlakyClassificationService } from "../../../src/core/impactQa/FlakyClassificationService";
import { TestChangePolicyService } from "../../../src/core/impactQa/TestChangePolicyService";
import { TestScenarioService } from "../../../src/core/impactQa/TestScenarioService";
import { TestIntelligenceService } from "../../../src/core/impactQa/TestIntelligenceService";
import { QaTestIntelligencePersistence } from "../../../src/core/impactQa/QaTestIntelligencePersistence";
import type { ImpactQaAggregate } from "../../../src/shared/contracts/impactQa";
import type {
  Phase7CoverageGap,
  TestFrameworkCapability,
} from "../../../src/shared/contracts/impactQa";

const workflowId = "00000000-0000-4000-8000-000000000081";

function capability(): TestFrameworkCapability {
  return {
    id: "vitest",
    framework: "vitest",
    sourceFiles: ["package.json"],
    availability: "available",
    commands: [
      {
        id: "vitest-file",
        frameworkId: "vitest",
        displayName: "Test file",
        executable: "npm",
        arguments: ["run", "test", "--"],
        workingDirectory: ".",
        scope: "test-file",
        source: "package-script",
        timeoutMs: 120000,
      },
    ],
  };
}

function coverageGap(id: string): Phase7CoverageGap {
  return {
    id,
    entityId: "svc",
    flowId: undefined,
    reason: "No test exercises the success path.",
    confidence: 1,
    recommendedTestLayer: "e2e",
    blocking: false,
  };
}

function baseQa(): ImpactQaAggregate {
  return {
    workflowId,
    impactAnalysis: {
      id: "impact-1",
      workflowId,
      changeSetId: "cs-1",
      intelligenceRevision: "rev-1",
      changedEntityIds: ["svc"],
      impacts: [],
      affectedFlowIds: [],
      affectedContractIds: [],
      mappedTests: [],
      coverageGaps: [coverageGap("gap-1")],
      graph: { rootEntityIds: [], nodes: [], edges: [], request: { mode: "calls", direction: "both", depth: 1, relationshipTypes: [], maxNodes: 50, maxEdges: 100, minimumConfidence: 0 }, truncation: { truncated: false, nodeLimitReached: false, edgeLimitReached: false, expandableEntityIds: [] }, intelligenceRevision: "r" },
      risk: { level: "low", factors: [] },
      status: "accepted",
      createdAt: new Date().toISOString(),
      contentHash: "sha256:impact",
      summary: "Impact analysis for coverage gap svc",
    },
    qaPlan: {
      id: "plan-1",
      workflowId,
      impactAnalysisId: "impact-1",
      impactHash: "sha256:impact",
      changeSetHash: "sha256:change",
      requiredItems: [],
      recommendedItems: [],
      optionalItems: [],
      coverageGapIds: ["gap-1"],
      status: "approved",
      createdAt: new Date().toISOString(),
      contentHash: "sha256:plan",
    },
    capabilities: [capability()],
    decision: {
      id: "dec-1",
      workflowId,
      qaPlanId: "plan-1",
      decision: "passed",
      gates: [],
      unresolvedFailureIds: [],
      coverageGapIds: [],
      createdAt: new Date().toISOString(),
      contentHash: "sha256:dec",
    },
    changedEntities: [],
  };
}

class StubQa {
  state = baseQa();
  async load(): Promise<ImpactQaAggregate> {
    return this.state;
  }
}

class StubDevelopment {
  created: string[] = [];
  async createDefectWorkItem(
    _workflowId: string,
    objective: string,
    _correlationId: string,
    _detail?: string,
  ): Promise<string> {
    const id = `defect-${this.created.length + 1}`;
    this.created.push(objective);
    return id;
  }
}

class StubHost {
  async workspaceFiles(): Promise<Set<string>> {
    return new Set<string>();
  }
  async readSource(): Promise<string> {
    throw new Error("no source in test");
  }
}

function fullEvidence(overrides: Record<string, unknown> = {}) {
  return {
    workflowId,
    qaExecutionId: "exec-1",
    testFailureId: "t-fail",
    changedProductionFiles: [],
    changedTestFiles: [],
    changedFixtureFiles: [],
    testFilePath: "tests/svc.test.ts",
    testName: "breaks on prod data",
    message: "TypeError: cannot read property of undefined",
    normalizedMessage: "TypeError: cannot read property of undefined",
    stackFrames: [],
    exceptionType: "TypeError",
    assertionLocation: undefined,
    specification: undefined,
    expectedContractText: undefined,
    currentContractText: undefined,
    environmentProblems: [],
    infrastructureProblems: [],
    previousOutcomes: [],
    timedOut: false,
    signatureVariesAcrossRuns: false,
    orderOrTimingSensitive: false,
    ...overrides,
  };
}

describe("Phase 8 — Test Intelligence deterministic services", () => {
  it("classifier produces a stable signature that excludes timestamps and uuids", () => {
    const classifier = new TestFailureClassifier();
    const a = classifier.classify(
      fullEvidence({
        message: "expected true but got false at 2026-07-22T10:00:00.000Z (run a1b2c3d4)",
        normalizedMessage: "expected true but got false at <TIME> (run <ID>)",
      }),
    );
    const b = classifier.classify(
      fullEvidence({
        message: "expected true but got false at 2026-01-01T00:00:00.000Z (run z9y8x7w6)",
        normalizedMessage: "expected true but got false at <TIME> (run <ID>)",
      }),
    );
    expect(a.failureSignature).toBe(b.failureSignature);
    expect(typeof a.category).toBe("string");
  });

  it("classifier flags a varying signature as a flaky candidate", () => {
    const classifier = new TestFailureClassifier();
    const result = classifier.classify(fullEvidence({ signatureVariesAcrossRuns: true }));
    expect(result.category).toBe("flaky-candidate");
  });

  it("flaky service never flags a single pass/fail pair as confirmed flaky", () => {
    const flaky = new FlakyClassificationService();
    const runs = [
      { id: "r1", workflowId, testId: "t1", revision: "1", environmentFingerprint: "env", result: "failed" as const, durationMs: 10, failureSignature: "S1", seed: undefined, orderIndex: undefined, executedAt: new Date().toISOString() },
      { id: "r2", workflowId, testId: "t1", revision: "1", environmentFingerprint: "env", result: "passed" as const, durationMs: 11, failureSignature: undefined, seed: undefined, orderIndex: undefined, executedAt: new Date().toISOString() },
    ];
    const result = flaky.classify({ workflowId, testId: "t1", revision: "1", environmentFingerprint: "env", runs });
    expect(result.state).toBe("flaky-candidate");
    expect(result.confidence).toBeLessThanOrEqual(0.6);
  });

  it("flaky service marks a stable failure as not-flaky", () => {
    const flaky = new FlakyClassificationService();
    const runs = Array.from({ length: 3 }, (_, i) => ({
      id: `r${i}`,
      workflowId,
      testId: "t1",
      revision: "1",
      environmentFingerprint: "env",
      result: "failed" as const,
      durationMs: 10,
      failureSignature: "SAME",
      seed: undefined,
      orderIndex: undefined,
      executedAt: new Date().toISOString(),
    }));
    const result = flaky.classify({ workflowId, testId: "t1", revision: "1", environmentFingerprint: "env", runs });
    expect(result.state).toBe("stable-fail");
  });

  it("policy service blocks deletes, skips, sleep, retry, timeout, and config changes", () => {
    const policy = new TestChangePolicyService();
    const blocking = policy.assess({
      proposalId: "p1",
      isRemediation: false,
      changes: [
        { id: "c1", proposalId: "p1", filePath: "tests/svc.test.ts", changeType: "delete", diff: "", classification: "test", selected: true },
        { id: "c2", proposalId: "p1", filePath: "tests/svc.test.ts", changeType: "modify", diff: "- it.skip(\"x\")\n+ it(\"x\")", classification: "test", selected: true },
        { id: "c3", proposalId: "p1", filePath: "tests/svc.test.ts", changeType: "modify", diff: "+ await sleep(500)", classification: "test", selected: true },
        { id: "c4", proposalId: "p1", filePath: "tests/svc.test.ts", changeType: "modify", diff: "+ await retry(() => run())", classification: "test", selected: true },
        { id: "c5", proposalId: "p1", filePath: "tests/svc.test.ts", changeType: "modify", diff: "+ testTimeout: 99999", classification: "test", selected: true },
        { id: "c6", proposalId: "p1", filePath: "vitest.config.ts", changeType: "modify", diff: "+ testTimeout: 99999", classification: "configuration", selected: true },
      ],
    });
    expect(blocking.status).toBe("blocked");
    const rules = new Set(blocking.findings.filter((f) => f.severity === "blocking").map((f) => f.rule));
    expect(rules.has("policy-test-deletion")).toBe(true);
    expect(rules.has("policy-test-skip")).toBe(true);
    expect(rules.has("policy-arbitrary-wait")).toBe(true);
    expect(rules.has("policy-unbounded-retry")).toBe(true);
    expect(rules.has("policy-timeout-increase")).toBe(true);
    expect(rules.has("policy-production-change")).toBe(true);
  });

  it("scenario service throws when evidence is insufficient", () => {
    const scenarios = new TestScenarioService();
    expect(() =>
      scenarios.derive({
        workflowId,
        generationRequestId: "gr-1",
        intent: "x",
        specification: undefined,
        acceptanceCriteria: [],
        affectedEntities: [],
        affectedFlows: [],
        coverageGapReason: "reason",
        recommendedLayer: "unit",
        existingTestFilePaths: [],
        testFramework: "vitest",
        publicContractChanges: [],
      }),
    ).toThrow(/acceptance|behaviour|existing/i);
  });
});

describe("Phase 8 — TestIntelligenceService orchestration", () => {
  let root: string;
  let service: TestIntelligenceService;
  let qa: StubQa;
  let dev: StubDevelopment;

  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), "keystone-p8-"));
    await writeFile(join(root, "package.json"), JSON.stringify({ scripts: { test: "vitest run" }, devDependencies: { vitest: "1.0.0" } }));
    qa = new StubQa();
    dev = new StubDevelopment();
    service = new TestIntelligenceService(root, new QaTestIntelligencePersistence(root), qa as never, dev as never, new StubHost());
    await service.initialize();
  });

  afterEach(async () => {
    await rm(root, { recursive: true, force: true });
  });

  it("creates a generation request from an accepted coverage gap", async () => {
    const next = await service.createGenerationRequest(workflowId, "gap-1");
    expect(next.generationRequests).toHaveLength(1);
    expect(next.generationRequests[0]?.coverageGapId).toBe("gap-1");
    expect(next.generationRequests[0]?.testLayer).toBe("end-to-end");
  });

  it("refuses a generation request for a missing coverage gap", async () => {
    await expect(service.createGenerationRequest(workflowId, "missing")).rejects.toThrow(/coverage gap/i);
  });

  it("routes production defects to Development and blocks remediation healing", async () => {
    const created = await service.createFailureAnalysis(
      workflowId,
      "t-fail",
      fullEvidence({
        changedProductionFiles: ["svc.ts"],
        stackFrames: ["svc.ts:10"],
        message: "TypeError: cannot read property of undefined",
        normalizedMessage: "TypeError: cannot read property of undefined",
        exceptionType: "TypeError",
      }),
    );
    expect(created.analysis.category).toBe("production-defect");
    const accepted = await service.acceptFailureClassification(workflowId, created.analysis.id, "production-defect");
    expect(accepted.failureAnalyses[0]?.status).toBe("accepted");
    expect(dev.created.length).toBe(1);
    await expect(
      service.createRemediationProposal(workflowId, created.analysis.id, {
        summary: "patch",
        scenarioMappings: [],
        fileChanges: [],
        assumptions: [],
        testsToRun: [],
        unresolvedIssues: [],
      }),
    ).rejects.toThrow(/production/i);
  });

  it("persists policy assessments inside the aggregate", async () => {
    const req = await service.createGenerationRequest(workflowId, "gap-1");
    const requestId = req.generationRequests[0]!.id;
    await service.recordProposal(workflowId, requestId, {
      summary: "add test",
      scenarioMappings: [],
      fileChanges: [{ id: "fc1", proposalId: "", filePath: "tests/svc.test.ts", changeType: "create", diff: "content", classification: "test", selected: true }],
      assumptions: [],
      testsToRun: [],
      unresolvedIssues: [],
    });
    const loaded = await service.load(workflowId);
    expect(loaded.policyAssessments.length).toBeGreaterThan(0);
  });
});
