import { describe, expect, it, vi } from "vitest";
import { WebviewMessageRouter } from "../../../src/extension/webview/WebviewMessageRouter";
import { emptyIntelligenceOverview } from "../../../src/shared/contracts/intelligence";
import type { HostMessage } from "../../../src/shared/contracts/messages";
import type { RepositoryIndexService } from "../../../src/core/intelligence/RepositoryIndexService";
import type { IntelligenceQueryService } from "../../../src/core/intelligence/IntelligenceQueryService";
import type { WorkspaceStateStore } from "../../../src/core/persistence/WorkspaceStateStore";
import type { ConfigurationService } from "../../../src/core/configuration/ConfigurationService";
import type { KeystoneLogger } from "../../../src/shared/logging/KeystoneLogger";

describe("WebviewMessageRouter", () => {
  it("coalesces worker status bursts before recomputing the full overview", async () => {
    vi.useFakeTimers();
    const posted: HostMessage[] = [];
    let runtimeListener: ((state: never) => void) | undefined;
    const overviewValue = emptyIntelligenceOverview("ready");
    const overview = vi.fn(() => Promise.resolve(overviewValue));
    const router = new WebviewMessageRouter(
      {} as WorkspaceStateStore,
      {} as ConfigurationService,
      { error: vi.fn() } as unknown as KeystoneLogger,
      "0.1.0",
      () => ({
        name: "fixture",
        rootCount: 1,
        trust: "trusted",
        indexStatus: "ready",
      }),
      (message) => {
        posted.push(message);
        return Promise.resolve(true);
      },
      {
        intelligenceRuntime: {
          onDidChange: (listener: (state: never) => void) => {
            runtimeListener = listener;
            return { dispose: vi.fn() };
          },
        },
        intelligenceQuery: { overview },
        workflow: { list: () => [] },
        cpgQuery: {},
        openSource: vi.fn(),
      } as never,
    );
    const state = overviewValue.runtime as never;
    for (let index = 0; index < 200; index++) runtimeListener?.(state);
    expect(overview).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(100);
    expect(
      posted.filter((message) => message.type === "intelligence/runtime"),
    ).toHaveLength(1);
    await vi.advanceTimersByTimeAsync(250);
    expect(overview).toHaveBeenCalledOnce();
    router.dispose();
    vi.useRealTimers();
  });

  it("returns the bounded live overview for an admitted request", async () => {
    const posted: HostMessage[] = [];
    const pause = vi.fn();
    const repositoryIndex = {
      onDidChange: () => ({ dispose: vi.fn() }),
      getState: () => ({
        status: "ready",
        pendingUpdate: false,
        scanRevision: 1,
      }),
      start: () => ({ scanRevision: 2 }),
      cancel: vi.fn(),
      pause,
      resume: vi.fn(),
    } as unknown as RepositoryIndexService;
    const overview = emptyIntelligenceOverview("ready");
    const router = new WebviewMessageRouter(
      {
        snapshot: {
          schemaVersion: 1,
          revision: 0,
          activeSection: "home",
          workflowCount: 0,
          updatedAt: "2026-07-15T00:00:00.000Z",
        },
      } as WorkspaceStateStore,
      {} as ConfigurationService,
      { error: vi.fn() } as unknown as KeystoneLogger,
      "0.1.0",
      () => ({
        name: "fixture",
        rootCount: 1,
        trust: "trusted",
        indexStatus: "ready",
      }),
      (message) => {
        posted.push(message);
        return Promise.resolve(true);
      },
      {
        intelligenceRuntime: repositoryIndex as never,
        intelligenceQuery: {
          overview: () => Promise.resolve(overview),
        } as IntelligenceQueryService,
        cpgQuery: { scope: vi.fn(), slice: vi.fn() } as never,
        openSource: vi.fn(),
      } as never,
    );

    const requestId = crypto.randomUUID();
    await router.handle({
      requestId,
      type: "intelligence/overview",
      timestamp: new Date().toISOString(),
      schemaVersion: 1,
      payload: {},
    });

    expect(posted.map((message) => message.type)).toEqual([
      "intelligence/updated",
      "response/success",
    ]);
    expect(posted[1]).toMatchObject({ payload: { requestId, data: overview } });
    const pauseId = crypto.randomUUID();
    await router.handle({
      requestId: pauseId,
      type: "intelligence/runtime/pause",
      timestamp: new Date().toISOString(),
      schemaVersion: 1,
      payload: {},
    });
    expect(pause).toHaveBeenCalledOnce();
    router.dispose();
  });

  it("answers malformed input with a structured error", async () => {
    const posted: HostMessage[] = [];
    const router = new WebviewMessageRouter(
      {} as WorkspaceStateStore,
      {} as ConfigurationService,
      { error: vi.fn() } as unknown as KeystoneLogger,
      "0.1.0",
      () => ({
        name: "fixture",
        rootCount: 1,
        trust: "trusted",
        indexStatus: "not-indexed",
      }),
      (message) => {
        posted.push(message);
        return Promise.resolve(true);
      },
      {
        intelligenceRuntime: {
          onDidChange: () => ({ dispose: vi.fn() }),
        } as never,
        intelligenceQuery: {
          overview: () =>
            Promise.resolve(emptyIntelligenceOverview("not-indexed")),
        } as IntelligenceQueryService,
        cpgQuery: { scope: vi.fn(), slice: vi.fn() } as never,
        openSource: vi.fn(),
      } as never,
    );
    await router.handle({
      requestId: crypto.randomUUID(),
      type: "index/search",
      payload: {},
    });
    expect(posted[0]).toMatchObject({
      type: "response/error",
      payload: { error: { code: "WEBVIEW_MESSAGE_INVALID" } },
    });
    router.dispose();
  });

  it("routes bounded semantic search and cancels an active query", async () => {
    const posted: HostMessage[] = [];
    let observedSignal: AbortSignal | undefined;
    const search = vi.fn(
      (_payload: unknown, signal?: AbortSignal) =>
        new Promise((resolve, reject) => {
          observedSignal = signal;
          signal?.addEventListener(
            "abort",
            () => {
              const error = new Error("cancelled");
              error.name = "AbortError";
              reject(error);
            },
            { once: true },
          );
        }),
    );
    const router = new WebviewMessageRouter(
      {} as WorkspaceStateStore,
      {} as ConfigurationService,
      { error: vi.fn() } as unknown as KeystoneLogger,
      "0.1.0",
      () => ({
        name: "fixture",
        rootCount: 1,
        trust: "trusted",
        indexStatus: "ready",
      }),
      (message) => {
        posted.push(message);
        return Promise.resolve(true);
      },
      {
        intelligenceRuntime: {
          onDidChange: () => ({ dispose: vi.fn() }),
        } as never,
        intelligenceQuery: { search } as unknown as IntelligenceQueryService,
        cpgQuery: { scope: vi.fn(), slice: vi.fn() } as never,
        openSource: vi.fn(),
      } as never,
    );
    const targetRequestId = crypto.randomUUID();
    const active = router.handle({
      requestId: targetRequestId,
      type: "intelligence/search",
      timestamp: new Date().toISOString(),
      schemaVersion: 1,
      payload: { query: "target", limit: 10 },
    });
    await Promise.resolve();
    await router.handle({
      requestId: crypto.randomUUID(),
      type: "request/cancel",
      timestamp: new Date().toISOString(),
      schemaVersion: 1,
      payload: { targetRequestId },
    });
    await active;
    expect(search).toHaveBeenCalledWith(
      { query: "target", limit: 10 },
      expect.any(AbortSignal),
    );
    expect(observedSignal?.aborted).toBe(true);
    expect(posted.some((message) => message.type === "response/error")).toBe(
      true,
    );
    router.dispose();
  });

  it("routes bounded technology coverage and adapter diagnostics", async () => {
    const posted: HostMessage[] = [];
    const technologies = vi.fn(() =>
      Promise.resolve({ generation: 4, items: [], detections: [], total: 0 }),
    );
    const adapterDiagnostics = vi.fn(() =>
      Promise.resolve({ generation: 4, items: [], total: 0 }),
    );
    const router = new WebviewMessageRouter(
      {} as WorkspaceStateStore,
      {} as ConfigurationService,
      { error: vi.fn() } as unknown as KeystoneLogger,
      "0.1.0",
      () => ({
        name: "fixture",
        rootCount: 1,
        trust: "trusted",
        indexStatus: "ready",
      }),
      (message) => {
        posted.push(message);
        return Promise.resolve(true);
      },
      {
        intelligenceRuntime: {
          onDidChange: () => ({ dispose: vi.fn() }),
        } as never,
        intelligenceQuery: {
          technologies,
          adapterDiagnostics,
        } as unknown as IntelligenceQueryService,
        cpgQuery: { scope: vi.fn(), slice: vi.fn() } as never,
        openSource: vi.fn(),
      } as never,
    );
    await router.handle({
      requestId: crypto.randomUUID(),
      type: "intelligence/technologies",
      timestamp: new Date().toISOString(),
      schemaVersion: 1,
      payload: { limit: 10 },
    });
    await router.handle({
      requestId: crypto.randomUUID(),
      type: "intelligence/adapter-diagnostics",
      timestamp: new Date().toISOString(),
      schemaVersion: 1,
      payload: { limit: 10 },
    });
    expect(technologies).toHaveBeenCalledWith(
      { limit: 10 },
      expect.any(AbortSignal),
    );
    expect(adapterDiagnostics).toHaveBeenCalledWith(
      { limit: 10 },
      expect.any(AbortSignal),
    );
    expect(
      posted.filter((message) => message.type === "response/success"),
    ).toHaveLength(2);
    router.dispose();
  });

  it("routes bounded repository diagnostics", async () => {
    const posted: HostMessage[] = [];
    const diagnostics = vi.fn(() =>
      Promise.resolve({ generation: 4, items: [], total: 0 }),
    );
    const router = new WebviewMessageRouter(
      {} as WorkspaceStateStore,
      {} as ConfigurationService,
      { error: vi.fn() } as unknown as KeystoneLogger,
      "0.1.0",
      () => ({
        name: "fixture",
        rootCount: 1,
        trust: "trusted",
        indexStatus: "ready",
      }),
      (message) => {
        posted.push(message);
        return Promise.resolve(true);
      },
      {
        intelligenceRuntime: {
          onDidChange: () => ({ dispose: vi.fn() }),
        } as never,
        intelligenceQuery: {
          diagnostics,
        } as unknown as IntelligenceQueryService,
        cpgQuery: { scope: vi.fn(), slice: vi.fn() } as never,
        openSource: vi.fn(),
      } as never,
    );
    await router.handle({
      requestId: crypto.randomUUID(),
      type: "intelligence/diagnostics",
      timestamp: new Date().toISOString(),
      schemaVersion: 1,
      payload: { codePrefix: "unresolved-", limit: 50 },
    });
    expect(diagnostics).toHaveBeenCalledWith(
      { codePrefix: "unresolved-", limit: 50 },
      expect.any(AbortSignal),
    );
    expect(posted.at(-1)?.type).toBe("response/success");
    router.dispose();
  });

  it("routes the unified query contract and emits lifecycle events", async () => {
    const posted: HostMessage[] = [];
    const queryId = crypto.randomUUID();
    const unified = vi.fn(
      (_payload: unknown, _signal: AbortSignal, id: string) =>
        Promise.resolve({
          queryId: id,
          operation: "SEARCH",
          generation: 7,
          executionTimeMs: 3,
          data: { kind: "search" },
        }),
    );
    const router = new WebviewMessageRouter(
      {} as WorkspaceStateStore,
      {} as ConfigurationService,
      { error: vi.fn() } as unknown as KeystoneLogger,
      "0.1.0",
      () => ({
        name: "fixture",
        rootCount: 1,
        trust: "trusted",
        indexStatus: "ready",
      }),
      (message) => {
        posted.push(message);
        return Promise.resolve(true);
      },
      {
        intelligenceRuntime: {
          onDidChange: () => ({ dispose: vi.fn() }),
        } as never,
        intelligenceQuery: { unified } as unknown as IntelligenceQueryService,
        cpgQuery: { scope: vi.fn(), slice: vi.fn() } as never,
        openSource: vi.fn(),
      } as never,
    );
    await router.handle({
      requestId: queryId,
      type: "intelligence/query",
      timestamp: new Date().toISOString(),
      schemaVersion: 1,
      payload: { text: "find OrderService" },
    });
    expect(unified).toHaveBeenCalledWith(
      { text: "find OrderService" },
      expect.any(AbortSignal),
      queryId,
    );
    expect(posted.map((message) => message.type)).toEqual([
      "intelligence/queryStarted",
      "intelligence/queryProgress",
      "intelligence/queryCompleted",
      "response/success",
    ]);
    router.dispose();
  });

  it("blocks executable and repository-mutating requests in Restricted Mode", async () => {
    const posted: HostMessage[] = [];
    const router = new WebviewMessageRouter(
      {} as WorkspaceStateStore,
      {} as ConfigurationService,
      { error: vi.fn() } as unknown as KeystoneLogger,
      "0.1.0",
      () => ({
        name: "fixture",
        rootCount: 1,
        trust: "restricted",
        indexStatus: "ready",
      }),
      (message) => {
        posted.push(message);
        return Promise.resolve(true);
      },
      {
        intelligenceRuntime: {
          onDidChange: () => ({ dispose: vi.fn() }),
        } as never,
        intelligenceQuery: {} as IntelligenceQueryService,
        cpgQuery: {} as never,
        openSource: vi.fn(),
        workspaceTrusted: () => false,
      } as never,
    );
    const requestId = crypto.randomUUID();
    await router.handle({
      requestId,
      type: "validation/run",
      timestamp: new Date().toISOString(),
      schemaVersion: 1,
      payload: { planId: crypto.randomUUID() },
    });
    expect(posted.at(-1)).toMatchObject({
      type: "response/error",
      payload: {
        requestId,
        error: { code: "WORKSPACE_TRUST_REQUIRED", recoverable: true },
      },
    });
    const buildRequestId = crypto.randomUUID();
    await router.handle({
      requestId: buildRequestId,
      type: "build/startDelegation",
      timestamp: new Date().toISOString(),
      schemaVersion: 1,
      payload: {
        workflowId: crypto.randomUUID(),
        taskId: crypto.randomUUID(),
        overlapOverride: false,
      },
    });
    expect(posted.at(-1)).toMatchObject({
      type: "response/error",
      payload: {
        requestId: buildRequestId,
        error: { code: "WORKSPACE_TRUST_REQUIRED", retryable: true },
      },
    });
    router.dispose();
  });
});
