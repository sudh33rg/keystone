/**
 * Phase 7 — Canonical QA Remediation model (spec §3-§51).
 *
 * Extends the Phase 6 placeholder (`TestGenerationRequest`) into the complete remediation
 * lifecycle: test generation, failure classification, flaky-test intelligence, safe healing,
 * bounded change application, targeted rerun, regression confirmation, and audit.
 *
 * Deterministic, LLM-free core. Reuses Phase 6 `qaLifecycle` types (ImpactAnalysis, CoverageGap,
 * FailureGroup, TestPlan, TestExecutionRun, ParsedTestResult, QaDecision, QaError) and the Phase 2
 * execution-profile system. No behavior is fabricated; classifications carry explicit confidence and
 * evidence, and healing policies forbid "make it green" shortcuts.
 *
 * zod v4: every `z.record` uses the two-argument form `z.record(keySchema, valueSchema)`.
 */
import { z } from "zod";
import type {
  QaDecision,
  QaError,
  CoverageGap,
  FailureGroup,
  TestPlan,
  TestExecutionRun,
  ParsedTestResult,
  TestLayer,
} from "./qaLifecycle";
import { TestLayerSchema, QaErrorCodeSchema } from "./qaLifecycle";

// Re-export Phase 6 types so consumers import Phase 7 from one place.
export type {
  QaDecision,
  QaError,
  CoverageGap,
  FailureGroup,
  TestPlan,
  TestExecutionRun,
  ParsedTestResult,
  TestLayer,
};

// ---------------------------------------------------------------------------
// Shared enums (spec §5, §16, §17, §21, §22, §24, §26, §33)
// ---------------------------------------------------------------------------

export const TestGenerationTriggerSchema = z.enum([
  "coverage-gap",
  "acceptance-criterion",
  "changed-contract",
  "changed-flow",
  "bug-regression",
  "user-request",
  "review-finding",
  "security-recommendation",
  "performance-recommendation",
]);
export type TestGenerationTrigger = z.infer<typeof TestGenerationTriggerSchema>;

export const GeneratedTestStatusSchema = z.enum([
  "proposed",
  "approved",
  "planning",
  "ready",
  "delegated",
  "proposal-ready",
  "accepted",
  "rejected",
  "applied",
  "validated",
  "failed",
  "blocked",
  "cancelled",
  "superseded",
]);
export type GeneratedTestStatus = z.infer<typeof GeneratedTestStatusSchema>;

export const ScenarioCategorySchema = z.enum([
  "happy-path",
  "validation-failure",
  "authorization-failure",
  "missing-data",
  "invalid-state",
  "boundary-value",
  "empty-input",
  "duplicate-operation",
  "retry-behaviour",
  "error-propagation",
  "persistence-effect",
  "event-publication",
  "external-dependency-failure",
  "rollback-or-compensation",
  "backward-compatibility",
  "regression-reproduction",
]);
export type ScenarioCategory = z.infer<typeof ScenarioCategorySchema>;

export const FailureClassificationSchema = z.enum([
  "product-defect",
  "incorrect-expectation",
  "stale-test",
  "flaky-behaviour",
  "test-data-problem",
  "fixture-problem",
  "mock-problem",
  "environment-issue",
  "infrastructure-issue",
  "timeout-or-performance-instability",
  "dependency-issue",
  "configuration-issue",
  "unsupported-framework-result",
  "unknown",
]);
export type FailureClassification = z.infer<typeof FailureClassificationSchema>;

export const FlakyClassificationSchema = z.enum([
  "not-enough-evidence",
  "suspected",
  "probable",
  "confirmed",
  "unlikely",
]);
export type FlakyClassification = z.infer<typeof FlakyClassificationSchema>;

export const FlakyCauseSchema = z.enum([
  "timing",
  "shared-state",
  "order-dependence",
  "randomness",
  "external-service",
  "resource-contention",
  "test-data-collision",
  "environment",
  "unknown",
]);
export type FlakyCause = z.infer<typeof FlakyCauseSchema>;

export const RemediationTypeSchema = z.enum([
  "production-fix",
  "test-fix",
  "fixture-fix",
  "mock-fix",
  "stability-fix",
  "environment-fix",
  "investigation",
]);
export type RemediationType = z.infer<typeof RemediationTypeSchema>;

export const RemediationStatusSchema = z.enum([
  "draft",
  "ready",
  "blocked",
  "awaiting-approval",
  "approved",
  "rejected",
  "applied",
  "validated",
  "failed",
  "superseded",
]);
export type RemediationStatus = z.infer<typeof RemediationStatusSchema>;

export const RemediationAttemptOutcomeSchema = z.enum([
  "applied",
  "targeted-passed",
  "targeted-failed",
  "regression-passed",
  "regression-failed",
  "reverted",
  "blocked",
  "cancelled",
]);
export type RemediationAttemptOutcome = z.infer<typeof RemediationAttemptOutcomeSchema>;

export const FailureAnalysisStatusSchema = z.enum([
  "draft",
  "completed",
  "needs-evidence",
  "awaiting-review",
  "approved",
  "rejected",
  "superseded",
]);
export type FailureAnalysisStatus = z.infer<typeof FailureAnalysisStatusSchema>;

export const DiagnosticRerunModeSchema = z.enum([
  "once",
  "repeat",
  "isolated",
  "in-suite",
  "deterministic-seed",
  "increased-logging",
  "order-variation",
]);
export type DiagnosticRerunMode = z.infer<typeof DiagnosticRerunModeSchema>;

// ---------------------------------------------------------------------------
// 1. TestGenerationRequest (spec §5) — full model replacing Phase 6 placeholder
// ---------------------------------------------------------------------------

export const TestGenerationRequestSchema = z.object({
  id: z.string().min(1).max(500),
  workflowId: z.string().max(500).optional(),
  qaCycleId: z.string().min(1).max(500),

  trigger: z.object({
    type: TestGenerationTriggerSchema,
    sourceId: z.string().min(1).max(2000),
    description: z.string().min(1).max(2000),
  }),

  targets: z.object({
    productionEntityIds: z.array(z.string().min(1)).max(2000).default([]),
    flowIds: z.array(z.string().min(1)).max(2000).default([]),
    acceptanceCriterionIds: z.array(z.string().min(1)).max(2000).default([]),
    existingTestIds: z.array(z.string().min(1)).max(2000).default([]),
  }),

  recommendation: z.object({
    testLayer: TestLayerSchema,
    frameworkId: z.string().max(200).optional(),
    suggestedLocation: z.string().max(2000).optional(),
    priority: z.enum(["low", "medium", "high", "critical"]),
  }),

  status: GeneratedTestStatusSchema.default("proposed"),

  metadata: z.object({
    createdAt: z.string().min(1),
    updatedAt: z.string().min(1),
    contentHash: z.string().min(1),
  }),
});
export type TestGenerationRequest = z.infer<typeof TestGenerationRequestSchema>;

// ---------------------------------------------------------------------------
// 2. Test scenario derivation (spec §6, §7)
// ---------------------------------------------------------------------------

export const DerivedScenarioSchema = z.object({
  id: z.string().min(1).max(500),
  title: z.string().min(1).max(500),
  category: ScenarioCategorySchema,
  relatedRequirementId: z.string().min(1).max(2000),
  preconditions: z.string().min(1).max(2000),
  action: z.string().min(1).max(2000),
  expectedOutcome: z.string().min(1).max(2000),
  testLayer: TestLayerSchema,
  targetEntityIds: z.array(z.string().min(1)).max(2000).default([]),
  requiredFixtures: z.array(z.string().max(500)).max(100).default([]),
  requiredMocks: z.array(z.string().max(500)).max(100).default([]),
  sideEffectsToVerify: z.array(z.string().max(1000)).max(100).default([]),
  priority: z.enum(["low", "medium", "high", "critical"]),
  risk: z.enum(["low", "medium", "high", "critical"]),
  evidence: z
    .array(
      z.object({ id: z.string().min(1), kind: z.string().min(1), statement: z.string().min(1) }),
    )
    .max(100)
    .default([]),
  derivationConfidence: z.number().min(0).max(1),
});
export type DerivedScenario = z.infer<typeof DerivedScenarioSchema>;

export const TestScenarioDerivationResultSchema = z.object({
  requestId: z.string().min(1).max(500),
  scenarios: z.array(DerivedScenarioSchema).max(500).default([]),
  categoriesConsidered: z.array(ScenarioCategorySchema).max(50).default([]),
  categoriesSelected: z.array(ScenarioCategorySchema).max(50).default([]),
  metadata: z.object({ createdAt: z.string().min(1), contentHash: z.string().min(1) }),
});
export type TestScenarioDerivationResult = z.infer<typeof TestScenarioDerivationResultSchema>;

// ---------------------------------------------------------------------------
// 3/4. Existing-test pattern discovery + location recommendation (spec §8, §9)
// ---------------------------------------------------------------------------

export const TestPatternExampleSchema = z.object({
  testId: z.string().min(1).max(500),
  filePath: z.string().min(1).max(2000),
  frameworkId: z.string().max(200).optional(),
  testLayer: TestLayerSchema,
  rank: z.number().min(0).max(1),
  reasons: z.array(z.string().max(1000)).max(20).default([]),
});
export type TestPatternExample = z.infer<typeof TestPatternExampleSchema>;

export const TestPatternDiscoveryResultSchema = z.object({
  productionEntityId: z.string().min(1).max(500).optional(),
  examples: z.array(TestPatternExampleSchema).max(50).default([]),
  metadata: z.object({ createdAt: z.string().min(1), contentHash: z.string().min(1) }),
});
export type TestPatternDiscoveryResult = z.infer<typeof TestPatternDiscoveryResultSchema>;

export const TestLocationRecommendationSchema = z.object({
  proposedFile: z.string().min(1).max(2000),
  createOrModify: z.enum(["create", "modify"]),
  frameworkId: z.string().max(200).optional(),
  testLayer: TestLayerSchema,
  reasoning: z.string().min(1).max(2000),
  alternativeLocations: z.array(z.string().max(2000)).max(20).default([]),
  confidence: z.number().min(0).max(1),
});
export type TestLocationRecommendation = z.infer<typeof TestLocationRecommendationSchema>;

// ---------------------------------------------------------------------------
// 5. Test generation plan (spec §10) — superset of Phase 6 TestPlan for generation scope
// ---------------------------------------------------------------------------

export const ProposedChangeSchema = z.object({
  filePath: z.string().min(1).max(2000),
  changeType: z.enum(["create", "modify", "delete"]),
  description: z.string().min(1).max(2000),
  assertionChange: z.boolean().default(false),
  fixtureChange: z.boolean().default(false),
  mockChange: z.boolean().default(false),
  snapshotChange: z.boolean().default(false),
  productionCodeChange: z.boolean().default(false),
  timeoutChange: z.boolean().default(false),
});
export type ProposedChange = z.infer<typeof ProposedChangeSchema>;

export const TestGenerationPlanSchema = z.object({
  id: z.string().min(1).max(500),
  requestId: z.string().min(1).max(500),
  approvedScenarioIds: z.array(z.string().min(1)).max(500).default([]),
  targetProductionEntityIds: z.array(z.string().min(1)).max(2000).default([]),
  targetTestFiles: z.array(z.string().min(1).max(2000)).max(500).default([]),
  representativeExampleTests: z.array(z.string().min(1).max(500)).max(50).default([]),
  fixtureRequirements: z.array(z.string().max(500)).max(100).default([]),
  mockRequirements: z.array(z.string().max(500)).max(100).default([]),
  permittedFiles: z.array(z.string().min(1).max(2000)).max(500).default([]),
  prohibitedFiles: z.array(z.string().min(1).max(2000)).max(500).default([]),
  selectedExecutionProfileId: z.string().max(500).optional(),
  tokenBudget: z.number().int().nonnegative().optional(),
  expectedOutputContract: z.string().max(2000).default("structured-test-proposal"),
  requiredValidationCommands: z.array(z.string().min(1).max(2000)).max(50).default([]),
  reviewGates: z
    .array(
      z.enum([
        "diff-review",
        "assertion-review",
        "snapshot-review",
        "policy-review",
        "manual-approval",
      ]),
    )
    .max(20)
    .default([]),
  status: z.enum(["draft", "ready", "approved", "delegated", "superseded"]).default("draft"),
  metadata: z.object({
    createdAt: z.string().min(1),
    updatedAt: z.string().min(1),
    contentHash: z.string().min(1),
  }),
});
export type TestGenerationPlan = z.infer<typeof TestGenerationPlanSchema>;

// ---------------------------------------------------------------------------
// 6. Generated test proposal (spec §13)
// ---------------------------------------------------------------------------

export const GeneratedTestProposalSchema = z.object({
  id: z.string().min(1).max(500),
  requestId: z.string().min(1).max(500),
  planId: z.string().min(1).max(500),
  summary: z.string().min(1).max(5000),
  scenariosImplemented: z.array(z.string().min(1)).max(500).default([]),
  filesToCreate: z.array(z.string().min(1).max(2000)).max(500).default([]),
  filesToModify: z.array(z.string().min(1).max(2000)).max(500).default([]),
  productionFilesTouched: z.array(z.string().min(1).max(2000)).max(500).default([]),
  testFilesTouched: z.array(z.string().min(1).max(2000)).max(500).default([]),
  fixturesOrMocksAdded: z.array(z.string().max(500)).max(100).default([]),
  assumptions: z.array(z.string().max(2000)).max(50).default([]),
  unresolvedQuestions: z.array(z.string().max(2000)).max(50).default([]),
  generatedPatchReference: z.string().max(2000).optional(),
  recommendedExecutionCommands: z.array(z.string().min(1).max(2000)).max(50).default([]),
  requirementMapping: z
    .array(z.object({ requirementId: z.string().min(1), scenarioId: z.string().min(1) }))
    .max(500)
    .default([]),
  // Structured safety screening (spec §13 reject/warns).
  warnings: z.array(z.string().max(2000)).max(100).default([]),
  violations: z.array(z.string().max(2000)).max(100).default([]),
  status: GeneratedTestStatusSchema.default("proposal-ready"),
  metadata: z.object({
    createdAt: z.string().min(1),
    updatedAt: z.string().min(1),
    contentHash: z.string().min(1),
  }),
});
export type GeneratedTestProposal = z.infer<typeof GeneratedTestProposalSchema>;

// ---------------------------------------------------------------------------
// 7. Failure evidence enrichment (spec §16)
// ---------------------------------------------------------------------------

export const FailureEvidenceSchema = z.object({
  testResultId: z.string().min(1).max(500),
  testSource: z.string().max(20000).optional(),
  stackFrames: z.array(z.string().max(2000)).max(100).default([]),
  expectedValue: z.string().max(5000).optional(),
  actualValue: z.string().max(5000).optional(),
  relatedProductionCode: z.array(z.string().max(2000)).max(100).default([]),
  changedSymbolIds: z.array(z.string().min(1)).max(2000).default([]),
  impactedFlowIds: z.array(z.string().min(1)).max(500).default([]),
  fixtures: z.array(z.string().max(500)).max(100).default([]),
  mocks: z.array(z.string().max(500)).max(100).default([]),
  environmentFingerprint: z.string().max(500).optional(),
  previousRuns: z.array(z.string().max(500)).max(200).default([]),
  recentPassHistory: z.array(z.string().max(500)).max(200).default([]),
  retryHistory: z.array(z.string().max(500)).max(200).default([]),
  relatedFailures: z.array(z.string().min(1)).max(2000).default([]),
  acceptanceCriteria: z.array(z.string().max(2000)).max(50).default([]),
  repositoryRevision: z.string().max(500).optional(),
  testConfiguration: z.string().max(2000).optional(),
  timeoutMs: z.number().int().nonnegative().optional(),
  durationMs: z.number().int().nonnegative().optional(),
  rawLogRef: z.string().max(2000).optional(),
});
export type FailureEvidence = z.infer<typeof FailureEvidenceSchema>;

// ---------------------------------------------------------------------------
// 8/19/20. Failure classification + analysis (spec §17, §18, §19, §20)
// ---------------------------------------------------------------------------

export const ClassificationAlternativeSchema = z.object({
  category: FailureClassificationSchema,
  confidence: z.number().min(0).max(1),
  reason: z.string().min(1).max(2000),
});
export type ClassificationAlternative = z.infer<typeof ClassificationAlternativeSchema>;

export const DeterministicClassificationSchema = z.object({
  primary: FailureClassificationSchema,
  confidence: z.number().min(0).max(1),
  evidence: z.array(z.string().min(1).max(2000)).max(100).default([]),
  competingHypotheses: z.array(ClassificationAlternativeSchema).max(20).default([]),
  missingEvidence: z.array(z.string().min(1).max(2000)).max(50).default([]),
  recommendedNextAction: z.string().min(1).max(2000),
  automaticRemediationAllowed: z.boolean(),
  source: z.enum(["deterministic", "agent", "user-override"]).default("deterministic"),
});
export type DeterministicClassification = z.infer<typeof DeterministicClassificationSchema>;

export const FailureAnalysisSchema = z.object({
  id: z.string().min(1).max(500),
  requestId: z.string().min(1).max(500),
  workflowId: z.string().max(500).optional(),
  qaCycleId: z.string().min(1).max(500),

  classification: z.object({
    primary: FailureClassificationSchema,
    confidence: z.number().min(0).max(1),
    alternatives: z.array(ClassificationAlternativeSchema).max(20).default([]),
  }),

  evidence: z.object({
    testResultIds: z.array(z.string().min(1)).max(2000).default([]),
    changedEntityIds: z.array(z.string().min(1)).max(2000).default([]),
    impactedFlowIds: z.array(z.string().min(1)).max(500).default([]),
    contextPackageId: z.string().max(500).optional(),
    evidenceIds: z.array(z.string().min(1)).max(2000).default([]),
  }),

  recommendation: z.object({
    action: z.enum([
      "fix-production-code",
      "fix-test",
      "fix-fixture",
      "fix-mock",
      "adjust-environment",
      "rerun",
      "investigate",
      "no-action",
    ]),
    automaticRemediationAllowed: z.boolean(),
    approvalRequired: z.boolean(),
    proposedScope: z.array(z.string().min(1).max(2000)).max(500).default([]),
  }),

  status: FailureAnalysisStatusSchema.default("draft"),
  metadata: z.object({
    createdAt: z.string().min(1),
    updatedAt: z.string().min(1),
    contentHash: z.string().min(1),
  }),
});
export type FailureAnalysis = z.infer<typeof FailureAnalysisSchema>;

// ---------------------------------------------------------------------------
// 9/21/22. Flaky-test intelligence (spec §21, §22)
// ---------------------------------------------------------------------------

export const FlakyCauseAssessmentSchema = z.object({
  cause: FlakyCauseSchema,
  confidence: z.number().min(0).max(1),
  evidenceIds: z.array(z.string().min(1)).max(2000).default([]),
});
export type FlakyCauseAssessment = z.infer<typeof FlakyCauseAssessmentSchema>;

export const FlakyTestAssessmentSchema = z.object({
  id: z.string().min(1).max(500),
  testId: z.string().min(1).max(500),
  classification: FlakyClassificationSchema,
  score: z.number().min(0).max(1),
  evidence: z.object({
    totalRuns: z.number().int().nonnegative(),
    passCount: z.number().int().nonnegative(),
    failCount: z.number().int().nonnegative(),
    relevantUnchangedReruns: z.number().int().nonnegative(),
    failureSignatureCount: z.number().int().nonnegative(),
    durationVariance: z.number().nonnegative().optional(),
    correlatedEnvironmentFactors: z.array(z.string().max(500)).max(50).default([]),
  }),
  likelyCauses: z.array(FlakyCauseAssessmentSchema).max(20).default([]),
  metadata: z.object({ evaluatedAt: z.string().min(1), historyRevision: z.string().min(1) }),
});
export type FlakyTestAssessment = z.infer<typeof FlakyTestAssessmentSchema>;

// ---------------------------------------------------------------------------
// 23. Diagnostic rerun (spec §23)
// ---------------------------------------------------------------------------

export const DiagnosticRerunRecordSchema = z.object({
  id: z.string().min(1).max(500),
  testId: z.string().min(1).max(500),
  mode: DiagnosticRerunModeSchema,
  codeRevision: z.string().max(500).optional(),
  testRevision: z.string().max(500).optional(),
  environmentFingerprint: z.string().max(500).optional(),
  command: z.string().min(1).max(2000),
  seed: z.string().max(200).optional(),
  order: z.string().max(200).optional(),
  result: z.enum(["passed", "failed", "error", "cancelled"]),
  durationMs: z.number().int().nonnegative(),
  failureSignature: z.string().max(2000).optional(),
  createdAt: z.string().min(1),
});
export type DiagnosticRerunRecord = z.infer<typeof DiagnosticRerunRecordSchema>;

// ---------------------------------------------------------------------------
// 25/26. Healing policy + remediation proposal (spec §25, §26)
// ---------------------------------------------------------------------------

export const PolicyViolationSchema = z.object({
  rule: z.string().min(1).max(200),
  severity: z.enum(["warning", "blocking"]),
  detail: z.string().min(1).max(2000),
});
export type PolicyViolation = z.infer<typeof PolicyViolationSchema>;

export const RemediationProposalSchema = z.object({
  id: z.string().min(1).max(500),
  failureAnalysisId: z.string().min(1).max(500),
  workflowId: z.string().max(500).optional(),
  qaCycleId: z.string().min(1).max(500),

  type: RemediationTypeSchema,
  rationale: z.string().min(1).max(2000),

  scope: z.object({
    allowedFiles: z.array(z.string().min(1).max(2000)).max(500).default([]),
    prohibitedFiles: z.array(z.string().min(1).max(2000)).max(500).default([]),
    targetEntityIds: z.array(z.string().min(1)).max(2000).default([]),
  }),

  changes: z.array(ProposedChangeSchema).max(500).default([]),

  validation: z.object({
    targetedTests: z.array(z.string().min(1).max(500)).max(2000).default([]),
    relatedTests: z.array(z.string().min(1).max(500)).max(2000).default([]),
    regressionScope: z.array(z.string().min(1).max(500)).max(2000).default([]),
  }),

  risk: z.object({
    level: z.enum(["low", "medium", "high", "critical"]),
    warnings: z.array(z.string().max(2000)).max(100).default([]),
  }),

  policy: z.object({
    violations: z.array(PolicyViolationSchema).max(100).default([]),
    approvalRequired: z.boolean(),
  }),

  status: RemediationStatusSchema.default("draft"),
  metadata: z.object({
    createdAt: z.string().min(1),
    updatedAt: z.string().min(1),
    contentHash: z.string().min(1),
  }),
});
export type RemediationProposal = z.infer<typeof RemediationProposalSchema>;

// ---------------------------------------------------------------------------
// 36. Remediation attempt (spec §36)
// ---------------------------------------------------------------------------

export const RemediationAttemptSchema = z.object({
  id: z.string().min(1).max(500),
  proposalId: z.string().min(1).max(500),
  workflowId: z.string().max(500).optional(),
  qaCycleId: z.string().min(1).max(500),
  attemptNumber: z.number().int().nonnegative(),
  application: z.object({
    appliedFiles: z.array(z.string().min(1).max(2000)).max(500).default([]),
    rejectedFiles: z.array(z.string().min(1).max(2000)).max(500).default([]),
    unexpectedFiles: z.array(z.string().min(1).max(2000)).max(500).default([]),
    patchReference: z.string().max(2000).optional(),
  }),
  validation: z.object({
    targetedRunId: z.string().max(500).optional(),
    relatedRunId: z.string().max(500).optional(),
    regressionRunId: z.string().max(500).optional(),
  }),
  outcome: RemediationAttemptOutcomeSchema,
  metadata: z.object({
    startedAt: z.string().min(1),
    completedAt: z.string().optional(),
    contentHash: z.string().min(1),
  }),
});
export type RemediationAttempt = z.infer<typeof RemediationAttemptSchema>;

// ---------------------------------------------------------------------------
// 39. Regression confirmation (spec §39)
// ---------------------------------------------------------------------------

export const RegressionConfirmationSchema = z.object({
  id: z.string().min(1).max(500),
  remediationProposalId: z.string().min(1).max(500),
  qaCycleId: z.string().min(1).max(500),
  targetedTestResult: z.enum(["passed", "failed", "skipped", "not-run"]),
  relatedTestResults: z
    .array(z.enum(["passed", "failed", "skipped", "not-run"]))
    .max(5000)
    .default([]),
  impactedTestResults: z
    .array(z.enum(["passed", "failed", "skipped", "not-run"]))
    .max(5000)
    .default([]),
  requiredSuiteResults: z
    .array(z.enum(["passed", "failed", "skipped", "not-run"]))
    .max(5000)
    .default([]),
  coverageGapStatus: z.enum(["resolved", "waived", "unresolved"]).default("unresolved"),
  affectedFlowValidation: z
    .enum(["validated", "not-validated", "not-applicable"])
    .default("not-applicable"),
  remainingFailures: z.array(z.string().min(1).max(500)).max(5000).default([]),
  remainingFlakyRisk: z.boolean().default(false),
  remainingWarnings: z.array(z.string().max(2000)).max(100).default([]),
  qaDecisionImpact: z
    .enum([
      "passed",
      "passed-with-warnings",
      "needs-remediation",
      "needs-manual-investigation",
      "failed",
      "blocked",
    ])
    .optional(),
  metadata: z.object({ createdAt: z.string().min(1), contentHash: z.string().min(1) }),
});
export type RegressionConfirmation = z.infer<typeof RegressionConfirmationSchema>;

// ---------------------------------------------------------------------------
// 37. Healing attempt limits (spec §37)
// ---------------------------------------------------------------------------

export const HealingLimitPolicySchema = z.object({
  maxProposalRevisions: z.number().int().positive().default(2),
  maxRemediationApplications: z.number().int().positive().default(2),
  maxDiagnosticReruns: z.number().int().positive().default(3),
  allowAutomaticRetry: z.boolean().default(false),
});
export type HealingLimitPolicy = z.infer<typeof HealingLimitPolicySchema>;

export const AttemptLimitStatusSchema = z.object({
  proposalRevisions: z.number().int().nonnegative().default(0),
  remediationApplications: z.number().int().nonnegative().default(0),
  diagnosticReruns: z.number().int().nonnegative().default(0),
  exhausted: z.boolean().default(false),
  reason: z.string().max(2000).optional(),
});
export type AttemptLimitStatus = z.infer<typeof AttemptLimitStatusSchema>;

// ---------------------------------------------------------------------------
// 47. Stale-state handling (spec §47)
// ---------------------------------------------------------------------------

export const StaleReasonSchema = z.object({
  code: z.string().min(1).max(100),
  detail: z.string().min(1).max(2000),
  detectedAt: z.string().min(1),
});
export type StaleReason = z.infer<typeof StaleReasonSchema>;

// ---------------------------------------------------------------------------
// 51. Error model (Phase 7 codes)
// ---------------------------------------------------------------------------

export const QaRemediationErrorCodeSchema = z.enum([
  "generation-scenario-unavailable",
  "no-test-pattern-found",
  "generation-context-blocked",
  "generation-delegation-failed",
  "generated-output-invalid",
  "generated-change-out-of-scope",
  "generated-test-failed",
  "insufficient-failure-evidence",
  "classification-ambiguous",
  "flaky-history-insufficient",
  "diagnostic-rerun-failed",
  "remediation-policy-blocked",
  "remediation-stale",
  "remediation-conflict",
  "patch-application-failed",
  "targeted-validation-failed",
  "regression-failed",
  "revert-conflict",
  "attempt-limit-reached",
  "internal-error",
]);
export type QaRemediationErrorCode = z.infer<typeof QaRemediationErrorCodeSchema>;

export const QaRemediationErrorSchema = z.object({
  code: QaRemediationErrorCodeSchema,
  message: z.string().min(1).max(2000),
  affectedRecord: z.string().max(500).optional(),
  recoverable: z.boolean(),
  suggestedAction: z.string().min(1).max(2000),
  technicalDetails: z.string().max(5000).optional(),
});
export type QaRemediationError = z.infer<typeof QaRemediationErrorSchema>;

// Convenience: a Phase 7 remediation error IS a QaError for the Phase 6 pipeline.
export const QaRemediationErrorAsQaErrorSchema = QaRemediationErrorSchema.extend({
  code: QaErrorCodeSchema,
});
