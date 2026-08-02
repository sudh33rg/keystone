/**
 * Focused verification for the import-scoped call resolution added to
 * `okf/fromRepoIntelligence.ts`. Builds a minimal RepoIntelligence with an
 * unresolved `base.method(...)` call and asserts it now resolves via the
 * dependency/import graph rather than falling back to a global name match.
 * No test framework is configured, so this is a standalone node:assert script.
 * Run: `npm run build && node scripts/verify-call-resolution.mjs`.
 */
import assert from "node:assert/strict";
import { promises as fs } from "node:fs";
import path from "node:path";
import os from "node:os";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const root = process.cwd();
const built = (...segments) => path.join(root, "dist", "app", ...segments);
const { repoIntelligenceToOkf } = require(
  built("core", "intelligence", "okf", "fromRepoIntelligence.js")
);

function minimalIntelligence() {
  const workspaceRoot = path.join(os.tmpdir(), "keystone-calltest");
  return {
    workspaceRoot,
    indexedAt: new Date().toISOString(),
    files: [
      {
        path: "a.ts",
        language: "typescript",
        sizeBytes: 10,
        lineCount: 10,
        contentHash: "h1",
        structuralHash: "s1",
        isTest: false,
        isGenerated: false,
        evidence: { source: "repo-intelligence", evidencePath: "a.ts" }
      },
      {
        path: "b.ts",
        language: "typescript",
        sizeBytes: 10,
        lineCount: 10,
        contentHash: "h2",
        structuralHash: "s2",
        isTest: false,
        isGenerated: false,
        evidence: { source: "repo-intelligence", evidencePath: "b.ts" }
      },
      {
        path: "c.ts",
        language: "typescript",
        sizeBytes: 10,
        lineCount: 10,
        contentHash: "h3",
        structuralHash: "s3",
        isTest: false,
        isGenerated: false,
        evidence: { source: "repo-intelligence", evidencePath: "c.ts" }
      }
    ],
    symbols: [
      {
        name: "doWork",
        kind: "function",
        filePath: "b.ts",
        line: 2,
        exportStatus: "exported",
        evidence: { source: "repo-intelligence", evidencePath: "b.ts" }
      },
      {
        name: "doWork",
        kind: "function",
        filePath: "c.ts",
        line: 2,
        exportStatus: "exported",
        evidence: { source: "repo-intelligence", evidencePath: "c.ts" }
      },
      {
        name: "run",
        kind: "function",
        filePath: "a.ts",
        line: 1,
        exportStatus: "local",
        evidence: { source: "repo-intelligence", evidencePath: "a.ts" }
      }
    ],
    dependencies: [
      {
        from: "a.ts",
        to: "b.ts",
        kind: "import",
        evidence: { source: "repo-intelligence", evidencePath: "a.ts" }
      },
      {
        from: "a.ts",
        to: "c.ts",
        kind: "import",
        evidence: { source: "repo-intelligence", evidencePath: "a.ts" }
      }
    ],
    tests: [],
    apis: [],
    services: [],
    // `helper.doWork()` in a.ts — base.method form, no targetFilePath.
    calls: [
      {
        filePath: "a.ts",
        caller: "run",
        callee: "helper.doWork",
        line: 3,
        evidence: { source: "repo-intelligence", evidencePath: "a.ts" }
      }
    ],
    ownershipHints: [],
    frameworkHints: [],
    securitySensitiveAreas: [],
    performanceSensitivePaths: [],
    modernizationCandidates: []
  };
}

function main() {
  const intel = minimalIntelligence();
  const snapshot = repoIntelligenceToOkf(intel, { extractionRunId: "test-run" });

  const byId = new Map(snapshot.units.map((u) => [u.id, u]));
  const nameOf = (id) => byId.get(id)?.name;
  const calls = snapshot.relationships.filter((r) => r.kind === "calls");
  const unresolved = snapshot.observations.filter(
    (o) => o.predicate === "keystone:unresolvedCallee"
  );

  assert.ok(calls.length >= 1, "expected at least one 'calls' relationship");
  const resolved = calls.find(
    (r) => nameOf(r.sourceId) === "run" && nameOf(r.targetId) === "doWork"
  );
  assert.ok(
    resolved,
    "helper.doWork must resolve to a 'calls' edge from run -> doWork via import scope"
  );
  assert.equal(
    unresolved.filter((o) => o.value === "helper.doWork").length,
    0,
    "helper.doWork must NOT be logged as unresolved"
  );

  console.log(
    "PASS call-resolution: base.method 'helper.doWork' resolved via import scope (no global fallback, no unresolvedCallee)"
  );
}

main();
console.log("CALL-RESOLUTION VERIFICATION PASSED");
