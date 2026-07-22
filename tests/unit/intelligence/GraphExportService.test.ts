import { describe, expect, it } from "vitest";
import { GraphExportService } from "../../../src/core/intelligence/visualization/GraphExportService";

describe("Phase D — GraphExportService static HTML export", () => {
  const service = new GraphExportService();

  it("exportSnapshotAsStaticHtml includes title and metadata", async () => {
    const snapshot = {
      nodes: [{ id: "n:1", name: "users", x: 0, y: 0 }],
      edges: [{ id: "e:1", sourceId: "n:1", targetId: "n:2", relationship: "contains" }],
    };
    const html = await service.exportSnapshotAsStaticHtml(snapshot, { title: "repo" });
    expect(html).toContain("<title>repo</title>");
    expect(html).toContain("Exported ");
    expect(html).toContain("nodes");
    expect(html).toContain("edges");
  });

  it("falls back to symbols/relationships when nodes/edges absent", async () => {
    const snapshot = {
      symbols: [{ id: "s:1", name: "User" }],
      relationships: [{ id: "r:1", sourceId: "s:1", targetId: "s:1", type: "unknown" }],
    };
    const html = await service.exportSnapshotAsStaticHtml(snapshot);
    expect(html).toContain("User");
    expect(html).toContain('"id":"s:1"');
  });

  it("respects maxNodes/maxEdges bounds", async () => {
    const snapshot = {
      nodes: Array.from({ length: 10 }, (_, i) => ({ id: `n:${i}`, name: `n${i}` })),
      edges: Array.from({ length: 10 }, (_, i) => ({ id: `e:${i}`, sourceId: "n:0", targetId: `n:${i}`, relationship: "contains" })),
    };
    const html = await service.exportSnapshotAsStaticHtml(snapshot, { maxNodes: 3, maxEdges: 4 });
    const parsed = JSON.parse(html.match(/const data = ({[\s\S]*?});/)?.[1] ?? "{}");
    expect(parsed.nodes).toHaveLength(3);
    expect(parsed.edges).toHaveLength(4);
  });

  it("escapes title to prevent XSS-like injection", async () => {
    const html = await service.exportSnapshotAsStaticHtml({}, { title: '<script>alert(1)</script>' });
    const titleTag = html.match(/<title>([\s\S]*?)<\/title>/)?.[1] ?? "";
    expect(titleTag).not.toContain("<script>alert(1)</script>");
    expect(titleTag).toContain("&lt;script&gt;");
  });
});
