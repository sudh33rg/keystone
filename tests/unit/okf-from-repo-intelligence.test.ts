import assert from "node:assert/strict";
import test from "node:test";

import { repoIntelligenceToOkf } from "../../src/core/intelligence/okf/fromRepoIntelligence";
import { validateOkfSnapshot } from "../../src/core/intelligence/okf/validation";
import { mapTests } from "../../src/core/intelligence/ingestion/testMapper";
import type { RepoFile, RepoIntelligence } from "../../src/core/domain/types";

const indexedAt = "2026-01-01T00:00:00.000Z";

function file(path: string, language: string, isTest: boolean): RepoFile {
  return {
    path,
    absolutePath: `/workspace/${path}`,
    language,
    isTest,
    isGenerated: false,
    sizeBytes: 1,
    lineCount: 1,
    contentHash: `${path}-content`,
    structuralHash: `${path}-structure`,
    frameworkHints: [],
    ownershipHints: [],
    securitySensitiveAreas: [],
    performanceSensitivePaths: [],
    modernizationCandidates: []
  };
}

test("test discovery does not map tests to documentation", () => {
  const files = [
    file("tests/documentation.test.ts", "typescript", true),
    file("documentation.md", "markdown", false)
  ];
  const [mapping] = mapTests(files);

  assert.equal(mapping.targetFile, undefined);
});

test("OKF promotion ignores stale test mappings to documentation", () => {
  const files = [
    file("tests/documentation.test.ts", "typescript", true),
    file("documentation.md", "markdown", false)
  ];
  const intelligence = {
    workspaceRoot: "/workspace",
    indexedAt,
    files,
    symbols: [],
    dependencies: [],
    tests: [
      {
        testFile: "tests/documentation.test.ts",
        targetFile: "documentation.md",
        confidence: 0.9,
        reason: "stale filename mapping"
      }
    ],
    apis: [],
    services: [],
    calls: [],
    controlFlows: [],
    dataFlows: [],
    typeRelationships: [],
    ownershipHints: [],
    frameworkHints: [],
    securitySensitiveAreas: [],
    performanceSensitivePaths: [],
    modernizationCandidates: [],
    languageSupport: [],
    incrementalStats: { reusedFiles: 0, analyzedFiles: files.length }
  } satisfies RepoIntelligence;
  const warnings: string[] = [];
  const snapshot = repoIntelligenceToOkf(intelligence, {
    onWarning: (message) => warnings.push(message)
  });

  assert.equal(validateOkfSnapshot(snapshot).valid, true);
  assert.equal(warnings.length, 1);
  assert.match(warnings[0], /invalid OKF relationship tests: test -> documentation/);
  assert.equal(
    snapshot.relationships.some((relationship) => relationship.kind === "tests"),
    false
  );
  assert.equal(
    snapshot.observations.some(
      (observation) => observation.predicate === "keystone:ignoredTestTarget"
    ),
    true
  );
});

test("Markdown files under test directories remain documentation", () => {
  const files = [file("tests/README.md", "markdown", true)];
  const intelligence = {
    workspaceRoot: "/workspace",
    indexedAt,
    files,
    symbols: [],
    dependencies: [],
    tests: [],
    apis: [],
    services: [],
    calls: [],
    controlFlows: [],
    dataFlows: [],
    typeRelationships: [],
    ownershipHints: [],
    frameworkHints: [],
    securitySensitiveAreas: [],
    performanceSensitivePaths: [],
    modernizationCandidates: [],
    languageSupport: [],
    incrementalStats: { reusedFiles: 0, analyzedFiles: files.length }
  } satisfies RepoIntelligence;
  const snapshot = repoIntelligenceToOkf(intelligence);
  const markdownUnit = snapshot.units.find((unit) => unit.canonicalKey === "tests/README.md");

  assert.equal(markdownUnit?.kind, "documentation");
  assert.equal(validateOkfSnapshot(snapshot).valid, true);
});
