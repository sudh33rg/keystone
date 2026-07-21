import { z } from "zod";
import { RepositoryStateRefSchema, StalenessRecordSchema } from "./integration";
import { CopilotAgentDescriptorSchema, RepositoryBaselineSchema } from "./delegation";

export const EXECUTION_SCHEMA_VERSION = 1 as const;
export const TaskExecutionStatusSchema = z.enum([
  "prepared",
  "awaiting-start",
  "executing",
  "repository-changed",
  "awaiting-result-capture",
  "result-captured",
  "planning-validation",
  "validating",
  "validation-passed",
  "validation-failed",
  "awaiting-user-review",
  "retry-planned",
  "retrying",
  "accepted-with-override",
  "completed",
  "blocked",
  "failed",
  "cancelled",
  "stale",
]);
export type TaskExecutionStatus = z.infer<typeof TaskExecutionStatusSchema>;
export const ChangeClassificationSchema = z.enum([
  "expected",
  "related",
  "unexpected",
  "pre-existing",
  "concurrent",
  "ambiguous",
  "excluded",
  "generated-output",
]);
export const AttributedChangeSchema = z
  .object({
    relativePath: z.string().min(1).max(1024),
    kind: z.enum(["added", "modified", "deleted", "renamed"]),
    originalPath: z.string().max(1024).optional(),
    classification: ChangeClassificationSchema,
    confidence: z.number().min(0).max(1),
    reasons: z.array(z.string().max(1000)).max(20),
    relatedEntityIds: z.array(z.string().max(500)).max(100),
    evidenceIds: z.array(z.string().max(500)).max(100),
    userOverride: z
      .object({
        classification: ChangeClassificationSchema,
        reason: z.string().min(1).max(2000),
        at: z.string().datetime(),
      })
      .strict()
      .optional(),
  })
  .strict();
export type AttributedChange = z.infer<typeof AttributedChangeSchema>;
export const ChangedEntitySchema = z
  .object({
    entityId: z.string().max(500),
    entityType: z.string().max(500),
    qualifiedName: z.string().max(1000),
    relativePath: z.string().max(1024),
    changeKind: z.enum([
      "file-added",
      "file-modified",
      "file-deleted",
      "file-renamed",
      "symbol-added",
      "symbol-modified",
      "symbol-deleted",
      "signature-change",
      "route-change",
      "contract-change",
      "schema-change",
      "configuration-change",
      "test-change",
      "build-change",
      "infrastructure-change",
      "dependency-change",
      "architecture-change",
      "unresolved-mapping",
    ]),
    beforeFingerprint: z.string().max(500).optional(),
    afterFingerprint: z.string().max(500).optional(),
    confidence: z.number().min(0).max(1),
    evidenceIds: z.array(z.string().max(500)).max(100),
    limitations: z.array(z.string().max(2000)).max(20),
  })
  .strict();
export type ChangedEntity = z.infer<typeof ChangedEntitySchema>;
export const ExecutionResultCaptureSchema = z
  .object({
    mode: z.enum(["direct", "assisted", "repository-only"]),
    agentClaims: z
      .object({
        summary: z.string().max(20_000).optional(),
        filesChanged: z.array(z.string().max(1024)).max(500).optional(),
        commandsRun: z.array(z.string().max(1000)).max(100).optional(),
        testsRun: z.array(z.string().max(1000)).max(100).optional(),
        blockers: z.array(z.string().max(2000)).max(100).optional(),
        unresolvedIssues: z.array(z.string().max(2000)).max(100).optional(),
      })
      .strict()
      .optional(),
    attributedChanges: z.array(AttributedChangeSchema).max(5000),
    userNotes: z.string().max(20_000).optional(),
    capturedAt: z.string().datetime(),
    diagnostics: z.array(z.string().max(2000)).max(100),
  })
  .strict();
export type ExecutionResultCapture = z.infer<typeof ExecutionResultCaptureSchema>;

export const ExecutionMetricsSchema = z
  .object({
    executionDurationMs: z.number().nonnegative().default(0),
    filesChanged: z.number().int().nonnegative().default(0),
    averageAttributionConfidence: z.number().min(0).max(1).default(0),
    validationDurationMs: z.number().nonnegative().default(0),
    testsSelected: z.number().int().nonnegative().default(0),
    retryCount: z.number().int().nonnegative().default(0),
    cacheReuseCount: z.number().int().nonnegative().default(0),
    cancelledSteps: z.number().int().nonnegative().default(0),
    outputTruncations: z.number().int().nonnegative().default(0),
    staleInvalidations: z.number().int().nonnegative().default(0),
  })
  .strict();
export const TaskExecutionSessionSchema = z
  .object({
    schemaVersion: z.literal(EXECUTION_SCHEMA_VERSION),
    repositoryState: RepositoryStateRefSchema.optional(),
    staleness: z.array(StalenessRecordSchema).max(100).default([]),
    id: z.string().uuid(),
    taskId: z.string().uuid(),
    workflowId: z.string().uuid(),
    specificationId: z.string().uuid(),
    specificationRevision: z.number().int().positive(),
    delegationSessionId: z.string().uuid(),
    contextFingerprint: z.string().max(500).optional(),
    promptFingerprint: z.string().max(500).optional(),
    agentId: z.string().min(1).max(200),
    agentSnapshot: CopilotAgentDescriptorSchema,
    delegationMode: z.enum(["direct", "assisted", "clipboard"]),
    status: TaskExecutionStatusSchema,
    repositoryBaseline: RepositoryBaselineSchema,
    expectedFiles: z.array(z.string().max(1024)).max(500),
    expectedEntityIds: z.array(z.string().max(500)).max(500),
    observedChanges: z.array(AttributedChangeSchema).max(5000),
    changedEntities: z.array(ChangedEntitySchema).max(5000).default([]),
    resultCapture: ExecutionResultCaptureSchema.optional(),
    validationPlanId: z.string().uuid().optional(),
    validationRunIds: z.array(z.string().uuid()).max(100),
    retryAttempt: z.number().int().nonnegative(),
    parentExecutionSessionId: z.string().uuid().optional(),
    startedAt: z.string().datetime().optional(),
    stoppedAt: z.string().datetime().optional(),
    completedAt: z.string().datetime().optional(),
    updatedAt: z.string().datetime(),
    metrics: ExecutionMetricsSchema.default({
      executionDurationMs: 0,
      filesChanged: 0,
      averageAttributionConfidence: 0,
      validationDurationMs: 0,
      testsSelected: 0,
      retryCount: 0,
      cacheReuseCount: 0,
      cancelledSteps: 0,
      outputTruncations: 0,
      staleInvalidations: 0,
    }),
    diagnostics: z
      .array(
        z
          .object({
            code: z.string().max(100),
            severity: z.enum(["info", "warning", "error"]),
            message: z.string().max(2000),
          })
          .strict(),
      )
      .max(100),
  })
  .strict();
export type TaskExecutionSession = z.infer<typeof TaskExecutionSessionSchema>;

export const ValidationStepTypeSchema = z.enum([
  "repository-diff",
  "expected-file-change",
  "unexpected-file-change",
  "changed-symbol",
  "build",
  "type-check",
  "lint",
  "unit-test",
  "integration-test",
  "end-to-end-test",
  "impacted-test",
  "contract-validation",
  "schema-validation",
  "migration-validation",
  "architecture-rule",
  "static-analysis",
  "security-check",
  "performance-check",
  "manual-review",
  "runtime-verification",
  "specification-conformance",
]);
export type ValidationStepType = z.infer<typeof ValidationStepTypeSchema>;
export const CommandDescriptorSchema = z
  .object({
    executable: z.enum([
      "npm",
      "pnpm",
      "yarn",
      "npx",
      "go",
      "cargo",
      "dotnet",
      "mvn",
      "gradle",
      "python",
      "pytest",
    ]),
    args: z.array(z.string().max(500)).max(50),
    workingDirectory: z.string().min(1).max(2048),
    safety: z.enum(["safe-readonly", "project-validation", "potentially-mutating", "prohibited"]),
    provenance: z.enum(["repository-script", "repository-config", "keystone-static"]),
    approved: z.boolean(),
    timeoutMs: z
      .number()
      .int()
      .min(1000)
      .max(30 * 60_000),
  })
  .strict();
export type CommandDescriptor = z.infer<typeof CommandDescriptorSchema>;
export const ValidationStepSchema = z
  .object({
    id: z.string().uuid(),
    type: ValidationStepTypeSchema,
    description: z.string().min(1).max(2000),
    provider: z.string().min(1).max(200),
    command: CommandDescriptorSchema.optional(),
    dependencies: z.array(z.string().uuid()).max(100),
    required: z.boolean(),
    expectedEvidence: z.string().min(1).max(2000),
    acceptanceCriterionIds: z.array(z.string().max(200)).max(100),
    scopePaths: z.array(z.string().max(1024)).max(5000).default([]),
    inputFingerprint: z.string().max(500).default("unscoped"),
    status: z.enum([
      "pending",
      "approved",
      "running",
      "passed",
      "failed",
      "cancelled",
      "stale",
      "skipped",
    ]),
    estimatedDurationMs: z.number().int().nonnegative().optional(),
  })
  .strict();
export type ValidationStep = z.infer<typeof ValidationStepSchema>;
export const TestImpactSelectionSchema = z
  .object({
    testEntityId: z.string().max(500),
    relativePath: z.string().max(1024),
    qualifiedName: z.string().max(1000),
    confidence: z.number().min(0).max(1),
    tier: z.enum([
      "coverage-confirmed",
      "exact-resolved-call",
      "exact-reference-import",
      "framework-binding",
      "naming-candidate",
    ]),
    reasons: z.array(z.string().max(1000)).max(20),
    evidenceIds: z.array(z.string().max(500)).max(100),
    selected: z.boolean(),
  })
  .strict();
export type TestImpactSelection = z.infer<typeof TestImpactSelectionSchema>;
export const ValidationPlanSchema = z
  .object({
    schemaVersion: z.literal(EXECUTION_SCHEMA_VERSION),
    id: z.string().uuid(),
    taskId: z.string().uuid(),
    executionSessionId: z.string().uuid(),
    testMode: z.enum(["impacted", "affected-suite", "all"]).default("impacted"),
    testSelections: z.array(TestImpactSelectionSchema).max(500).default([]),
    steps: z.array(ValidationStepSchema).max(200),
    acceptanceCriteriaMappings: z
      .array(
        z
          .object({
            criterionId: z.string().max(200),
            stepIds: z.array(z.string().uuid()).min(1).max(100),
          })
          .strict(),
      )
      .max(200),
    repositoryGeneration: z.number().int().nonnegative(),
    repositoryFingerprint: z.string().min(1).max(500),
    createdAt: z.string().datetime(),
    diagnostics: z.array(z.string().max(2000)).max(100),
  })
  .strict();
export type ValidationPlan = z.infer<typeof ValidationPlanSchema>;

export const ValidationEvidenceSchema = z
  .object({
    id: z.string().uuid(),
    kind: z.enum([
      "git-diff",
      "file-hash",
      "changed-symbol",
      "source-range",
      "test-output",
      "build-output",
      "diagnostic",
      "cpg-path",
      "graph-path",
      "contract-comparison",
      "schema-comparison",
      "user-verification",
      "agent-claim",
    ]),
    source: z.string().max(1000),
    reliability: z.enum(["exact", "observed", "inferred", "claim", "manual"]),
    summary: z.string().max(5000),
    reference: z.string().max(2048).optional(),
    createdAt: z.string().datetime(),
  })
  .strict();
export type ValidationEvidence = z.infer<typeof ValidationEvidenceSchema>;
export const ValidationFindingSchema = z
  .object({
    id: z.string().uuid(),
    title: z.string().max(500),
    description: z.string().max(5000),
    severity: z.enum(["blocking", "error", "warning", "informational"]),
    category: z.enum([
      "scope",
      "requirement",
      "acceptance-criterion",
      "build",
      "type-check",
      "lint",
      "test",
      "security",
      "performance",
      "architecture",
      "API",
      "data",
      "migration",
      "dependency",
      "configuration",
      "documentation",
      "unexpected-change",
      "unresolved",
    ]),
    relatedEntityIds: z.array(z.string().max(500)).max(100),
    acceptanceCriterionIds: z.array(z.string().max(200)).max(100),
    evidenceIds: z.array(z.string().uuid()).max(100),
    suggestedAction: z.string().max(2000),
    retryRelevant: z.boolean(),
    details: z
      .object({
        rule: z.string().max(500).optional(),
        source: z.string().max(1000).optional(),
        sink: z.string().max(1000).optional(),
        path: z.array(z.string().max(500)).max(100).optional(),
        confidence: z.number().min(0).max(1).optional(),
        limitations: z.array(z.string().max(2000)).max(20).optional(),
      })
      .strict()
      .optional(),
    override: z
      .object({
        reason: z.string().min(1).max(2000),
        at: z.string().datetime(),
      })
      .strict()
      .optional(),
  })
  .strict();
export type ValidationFinding = z.infer<typeof ValidationFindingSchema>;
export const ValidationStepResultSchema = z
  .object({
    stepId: z.string().uuid(),
    status: z.enum(["passed", "failed", "cancelled", "skipped", "stale"]),
    startedAt: z.string().datetime(),
    completedAt: z.string().datetime(),
    durationMs: z.number().nonnegative(),
    exitCode: z.number().int().optional(),
    outputTail: z.string().max(20_000),
    errorTail: z.string().max(20_000),
    outputTruncated: z.boolean(),
    evidenceIds: z.array(z.string().uuid()).max(100),
    baselineClassification: z.enum(["new", "pre-existing", "fixed", "unknown"]),
    reused: z.boolean().default(false),
  })
  .strict();
export const CriterionResultSchema = z
  .object({
    criterionId: z.string().max(200),
    status: z.enum([
      "passed",
      "failed",
      "partially-passed",
      "not-run",
      "not-verifiable",
      "requires-manual-review",
      "overridden",
    ]),
    stepIds: z.array(z.string().uuid()).max(100),
    evidenceIds: z.array(z.string().uuid()).max(100),
    explanation: z.string().max(3000),
    override: z
      .object({
        reason: z.string().min(1).max(2000),
        at: z.string().datetime(),
      })
      .strict()
      .optional(),
  })
  .strict();
export const ValidationRunSchemaV2 = z
  .object({
    schemaVersion: z.literal(EXECUTION_SCHEMA_VERSION),
    id: z.string().uuid(),
    executionSessionId: z.string().uuid(),
    taskId: z.string().uuid(),
    status: z.enum(["running", "passed", "failed", "cancelled", "stale", "awaiting-user-review"]),
    startedAt: z.string().datetime(),
    completedAt: z.string().datetime().optional(),
    stepResults: z.array(ValidationStepResultSchema).max(200),
    acceptanceCriteriaResults: z.array(CriterionResultSchema).max(200),
    findings: z.array(ValidationFindingSchema).max(500),
    evidence: z.array(ValidationEvidenceSchema).max(1000),
    summary: z
      .object({
        requiredStepsPassed: z.number().int().nonnegative(),
        requiredStepsFailed: z.number().int().nonnegative(),
        optionalStepsPassed: z.number().int().nonnegative().default(0),
        criteriaPassed: z.number().int().nonnegative(),
        criteriaFailed: z.number().int().nonnegative(),
        criteriaRequiringReview: z.number().int().nonnegative(),
        newRegressions: z.number().int().nonnegative(),
        preExistingFailures: z.number().int().nonnegative(),
        unexpectedChanges: z.number().int().nonnegative(),
        blockingFindings: z.number().int().nonnegative(),
        testsSelected: z.number().int().nonnegative().default(0),
        cacheReuseCount: z.number().int().nonnegative().default(0),
        cancelledSteps: z.number().int().nonnegative().default(0),
        outputTruncations: z.number().int().nonnegative().default(0),
        staleInvalidations: z.number().int().nonnegative().default(0),
      })
      .strict(),
    repositoryGeneration: z.number().int().nonnegative(),
    repositoryFingerprint: z.string().max(500),
    diagnostics: z.array(z.string().max(2000)).max(100),
  })
  .strict();
export type ValidationRunV2 = z.infer<typeof ValidationRunSchemaV2>;

export const RetryPlanSchema = z
  .object({
    id: z.string().uuid(),
    executionSessionId: z.string().uuid(),
    attempt: z.number().int().positive(),
    mode: z.enum(["same-agent", "different-agent", "manual-repair", "partial-repair"]),
    selectedAgentId: z.string().max(200).optional(),
    partialRepairTaskId: z.string().uuid().optional(),
    reason: z.string().min(1).max(3000),
    failedCriterionIds: z.array(z.string().max(200)).max(200),
    findingIds: z.array(z.string().uuid()).max(500),
    repairContext: z
      .array(
        z
          .object({
            title: z.string().max(1000),
            content: z.string().max(20_000),
            reason: z.string().max(2000),
          })
          .strict(),
      )
      .max(100),
    createdAt: z.string().datetime(),
    status: z.enum(["planned", "prepared", "started", "completed", "cancelled"]),
  })
  .strict();
export type RetryPlan = z.infer<typeof RetryPlanSchema>;
export const CompletionDecisionSchema = z
  .object({
    id: z.string().uuid(),
    taskId: z.string().uuid(),
    executionSessionId: z.string().uuid(),
    status: z.enum([
      "blocked",
      "ready",
      "completed",
      "completed-with-warnings",
      "accepted-with-override",
    ]),
    blockers: z.array(z.string().max(2000)).max(200),
    warnings: z.array(z.string().max(2000)).max(200),
    overrideReason: z.string().max(2000).optional(),
    decidedAt: z.string().datetime(),
    completedAt: z.string().datetime().optional(),
  })
  .strict();
export type CompletionDecision = z.infer<typeof CompletionDecisionSchema>;
export const OverrideAuditSchema = z
  .object({
    id: z.string().uuid(),
    executionSessionId: z.string().uuid(),
    validationRunId: z.string().uuid().optional(),
    targetType: z.enum(["criterion", "finding", "step", "completion"]),
    targetId: z.string().max(500),
    reason: z.string().min(1).max(2000),
    userId: z.literal("user"),
    priorStatus: z.string().max(200),
    resultingStatus: z.string().max(200),
    riskAcknowledgement: z.string().min(1).max(2000),
    createdAt: z.string().datetime(),
  })
  .strict();
export type OverrideAudit = z.infer<typeof OverrideAuditSchema>;
export const WorkflowCompletionReportSchema = z
  .object({
    id: z.string().uuid(),
    workflowId: z.string().uuid(),
    specificationId: z.string().uuid(),
    specificationRevision: z.number().int().positive(),
    taskIds: z.array(z.string().uuid()).max(500),
    completedTaskIds: z.array(z.string().uuid()).max(500),
    attempts: z.number().int().nonnegative(),
    filesChanged: z.array(z.string().max(1024)).max(5000),
    symbolsChanged: z.array(z.string().max(1000)).max(5000).default([]),
    apiChanges: z.array(z.string().max(1000)).max(1000).default([]),
    dataChanges: z.array(z.string().max(1000)).max(1000).default([]),
    testsChanged: z.array(z.string().max(1000)).max(1000).default([]),
    validationOutcomes: z.array(z.string().max(2000)).max(1000).default([]),
    contextFingerprints: z.array(z.string().max(500)).max(500).default([]),
    promptFingerprints: z.array(z.string().max(500)).max(500).default([]),
    validationRunIds: z.array(z.string().uuid()).max(1000),
    overrides: z.array(z.string().max(2000)).max(500),
    warnings: z.array(z.string().max(2000)).max(500),
    branch: z.string().max(500),
    headCommit: z.string().max(500),
    intelligenceGeneration: z.number().int().nonnegative(),
    createdAt: z.string().datetime(),
  })
  .strict();
export type WorkflowCompletionReport = z.infer<typeof WorkflowCompletionReportSchema>;

export const ExecutionPersistentStateSchema = z
  .object({
    schemaVersion: z.literal(EXECUTION_SCHEMA_VERSION),
    revision: z.number().int().nonnegative(),
    sessions: z.array(TaskExecutionSessionSchema).max(500),
    plans: z.array(ValidationPlanSchema).max(500),
    runs: z.array(ValidationRunSchemaV2).max(1000),
    retries: z.array(RetryPlanSchema).max(500),
    overrides: z.array(OverrideAuditSchema).max(1000).default([]),
    decisions: z.array(CompletionDecisionSchema).max(500),
    reports: z.array(WorkflowCompletionReportSchema).max(100),
    updatedAt: z.string().datetime(),
  })
  .strict();
export type ExecutionPersistentState = z.infer<typeof ExecutionPersistentStateSchema>;

export const ExecutionStartPayloadSchema = z
  .object({
    workflowId: z.string().uuid(),
    taskId: z.string().uuid(),
    delegationSessionId: z.string().uuid(),
  })
  .strict();
export const ExecutionSessionPayloadSchema = z.object({ sessionId: z.string().uuid() }).strict();
export const AttributeChangePayloadSchema = ExecutionSessionPayloadSchema.extend({
  relativePath: z.string().max(1024),
  classification: ChangeClassificationSchema,
  reason: z.string().min(1).max(2000),
}).strict();
export const CaptureResultPayloadSchema = ExecutionSessionPayloadSchema.extend({
  mode: z.enum(["direct", "assisted", "repository-only"]),
  agentClaims: ExecutionResultCaptureSchema.shape.agentClaims.optional(),
  userNotes: z.string().max(20_000).optional(),
}).strict();
export const ValidationPlanPayloadSchema = ExecutionSessionPayloadSchema.extend({
  testMode: z.enum(["impacted", "affected-suite", "all"]).optional(),
  excludedTestEntityIds: z.array(z.string().max(500)).max(500).optional(),
}).strict();
export const ValidationApprovePayloadSchema = z
  .object({ planId: z.string().uuid(), stepId: z.string().uuid() })
  .strict();
export const ValidationRunPayloadSchema = z.object({ planId: z.string().uuid() }).strict();
export const ValidationRunIdPayloadSchema = z.object({ runId: z.string().uuid() }).strict();
export const ValidationOverridePayloadSchema = ValidationRunIdPayloadSchema.extend({
  targetType: z.enum(["criterion", "finding", "step"]),
  targetId: z.string().min(1).max(500),
  reason: z.string().min(1).max(2000),
}).strict();
export const RetryPlanPayloadSchema = ExecutionSessionPayloadSchema.extend({
  mode: z.enum(["same-agent", "different-agent", "manual-repair", "partial-repair"]),
  agentId: z.string().max(200).optional(),
  reason: z.string().min(1).max(3000),
}).strict();
export const CompleteTaskPayloadSchema = ExecutionSessionPayloadSchema.extend({
  confirm: z.literal(true),
  overrideReason: z.string().min(1).max(2000).optional(),
}).strict();
export const WorkflowReportPayloadSchema = z.object({ workflowId: z.string().uuid() }).strict();
