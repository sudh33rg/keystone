import { z } from "zod";
import { ExecutionRouteSchema } from "./routing";
import { RepositoryStateRefSchema, StalenessRecordSchema } from "./integration";

export const ORCHESTRATION_SCHEMA_VERSION = 1 as const;
/**
 * @deprecated Use WorkflowStatusSchema from '@keystone/shared/contracts/workflow' instead.
 * This schema is deprecated in favor of the canonical workflow model.
 */
export const WorkflowStatusSchema = z.enum(["draft", "awaiting-review", "awaiting-approval", "ready", "running", "paused", "blocked", "awaiting-user-action", "validation-failed", "cancelling", "cancelled", "recovering", "delivery-ready", "completed", "completed-with-warnings", "failed", "stale", "superseded"]);
export type WorkflowStatusType = z.infer<typeof WorkflowStatusSchema>;
/**
 * @deprecated Use WorkflowStageTypeSchema from '@keystone/shared/contracts/workflow' instead.
 * This schema is deprecated in favor of the canonical workflow model.
 */
export const WorkflowStageSchema = z.enum(["intent-review", "specification-review", "task-plan-review", "readiness-analysis", "implementation", "unit-validation", "integration-validation", "qa-review", "security-review", "performance-review", "documentation", "final-validation", "delivery-readiness", "completed"]);
export type WorkflowStageType = z.infer<typeof WorkflowStageSchema>;
/**
 * @deprecated Use WorkflowWorkTypeSchema from '@keystone/shared/contracts/workflow' instead.
 * This schema is deprecated in favor of the canonical workflow model.
 */
export const WorkflowDefinitionIdSchema = z.enum(["quick-fix", "feature-development", "bug-fix", "refactoring", "modernization", "security-remediation"]);
export const ExecutionModeSchema = z.enum(["manual", "guided", "approval-gated"]);
export const ConflictClassificationSchema = z.enum(["safe-read-only", "independent", "shared-contract", "shared-file", "conflicting", "unknown"]);
/**
 * @deprecated Use the new work item model from '@keystone/shared/contracts/workflow'.
 * This schema is deprecated in favor of the canonical workflow model.
 */
export const OrchestrationTaskStatusSchema = z.enum(["pending", "ready", "active", "blocked", "validating", "completed", "failed", "cancelled", "stale", "skipped"]);
export type OrchestrationTaskStatus = z.infer<typeof OrchestrationTaskStatusSchema>;
export const FindingCategorySchema = z.enum(["qa", "security", "performance", "validation", "documentation"]);

const DiagnosticSchema = z.object({ code: z.string().min(1).max(100), severity: z.enum(["info", "warning", "error"]), message: z.string().min(1).max(2000), taskId: z.string().uuid().optional() }).strict();
const AuditSchema = z.object({ id: z.string().uuid(), action: z.string().min(1).max(100), actor: z.enum(["user", "keystone", "recovery"]), workflowStatus: WorkflowStatusSchema, taskId: z.string().uuid().optional(), reason: z.string().min(1).max(2000), evidence: z.array(z.string().max(1000)).max(50), at: z.string().datetime() }).strict();
const GateSchema = z.object({ id: z.string().uuid(), kind: z.enum(["workflow-plan", "specification", "task-plan", "agent", "context", "delegation", "mutating-command", "retry", "security-finding", "performance-finding", "task-completion", "workflow-completion", "delivery-readiness", "git-staging", "commit", "push", "pr-creation"]), status: z.enum(["pending", "approved", "rejected", "changes-requested", "overridden"]), taskId: z.string().uuid().optional(), requestedAction: z.string().max(2000), evidence: z.array(z.string().max(1000)).max(50), risks: z.array(z.string().max(1000)).max(30), alternatives: z.array(z.string().max(1000)).max(20), actor: z.enum(["user", "keystone"]).optional(), reason: z.string().max(2000).optional(), decidedAt: z.string().datetime().optional(), createdAt: z.string().datetime() }).strict();
const FindingSchema = z.object({ id: z.string().uuid(), category: FindingCategorySchema, taskId: z.string().uuid().optional(), rule: z.string().max(200), severity: z.enum(["info", "low", "medium", "high", "critical"]), message: z.string().max(2000), evidence: z.array(z.string().max(1000)).max(50), confidence: z.number().min(0).max(1), limitations: z.array(z.string().max(1000)).max(20), blocking: z.boolean(), status: z.enum(["open", "accepted", "resolved", "rejected"]) }).strict();

/**
 * @deprecated Use WorkflowStageConfigSchema from '@keystone/shared/contracts/workflow' instead.
 * This schema is deprecated in favor of the canonical workflow model.
 */
export const WorkflowDefinitionSchema = z.object({ id: WorkflowDefinitionIdSchema, name: z.string().max(200), description: z.string().max(1000), stages: z.array(z.object({ stage: WorkflowStageSchema, optional: z.boolean(), condition: z.string().max(1000).optional() }).strict()).min(1).max(20), requiredGates: z.array(GateSchema.shape.kind).max(20) }).strict();
/**
 * @deprecated Use the new workflow model from '@keystone/shared/contracts/workflow'.
 * This schema is deprecated in favor of the canonical workflow model.
 */
export const WorkflowPolicySchema = z.object({ id: z.string().min(1).max(100), name: z.string().max(200), executionMode: ExecutionModeSchema, requiredApprovals: z.array(GateSchema.shape.kind).max(20), maximumRetries: z.number().int().min(0).max(10), parallelReadOperations: z.number().int().min(1).max(8), serializeWrites: z.literal(true), allowedCopilotCapabilities: z.array(z.string().max(100)).max(30), contextApproval: z.boolean(), validationRequired: z.boolean(), qaRequired: z.boolean(), securityTriggers: z.array(z.string().max(100)).max(30), performanceTriggers: z.array(z.string().max(100)).max(30), documentationRequired: z.boolean(), completionApproval: z.boolean(), deliveryBoundary: z.literal("delivery-ready"), stalenessToleranceGenerations: z.number().int().min(0).max(10), maxTasks: z.number().int().min(1).max(500), maxAudit: z.number().int().min(100).max(5000) }).strict();

/**
 * @deprecated Use WorkItemSchema from '@keystone/shared/contracts/workflow' instead.
 * This schema is deprecated in favor of the canonical workflow model.
 */
export const WorkflowTaskStateSchema = z.object({ taskId: z.string().uuid(), title: z.string().max(500), status: OrchestrationTaskStatusSchema, dependencies: z.array(z.string().uuid()).max(100), priority: z.number().int().min(0).max(100), risk: z.enum(["low", "medium", "high", "critical"]), readOnly: z.boolean(), expectedFiles: z.array(z.string().max(1024)).max(200), expectedEntityIds: z.array(z.string().max(500)).max(200), route: ExecutionRouteSchema, requiredCapabilities: z.array(z.string().max(100)).max(30), readinessBlockers: z.array(DiagnosticSchema).max(100), warnings: z.array(DiagnosticSchema).max(100), activeExecutionId: z.string().uuid().optional(), validationRunIds: z.array(z.string().uuid()).max(100), retryCount: z.number().int().nonnegative(), selectedAgentId: z.string().max(200).optional(), contextFingerprint: z.string().max(500).optional(), repositoryBaselineFingerprint: z.string().max(500).optional(), updatedAt: z.string().datetime() }).strict();
/**
 * @deprecated Use the new workflow model from '@keystone/shared/contracts/workflow'.
 * This schema is deprecated in favor of the canonical workflow model.
 */
export const WorkflowPlanSchema = z.object({ id: z.string().uuid(), workflowId: z.string().uuid(), definitionId: WorkflowDefinitionIdSchema, specificationRevision: z.number().int().positive(), approved: z.boolean(), stages: z.array(z.object({ stage: WorkflowStageSchema, optional: z.boolean(), omitted: z.boolean(), omissionReason: z.string().max(1000).optional(), taskIds: z.array(z.string().uuid()).max(500), gates: z.array(GateSchema.shape.kind).max(20) }).strict()).max(20), schedule: z.array(z.string().uuid()).max(500), conflictFingerprint: z.string().max(500), createdAt: z.string().datetime(), approvedAt: z.string().datetime().optional() }).strict();
/**
 * @deprecated Use the new workflow model from '@keystone/shared/contracts/workflow'.
 * This schema is deprecated in favor of the canonical workflow model.
 */
export const WorkflowProgressSchema = z.object({ totalTasks: z.number().int().nonnegative(), readyTasks: z.number().int().nonnegative(), activeTasks: z.number().int().nonnegative(), blockedTasks: z.number().int().nonnegative(), validatingTasks: z.number().int().nonnegative(), completedTasks: z.number().int().nonnegative(), staleTasks: z.number().int().nonnegative(), failedTasks: z.number().int().nonnegative(), pendingApprovals: z.number().int().nonnegative(), blockingFindings: z.number().int().nonnegative(), deliveryReady: z.boolean(), percentage: z.number().min(0).max(100), calculation: z.string().max(1000) }).strict();

/**
 * @deprecated Use WorkflowSchema from '@keystone/shared/contracts/workflow' instead.
 * This schema is deprecated in favor of the canonical workflow model.
 */
export const WorkflowInstanceSchema = z.object({ schemaVersion: z.literal(ORCHESTRATION_SCHEMA_VERSION), id: z.string().uuid(), intentId: z.string().uuid(), specificationId: z.string().uuid(), specificationRevision: z.number().int().positive(), taskPlanId: z.string().uuid(), repositoryId: z.string().max(1000), branch: z.string().max(500), baseCommit: z.string().max(500), intelligenceGeneration: z.number().int().nonnegative(), repositoryState: RepositoryStateRefSchema.optional(), staleness: z.array(StalenessRecordSchema).max(200).default([]), definitionId: WorkflowDefinitionIdSchema, policyProfileId: z.string().max(100), status: WorkflowStatusSchema, currentStage: WorkflowStageSchema.optional(), taskStates: z.array(WorkflowTaskStateSchema).max(500), approvalGates: z.array(GateSchema).max(1000), activeExecutionIds: z.array(z.string().uuid()).max(100), validationRunIds: z.array(z.string().uuid()).max(500), findings: z.array(FindingSchema).max(1000), plan: WorkflowPlanSchema.optional(), diagnostics: z.array(DiagnosticSchema).max(200), audit: z.array(AuditSchema).max(5000), progress: WorkflowProgressSchema, metrics: z.object({ startedAtMs: z.number().nonnegative().optional(), workflowDurationMs: z.number().nonnegative(), waitingForUserMs: z.number().nonnegative(), delegationCount: z.number().int().nonnegative(), validationDurationMs: z.number().nonnegative(), retryCount: z.number().int().nonnegative(), staleCount: z.number().int().nonnegative(), cancellationCount: z.number().int().nonnegative(), approvalCount: z.number().int().nonnegative() }).strict(), createdAt: z.string().datetime(), updatedAt: z.string().datetime(), startedAt: z.string().datetime().optional(), completedAt: z.string().datetime().optional() }).strict();
/**
 * @deprecated Use Workflow from '@keystone/shared/contracts/workflow' instead.
 * This type is deprecated in favor of the canonical workflow model.
 */
export type WorkflowInstance = z.infer<typeof WorkflowInstanceSchema>;
/**
 * @deprecated Use WorkflowStatus from '@keystone/shared/contracts/workflow' instead.
 * This type is deprecated in favor of the canonical workflow model.
 */
export type WorkflowStatus = z.infer<typeof WorkflowStatusSchema>;
/**
 * @deprecated Use WorkflowWorkType from '@keystone/shared/contracts/workflow' instead.
 * This type is deprecated in favor of the canonical workflow model.
 */
export type WorkflowDefinition = z.infer<typeof WorkflowDefinitionSchema>;
/**
 * @deprecated Use the new workflow model from '@keystone/shared/contracts/workflow'.
 * This type is deprecated in favor of the canonical workflow model.
 */
export type WorkflowPolicy = z.infer<typeof WorkflowPolicySchema>;

/**
 * @deprecated Use WorkflowPersistentStateSchema from '@keystone/shared/contracts/workflow' instead.
 * This schema is deprecated in favor of the canonical workflow model.
 */
export const OrchestrationPersistentStateSchema = z.object({ schemaVersion: z.literal(ORCHESTRATION_SCHEMA_VERSION), revision: z.number().int().nonnegative(), instances: z.array(WorkflowInstanceSchema).max(100), updatedAt: z.string().datetime() }).strict();
export type OrchestrationPersistentState = z.infer<typeof OrchestrationPersistentStateSchema>;

/**
 * @deprecated Use WorkflowCreatePayloadSchema from '@keystone/shared/contracts/workflow' instead.
 * This schema is deprecated in favor of the canonical workflow model.
 */
export const OrchestrationCreatePayloadSchema = z.object({ workflowId: z.string().uuid(), definitionId: WorkflowDefinitionIdSchema.optional(), policyProfileId: z.string().max(100).default("guided") }).strict();
export const OrchestrationIdPayloadSchema = z.object({ orchestrationId: z.string().uuid() }).strict();
/**
 * @deprecated Use WorkflowDecisionPayloadSchema from '@keystone/shared/contracts/workflow' instead.
 * This schema is deprecated in favor of the canonical workflow model.
 */
export const OrchestrationDecisionPayloadSchema = OrchestrationIdPayloadSchema.extend({ gateId: z.string().uuid(), decision: z.enum(["approved", "rejected", "changes-requested", "overridden"]), reason: z.string().min(1).max(2000), riskAcknowledged: z.boolean().default(false) }).strict();
/**
 * @deprecated Use the new workflow model from '@keystone/shared/contracts/workflow'.
 * This schema is deprecated in favor of the canonical workflow model.
 */
export const OrchestrationTaskPayloadSchema = OrchestrationIdPayloadSchema.extend({ taskId: z.string().uuid() }).strict();
/**
 * @deprecated Use the new workflow model from '@keystone/shared/contracts/workflow'.
 * This schema is deprecated in favor of the canonical workflow model.
 */
export const OrchestrationTaskActionPayloadSchema = OrchestrationTaskPayloadSchema.extend({ reason: z.string().min(1).max(2000), agentId: z.string().max(200).optional() }).strict();
/**
 * @deprecated Use the new workflow model from '@keystone/shared/contracts/workflow'.
 * This schema is deprecated in favor of the canonical workflow model.
 */
export const OrchestrationReviewPlanSchema = z.object({ category: z.enum(["qa", "security", "performance", "documentation", "validation"]), triggered: z.boolean(), reasons: z.array(z.string().max(2000)).max(50), taskIds: z.array(z.string().uuid()).max(500), requiredChecks: z.array(z.string().max(500)).max(100), limitations: z.array(z.string().max(2000)).max(30) }).strict();
export type OrchestrationReviewPlan = z.infer<typeof OrchestrationReviewPlanSchema>;
/**
 * @deprecated Use the new workflow model from '@keystone/shared/contracts/workflow'.
 * This schema is deprecated in favor of the canonical workflow model.
 */
export const OrchestrationFindingPayloadSchema = OrchestrationIdPayloadSchema.extend({ findingId: z.string().uuid(), reason: z.string().min(1).max(2000) }).strict();
/**
 * @deprecated Use the new workflow model from '@keystone/shared/contracts/workflow'.
 * This schema is deprecated in favor of the canonical workflow model.
 */
export const OrchestrationRecoverPayloadSchema = OrchestrationIdPayloadSchema.extend({ repositoryId: z.string().max(1000), branch: z.string().max(500), headCommit: z.string().max(500), intelligenceGeneration: z.number().int().nonnegative() }).strict();
/**
 * @deprecated Use WorkflowEventPayloadSchema from '@keystone/shared/contracts/workflow' instead.
 * This schema is deprecated in favor of the canonical workflow model.
 */
export const OrchestrationEventSchema = z.object({ orchestrationId: z.string().uuid(), status: WorkflowStatusSchema, stage: WorkflowStageSchema.optional(), taskId: z.string().uuid().optional(), message: z.string().max(2000), at: z.string().datetime() }).strict();
