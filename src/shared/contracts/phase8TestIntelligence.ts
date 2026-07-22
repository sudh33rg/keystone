/**
 * Keystone Phase 8 — Test Generation, Failure Classification, Flaky-Test
 * Analysis, and Safe Healing.
 *
 * This module is the single source of truth for the bounded test-intelligence
 * model. It extends the Phase 7 QA stage only; every record links back to a
 * workflow, QA plan, impact analysis, coverage gap, or failed test. No security,
 * performance, PR-review, Git-automation, or Task-Handoff concepts live here.
 *
 * All string identifiers that are not externally supplied UUIDs use bounded
 * random/text identifiers. Time values are ISO-8601 strings. Hash values are
 * `sha256:` prefixed hex digests produced by the host.
 */

import { z } from "zod";

// ---------------------------------------------------------------------------
// Enumerations
// ---------------------------------------------------------------------------

export const TestLayerSchema = z.enum(["unit", "integration", "contract", "end-to-end"]);
export type TestLayer = z.infer<typeof TestLayerSchema>;

export const TestGenerationRequestStatusSchema = z.enum([
  "draft",
  "scenarios-ready",
  "awaiting-approval",
  "prompt-prepared",
  "handed-off",
  "proposal-received",
  "proposal-approved",
  "applied",
  "validated",
  "rejected",
  "stale",
  "failed",
]);
export type TestGenerationRequestStatus = z.infer<typeof TestGenerationRequestStatusSchema>;

export const TestScenarioTypeSchema = z.enum([
  "success",
  "error",
  "boundary",
  "regression",
  "contract",
  "integration",
]);
export type TestScenarioType = z.infer<typeof TestScenarioTypeSchema>;

export const TestScenarioImportanceSchema = z.enum(["required", "recommended", "optional"]);
export type TestScenarioImportance = z.infer<typeof TestScenarioImportanceSchema>;

export const ProposedFileChangeTypeSchema = z.enum(["create", "modify", "delete", "rename"]);
export type ProposedFileChangeType = z.infer<typeof ProposedFileChangeTypeSchema>;

export const FileChangeClassificationSchema = z.enum([
  "test",
  "fixture",
  "mock",
  "snapshot",
  "production",
  "configuration",
  "unknown",
]);
export type FileChangeClassification = z.infer<typeof FileChangeClassificationSchema>;

export const TestChangeProposalStatusSchema = z.enum([
  "received",
  "invalid",
  "blocked",
  "ready-for-review",
  "approved",
  "rejected",
  "applied",
  "reverted",
]);
export type TestChangeProposalStatus = z.infer<typeof TestChangeProposalStatusSchema>;

export const FailureCategorySchema = z.enum([
  "production-defect",
  "stale-expectation",
  "fixture-problem",
  "mock-problem",
  "environment-problem",
  "infrastructure-problem",
  "flaky-candidate",
  "timeout",
  "unknown",
]);
export type FailureCategory = z.infer<typeof FailureCategorySchema>;

export const FailureRecommendedActionSchema = z.enum([
  "return-to-development",
  "propose-test-remediation",
  "rerun",
  "collect-more-evidence",
  "fix-environment",
  "manual-investigation",
]);
export type FailureRecommendedAction = z.infer<typeof FailureRecommendedActionSchema>;

export const TestFailureAnalysisStatusSchema = z.enum([
  "analyzing",
  "ready-for-review",
  "accepted",
  "rejected",
  "stale",
]);
export type TestFailureAnalysisStatus = z.infer<typeof TestFailureAnalysisStatusSchema>;

export const FlakyRunResultSchema = z.enum([
  "passed",
  "failed",
  "timeout",
  "cancelled",
  "infrastructure-failed",
]);
export type FlakyRunResult = z.infer<typeof FlakyRunResultSchema>;

export const FlakyStateSchema = z.enum([
  "insufficient-evidence",
  "stable-pass",
  "stable-fail",
  "flaky-candidate",
  "probable-flaky",
  "confirmed-flaky",
  "environment-dependent",
  "order-dependent",
  "timing-sensitive",
]);
export type FlakyState = z.infer<typeof FlakyStateSchema>;

export const TestRemediationProposalStatusSchema = z.enum([
  "received",
  "blocked",
  "ready-for-review",
  "approved",
  "applied",
  "validated",
  "rejected",
  "reverted",
]);
export type TestRemediationProposalStatus = z.infer<typeof TestRemediationProposalStatusSchema>;

export const ValidationLevelSchema = z.enum([
  "exact-test",
  "related-file",
  "impacted-tests",
  "required-regression",
]);
export type ValidationLevel = z.infer<typeof ValidationLevelSchema>;

export const ValidationLevelStatusSchema = z.enum([
  "not-run",
  "running",
  "passed",
  "failed",
  "cancelled",
  "incomplete",
]);
export type ValidationLevelStatus = z.infer<typeof ValidationLevelStatusSchema>;

export const ValidationSourceSchema = z.enum(["test-generation", "test-remediation"]);
export type ValidationSource = z.infer<typeof ValidationSourceSchema>;

export const ValidationFinalStatusSchema = z.enum([
  "not-started",
  "validated",
  "failed",
  "incomplete",
]);
export type ValidationFinalStatus = z.infer<typeof ValidationFinalStatusSchema>;

export const PolicySeveritySchema = z.enum(["blocking", "warning", "info"]);
export type PolicySeverity = z.infer<typeof PolicySeveritySchema>;

// ---------------------------------------------------------------------------
// Test generation request
// ---------------------------------------------------------------------------

export const TestGenerationRequestTargetSchema = z.object({
  entityIds: z.array(z.string().min(1).max(500)).max(200),
  flowIds: z.array(z.string().min(1).max(500)).max(200),
  filePaths: z.array(z.string().min(1).max(2000)).max(200),
}).strict();
export type TestGenerationRequestTarget = z.infer<typeof TestGenerationRequestTargetSchema>;

export const TestGenerationRequestSchema = z.object({
  id: z.string().min(1).max(500),
  workflowId: z.string().uuid(),
  qaPlanId: z.string().min(1).max(500),
  impactAnalysisId: z.string().min(1).max(500),
  coverageGapId: z.string().min(1).max(500),
  target: TestGenerationRequestTargetSchema,
  testLayer: TestLayerSchema,
  status: TestGenerationRequestStatusSchema,
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
  staleReason: z.string().max(2000).optional(),
}).strict();
export type TestGenerationRequest = z.infer<typeof TestGenerationRequestSchema>;

// ---------------------------------------------------------------------------
// Scenarios
// ---------------------------------------------------------------------------

export const TestScenarioSchema = z.object({
  id: z.string().min(1).max(500),
  generationRequestId: z.string().min(1).max(500),
  title: z.string().min(1).max(500),
  behaviour: z.string().min(1).max(5000),
  type: TestScenarioTypeSchema,
  importance: TestScenarioImportanceSchema,
  setup: z.array(z.string().min(1).max(2000)).max(50),
  action: z.string().min(1).max(2000),
  expectedOutcome: z.array(z.string().min(1).max(2000)).max(50),
  evidenceIds: z.array(z.string().min(1).max(500)).max(100),
  selected: z.boolean(),
  removalReason: z.string().min(1).max(2000).optional(),
}).strict();
export type TestScenario = z.infer<typeof TestScenarioSchema>;

// ---------------------------------------------------------------------------
// Proposed file change
// ---------------------------------------------------------------------------

export const ProposedFileChangeSchema = z.object({
  id: z.string().min(1).max(500),
  proposalId: z.string().min(1).max(500),
  filePath: z.string().min(1).max(2000),
  changeType: ProposedFileChangeTypeSchema,
  originalContentHash: z.string().min(1).max(256).optional(),
  proposedContentHash: z.string().min(1).max(256).optional(),
  diff: z.string().max(500_000),
  classification: FileChangeClassificationSchema,
  selected: z.boolean(),
}).strict();
export type ProposedFileChange = z.infer<typeof ProposedFileChangeSchema>;

// ---------------------------------------------------------------------------
// Policy assessment
// ---------------------------------------------------------------------------

export const PolicyFindingSchema = z.object({
  id: z.string().min(1).max(500),
  rule: z.string().min(1).max(200),
  severity: PolicySeveritySchema,
  file: z.string().min(1).max(2000),
  affectedLines: z.array(z.string().max(100)).max(200),
  evidence: z.string().min(1).max(2000),
  recommendedAction: z.string().min(1).max(2000),
  changeId: z.string().min(1).max(500),
}).strict();
export type PolicyFinding = z.infer<typeof PolicyFindingSchema>;

export const PolicyAssessmentSchema = z.object({
  id: z.string().min(1).max(500),
  status: z.enum(["blocked", "needs-review", "allowed"]),
  findings: z.array(PolicyFindingSchema).max(500),
  createdAt: z.string().datetime(),
}).strict();
export type PolicyAssessment = z.infer<typeof PolicyAssessmentSchema>;

// ---------------------------------------------------------------------------
// Test change proposal (generation)
// ---------------------------------------------------------------------------

export const ScenarioMappingSchema = z.object({
  scenarioId: z.string().min(1).max(500),
  proposedFilePaths: z.array(z.string().min(1).max(2000)).max(100),
}).strict();
export type ScenarioMapping = z.infer<typeof ScenarioMappingSchema>;

export const TestChangeProposalSchema = z.object({
  id: z.string().min(1).max(500),
  generationRequestId: z.string().min(1).max(500),
  contextPackageId: z.string().uuid(),
  summary: z.string().min(1).max(10_000),
  scenarioMappings: z.array(ScenarioMappingSchema).max(200),
  fileChanges: z.array(ProposedFileChangeSchema).max(200),
  assumptions: z.array(z.string().min(1).max(2000)).max(100),
  testsToRun: z.array(z.string().min(1).max(2000)).max(100),
  unresolvedIssues: z.array(z.string().min(1).max(2000)).max(100),
  policyAssessmentId: z.string().min(1).max(500),
  status: TestChangeProposalStatusSchema,
  receivedAt: z.string().datetime(),
}).strict();
export type TestChangeProposal = z.infer<typeof TestChangeProposalSchema>;

// ---------------------------------------------------------------------------
// Failure analysis
// ---------------------------------------------------------------------------

export const FailureAlternativeCategorySchema = z.object({
  category: z.string().min(1).max(100),
  confidence: z.number().min(0).max(1),
  evidenceIds: z.array(z.string().min(1).max(500)).max(100),
}).strict();
export type FailureAlternativeCategory = z.infer<typeof FailureAlternativeCategorySchema>;

export const TestFailureAnalysisSchema = z.object({
  id: z.string().min(1).max(500),
  workflowId: z.string().uuid(),
  qaExecutionId: z.string().min(1).max(500),
  testFailureId: z.string().min(1).max(500),
  failureSignature: z.string().min(1).max(256),
  category: FailureCategorySchema,
  confidence: z.number().min(0).max(1),
  evidenceIds: z.array(z.string().min(1).max(500)).max(100),
  alternativeCategories: z.array(FailureAlternativeCategorySchema).max(20),
  recommendedAction: FailureRecommendedActionSchema,
  status: TestFailureAnalysisStatusSchema,
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
  staleReason: z.string().max(2000).optional(),
}).strict();
export type TestFailureAnalysis = z.infer<typeof TestFailureAnalysisSchema>;

export const TestFailureRecordSchema = z.object({
  id: z.string().min(1).max(500),
  workflowId: z.string().uuid(),
  qaExecutionId: z.string().min(1).max(500),
  testName: z.string().min(1).max(2000),
  testFilePath: z.string().min(1).max(2000),
  message: z.string().max(10_000),
  stackFrames: z.array(z.string().min(1).max(2000)).max(200),
  normalizedMessage: z.string().max(10_000),
  exceptionType: z.string().max(200).optional(),
  assertionLocation: z.string().max(2000).optional(),
  failureSignature: z.string().min(1).max(256),
}).strict();
export type TestFailureRecord = z.infer<typeof TestFailureRecordSchema>;

// ---------------------------------------------------------------------------
// Flaky run history
// ---------------------------------------------------------------------------

export const FlakyTestRunSchema = z.object({
  id: z.string().min(1).max(500),
  workflowId: z.string().uuid(),
  testId: z.string().min(1).max(500),
  revision: z.string().min(1).max(200),
  environmentFingerprint: z.string().min(1).max(256),
  result: FlakyRunResultSchema,
  durationMs: z.number().int().nonnegative().optional(),
  failureSignature: z.string().min(1).max(256).optional(),
  seed: z.string().max(200).optional(),
  orderIndex: z.number().int().nonnegative().optional(),
  executedAt: z.string().datetime(),
}).strict();
export type FlakyTestRun = z.infer<typeof FlakyTestRunSchema>;

export const FlakyClassificationSchema = z.object({
  testId: z.string().min(1).max(500),
  workflowId: z.string().uuid(),
  state: FlakyStateSchema,
  confidence: z.number().min(0).max(1),
  passes: z.number().int().nonnegative(),
  failures: z.number().int().nonnegative(),
  timeouts: z.number().int().nonnegative(),
  infrastructureFailures: z.number().int().nonnegative(),
  runCount: z.number().int().nonnegative(),
  signatures: z.array(z.string().min(1).max(256)).max(100),
  revision: z.string().min(1).max(200),
  environmentFingerprint: z.string().min(1).max(256),
  evidenceRequiredForStronger: z.string().max(2000),
  updatedAt: z.string().datetime(),
}).strict();
export type FlakyClassification = z.infer<typeof FlakyClassificationSchema>;

// ---------------------------------------------------------------------------
// Remediation proposal
// ---------------------------------------------------------------------------

export const RemediationExpectedValidationSchema = z.object({
  exactTest: z.boolean(),
  relatedFile: z.boolean(),
  impactedTests: z.boolean(),
  requiredRegression: z.boolean(),
}).strict();
export type RemediationExpectedValidation = z.infer<typeof RemediationExpectedValidationSchema>;

export const TestRemediationProposalSchema = z.object({
  id: z.string().min(1).max(500),
  failureAnalysisId: z.string().min(1).max(500),
  diagnosis: z.string().min(1).max(10_000),
  intendedCorrection: z.string().min(1).max(10_000),
  fileChanges: z.array(ProposedFileChangeSchema).max(200),
  expectedValidation: RemediationExpectedValidationSchema,
  policyAssessmentId: z.string().min(1).max(500),
  status: TestRemediationProposalStatusSchema,
  receivedAt: z.string().datetime(),
}).strict();
export type TestRemediationProposal = z.infer<typeof TestRemediationProposalSchema>;

// ---------------------------------------------------------------------------
// Validation sequence
// ---------------------------------------------------------------------------

export const ValidationLevelResultSchema = z.object({
  level: ValidationLevelSchema,
  executionId: z.string().min(1).max(500).optional(),
  status: ValidationLevelStatusSchema,
}).strict();
export type ValidationLevelResult = z.infer<typeof ValidationLevelResultSchema>;

export const TestChangeValidationSchema = z.object({
  id: z.string().min(1).max(500),
  workflowId: z.string().uuid(),
  source: ValidationSourceSchema,
  sourceRecordId: z.string().min(1).max(500),
  levels: z.array(ValidationLevelResultSchema).max(10),
  finalStatus: ValidationFinalStatusSchema,
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
}).strict();
export type TestChangeValidation = z.infer<typeof TestChangeValidationSchema>;

// ---------------------------------------------------------------------------
// Applied change record (for safe application / revert)
// ---------------------------------------------------------------------------

export const AppliedTestChangeSchema = z.object({
  id: z.string().min(1).max(500),
  workflowId: z.string().uuid(),
  source: ValidationSourceSchema,
  sourceRecordId: z.string().min(1).max(500),
  filePath: z.string().min(1).max(2000),
  changeType: ProposedFileChangeTypeSchema,
  baselineHash: z.string().min(1).max(256),
  appliedHash: z.string().min(1).max(256),
  inverseContent: z.string().max(5_000_000),
  appliedAt: z.string().datetime(),
  revertedAt: z.string().datetime().optional(),
}).strict();
export type AppliedTestChange = z.infer<typeof AppliedTestChangeSchema>;

// ---------------------------------------------------------------------------
// Context package reference + structured proposal ingest
// ---------------------------------------------------------------------------

export const StructuredProposalIngestSchema = z.object({
  summary: z.string().min(1).max(10_000),
  scenarioMappings: z.array(ScenarioMappingSchema).max(200),
  fileChanges: z.array(ProposedFileChangeSchema).max(200),
  assumptions: z.array(z.string().min(1).max(2000)).max(100),
  testsToRun: z.array(z.string().min(1).max(2000)).max(100),
  unresolvedIssues: z.array(z.string().min(1).max(2000)).max(100),
}).strict();
export type StructuredProposalIngest = z.infer<typeof StructuredProposalIngestSchema>;

// ---------------------------------------------------------------------------
// Aggregate shipped to the QA stage UI
// ---------------------------------------------------------------------------

export const QaTestIntelligenceAggregateSchema = z.object({
  workflowId: z.string().uuid(),
  generationRequests: z.array(TestGenerationRequestSchema).max(100),
  scenarios: z.array(TestScenarioSchema).max(500),
  generationProposals: z.array(TestChangeProposalSchema).max(100),
  failureAnalyses: z.array(TestFailureAnalysisSchema).max(100),
  failureRecords: z.array(TestFailureRecordSchema).max(200),
  flakyRuns: z.array(FlakyTestRunSchema).max(500),
  flakyClassifications: z.array(FlakyClassificationSchema).max(100),
  remediationProposals: z.array(TestRemediationProposalSchema).max(100),
  policyAssessments: z.array(PolicyAssessmentSchema).max(200),
  validations: z.array(TestChangeValidationSchema).max(100),
  appliedChanges: z.array(AppliedTestChangeSchema).max(200),
  updatedAt: z.string().datetime(),
}).strict();
export type QaTestIntelligenceAggregate = z.infer<typeof QaTestIntelligenceAggregateSchema>;

// ---------------------------------------------------------------------------
// Typed protocol payloads (section 33)
// ---------------------------------------------------------------------------

export const TEST_INTELLIGENCE_REQUESTS = {
  "testIntelligence.load": z.object({
    correlationId: z.string().min(1).max(200),
    workflowId: z.string().uuid(),
  }).strict(),
  "testIntelligence.createGenerationRequest": z.object({
    correlationId: z.string().min(1).max(200),
    workflowId: z.string().uuid(),
    coverageGapId: z.string().min(1).max(500),
  }).strict(),
  "testIntelligence.deriveScenarios": z.object({
    correlationId: z.string().min(1).max(200),
    workflowId: z.string().uuid(),
    generationRequestId: z.string().min(1).max(500),
  }).strict(),
  "testIntelligence.updateScenario": z.object({
    correlationId: z.string().min(1).max(200),
    workflowId: z.string().uuid(),
    scenarioId: z.string().min(1).max(500),
    title: z.string().min(1).max(500).optional(),
    behaviour: z.string().min(1).max(5000).optional(),
    selected: z.boolean().optional(),
    removalReason: z.string().min(1).max(2000).optional(),
  }).strict(),
  "testIntelligence.approveScenarios": z.object({
    correlationId: z.string().min(1).max(200),
    workflowId: z.string().uuid(),
    generationRequestId: z.string().min(1).max(500),
  }).strict(),
  "testIntelligence.buildGenerationContext": z.object({
    correlationId: z.string().min(1).max(200),
    workflowId: z.string().uuid(),
    generationRequestId: z.string().min(1).max(500),
    budgetTokens: z.number().int().min(500).max(1_000_000),
  }).strict(),
  "testIntelligence.approveGenerationContext": z.object({
    correlationId: z.string().min(1).max(200),
    workflowId: z.string().uuid(),
    generationRequestId: z.string().min(1).max(500),
    packageId: z.string().uuid(),
    revision: z.number().int().positive(),
    fingerprint: z.string().regex(/^[a-f0-9]{64}$/),
  }).strict(),
  "testIntelligence.recordProposal": z.object({
    correlationId: z.string().min(1).max(200),
    workflowId: z.string().uuid(),
    generationRequestId: z.string().min(1).max(500),
    proposal: StructuredProposalIngestSchema,
  }).strict(),
  "testIntelligence.validateProposalPolicy": z.object({
    correlationId: z.string().min(1).max(200),
    workflowId: z.string().uuid(),
    proposalId: z.string().min(1).max(500),
  }).strict(),
  "testIntelligence.applyProposal": z.object({
    correlationId: z.string().min(1).max(200),
    workflowId: z.string().uuid(),
    proposalId: z.string().min(1).max(500),
    selectedChangeIds: z.array(z.string().min(1).max(500)).max(200),
  }).strict(),
  "testIntelligence.revertApplied": z.object({
    correlationId: z.string().min(1).max(200),
    workflowId: z.string().uuid(),
    appliedChangeId: z.string().min(1).max(500),
  }).strict(),
  "testIntelligence.createFailureAnalysis": z.object({
    correlationId: z.string().min(1).max(200),
    workflowId: z.string().uuid(),
    testFailureId: z.string().min(1).max(500),
    testFilePath: z.string().min(1).max(2000).optional(),
    testName: z.string().min(1).max(2000).optional(),
    message: z.string().max(10_000).optional(),
    normalizedMessage: z.string().max(10_000).optional(),
    exceptionType: z.string().max(200).optional(),
    stackFrames: z.array(z.string().min(1).max(2000)).max(200).optional(),
  }).strict(),
  "testIntelligence.acceptFailureClassification": z.object({
    correlationId: z.string().min(1).max(200),
    workflowId: z.string().uuid(),
    analysisId: z.string().min(1).max(500),
    category: FailureCategorySchema,
  }).strict(),
  "testIntelligence.requestRepeatedRuns": z.object({
    correlationId: z.string().min(1).max(200),
    workflowId: z.string().uuid(),
    testId: z.string().min(1).max(500),
    count: z.number().int().min(1).max(20),
    mode: z.enum(["default", "seed", "isolation", "related-file", "suite-order"]).default("default"),
    seed: z.string().max(200).optional(),
  }).strict(),
  "testIntelligence.loadFlakyHistory": z.object({
    correlationId: z.string().min(1).max(200),
    workflowId: z.string().uuid(),
    testId: z.string().min(1).max(500),
  }).strict(),
  "testIntelligence.createRemediationProposal": z.object({
    correlationId: z.string().min(1).max(200),
    workflowId: z.string().uuid(),
    analysisId: z.string().min(1).max(500),
    proposal: StructuredProposalIngestSchema,
  }).strict(),
  "testIntelligence.validateRemediationPolicy": z.object({
    correlationId: z.string().min(1).max(200),
    workflowId: z.string().uuid(),
    proposalId: z.string().min(1).max(500),
  }).strict(),
  "testIntelligence.applyRemediation": z.object({
    correlationId: z.string().min(1).max(200),
    workflowId: z.string().uuid(),
    proposalId: z.string().min(1).max(500),
    selectedChangeIds: z.array(z.string().min(1).max(500)).max(200),
  }).strict(),
  "testIntelligence.runValidationSequence": z.object({
    correlationId: z.string().min(1).max(200),
    workflowId: z.string().uuid(),
    source: ValidationSourceSchema,
    sourceRecordId: z.string().min(1).max(500),
  }).strict(),
  "testIntelligence.loadValidationState": z.object({
    correlationId: z.string().min(1).max(200),
    workflowId: z.string().uuid(),
    source: ValidationSourceSchema,
    sourceRecordId: z.string().min(1).max(500),
  }).strict(),
  "testIntelligence.refreshQaDecision": z.object({
    correlationId: z.string().min(1).max(200),
    workflowId: z.string().uuid(),
  }).strict(),
} as const;

export type TestIntelligenceRequestType = keyof typeof TEST_INTELLIGENCE_REQUESTS;

// ---------------------------------------------------------------------------
// Structured error codes (section 34)
// ---------------------------------------------------------------------------

export const PHASE8_ERROR_CODES = [
  "coverage-gap-not-found",
  "generation-request-duplicate",
  "scenario-evidence-insufficient",
  "test-framework-unsupported",
  "generation-context-incomplete",
  "proposal-invalid",
  "proposal-path-outside-workspace",
  "proposal-source-conflict",
  "policy-test-deletion",
  "policy-test-skip",
  "policy-assertion-weakening",
  "policy-timeout-increase",
  "policy-arbitrary-wait",
  "policy-unbounded-retry",
  "policy-production-change",
  "failure-not-found",
  "failure-analysis-inconclusive",
  "flaky-evidence-insufficient",
  "repeated-run-not-supported",
  "remediation-not-allowed",
  "validation-failed",
  "revert-conflict",
  "record-stale",
  "persistence-failed",
  "internal-error",
] as const;

export type Phase8ErrorCode = (typeof PHASE8_ERROR_CODES)[number];

export class TestIntelligenceError extends Error {
  constructor(
    public readonly code: Phase8ErrorCode,
    message: string,
    public readonly blocking: boolean,
    public readonly safeNextAction: string,
  ) {
    super(message);
    this.name = "TestIntelligenceError";
  }
}
