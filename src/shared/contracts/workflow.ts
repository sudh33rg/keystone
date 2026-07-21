import { z } from "zod";
import { ContextBudgetSchema, ContextItemSchema } from "./delegation";

export const WORKFLOW_SCHEMA_VERSION = 1 as const;

// ============================================================================
// Core enums
// ============================================================================

export const WorkflowStatusSchema = z.enum([
  "not-ready",
  "ready",
  "preparing-context",
  "awaiting-approval",
  "delegating",
  "running",
  "awaiting-result-review",
  "validating",
  "passed",
  "failed",
  "blocked",
  "skipped",
  "cancelled",
]);
export type WorkflowStatus = z.infer<typeof WorkflowStatusSchema>;

export const WorkflowStageTypeSchema = z.enum([
  "understand",
  "plan",
  "development",
  "impact-analysis",
  "test-generation",
  "test-execution",
  "failure-analysis",
  "test-healing",
  "security-analysis",
  "performance-analysis",
  "pr-review",
  "complete",
]);
export type WorkflowStageType = z.infer<typeof WorkflowStageTypeSchema>;

export const WorkflowStateSchema = z.enum([
  "not-ready",
  "ready",
  "preparing-context",
  "awaiting-approval",
  "delegating",
  "running",
  "awaiting-result-review",
  "validating",
  "passed",
  "failed",
  "blocked",
  "skipped",
  "cancelled",
]);
export type WorkflowState = z.infer<typeof WorkflowStateSchema>;

export const WorkflowWorkTypeSchema = z.enum([
  "feature",
  "bug-fix",
  "refactoring",
  "test",
  "investigation",
]);
export type WorkflowWorkType = z.infer<typeof WorkflowWorkTypeSchema>;

export const ExecutionModeSchema = z.enum(["automatic", "approval-required"]);
export type ExecutionMode = z.infer<typeof ExecutionModeSchema>;

export const FailureBehaviourSchema = z.enum(["stop", "retry", "skip", "fallback", "escalate"]);
export type FailureBehaviour = z.infer<typeof FailureBehaviourSchema>;

export const RequirementKindSchema = z.enum(["required", "optional"]);
export type RequirementKind = z.infer<typeof RequirementKindSchema>;

// ============================================================================
// Stage configuration
// ============================================================================

const EntryConditionSchema = z.object({
  kind: z.string().max(100),
  expression: z.string().max(2000),
});

const CompletionConditionSchema = z.object({
  kind: z.string().max(100),
  expression: z.string().max(2000),
});

export const WorkflowStageConfigSchema = z.object({
  id: z.string().uuid(),
  type: WorkflowStageTypeSchema,
  displayName: z.string().max(100),
  required: z.boolean(),
  enabled: z.boolean(),
  order: z.number().int().min(1).max(12),
  executionMode: ExecutionModeSchema,
  entryConditions: z.array(EntryConditionSchema).max(10),
  completionConditions: z.array(CompletionConditionSchema).max(10),
  failureBehaviour: FailureBehaviourSchema,
  retryLimit: z.number().int().min(0).max(10).default(3),
  executionProfileId: z.string().max(100).optional(),
  contextProfileId: z.string().max(100).optional(),
  tokenBudget: z.number().int().min(1000).max(1_000_000).default(12_000),
  requiredEvidenceTypes: z.array(z.string().max(100)).max(20),
  blockingFindingSeverities: z.array(z.enum(["info", "low", "medium", "high", "critical"])).max(5),
});
export type WorkflowStageConfig = z.infer<typeof WorkflowStageConfigSchema>;

// ============================================================================
// Stage definition
// ============================================================================

export const WorkflowStageSchema = z.object({
  id: z.string().uuid(),
  type: WorkflowStageTypeSchema,
  displayName: z.string().max(100),
  enabled: z.boolean(),
  order: z.number().int().min(1).max(12),
  required: RequirementKindSchema,
  executionMode: ExecutionModeSchema,
  entryConditions: z.array(EntryConditionSchema).max(10),
  completionConditions: z.array(CompletionConditionSchema).max(10),
  failureBehaviour: FailureBehaviourSchema,
  retryLimit: z.number().int().min(0).max(10).default(3),
  executionProfileId: z.string().max(100).optional(),
  contextProfileId: z.string().max(100).optional(),
  tokenBudget: z.number().int().min(1000).max(1_000_000).default(12_000),
  requiredEvidenceTypes: z.array(z.string().max(100)).max(20),
  blockingFindingSeverities: z.array(z.enum(["info", "low", "medium", "high", "critical"])).max(5),
  state: WorkflowStateSchema,
  workItemIds: z.array(z.string().uuid()).max(500),
  validationRunIds: z.array(z.string().uuid()).max(100),
  reviewFindingIds: z.array(z.string().uuid()).max(100),
  completionRecordId: z.string().uuid().optional(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
});
export type WorkflowStage = z.infer<typeof WorkflowStageSchema>;

// ============================================================================
// Work item
// ============================================================================

export const WorkItemSchema = z.object({
  id: z.string().uuid(),
  stageId: z.string().uuid(),
  title: z.string().max(500),
  description: z.string().max(10_000),
  objective: z.string().max(5_000),
  category: z.string().max(100),
  dependencies: z.array(z.string().uuid()).max(100),
  requiredCapabilities: z.array(z.string().max(100)).max(30),
  executionRoute: z.enum(["deterministic", "github-copilot", "manual", "unsupported"]).optional(),
  risk: z.enum(["low", "medium", "high", "critical"]).optional(),
  optional: z.boolean().optional(),
  staleReasons: z.array(z.string().max(500)).max(20),
  baseEntityFingerprints: z.record(z.string(), z.string()),
  originalTaskId: z.string().uuid().optional(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
});
export type WorkItem = z.infer<typeof WorkItemSchema>;

// ============================================================================
// Workflow
// ============================================================================

export const WorkflowSchema = z.object({
  id: z.string().uuid(),
  repositoryId: z.string().max(1000),
  branch: z.string().max(500).optional(),
  baseCommit: z.string().max(500).optional(),
  intelligenceGeneration: z.number().int().nonnegative(),
  intentId: z.string().uuid(),
  intentRevision: z.number().int().positive(),
  specificationId: z.string().uuid(),
  specificationRevision: z.number().int().positive(),
  workType: WorkflowWorkTypeSchema,
  sdlcFlowConfigId: z.string().uuid(),
  stages: z.array(WorkflowStageSchema).min(1).max(12),
  workItems: z.array(WorkItemSchema).max(500),
  contextPackages: z.array(ContextItemSchema).max(500),
  delegationRuns: z
    .array(
      z.object({
        id: z.string().uuid(),
        workItemId: z.string().uuid(),
        agentId: z.string().max(200),
        contextPackageId: z.string().uuid(),
        status: z.string(),
        startedAt: z.string().datetime().optional(),
        completedAt: z.string().datetime().optional(),
      }),
    )
    .max(100),
  validationRuns: z.array(z.string().uuid()).max(100),
  reviewFindingIds: z.array(z.string().uuid()).max(100),
  completionRecordId: z.string().uuid().optional(),
  status: WorkflowStatusSchema,
  currentStageId: z.string().uuid().optional(),
  blockingStageIds: z.array(z.string().uuid()).max(12),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
  startedAt: z.string().datetime().optional(),
  completedAt: z.string().datetime().optional(),
});
export type Workflow = z.infer<typeof WorkflowSchema>;

// ============================================================================
// Persistence
// ============================================================================

export const WorkflowPersistentStateSchema = z.object({
  schemaVersion: z.literal(WORKFLOW_SCHEMA_VERSION),
  revision: z.number().int().nonnegative(),
  workflows: z.array(WorkflowSchema).max(100),
  updatedAt: z.string().datetime(),
});
export type WorkflowPersistentState = z.infer<typeof WorkflowPersistentStateSchema>;

// ============================================================================
// Payloads
// ============================================================================

export const WorkflowCreatePayloadSchema = z.object({
  workflowId: z.string().uuid(),
  definitionId: z.string().max(100).optional(),
  policyProfileId: z.string().max(100).default("guided"),
});
export type WorkflowCreatePayload = z.infer<typeof WorkflowCreatePayloadSchema>;

export const WorkflowDecisionPayloadSchema = z.object({
  workflowId: z.string().uuid(),
  decisionId: z.string().uuid(),
  resolution: z.string().min(1).max(5_000),
  riskAcknowledged: z.boolean().default(false),
  reason: z.string().max(2_000).optional(),
});
export type WorkflowDecisionPayload = z.infer<typeof WorkflowDecisionPayloadSchema>;

export const WorkflowEventPayloadSchema = z.object({
  workflowId: z.string().uuid(),
  revision: z.number().int().nonnegative(),
  status: z.string().max(100),
  message: z.string().max(2_000).optional(),
});
export type WorkflowEventPayload = z.infer<typeof WorkflowEventPayloadSchema>;

// ============================================================================
// Records
// ============================================================================

export const WorkflowClarificationSchema = z.object({
  id: z.string().uuid(),
  workflowId: z.string().uuid(),
  question: z.string().min(1).max(2_000),
  whyItMatters: z.string().min(1).max(2_000),
  evidenceReferences: z.array(z.string().max(500)).max(100),
  options: z.array(z.string().max(1_000)).max(20),
  answer: z.string().max(5_000).optional(),
  status: z.enum(["open", "answered", "deferred", "not-applicable"]),
  blocking: z.boolean(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
});
export type WorkflowClarification = z.infer<typeof WorkflowClarificationSchema>;

export const WorkflowDecisionRecordSchema = z.object({
  id: z.string().uuid(),
  workflowId: z.string().uuid(),
  sourceClarificationId: z.string().uuid().optional(),
  title: z.string().min(1).max(500),
  decision: z.string().min(1).max(5_000),
  rationale: z.string().max(5_000).optional(),
  evidenceReferences: z.array(z.string().max(500)).max(100),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
});
export type WorkflowDecisionRecord = z.infer<typeof WorkflowDecisionRecordSchema>;

export type WorkflowClarificationPayload = z.infer<typeof WorkflowClarificationSchema>;
export type WorkflowDecisionRecordPayload = z.infer<typeof WorkflowDecisionRecordSchema>;

// ============================================================================
// Execution profile
// ============================================================================

export const ExecutionProfileSchema = z.object({
  id: z.string().uuid(),
  name: z.string().max(100),
  description: z.string().max(1_000),
  maxConcurrency: z.number().int().min(1).max(10).default(3),
  timeoutMs: z.number().int().min(1_000).max(14_400_000).default(30_000),
  retryStrategy: z.object({
    maxRetries: z.number().int().min(0).max(10).default(3),
    backoffMs: z.number().int().min(1_000).max(60_000).default(5_000),
  }),
  capabilities: z.array(z.string().max(100)).max(30),
  restrictions: z.array(z.string().max(100)).max(30),
});
export type ExecutionProfile = z.infer<typeof ExecutionProfileSchema>;

// ============================================================================
// Context profile
// ============================================================================

export const ContextProfileSchema = z.object({
  id: z.string().uuid(),
  name: z.string().max(100),
  description: z.string().max(1_000),
  defaultBudget: ContextBudgetSchema,
  mandatoryItemKinds: z.array(z.string().max(100)).max(20),
  excludedItemKinds: z.array(z.string().max(100)).max(20),
  relationshipDepth: z.number().int().min(0).max(5).default(2),
  maxFiles: z.number().int().min(1).max(200).default(30),
});
export type ContextProfile = z.infer<typeof ContextProfileSchema>;

// ============================================================================
// Re-export all types (already defined above via z.infer)
// ============================================================================
