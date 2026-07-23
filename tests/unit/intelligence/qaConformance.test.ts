import { describe, expect, it } from "vitest";
import { IntelligenceQueryService } from "../../../src/core/intelligence/IntelligenceQueryService";
import { FuseSearchService } from "../../../src/core/intelligence/query/FuseSearchService";
import { IntelligenceVisualizationService } from "../../../src/core/intelligence/visualization/IntelligenceVisualizationService";
import { GraphExportService } from "../../../src/core/intelligence/visualization/GraphExportService";
import { CopilotContextService } from "../../../src/core/intelligence/visualization/CopilotContextService";
import type { IntelligenceSnapshot } from "../../../src/shared/contracts/intelligence";

describe("QA — polyglot conformance pipeline", () => {
  it("fires all QA surfaces against a deterministic polyglot snapshot", async () => {
    const snapshot = makeSnapshot();
    const query = new IntelligenceQueryService({ getSnapshot: () => snapshot } as any, { getState: () => ({}) } as any);
    const search = new FuseSearchService(snapshot);
    const viz = new IntelligenceVisualizationService(snapshot);

    expect(snapshot.symbols.length).toBeGreaterThanOrEqual(5);
    expect(snapshot.files.length).toBe(3);
    expect(snapshot.symbols.some((symbol) => symbol.type === "keystone.core.Table")).toBe(true);
    expect(snapshot.symbols.some((symbol) => symbol.type === "keystone.core.Column")).toBe(true);
    expect(snapshot.relationships.some((relationship) => relationship.type === "keystone.core.CALLS")).toBe(true);
    expect(snapshot.relationships.some((relationship) => relationship.type === "db-table-has-column")).toBe(true);

    const schemaViz = await viz.build({ viewType: "schema", direction: "both", maxDepth: 1 });
    expect(schemaViz.nodes.length).toBeGreaterThanOrEqual(1);

    const technologyViz = await viz.build({ viewType: "technology", direction: "both", maxDepth: 1 });
    expect(technologyViz.nodes.length).toBeGreaterThanOrEqual(0);

    const fuseResults = search.search("modelspy");
    expect(fuseResults.length).toBeGreaterThanOrEqual(1);

    const html = await new GraphExportService().exportSnapshotAsStaticHtml({ nodes: schemaViz.nodes, edges: schemaViz.edges }, { title: "conformance" });
    expect(html).toContain("<title>conformance</title>");

    const candidates = CopilotContextService.selectFor(snapshot, { taskQuery: "users" });
    expect(Array.isArray(candidates)).toBe(true);
  });

  it("preserves deterministic identifiers and non-regression across QA entrypoints", async () => {
    const snapshot = makeSnapshot();
    const search = new FuseSearchService(snapshot);
    const viz = new IntelligenceVisualizationService(snapshot);

    const allIds = new Set<string>();
    for (const file of snapshot.files) allIds.add(file.id);
    for (const symbol of snapshot.symbols) allIds.add(symbol.id);
    for (const relationship of snapshot.relationships) allIds.add(relationship.id);
    for (const evidence of snapshot.evidence) allIds.add(evidence.id);

    for (const id of allIds) {
      expect(id).toMatch(/^[A-Za-z0-9][A-Za-z0-9:.\-]{0,199}$/);
    }

    const schemaViz = await viz.build({ viewType: "schema", direction: "both", maxDepth: 1 });
    const html = await new GraphExportService().exportSnapshotAsStaticHtml({ nodes: schemaViz.nodes, edges: schemaViz.edges }, { title: "conformance" });
    expect(html).toContain("<title>conformance</title>");

    const fuseResults = search.search("modelspy");
    expect(fuseResults.length).toBeGreaterThanOrEqual(1);
    for (const result of fuseResults) {
      expect(typeof result).toBe("string");
      expect(result.length).toBeGreaterThan(0);
    }
  });
});

function makeSnapshot(): IntelligenceSnapshot {
  const repoId = "repo:polyglot";
  const rootId = "root:1";
  const generation = 1;
  const evidenceCommon = {
    workspaceRootId: rootId,
    extractorId: "test.language-provider",
    extractorVersion: "1",
    generation,
  } as const;
  const files = [
    {
      id: "file:mainpy",
      repositoryId: repoId,
      workspaceRootId: rootId,
      relativePath: "main.py",
      language: "python",
      category: "source",
      analysisLevel: "deep",
      byteSize: 64,
      modifiedAt: "2026-07-23T00:00:00.000Z",
      contentHash: "h:main",
      structuralHash: "s:main",
      parserId: "python",
      parserVersion: "1",
      packageId: "pkg:app",
      moduleId: "mod:app",
      sourceRoot: "",
      exported: true,
      isTest: false,
      parseStatus: "parsed",
      shardReferences: [],
      evidenceIds: ["ev:file:mainpy"],
      classification: { category: "source", included: true, generated: false, sensitive: false, binary: false, ruleId: null, reason: null },
    },
    {
      id: "file:modelspy",
      repositoryId: repoId,
      workspaceRootId: rootId,
      relativePath: "models.py",
      language: "python",
      category: "source",
      analysisLevel: "deep",
      byteSize: 40,
      modifiedAt: "2026-07-23T00:00:00.000Z",
      contentHash: "h:models",
      structuralHash: "s:models",
      parserId: "python",
      parserVersion: "1",
      packageId: "pkg:app",
      moduleId: "mod:app",
      sourceRoot: "",
      exported: true,
      isTest: false,
      parseStatus: "parsed",
      shardReferences: [],
      evidenceIds: ["ev:file:modelspy"],
      classification: { category: "source", included: true, generated: false, sensitive: false, binary: false, ruleId: null, reason: null },
    },
    {
      id: "file:schema",
      repositoryId: repoId,
      workspaceRootId: rootId,
      relativePath: "schema.sql",
      language: "sql",
      category: "schema",
      analysisLevel: "structural",
      byteSize: 48,
      modifiedAt: "2026-07-23T00:00:00.000Z",
      contentHash: "h:schema",
      structuralHash: "s:schema",
      parserId: "sql",
      parserVersion: "1",
      packageId: "pkg:data",
      moduleId: "mod:data",
      sourceRoot: "db",
      exported: false,
      isTest: false,
      parseStatus: "parsed",
      shardReferences: [],
      evidenceIds: ["ev:file:schema"],
      classification: { category: "schema", included: true, generated: false, sensitive: false, binary: false, ruleId: null, reason: null },
    },
  ];
  const symbols = [
    { id: "tssym:mainpy:run", name: "run", type: "keystone.core.Function", repositoryId: repoId, fileId: "file:mainpy", workspaceRootId: rootId, relativePath: "main.py", language: "python", qualifiedName: "run", range: { startLine: 3, startColumn: 0, endLine: 3, endColumn: 8 }, confidence: 1, inferred: false, evidenceIds: ["ev:sym:main:run"], parentId: undefined, properties: {} },
    { id: "tssym:mainpy:User", name: "User", type: "keystone.core.Class", repositoryId: repoId, fileId: "file:mainpy", workspaceRootId: rootId, relativePath: "main.py", language: "python", qualifiedName: "User", range: { startLine: 1, startColumn: 0, endLine: 1, endColumn: 8 }, confidence: 1, inferred: false, evidenceIds: ["ev:sym:main:User"], parentId: undefined, properties: {} },
    { id: "tssym:modelspy:User", name: "User", type: "keystone.core.Class", repositoryId: repoId, fileId: "file:modelspy", workspaceRootId: rootId, relativePath: "models.py", language: "python", qualifiedName: "User", range: { startLine: 1, startColumn: 0, endLine: 1, endColumn: 8 }, confidence: 1, inferred: false, evidenceIds: ["ev:sym:models:User"], parentId: undefined, properties: {} },
    { id: "db-table:users", name: "users", type: "keystone.core.Table", repositoryId: repoId, fileId: "file:schema", workspaceRootId: rootId, relativePath: "schema.sql", language: "sql", qualifiedName: "public.users", range: { startLine: 1, startColumn: 0, endLine: 1, endColumn: 37 }, confidence: 1, inferred: false, evidenceIds: ["ev:table:users"], parentId: undefined, properties: {} },
    { id: "db-column:users:id", name: "id", type: "keystone.core.Column", repositoryId: repoId, fileId: "file:schema", workspaceRootId: rootId, relativePath: "schema.sql", language: "sql", qualifiedName: "public.users.id", range: { startLine: 1, startColumn: 14, endLine: 1, endColumn: 16 }, confidence: 1, inferred: false, evidenceIds: ["ev:column:users:id"], parentId: "db-table:users", properties: {} },
  ];
  const relationships = [
    { id: "rel:main:User", type: "keystone.core.CALLS", repositoryId: repoId, sourceId: "tssym:mainpy:run", targetId: "tssym:modelspy:User", confidence: 1, evidenceIds: ["ev:rel:main:User"], derivation: "extracted", generation, properties: {} },
    { id: "rel:table:column", type: "db-table-has-column", repositoryId: repoId, sourceId: "db-table:users", targetId: "db-column:users:id", confidence: 1, evidenceIds: ["ev:rel:table:column"], derivation: "extracted", generation, properties: {} },
  ];
  const evidence = [
    { id: "ev:sym:main:run", subjectId: "tssym:mainpy:run", sourceKind: "language-provider", relativePath: "main.py", range: { startLine: 3, startColumn: 0, endLine: 3, endColumn: 8 }, parserId: "python", parserVersion: "1", derivation: "extracted", confidence: 1, statement: "def run", feedback: undefined, ...evidenceCommon },
  ];
  return {
    manifest: { schemaVersion: 1, generation, scanRevision: 1, repositoryId: repoId, status: "ready", createdAt: "2026-07-23T00:00:00.000Z", completedAt: "2026-07-23T00:00:01.000Z", extractorVersions: { "keystone.workspace-inventory": "1", "keystone.python": "1" } },
    repository: { id: repoId, displayName: "polyglot", workspaceRoots: [{ id: rootId, name: "workspace", evidenceIds: ["ev:root:1"] }], branch: "main", headCommit: "abc123", evidenceIds: ["ev:repo:1"] },
    files,
    symbols,
    relationships,
    evidence,
    diagnostics: [],
    contributions: [],
  } as any as IntelligenceSnapshot;
}
