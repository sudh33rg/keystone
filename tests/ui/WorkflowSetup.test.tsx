// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { StartWorkDraft } from "../../src/ui/components/workflow/StartWorkDraft";
import type { HostBridge } from "../../src/ui/services/HostBridge";

afterEach(cleanup);

describe("Workflow setup", () => {
  it("blocks review and explains an overly long intent", () => {
    const bridge = { request: vi.fn(), getWebviewState: () => undefined, setWebviewState: vi.fn() } as unknown as HostBridge;
    render(<StartWorkDraft bridge={bridge} navigate={vi.fn()} />);
    fireEvent.change(screen.getByLabelText("Intent"), { target: { value: "x".repeat(10_001) } });
    expect(screen.getByText("Intent must be 10,000 characters or fewer.")).toBeTruthy();
    expect((screen.getByRole("button", { name: "Continue" }) as HTMLButtonElement).disabled).toBe(true);
  });

  it("reviews draft values and creates exactly once before opening Active Work", async () => {
    let resolveCreate!: (value: unknown) => void;
    const request = vi.fn(() => new Promise((resolve) => { resolveCreate = resolve; }));
    const navigate = vi.fn();
    const state: Record<string, unknown> = {};
    const bridge = { request, getWebviewState: () => state, setWebviewState: (value: Record<string, unknown>) => Object.assign(state, value) } as unknown as HostBridge;
    render(<StartWorkDraft bridge={bridge} navigate={navigate} />);
    expect((screen.getByRole("button", { name: "Continue" }) as HTMLButtonElement).disabled).toBe(true);
    fireEvent.change(screen.getByLabelText("Intent"), { target: { value: "Add refunds" } });
    fireEvent.change(screen.getByLabelText("Work type"), { target: { value: "feature" } });
    fireEvent.change(screen.getByLabelText("Optional specification"), { target: { value: "Refund settled orders." } });
    fireEvent.click(screen.getByRole("button", { name: "Continue" }));
    expect(screen.getByRole("heading", { name: "Review Workflow" })).toBeTruthy();
    expect(screen.getByText("Add refunds")).toBeTruthy();
    expect(screen.getByText("Refund settled orders.")).toBeTruthy();
    expect(screen.getByText("PR Review")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Create Workflow" }));
    fireEvent.click(screen.getByRole("button", { name: "Creating…" }));
    expect(request).toHaveBeenCalledTimes(1);
    resolveCreate({ type: "workflow.created", correlationId: "correlation", workflow: { id: crypto.randomUUID() } });
    await waitFor(() => expect(navigate).toHaveBeenCalledWith("/active-work"));
  });

  it("stays on review and presents a useful creation error", async () => {
    const request = vi.fn().mockRejectedValue(new Error("Persistence unavailable"));
    const bridge = { request, getWebviewState: () => undefined, setWebviewState: vi.fn() } as unknown as HostBridge;
    render(<StartWorkDraft bridge={bridge} navigate={vi.fn()} />);
    fireEvent.change(screen.getByLabelText("Intent"), { target: { value: "Add tests" } });
    fireEvent.click(screen.getByRole("button", { name: "Continue" }));
    fireEvent.click(screen.getByRole("button", { name: "Create Workflow" }));
    expect((await screen.findByRole("alert")).textContent).toContain("Persistence unavailable");
    expect(screen.getByRole("heading", { name: "Review Workflow" })).toBeTruthy();
  });
});
