import { afterEach, describe, expect, it, vi } from "vitest";
import type { RepositoryChange } from "../../../../src/core/intelligence/runtime/ChangeCollector";
import { IntelligenceRuntime } from "../../../../src/core/intelligence/runtime/IntelligenceRuntime";
import type { GitReconciliationEvent, RepositoryMonitor } from "../../../../src/extension/intelligence/VsCodeRepositoryMonitor";
import type { KeystoneLogger } from "../../../../src/shared/logging/KeystoneLogger";
import { KeystoneError } from "../../../../src/shared/errors/KeystoneError";

describe("IntelligenceRuntime", () => {
  afterEach(() => vi.useRealTimers());

  it("coalesces file changes and schedules Git and storage repairs", async () => {
    vi.useFakeTimers();
    const indexListeners = new Set<() => void>();
    const reconcile = vi.fn<(changes: readonly RepositoryChange[], trigger: string, signal?: AbortSignal) => Promise<void>>();
    reconcile.mockResolvedValue(undefined);
    const rebuild = vi.fn<(trigger: string, signal?: AbortSignal) => Promise<void>>();
    rebuild.mockResolvedValue(undefined);
    const index = {
      initialize: () => Promise.resolve(),
      onDidChange: (listener: () => void) => { indexListeners.add(listener); return { dispose: () => indexListeners.delete(listener) }; },
      getState: () => ({ status: "ready", pendingUpdate: false, scanRevision: 1 }),
      reconcile,
      rebuild,
      cancel: vi.fn(),
      dispose: vi.fn()
    };
    const store = createStore();
    const workers = {
      getStatus: () => ({ active: 0, queued: 0, capacity: 2, failedRestarts: 0, operations: [] }),
      onDidChange: () => ({ dispose: vi.fn() }),
      dispose: () => Promise.resolve()
    };
    const monitor = createMonitor();
    const workspace = {
      getIndexingConfiguration: () => ({ enabled: true, onWorkspaceOpen: false, onBranchChange: true, maxFiles: 100, maxFileSizeBytes: 1024, workerCount: 2, retainedGenerations: 2, exclusions: [] }),
      isTrusted: () => true
    };
    const runtime = new IntelligenceRuntime(
      workspace as never,
      {} as never,
      store.value as never,
      index as never,
      workers as never,
      monitor.value,
      { info: vi.fn(), warning: vi.fn(), error: vi.fn() } as unknown as KeystoneLogger
    );
    await runtime.initialize();

    const changed: RepositoryChange = { kind: "modified", rootUri: "file:///repo", uri: "file:///repo/src/a.ts", relativePath: "src/a.ts", reason: "file" };
    monitor.emitChange(changed);
    monitor.emitChange({ ...changed, reason: "active-editor" });
    await vi.advanceTimersByTimeAsync(201);
    await flushPromises();

    expect(reconcile).toHaveBeenCalledTimes(1);
    expect(reconcile.mock.calls[0]?.[0]).toEqual([{ ...changed, reason: "active-editor" }]);
    expect(reconcile.mock.calls[0]?.[1]).toBe("active-editor");

    reconcile.mockRejectedValueOnce(new KeystoneError({ code: "INTELLIGENCE_SOURCE_STALE", category: "INDEXING", message: "stale", operation: "test", recoverable: true, recommendedAction: "retry", retryable: true }));
    monitor.emitChange({ ...changed, uri: "file:///repo/src/stale.ts", relativePath: "src/stale.ts" });
    await vi.advanceTimersByTimeAsync(201);
    await flushPromises();
    await vi.advanceTimersByTimeAsync(201);
    await flushPromises();
    expect(reconcile).toHaveBeenCalledTimes(3);
    expect(runtime.getState().staleResultsDiscarded).toBe(1);

    monitor.emitGit({ changes: [], fullRebuild: true });
    await flushPromises();
    expect(rebuild).toHaveBeenCalledWith("git", expect.any(AbortSignal));

    store.emitDelete();
    await flushPromises();
    expect(rebuild).toHaveBeenCalledWith("storage-recovery", expect.any(AbortSignal));
    expect(runtime.getState()).toMatchObject({ workerCapacity: 2, pendingFiles: 0 });
    runtime.dispose();
  });
});

function createStore(): { value: object; emitDelete(): void } {
  let healthListener: ((health: { status: "healthy" | "damaged"; pendingGenerations: number; message?: string }) => void) | undefined;
  let health: { status: "healthy" | "damaged"; pendingGenerations: number } = { status: "healthy", pendingGenerations: 0 };
  return {
    value: {
      getSnapshot: () => undefined,
      isPersisted: () => Promise.resolve(false),
      getHealth: () => health,
      checkHealth: () => Promise.resolve(health),
      onDidHealthChange: (listener: typeof healthListener) => { healthListener = listener; return { dispose: () => { healthListener = undefined; } }; },
      dispose: vi.fn()
    },
    emitDelete: () => {
      health = { status: "damaged" as const, pendingGenerations: 0 };
      healthListener?.({ ...health, message: "missing shard" });
    }
  };
}

function createMonitor(): { value: RepositoryMonitor; emitChange(change: RepositoryChange): void; emitGit(event: GitReconciliationEvent): void } {
  let changed: ((change: RepositoryChange) => void) | undefined;
  let gitChanged: ((event: GitReconciliationEvent) => void) | undefined;
  return {
    value: {
      onDidChange: (listener) => { changed = listener; return { dispose: () => { changed = undefined; } }; },
      onDidGitChange: (listener) => { gitChanged = listener; return { dispose: () => { gitChanged = undefined; } }; },
      onDidChangeWorkspaceRoots: () => ({ dispose: vi.fn() }),
      start: () => Promise.resolve(),
      dispose: vi.fn()
    },
    emitChange: (change) => changed?.(change),
    emitGit: (event) => gitChanged?.(event)
  };
}

async function flushPromises(): Promise<void> {
  for (let index = 0; index < 8; index++) await Promise.resolve();
}
