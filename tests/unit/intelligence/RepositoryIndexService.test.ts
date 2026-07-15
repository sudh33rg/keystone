import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { DefaultIgnorePolicy } from "../../../src/core/intelligence/IgnorePolicy";
import { RepositoryIndexService } from "../../../src/core/intelligence/RepositoryIndexService";
import { IntelligenceStore } from "../../../src/core/persistence/IntelligenceStore";
import type { GitAdapter } from "../../../src/extension/adapters/GitAdapter";
import type { LanguageServiceAdapter } from "../../../src/extension/adapters/LanguageServiceAdapter";
import type { WorkspaceAdapter, WorkspaceFileReference, WorkspaceRootReference } from "../../../src/extension/adapters/WorkspaceAdapter";
import type { KeystoneLogger } from "../../../src/shared/logging/KeystoneLogger";

describe("RepositoryIndexService", () => {
  const directories: string[] = [];
  afterEach(async () => { await Promise.all(directories.splice(0).map((path) => rm(path, { recursive: true, force: true }))); });

  it("publishes only observed containment and declaration relationships", async () => {
    const storageRoot = await mkdtemp(join(tmpdir(), "keystone-index-"));
    directories.push(storageRoot);
    const root: WorkspaceRootReference = { name: "fixture", uri: "file:///fixture" };
    const paths = ["src/index.ts", "tests/index.test.ts", "dist/bundle.js", ".env", "src/excluded.ts"];
    const files: WorkspaceFileReference[] = paths.map((relativePath) => ({ root, relativePath, uri: `${root.uri}/${relativePath}` }));
    const readFile = vi.fn((uri: string) => Promise.resolve(new TextEncoder().encode(uri.includes("test") ? "test('works', () => true)" : "export function run() {}")));
    const workspace: WorkspaceAdapter = {
      getRoots: () => [root],
      getWorkspaceId: () => root.uri,
      getWorkspaceRoot: () => root.uri,
      isTrusted: () => true,
      listFiles: () => Promise.resolve(files),
      resolveFile: (uri) => files.find((file) => file.uri === uri),
      fileReference: (selectedRoot, relativePath) => ({ root: selectedRoot, relativePath, uri: `${selectedRoot.uri}/${relativePath}` }),
      statFile: () => Promise.resolve({ byteSize: 24, modifiedAt: "2026-07-15T00:00:00.000Z", type: "file" }),
      readFile,
      readTextFile: async (uri) => new TextDecoder().decode(await readFile(uri)),
      getIndexingConfiguration: () => ({ enabled: true, onWorkspaceOpen: false, onBranchChange: true, maxFiles: 100, maxFileSizeBytes: 1024, workerCount: 2, retainedGenerations: 2, exclusions: ["src/excluded.ts"] }),
      getConfiguration: () => ({ get: (_section, defaultValue) => defaultValue })
    };
    const git = {
      getMetadata: () => Promise.resolve({ branch: "main", headCommit: "abc123" })
    } as unknown as GitAdapter;
    const language: LanguageServiceAdapter = {
      extractSymbols: (uri) => Promise.resolve({
        language: "typescript",
        extractorId: "test.language-provider",
        extractorVersion: "1",
        available: true,
        symbols: [{ name: uri.includes("test") ? "works" : "run", qualifiedName: uri.includes("test") ? "works" : "run", type: "keystone.core.Function", range: { startLine: 0, startColumn: 0, endLine: 0, endColumn: 3 } }]
      })
    };
    const logger = { info: vi.fn(), error: vi.fn() } as unknown as KeystoneLogger;
    const store = new IntelligenceStore(storageRoot);
    const service = new RepositoryIndexService(workspace, git, language, new DefaultIgnorePolicy(), store, logger);
    await service.initialize();

    const completed = new Promise<void>((resolve) => {
      const subscription = service.onDidChange((state) => {
        if (!state.pendingUpdate && (state.status === "ready" || state.status === "partial")) {
          subscription.dispose();
          resolve();
        }
      });
    });
    service.start();
    await completed;

    const snapshot = store.getSnapshot();
    expect(snapshot?.files).toHaveLength(5);
    expect(snapshot?.files.find((file) => file.relativePath === "tests/index.test.ts")?.classification).toMatchObject({ category: "test", included: true, generated: false });
    expect(snapshot?.files.find((file) => file.relativePath === "src/excluded.ts")?.classification).toMatchObject({ included: false, analysisLevel: "excluded", ruleId: "exclude.user" });
    expect(snapshot?.files.find((file) => file.relativePath === ".env")?.contentHash).toBeUndefined();
    expect(readFile).not.toHaveBeenCalledWith("file:///fixture/.env");
    expect(snapshot?.relationships.every((relationship) => ["keystone.core.CONTAINS", "keystone.core.DECLARES"].includes(relationship.type))).toBe(true);
    expect(snapshot?.relationships.every((relationship) => relationship.evidenceIds.length > 0)).toBe(true);
    expect(snapshot?.relationships.filter((relationship) => relationship.type === "keystone.core.DECLARES")).toHaveLength(2);

    const firstIds = {
      files: snapshot?.files.map((item) => item.id),
      symbols: snapshot?.symbols.map((item) => item.id),
      relationships: snapshot?.relationships.map((item) => item.id)
    };
    const rescanned = new Promise<void>((resolve) => {
      const subscription = service.onDidChange((state) => {
        if (!state.pendingUpdate && state.scanRevision === 2) { subscription.dispose(); resolve(); }
      });
    });
    service.start();
    await rescanned;
    expect({
      files: store.getSnapshot()?.files.map((item) => item.id),
      symbols: store.getSnapshot()?.symbols.map((item) => item.id),
      relationships: store.getSnapshot()?.relationships.map((item) => item.id)
    }).toEqual(firstIds);

    await service.reconcile([{ kind: "deleted", rootUri: root.uri, uri: `${root.uri}/src/excluded.ts`, relativePath: "src/excluded.ts", reason: "file" }], "file");
    expect(store.getSnapshot()?.manifest).toMatchObject({ generation: 3 });
    expect(store.getSnapshot()?.files.some((item) => item.relativePath === "src/excluded.ts")).toBe(false);
    expect(store.getSnapshot()?.relationships.every((relationship) => ["keystone.core.CONTAINS", "keystone.core.DECLARES"].includes(relationship.type))).toBe(true);
  });

  it("discards a superseded scan before atomic publication", async () => {
    const storageRoot = await mkdtemp(join(tmpdir(), "keystone-index-"));
    directories.push(storageRoot);
    const root: WorkspaceRootReference = { name: "fixture", uri: "file:///fixture" };
    const file: WorkspaceFileReference = { root, relativePath: "src/index.ts", uri: `${root.uri}/src/index.ts` };
    let releaseFirst: (() => void) | undefined;
    let firstInvoked: (() => void) | undefined;
    const firstStarted = new Promise<void>((resolve) => { firstInvoked = resolve; });
    const firstResult = new Promise<void>((resolve) => { releaseFirst = resolve; });
    let extraction = 0;
    const language: LanguageServiceAdapter = {
      extractSymbols: async () => {
        extraction += 1;
        if (extraction === 1) {
          firstInvoked?.();
          await firstResult;
        }
        return { language: "typescript", extractorId: "test.provider", extractorVersion: "1", available: true, symbols: [] };
      }
    };
    const workspace = {
      getRoots: () => [root], getWorkspaceId: () => root.uri, getWorkspaceRoot: () => root.uri, isTrusted: () => true,
      listFiles: () => Promise.resolve([file]),
      statFile: () => Promise.resolve({ byteSize: 12, modifiedAt: "2026-07-15T00:00:00.000Z", type: "file" as const }),
      readFile: () => Promise.resolve(new TextEncoder().encode("export const value = 1")),
      readTextFile: () => Promise.resolve("export const value = 1"),
      getIndexingConfiguration: () => ({ enabled: true, onWorkspaceOpen: false, maxFiles: 10, maxFileSizeBytes: 1024, exclusions: [] }),
      getConfiguration: () => ({ get: (_section: string, defaultValue: unknown) => defaultValue }),
      resolveFile: (uri: string) => uri === file.uri ? file : undefined,
      fileReference: (selectedRoot: WorkspaceRootReference, relativePath: string) => ({ root: selectedRoot, relativePath, uri: `${selectedRoot.uri}/${relativePath}` })
    } as unknown as WorkspaceAdapter;
    const git = { getMetadata: () => Promise.resolve({ branch: "main" }) } as unknown as GitAdapter;
    const store = new IntelligenceStore(storageRoot);
    const service = new RepositoryIndexService(workspace, git, language, new DefaultIgnorePolicy(), store, { info: vi.fn(), error: vi.fn() } as unknown as KeystoneLogger);
    await service.initialize();
    service.start();
    await firstStarted;
    const completed = new Promise<void>((resolve) => {
      const subscription = service.onDidChange((state) => {
        if (!state.pendingUpdate && state.scanRevision === 2) { subscription.dispose(); resolve(); }
      });
    });
    service.start();
    await completed;
    releaseFirst?.();
    await new Promise<void>((resolve) => setImmediate(resolve));

    expect(store.getSnapshot()?.manifest).toMatchObject({ generation: 1, scanRevision: 2 });
  });

  it("rejects a file result when its content hash changes before merge", async () => {
    const storageRoot = await mkdtemp(join(tmpdir(), "keystone-index-"));
    directories.push(storageRoot);
    const root: WorkspaceRootReference = { name: "fixture", uri: "file:///fixture" };
    const file: WorkspaceFileReference = { root, relativePath: "src/index.ts", uri: `${root.uri}/src/index.ts` };
    let read = 0;
    const workspace = {
      getRoots: () => [root], getWorkspaceId: () => root.uri, getWorkspaceRoot: () => root.uri, isTrusted: () => true,
      listFiles: () => Promise.resolve([file]), resolveFile: () => file, fileReference: () => file,
      statFile: () => Promise.resolve({ byteSize: 18, modifiedAt: "2026-07-15T00:00:00.000Z", type: "file" as const }),
      readFile: () => Promise.resolve(new TextEncoder().encode(++read === 1 ? "export const a = 1" : "export const b = 2")),
      readTextFile: () => Promise.resolve(""),
      getIndexingConfiguration: () => ({ enabled: true, onWorkspaceOpen: false, onBranchChange: true, maxFiles: 10, maxFileSizeBytes: 1024, workerCount: 2, retainedGenerations: 2, exclusions: [] }),
      getConfiguration: () => ({ get: (_section: string, defaultValue: unknown) => defaultValue })
    } as unknown as WorkspaceAdapter;
    const language: LanguageServiceAdapter = { extractSymbols: () => Promise.resolve({ language: "typescript", extractorId: "test", extractorVersion: "1", available: true, symbols: [] }) };
    const service = new RepositoryIndexService(workspace, { getMetadata: () => Promise.resolve({ branch: "main" }) } as never, language, new DefaultIgnorePolicy(), new IntelligenceStore(storageRoot), { info: vi.fn(), error: vi.fn() } as never);
    await service.initialize();

    await expect(service.rebuild("file")).rejects.toMatchObject({ code: "INTELLIGENCE_SOURCE_STALE" });
  });
});
