import { describe, expect, it } from "../../../support/testkit";
import { analyzeDeadCode } from "@core/intelligence/pipeline/deadCode";
import { analyzeRepositoryGraph } from "@core/intelligence/pipeline/derivedGraph";
import type { RepoIntelligence } from "@core/domain/types";

describe("analyzeDeadCode", () => {
  it("reports only unexported, unreferenced symbols and preserves confidence", () => {
    const intelligence: RepoIntelligence = {
      workspaceRoot: "/repo",
      indexedAt: "",
      dependencies: [],
      tests: [],
      apis: [],
      services: [],
      ownershipHints: [],
      frameworkHints: [],
      securitySensitiveAreas: [],
      performanceSensitivePaths: [],
      modernizationCandidates: [],
      files: [file("src/unused.ts"), file("src/used.ts")],
      symbols: [
        symbol("unused", "src/unused.ts", 1, "local"),
        symbol("used", "src/used.ts", 1, "local"),
        symbol("publicApi", "src/used.ts", 2, "exported")
      ]
    };
    const semantic = {
      projectConfigs: [],
      files: 2,
      calls: [
        {
          sourcePath: "src/used.ts",
          sourceLine: 3,
          callee: "used",
          targetPath: "src/used.ts",
          targetLine: 1,
          confidence: 1 as const
        }
      ],
      relationships: [],
      callbacks: [],
      unresolvedCalls: 0,
      diagnostics: 0,
      configuredDiagnostics: 0,
      fallbackDiagnostics: 0,
      configuredFiles: 0,
      fallbackFiles: 2
    };
    expect(analyzeDeadCode(intelligence, analyzeRepositoryGraph(intelligence), semantic)).toEqual([
      expect.objectContaining({ name: "unused", filePath: "src/unused.ts", confidence: 0.8 })
    ]);
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
function symbol(name: string, filePath: string, line: number, exportStatus: "local" | "exported") {
  return { name, filePath, line, exportStatus, kind: "function" as const };
}
