import { describe, expect, it } from "vitest";
import { buildQaSampleSnapshot } from "../../fixtures/intelligence/qaSampleSnapshot";
import { WorkspaceChangeSetService } from "../../../src/core/impactQa/WorkspaceChangeSetService";
import { ChangedSymbolResolver } from "../../../src/core/impactQa/ChangedSymbolResolver";
import { ImpactAnalysisService } from "../../../src/core/impactQa/ImpactAnalysisService";

const snapshot = buildQaSampleSnapshot();
const workflowId = "00000000-0000-4000-8000-000000000071";

describe("Phase 7 change set", () => {
  it("deduplicates real staged, unstaged, added, deleted and renamed changes", async () => {
    const service = new WorkspaceChangeSetService({ detect: async () => ({ source: "git", baseRevision: "a", headRevision: "b", files: [
      { path: "src/order/OrderService.ts", changeType: "modified", staged: false, changedRanges: [{ newStartLine: 2, newEndLine: 8 }] },
      { path: "src/order/OrderService.ts", changeType: "modified", staged: true, changedRanges: [{ newStartLine: 2, newEndLine: 8 }] },
      { path: "src/new.ts", changeType: "added" }, { path: "src/old.ts", changeType: "deleted" },
      { path: "src/moved.ts", oldPath: "src/original.ts", changeType: "renamed" },
    ] }) });
    const result = await service.detect({ workflowId, workspaceFiles: new Set(["src/order/OrderService.ts", "src/new.ts", "src/old.ts", "src/moved.ts"]) });
    expect(result.source).toBe("git");
    expect(result.files).toHaveLength(4);
    expect(result.files.find((item) => item.path.endsWith("OrderService.ts"))?.staged).toBe(true);
    expect(result.contentHash).toMatch(/^sha256:/);
  });

  it("supports a non-Git manual selection and rejects outside-workspace paths", async () => {
    const service = new WorkspaceChangeSetService({ detect: async () => undefined });
    const result = await service.detect({ workflowId, workspaceFiles: new Set(["src/order/OrderService.ts"]), manualFiles: ["src/order/OrderService.ts"] });
    expect(result.source).toBe("manual-selection");
    expect(result.files[0]?.source).toBe("manual");
    await expect(service.detect({ workflowId, workspaceFiles: new Set(), manualFiles: ["../outside.ts"] })).rejects.toMatchObject({ code: "file-outside-workspace" });
  });

  it("marks a saved snapshot stale when its bounded fingerprint changes", async () => {
    const service = new WorkspaceChangeSetService({ detect: async () => ({ source: "workspace-snapshot", files: [{ path: "src/order/OrderService.ts", changeType: "modified" }] }) });
    const first = await service.detect({ workflowId, workspaceFiles: new Set(["src/order/OrderService.ts"]) });
    expect(service.freshness(first, first.contentHash)).toEqual({ stale: false });
    expect(service.freshness(first, "sha256:changed").stale).toBe(true);
  });
});

describe("Phase 7 changed symbols and impact", () => {
  const changeSet = {
    id: "change-1", workflowId, source: "git" as const, files: [{ path: "src/order/OrderService.ts", changeType: "modified" as const, staged: false, source: "git" as const, changedRanges: [{ newStartLine: 2, newEndLine: 8 }] }],
    status: "ready" as const, createdAt: "2026-01-01T00:00:00.000Z", updatedAt: "2026-01-01T00:00:00.000Z", contentHash: "sha256:change",
  };

  it("maps changed ranges to actual entities with revision and evidence", () => {
    const entities = new ChangedSymbolResolver(snapshot).resolve(changeSet, "generation:1");
    expect(entities.some((item) => item.entityId === "s-createOrder")).toBe(true);
    expect(entities.every((item) => item.intelligenceRevision === "generation:1")).toBe(true);
    expect(entities.flatMap((item) => item.evidenceIds)).toContain("e-s-createOrder");
  });

  it("falls back honestly for unsupported files without fabricating a symbol", () => {
    const unsupported = { ...changeSet, files: [{ path: "assets/image.bin", changeType: "modified" as const, source: "manual" as const }] };
    const resolved = new ChangedSymbolResolver(snapshot).resolve(unsupported, "generation:1");
    expect(resolved).toEqual([expect.objectContaining({ changeType: "file-level", confidence: 0 })]);
    expect(resolved[0]).not.toHaveProperty("entityId");
  });

  it("returns bounded direct callers, transitive impacts, mapped tests and evidence", () => {
    const changed = new ChangedSymbolResolver(snapshot).resolve(changeSet, "generation:1");
    const analysis = new ImpactAnalysisService(snapshot).analyze({ workflowId, changeSet, changedEntities: changed, intelligenceRevision: "generation:1", depth: 3, maxNodes: 20, maxEdges: 30 });
    expect(analysis.impacts.some((item) => item.entityId === "s-controller" && item.distance === 1)).toBe(true);
    expect(analysis.affectedFlowIds).toContain("s-controller");
    expect(analysis.affectedContractIds).toContain("s-createOrder");
    expect(analysis.risk.factors.some((item) => item.id === "persistence-interaction")).toBe(true);
    expect(analysis.mappedTests.some((item) => item.testFilePath.endsWith("OrderService.test.ts"))).toBe(true);
    expect(analysis.impacts.every((item) => item.evidenceIds.length > 0)).toBe(true);
    expect(analysis.graph.nodes.length).toBeLessThanOrEqual(20);
    expect(analysis.risk.factors.length).toBeGreaterThan(0);
  });

  it("excludes unrelated branches and truthfully represents no impact", () => {
    const fileOnly = [{ id: "changed:unknown", filePath: "unknown.txt", changeType: "file-level" as const, confidence: 0, evidenceIds: [], intelligenceRevision: "generation:1" }];
    const analysis = new ImpactAnalysisService(snapshot).analyze({ workflowId, changeSet, changedEntities: fileOnly, intelligenceRevision: "generation:1", depth: 2, maxNodes: 10, maxEdges: 10 });
    expect(analysis.impacts).toEqual([]);
    expect(analysis.summary).toMatch(/No evidence-backed/i);
  });
});
