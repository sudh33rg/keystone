// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { StartWorkDraft } from "../../src/ui/components/workflow/StartWorkDraft";
import type { HostBridge } from "../../src/ui/services/HostBridge";

afterEach(cleanup);

describe("StartWorkDraft", () => {
  it("keeps intent and work type locally without creating a workflow", () => {
    const request = vi.fn();
    const navigate = vi.fn();
    const state: Record<string, unknown> = {};
    const bridge = {
      request,
      getWebviewState: () => state,
      setWebviewState: (value: Record<string, unknown>) => Object.assign(state, value),
    } as unknown as HostBridge;
    const alertSpy = vi.spyOn(window, "alert").mockImplementation(() => undefined);
    const view = render(<StartWorkDraft bridge={bridge} navigate={navigate} />);
    fireEvent.change(screen.getByLabelText("Intent"), { target: { value: "Fix the shell" } });
    fireEvent.change(screen.getByLabelText("Work type"), { target: { value: "bug-fix" } });
    fireEvent.click(screen.getByRole("button", { name: "Continue" }));
    expect(request).not.toHaveBeenCalledWith("workflow/capture", expect.anything());
    expect(request).not.toHaveBeenCalled();
    expect(navigate).not.toHaveBeenCalled();
    expect(screen.getByRole("heading", { name: "Review Workflow" })).toBeTruthy();
    expect(alertSpy).not.toHaveBeenCalled();
    view.unmount();
    render(<StartWorkDraft bridge={bridge} navigate={navigate} />);
    expect(screen.getByText("Fix the shell")).toBeTruthy();
    expect(screen.getByText("Bug Fix")).toBeTruthy();
    alertSpy.mockRestore();
  });

  it("returns Home on Cancel", () => {
    const navigate = vi.fn();
    render(<StartWorkDraft bridge={{ getWebviewState: () => undefined, setWebviewState: vi.fn() } as unknown as HostBridge} navigate={navigate} />);
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(navigate).toHaveBeenCalledWith("/");
  });
});
