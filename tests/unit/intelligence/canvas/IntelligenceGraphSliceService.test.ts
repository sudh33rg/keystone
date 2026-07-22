import { describe, expect, it } from "vitest";
import { IntelligenceGraphSliceService, IntelligenceCanvasError } from "../../../../src/core/intelligence/canvas/IntelligenceGraphSliceService";
import { canvasSnapshot } from "./fixtures";

describe("IntelligenceGraphSliceService", () => {
  it("searches real entities with exact-first bounded disambiguation", () => {
    const service = new IntelligenceGraphSliceService({ getSnapshot: () => canvasSnapshot(), isStorageAvailable: () => true, getLoadError: () => undefined });
    const result = service.searchEntities({ query: "create", limit: 2 });
    expect(result.intelligenceRevision).toBe("7");
    expect(result.items).toHaveLength(2);
    expect(result.items[0]).toMatchObject({ label: "create", kind: "method", filePath: "src/orders.ts" });
    expect(result.items[1]?.filePath).toBe("src/users.ts");
    expect(result.items.every((item) => item.id.startsWith("entity:"))).toBe(true);
    expect(service.searchEntities({ query: "crea", limit: 10 }).items).toHaveLength(2);
    expect(service.searchEntities({ query: "fabricated", limit: 10 }).items).toEqual([]);
  });

  it("returns bounded inbound and outbound slices with evidence and stable IDs", () => {
    const service = new IntelligenceGraphSliceService({ getSnapshot: () => canvasSnapshot(), isStorageAvailable: () => true, getLoadError: () => undefined });
    const outbound = service.getGraphSlice({ rootEntityIds: ["entity:orders:create"], mode: "calls", direction: "outbound", depth: 1, relationshipTypes: ["calls"], maxNodes: 10, maxEdges: 10, minimumConfidence: 0 });
    expect(outbound.nodes.map((node) => node.id)).toEqual(["entity:orders:create", "entity:repo:save"]);
    expect(outbound.edges).toContainEqual(expect.objectContaining({ id: "relationship:create-save", sourceId: "entity:orders:create", targetId: "entity:repo:save", relationshipType: "calls", evidenceIds: ["evidence:create-save"], inferred: false, confidence: 1 }));
    const inbound = service.getGraphSlice({ ...outbound.request, rootEntityIds: ["entity:orders:create"], direction: "inbound" });
    expect(inbound.nodes.map((node) => node.id)).toEqual(["entity:orders:create", "entity:route:orders"]);
    expect(inbound.edges).toHaveLength(1);
  });

  it("respects depth, node, edge, relationship, and confidence limits and reports truncation", () => {
    const service = new IntelligenceGraphSliceService({ getSnapshot: () => canvasSnapshot(), isStorageAvailable: () => true, getLoadError: () => undefined });
    const slice = service.getGraphSlice({ rootEntityIds: ["entity:route:orders"], mode: "flow", direction: "outbound", depth: 3, relationshipTypes: ["routes-to", "calls"], maxNodes: 2, maxEdges: 1, minimumConfidence: .5 });
    expect(slice.nodes).toHaveLength(2);
    expect(slice.edges).toHaveLength(1);
    expect(slice.truncation).toMatchObject({ truncated: true, nodeLimitReached: true });
    expect(slice.truncation.expandableEntityIds.length).toBeGreaterThan(0);
    expect(slice.nodes.length).toBeLessThan(canvasSnapshot().symbols.length + canvasSnapshot().files.length);
  });

  it("rejects unknown roots, unsupported relationships, stale revisions, and invalid limits", () => {
    const service = new IntelligenceGraphSliceService({ getSnapshot: () => canvasSnapshot(), isStorageAvailable: () => true, getLoadError: () => undefined });
    const base = { rootEntityIds: ["missing"], mode: "calls" as const, direction: "both" as const, depth: 1, relationshipTypes: ["calls"], maxNodes: 10, maxEdges: 10, minimumConfidence: 0 };
    expect(() => service.getGraphSlice(base)).toThrowError(IntelligenceCanvasError);
    expect(() => service.getGraphSlice({ ...base, rootEntityIds: ["entity:orders:create"], relationshipTypes: ["made-up"] })).toThrow(/unsupported relationship/i);
    expect(() => service.getGraphSlice({ ...base, rootEntityIds: ["entity:orders:create"], intelligenceRevision: "6" })).toThrow(/stale/i);
    expect(() => service.getGraphSlice({ ...base, rootEntityIds: ["entity:orders:create"], depth: 9 })).toThrow(/depth/i);
  });

  it("groups duplicate relationships without losing evidence or confidence", () => {
    const snapshot = canvasSnapshot();
    snapshot.relationships.push({ ...snapshot.relationships.find((item) => item.id === "relationship:create-save")!, id: "relationship:create-save-duplicate", evidenceIds: ["evidence:duplicate"], confidence: .7, resolution: "convention" });
    const service = new IntelligenceGraphSliceService({ getSnapshot: () => snapshot, isStorageAvailable: () => true, getLoadError: () => undefined });
    const slice = service.getGraphSlice({ rootEntityIds: ["entity:orders:create"], mode: "calls", direction: "outbound", depth: 1, relationshipTypes: ["calls"], maxNodes: 10, maxEdges: 10, minimumConfidence: 0 });
    expect(slice.edges).toHaveLength(1);
    expect(slice.edges[0]).toMatchObject({ evidenceIds: ["evidence:create-save", "evidence:duplicate"], confidence: 1, inferred: true });
  });

  it("turns a validated bounded path into readable evidence-backed context", () => {
    const service = new IntelligenceGraphSliceService({ getSnapshot: () => canvasSnapshot(), isStorageAvailable: () => true, getLoadError: () => undefined });
    const described = service.describePath({ entityIds: ["entity:route:orders", "entity:orders:create", "entity:repo:save"], edgeIds: ["relationship:route-create", "relationship:create-save"], evidenceIds: ["evidence:route-create", "evidence:create-save"], intelligenceRevision: "7" });
    expect(described.label).toBe("Flow: POST /orders → OrderService.create → OrderRepository.save");
    expect(described.content).toContain("1. POST /orders routes-to OrderService.create");
    expect(described.content).toContain("src/orders.ts:2–3");
    expect(described.content).toMatch(/runtime order is not claimed/i);
    expect(() => service.describePath({ ...described, edgeIds: ["relationship:create-save", "relationship:route-create"] })).toThrow(/no longer matches/i);
  });
});
