import { describe, expect, it } from "vitest";
import { SemanticGraphBuilder } from "../../../../src/core/intelligence/semantic/SemanticGraphBuilder";
import { CompleteQueryEngine, QueryContext } from "../../../../src/core/intelligence/query/QueryEngine";
import { OkfQueryService } from "../../../../src/core/intelligence/query/OkfQueryService";
import type { CpgQueryService } from "../../../../src/core/intelligence/cpg/CpgQueryService";
import type { IntelligenceSnapshotReader } from "../../../../src/core/persistence/IntelligenceStore";
import type {
  IntelligenceEvidenceRecord,
  IntelligenceFileRecord,
  IntelligenceSnapshot,
} from "../../../../src/shared/contracts/intelligence";
import {
  IntelligenceQuerySchema,
  type IntelligenceQuery,
} from "../../../../src/shared/contracts/query";
import { intelligenceSnapshot } from "../fixtures";

describe("OKF concept enrichment", () => {
  it("returns an enriched concept for an exactly resolved entity", async () => {
    const { engine } = fixture();
    const result = await engine.query(query("OKF_CONCEPT", "OrderService.create"));
    expect(result.data.kind).toBe("okf-concepts");
    expect(result.data.items).toHaveLength(1);
    const concept = result.data.items[0]!.okfConcept;
    expect(concept).toBeDefined();
    expect(concept!.calls.map((ref) => ref.name)).toContain("save");
    expect(concept!.calledBy.map((ref) => ref.name)).toContain("createOrderHandler");
    expect(concept!.evidenceIds).toContain("evidence:entity:service");
    expect(concept!.description).toContain("entity:service is evidenced by");
  });

  it("lists declared methods with line numbers on a class concept", async () => {
    const { engine } = fixture();
    const result = await engine.query(query("OKF_CONCEPT", "OrderService"));
    const concept = result.data.items[0]?.okfConcept;
    expect(concept).toBeDefined();
    const methodNames = concept!.methods.map((method) => method.name).sort();
    expect(methodNames).toEqual(["cancel", "create"]);
    for (const method of concept!.methods) {
      expect(method.line).toBeGreaterThanOrEqual(0);
      expect(method.id).toMatch(/^entity:/);
    }
  });

  it("lists file-level imports for a symbol concept", async () => {
    const { engine } = fixture();
    const result = await engine.query(query("OKF_CONCEPT", "OrderService.create"));
    const concept = result.data.items[0]?.okfConcept;
    expect(concept).toBeDefined();
    expect(concept!.imports.map((ref) => ref.id)).toContain("file:repo");
  });

  it("returns empty arrays rather than undefined for an isolated entity", async () => {
    const { engine } = fixture();
    const result = await engine.query(query("OKF_CONCEPT", "PAYMENT_TIMEOUT"));
    const concept = result.data.items[0]?.okfConcept;
    expect(concept).toBeDefined();
    expect(concept!.methods).toEqual([]);
    expect(concept!.calls).toEqual([]);
    expect(concept!.calledBy).toEqual([]);
  });

  it("falls back to ranked value search when no exact id resolves", async () => {
    const { snapshot, store } = fixture();
    const service = new OkfQueryService(store);
    const compiled = IntelligenceQuerySchema.parse(queryNoSeed("OKF_CONCEPT"));
    const context = new QueryContext(compiled, snapshot);
    const results = await service.query(context, { value: "OrderService" });
    expect(results.length).toBeGreaterThan(0);
    for (let index = 1; index < results.length; index += 1) {
      expect(results[index - 1]!.score).toBeGreaterThanOrEqual(results[index]!.score);
    }
    expect(results.every((item) => item.okfConcept !== undefined)).toBe(true);
  });

  it("returns no items for an unknown seed", async () => {
    const { engine } = fixture();
    const result = await engine.query(query("OKF_CONCEPT", "NoSuchConceptAnywhere"));
    expect(result.data.items).toEqual([]);
  });
});

function fixture() {
  const snapshot = okfSnapshot();
  const store: IntelligenceSnapshotReader = {
    getSnapshot: () => snapshot,
    isStorageAvailable: () => true,
    getLoadError: () => undefined,
    getRetainedSnapshots: () => Promise.resolve([snapshot]),
  };
  const cpg = {
    scope: () => Promise.resolve(undefined),
    controlFlow: () => Promise.resolve(undefined),
    dataFlow: () => Promise.resolve(undefined),
    slice: () => Promise.resolve(undefined),
    conditionsForNode: () => Promise.resolve(undefined),
  } as unknown as CpgQueryService;
  return { snapshot, store, engine: new CompleteQueryEngine(store, cpg) };
}

function okfSnapshot(): IntelligenceSnapshot {
  const snapshot = intelligenceSnapshot(2);
  for (const [id, path, language, category] of [
    ["file:route", "api/routes.ts", "typescript", "source"],
    ["file:service", "api/OrderService.ts", "typescript", "source"],
    ["file:repo", "data/OrderRepository.ts", "typescript", "source"],
    ["file:config", "config/app.yaml", "yaml", "configuration"],
  ] as const)
    addFile(snapshot, id, path, language, category);
  addEntity(
    snapshot,
    "entity:handler",
    "keystone.core.Function",
    "createOrderHandler",
    "createOrderHandler",
    "file:route",
    { exported: true },
  );
  addEntity(
    snapshot,
    "entity:orderservice",
    "keystone.core.Class",
    "OrderService",
    "OrderService",
    "file:service",
    { exported: true },
  );
  addEntity(
    snapshot,
    "entity:service",
    "keystone.core.Method",
    "create",
    "OrderService.create",
    "file:service",
    { exported: true },
  );
  addEntity(
    snapshot,
    "entity:cancel",
    "keystone.core.Method",
    "cancel",
    "OrderService.cancel",
    "file:service",
    { exported: true },
  );
  addEntity(
    snapshot,
    "entity:repository",
    "keystone.core.Method",
    "save",
    "OrderRepository.save",
    "file:repo",
    { exported: true },
  );
  addEntity(
    snapshot,
    "entity:config",
    "keystone.core.ConfigurationKey",
    "PAYMENT_TIMEOUT",
    "PAYMENT_TIMEOUT",
    "file:config",
    { keyPath: "PAYMENT_TIMEOUT" },
  );
  for (const [source, target, type] of [
    ["entity:handler", "entity:service", "keystone.core.CALLS"],
    ["entity:service", "entity:repository", "keystone.core.CALLS"],
    ["entity:orderservice", "entity:service", "keystone.core.DECLARES"],
    ["entity:orderservice", "entity:cancel", "keystone.core.DECLARES"],
  ] as const)
    addRelation(snapshot, source, target, type);
  addFileRelation(snapshot, "file:service", "file:repo", "keystone.core.IMPORTS");
  snapshot.indexes = new SemanticGraphBuilder().buildIndexes(snapshot);
  return snapshot;
}

function addFile(
  snapshot: IntelligenceSnapshot,
  id: string,
  relativePath: string,
  language: string,
  category: IntelligenceFileRecord["category"],
): void {
  const evidenceId = `evidence:${id}`;
  snapshot.files.push({
    ...snapshot.files[0]!,
    id,
    relativePath,
    language,
    category,
    contentHash: `hash:${id}`,
    evidenceIds: [evidenceId],
    generation: snapshot.manifest.generation,
  });
  snapshot.evidence.push(evidence(evidenceId, id, relativePath, snapshot.manifest.generation));
}

function addEntity(
  snapshot: IntelligenceSnapshot,
  id: string,
  type: string,
  name: string,
  qualifiedName: string,
  fileId: string,
  properties: Record<string, string | number | boolean | string[]>,
): void {
  const file = snapshot.files.find((item) => item.id === fileId)!;
  const evidenceId = `evidence:${id}`;
  snapshot.symbols.push({
    id,
    repositoryId: snapshot.repository.id,
    fileId,
    ownerFileId: fileId,
    type,
    name,
    qualifiedName,
    language: file.language,
    range: { startLine: 0, startColumn: 0, endLine: 1, endColumn: 0 },
    properties,
    exported: properties.exported === true,
    visibility: properties.exported === true ? "public" : undefined,
    evidenceIds: [evidenceId],
    confidence: 1,
    generation: snapshot.manifest.generation,
  });
  snapshot.evidence.push(
    evidence(evidenceId, id, file.relativePath, snapshot.manifest.generation),
  );
}

function addRelation(
  snapshot: IntelligenceSnapshot,
  sourceId: string,
  targetId: string,
  type: string,
): void {
  const source = snapshot.symbols.find((item) => item.id === sourceId)!;
  const target = snapshot.symbols.find((item) => item.id === targetId)!;
  pushRelation(snapshot, sourceId, targetId, type, source.fileId, target.fileId);
}

function addFileRelation(
  snapshot: IntelligenceSnapshot,
  sourceId: string,
  targetId: string,
  type: string,
): void {
  pushRelation(snapshot, sourceId, targetId, type, sourceId, targetId);
}

function pushRelation(
  snapshot: IntelligenceSnapshot,
  sourceId: string,
  targetId: string,
  type: string,
  ownerFileId: string,
  targetFileId: string,
): void {
  const id = `relationship:${sourceId}:${type}:${targetId}`;
  const evidenceId = `evidence:${id}`;
  const file = snapshot.files.find((item) => item.id === ownerFileId)!;
  snapshot.relationships.push({
    id,
    repositoryId: snapshot.repository.id,
    sourceId,
    targetId,
    type,
    ownerFileId,
    targetFileId,
    resolution: "exact",
    evidenceIds: [evidenceId],
    derivation: "resolved",
    confidence: 1,
    generation: snapshot.manifest.generation,
  });
  snapshot.evidence.push(
    evidence(evidenceId, id, file.relativePath, snapshot.manifest.generation),
  );
}

function evidence(
  id: string,
  subjectId: string,
  relativePath: string,
  generation: number,
): IntelligenceEvidenceRecord {
  return {
    id,
    subjectId,
    sourceKind: "typescript-compiler",
    workspaceRootId: "workspace-root:fixture",
    relativePath,
    extractorId: "keystone.typescript",
    extractorVersion: "1",
    derivation: "extracted",
    generation,
    confidence: 1,
    statement: `${subjectId} is evidenced by ${relativePath}.`,
  };
}

function limits() {
  return {
    results: 25,
    nodes: 100,
    edges: 300,
    paths: 5,
    depth: 8,
    evidence: 30,
    timeBudgetMs: 1000,
  };
}

function query(operation: IntelligenceQuery["operation"], value: string): IntelligenceQuery {
  return { operation, seeds: [{ value, kind: "name" }], limits: limits() };
}

function queryNoSeed(operation: IntelligenceQuery["operation"]): IntelligenceQuery {
  return { operation, filters: { confidenceAtLeast: 0 }, limits: limits() };
}
