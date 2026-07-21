import { z } from "zod";

/**
 * RerunTrigger identifies what caused a rerun to be needed.
 */
export const RerunTriggerSchema = z.enum([
  "source-code-changed",
  "test-only-changed",
  "documentation-only-changed",
  "instruction-changed",
  "context-stale",
  "intelligence-changed",
  "specification-changed",
  "workflow-config-changed",
  "execution-profile-changed",
  "skill-changed",
]);
export type RerunTrigger = z.infer<typeof RerunTriggerSchema>;

/**
 * RerunStage identifies which stage needs to be rerun.
 */
export const RerunStageSchema = z.enum([
  "intent",
  "specification",
  "task-plan",
  "context",
  "development",
  "impact-analysis",
  "qa",
  "security",
  "performance",
  "review",
  "completion",
]);
export type RerunStage = z.infer<typeof RerunStageSchema>;

/**
 * RerunAction describes a specific action to take for a rerun.
 */
export const RerunActionSchema = z.object({
  stage: RerunStageSchema,
  action: z.string().max(100),
  reason: z.string().max(500),
  dependencies: z.array(z.string().max(100)).max(20),
});
export type RerunAction = z.infer<typeof RerunActionSchema>;

/**
 * RerunPlan provides a deterministic rerun path.
 */
export const RerunPlanSchema = z.object({
  id: z.string().uuid(),
  trigger: RerunTriggerSchema,
  stages: z.array(RerunActionSchema).min(1).max(20),
  totalEstimatedTokens: z.number().int().nonnegative(),
  createdAt: z.string().datetime(),
});
export type RerunPlan = z.infer<typeof RerunPlanSchema>;

/**
 * RerunPlanRequest is sent to request a rerun plan.
 */
export const RerunPlanRequestSchema = z.object({
  workflowId: z.string().uuid(),
  trigger: RerunTriggerSchema,
});
export type RerunPlanRequest = z.infer<typeof RerunPlanRequestSchema>;

/**
 * RerunPlanResult is the response from a rerun plan request.
 */
export const RerunPlanResultSchema = z.object({
  plan: RerunPlanSchema,
  totalAffectedWorkItems: z.number().int().nonnegative(),
});
export type RerunPlanResult = z.infer<typeof RerunPlanResultSchema>;
