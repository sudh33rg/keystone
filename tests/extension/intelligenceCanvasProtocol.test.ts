import { describe, expect, it } from "vitest";
import { WebviewRequestSchema } from "../../src/shared/contracts/messages";

const envelope = (type: string, payload: unknown) => ({ requestId: crypto.randomUUID(), type, payload, timestamp: new Date().toISOString(), schemaVersion: 1 });
const graph = { rootEntityIds: ["entity:a"], mode: "calls", direction: "both", depth: 1, relationshipTypes: ["calls"], maxNodes: 75, maxEdges: 150, minimumConfidence: 0, intelligenceRevision: "7" };

describe("Intelligence Canvas protocol", () => {
  it.each([
    ["intelligence.canvas.search", { query: "OrderService", limit: 20 }],
    ["intelligence.canvas.graph", graph],
    ["intelligence.canvas.expand", { ...graph, direction: "outbound" }],
    ["intelligence.canvas.evidence", { evidenceIds: ["evidence:a"], intelligenceRevision: "7" }],
    ["intelligence.canvas.query", { text: "Show callers of OrderService.create", intelligenceRevision: "7", limits: { maxNodes: 75, maxEdges: 150, depth: 2 } }],
    ["intelligence.canvas.openSource", { entityId: "entity:a", intelligenceRevision: "7" }],
    ["intelligence.canvas.openEvidenceSource", { evidenceId: "evidence:a", intelligenceRevision: "7" }],
    ["intelligence.canvas.addScope", { entityId: "entity:a", intelligenceRevision: "7" }],
    ["intelligence.canvas.addContext", { entityId: "entity:a", intelligenceRevision: "7" }],
    ["intelligence.canvas.addPathContext", { entityIds: ["entity:a", "entity:b"], edgeIds: ["edge:a-b"], evidenceIds: ["evidence:a-b"], intelligenceRevision: "7" }],
  ])("validates %s", (type, payload) => expect(WebviewRequestSchema.safeParse(envelope(type, payload)).success).toBe(true));

  it("rejects unbounded, unknown, and stale-shaped client requests at the boundary", () => {
    expect(WebviewRequestSchema.safeParse(envelope("intelligence.canvas.graph", { ...graph, depth: 99 })).success).toBe(false);
    expect(WebviewRequestSchema.safeParse(envelope("intelligence.canvas.graph", { ...graph, relationshipTypes: ["invented"] })).success).toBe(false);
    expect(WebviewRequestSchema.safeParse(envelope("intelligence.canvas.addPathContext", { entityIds: Array.from({ length: 21 }, (_, index) => `entity:${index}`), edgeIds: ["edge:a"], evidenceIds: [], intelligenceRevision: "7" })).success).toBe(false);
    expect(WebviewRequestSchema.safeParse(envelope("intelligence.canvas.openSource", { entityId: "entity:a" })).success).toBe(false);
  });
});
