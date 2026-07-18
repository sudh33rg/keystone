// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { SDLCWorkbench } from "../../src/ui/components/workbench/SDLCWorkbench";
import type { HostBridge } from "../../src/ui/services/HostBridge";

afterEach(cleanup);

describe("SDLCWorkbench", () => {
  it("creates a single workflow draft and navigates directly to Define", async () => {
    const workflowId = crypto.randomUUID();
    const request = vi.fn((type: string) => Promise.resolve(type === "workbench/getCreateContext" ? {
      schemaVersion: 1,
      repository: { available: true, trusted: true, id: "repository:fixture", name: "fixture", branch: "main", head: "abc" },
      intelligence: { status: "ready", generation: 7, message: "Ready" },
      copilot: { available: false, directInvocation: false, summary: "Unavailable" },
      workflowDefinitions: [
        { workType: "feature", definitionId: "feature", label: "Feature", description: "Feature work" },
        { workType: "modernization", definitionId: "modernization", label: "Modernization", description: "Modernization work" },
      ],
    } : { id: workflowId }));
    const navigate = vi.fn();
    render(<SDLCWorkbench bridge={{ request } as unknown as HostBridge} route="/workbench/new" navigate={navigate}/>);

    await screen.findByText("fixture");
    fireEvent.click(screen.getByRole("radio", { name: /Modernization/ }));
    fireEvent.change(screen.getByLabelText("Work intent"), { target: { value: "Modernize the repository adapter" } });
    fireEvent.change(screen.getByLabelText("Repository scope"), { target: { value: "paths" } });
    fireEvent.change(screen.getByLabelText("Repository paths"), { target: { value: "src/adapters, tests/adapters.test.ts" } });
    fireEvent.click(screen.getByRole("button", { name: "Start workflow" }));

    await waitFor(() => expect(request).toHaveBeenCalledWith("workbench/createWorkflow", { workType: "modernization", intent: "Modernize the repository adapter", repositoryScope: { kind: "paths", paths: ["src/adapters", "tests/adapters.test.ts"] }, constraints: [], expectedRepositoryId: "repository:fixture", expectedIntelligenceGeneration: 7 }));
    expect(navigate).toHaveBeenCalledWith(`/workbench/${workflowId}/define`);
    expect(screen.queryByText(/SDLC task/i)).toBeNull();
  });

  it("does not permit a repository workflow without a ready trusted repository", async () => {
    const request = vi.fn().mockResolvedValue({ schemaVersion: 1, repository: { available: false, trusted: false }, intelligence: { status: "unavailable", generation: 0, message: "Unavailable" }, copilot: { available: false, directInvocation: false, summary: "Unavailable" }, workflowDefinitions: [] });
    render(<SDLCWorkbench bridge={{ request } as unknown as HostBridge} route="/workbench/new" navigate={vi.fn()}/>);
    expect(await screen.findByText("No active repository")).toBeDefined();
    expect(screen.getByRole("button", { name: "Start workflow" }).hasAttribute("disabled")).toBe(true);
    expect(screen.getByText(/Starting requires a trusted repository/)).toBeDefined();
  });
});
