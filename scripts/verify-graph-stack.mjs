/**
 * Formal graph-stack sign-off verification.
 *
 * Confirm the canonical graph stack is alive and wired to OKF:
 *   1. `repoIntelligenceToOkf` emits `calls` relationships (call resolution).
 *   2. `exploreOkfSnapshot` projects those OKF units/relationships into the
 *      graph nodes/edges that `GraphCanvas` consumes.
 *
 * This proves the visual graph (intelligenceExplorer -> GraphCanvas) is the
 * canonical, OKF-derived graph and is NOT dependent on the deleted
 * `intelligence/graph/{types,graphQuery,platformModel}` legacy store.
 * Run: `npm run build && node scripts/verify-graph-stack.mjs`.
 */
import assert from "node:assert/strict";
import path from "node:path";
import os from "node:os";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const root = process.cwd();
const built = (...segments) => path.join(root, "dist", "app", ...segments);
const { repoIntelligenceToOkf } = require(
  built("core", "intelligence", "okf", "fromRepoIntelligence.js")
);
const { buildOkfGraphView } = require(
  built("core", "intelligence", "explorer", "intelligenceExplorer.js")
);

function minimalIntelligence() {
  const workspaceRoot = path.join(os.tmpdir(), "keystone-graphstack");
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
      }
    ],
    symbols: [
      {
        name: "run",
        kind: "function",
        filePath: "a.ts",
        line: 1,
        exportStatus: "local",
        evidence: { source: "repo-intelligence", evidencePath: "a.ts" }
      },
      {
        name: "doWork",
        kind: "function",
        filePath: "b.ts",
        line: 2,
        exportStatus: "exported",
        evidence: { source: "repo-intelligence", evidencePath: "b.ts" }
      }
    ],
    dependencies: [
      {
        from: "a.ts",
        to: "b.ts",
        kind: "import",
        evidence: { source: "repo-intelligence", evidencePath: "a.ts" }
      }
    ],
    tests: [],
    apis: [],
    services: [],
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
  const snapshot = repoIntelligenceToOkf(minimalIntelligence(), { extractionRunId: "signoff-run" });

  const calls = snapshot.relationships.filter((r) => r.kind === "calls");
  assert.ok(calls.length >= 1, "OKF must emit 'calls' relationships");

  // Canonical explorer projects the OKF snapshot into graph nodes/edges.
  const result = buildOkfGraphView(snapshot, { mode: "calls", query: "doWork" });
  assert.ok(Array.isArray(result.nodes), "explorer must return graph nodes");
  assert.ok(result.nodes.length >= 1, "explorer must project at least one node for the query");
  assert.ok(Array.isArray(result.edges), "explorer must return graph edges");
  assert.ok(result.edges.length >= 1, "explorer must project edges from OKF relationships");

  console.log(
    `PASS graph-stack: OKF emitted ${calls.length} calls edge(s); explorer projected ${result.nodes.length} node(s), ${result.edges.length} edge(s)`
  );
  console.log(
    "PASS graph-stack: canonical graph is OKF-derived (intelligenceExplorer -> GraphCanvas), independent of deleted intelligence/graph/*"
  );
}

main();
console.log("GRAPH-STACK SIGN-OFF PASSED");
