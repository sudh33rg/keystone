import { describe, expect, it } from "vitest";
import { IntelligenceQueryService } from "../../../src/core/intelligence/IntelligenceQueryService";
import type { IntelligenceSnapshot } from "../../../src/shared/contracts/intelligence";
import { intelligenceSnapshot } from "./fixtures";

describe("semantic IntelligenceQueryService", () => {
  it("returns real semantic overview counts and paginated search", async () => {
    const query = service(semanticSnapshot());
    const overview = await query.overview();
    expect(overview.counts).toMatchObject({ packages: 1, tests: 1, routes: 1, externalDependencies: 1, parseFailures: 1, unresolvedReferences: 1 });
    expect(overview.relationshipTypes.some((item) => item.key === "keystone.core.CALLS")).toBe(true);

    const first = await query.search({ query: "", limit: 2 });
    expect(first.items).toHaveLength(2);
    expect(first.total).toBe(7);
    expect(first.nextCursor).toBe("2");
    const second = await query.search({ query: "", limit: 2, cursor: first.nextCursor });
    expect(second.items).toHaveLength(2);
    expect(new Set([...first.items, ...second.items].map((item) => item.id)).size).toBe(4);
    expect((await query.search({ query: "/users", entityTypes: ["keystone.core.Route"], limit: 10 })).items[0]?.name).toBe("/users");
    expect((await query.search({ query: "target", packageIds: ["entity:package-membership"], moduleIds: ["entity:module"], limit: 10 })).items).toHaveLength(2);
    expect((await query.search({ query: "target", packageIds: ["entity:other"], limit: 10 })).items).toHaveLength(0);
  });

  it("returns bounded entity evidence and neighborhoods", async () => {
    const query = service(semanticSnapshot());
    const details = await query.entity("entity:caller");
    expect(details).toMatchObject({ entity: { qualifiedName: "caller" }, outgoing: [{ type: "keystone.core.CALLS", entityName: "target" }] });
    expect(details?.evidence[0]?.subjectId).toBe("entity:caller");
    const neighborhood = await query.neighborhood({ ids: ["entity:caller"], direction: "outgoing", maxDepth: 2, maxNodes: 2, minimumConfidence: 0 });
    expect(neighborhood.nodes).toHaveLength(2);
    expect(neighborhood.relationships).toHaveLength(1);
    expect(neighborhood.truncated).toBe(false);
  });
});

function service(snapshot: IntelligenceSnapshot): IntelligenceQueryService {
  return new IntelligenceQueryService(
    { isStorageAvailable: () => true, getSnapshot: () => snapshot, getLoadError: () => undefined },
    { getState: () => ({ status: "ready", phase: "ready", pendingUpdate: false, scanRevision: 1, queueDepth: 0, activeWorkers: 0, workerCapacity: 3, pendingFiles: 0, completedJobs: 1, failedJobs: 0, staleResultsDiscarded: 0, workerRestarts: 0, throughputFilesPerSecond: 0, currentFiles: [], health: "healthy" }) }
  );
}

function semanticSnapshot(): IntelligenceSnapshot {
  const snapshot = intelligenceSnapshot();
  const file = snapshot.files[0]!;
  file.packageId = "entity:package-membership";
  file.moduleId = "entity:module";
  const entities = [
    entity("entity:caller", "keystone.core.Function", "caller", file.id, "evidence:caller"),
    entity("entity:target", "keystone.core.Function", "target", file.id, "evidence:target"),
    entity("entity:package", "keystone.core.Package", "fixture", file.id, "evidence:package"),
    entity("entity:route", "keystone.core.Route", "/users", file.id, "evidence:route"),
    entity("entity:test", "keystone.core.TestCase", "calls target", file.id, "evidence:test")
  ];
  snapshot.symbols.push(...entities);
  snapshot.symbols.push(entity("entity:dependency", "keystone.core.ExternalDependency", "express", file.id, "evidence:dependency"));
  snapshot.symbols.pop();
  for (const item of entities) snapshot.evidence.push({ id: item.evidenceIds[0]!, subjectId: item.id, ownerFileId: file.id, sourceKind: "typescript-compiler", workspaceRootId: file.workspaceRootId, relativePath: file.relativePath, range: item.range, extractorId: "keystone.typescript", extractorVersion: "1", derivation: "extracted", contentHash: file.contentHash, generation: 1, confidence: 1, statement: `Extracted ${item.name}.` });
  const dependency = entity("entity:dependency", "keystone.core.ExternalDependency", "express", file.id, "evidence:dependency");
  snapshot.symbols.push(dependency);
  snapshot.evidence.push({ id: "evidence:dependency", subjectId: dependency.id, ownerFileId: file.id, sourceKind: "manifest", workspaceRootId: file.workspaceRootId, relativePath: file.relativePath, extractorId: "keystone.typescript", extractorVersion: "1", derivation: "extracted", contentHash: file.contentHash, generation: 1, confidence: 1, statement: "Dependency declared." });
  snapshot.relationships.push({ id: "relationship:calls", repositoryId: snapshot.repository.id, sourceId: "entity:caller", targetId: "entity:target", type: "keystone.core.CALLS", ownerFileId: file.id, targetFileId: file.id, resolution: "compiler", evidenceIds: ["evidence:calls"], derivation: "resolved", confidence: 1, generation: 1 });
  snapshot.evidence.push({ id: "evidence:calls", subjectId: "relationship:calls", ownerFileId: file.id, sourceKind: "typescript-compiler", workspaceRootId: file.workspaceRootId, relativePath: file.relativePath, extractorId: "keystone.typescript", extractorVersion: "1", derivation: "resolved", contentHash: file.contentHash, generation: 1, confidence: 1, statement: "Resolved call." });
  snapshot.diagnostics.push({ id: "diagnostic:parse", code: "parse-failure", severity: "error", message: "Fixture parse failure.", ownerFileId: file.id, relativePath: file.relativePath }, { id: "diagnostic:unresolved", code: "unresolved-call", severity: "warning", message: "Fixture unresolved call.", ownerFileId: file.id, relativePath: file.relativePath });
  return snapshot;
}

function entity(id: string, type: string, name: string, fileId: string, evidenceId: string) {
  return { id, repositoryId: "repository:fixture", fileId, ownerFileId: fileId, type, name, qualifiedName: name, language: "typescript", range: { startLine: 0, startColumn: 0, endLine: 0, endColumn: 1 }, evidenceIds: [evidenceId], confidence: 1, generation: 1 };
}
