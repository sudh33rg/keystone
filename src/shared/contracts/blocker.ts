import { z } from "zod";

/**
 * BlockerCategory identifies the type of blocker.
 */
export const BlockerCategorySchema = z.enum([
  "capability-unavailable",
  "intelligence-incomplete",
  "stale-data",
  "configuration-missing",
  "approval-required",
  "context-incomplete",
  "execution-failed",
  "validation-failed",
  "policy-violation",
  "source-conflict",
  "migration-issue",
  "storage-issue",
  "unsupported-feature",
  "user-action-required",
]);
export type BlockerCategory = z.infer<typeof BlockerCategorySchema>;

/**
 * BlockerSeverity indicates how urgent the blocker is.
 */
export const BlockerSeveritySchema = z.enum(["info", "warning", "error", "critical"]);
export type BlockerSeverity = z.infer<typeof BlockerSeveritySchema>;

/**
 * Blocker represents a blocker encountered during workflow execution.
 */
export const BlockerSchema = z.object({
  id: z.string().uuid(),
  category: BlockerCategorySchema,
  code: z.string().max(100),
  title: z.string().max(200),
  explanation: z.string().max(1000),
  affectedWorkflowId: z.string().uuid().optional(),
  affectedStageId: z.string().uuid().optional(),
  severity: BlockerSeveritySchema,
  recoverability: z.boolean().default(false),
  suggestedAction: z.string().max(500),
  directAction: z.string().max(500).optional(),
  evidence: z.array(z.string().max(1000)).max(30),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
  resolvedAt: z.string().datetime().optional(),
  resolvedBy: z.string().max(200).optional(),
});
export type Blocker = z.infer<typeof BlockerSchema>;

/**
 * BlockerRequest is sent to create a blocker.
 */
export const BlockerRequestSchema = z.object({
  workflowId: z.string().uuid().optional(),
  stageId: z.string().uuid().optional(),
  category: BlockerCategorySchema,
  code: z.string().max(100),
  title: z.string().max(200),
  explanation: z.string().min(1).max(1000),
  severity: BlockerSeveritySchema,
  recoverability: z.boolean().default(false),
  suggestedAction: z.string().min(1).max(500),
  directAction: z.string().max(500).optional(),
  evidence: z.array(z.string().max(1000)).max(30),
});
export type BlockerRequest = z.infer<typeof BlockerRequestSchema>;

/**
 * BlockerDecision is the response from a blocker resolution.
 */
export const BlockerDecisionSchema = z.object({
  blockerId: z.string().uuid(),
  status: z.enum(["open", "resolved"]),
  reason: z.string().max(2000).optional(),
});
export type BlockerDecision = z.infer<typeof BlockerDecisionSchema>;
