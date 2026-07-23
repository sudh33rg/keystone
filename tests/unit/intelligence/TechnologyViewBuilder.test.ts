import { describe, expect, it } from "vitest";
import { TechnologyViewBuilder } from "../../../src/core/intelligence/visualization/TechnologyViewBuilder";
import type { BuilderContext } from "../../../src/core/intelligence/visualization/BaseViewBuilder";
import type { IntelligenceSnapshot } from "../../../src/shared/contracts/intelligence";

interface TestSnapshot {
  symbols: unknown[];
  files: unknown[];
  relationships: unknown[];
  repository: { id: string };
  manifest: { status: string; generation: number; contentHash: string; updatedAt: string };
  diagnostics: unknown[];
}

const makeSnapshot = (symbols: unknown[] = [], relationships: unknown[] = []): TestSnapshot => ({
  symbols,
  files: [],
  relationships,
  repository: { id: "repo:root" },
  manifest: { status: "ok", generation: 1, contentHash: "h", updatedAt: new Date().toISOString() },
  diagnostics: [],
});

const ctx = (snapshot: TestSnapshot, seeds: string[]): BuilderContext =>
  ({ snapshot: snapshot as unknown as IntelligenceSnapshot, seeds, options: {} }) as unknown as BuilderContext;

describe("QA — TechnologyViewBuilder", () => {
  it("build includes explicit technology nodes", async () => {
    const snapshot = makeSnapshot([
      { id: "db:1", type: "keystone.core.Database", name: "postgres", qualifiedName: "postgres", evidenceIds: [] },
      { id: "svc:1", type: "keystone.core.ExternalService", name: "redis", qualifiedName: "redis", evidenceIds: [] },
    ]);
    snapshot.relationships = [
      { id: "r:1", sourceId: "db:1", targetId: "svc:1", type: "keystone.core.USES_TECHNOLOGY", confidence: 1, evidenceIds: [] },
    ];
    const viz = await TechnologyViewBuilder.build(ctx(snapshot, ["db:1"]));
    expect(viz.nodes.length).toBe(2);
    expect(viz.edges.length).toBeGreaterThanOrEqual(1);
    expect(viz.edges.some((e) => e.relationship === "uses")).toBe(true);
  });

  it("build ignores unrelated relationship types", async () => {
    const snapshot = makeSnapshot([
      { id: "db:1", type: "keystone.core.Database", name: "pg", evidenceIds: [] },
    ]);
    snapshot.relationships = [
      { id: "r:1", sourceId: "db:1", targetId: "db:1", type: "keystone.core.CONTAINS", confidence: 1, evidenceIds: [] },
    ];
    const viz = await TechnologyViewBuilder.build(ctx(snapshot, ["db:1"]));
    expect(viz.edges.filter((e) => e.relationship !== "unknown").length).toBe(0);
  });

  it("exposes deterministic ids while seeding from a query", async () => {
    const snapshot = makeSnapshot([
      { id: "db:1", type: "keystone.core.Database", name: "postgres", evidenceIds: [] },
    ]);
    const viz = await TechnologyViewBuilder.build(ctx(snapshot, ["db:1"]));
    const ids = viz.nodes.map((n) => n.id).sort();
    expect(ids).toEqual(["n:db:1"]);
  });
});
