// @vitest-environment jsdom
import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { ActiveWork } from "../../src/ui/components/workbench/ActiveWork";
import type { HostBridge } from "../../src/ui/services/HostBridge";

describe("persisted Active Work", () => {
  it("renders only persisted workflow values and current stage", async () => {
    const stageId = crypto.randomUUID();
    const workflow = { schemaVersion: 1, id: crypto.randomUUID(), intent: { text: "Fix retries", workType: "bug-fix" }, specification: { text: "Retry once.", revision: 1 }, status: "active", stages: [{ id: stageId, type: "understand", displayName: "Understand", order: 1, status: "ready", required: true }], currentStageId: stageId, createdAt: "2026-07-22T10:00:00.000Z", updatedAt: "2026-07-22T10:00:00.000Z" };
    const request = vi.fn().mockResolvedValue(workflow);
    render(<ActiveWork bridge={{ request } as unknown as HostBridge} navigate={vi.fn()} />);
    expect(await screen.findByRole("heading", { name: "Fix retries" })).toBeTruthy();
    expect(screen.getByText("Bug Fix")).toBeTruthy();
    expect(screen.getByText("Retry once.")).toBeTruthy();
    expect(screen.getByText("Understand")).toBeTruthy();
    expect(screen.getByText("This persisted stage remains a compact read-only summary in Phase 3.")).toBeTruthy();
    expect(request).toHaveBeenCalledWith("workflow.loadActive", {});
    for (const forbidden of ["Delegate", "Capture Result", "Start Development", "Task Handoff"]) expect(screen.queryByText(forbidden)).toBeNull();
  });

  it("shows the truthful specification empty state", async () => {
    const stageId = crypto.randomUUID();
    const workflow = { schemaVersion: 1, id: crypto.randomUUID(), intent: { text: "Investigate stalls", workType: "investigation" }, status: "active", stages: [{ id: stageId, type: "understand", displayName: "Understand", order: 1, status: "ready", required: true }], currentStageId: stageId, createdAt: "2026-07-22T10:00:00.000Z", updatedAt: "2026-07-22T10:00:00.000Z" };
    render(<ActiveWork bridge={{ request: vi.fn().mockResolvedValue(workflow) } as unknown as HostBridge} navigate={vi.fn()} />);
    expect(await screen.findByText("No specification was added.")).toBeTruthy();
  });
});
