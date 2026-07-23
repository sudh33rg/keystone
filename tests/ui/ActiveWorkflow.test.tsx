// @vitest-environment jsdom
import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { ActiveWork } from "../../src/ui/components/workbench/ActiveWork";
import type { HostBridge } from "../../src/ui/services/HostBridge";
import type { UnderstandState } from "../../src/shared/contracts/stageWorkspace";

function understandState(overrides: Partial<UnderstandState> = {}): UnderstandState {
  return {
    schemaVersion: 1,
    workflowId: overrides.workflowId ?? crypto.randomUUID(),
    stageId: overrides.stageId ?? crypto.randomUUID(),
    intelligence: { status: "unavailable", generation: 0, files: 0, symbols: 0, relationships: 0, message: "Repository Intelligence has not indexed this repository yet." },
    configuration: {
      mode: "clipboard",
      agentId: "copilot-chat",
      agentLabel: "No Copilot agent detected",
      agentAvailable: false,
      skill: "repository-understanding",
      instructions: ["Base every statement only on the supplied evidence package."],
      capabilities: [
        { id: "chat-open", label: "Open Copilot Chat with prompt", available: false, detail: "Copilot Chat is not available in this environment." },
        { id: "clipboard", label: "Copy prompt to clipboard", available: true, detail: "Copies the exact approved prompt for manual paste." },
        { id: "manual", label: "Manual work", available: true, detail: "Record work you performed yourself." },
      ],
    },
    delegations: [],
    primaryAction: "initialize-intelligence",
    completion: { allowed: false, unmet: ["The intent analysis is not approved."] },
    updatedAt: "2026-07-22T10:00:00.000Z",
    ...overrides,
  };
}

function bridgeFor(workflow: unknown, understand: UnderstandState): { request: ReturnType<typeof vi.fn> } {
  const request = vi.fn().mockImplementation((type: string) => {
    if (type === "workflow.loadActive" || type === "workflow.getCanonical") return Promise.resolve(workflow);
    if (type.startsWith("stage.understand")) return Promise.resolve(understand);
    return Promise.resolve(undefined);
  });
  return { request };
}

describe("Active Work stage journey", () => {
  const stageId = crypto.randomUUID();
  const workflowId = crypto.randomUUID();
  const workflow = {
    schemaVersion: 1,
    id: workflowId,
    intent: { text: "What is this repo?", workType: "investigation" },
    status: "active",
    stages: [
      { id: stageId, type: "understand", displayName: "Understand", order: 1, status: "ready", required: true },
      { id: crypto.randomUUID(), type: "investigation", displayName: "Investigation", order: 2, status: "not-ready", required: true },
      { id: crypto.randomUUID(), type: "complete", displayName: "Complete", order: 3, status: "not-ready", required: true },
    ],
    currentStageId: stageId,
    createdAt: "2026-07-22T10:00:00.000Z",
    updatedAt: "2026-07-22T10:00:00.000Z",
  };

  it("opens the Understand workspace directly with a workflow header and stage rail", async () => {
    const { request } = bridgeFor(workflow, understandState({ workflowId, stageId }));
    render(<ActiveWork bridge={{ request } as unknown as HostBridge} navigate={vi.fn()} />);
    expect(await screen.findByRole("heading", { name: "What is this repo?" })).toBeTruthy();
    expect(screen.getByText(/Investigation · In progress/)).toBeTruthy();
    expect(screen.getByLabelText("Workflow stages")).toBeTruthy();
    expect(await screen.findByLabelText("Understand stage")).toBeTruthy();
    expect(request).toHaveBeenCalledWith("stage.understand.load", { workflowId });
    // No internal metadata or stage-overview page.
    expect(screen.queryByText(/Order 1/)).toBeNull();
    expect(screen.queryByText(/Required/)).toBeNull();
    expect(screen.queryByText(/Stage overview/)).toBeNull();
    expect(screen.queryByText(/Phase 3/)).toBeNull();
    expect(screen.queryByRole("button", { name: "Refresh Workflow" })).toBeNull();
  });

  it("shows Initialize Repository Intelligence as the single primary action when intelligence is unavailable", async () => {
    const { request } = bridgeFor(workflow, understandState({ workflowId, stageId }));
    render(<ActiveWork bridge={{ request } as unknown as HostBridge} navigate={vi.fn()} />);
    expect(await screen.findByRole("button", { name: "Initialize Repository Intelligence" })).toBeTruthy();
    expect(screen.getByText("What should I do now?")).toBeTruthy();
  });

  it("marks unavailable Copilot capabilities as unavailable and not selectable", async () => {
    const { request } = bridgeFor(workflow, understandState({ workflowId, stageId }));
    render(<ActiveWork bridge={{ request } as unknown as HostBridge} navigate={vi.fn()} />);
    await screen.findByRole("button", { name: "Initialize Repository Intelligence" });
    const chatRadios = screen.getAllByRole("radio", { name: /Open Copilot Chat with prompt/, hidden: true });
    expect(chatRadios[0]).toHaveProperty("disabled", true);
    const clipboardRadios = screen.getAllByRole("radio", { name: /Copy prompt to clipboard/, hidden: true });
    expect(clipboardRadios[0]).toHaveProperty("disabled", false);
  });

  it("offers Start New Work when no workflow is active", async () => {
    const request = vi.fn().mockResolvedValue(null);
    render(<ActiveWork bridge={{ request } as unknown as HostBridge} navigate={vi.fn()} />);
    expect(await screen.findByRole("button", { name: "Start New Work" })).toBeTruthy();
  });
});
