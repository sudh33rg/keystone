import { describe, expect, it } from "vitest";
import { SourceScopeService } from "../../../src/core/development/SourceScopeService";

describe("SourceScopeService", () => {
  it("adds, deduplicates, removes, and reloads real workspace files", async () => {
    const existing = new Set(["src/a.ts", "docs/guide.md"]);
    const service = new SourceScopeService("/workspace", { exists: async (path) => existing.has(path) });
    const item = await service.createFileItem({ workflowId: crypto.randomUUID(), workItemId: crypto.randomUUID(), fileUri: "file:///workspace/src/a.ts", source: "file-picker", existing: [] });
    expect(item.workspaceRelativePath).toBe("src/a.ts");
    await expect(service.createFileItem({ workflowId: item.workflowId, workItemId: item.workItemId, fileUri: item.fileUri, source: "current-editor", existing: [item] })).rejects.toMatchObject({ code: "duplicate-scope-item" });
    expect(service.remove(item.id, [item])).toEqual([]);
  });

  it("rejects missing and external files and reports deleted persisted files as missing", async () => {
    const service = new SourceScopeService("/workspace", { exists: async (path) => path === "src/a.ts" });
    const ids = { workflowId: crypto.randomUUID(), workItemId: crypto.randomUUID() };
    await expect(service.createFileItem({ ...ids, fileUri: "file:///workspace/src/missing.ts", source: "file-picker", existing: [] })).rejects.toMatchObject({ code: "file-not-found" });
    await expect(service.createFileItem({ ...ids, fileUri: "file:///outside/secret.ts", source: "file-picker", existing: [] })).rejects.toMatchObject({ code: "file-outside-workspace" });
    const item = await service.createFileItem({ ...ids, fileUri: "file:///workspace/src/a.ts", source: "current-editor", existing: [] });
    const refreshed = await new SourceScopeService("/workspace", { exists: async () => false }).refreshAvailability([item]);
    expect(refreshed[0]!.availability).toBe("missing");
  });

  it("adds only genuinely resolved symbols", async () => {
    const service = new SourceScopeService("/workspace", { exists: async () => true });
    const ids = { workflowId: crypto.randomUUID(), workItemId: crypto.randomUUID() };
    const symbol = await service.createSymbolItem({ ...ids, fileUri: "file:///workspace/src/a.ts", source: "intelligence", existing: [], symbol: { entityId: "entity-1", name: "refund", kind: "function", range: { startLine: 2, endLine: 8 } } });
    expect(symbol.symbol?.name).toBe("refund");
    await expect(service.createSymbolItem({ ...ids, fileUri: "file:///workspace/src/a.ts", source: "current-selection", existing: [], symbol: undefined })).rejects.toMatchObject({ code: "symbol-unresolved" });
  });
});
