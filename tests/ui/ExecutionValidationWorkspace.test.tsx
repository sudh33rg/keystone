// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ExecutionValidationWorkspace } from "../../src/ui/components/execution/ExecutionValidationWorkspace";
import type { HostBridge } from "../../src/ui/services/HostBridge";

afterEach(cleanup);

describe("ExecutionValidationWorkspace", () => {
  it("shows the honest prerequisite when no execution session exists", async () => {
    const request = vi.fn(() => Promise.resolve([]));
    render(<ExecutionValidationWorkspace bridge={{ request } as unknown as HostBridge} />);
    expect(await screen.findByText("No validation session for this workflow")).toBeTruthy();
    expect(request).toHaveBeenCalledWith("execution/list", {});
  });

  it("does not expose another workflow's execution session", async () => {
    const workflowId = crypto.randomUUID();
    const request = vi.fn(() =>
      Promise.resolve([
        { id: crypto.randomUUID(), workflowId: crypto.randomUUID(), taskId: crypto.randomUUID() },
      ]),
    );
    render(
      <ExecutionValidationWorkspace
        bridge={{ request } as unknown as HostBridge}
        workflowId={workflowId}
        onReturnToBuild={vi.fn()}
      />,
    );
    expect(await screen.findByText("No validation session for this workflow")).toBeTruthy();
    expect(screen.queryByLabelText("Execution session")).toBeNull();
    expect(screen.getByRole("button", { name: "Return to Build" })).toBeTruthy();
  });
});
