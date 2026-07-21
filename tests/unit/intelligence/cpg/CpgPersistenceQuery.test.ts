import { mkdtemp, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { CpgQueryService } from "../../../../src/core/intelligence/cpg/CpgQueryService";
import { TypeScriptJavaScriptParser } from "../../../../src/core/intelligence/semantic/TypeScriptJavaScriptParser";
import { IntelligenceStore } from "../../../../src/core/persistence/IntelligenceStore";
import type { IntelligenceSnapshot } from "../../../../src/shared/contracts/intelligence";
import type {
  SemanticProjectResult,
  SemanticSourceFileInput,
} from "../../../../src/core/intelligence/semantic/SemanticModel";

describe("CPG immutable persistence and bounded queries", () => {
  const directories: string[] = [];
  afterEach(async () =>
    Promise.all(directories.splice(0).map((path) => rm(path, { recursive: true, force: true }))),
  );

  it("persists, reloads, reuses, queries, and removes scope shards atomically", async () => {
    const root = await mkdtemp(join(tmpdir(), "keystone-cpg-store-"));
    directories.push(root);
    const parser = new TypeScriptJavaScriptParser();
    const input = file();
    const first = await parser.extract({
      repositoryId: "repository:cpg",
      projectKey: "cpg-store",
      generation: 1,
      jobRevision: 1,
      reset: true,
      changedFiles: [input],
      removedPaths: [],
    });
    const store = new IntelligenceStore(root);
    await store.initialize();
    await store.save(snapshot(first, input, 1), undefined, first.cpg);
    const scope = first.cpg!.scopes.find((item) => item.descriptor.name.endsWith("calculate"))!;
    const firstShard = join(root, "intelligence", "generations", "000001", scope.descriptor.shard);
    expect((await stat(firstShard)).size).toBeGreaterThan(0);
    expect(store.getCpgManifest()?.semanticGeneration).toBe(1);
    expect((await store.readCpgScope(scope.descriptor.id))?.nodes.length).toBeGreaterThan(0);

    const second = await parser.extract({
      repositoryId: "repository:cpg",
      projectKey: "cpg-store",
      generation: 2,
      jobRevision: 2,
      reset: false,
      changedFiles: [],
      removedPaths: [],
    });
    expect(second.cpg?.scopes.every((item) => item.reused)).toBe(true);
    await store.save(snapshot(second, input, 2), undefined, second.cpg);
    const secondShard = join(root, "intelligence", "generations", "000002", scope.descriptor.shard);
    expect((await stat(secondShard)).ino).toBe((await stat(firstShard)).ino);

    const symbolId = second.entities.find((item) => item.name === "calculate")!.id;
    const query = new CpgQueryService(store);
    const bounded = await query.scope({
      semanticSymbolId: symbolId,
      overlays: ["ast", "control-flow", "data-flow", "calls"],
      maxNodes: 5,
      includeSource: true,
    });
    expect(bounded?.nodes.length).toBeLessThanOrEqual(5);
    expect(bounded?.truncated).toBe(true);
    const full = await query.controlFlow(symbolId, 200);
    expect(full?.edges.some((edge) => edge.type.startsWith("CFG_"))).toBe(true);
    const selected = (await store.readCpgScope(scope.descriptor.id))!.nodes.find(
      (node) => node.properties?.read === true,
    )!;
    const slice = await query.slice({
      semanticSymbolId: symbolId,
      nodeId: selected.id,
      direction: "backward",
      includeConditions: true,
      maxNodes: 30,
      maxDepth: 6,
      maxPaths: 5,
      timeBudgetMs: 500,
    });
    expect(slice?.generation).toBe(2);
    expect(
      (
        await query.slice({
          semanticSymbolId: symbolId,
          nodeId: selected.id,
          direction: "backward",
          includeConditions: true,
          maxNodes: 30,
          maxDepth: 6,
          maxPaths: 5,
          timeBudgetMs: 500,
        })
      )?.nodes,
    ).toEqual(slice?.nodes);
    expect(query.metrics().sliceCacheHits).toBe(1);

    const failed = await parser.extract({
      repositoryId: "repository:cpg",
      projectKey: "cpg-store",
      generation: 3,
      jobRevision: 3,
      reset: false,
      changedFiles: [],
      removedPaths: [],
    });
    await expect(
      store.save(
        snapshot(failed, input, 3),
        () => {
          throw new Error("stop promotion");
        },
        failed.cpg,
      ),
    ).rejects.toThrow();
    expect(store.getSnapshot()?.manifest.generation).toBe(2);
    expect(store.getCpgManifest()?.semanticGeneration).toBe(2);

    store.dispose();
    const reloaded = new IntelligenceStore(root);
    await reloaded.initialize();
    expect(reloaded.getCpgManifest()?.scopes.some((item) => item.id === scope.descriptor.id)).toBe(
      true,
    );
    expect((await reloaded.readCpgScope(scope.descriptor.id))?.descriptor.generation).toBe(2);
    reloaded.dispose();
  });
});

function file(): SemanticSourceFileInput {
  const content = `export function calculate(input: number): number { let value = input; if (value > 0) value = value + 1; return value; }`;
  return {
    uri: "file:///fixture/src/cpg.ts",
    relativePath: "src/cpg.ts",
    workspaceRootId: "root:cpg",
    fileId: "file:src/cpg.ts",
    language: "typescript",
    category: "source",
    contentHash: "sha256:cpg",
    content,
  };
}
function snapshot(
  result: SemanticProjectResult,
  input: SemanticSourceFileInput,
  generation: number,
): IntelligenceSnapshot {
  const repositoryEvidence = `evidence:repository:${generation}`;
  const rootEvidence = `evidence:root:${generation}`;
  const fileEvidence = `evidence:file:${generation}`;
  const contains = `relationship:contains:${generation}`;
  const containsEvidence = `evidence:contains:${generation}`;
  return {
    manifest: {
      schemaVersion: 1,
      generation,
      scanRevision: generation,
      repositoryId: "repository:cpg",
      status: result.diagnostics.some((item) => item.severity !== "info") ? "partial" : "ready",
      createdAt: "2026-07-15T00:00:00.000Z",
      completedAt: "2026-07-15T00:00:01.000Z",
      extractorVersions: { [result.parserId]: result.parserVersion },
    },
    repository: {
      id: "repository:cpg",
      displayName: "cpg",
      workspaceRoots: [{ id: "root:cpg", name: "cpg", evidenceIds: [rootEvidence] }],
      evidenceIds: [repositoryEvidence],
    },
    files: [
      {
        id: input.fileId,
        repositoryId: "repository:cpg",
        workspaceRootId: input.workspaceRootId,
        relativePath: input.relativePath,
        language: input.language,
        category: "source",
        analysisLevel: "deep",
        byteSize: input.content.length,
        modifiedAt: "2026-07-15T00:00:00.000Z",
        contentHash: input.contentHash,
        structuralHash: result.fileUpdates[0]?.structuralHash,
        parserId: result.parserId,
        parserVersion: result.parserVersion,
        parseStatus: "parsed",
        classification: {
          category: "source",
          analysisLevel: "deep",
          included: true,
          generated: false,
          binary: false,
          sensitive: false,
          ruleId: "include.source",
          reason: "fixture",
        },
        evidenceIds: [fileEvidence],
        generation,
      },
    ],
    symbols: result.entities,
    relationships: [
      {
        id: contains,
        repositoryId: "repository:cpg",
        sourceId: "repository:cpg",
        targetId: input.fileId,
        type: "keystone.core.CONTAINS",
        ownerFileId: input.fileId,
        targetFileId: input.fileId,
        resolution: "exact",
        evidenceIds: [containsEvidence],
        derivation: "extracted",
        confidence: 1,
        generation,
      },
      ...result.relationships,
    ],
    evidence: [
      evidence(repositoryEvidence, "repository:cpg", generation),
      evidence(rootEvidence, "root:cpg", generation),
      evidence(fileEvidence, input.fileId, generation),
      evidence(containsEvidence, contains, generation),
      ...result.evidence,
    ],
    diagnostics: result.diagnostics,
    contributions: result.contributions,
  };
}
function evidence(id: string, subjectId: string, generation: number) {
  return {
    id,
    subjectId,
    sourceKind: "workspace-inventory" as const,
    workspaceRootId: "root:cpg",
    relativePath: "src/cpg.ts",
    extractorId: "fixture",
    extractorVersion: "1",
    derivation: "extracted" as const,
    generation,
    confidence: 1,
    statement: "Fixture evidence.",
  };
}
