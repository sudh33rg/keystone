import { describe, expect, it } from "vitest";
import { SemanticGraphBuilder } from "../../../../src/core/intelligence/semantic/SemanticGraphBuilder";
import type { IntelligenceSnapshot } from "../../../../src/shared/contracts/intelligence";

describe("SemanticGraphBuilder", () => {
  it("indexes JavaScript prototype-shaped names without corrupting the index", () => {
    const symbols = ["constructor", "__proto__", "toString"].map((name, index) => ({
      id: `entity:${index}`,
      repositoryId: "repository:fixture",
      fileId: "file:fixture",
      ownerFileId: "file:fixture",
      type: "keystone.core.Function",
      name,
      qualifiedName: name,
      language: "javascript",
      range: { startLine: index, startColumn: 0, endLine: index, endColumn: name.length },
      evidenceIds: [`evidence:${index}`],
      confidence: 1,
      generation: 1,
    }));
    const snapshot: Pick<IntelligenceSnapshot, "files" | "symbols" | "relationships"> = {
      files: [],
      symbols,
      relationships: [],
    };
    const indexes = new SemanticGraphBuilder().buildIndexes(snapshot);
    expect(indexes.byName.constructor).toEqual(["entity:0"]);
    expect(indexes.byName.__proto__).toEqual(["entity:1"]);
    expect(indexes.byName.tostring).toEqual(["entity:2"]);
  });
});
