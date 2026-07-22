import { describe, expect, it, vi } from "vitest";
import { DelegationService, type PreparedDelegation } from "../../../src/core/execution/delegationService";
import { CapabilityDiscoveryService } from "../../../src/core/execution/capabilityDiscoveryService";
import { InstructionConflictDetector } from "../../../src/core/execution/instructionConflictDetector";

const logger = { info: vi.fn(), debug: vi.fn(), warning: vi.fn(), error: vi.fn() } as never;
const api = { getChatParticipants: async () => [], getLanguageModelProviders: async () => [], getCommands: async () => [], getExtensions: async () => [], openChatWithContent: async () => {}, copyToClipboard: async () => {}, readWorkspaceFile: async () => undefined } as never;

function prepared(mode: PreparedDelegation["delegationMode"]): PreparedDelegation {
  return { delegationMode: mode, canExecuteDirectly: mode === "direct", agentCapability: { id: "agent", name: "Agent", type: "agent", source: "test", state: "available", lastDiscovered: new Date().toISOString(), supportsDirectInvocation: true, supportsManualHandoff: true }, request: { workflowId: "w", stageId: "unknown-operation", workItemId: "i", profile: {} as never, promptPackage: {} as never } };
}

describe("execution capability honesty", () => {
  it("fails unavailable direct and unknown deterministic execution", async () => {
    const service = new DelegationService(logger, {} as never, api);
    expect((await service.executeDelegation(prepared("direct"))).status).toBe("failed");
    const deterministic = await service.executeDelegation(prepared("deterministic"));
    expect(deterministic.status).toBe("failed");
    expect(deterministic.result).toBeUndefined();
  });

  it("does not discover missing instruction files or mock conflict sources", async () => {
    const discovered = await new CapabilityDiscoveryService(logger, api).discoverCapabilities();
    expect(discovered.capabilities.filter((item) => item.type === "instruction" && "filePath" in item && item.filePath)).toEqual([]);
    const conflicts = new InstructionConflictDetector(logger).validateProfile({ instructions: [{ instructionId: "missing" }] } as never);
    expect(JSON.stringify(conflicts)).not.toContain("mock-source");
  });
});
