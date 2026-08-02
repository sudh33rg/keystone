import { describe, expect, it } from "../../../support/testkit";

import { evaluateIntelligenceHealth } from "@core/intelligence/pipeline/health";

describe("evaluateIntelligenceHealth", () => {
  it("reports degraded health for incomplete discovery and unresolved evidence", () => {
    const health = evaluateIntelligenceHealth(
      {
        workspaceRoot: "/repo",
        indexedAt: "",
        symbols: [],
        apis: [],
        services: [],
        ownershipHints: [],
        frameworkHints: [],
        securitySensitiveAreas: [],
        performanceSensitivePaths: [],
        modernizationCandidates: [],
        files: [
          {
            path: "src/a.ts",
            language: "typescript",
            sizeBytes: 1,
            lineCount: 1,
            isTest: false,
            isGenerated: false,
            summary: ""
          }
        ],
        dependencies: [{ from: "src/a.ts", to: "src/missing", kind: "local" }],
        tests: [{ testFile: "a.test.ts", confidence: 0.3, reason: "ambiguous" }]
      },
      [],
      {
        inputFingerprint: "x",
        indexedFiles: 1,
        indexedBytes: 1,
        discoveryMode: "unbounded-incremental",
        completedWithoutFileCap: false,
        cpgEligibleFiles: 1,
        cpgIndexedFiles: 1,
        warnings: ["discovery interrupted"],
        reusedFiles: 0,
        analyzedFiles: 1,
        cpgShardsWritten: 0,
        cpgShardsReused: 0,
        cpgShardsDeleted: 0
      }
    );

    expect(health.status).toBe("degraded");
    expect(health.score).toBe(50);
    expect(health.checks.filter((check) => !check.passed).map((check) => check.id)).toEqual([
      "coverage",
      "local-imports",
      "test-mapping"
    ]);
  });
});
