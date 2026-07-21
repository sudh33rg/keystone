import { describe, expect, it } from "vitest";
import { IntelligenceQueryService } from "../../../src/core/intelligence/IntelligenceQueryService";
import { intelligenceSnapshot } from "./fixtures";

describe("IntelligenceQueryService", () => {
  it("keeps the last snapshot queryable while a refresh is pending", async () => {
    const snapshot = intelligenceSnapshot();
    const query = new IntelligenceQueryService(
      {
        isStorageAvailable: () => true,
        getSnapshot: () => snapshot,
        getLoadError: () => undefined,
      },
      {
        getState: () => ({
          status: "scanning",
          phase: "reconciling",
          pendingUpdate: true,
          scanRevision: 2,
          queueDepth: 1,
          activeWorkers: 1,
          workerCapacity: 3,
          pendingFiles: 2,
          completedJobs: 1,
          failedJobs: 0,
          staleResultsDiscarded: 0,
          workerRestarts: 0,
          throughputFilesPerSecond: 2,
          currentFiles: ["src/index.ts"],
          health: "healthy",
          progress: {
            stage: "inventory",
            fileCount: 4,
            totalFiles: 9,
            currentFiles: ["src/index.ts"],
          },
        }),
      },
    );
    expect(await query.overview()).toMatchObject({
      status: "scanning",
      pendingUpdate: true,
      generation: 1,
      runtime: { progress: { stage: "inventory", fileCount: 4, totalFiles: 9 } },
      counts: { files: 1, relationships: 1 },
    });
  });

  it("reports unavailable storage without placeholder metrics", async () => {
    const query = new IntelligenceQueryService(
      {
        isStorageAvailable: () => false,
        getSnapshot: () => undefined,
        getLoadError: () => undefined,
      },
      {
        getState: () => ({
          status: "storage-unavailable",
          phase: "failed",
          pendingUpdate: false,
          scanRevision: 0,
          queueDepth: 0,
          activeWorkers: 0,
          workerCapacity: 3,
          pendingFiles: 0,
          completedJobs: 0,
          failedJobs: 0,
          staleResultsDiscarded: 0,
          workerRestarts: 0,
          throughputFilesPerSecond: 0,
          currentFiles: [],
          health: "missing",
        }),
      },
    );
    expect(await query.overview()).toMatchObject({
      status: "storage-unavailable",
      generation: 0,
      counts: { files: 0, symbols: 0 },
    });
  });

  it("returns filtered, bounded, paginated diagnostics", async () => {
    const snapshot = intelligenceSnapshot();
    snapshot.diagnostics.push(
      {
        code: "unresolved-call",
        severity: "warning",
        message: "Could not prove call target.",
        relativePath: "src/index.ts",
      },
      {
        code: "unsupported-pattern",
        severity: "info",
        message: "Pattern is outside adapter capability.",
        relativePath: "src/index.ts",
        limitation: true,
      },
      {
        code: "unresolved-import",
        severity: "warning",
        message: "Could not prove import target.",
        relativePath: "src/index.ts",
      },
    );
    const query = new IntelligenceQueryService(
      {
        isStorageAvailable: () => true,
        getSnapshot: () => snapshot,
        getLoadError: () => undefined,
      },
      {
        getState: () => ({
          status: "ready",
          phase: "ready",
          pendingUpdate: false,
          scanRevision: 1,
          queueDepth: 0,
          activeWorkers: 0,
          workerCapacity: 3,
          pendingFiles: 0,
          completedJobs: 1,
          failedJobs: 0,
          staleResultsDiscarded: 0,
          workerRestarts: 0,
          throughputFilesPerSecond: 0,
          currentFiles: [],
          health: "healthy",
        }),
      },
    );
    const first = await query.diagnostics({
      codePrefix: "unresolved-",
      severities: ["warning"],
      limit: 1,
    });
    expect(first).toMatchObject({
      generation: 1,
      total: 2,
      items: [{ code: "unresolved-call" }],
      nextCursor: "1",
    });
    const second = await query.diagnostics({
      codePrefix: "unresolved-",
      severities: ["warning"],
      limit: 1,
      cursor: first.nextCursor,
    });
    expect(second).toMatchObject({ total: 2, items: [{ code: "unresolved-import" }] });
    expect(second.nextCursor).toBeUndefined();
  });
});
