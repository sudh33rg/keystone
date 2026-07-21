/**
 * Phase 6 — Canonical QaLifecycle model (spec §4, §5, §6, §7, §9, §10, §12, §13, §14,
 * §16, §17, §18, §19, §20, §23, §26, §28, §29, §31, §32, §33, §34, §44, §46, §51).
 *
 * Deterministic, LLM-free. Reuses IntelligenceSnapshot (Phase 1) as the source of truth.
 * No runtime coverage is fabricated: coverage is either present (adapter) or explicitly
 * "unverified" / "unmapped".
 */
import { z } from "zod";

// ---------------------------------------------------------------------------
// Change set (spec §5, §6, §7)
// ---------------------------------------------------------------------------

export const ChangeSourceSchema = z.enum([
  "working-tree",
  "staged",
  "base-comparison",
  "delegation-result",
  "planned-scope",
  "manual",
]);
export type ChangeSource = z.infer<typeof ChangeSourceSchema>;

export const ChangeTypeSchema = z.enum([
  "added",
  "modified",
  "deleted",
  "renamed",
  "copied",
  "untracked",
  "planned",
]);
export type ChangeType = z.infer<typeof ChangeTypeSchema>;

export const FileClassificationSchema = z.enum([
  "production",
  "test",
  "configuration",
  "documentation",
  "generated",
  "unknown",
]);
export type FileClassification = z.infer<typeof FileClassificationSchema>;

export const ChangedFileSchema = z.object({
  path: z.string().min(1).max(2000),
  oldPath: z.string().max(2000).optional(),
  changeType: ChangeTypeSchema,
  classification: FileClassificationSchema,
  addedLines: z.number().int().nonnegative().default(0),
  removedLines: z.number().int().nonnegative().default(0),
  modifiedRanges: z
    .array(z.object({ start: z.number().int().nonnegative(), end: z.number().int().nonnegative() }))
    .default([]),
  parserSupported: z.boolean().default(false),
  intelligenceAvailable: z.boolean().default(false),
  changedSymbolIds: z.array(z.string().min(1)).max(2000).default([]),
  unresolvedRangeWarnings: z.array(z.string()).default([]),
});
export type ChangedFile = z.infer<typeof ChangedFileSchema>;

export const ChangedSymbolSchema = z.object({
  symbolId: z.string().min(1).max(500),
  filePath: z.string().min(1).max(2000),
  kind: z.string().min(1).max(100),
  changeType: ChangeTypeSchema,
  changedRange: z
    .object({ start: z.number().int().nonnegative(), end: z.number().int().nonnegative() })
    .optional(),
  isPublicContract: z.boolean().default(false),
  isEntryPoint: z.boolean().default(false),
  isPersistence: z.boolean().default(false),
  isTest: z.boolean().default(false),
  confidence: z.number().min(0).max(1),
  evidence: z
    .array(
      z.object({ id: z.string().min(1), kind: z.string().min(1), statement: z.string().min(1) }),
    )
    .max(100)
    .default([]),
});
export type ChangedSymbol = z.infer<typeof ChangedSymbolSchema>;

export const ChangeSetSchema = z.object({
  id: z.string().min(1).max(500),
  workflowId: z.string().max(500).optional(),
  source: ChangeSourceSchema,
  files: z.array(ChangedFileSchema).max(5000).default([]),
  symbols: z.array(ChangedSymbolSchema).max(20000).default([]),
  revision: z
    .object({
      base: z.string().max(500).optional(),
      head: z.string().max(500).optional(),
      workspaceSnapshot: z.string().max(500).optional(),
    })
    .default({}),
  metadata: z.object({
    createdAt: z.string().min(1),
    contentHash: z.string().min(1),
    partial: z.boolean().default(false),
    warnings: z.array(z.string()).default([]),
  }),
});
export type ChangeSet = z.infer<typeof ChangeSetSchema>;

// ---------------------------------------------------------------------------
// Impact analysis (spec §9, §10, §12, §13, §14)
// ---------------------------------------------------------------------------

export const ImpactCategorySchema = z.enum([
  "changed-directly",
  "direct-caller",
  "direct-callee",
  "direct-dependent",
  "direct-dependency",
  "transitive-caller",
  "transitive-dependent",
  "contract-consumer",
  "interface-implementation",
  "inherited-consumer",
  "data-reader",
  "data-writer",
  "event-publisher",
  "event-subscriber",
  "configuration-consumer",
  "flow-participant",
  "test-mapping",
  "fixture-dependency",
  "external-boundary",
  "unresolved-possible-impact",
]);
export type ImpactCategory = z.infer<typeof ImpactCategorySchema>;

export const ImpactRootSchema = z.object({
  entityId: z.string().min(1).max(500),
  displayName: z.string().min(1).max(500),
  kind: z.string().min(1).max(100),
  filePath: z.string().max(2000).optional(),
  changeType: ChangeTypeSchema,
  planned: z.boolean().default(false),
});
export type ImpactRoot = z.infer<typeof ImpactRootSchema>;

export const ImpactedEntitySchema = z.object({
  entityId: z.string().min(1).max(500),
  displayName: z.string().min(1).max(500),
  kind: z.string().min(1).max(100),
  filePath: z.string().max(2000).optional(),
  category: ImpactCategorySchema,
  distance: z.number().int().nonnegative(),
  relationshipPath: z.array(z.string().min(1)).max(200),
  confidence: z.number().min(0).max(1),
  productionTestClassification: z.enum(["production", "test", "unknown"]),
  evidence: z
    .array(
      z.object({ id: z.string().min(1), kind: z.string().min(1), statement: z.string().min(1) }),
    )
    .max(200)
    .default([]),
  affectedFlowIds: z.array(z.string().min(1)).max(200).default([]),
  mappedTestIds: z.array(z.string().min(1)).max(2000).default([]),
  riskContribution: z.number().min(0).max(1).default(0),
  isPublicContract: z.boolean().default(false),
  contractChangeType: z
    .enum([
      "added",
      "removed",
      "signature-change",
      "type-change",
      "required-field-change",
      "response-shape-change",
      "event-payload-change",
      "persistence-schema-change",
    ])
    .optional(),
});
export type ImpactedEntity = z.infer<typeof ImpactedEntitySchema>;

export const ImpactPathSchema = z.object({
  id: z.string().min(1).max(500),
  fromRootId: z.string().min(1).max(500),
  toEntityId: z.string().min(1).max(500),
  edges: z.array(z.string().min(1)).max(500),
  relationshipTypes: z.array(z.string().min(1)).max(50),
  confidence: z.number().min(0).max(1),
});
export type ImpactPath = z.infer<typeof ImpactPathSchema>;

export const ImpactedFlowSchema = z.object({
  id: z.string().min(1).max(500),
  name: z.string().min(1).max(500),
  entry: z.string().min(1).max(500).optional(),
  changedStepEntityIds: z.array(z.string().min(1)).max(2000).default([]),
  indirectlyImpactedStepEntityIds: z.array(z.string().min(1)).max(2000).default([]),
  sideEffects: z.array(z.string().min(1)).max(200).default([]),
  relatedTestIds: z.array(z.string().min(1)).max(2000).default([]),
  confidence: z.number().min(0).max(1),
  evidence: z
    .array(
      z.object({ id: z.string().min(1), kind: z.string().min(1), statement: z.string().min(1) }),
    )
    .max(100)
    .default([]),
  riskCategory: z.enum(["low", "medium", "high", "critical"]).default("low"),
});
export type ImpactedFlow = z.infer<typeof ImpactedFlowSchema>;

export const ImpactedTestReferenceSchema = z.object({
  testId: z.string().min(1).max(500),
  displayName: z.string().min(1).max(500),
  mappedEntityIds: z.array(z.string().min(1)).max(2000).default([]),
  ranking: z.enum([
    "required",
    "strongly-recommended",
    "supporting",
    "regression",
    "optional",
    "unresolved-candidate",
  ]),
  confidence: z.number().min(0).max(1),
  reason: z.string().min(1).max(2000),
});
export type ImpactedTestReference = z.infer<typeof ImpactedTestReferenceSchema>;

export const CoverageGapSchema = z.object({
  id: z.string().min(1).max(500),
  affectedEntityId: z.string().min(1).max(500).optional(),
  affectedFlowId: z.string().min(1).max(500).optional(),
  gapType: z.enum([
    "changed-symbol-no-test",
    "public-contract-no-test",
    "impacted-branch-no-test",
    "affected-flow-no-integration-test",
    "persistence-change-no-data-test",
    "event-change-no-pubsub-test",
    "configuration-change-no-validation-test",
    "deleted-behaviour-stale-test",
    "low-confidence-mapping",
    "runtime-coverage-unavailable",
    "test-framework-unsupported",
  ]),
  risk: z.enum(["low", "medium", "high", "critical"]),
  evidence: z
    .array(
      z.object({ id: z.string().min(1), kind: z.string().min(1), statement: z.string().min(1) }),
    )
    .max(100)
    .default([]),
  recommendedTestLayer: z.enum([
    "static",
    "unit",
    "component",
    "integration",
    "contract",
    "e2e",
    "security",
    "performance",
    "full-regression",
  ]),
  proposedScenarioSummary: z.string().min(1).max(2000),
  testGenerationRecommended: z.boolean().default(false),
  verificationStatus: z.enum(["unmapped", "unverified", "verified"]).default("unmapped"),
});
export type CoverageGap = z.infer<typeof CoverageGapSchema>;

export const RiskFactorSchema = z.object({
  id: z.string().min(1).max(200),
  description: z.string().min(1).max(1000),
  weight: z.number().min(0).max(1),
  contribution: z.number().min(0).max(1),
});
export type RiskFactor = z.infer<typeof RiskFactorSchema>;

export const ImpactWarningSchema = z.object({
  code: z.string().min(1).max(100),
  message: z.string().min(1).max(1000),
  severity: z.enum(["info", "warning", "error"]).default("warning"),
  omitted: z.string().min(1).max(2000).default(""),
  refineHint: z.string().min(1).max(1000).default(""),
});
export type ImpactWarning = z.infer<typeof ImpactWarningSchema>;

export const ImpactAnalysisSchema = z.object({
  id: z.string().min(1).max(500),
  workflowId: z.string().max(500).optional(),
  changeSetId: z.string().min(1).max(500),
  roots: z.array(ImpactRootSchema).max(5000).default([]),
  entities: z.array(ImpactedEntitySchema).max(50000).default([]),
  paths: z.array(ImpactPathSchema).max(50000).default([]),
  flows: z.array(ImpactedFlowSchema).max(5000).default([]),
  tests: z.array(ImpactedTestReferenceSchema).max(50000).default([]),
  gaps: z.array(CoverageGapSchema).max(5000).default([]),
  risk: z.object({
    overallLevel: z.enum(["low", "medium", "high", "critical"]),
    score: z.number().min(0).max(1),
    factors: z.array(RiskFactorSchema).max(100).default([]),
  }),
  limits: z.object({
    traversalDepth: z.number().int().positive(),
    maximumEntities: z.number().int().positive(),
    truncated: z.boolean().default(false),
  }),
  warnings: z.array(ImpactWarningSchema).max(200).default([]),
  metadata: z.object({
    intelligenceRevision: z.string().min(1),
    generatedAt: z.string().min(1),
    contentHash: z.string().min(1),
    status: z.enum(["complete", "partial", "blocked", "stale"]),
  }),
});
export type ImpactAnalysis = z.infer<typeof ImpactAnalysisSchema>;

// ---------------------------------------------------------------------------
// Test plan (spec §20, §23, §26)
// ---------------------------------------------------------------------------

export const TestLayerSchema = z.enum([
  "static",
  "unit",
  "component",
  "integration",
  "contract",
  "e2e",
  "security",
  "performance",
  "full-regression",
]);
export type TestLayer = z.infer<typeof TestLayerSchema>;

export const TestSelectionSchema = z.object({
  testId: z.string().min(1).max(500),
  displayName: z.string().min(1).max(500),
  layer: TestLayerSchema,
  commandId: z.string().min(1).max(500),
  ranking: z.enum([
    "required",
    "strongly-recommended",
    "supporting",
    "regression",
    "optional",
    "unresolved-candidate",
  ]),
  pinned: z.boolean().default(false),
  userAdded: z.boolean().default(false),
  userRemoved: z.boolean().default(false),
  overrideReason: z.string().max(2000).optional(),
  reason: z.string().min(1).max(2000),
  estimatedCost: z.enum(["low", "medium", "high"]).default("low"),
});
export type TestSelection = z.infer<typeof TestSelectionSchema>;

export const TestGenerationRequestSchema = z.object({
  id: z.string().min(1).max(500),
  acceptanceCriterion: z.string().max(2000).optional(),
  targetProductionEntityIds: z.array(z.string().min(1)).max(2000).default([]),
  affectedFlowId: z.string().max(500).optional(),
  missingTestLayer: TestLayerSchema,
  proposedScenario: z.string().min(1).max(2000),
  expectedBehaviour: z.string().min(1).max(2000),
  recommendedFramework: z.string().max(200).optional(),
  exampleTestReferences: z.array(z.string().max(500)).max(50).default([]),
  priority: z.enum(["low", "medium", "high", "critical"]),
  risk: z.enum(["low", "medium", "high", "critical"]),
  contextRequirements: z.array(z.string().max(500)).max(50).default([]),
  status: z
    .enum(["proposed", "approved", "delegated", "generated", "rejected", "superseded", "blocked"])
    .default("proposed"),
});
export type TestGenerationRequest = z.infer<typeof TestGenerationRequestSchema>;

export const PlannedTestCommandSchema = z.object({
  commandId: z.string().min(1).max(500),
  displayName: z.string().min(1).max(500),
  template: z.string().min(1).max(2000),
  workingDirectory: z.string().max(2000).optional(),
  layer: TestLayerSchema,
  scope: z.string().min(1).max(2000),
  broaderThanSelection: z.boolean().default(false),
  estimatedDurationSeconds: z.number().int().nonnegative().optional(),
});
export type PlannedTestCommand = z.infer<typeof PlannedTestCommandSchema>;

export const TestPlanSchema = z.object({
  id: z.string().min(1).max(500),
  workflowId: z.string().max(500).optional(),
  impactAnalysisId: z.string().min(1).max(500),
  objectives: z.array(z.string().min(1).max(1000)).max(50).default([]),
  selections: z.array(TestSelectionSchema).max(50000).default([]),
  generationRequests: z.array(TestGenerationRequestSchema).max(5000).default([]),
  commands: z.array(PlannedTestCommandSchema).max(5000).default([]),
  coverageGaps: z.array(CoverageGapSchema).max(5000).default([]),
  gates: z.object({
    requiredSelectionsPassed: z.boolean().default(true),
    allowPartialExecution: z.boolean().default(false),
    blockingGapSeverities: z.array(z.string().max(50)).max(20).default([]),
    requireUserApproval: z.boolean().default(false),
  }),
  budget: z.object({
    estimatedDurationSeconds: z.number().int().nonnegative().optional(),
    maximumDurationSeconds: z.number().int().nonnegative().optional(),
    executionMode: z.enum(["targeted", "layered", "full-regression"]),
  }),
  status: z.enum([
    "draft",
    "ready",
    "awaiting-approval",
    "approved",
    "executing",
    "completed",
    "blocked",
    "stale",
  ]),
  metadata: z.object({
    createdAt: z.string().min(1),
    updatedAt: z.string().min(1),
    contentHash: z.string().min(1),
  }),
});
export type TestPlan = z.infer<typeof TestPlanSchema>;

// ---------------------------------------------------------------------------
// Test execution (spec §26, §28, §29, §30, §31, §42, §43)
// ---------------------------------------------------------------------------

export const TestCommandRunStatusSchema = z.enum([
  "queued",
  "running",
  "passed",
  "failed",
  "skipped",
  "cancelled",
  "timed-out",
  "blocked",
]);
export type TestCommandRunStatus = z.infer<typeof TestCommandRunStatusSchema>;

export const TestCommandRunSchema = z.object({
  id: z.string().min(1).max(500),
  commandId: z.string().min(1).max(500),
  displayName: z.string().min(1).max(500),
  template: z.string().min(1).max(2000),
  workingDirectory: z.string().max(2000).optional(),
  layer: TestLayerSchema,
  status: TestCommandRunStatusSchema,
  exitCode: z.number().int().optional(),
  startedAt: z.string().optional(),
  completedAt: z.string().optional(),
  rawOutputRef: z.string().max(2000).optional(),
});
export type TestCommandRun = z.infer<typeof TestCommandRunSchema>;

export const TestExecutionRunSchema = z.object({
  id: z.string().min(1).max(500),
  workflowId: z.string().max(500).optional(),
  testPlanId: z.string().min(1).max(500),
  commands: z.array(TestCommandRunSchema).max(20000).default([]),
  summary: z.object({
    totalCommands: z.number().int().nonnegative(),
    passedCommands: z.number().int().nonnegative(),
    failedCommands: z.number().int().nonnegative(),
    cancelledCommands: z.number().int().nonnegative(),
    testCases: z.number().int().nonnegative().optional(),
    passedTests: z.number().int().nonnegative().optional(),
    failedTests: z.number().int().nonnegative().optional(),
    skippedTests: z.number().int().nonnegative().optional(),
    durationMs: z.number().int().nonnegative(),
  }),
  status: z.enum([
    "queued",
    "awaiting-approval",
    "running",
    "passed",
    "failed",
    "partial",
    "cancelled",
    "timed-out",
    "blocked",
  ]),
  metadata: z.object({
    startedAt: z.string().optional(),
    completedAt: z.string().optional(),
    environmentFingerprint: z.string().max(500).optional(),
    contentHash: z.string().min(1),
  }),
});
export type TestExecutionRun = z.infer<typeof TestExecutionRunSchema>;

export const ParsedTestResultStatusSchema = z.enum([
  "passed",
  "failed",
  "skipped",
  "pending",
  "cancelled",
  "timed-out",
  "unknown",
]);
export type ParsedTestResultStatus = z.infer<typeof ParsedTestResultStatusSchema>;

export const ParsedTestResultSchema = z.object({
  parserId: z.string().min(1).max(200),
  suite: z.string().max(500).optional(),
  testFile: z.string().max(2000).optional(),
  testCase: z.string().max(500).optional(),
  status: ParsedTestResultStatusSchema,
  durationMs: z.number().int().nonnegative().optional(),
  errorMessage: z.string().max(5000).optional(),
  stackTrace: z.string().max(20000).optional(),
  expectedValue: z.string().max(5000).optional(),
  actualValue: z.string().max(5000).optional(),
  retryNumber: z.number().int().nonnegative().default(0),
  relatedChangedEntityIds: z.array(z.string().min(1)).max(2000).default([]),
  relatedAcceptanceCriteria: z.array(z.string().max(2000)).max(50).default([]),
  parserConfidence: z.enum(["command-level", "test-case-level"]).default("command-level"),
  rawOutputRef: z.string().max(2000).optional(),
});
export type ParsedTestResult = z.infer<typeof ParsedTestResultSchema>;

export const FailureGroupSchema = z.object({
  id: z.string().min(1).max(500),
  failureIds: z.array(z.string().min(1)).max(5000).default([]),
  commonEvidence: z.array(z.string()).max(500).default([]),
  likelyAffectedScope: z.string().min(1).max(2000),
  confidence: z.number().min(0).max(1),
  suggestedNextAction: z.string().min(1).max(2000),
  classificationCategories: z
    .array(
      z.enum([
        "product-defect",
        "incorrect-expectation",
        "stale-test",
        "flaky-behaviour",
        "test-data-problem",
        "environment-issue",
        "infrastructure-issue",
        "unsupported-or-unknown",
      ]),
    )
    .max(20)
    .default([]),
});
export type FailureGroup = z.infer<typeof FailureGroupSchema>;

// ---------------------------------------------------------------------------
// Failure-analysis handoff (spec §32) and QA gates/decision (§33, §34)
// ---------------------------------------------------------------------------

export const FailureAnalysisRequestSchema = z.object({
  id: z.string().min(1).max(500),
  qaCycleId: z.string().min(1).max(500),
  executionRunId: z.string().min(1).max(500),
  failureIds: z.array(z.string().min(1)).max(5000).default([]),
  failedCommandIds: z.array(z.string().min(1)).max(500).default([]),
  stackTraces: z.array(z.string().max(20000)).max(500).default([]),
  changedEntityIds: z.array(z.string().min(1)).max(2000).default([]),
  impactedFlowIds: z.array(z.string().min(1)).max(500).default([]),
  relatedTestIds: z.array(z.string().min(1)).max(2000).default([]),
  acceptanceCriteria: z.array(z.string().max(2000)).max(50).default([]),
  relevantFixtureIds: z.array(z.string().min(1)).max(500).default([]),
  compressedContextProfile: z.string().max(20000).optional(),
  executionProfileId: z.string().max(500).optional(),
  requestedClassificationCategories: z
    .array(
      z.enum([
        "product-defect",
        "incorrect-expectation",
        "stale-test",
        "flaky-behaviour",
        "test-data-problem",
        "environment-issue",
        "infrastructure-issue",
        "unsupported-or-unknown",
      ]),
    )
    .max(20)
    .default([]),
  status: z.enum(["open", "delegated", "completed", "superseded"]).default("open"),
});
export type FailureAnalysisRequest = z.infer<typeof FailureAnalysisRequestSchema>;

export const QaGateResultSchema = z.object({
  id: z.string().min(1).max(200),
  label: z.string().min(1).max(500),
  passed: z.boolean(),
  state: z.enum(["passed", "failed", "warning", "not-applicable"]),
  evidence: z.string().min(1).max(2000).default(""),
  remediationAction: z.string().min(1).max(2000).default(""),
});
export type QaGateResult = z.infer<typeof QaGateResultSchema>;

export const QaGateInputSchema = z.object({
  requiredTestsPassed: z.boolean(),
  noCriticalCoverageGaps: z.boolean(),
  noUnresolvedCriticalImpact: z.boolean(),
  requiredTestLayersExecuted: z.boolean(),
  noTimedOutRequiredCommands: z.boolean(),
  failureAnalysisCompleted: z.boolean(),
  generatedTestsApproved: z.boolean(),
  userApprovalObtained: z.boolean(),
  intelligenceRevisionCurrent: z.boolean(),
  changeSetUnchanged: z.boolean(),
});
export type QaGateInput = z.infer<typeof QaGateInputSchema>;

export const QaDecisionSchema = z.object({
  id: z.string().min(1).max(500),
  workflowId: z.string().max(500).optional(),
  qaCycleId: z.string().min(1).max(500),
  decision: z.enum([
    "passed",
    "passed-with-warnings",
    "failed",
    "blocked",
    "needs-test-generation",
    "needs-failure-analysis",
    "needs-remediation",
    "cancelled",
  ]),
  evidence: z.object({
    impactAnalysisId: z.string().min(1).max(500),
    testPlanId: z.string().min(1).max(500),
    executionRunIds: z.array(z.string().min(1)).max(500).default([]),
    failureAnalysisIds: z.array(z.string().min(1)).max(500).default([]),
    coverageGapIds: z.array(z.string().min(1)).max(500).default([]),
  }),
  gates: z.array(QaGateResultSchema).max(50).default([]),
  warnings: z.array(z.string()).max(100).default([]),
  approvedByUser: z.boolean().default(false),
  metadata: z.object({ createdAt: z.string().min(1), contentHash: z.string().min(1) }),
});
export type QaDecision = z.infer<typeof QaDecisionSchema>;

// ---------------------------------------------------------------------------
// QA cycle (spec §4) + structured errors (§51)
// ---------------------------------------------------------------------------

export const QaCycleStatusSchema = z.enum([
  "not-started",
  "discovering-changes",
  "analyzing-impact",
  "planning-tests",
  "awaiting-approval",
  "executing",
  "analyzing-failures",
  "awaiting-remediation",
  "reviewing",
  "passed",
  "failed",
  "blocked",
  "cancelled",
  "stale",
]);
export type QaCycleStatus = z.infer<typeof QaCycleStatusSchema>;

export const QaCycleSchema = z.object({
  id: z.string().min(1).max(500),
  workflowId: z.string().max(500).optional(),
  source: z.object({
    changeSetId: z.string().min(1).max(500),
    specificationRevision: z.string().min(1).max(500),
    intelligenceRevision: z.string().min(1).max(500),
    repositoryRevision: z.string().max(500).optional(),
  }),
  impactAnalysisId: z.string().max(500).optional(),
  testPlanId: z.string().max(500).optional(),
  executionRunIds: z.array(z.string().min(1)).max(500).default([]),
  failureAnalysisIds: z.array(z.string().min(1)).max(500).default([]),
  qaDecisionId: z.string().max(500).optional(),
  status: QaCycleStatusSchema,
  metadata: z.object({
    createdAt: z.string().min(1),
    updatedAt: z.string().min(1),
    completedAt: z.string().optional(),
    version: z.number().int().nonnegative().default(1),
  }),
});
export type QaCycle = z.infer<typeof QaCycleSchema>;

export const QaErrorCodeSchema = z.enum([
  "change-set-unavailable",
  "source-control-unavailable",
  "symbol-resolution-partial",
  "intelligence-stale",
  "impact-truncated",
  "test-discovery-failed",
  "no-test-command",
  "invalid-test-command",
  "plan-blocked",
  "approval-required",
  "execution-failed",
  "execution-cancelled",
  "execution-timeout",
  "result-parser-failed",
  "coverage-parser-failed",
  "stale-qa-cycle",
  "internal-error",
]);
export type QaErrorCode = z.infer<typeof QaErrorCodeSchema>;

export const QaErrorSchema = z.object({
  code: QaErrorCodeSchema,
  message: z.string().min(1).max(2000),
  affectedOperation: z.string().min(1).max(200),
  recoverable: z.boolean(),
  suggestedResolution: z.string().min(1).max(2000),
  technicalDetails: z.string().max(5000).optional(),
});
export type QaError = z.infer<typeof QaErrorSchema>;

// ---------------------------------------------------------------------------
// Test command definition + raw execution result (spec §24, §27, §29, §30)
// ---------------------------------------------------------------------------

export const TestCommandDefinitionSchema = z.object({
  id: z.string().min(1).max(500),
  displayName: z.string().min(1).max(500),
  commandTemplate: z.string().min(1).max(2000),
  workingDirectory: z.string().max(2000).optional(),
  layer: TestLayerSchema,
  framework: z.string().max(200).optional(),
  supportsFileTargeting: z.boolean().default(false),
  supportsTestNameTargeting: z.boolean().default(false),
  supportsCoverage: z.boolean().default(false),
  estimatedScope: z
    .enum(["single-test", "file", "package", "project", "repository"])
    .default("project"),
  requiredEnvironment: z.array(z.string().max(200)).max(50).default([]),
  source: z.enum([
    "package-script",
    "workspace-task",
    "build-tool",
    "test-config",
    "user-config",
    "validation-provider",
  ]),
  confidence: z.number().min(0).max(1),
  available: z.boolean().default(true),
});
export type TestCommandDefinition = z.infer<typeof TestCommandDefinitionSchema>;

export const RawCommandResultSchema = z.object({
  commandId: z.string().min(1).max(500),
  exitCode: z.number().int().optional(),
  stdout: z.string().max(200000).default(""),
  stderr: z.string().max(200000).default(""),
  durationMs: z.number().int().nonnegative().default(0),
  timedOut: z.boolean().default(false),
  rawOutputRef: z.string().max(2000).optional(),
});
export type RawCommandResult = z.infer<typeof RawCommandResultSchema>;
