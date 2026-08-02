import { describe, expect, it } from "../../../support/testkit";
import { analyzeRepositoryGraph } from "@core/intelligence/pipeline/derivedGraph";
import { buildIntelligenceFindings } from "@core/intelligence/pipeline/findings";
import type { RepoIntelligence } from "@core/domain/types";

describe("buildIntelligenceFindings", () => {
  it("normalizes graph and analyzer evidence with stable IDs", () => {
    const intelligence: RepoIntelligence = {
      workspaceRoot: "/repo",
      indexedAt: "",
      symbols: [],
      tests: [],
      apis: [],
      services: [],
      ownershipHints: [],
      frameworkHints: [],
      performanceSensitivePaths: [],
      modernizationCandidates: [],
      files: [file("a.ts"), file("b.ts"), file("orphan.ts")],
      dependencies: [
        {
          from: "a.ts",
          to: "b.ts",
          kind: "local",
          evidence: {
            source: "regex",
            confidence: 0.78,
            evidencePath: "a.ts",
            extractorVersion: "test"
          }
        },
        {
          from: "b.ts",
          to: "a.ts",
          kind: "local",
          evidence: {
            source: "regex",
            confidence: 0.78,
            evidencePath: "b.ts",
            extractorVersion: "test"
          }
        },
        {
          from: "a.ts",
          to: "missing.ts",
          kind: "local",
          evidence: {
            source: "regex",
            confidence: 0.78,
            evidencePath: "a.ts",
            extractorVersion: "test"
          }
        }
      ],
      securitySensitiveAreas: ["a.ts: token"]
    };
    const graph = analyzeRepositoryGraph(intelligence);
    const first = buildIntelligenceFindings(intelligence, graph);
    const second = buildIntelligenceFindings(intelligence, graph);
    expect(first.map((item) => item.id)).toEqual(second.map((item) => item.id));
    expect(first).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          category: "architecture",
          title: "Dependency cycle",
          severity: "medium"
        }),
        expect.objectContaining({
          category: "dependency",
          title: "Unresolved local import",
          filePath: "a.ts"
        }),
        expect.objectContaining({
          category: "security",
          title: "Security-sensitive code",
          filePath: "a.ts"
        })
      ])
    );
    expect(
      first.find((item) => item.title === "Unresolved local import")?.evidenceMetadata
    ).toContainEqual(expect.objectContaining({ source: "regex", evidencePath: "a.ts" }));
  });
});

function file(path: string) {
  return {
    path,
    language: "typescript",
    sizeBytes: 1,
    lineCount: 1,
    isTest: false,
    isGenerated: false,
    summary: ""
  };
}
