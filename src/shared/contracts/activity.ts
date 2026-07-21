import { z } from "zod";

/**
 * ActivityStatus represents the current state of an activity.
 */
export const ActivityStatusSchema = z.enum([
  "queued",
  "preparing",
  "running",
  "awaiting-approval",
  "awaiting-user-input",
  "paused",
  "completed",
  "failed",
  "cancelled",
  "interrupted",
  "superseded",
]);
export type ActivityStatus = z.infer<typeof ActivityStatusSchema>;

/**
 * ActivityCategory identifies the type of activity.
 */
export const ActivityCategorySchema = z.enum([
  "ingestion",
  "graph-construction",
  "query-execution",
  "context-building",
  "delegation",
  "test-execution",
  "failure-analysis",
  "security-analysis",
  "performance-measurement",
  "pr-review",
  "validation",
  "rerun",
  "migration",
  "recovery",
]);
export type ActivityCategory = z.infer<typeof ActivityCategorySchema>;

/**
 * Activity describes a long-running operation.
 */
export const ActivitySchema = z.object({
  id: z.string().uuid(),
  workflowId: z.string().uuid().optional(),
  stageId: z.string().uuid().optional(),
  category: ActivityCategorySchema,
  title: z.string().max(200),
  status: ActivityStatusSchema,
  progress: z.number().min(0).max(100),
  currentAction: z.string().max(500),
  startedAt: z.string().datetime(),
  completedAt: z.string().datetime().optional(),
  cancelledAt: z.string().datetime().optional(),
  resultReference: z.string().max(200).optional(),
  errorReference: z.string().max(200).optional(),
  cancellationRequested: z.boolean().default(false),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
});
export type Activity = z.infer<typeof ActivitySchema>;
