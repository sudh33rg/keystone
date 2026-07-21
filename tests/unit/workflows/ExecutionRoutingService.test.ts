import { describe, expect, it } from "vitest";
import { ExecutionRoutingService } from "../../../src/core/workflows/ExecutionRoutingService";

describe("ExecutionRoutingService", () => {
  const routing = new ExecutionRoutingService();

  it.each([
    "repository-indexing",
    "graph-creation",
    "query-execution",
    "specification-facts",
    "context-construction",
    "validation",
  ] as const)("routes %s deterministically", (operation) => {
    expect(routing.decide({ operation, copilotAvailable: false })).toMatchObject({
      route: "deterministic",
      userApprovalRequired: false,
    });
  });

  it("routes implementation only to capability-proven GitHub Copilot", () => {
    expect(
      routing.decide({
        operation: "code-implementation",
        copilotAvailable: true,
        copilotAgentId: "agent.fixture",
      }),
    ).toMatchObject({
      route: "github-copilot",
      copilotAgentId: "agent.fixture",
      userApprovalRequired: true,
    });
    expect(
      routing.decide({ operation: "code-implementation", copilotAvailable: false }),
    ).toMatchObject({ route: "unsupported", userApprovalRequired: true });
  });

  it("routes Git mutations to explicit manual approval and has no hidden provider fallback", () => {
    const decision = routing.decide({ operation: "git-operation", copilotAvailable: true });
    expect(decision).toMatchObject({ route: "manual", userApprovalRequired: true });
    expect(JSON.stringify(decision)).not.toMatch(/local.model|hybrid|training/i);
  });
});
