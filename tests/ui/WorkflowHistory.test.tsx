// @vitest-environment jsdom
import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { HistoryWorkspace } from "../../src/ui/components/history/HistoryWorkspace";
import type { HostBridge } from "../../src/ui/services/HostBridge";

describe("workflow History", () => {
  it("lists only canonical persisted workflow summaries", async () => {
    const request = vi.fn().mockResolvedValue([{ schemaVersion: 1, id: crypto.randomUUID(), intent: { text: "Persist history", workType: "test-work" }, status: "active", stages: [], currentStageId: null, createdAt: "2026-07-22T10:00:00.000Z", updatedAt: "2026-07-22T10:00:00.000Z" }]);
    render(<HistoryWorkspace bridge={{ request } as unknown as HostBridge} navigate={vi.fn()} />);
    expect(await screen.findByText("Persist history")).toBeTruthy();
    expect(screen.getByText(/Test Work/)).toBeTruthy();
    expect(request).toHaveBeenCalledWith("workflow.listCanonical", {});
    expect(screen.queryByText(/tokens|QA results|handoff/i)).toBeNull();
  });
});
