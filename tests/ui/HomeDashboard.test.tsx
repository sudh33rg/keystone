// @vitest-environment jsdom

import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { BootstrapSnapshot } from "../../src/shared/contracts/domain";
import { HomeDashboard } from "../../src/ui/components/home/HomeDashboard";
import type { HostBridge } from "../../src/ui/services/HostBridge";

describe("HomeDashboard", () => {
  it("projects real workflow, coordination, intelligence, and Copilot state", async () => {
    const workflowId = crypto.randomUUID(); const intentId = crypto.randomUUID(); const taskId = crypto.randomUUID();
    const request = vi.fn((type: string) => {
      if (type === "workflow/list") return Promise.resolve([{ id: workflowId, status: "planned", intent: { id: intentId, normalizedObjective: "Improve repository health" }, specification: { title: "Repository health" }, tasks: [{ id: taskId, title: "Implement health checks", status: "ready" }] }]);
      if (type === "orchestration/list") return Promise.resolve([{ intentId, currentStage: "task-validation", progress: { pendingApprovals: 2, blockingFindings: 1 } }]);
      if (type === "copilot/capabilities") return Promise.resolve({ extensionDetected: true, directInvocationAvailable: false });
      if (type === "handoff/import") return Promise.resolve(undefined);
      return Promise.resolve(undefined);
    });
    const navigate = vi.fn();
    const bootstrap = { workspace: { name: "keystone", indexStatus: "ready" } } as unknown as BootstrapSnapshot;
    render(<HomeDashboard bootstrap={bootstrap} bridge={{ request } as unknown as HostBridge} navigate={navigate}/>);

    expect(await screen.findByText("Repository health")).toBeTruthy();
    expect(screen.getByText("Implement health checks")).toBeTruthy();
    expect(screen.getByText("2")).toBeTruthy();
    expect(screen.getByText("task-validation")).toBeTruthy();
    expect(screen.getByText("Available")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Resume workflow" }));
    expect(navigate).toHaveBeenCalledWith(`/workbench/${workflowId}/build`);
    fireEvent.click(screen.getByRole("button", { name: "Import handoff" }));
    await waitFor(() => expect(request).toHaveBeenCalledWith("handoff/import", { source: "file" }));
  });
});
