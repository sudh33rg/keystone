// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { DevelopmentStage } from "../../src/ui/components/workbench/DevelopmentStage";
import type { HostBridge } from "../../src/ui/services/HostBridge";

afterEach(cleanup);

const ids = { workflow: crypto.randomUUID(), stage: crypto.randomUUID(), workItem: crypto.randomUUID() };
const aggregate = {
  workflow: { schemaVersion: 1, id: ids.workflow, intent: { text: "Add refunds", workType: "feature" }, status: "active", stages: [{ id: ids.stage, type: "development", displayName: "Development", order: 1, status: "ready", required: true }], currentStageId: ids.stage, createdAt: "2026-07-22T10:00:00.000Z", updatedAt: "2026-07-22T10:00:00.000Z" },
  workItem: { id: ids.workItem, workflowId: ids.workflow, stageId: ids.stage, objective: "Add refunds", status: "ready", sourceScopeIds: [], createdAt: "2026-07-22T10:00:00.000Z", updatedAt: "2026-07-22T10:00:00.000Z" },
  scopeItems: [], promptPreparation: null, handoff: null, result: null, contextPackage: null,
  changeDetection: { available: true, changes: [] },
  completion: { allowed: false, unmet: ["Select source scope"] },
};
const executionConfiguration = {
  capabilities: [], agents: [], manualAgents: [], instructions: [], skills: [], conflicts: [], profile: null,
};
const reply = (type: string, development = aggregate) => type.startsWith("executionConfiguration.") ? executionConfiguration : development;

describe("DevelopmentStage", () => {
  it("renders the bounded Development sections including Context Package and edits the real objective", async () => {
    const request = vi.fn(async (type: string) => reply(type, type === "development.updateObjective" ? { ...aggregate, workItem: { ...aggregate.workItem, objective: "Guard settled refunds", status: "editing" } } : aggregate));
    render(<DevelopmentStage bridge={{ request } as unknown as HostBridge} workflowId={ids.workflow} />);
    for (const name of ["Objective", "Source Scope", "Context Package", "Prompt Preparation", "Development Result", "Changed Files", "Completion"]) expect(await screen.findByRole("heading", { name })).toBeTruthy();
    for (const removed of ["Agent", "Context", "Security", "Performance", "QA", "Execution", "Evidence"]) expect(screen.queryByRole("tab", { name: removed })).toBeNull();
    fireEvent.change(screen.getByLabelText("Development objective"), { target: { value: "Guard settled refunds" } });
    expect(screen.getByText("Unsaved changes")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Save Objective" }));
    await waitFor(() => expect(request).toHaveBeenCalledWith("development.updateObjective", expect.objectContaining({ workflowId: ids.workflow, workItemId: ids.workItem, objective: "Guard settled refunds" })));
  });

  it("supports current file, prompt preparation, truthful handoff, result, changes, and gated completion", async () => {
    const request = vi.fn(async (type: string) => reply(type));
    render(<DevelopmentStage bridge={{ request } as unknown as HostBridge} workflowId={ids.workflow} />);
    await screen.findByRole("heading", { name: "Objective" });
    expect(screen.getByRole("button", { name: "Add Current File" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Add File" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Prepare Prompt" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Copy Prompt" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Confirm Handed Off" })).toBeTruthy();
    expect(screen.getByLabelText("Summary of work completed")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Detect Changes" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Complete Development" })).toHaveProperty("disabled", true);
  });

  it("renders persisted completion as completed rather than ready", async () => {
    const completed = {
      ...aggregate,
      workItem: { ...aggregate.workItem, status: "completed" },
      completion: { allowed: true, unmet: [] },
    };
    const request = vi.fn(async (type: string) => reply(type, completed));

    render(<DevelopmentStage bridge={{ request } as unknown as HostBridge} workflowId={ids.workflow} />);

    const heading = await screen.findByRole("heading", { name: "Completion" });
    expect(heading.parentElement?.parentElement?.textContent).toContain("completed");
    expect(screen.getByRole("button", { name: "Development Completed" })).toHaveProperty("disabled", true);
  });
});
