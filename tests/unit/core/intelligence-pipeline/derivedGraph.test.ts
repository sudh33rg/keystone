import { describe, expect, it } from "../../../support/testkit";

import { analyzeRepositoryGraph } from "@core/intelligence/pipeline/derivedGraph";
import type { RepoIntelligence } from "@core/domain/types";

describe("analyzeRepositoryGraph", () => {
  it("detects hubs, cycles, orphans, and reverse transitive impact", () => {
    const intelligence: RepoIntelligence = {
      workspaceRoot: "/repo",
      indexedAt: "",
      ownershipHints: [],
      frameworkHints: [],
      securitySensitiveAreas: [],
      performanceSensitivePaths: [],
      modernizationCandidates: [],
      apis: [],
      services: [],
      symbols: [],
      files: [
        file("src/a.ts"),
        file("src/b.ts"),
        file("src/c.ts"),
        file("src/orphan.ts"),
        file("tests/a.test.ts", true)
      ],
      dependencies: [
        {
          from: "src/a.ts",
          to: "src/b.ts",
          kind: "local",
          evidence: {
            source: "regex",
            confidence: 0.78,
            evidencePath: "src/a.ts",
            extractorVersion: "test"
          }
        },
        { from: "src/b.ts", to: "src/c.ts", kind: "local" },
        { from: "src/c.ts", to: "src/b.ts", kind: "local" },
        { from: "tests/a.test.ts", to: "src/a.ts", kind: "local" }
      ],
      tests: [
        { testFile: "tests/a.test.ts", targetFile: "src/a.ts", confidence: 0.95, reason: "import" }
      ]
    };
    const graph = analyzeRepositoryGraph(intelligence);

    expect(graph.cycles).toEqual([["src/b.ts", "src/c.ts"]]);
    expect(graph.orphanSourceFiles).toEqual(["src/orphan.ts"]);
    expect(graph.hubs[0]).toEqual(expect.objectContaining({ path: "src/b.ts", degree: 3 }));
    expect(graph.communities).toEqual([
      expect.objectContaining({
        files: ["src/a.ts", "src/b.ts", "src/c.ts", "tests/a.test.ts"],
        internalEdges: 4
      })
    ]);
    expect(graph.localEdges[0].evidence).toEqual(
      expect.objectContaining({ source: "regex", evidencePath: "src/a.ts" })
    );
    expect(graph.communities[0].evidence).toContainEqual(
      expect.objectContaining({ source: "regex", evidencePath: "src/a.ts" })
    );
    expect(graph.impactedBy(["src/c.ts"])).toEqual({
      files: ["src/a.ts", "src/b.ts", "src/c.ts", "tests/a.test.ts"],
      tests: ["tests/a.test.ts"],
      depth: 4
    });
  });
});

function file(path: string, isTest = false) {
  return {
    path,
    language: "typescript",
    sizeBytes: 1,
    lineCount: 1,
    isTest,
    isGenerated: false,
    summary: ""
  };
}
