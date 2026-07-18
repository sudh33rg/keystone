// @vitest-environment jsdom

import { act, fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { App } from "../../src/ui/App";
import type { HostMessage } from "../../src/shared/contracts/messages";
import { hostMessage } from "../../src/shared/contracts/messages";
import type { BootstrapSnapshot } from "../../src/shared/contracts/domain";
import { emptyIntelligenceOverview } from "../../src/shared/contracts/intelligence";
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
        workspace: { name: "fixture-repository", rootCount: 1, trust: "trusted", indexStatus: "not-indexed" },
        state: { schemaVersion: 1, revision: 0, activeSection: "home", activeRoute: "/", workflowCount: 0, updatedAt: new Date().toISOString() },
        activity: { operation: "Foundation ready", detail: "Ready", status: "completed", progress: 100, cancellable: false, updatedAt: new Date().toISOString() },
        implementation: { phase: 1, phaseName: "Extension foundation", completedTasks: ["T-101", "T-102"], nextTask: "T-201 · Workspace adapters" }
      };
      fake.emit(hostMessage("bootstrap/ready", snapshot));
    });

    expect(screen.getByText(/Active repository · fixture-repository/)).toBeTruthy();
    expect(screen.getByText(/Engineering work/)).toBeTruthy();
    expect(["Home", "SDLC Workbench", "Intelligence", "History"].every((name) => screen.getByRole("button", { name }))).toBe(true);
    for (const removed of ["Intent & Specs", "Tasks", "Active Workflow", "Validation & QA", "Delivery", "Task Handoff", "Diagnostics"]) expect(screen.queryByRole("button", { name: removed })).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "Workspace health" }));
    expect(screen.getByRole("heading", { name: "Diagnostics" })).toBeTruthy();
    expect(fake.request).toHaveBeenCalledWith("navigation/set", { route: "/support/diagnostics" });
    fireEvent.click(screen.getByRole("button", { name: "Settings" }));
    expect(screen.getByRole("heading", { name: "Settings" })).toBeTruthy();
    expect(fake.request).toHaveBeenCalledWith("navigation/set", { route: "/settings" });

    fireEvent.click(screen.getByRole("button", { name: "Intelligence" }));
    expect(fake.request).toHaveBeenCalledWith("navigation/set", { route: "/intelligence" });
    act(() => fake.emit(hostMessage("intelligence/updated", emptyIntelligenceOverview("not-indexed"))));
    expect(screen.getByText("No local intelligence snapshot exists yet.")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Scan repository" })).toBeTruthy();

    const scanning = emptyIntelligenceOverview("scanning", true);
    scanning.runtime = { phase: "reconciling", queueDepth: 1, activeWorkers: 1, workerCapacity: 3, pendingFiles: 5, completedJobs: 2, failedJobs: 0, staleResultsDiscarded: 1, workerRestarts: 0, throughputFilesPerSecond: 3.5, currentFiles: ["src/index.ts"], health: "healthy", trigger: "file", progress: { stage: "inventory", fileCount: 2, totalFiles: 5, currentFiles: ["src/index.ts"] } };
    act(() => fake.emit(hostMessage("intelligence/updated", scanning)));
    expect(screen.getByText("inventory 2 / 5")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Pause ingestion" }));
    expect(fake.request).toHaveBeenCalledWith("intelligence/runtime/pause", {});
    const paused = { ...scanning, runtime: { ...scanning.runtime, phase: "paused" as const } };
    act(() => fake.emit(hostMessage("intelligence/updated", paused)));
    fireEvent.click(screen.getByRole("button", { name: "Resume ingestion" }));
    expect(fake.request).toHaveBeenCalledWith("intelligence/runtime/resume", {});
  });
});
