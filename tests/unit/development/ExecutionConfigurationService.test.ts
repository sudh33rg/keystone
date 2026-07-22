import { describe, expect, it } from "vitest";
import { ExecutionConfigurationService } from "../../../src/core/development/ExecutionConfigurationService";

const workflowId = crypto.randomUUID(); const workItemId = crypto.randomUUID();
const capability = { id: "clipboard", kind: "clipboard-handoff" as const, displayName: "Clipboard Handoff", availability: "available" as const, source: "vscode-api" as const };
const instruction = { id: "instruction:a", name: "a.md", workspaceRelativePath: ".github/a.md", uri: "file:///repo/.github/a.md", sourceType: "repository" as const, contentHash: "a".repeat(64), sizeBytes: 20, availability: "available" as const };
const skill = { id: "keystone-development", name: "Development", description: "Implement", applicableStageTypes: ["development"], promptFragment: "Implement and list files changed.", expectedOutput: { summaryRequired: true, changedFilesRequired: true, testsRequired: true, assumptionsRequired: true }, source: "keystone-built-in" as const, contentHash: "b".repeat(64), version: 1 };

function fixture(agents: Array<{ id: string; displayName: string; supportedInvocationModes: Array<"chat-command-handoff" | "direct-agent-invocation">; availability: "available" | "unavailable" }> = []) {
  let stored: unknown; let invalidations = 0;
  const service = new ExecutionConfigurationService({ read: async () => stored, write: async (value) => { stored = structuredClone(value); } }, {
    discoverCapabilities: async () => ({ capabilities: [capability], agents, manualAgents: [], diagnostics: [] }),
    discoverInstructions: async () => ({ sources: [instruction], diagnostics: [] }),
    previewInstruction: async () => ({ ...instruction, content: "Run tests." }),
    listSkills: () => [skill],
    conflicts: () => [],
    invalidatePrompt: async () => { invalidations += 1; },
  });
  return { service, read: () => stored, invalidations: () => invalidations };
}

describe("ExecutionConfigurationService", () => {
  it("refuses prompt context before a valid profile is saved", async () => {
    const { service } = fixture(); await service.initialize();
    await expect(service.promptContext(workflowId, workItemId)).rejects.toMatchObject({ code: "execution-profile-invalid" });
  });
  it("persists and restores a valid authoritative profile", async () => {
    const { service, read } = fixture(); await service.initialize();
    const saved = await service.saveProfile({ workflowId, workItemId, executionCapabilityId: capability.id, skillId: skill.id, instructionIds: [instruction.id] }, "save");
    expect(saved.profile).toMatchObject({ workflowId, workItemId, status: "valid", executionCapabilityId: capability.id, skillId: skill.id, instructionIds: [instruction.id] });
    const persisted = read();
    const restored = new ExecutionConfigurationService({ read: async () => persisted, write: async () => undefined }, service.dependencies);
    await restored.initialize();
    expect((await restored.load(workflowId, workItemId)).profile?.contentHash).toBe(saved.profile?.contentHash);
  });

  it("rejects unavailable modes, instructions, and missing skills", async () => {
    const { service } = fixture(); await service.initialize();
    await expect(service.saveProfile({ workflowId, workItemId, executionCapabilityId: "direct", skillId: skill.id, instructionIds: [] }, "a")).rejects.toMatchObject({ code: "capability-unavailable" });
    await expect(service.saveProfile({ workflowId, workItemId, executionCapabilityId: capability.id, skillId: "missing", instructionIds: [] }, "b")).rejects.toMatchObject({ code: "skill-not-found" });
    await expect(service.saveProfile({ workflowId, workItemId, executionCapabilityId: capability.id, skillId: skill.id, instructionIds: ["missing"] }, "c")).rejects.toMatchObject({ code: "instruction-not-found" });
  });

  it("invalidates a prepared prompt when mode, skill, or instruction selection changes", async () => {
    const { service, invalidations } = fixture(); await service.initialize();
    await service.saveProfile({ workflowId, workItemId, executionCapabilityId: capability.id, skillId: skill.id, instructionIds: [instruction.id] }, "first");
    await service.saveProfile({ workflowId, workItemId, executionCapabilityId: capability.id, skillId: skill.id, instructionIds: [] }, "second");
    expect(invalidations()).toBe(2);
  });

  it("separates and persists manual agents", async () => {
    const { service } = fixture(); await service.initialize();
    const created = await service.createManualAgent({ displayName: "My local helper", chatCommandId: "missing.chat", usageNote: "Clipboard only" }, "agent");
    expect(created.manualAgents[0]).toMatchObject({ displayName: "My local helper", commandAvailable: false });
  });

  it("persists an existing discovered agent selected from the agent dropdown", async () => {
    const discovered = { id: "existing-agent", displayName: "Existing Agent", supportedInvocationModes: ["chat-command-handoff" as const], availability: "available" as const };
    const { service } = fixture([discovered]); await service.initialize();
    const saved = await service.saveProfile({ workflowId, workItemId, executionCapabilityId: capability.id, agentConfigurationId: discovered.id, skillId: skill.id, instructionIds: [] }, "discovered-agent");
    expect(saved.profile?.agentConfigurationId).toBe(discovered.id);
  });
});
