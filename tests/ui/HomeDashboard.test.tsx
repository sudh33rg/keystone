// @vitest-environment jsdom

import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { BootstrapSnapshot } from "../../src/shared/contracts/domain";
import { emptyIntelligenceOverview } from "../../src/shared/contracts/intelligence";
import { HomeDashboard } from "../../src/ui/components/home/HomeDashboard";
import type { HostBridge } from "../../src/ui/services/HostBridge";

describe("HomeDashboard", () => {
  it("projects real workflow, coordination, intelligence, and Copilot state", async () => {
    const workflowId = crypto.randomUUID(); const intentId = crypto.randomUUID(); const taskId = crypto.randomUUID();
    const request = vi.fn((type: string) => {
      if (type === "workflow/list") return Promise.resolve([{ id: workflowId, status: "planned", intent: { id: intentId, normalizedObjective: "Improve repository health" }, specification: { title: "Repository health" }, tasks: [{ id: taskId, title: "Implement health checks", status: "ready" }] }]);
      if (type === "orchestration/list") return Promise.resolve([{ intentId, branch: "main", currentStage: "task-validation", progress: { pendingApprovals: 2, blockingFindings: 1, failedTasks: 3 } }]);
      if (type === "copilot/capabilities") return Promise.resolve({ extensionDetected: true, directInvocationAvailable: false });
      if (type === "handoff/import") return Promise.resolve(undefined);
      return Promise.resolve(undefined);
    });
    const navigate = vi.fn();
    const bootstrap = { workspace: { name: "keystone", indexStatus: "ready" } } as unknown as BootstrapSnapshot;
    const overview = emptyIntelligenceOverview("ready");
    overview.repository = { id: "repository:fixture", displayName: "keystone", workspaceRoots: [], branch: "main", headCommit: "abc" };
    overview.generation = 7;
    render(<HomeDashboard bootstrap={bootstrap} overview={overview} bridge={{ request } as unknown as HostBridge} navigate={navigate}/>);

    expect(await screen.findByText("Repository health")).toBeTruthy();
    expect(screen.getByText("Implement health checks")).toBeTruthy();
    expect(screen.getByText("2")).toBeTruthy();
    expect(screen.getByText("Branch main")).toBeTruthy();
    expect(screen.getByText("3")).toBeTruthy();
    expect(screen.getByText("Generation 7")).toBeTruthy();
    expect(screen.getByText("Available")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Resume workflow" }));
    expect(navigate).toHaveBeenCalledWith(`/workbench/${workflowId}/build`);
    fireEvent.click(screen.getByRole("button", { name: "Open Validate: 3" }));
    expect(navigate).toHaveBeenCalledWith(`/workbench/${workflowId}/validate`);
    fireEvent.click(screen.getByRole("button", { name: "Import handoff" }));
    await waitFor(() => expect(request).toHaveBeenCalledWith("handoff/import", { source: "file" }));
  });
});
