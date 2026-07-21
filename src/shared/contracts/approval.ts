import { z } from "zod";

/**
 * ApprovalType identifies the kind of approval being requested.
 */
export const ApprovalTypeSchema = z.enum([
  "workflow-start",
  "stage-execution",
  "prompt-delegation",
  "broad-test-execution",
  "generated-test-changes",
  "remediation-changes",
  "expensive-security-validation",
  "expensive-performance-validation",
  "accepted-risk",
  "pr-readiness",
  "workflow-completion",
]);
export type ApprovalType = z.infer<typeof ApprovalTypeSchema>;

/**
 * ApprovalStatus represents the current state of an approval.
 */
export const ApprovalStatusSchema = z.enum(["pending", "approved", "rejected", "withdrawn"]);
export type ApprovalStatus = z.infer<typeof ApprovalStatusSchema>;

/**
 * Approval represents a pending or completed approval.
 */
export const ApprovalSchema = z.object({
  id: z.string().uuid(),
  workflowId: z.string().uuid(),
  stageId: z.string().uuid().optional(),
  type: ApprovalTypeSchema,
  action: z.string().max(500),
  impact: z.string().max(1000),
  exactScope: z.string().max(5000),
  evidence: z.array(z.string().max(1000)).max(50),
  risks: z.array(z.string().max(500)).max(20),
  expiry: z.string().datetime().optional(),
  staleness: z.string().max(500).optional(),
  previousStatus: ApprovalStatusSchema.optional(),
  status: ApprovalStatusSchema,
  actor: z.enum(["user", "keystone"]).optional(),
  reason: z.string().max(2000).optional(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
});
export type Approval = z.infer<typeof ApprovalSchema>;

/**
 * ApprovalRequest is sent to request an approval.
 */
export const ApprovalRequestSchema = z.object({
  workflowId: z.string().uuid(),
  stageId: z.string().uuid().optional(),
  type: ApprovalTypeSchema,
  action: z.string().max(500),
  impact: z.string().max(1000),
  exactScope: z.string().max(5000),
  evidence: z.array(z.string().max(1000)).max(50),
  risks: z.array(z.string().max(500)).max(20),
  expiryMinutes: z.number().int().positive().default(60),
});
export type ApprovalRequest = z.infer<typeof ApprovalRequestSchema>;

/**
 * ApprovalDecision is the response from an approval decision.
 */
export const ApprovalDecisionSchema = z.object({
  approvalId: z.string().uuid(),
  status: ApprovalStatusSchema,
  reason: z.string().max(2000).optional(),
});
export type ApprovalDecision = z.infer<typeof ApprovalDecisionSchema>;
