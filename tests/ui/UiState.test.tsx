// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { EmptyState, toUiError, UiErrorState } from "../../src/ui/components/UiState";

afterEach(cleanup);

describe("shared UI states", () => {
  it("renders a retryable error with preserved-state and recovery semantics", () => {
    const retry = vi.fn();
    const dismiss = vi.fn();
    const error = toUiError(new Error("Repository state changed."), {
      category: "stale-context",
      title: "Context is stale",
      fallbackMessage: "Rebuild the task context.",
      retry,
      dismiss,
    });
    render(<UiErrorState error={error}/>);
    expect(screen.getByRole("alert").textContent).toContain("Your current state was preserved.");
    expect(error.retryable).toBe(true);
    fireEvent.click(screen.getByRole("button", { name: "Try again" }));
    fireEvent.click(screen.getByRole("button", { name: "Dismiss" }));
    expect(retry).toHaveBeenCalledOnce();
    expect(dismiss).toHaveBeenCalledOnce();
  });

  it("renders a non-retryable error without inventing a recovery action", () => {
    const error = toUiError(undefined, {
      category: "unsupported",
      title: "Action unavailable",
      fallbackMessage: "This capability is not available in the current workspace.",
    });
    render(<UiErrorState error={error}/>);
    expect(error.retryable).toBe(false);
    expect(screen.queryByRole("button")).toBeNull();
  });

  it("makes an empty-state next action explicit", () => {
    const run = vi.fn();
    render(<EmptyState title="No workflows" message="Start with an intent." action={{ id: "start", label: "Start new work", kind: "primary", run }}/>);
    fireEvent.click(screen.getByRole("button", { name: "Start new work" }));
    expect(run).toHaveBeenCalledOnce();
  });
});
