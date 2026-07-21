import { describe, expect, it, vi } from "vitest";
import { StartupReconciler } from "../../../../src/core/intelligence/runtime/StartupReconciler";
import { stableId } from "../../../../src/core/intelligence/StableId";
import type {
  WorkspaceAdapter,
  WorkspaceRootReference,
} from "../../../../src/extension/adapters/WorkspaceAdapter";
import { intelligenceSnapshot } from "../fixtures";

describe("StartupReconciler", () => {
  const root: WorkspaceRootReference = { name: "fixture", uri: "file:///fixture" };

  it("keeps a valid generation ready without scheduling work", async () => {
    const snapshot = await matchingSnapshot(root);
    const reconciler = new StartupReconciler(
      workspace(root),
      git(),
      store(snapshot, "healthy") as never,
    );
    await expect(reconciler.reconcile()).resolves.toMatchObject({
      phase: "ready",
      action: "none",
      changes: [],
    });
  });

  it("rebuilds missing intelligence and recovers damaged persistence", async () => {
    const missing = new StartupReconciler(
      workspace(root),
      git(),
      store(undefined, "missing") as never,
    );
    await expect(missing.reconcile()).resolves.toMatchObject({
      phase: "rebuilding",
      action: "rebuild",
      reason: "startup",
    });

    const damaged = new StartupReconciler(
      workspace(root),
      git(),
      store(await matchingSnapshot(root), "damaged") as never,
    );
    await expect(damaged.reconcile()).resolves.toMatchObject({
      phase: "recovering",
      action: "recover",
      reason: "storage-recovery",
    });
  });

  it("rebuilds when the persisted semantic parser version is stale", async () => {
    const snapshot = await matchingSnapshot(root);
    snapshot.manifest.extractorVersions["keystone.typescript"] = "old";
    const reconciler = new StartupReconciler(
      workspace(root),
      git(),
      store(snapshot, "healthy") as never,
      { "keystone.typescript": "current" },
    );
    await expect(reconciler.reconcile()).resolves.toMatchObject({
      phase: "rebuilding",
      action: "rebuild",
      reason: "startup",
    });
  });

  it("turns a Git rename into an incremental delete and add batch", async () => {
    const snapshot = await matchingSnapshot(root);
    snapshot.repository.headCommit = "old";
    const adapter = git({ headCommit: "new" }, [
      {
        uri: `${root.uri}/src/renamed.ts`,
        originalUri: `${root.uri}/src/index.ts`,
        kind: "renamed",
      },
    ]);
    const reconciler = new StartupReconciler(
      workspace(root, ["src/renamed.ts"]),
      adapter,
      store(snapshot, "healthy") as never,
    );
    const result = await reconciler.reconcile();
    expect(result).toMatchObject({ phase: "reconciling", action: "incremental" });
    expect(result.changes.map((change) => [change.kind, change.relativePath])).toEqual([
      ["deleted", "src/index.ts"],
      ["added", "src/renamed.ts"],
    ]);
  });
});

async function matchingSnapshot(root: WorkspaceRootReference) {
  const snapshot = intelligenceSnapshot();
  const repositoryId = await stableId("repository", root.uri, undefined);
  const rootId = await stableId("workspace-root", repositoryId, root.uri);
  snapshot.repository.id = repositoryId;
  snapshot.repository.workspaceRoots[0]!.id = rootId;
  snapshot.repository.headCommit = "head";
  snapshot.manifest.repositoryId = repositoryId;
  snapshot.files[0]!.repositoryId = repositoryId;
  snapshot.files[0]!.workspaceRootId = rootId;
  return snapshot;
}

function workspace(root: WorkspaceRootReference, paths = ["src/index.ts"]): WorkspaceAdapter {
  return {
    getRoots: () => [root],
    listFiles: () =>
      Promise.resolve(
        paths.map((relativePath) => ({ root, relativePath, uri: `${root.uri}/${relativePath}` })),
      ),
    resolveFile: (uri: string) => {
      const relativePath = uri.slice(root.uri.length + 1);
      return uri.startsWith(`${root.uri}/`) ? { root, uri, relativePath } : undefined;
    },
    fileReference: (selectedRoot: WorkspaceRootReference, relativePath: string) => ({
      root: selectedRoot,
      relativePath,
      uri: `${selectedRoot.uri}/${relativePath}`,
    }),
    statFile: () =>
      Promise.resolve({ byteSize: 12, modifiedAt: "2026-07-15T00:00:00.000Z", type: "file" }),
    getIndexingConfiguration: () => ({
      enabled: true,
      onWorkspaceOpen: true,
      onBranchChange: true,
      maxFiles: 100,
      maxFileSizeBytes: 1024,
      workerCount: 2,
      retainedGenerations: 2,
      exclusions: [],
    }),
  } as unknown as WorkspaceAdapter;
}

function git(metadata: object = {}, changes: object[] = []) {
  return {
    getMetadata: vi.fn(() => Promise.resolve({ branch: "main", headCommit: "head", ...metadata })),
    getReconciliationChanges: vi.fn(() => Promise.resolve(changes)),
  } as never;
}

function store(
  snapshot: ReturnType<typeof intelligenceSnapshot> | undefined,
  status: "healthy" | "missing" | "damaged",
) {
  return {
    getSnapshot: () => snapshot,
    checkHealth: () =>
      Promise.resolve({
        status,
        pendingGenerations: 0,
        ...(status === "damaged" ? { message: "missing shard" } : {}),
      }),
  };
}
