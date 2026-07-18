import { describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  KeystoneDashboardRefreshService,
  KeystoneDashboardViewModelService,
  KeystoneLaunchValidationService,
  KeystonePanelStateService,
  type NativeShellStateSource,
} from "../../src/core/integration/NativeShellServices";
import { OpenKeystoneRequestSchema } from "../../src/shared/contracts/nativeShell";
import { NativeShellPersistenceStore } from "../../src/core/persistence/NativeShellPersistenceStore";

function source(available = true): NativeShellStateSource {
  return {
    workspace: () => ({
      available,
      name: available ? "Fixture" : "No workspace",
      trusted: true,
      roots: available ? [{ id: "root", name: "Fixture" }] : [],
    }),
    intelligence: () => ({
      status: "not-indexed",
      pendingUpdate: false,
      health: "missing",
    }),
    snapshot: () => undefined,
    workflows: () => [],
    review: () => undefined,
    validation: () => ({ passed: 0, failed: 0 }),
    copilot: () => undefined,
    handoffAttention: () => 0,
    persistenceWarnings: () => [],
  };
}

describe("native shell services", () => {
  it("contributes exactly one Keystone Activity Bar dashboard", () => {
    const manifest = JSON.parse(
      readFileSync(join(process.cwd(), "package.json"), "utf8"),
    ) as {
      contributes: {
        viewsContainers: { activitybar: Array<{ id: string }> };
        views: Record<string, Array<{ id: string }>>;
        viewsWelcome: Array<{ view: string }>;
      };
    };
    expect(manifest.contributes.viewsContainers.activitybar).toEqual([
      expect.objectContaining({ id: "keystone" }),
    ]);
    expect(manifest.contributes.views.keystone).toEqual([
      expect.objectContaining({ id: "keystone.dashboard" }),
    ]);
    expect(manifest.contributes.viewsWelcome).toEqual([
      expect.objectContaining({ view: "keystone.dashboard" }),
    ]);
  });

  it("projects bounded stable dashboard sections for empty and missing workspaces", () => {
    const unavailable = new KeystoneDashboardViewModelService(
      source(false),
    ).project();
    expect(unavailable.status).toBe("no-workspace");
    expect(
      unavailable.sections
        .flatMap((entry) => entry.items)
        .map((entry) => entry.id),
    ).toEqual(["repository:no-workspace", "action:open-folder", "action:open"]);
    const available = new KeystoneDashboardViewModelService(source()).project();
    expect(available.status).toBe("intelligence-unavailable");
    expect(available.sections).toHaveLength(4);
    expect(
      available.sections.flatMap((entry) => entry.items).length,
    ).toBeLessThanOrEqual(30);
    expect(available.refreshDurationMs).toBeLessThan(20);
    expect(
      available.sections
        .flatMap((entry) => entry.items)
        .every((entry) => entry.accessibilityLabel.length > entry.label.length),
    ).toBe(true);
  });

  it("returns explicit recovery when a destination has no compatible workspace", () => {
    const result = new KeystoneLaunchValidationService(source(false)).validate({
      schemaVersion: 1,
      destination: { type: "intelligence-query", query: "find fixture" },
      source: "activity-bar",
      requestedAt: new Date().toISOString(),
    });
    expect(result.valid).toBe(false);
    expect(result.recovery?.code).toBe("workspace-missing");
    expect(result.route).toBe("/");
  });

  it("accepts every supported deep-link destination through one typed contract", () => {
    const workflowId = "00000000-0000-4000-8000-000000000001";
    const taskId = "00000000-0000-4000-8000-000000000002";
    const destinations = [
      { type: "home" },
      { type: "new-workflow", workType: "feature" },
      { type: "workflow", workflowId, stage: "build" },
      { type: "task", workflowId, taskId },
      { type: "approval", workflowId, approvalId: "approval" },
      { type: "finding", workflowId, findingId: "finding" },
      { type: "intelligence-query", query: "find fixture" },
      { type: "entity", repositoryId: "repo", entityId: "entity" },
      { type: "flow", repositoryId: "repo", seedEntityId: "entity" },
      { type: "impact", repositoryId: "repo", entityId: "entity" },
      { type: "import-handoff" },
      { type: "history" },
      { type: "diagnostics", diagnosticId: "diagnostic" },
      { type: "settings", section: "shell" },
    ];
    for (const destination of destinations)
      expect(
        OpenKeystoneRequestSchema.safeParse({
          schemaVersion: 1,
          destination,
          source: "command-palette",
          requestedAt: new Date().toISOString(),
        }).success,
        JSON.stringify(destination),
      ).toBe(true);
  });

  it("coalesces refresh bursts and cancels pending work on disposal", () => {
    vi.useFakeTimers();
    const refresh = vi.fn();
    const service = new KeystoneDashboardRefreshService(refresh, 100);
    service.request();
    service.request();
    service.request();
    vi.advanceTimersByTime(99);
    expect(refresh).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(refresh).toHaveBeenCalledTimes(1);
    service.request();
    service.dispose();
    vi.advanceTimersByTime(100);
    expect(refresh).toHaveBeenCalledTimes(1);
    vi.useRealTimers();
  });

  it("persists acknowledged deep-link context and rejects stale acknowledgements", async () => {
    const store = new NativeShellPersistenceStore();
    await store.initialize();
    const state = new KeystonePanelStateService(store);
    const navigation = new KeystoneLaunchValidationService(source()).validate({
      schemaVersion: 1,
      destination: { type: "intelligence-query", query: "find fixture" },
      source: "activity-bar",
      requestedAt: new Date().toISOString(),
    });
    await state.pending(navigation);
    const stale = await state.acknowledged(0, "/intelligence");
    expect(stale.pendingNavigation).toBeDefined();
    const acknowledged = await state.acknowledged(1, "/intelligence");
    expect(acknowledged.pendingNavigation).toBeUndefined();
    expect(acknowledged.lastIntelligenceQuery).toBe("find fixture");
  });
});
