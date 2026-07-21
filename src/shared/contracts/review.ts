import { z } from "zod";
import { DevelopmentWorkflowSnapshotSchema } from "./delegation";
import {
  CommitPlanSchema,
  DeliveryChangeSetSchema,
  GitCapabilitiesSchema,
  GitRepositoryStateSchema,
  PullRequestCreationResultSchema,
  PullRequestDraftSchema,
  PullRequestProviderCapabilitySchema,
} from "./delivery";
import { ValidationFindingSchema } from "./execution";

export const REVIEW_SCHEMA_VERSION = 1 as const;
const Id = z.string().uuid();
const Timestamp = z.string().datetime();
const Text = z.string().max(20_000);
const Scope = z.object({ workflowId: Id }).strict();
const Path = z.string().min(1).max(1024);

export const ReviewWorkflowPayloadSchema = Scope;
export const ReviewNotePayloadSchema = Scope.extend({ noteId: Id }).strict();
export const ReviewAddNotePayloadSchema = Scope.extend({
  targetType: z.enum([
    "workflow",
    "requirement",
    "task",
    "file",
    "symbol",
    "validation",
    "finding",
    "pr-section",
  ]),
  targetId: z.string().min(1).max(1000),
  type: z.enum(["question", "issue", "suggestion", "approval", "risk", "follow-up"]),
  text: z.string().min(1).max(10_000),
  blocking: z.boolean(),
}).strict();
export const ReviewUpdateNotePayloadSchema = ReviewNotePayloadSchema.extend({
  text: z.string().min(1).max(10_000),
  blocking: z.boolean(),
}).strict();
export const ReviewResolveNotePayloadSchema = ReviewNotePayloadSchema.extend({
  resolution: z.string().min(1).max(10_000),
}).strict();
export const ReviewRequestChangesPayloadSchema = Scope.extend({
  targetType: z.enum(["requirement", "task", "file", "finding", "specification"]),
  targetId: z.string().min(1).max(1000),
  requestedChange: z.string().min(1).max(10_000),
  action: z.enum(["reopen-task", "repair-task", "follow-up-task", "revise-specification"]),
}).strict();
export const ReviewFollowUpPayloadSchema = Scope.extend({
  title: z.string().min(1).max(500),
  objective: z.string().min(1).max(5000),
  relatedRequirementIds: z.array(z.string().max(200)).max(100),
  relatedFilePaths: z.array(Path).max(500),
  blocking: z.boolean(),
}).strict();
export const ReviewDecisionPayloadSchema = Scope.extend({
  reason: z.string().min(1).max(5000),
  confirm: z.literal(true),
}).strict();
export const ReviewRiskDispositionPayloadSchema = Scope.extend({
  findingId: Id,
  disposition: z.enum([
    "fixed",
    "accepted-risk",
    "false-positive",
    "follow-up-task",
    "blocking",
    "verified",
    "accepted",
  ]),
  reason: z.string().min(1).max(5000),
  scope: z.string().min(1).max(2000),
}).strict();
export const ReviewPrDraftUpdatePayloadSchema = z
  .object({ draft: PullRequestDraftSchema })
  .strict();
export const ReviewDiffPayloadSchema = Scope.extend({
  path: Path,
  maxBytes: z.number().int().min(1000).max(100_000).default(50_000),
}).strict();

export const ReviewNoteSchema = z
  .object({
    schemaVersion: z.literal(REVIEW_SCHEMA_VERSION),
    id: Id,
    workflowId: Id,
    targetType: z.enum([
      "workflow",
      "requirement",
      "task",
      "file",
      "symbol",
      "validation",
      "finding",
      "pr-section",
    ]),
    targetId: z.string().max(1000),
    type: z.enum(["question", "issue", "suggestion", "approval", "risk", "follow-up"]),
    text: z.string().max(10_000),
    blocking: z.boolean(),
    author: z.literal("user"),
    resolution: z.string().max(10_000).optional(),
    resolvedAt: Timestamp.optional(),
    createdAt: Timestamp,
    updatedAt: Timestamp,
  })
  .strict();
export type ReviewNote = z.infer<typeof ReviewNoteSchema>;

export const FindingDispositionSchema = z
  .object({
    id: Id,
    workflowId: Id,
    findingId: Id,
    disposition: z.enum([
      "fixed",
      "accepted-risk",
      "false-positive",
      "follow-up-task",
      "blocking",
      "verified",
      "accepted",
    ]),
    reason: z.string().max(5000),
    scope: z.string().max(2000),
    approvedBy: z.literal("user"),
    decidedAt: Timestamp,
  })
  .strict();
export type FindingDisposition = z.infer<typeof FindingDispositionSchema>;

export const ReviewDecisionSchema = z
  .object({
    schemaVersion: z.literal(REVIEW_SCHEMA_VERSION),
    id: Id,
    workflowId: Id,
    specificationRevision: z.number().int().positive(),
    repositoryFingerprint: z.string().max(500),
    branch: z.string().max(500).optional(),
    headCommit: z.string().max(100).optional(),
    intelligenceGeneration: z.number().int().nonnegative(),
    status: z.enum([
      "approved",
      "approved-with-warnings",
      "changes-requested",
      "rejected",
      "stale",
    ]),
    findings: z.array(z.string().max(2000)).max(500),
    warnings: z.array(z.string().max(2000)).max(500),
    noteIds: z.array(Id).max(1000),
    reason: z.string().max(5000),
    decidedBy: z.literal("user"),
    decidedAt: Timestamp,
  })
  .strict();
export type ReviewDecision = z.infer<typeof ReviewDecisionSchema>;

export const TraceabilityItemSchema = z
  .object({
    id: z.string().max(200),
    kind: z.enum(["requirement", "acceptance-criterion"]),
    description: z.string().max(5000),
    taskIds: z.array(Id).max(500),
    changedFiles: z.array(Path).max(1000),
    changedEntityIds: z.array(z.string().max(500)).max(1000),
    validationEvidenceIds: z.array(z.string().max(500)).max(1000),
    qaEvidence: z.array(z.string().max(3000)).max(500),
    status: z.enum([
      "satisfied",
      "partially-satisfied",
      "failed",
      "not-evaluated",
      "manual-review-required",
      "stale",
    ]),
    openConcern: z.string().max(3000).optional(),
  })
  .strict();
export type TraceabilityItem = z.infer<typeof TraceabilityItemSchema>;

export const ReviewChangeSchema = z
  .object({
    path: Path,
    previousPath: Path.optional(),
    kind: z.enum(["added", "modified", "deleted", "renamed"]),
    classification: z.enum([
      "expected",
      "related",
      "unexpected",
      "pre-existing",
      "concurrent",
      "ambiguous",
      "excluded",
      "generated-output",
    ]),
    taskIds: z.array(Id).max(100),
    requirementIds: z.array(z.string().max(200)).max(100),
    criterionIds: z.array(z.string().max(200)).max(100),
    changedSymbols: z.array(z.string().max(1000)).max(500),
    riskIndicators: z.array(z.string().max(1000)).max(100),
  })
  .strict();
export type ReviewChange = z.infer<typeof ReviewChangeSchema>;

export const ReviewFindingSchema = z
  .object({
    finding: ValidationFindingSchema,
    source: z.enum(["qa", "security", "performance", "documentation"]),
    evidence: z.array(z.string().max(5000)).max(100),
    staticOrMeasured: z.enum(["static", "measured", "manual", "unknown"]),
    limitation: z.string().max(3000),
    disposition: FindingDispositionSchema.optional(),
  })
  .strict();
export type ReviewFinding = z.infer<typeof ReviewFindingSchema>;

export const ReviewChecklistItemSchema = z
  .object({
    id: z.string().max(100),
    label: z.string().max(500),
    passed: z.boolean(),
    blocking: z.boolean(),
    explanation: z.string().max(3000),
  })
  .strict();
export const ReviewSummarySchema = z
  .object({
    workflowId: Id,
    title: z.string().max(500),
    workType: z.string().max(100),
    specificationRevision: z.number().int().positive(),
    repositoryId: z.string().max(1000),
    branch: z.string().max(500).optional(),
    headCommit: z.string().max(100).optional(),
    intelligenceGeneration: z.number().int().nonnegative(),
    tasksCompleted: z.number().int().nonnegative(),
    tasksIncomplete: z.number().int().nonnegative(),
    validationPassed: z.number().int().nonnegative(),
    validationFailed: z.number().int().nonnegative(),
    blockingFindings: z.number().int().nonnegative(),
    warnings: z.number().int().nonnegative(),
    unexpectedChanges: z.number().int().nonnegative(),
    status: z.enum([
      "ready-for-review",
      "blocked",
      "changes-requested",
      "approved",
      "approved-with-warnings",
      "stale",
    ]),
    completionReady: z.boolean(),
  })
  .strict();

export const WorkflowReviewStateSchema = z
  .object({
    schemaVersion: z.literal(REVIEW_SCHEMA_VERSION),
    workflow: DevelopmentWorkflowSnapshotSchema,
    summary: ReviewSummarySchema,
    traceability: z.array(TraceabilityItemSchema).max(500),
    changes: z.array(ReviewChangeSchema).max(5000),
    findings: z.array(ReviewFindingSchema).max(1000),
    notes: z.array(ReviewNoteSchema).max(1000),
    checklist: z.array(ReviewChecklistItemSchema).max(100),
    readinessBlockers: z.array(z.string().max(3000)).max(500),
    warnings: z.array(z.string().max(3000)).max(500),
    decision: ReviewDecisionSchema.optional(),
    prDraft: PullRequestDraftSchema.optional(),
    repositoryFingerprint: z.string().max(500),
    generatedAt: Timestamp,
  })
  .strict();
export type WorkflowReviewState = z.infer<typeof WorkflowReviewStateSchema>;

export const CompletionModeSchema = z.enum([
  "local",
  "local-commit",
  "pushed-branch",
  "prepared-pr",
  "created-pr",
  "patch-export",
  "handed-off",
  "closed-partial",
  "cancelled-with-changes",
]);
export type CompletionMode = z.infer<typeof CompletionModeSchema>;
export const CompletionOptionSchema = z
  .object({
    mode: CompletionModeSchema,
    label: z.string().max(300),
    available: z.boolean(),
    explanation: z.string().max(3000),
    mutation: z.string().max(2000),
    approvalRequired: z.string().max(500),
    capabilityRequired: z.string().max(500),
    reversible: z.boolean(),
  })
  .strict();
export const WorkflowCompletionRecordSchema = z
  .object({
    schemaVersion: z.literal(REVIEW_SCHEMA_VERSION),
    id: Id,
    workflowId: Id,
    specificationRevision: z.number().int().positive(),
    mode: CompletionModeSchema,
    status: z.enum([
      "completed",
      "closed-partial",
      "handed-off",
      "cancelled-with-changes",
      "archived",
    ]),
    completedTaskIds: z.array(Id).max(500),
    incompleteTaskIds: z.array(Id).max(500),
    reviewDecisionId: Id.optional(),
    validationSummary: z.array(z.string().max(3000)).max(500),
    acceptanceCriteria: z.array(z.string().max(3000)).max(500),
    qaDecision: z.string().max(500),
    securityDisposition: z.string().max(1000),
    performanceDisposition: z.string().max(1000),
    documentationDisposition: z.string().max(1000),
    commitHashes: z.array(z.string().max(100)).max(100),
    pushReference: z.string().max(1000).optional(),
    prUrl: z.string().url().max(2000).optional(),
    patchHash: z.string().max(500).optional(),
    handoffPackageIds: z.array(Id).max(100),
    remainingWarnings: z.array(z.string().max(3000)).max(500),
    repositoryFingerprint: z.string().max(500),
    report: Text,
    confirmedBy: z.literal("user"),
    completedAt: Timestamp,
  })
  .strict();
export type WorkflowCompletionRecord = z.infer<typeof WorkflowCompletionRecordSchema>;

export const CompleteDecisionPayloadSchema = Scope.extend({
  confirm: z.literal(true),
  reason: z.string().min(1).max(5000),
}).strict();
export const CompletePatchPayloadSchema = Scope.extend({
  includedPaths: z.array(Path).min(1).max(5000),
}).strict();
export const CompleteApprovalPayloadSchema = Scope.extend({
  fingerprint: z.string().min(1).max(500),
  confirm: z.literal(true),
}).strict();
export const CompletionStateSchema = z
  .object({
    schemaVersion: z.literal(REVIEW_SCHEMA_VERSION),
    review: WorkflowReviewStateSchema,
    options: z.array(CompletionOptionSchema).max(20),
    gitCapabilities: GitCapabilitiesSchema,
    repositoryState: GitRepositoryStateSchema.optional(),
    changeSet: DeliveryChangeSetSchema.optional(),
    commitPlan: CommitPlanSchema.optional(),
    prCapabilities: PullRequestProviderCapabilitySchema.optional(),
    prDraft: PullRequestDraftSchema.optional(),
    prResult: PullRequestCreationResultSchema.optional(),
    completion: WorkflowCompletionRecordSchema.optional(),
  })
  .strict();
export type CompletionState = z.infer<typeof CompletionStateSchema>;

export const ReviewLifecycleEventSchema = z
  .object({
    workflowId: Id,
    specificationRevision: z.number().int().positive(),
    repositoryFingerprint: z.string().max(500),
    message: z.string().max(3000),
    at: Timestamp,
  })
  .strict();
export const CompletionPersistentStateSchema = z
  .object({
    schemaVersion: z.literal(REVIEW_SCHEMA_VERSION),
    revision: z.number().int().nonnegative(),
    notes: z.array(ReviewNoteSchema).max(5000),
    dispositions: z.array(FindingDispositionSchema).max(5000),
    decisions: z.array(ReviewDecisionSchema).max(500),
    completions: z.array(WorkflowCompletionRecordSchema).max(500),
    archivedWorkflowIds: z.array(Id).max(500),
    updatedAt: Timestamp,
  })
  .strict();
export type CompletionPersistentState = z.infer<typeof CompletionPersistentStateSchema>;
