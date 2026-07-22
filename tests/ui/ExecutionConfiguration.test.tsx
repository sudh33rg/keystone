// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ExecutionConfiguration } from "../../src/ui/components/workbench/ExecutionConfiguration";
import type { HostBridge } from "../../src/ui/services/HostBridge";

afterEach(cleanup);
const workflowId = crypto.randomUUID(), workItemId = crypto.randomUUID();
const aggregate = {
  capabilities: [
    { id: "clipboard", kind: "clipboard-handoff", displayName: "Clipboard Handoff", availability: "available", source: "vscode-api" },
    { id: "direct", kind: "direct-agent-invocation", displayName: "Direct Invocation", availability: "unavailable", source: "keystone", diagnostic: { code: "unsupported-direct-invocation", message: "No supported direct invocation API is available." } },
  ],
  agents: [], manualAgents: [],
  instructions: [{ id: "instruction:a", name: "copilot-instructions.md", workspaceRelativePath: ".github/copilot-instructions.md", uri: "file:///repo/.github/copilot-instructions.md", sourceType: "copilot", contentHash: "a".repeat(64), sizeBytes: 40, availability: "available" }],
  skills: [{ id: "keystone-development", name: "Development", description: "Implement bounded work", applicableStageTypes: ["development"], promptFragment: "Implement.", expectedOutput: { summaryRequired: true, changedFilesRequired: true, testsRequired: true, assumptionsRequired: true }, source: "keystone-built-in", contentHash: "b".repeat(64), version: 1 }],
  conflicts: [], diagnostics: [], profile: null,
};

describe("ExecutionConfiguration", () => {
  it("renders truthful capabilities, real instructions, skill selection, and saves valid configuration", async () => {
    const request = vi.fn(async (type: string) => type === "executionConfiguration.saveProfile" ? { ...aggregate, profile: { id: crypto.randomUUID(), workflowId, workItemId, executionCapabilityId: "clipboard", skillId: "keystone-development", instructionIds: ["instruction:a"], status: "valid", validation: { capabilityAvailable: true, skillAvailable: true, instructionsAvailable: true, conflictsResolved: true }, instructionHashes: { "instruction:a": "a".repeat(64) }, skillHash: "b".repeat(64), contentHash: "c".repeat(64), createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() } } : aggregate);
    render(<ExecutionConfiguration bridge={{ request } as unknown as HostBridge} workflowId={workflowId} workItemId={workItemId} onProfileChange={() => undefined} />);
    expect(await screen.findByRole("heading", { name: "Execution Configuration" })).toBeTruthy();
    expect((screen.getByLabelText("Direct Invocation") as HTMLInputElement).disabled).toBe(true);
    expect(screen.getByText("No supported direct invocation API is available.")).toBeTruthy();
    fireEvent.click(screen.getByLabelText("Clipboard Handoff"));
    fireEvent.click(screen.getByLabelText("Development skill Development"));
    fireEvent.click(screen.getByLabelText("Instruction .github/copilot-instructions.md"));
    fireEvent.click(screen.getByRole("button", { name: "Save Configuration" }));
    await waitFor(() => expect(request).toHaveBeenCalledWith("executionConfiguration.saveProfile", expect.objectContaining({ executionCapabilityId: "clipboard", skillId: "keystone-development", instructionIds: ["instruction:a"] })));
  });

  it("shows actual previews, manual-agent limitations, conflicts, invalid state, and restores selections", async () => {
    const restored = { ...aggregate, manualAgents: [{ id: crypto.randomUUID(), displayName: "Manual Helper", usageNote: "Clipboard only", createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(), commandAvailable: false }], conflicts: [{ id: "conflict", category: "test-requirement", state: "conflict", severity: "error", confidence: "inferred", instructionIds: ["a", "b"], sourcePaths: ["a.md", "b.md"], evidence: ["Run tests", "Do not run tests"], recommendedResolution: "Deselect one instruction." }], profile: null };
    const request = vi.fn(async (type: string) => type === "executionConfiguration.previewInstruction" ? { ...aggregate.instructions[0], content: "Real instruction content" } : restored);
    render(<ExecutionConfiguration bridge={{ request } as unknown as HostBridge} workflowId={workflowId} workItemId={workItemId} onProfileChange={() => undefined} />);
    await screen.findByText("Manual Helper");
    expect(screen.getByText(/manually configured/i)).toBeTruthy();
    expect(screen.getByText(/Deselect one instruction/)).toBeTruthy();
    expect((screen.getByRole("button", { name: "Save Configuration" }) as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(screen.getByRole("button", { name: "Preview copilot-instructions.md" }));
    expect(await screen.findByText("Real instruction content")).toBeTruthy();
  });
});
