import { z } from "zod";

export const CANONICAL_WORKFLOW_SCHEMA_VERSION = 1 as const;
export const CanonicalWorkflowWorkTypeSchema = z.enum(["feature", "bug-fix", "refactor", "test-work", "investigation"]);
export const CanonicalWorkflowStatusSchema = z.enum(["draft", "active", "completed", "cancelled", "blocked"]);
export const CanonicalWorkflowStageStatusSchema = z.enum(["ready", "not-ready", "completed"]);
export const CanonicalWorkflowStageTypeSchema = z.enum(["understand", "plan", "development", "impact-analysis", "qa", "pr-review", "test-work", "investigation", "complete"]);

export const CanonicalWorkflowStageSummarySchema = z.object({
  id: z.string().uuid(),
  type: CanonicalWorkflowStageTypeSchema,
  displayName: z.string().min(1).max(100),
  order: z.number().int().positive().max(12),
  status: CanonicalWorkflowStageStatusSchema,
  required: z.boolean(),
}).strict();

export const CanonicalWorkflowSchema = z.object({
  schemaVersion: z.literal(CANONICAL_WORKFLOW_SCHEMA_VERSION),
  id: z.string().uuid(),
  intent: z.object({ text: z.string().trim().min(1).max(10_000), workType: CanonicalWorkflowWorkTypeSchema }).strict(),
  specification: z.object({ text: z.string().trim().min(1).max(50_000), revision: z.number().int().positive() }).strict().optional(),
  status: CanonicalWorkflowStatusSchema,
  stages: z.array(CanonicalWorkflowStageSummarySchema).min(1).max(12),
  currentStageId: z.string().uuid().nullable(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
}).strict();

export const CreateCanonicalWorkflowInputSchema = z.object({
  intent: z.string().trim().min(1).max(10_000),
  workType: CanonicalWorkflowWorkTypeSchema,
  specification: z.string().trim().min(1).max(50_000).optional(),
}).strict();

export const CanonicalWorkflowPersistentStateSchema = z.object({
  schemaVersion: z.literal(CANONICAL_WORKFLOW_SCHEMA_VERSION),
  revision: z.number().int().nonnegative(),
  workflows: z.array(CanonicalWorkflowSchema).max(1000),
  activeWorkflowId: z.string().uuid().nullable(),
  correlations: z.record(z.string().min(1).max(200), z.string().uuid()),
  updatedAt: z.string().datetime(),
}).strict();

export const WorkflowCreatedResponseSchema = z.object({ type: z.literal("workflow.created"), correlationId: z.string().min(1).max(200), workflow: CanonicalWorkflowSchema }).strict();
export const WorkflowCreationFailedResponseSchema = z.object({ type: z.literal("workflow.creationFailed"), correlationId: z.string().min(1).max(200), error: z.object({ code: z.string(), message: z.string(), recoverable: z.boolean() }).strict() }).strict();

export type CanonicalWorkflow = z.infer<typeof CanonicalWorkflowSchema>;
export type CanonicalWorkflowWorkType = z.infer<typeof CanonicalWorkflowWorkTypeSchema>;
export type CanonicalWorkflowStageSummary = z.infer<typeof CanonicalWorkflowStageSummarySchema>;
export type CreateCanonicalWorkflowInput = z.infer<typeof CreateCanonicalWorkflowInputSchema>;
export type CanonicalWorkflowPersistentState = z.infer<typeof CanonicalWorkflowPersistentStateSchema>;
export type WorkflowCreatedResponse = z.infer<typeof WorkflowCreatedResponseSchema>;
export type WorkflowCreationFailedResponse = z.infer<typeof WorkflowCreationFailedResponseSchema>;

export function canonicalWorkTypeLabel(value: CanonicalWorkflowWorkType): string {
  return ({ feature: "Feature", "bug-fix": "Bug Fix", refactor: "Refactor", "test-work": "Test Work", investigation: "Investigation" })[value];
}

export function canonicalStageOutline(workType: CanonicalWorkflowWorkType): Array<{ type: z.infer<typeof CanonicalWorkflowStageTypeSchema>; displayName: string }> {
  const stages = {
    feature: [["understand", "Understand"], ["plan", "Plan"], ["development", "Development"], ["impact-analysis", "Impact Analysis"], ["qa", "QA"], ["pr-review", "PR Review"]],
    "bug-fix": [["understand", "Understand"], ["impact-analysis", "Impact Analysis"], ["development", "Development"], ["qa", "QA"], ["pr-review", "PR Review"]],
    refactor: [["understand", "Understand"], ["impact-analysis", "Impact Analysis"], ["plan", "Plan"], ["development", "Development"], ["qa", "QA"], ["pr-review", "PR Review"]],
    "test-work": [["understand", "Understand"], ["impact-analysis", "Impact Analysis"], ["test-work", "Test Work"], ["qa", "QA"], ["pr-review", "PR Review"]],
    investigation: [["understand", "Understand"], ["investigation", "Investigation"], ["complete", "Complete"]],
  } as const;
  return stages[workType].map(([type, displayName]) => ({ type, displayName }));
}
