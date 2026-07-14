import { describe, it, expect, vi, beforeEach } from "vitest";
import type { WorkspaceAdapter } from "../../../src/extension/adapters/WorkspaceAdapter";
import type { RepositoryIndexService } from "../../../src/core/intelligence/RepositoryIndexService";
import type { AgentRegistry } from "../../../src/core/copilot/AgentRegistry";
import type { IgnorePolicy } from "../../../src/core/intelligence/IgnorePolicy";
import { ContextEngine } from "../../../src/core/context/ContextEngine";

describe("ContextEngine", () => {
  let engine: ContextEngine;
  let workspace: WorkspaceAdapter;
  let index: RepositoryIndexService;
  let agentRegistry: AgentRegistry;
  let ignorePolicy: IgnorePolicy;

  beforeEach(() => {
    workspace = {
      getRoots: () => [{ name: "test", uri: { scheme: "file", path: "/test" } }],
      readTextFile: vi.fn(),
      readFile: vi.fn(),
      onDidCreate: vi.fn(),
      onDidDelete: vi.fn(),
      onDidRename: vi.fn(),
      onDidChange: vi.fn(),
      getConfiguration: vi.fn()
    } as unknown as WorkspaceAdapter;

    index = {
      getIndex: () => ({ indexVersion: 1 }),
      start: vi.fn(),
      cancel: vi.fn()
    } as unknown as RepositoryIndexService;

    agentRegistry = {
      getProfile: () => ({ defaultContextPolicy: { maxEstimatedTokens: 12000 } }),
      getProfiles: () => [],
      getSelectionMode: () => "recommended",
      setSelectionMode: vi.fn(),
      assign: vi.fn(),
      getAssignment: vi.fn()
    } as unknown as AgentRegistry;

    ignorePolicy = {
      classify: () => "source",
      isExcluded: () => false
    } as unknown as IgnorePolicy;

    engine = new ContextEngine(workspace, index, agentRegistry, ignorePolicy);
  });

  it("should build a context package with mandatory items", async () => {
    const result = await engine.buildPackage("task-1", 1);

    expect(result.package.taskId).toBe("task-1");
    expect(result.package.specificationRevision).toBe(1);
    expect(result.package.items.length).toBeGreaterThan(0);
    expect(result.package.items[0].isMandatory).toBe(true);
  });

  it("should respect budget limits", async () => {
    agentRegistry.getProfile = () => ({ defaultContextPolicy: { maxEstimatedTokens: 100 } });

    const result = await engine.buildPackage("task-1", 1);

    expect(result.estimate.tokens).toBeLessThanOrEqual(100);
  });

  it("should compute a deterministic fingerprint", async () => {
    const result1 = await engine.buildPackage("task-1", 1);
    const result2 = await engine.buildPackage("task-1", 1);

    expect(result1.package.fingerprint).toBe(result2.package.fingerprint);
  });
});
