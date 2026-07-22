// @vitest-environment jsdom

import { render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { HomeDashboard } from "../../src/ui/components/home/HomeDashboard";
import type { HostBridge } from "../../src/ui/services/HostBridge";

describe("HomeDashboard", () => {
  it("renders exactly four truthful sections from one bounded home request", async () => {
    const request = vi.fn().mockResolvedValue({
      repository: {
        name: "keystone",
        status: "ready",
        generation: 7,
        lastSuccessfulUpdate: "2026-07-22T08:00:00.000Z",
      },
      activeWorkflow: {
        id: "workflow-1",
        title: "Correct Phase 1",
        intent: "Correct Phase 1",
        workType: "feature",
        status: "in-progress",
        updatedAt: "2026-07-22T08:30:00.000Z",
      },
      recentActivities: [{ id: "activity-1", title: "Index repository", status: "completed", updatedAt: "2026-07-22T08:00:00.000Z" }],
    });
    render(<HomeDashboard bridge={{ request } as unknown as HostBridge} navigate={vi.fn()} />);

    await screen.findByRole("heading", { name: "Correct Phase 1" });
    expect(screen.getAllByText("Correct Phase 1")).toHaveLength(1);
    expect(screen.getByText("Work type: Feature")).toBeTruthy();
    expect(screen.getAllByRole("region")).toHaveLength(4);
    expect(screen.getByText("keystone")).toBeTruthy();
    expect(screen.getByText("Generation 7")).toBeTruthy();
    expect(screen.getByText("Index repository")).toBeTruthy();
    for (const removed of ["GitHub Copilot", "Pending Approvals", "Validation Failures", "Import Handoff"])
      expect(screen.queryByText(removed)).toBeNull();
    await waitFor(() => expect(request).toHaveBeenCalledTimes(1));
    expect(request).toHaveBeenCalledWith("home/getState", {});
    for (const forbidden of ["orchestration/list", "copilot/capabilities", "copilot/getIntegrationStatus", "workbench/getCreateContext"])
      expect(request).not.toHaveBeenCalledWith(forbidden, {});
  });

  it("shows truthful empty states", async () => {
    const request = vi.fn().mockResolvedValue({
      repository: { name: "No repository open", status: "unavailable" },
      activeWorkflow: null,
      recentActivities: [],
    });
    render(<HomeDashboard bridge={{ request } as unknown as HostBridge} navigate={vi.fn()} />);
    expect(await screen.findByText("No active workflow")).toBeTruthy();
    expect(screen.getByText("No recent Keystone activity.")).toBeTruthy();
  });
});
