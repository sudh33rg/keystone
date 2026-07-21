import { describe, expect, it } from "vitest";
import { SemanticDeltaBuilder } from "../../../../src/core/intelligence/semantic/SemanticDeltaBuilder";
import type { SemanticProjectResult } from "../../../../src/core/intelligence/semantic/SemanticModel";
import { intelligenceSnapshot } from "../fixtures";

describe("SemanticDeltaBuilder", () => {
  it("updates changed and dependent files while retaining unrelated contributions", () => {
    const snapshot = intelligenceSnapshot();
    const original = snapshot.files[0]!;
    const unrelated = {
      ...original,
      id: "file:unrelated",
      relativePath: "src/unrelated.ts",
      contentHash: "sha256:unrelated",
      evidenceIds: ["evidence:unrelated"],
    };
    snapshot.files.push(unrelated);
    snapshot.evidence.push({
      ...snapshot.evidence.find((item) => item.subjectId === original.id)!,
      id: "evidence:unrelated",
      subjectId: unrelated.id,
      relativePath: unrelated.relativePath,
      contentHash: unrelated.contentHash,
    });
    snapshot.symbols.push(
      entity("entity:old", original.id, 1),
      entity("entity:unrelated", unrelated.id, 1),
    );
    snapshot.contributions = [
      contribution(original.id, original.contentHash!, ["entity:old"], 1),
      contribution(unrelated.id, unrelated.contentHash, ["entity:unrelated"], 1),
    ];
    const result: SemanticProjectResult = {
      repositoryId: snapshot.repository.id,
      generation: 2,
      jobRevision: 2,
      parserId: "keystone.typescript",
      parserVersion: "1",
      sourceHashes: { [original.id]: "sha256:changed", [unrelated.id]: unrelated.contentHash },
      fileUpdates: [],
      entities: [entity("entity:new", original.id, 2), entity("entity:unrelated", unrelated.id, 2)],
      relationships: [],
      evidence: [],
      diagnostics: [],
      contributions: [
        contribution(original.id, "sha256:changed", ["entity:new"], 2),
        contribution(unrelated.id, unrelated.contentHash, ["entity:unrelated"], 2),
      ],
    };
    const merged = new SemanticDeltaBuilder().merge(snapshot, result);
    expect(merged.symbols.some((item) => item.id === "entity:old")).toBe(false);
    expect(merged.symbols.find((item) => item.id === "entity:new")?.generation).toBe(2);
    expect(merged.symbols.find((item) => item.id === "entity:unrelated")?.generation).toBe(1);
    expect(merged.contributions?.find((item) => item.fileId === unrelated.id)?.generation).toBe(1);
  });

  it("never publishes relationships with missing endpoints after an incremental merge", () => {
    const snapshot = intelligenceSnapshot();
    const original = snapshot.files[0]!;
    snapshot.symbols.push(entity("entity:old", original.id, 1));
    snapshot.relationships.push({
      id: "relationship:stale",
      repositoryId: snapshot.repository.id,
      sourceId: "entity:old",
      targetId: "entity:missing",
      type: "keystone.core.CALLS",
      ownerFileId: original.id,
      resolution: "compiler",
      evidenceIds: [],
      derivation: "resolved",
      confidence: 1,
      generation: 1,
    });
    snapshot.contributions = [contribution(original.id, original.contentHash!, ["entity:old"], 1)];
    const result: SemanticProjectResult = {
      repositoryId: snapshot.repository.id,
      generation: 2,
      jobRevision: 2,
      parserId: "keystone.typescript",
      parserVersion: "1",
      sourceHashes: { [original.id]: "sha256:changed" },
      fileUpdates: [],
      entities: [entity("entity:new", original.id, 2)],
      relationships: [
        {
          id: "relationship:new-stale",
          repositoryId: snapshot.repository.id,
          sourceId: "entity:new",
          targetId: "entity:missing",
          type: "keystone.core.CALLS",
          ownerFileId: original.id,
          resolution: "compiler",
          evidenceIds: [],
          derivation: "resolved",
          confidence: 1,
          generation: 2,
        },
      ],
      evidence: [],
      diagnostics: [],
      contributions: [contribution(original.id, "sha256:changed", ["entity:new"], 2)],
    };

    const merged = new SemanticDeltaBuilder().merge(snapshot, result);

    expect(merged.relationships.some((item) => item.id === "relationship:new-stale")).toBe(false);
    expect(merged.diagnostics).toContainEqual(
      expect.objectContaining({ code: "semantic-dangling-relationship", severity: "warning" }),
    );
  });
});

function entity(id: string, fileId: string, generation: number) {
  return {
    id,
    repositoryId: "repository:fixture",
    fileId,
    ownerFileId: fileId,
    type: "keystone.core.Function",
    name: id,
    qualifiedName: id,
    language: "typescript",
    range: { startLine: 0, startColumn: 0, endLine: 0, endColumn: 1 },
    evidenceIds: [`evidence:${id}`],
    confidence: 1,
    generation,
  };
}
function contribution(
  fileId: string,
  sourceHash: string,
  entityIds: string[],
  generation: number,
  parserVersion = "1",
) {
  return {
    fileId,
    sourceHash,
    parserId: "keystone.typescript",
    parserVersion,
    entityIds,
    relationshipIds: [],
    evidenceIds: [],
    diagnosticIds: [],
    dependencyFileIds: [],
    generation,
  };
}
