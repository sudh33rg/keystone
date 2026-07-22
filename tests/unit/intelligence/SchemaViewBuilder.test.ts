import { describe, expect, it } from "vitest";
import { SchemaViewBuilder } from "../../../src/core/intelligence/visualization/SchemaViewBuilder";

const makeSnapshot = (symbols: any[] = [], relationships: any[] = []): any => ({
  symbols,
  files: [],
  relationships,
  repository: { id: "repo:root" },
  manifest: { status: "ok", generation: 1, contentHash: "h", updatedAt: new Date().toISOString() },
  diagnostics: [],
});

describe("Phase D — SchemaViewBuilder", () => {
  it("builds schema graph from seed entity ids", async () => {
    const snapshot = makeSnapshot([
      { id: "db:1", type: "keystone.core.Database", name: "pg", qualifiedName: "pg", evidenceIds: [] },
      { id: "tbl:1", type: "keystone.core.Table", name: "users", qualifiedName: "public.users", evidenceIds: [] },
      { id: "col:1", type: "keystone.core.SchemaColumn", name: "id", qualifiedName: "public.users.id", evidenceIds: [] },
    ]);
    snapshot.relationships = [
      { id: "r:1", sourceId: "tbl:1", targetId: "col:1", type: "keystone.core.DB_TABLE_HAS_COLUMN", confidence: 1, evidenceIds: [] },
    ];
    const viz = await SchemaViewBuilder.build({ snapshot, seeds: ["tbl:1"], options: {} } as any);
    expect(viz.nodes.length).toBeGreaterThanOrEqual(1);
    expect(viz.edges.some((e) => e.relationship === "contains")).toBe(true);
  });

  it("does not crash when no schema relationships", async () => {
    const snapshot = makeSnapshot();
    snapshot.relationships = [];
    const viz = await SchemaViewBuilder.build({ snapshot, seeds: ["unknown"], options: {} } as any);
    // buildNode adds a kind prefix; unknown kind becomes "unknown:<id>"
    expect(viz.nodes.map((n) => n.id).sort()).toEqual(["n:unknown"]);
    expect(viz.edges.length).toBe(0);
  });
});
