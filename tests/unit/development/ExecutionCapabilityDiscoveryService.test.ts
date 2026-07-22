import { describe, expect, it } from "vitest";
import { ExecutionCapabilityDiscoveryService } from "../../../src/core/development/ExecutionCapabilityDiscoveryService";

describe("ExecutionCapabilityDiscoveryService", () => {
  it("returns only verified modes and never invents a fallback agent", async () => {
    const service = new ExecutionCapabilityDiscoveryService({
      clipboardAvailable: async () => true,
      registeredCommands: async () => ["workbench.action.chat.open"],
      discoveredAgents: async () => [],
    });
    const result = await service.discover([]);
    expect(result.capabilities.find((item) => item.kind === "clipboard-handoff")).toMatchObject({ availability: "available", source: "vscode-api" });
    expect(result.capabilities.find((item) => item.kind === "chat-command-handoff")).toMatchObject({ availability: "available", commandId: "workbench.action.chat.open" });
    expect(result.capabilities.find((item) => item.kind === "direct-agent-invocation")).toMatchObject({ availability: "unavailable" });
    expect(result.agents).toEqual([]);
  });

  it("reports unavailable clipboard and discovery diagnostics honestly", async () => {
    const service = new ExecutionCapabilityDiscoveryService({
      clipboardAvailable: async () => false,
      registeredCommands: async () => [],
      discoveredAgents: async () => { throw new Error("participant API unavailable"); },
    });
    const result = await service.discover([]);
    expect(result.capabilities.find((item) => item.kind === "clipboard-handoff")).toMatchObject({ availability: "unavailable", diagnostic: { code: "clipboard-unavailable" } });
    expect(result.diagnostics[0]?.message).toContain("participant API unavailable");
  });

  it("returns manual agents separately and validates configured commands", async () => {
    const service = new ExecutionCapabilityDiscoveryService({ clipboardAvailable: async () => true, registeredCommands: async () => ["valid.chat"], discoveredAgents: async () => [] });
    const result = await service.discover([{ id: crypto.randomUUID(), displayName: "Local helper", chatCommandId: "missing.chat", createdAt: "2026-07-22T00:00:00.000Z", updatedAt: "2026-07-22T00:00:00.000Z" }]);
    expect(result.manualAgents[0]).toMatchObject({ displayName: "Local helper", commandAvailable: false });
    expect(result.agents).toEqual([]);
  });
});
