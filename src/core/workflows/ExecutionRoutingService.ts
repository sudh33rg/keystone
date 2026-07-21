import {
  ExecutionRoutingDecisionSchema,
  ExecutionRoutingRequestSchema,
  type ExecutionRoutingDecision,
  type ExecutionRoutingRequest,
} from "../../shared/contracts/routing";

const DETERMINISTIC = new Set<ExecutionRoutingRequest["operation"]>([
  "repository-indexing",
  "graph-creation",
  "query-execution",
  "specification-facts",
  "context-construction",
  "intent-prose",
  "specification-prose",
  "validation",
]);
const COPILOT = new Set<ExecutionRoutingRequest["operation"]>([
  "code-implementation",
  "complex-code-change",
]);

export class ExecutionRoutingService {
  decide(input: unknown): ExecutionRoutingDecision {
    const request = ExecutionRoutingRequestSchema.parse(input);
    if (DETERMINISTIC.has(request.operation))
      return ExecutionRoutingDecisionSchema.parse({
        operation: request.operation,
        route: "deterministic",
        reasons: ["A deterministic Keystone service owns this operation."],
        limitations:
          request.operation === "intent-prose" || request.operation === "specification-prose"
            ? [
                "Current prose uses deterministic repository-aware templates; optional Copilot enrichment requires a separate explicit user action.",
              ]
            : [],
        userApprovalRequired: false,
      });
    if (request.operation === "git-operation")
      return ExecutionRoutingDecisionSchema.parse({
        operation: request.operation,
        route: "manual",
        reasons: ["Git mutations require an explicit reviewed user approval."],
        limitations: ["Keystone does not perform an unapproved Git mutation."],
        userApprovalRequired: true,
      });
    if (COPILOT.has(request.operation)) {
      if (!request.copilotAvailable)
        return ExecutionRoutingDecisionSchema.parse({
          operation: request.operation,
          route: "unsupported",
          reasons: [
            "No supported GitHub Copilot capability is currently available for implementation.",
          ],
          limitations: [
            "Keystone can still prepare and preserve the task context for later assisted delegation.",
          ],
          userApprovalRequired: true,
        });
      return ExecutionRoutingDecisionSchema.parse({
        operation: request.operation,
        route: "github-copilot",
        ...(request.copilotAgentId ? { copilotAgentId: request.copilotAgentId } : {}),
        reasons: [
          "Implementation is delegated only through a capability-proven GitHub Copilot path.",
        ],
        limitations: ["A reviewed context package and explicit delegation approval are required."],
        userApprovalRequired: true,
      });
    }
    return ExecutionRoutingDecisionSchema.parse({
      operation: request.operation,
      route: "unsupported",
      reasons: ["No current Keystone service supports this operation."],
      limitations: ["Future-roadmap providers are not active fallbacks."],
      userApprovalRequired: true,
    });
  }
}
