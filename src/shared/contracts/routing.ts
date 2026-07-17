import { z } from "zod";

export const ExecutionRouteSchema = z.enum(["deterministic", "github-copilot", "manual", "unsupported"]);
export const ExecutionOperationSchema = z.enum(["repository-indexing", "graph-creation", "query-execution", "specification-facts", "context-construction", "intent-prose", "specification-prose", "code-implementation", "complex-code-change", "validation", "git-operation", "unsupported"]);
export const ExecutionRoutingRequestSchema = z.object({ operation: ExecutionOperationSchema, copilotAgentId: z.string().min(1).max(300).optional(), copilotAvailable: z.boolean().default(false) }).strict();
export const ExecutionRoutingDecisionSchema = z.object({ operation: ExecutionOperationSchema, route: ExecutionRouteSchema, copilotAgentId: z.string().max(300).optional(), reasons: z.array(z.string().max(2_000)).min(1).max(20), limitations: z.array(z.string().max(2_000)).max(20), userApprovalRequired: z.boolean() }).strict();

export type ExecutionRoutingRequest = z.infer<typeof ExecutionRoutingRequestSchema>;
export type ExecutionRoutingDecision = z.infer<typeof ExecutionRoutingDecisionSchema>;
