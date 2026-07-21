import { mkdtemp, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { IntelligenceStore } from "../../../src/core/persistence/IntelligenceStore";
import { SemanticGraphBuilder } from "../../../src/core/intelligence/semantic/SemanticGraphBuilder";
import { intelligenceSnapshot } from "./fixtures";
import type { AdapterRegistryState } from "../../../src/shared/contracts/adapters";

describe("semantic persistence", () => {
  const directories: string[] = [];
  afterEach(async () =>
    Promise.all(directories.splice(0).map((path) => rm(path, { recursive: true, force: true }))),
  );

  it("reloads semantic contributions and graph indexes", async () => {
    const root = await mkdtemp(join(tmpdir(), "keystone-semantic-store-"));
    directories.push(root);
    const snapshot = intelligenceSnapshot();
    const file = snapshot.files[0]!;
    const containment = snapshot.relationships[0]!;
    const containmentEvidence = snapshot.evidence.find(
      (item) => item.subjectId === containment.id,
    )!;
    snapshot.contributions = [
      {
        fileId: file.id,
        sourceHash: file.contentHash,
        parserId: "keystone.typescript",
        parserVersion: "1",
        entityIds: [],
        relationshipIds: [containment.id],
        evidenceIds: [containmentEvidence.id],
        diagnosticIds: [],
        dependencyFileIds: [],
        generation: 1,
      },
    ];
    snapshot.indexes = new SemanticGraphBuilder().buildIndexes(snapshot);
    const store = new IntelligenceStore(root);
    await store.initialize();
    await store.save(snapshot);
    const key = file.id.replace(/[^a-zA-Z0-9_-]/g, "_");
    const firstPartition = join(
      root,
      "intelligence",
      "generations",
      "000001",
      "entities",
      `${key}.json.gz`,
    );
    expect((await stat(firstPartition)).size).toBeGreaterThan(0);
    const second = structuredClone(snapshot);
    second.manifest = { ...second.manifest, generation: 2, scanRevision: 2 };
    await store.save(second);
    const secondPartition = join(
      root,
      "intelligence",
      "generations",
      "000002",
      "entities",
      `${key}.json.gz`,
    );
    expect((await stat(secondPartition)).ino).toBe((await stat(firstPartition)).ino);
    const changed = structuredClone(second);
    changed.manifest = { ...changed.manifest, generation: 3, scanRevision: 3 };
    const changedRelationship = {
      ...containment,
      id: "relationship:changed",
      evidenceIds: ["evidence:changed"],
      generation: 3,
    };
    const changedEvidence = {
      ...containmentEvidence,
      id: "evidence:changed",
      subjectId: changedRelationship.id,
      generation: 3,
    };
    changed.relationships.push(changedRelationship);
    changed.evidence.push(changedEvidence);
    changed.contributions![0] = {
      ...changed.contributions![0]!,
      relationshipIds: [containment.id, changedRelationship.id],
      evidenceIds: [containmentEvidence.id, changedEvidence.id],
      generation: 3,
    };
    await store.save(changed);
    const secondRelationships = join(
      root,
      "intelligence",
      "generations",
      "000002",
      "relationships",
      `${key}.json.gz`,
    );
    const changedRelationships = join(
      root,
      "intelligence",
      "generations",
      "000003",
      "relationships",
      `${key}.json.gz`,
    );
    expect((await stat(changedRelationships)).ino).not.toBe((await stat(secondRelationships)).ino);
    store.dispose();
    const reloaded = new IntelligenceStore(root);
    await reloaded.initialize();
    expect(reloaded.getSnapshot()?.contributions).toEqual(changed.contributions);
    expect(reloaded.getSnapshot()?.indexes).toEqual(changed.indexes);
    const partition = await reloaded.readContributionPartition(file.id);
    expect(partition?.relationships.map((item) => item.id)).toEqual([
      containment.id,
      changedRelationship.id,
    ]);
    expect(partition?.evidence.map((item) => item.id)).toEqual([
      containmentEvidence.id,
      changedEvidence.id,
    ]);
    expect((await reloaded.checkHealth()).status).toBe("healthy");
    reloaded.dispose();
  });

  it("persists adapter registry, detection, coverage, and execution metrics in the immutable generation", async () => {
    const root = await mkdtemp(join(tmpdir(), "keystone-adapter-store-"));
    directories.push(root);
    const snapshot = intelligenceSnapshot();
    const adapterState: AdapterRegistryState = {
      schemaVersion: 1,
      generation: 1,
      updatedAt: snapshot.manifest.completedAt,
      capabilities: [
        {
          adapterId: "keystone.adapter.documentation",
          version: "1.0.0",
          family: "documentation",
          technologies: ["markdown"],
          filePatterns: ["*.md"],
          manifestIndicators: [],
          dependencyIndicators: [],
          syntaxIndicators: ["heading"],
          tier: "tier-1",
          level: "structural",
          entityTypes: ["keystone.core.Document"],
          relationshipTypes: ["keystone.core.CONTAINS"],
          outputKind: "structural",
          incremental: true,
          threadSafe: true,
          maxInputBytes: 1048576,
          limitations: [],
        },
      ],
      detections: [
        {
          technologyId: "markdown",
          confidence: 1,
          adapterId: "keystone.adapter.documentation",
          capabilityLevel: "structural",
          evidence: [
            {
              kind: "extension",
              relativePath: "README.md",
              statement: "Markdown extension matched.",
            },
          ],
          conflicts: [],
          unsupportedFeatures: [],
          fileIds: [snapshot.files[0]!.id],
        },
      ],
      coverage: [
        {
          technologyId: "markdown",
          adapterId: "keystone.adapter.documentation",
          adapterVersion: "1.0.0",
          capabilityLevel: "structural",
          filesDiscovered: 1,
          filesParsed: 1,
          filesFailed: 0,
          filesMetadataOnly: 0,
          entitiesExtracted: 2,
          relationshipsResolved: 1,
          unresolvedReferences: 0,
          unsupportedConstructs: 0,
          lastSuccessfulUpdate: snapshot.manifest.completedAt,
          freshness: "current",
        },
      ],
      metrics: [
        {
          adapterId: "keystone.adapter.documentation",
          executionTimeMs: 1,
          filesConsidered: 1,
          filesParsed: 1,
          filesFailed: 0,
          cacheReused: 0,
          entitiesExtracted: 2,
          relationshipsResolved: 1,
          crossLinksResolved: 0,
          unsupportedFiles: 0,
          memoryWarning: false,
        },
      ],
    };
    const store = new IntelligenceStore(root);
    await store.save(snapshot, undefined, undefined, adapterState);
    store.dispose();
    const restored = new IntelligenceStore(root);
    await restored.initialize();
    expect(restored.getAdapterState()).toEqual(adapterState);
    expect(
      (await stat(join(root, "intelligence", "generations", "000001", "adapters.json.gz"))).size,
    ).toBeGreaterThan(0);
    restored.dispose();
  });
});
