import { describe, expect, it } from "../../../support/testkit";
import { analyzeRepositoryGraph } from "@core/intelligence/pipeline/derivedGraph";
import { retrieveRepositoryIntelligence } from "@core/intelligence/pipeline/retrieval";
import type { RepoIntelligence } from "@core/domain/types";

const intelligence: RepoIntelligence = {
  workspaceRoot: "/repo",
  indexedAt: "",
  ownershipHints: [],
  frameworkHints: [],
  securitySensitiveAreas: [],
  performanceSensitivePaths: [],
  modernizationCandidates: [],
  tests: [],
  services: [],
  files: [
    file("src/auth.ts", "token authentication"),
    file("src/session.ts", "session storage"),
    file("src/unrelated.ts", "image resize")
  ],
  symbols: [
    {
      filePath: "src/auth.ts",
      name: "verifyToken",
      kind: "function",
      line: 1,
      exportStatus: "exported",
      evidence: {
        source: "regex",
        confidence: 0.72,
        evidencePath: "src/auth.ts",
        evidenceLine: 1,
        extractorVersion: "test"
      }
    }
  ],
  dependencies: [
    {
      from: "src/auth.ts",
      to: "src/session.ts",
      kind: "local",
      evidence: {
        source: "regex",
        confidence: 0.78,
        evidencePath: "src/auth.ts",
        extractorVersion: "test"
      }
    }
  ],
  apis: []
};

describe("retrieveRepositoryIntelligence", () => {
  it("combines lexical matches with graph neighbors", async () => {
    const result = await retrieveRepositoryIntelligence(
      intelligence,
      analyzeRepositoryGraph(intelligence),
      [],
      { text: "verify token", limit: 3 }
    );
    expect(result.mode).toBe("lexical-graph");
    expect(result.results[0].path).toBe("src/auth.ts");
    expect(result.results[0].evidenceMetadata).toContainEqual(
      expect.objectContaining({ source: "filesystem", evidencePath: "src/auth.ts" })
    );
    expect(result.results).toContainEqual(
      expect.objectContaining({ path: "src/session.ts", reasons: ["graph neighbor"] })
    );
  });

  it("uses optional semantic scores and degrades safely on failure", async () => {
    const graph = analyzeRepositoryGraph(intelligence);
    const hybrid = await retrieveRepositoryIntelligence(intelligence, graph, [], {
      text: "login",
      semanticScores: async () => ({ "src/session.ts": 0.9 })
    });
    expect(hybrid.mode).toBe("hybrid");
    expect(hybrid.results[0]).toEqual(expect.objectContaining({ path: "src/session.ts" }));
    const fallback = await retrieveRepositoryIntelligence(intelligence, graph, [], {
      text: "token",
      semanticScores: async () => {
        throw new Error("offline");
      }
    });
    expect(fallback.mode).toBe("lexical-graph");
    expect(fallback.warnings).toEqual(["Semantic retrieval unavailable: offline"]);
  });
});

function file(path: string, summary: string) {
  return {
    path,
    summary,
    language: "typescript",
    sizeBytes: 1,
    lineCount: 1,
    isTest: false,
    isGenerated: false,
    evidence: {
      source: "filesystem" as const,
      confidence: 1,
      evidencePath: path,
      extractorVersion: "test"
    }
  };
}
