// @vitest-environment jsdom

import { act, fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { App } from "../../src/ui/App";
import type { HostMessage } from "../../src/shared/contracts/messages";
import { hostMessage } from "../../src/shared/contracts/messages";
import type { BootstrapSnapshot } from "../../src/shared/contracts/domain";
import type { HostBridge } from "../../src/ui/services/HostBridge";

function createBridge() {
  let listener: ((message: HostMessage) => void) | undefined;
  const request = vi.fn().mockResolvedValue(undefined);
  const bridge = {
    request,
    subscribe(callback: (message: HostMessage) => void) {
      listener = callback;
      return () => { listener = undefined; };
    }
  } as unknown as HostBridge;
  return { bridge, request, emit: (message: HostMessage) => listener?.(message) };
}

describe("App", () => {
  it("bootstraps, renders honest phase status, and persists navigation", () => {
    const fake = createBridge();
    render(<App bridge={fake.bridge}/>);
    expect(fake.request).toHaveBeenCalledWith("app/bootstrap", {});

    act(() => {
      const snapshot: BootstrapSnapshot = {
        extensionVersion: "0.1.0",
        workspace: { name: "fixture-repository", rootCount: 1, trust: "trusted", indexStatus: "not-started" },
        state: { schemaVersion: 1, revision: 0, activeSection: "home", workflowCount: 0, updatedAt: new Date().toISOString() },
        activity: { operation: "Foundation ready", detail: "Ready", status: "completed", progress: 100, cancellable: false, updatedAt: new Date().toISOString() },
        implementation: { phase: 1, phaseName: "Extension foundation", completedTasks: ["T-101", "T-102"], nextTask: "T-201 · Workspace adapters" }
      };
      fake.emit(hostMessage("bootstrap/ready", snapshot));
    });

    expect(screen.getByText("fixture-repository")).toBeTruthy();
    expect(screen.getByText(/Intent becomes/)).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "Intelligence" }));
    expect(fake.request).toHaveBeenCalledWith("navigation/set", { section: "intelligence" });
    expect(screen.getByText("This capability is intentionally unavailable until its approved implementation phase.")).toBeTruthy();
  });
});
