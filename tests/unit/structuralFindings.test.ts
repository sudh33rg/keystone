import assert from "node:assert/strict";
import test from "node:test";

import type { RepoIntelligence } from "@core/domain/types";
import { analyzeRepositoryGraph } from "@core/intelligence/pipeline/derivedGraph";
import { buildIntelligenceFindings } from "@core/intelligence/pipeline/findings";
import { detectSecuritySensitiveArea } from "@core/intelligence/ingestion/securityZoneDetector";
import { detectPerformanceSensitivePath } from "@core/intelligence/ingestion/performancePathDetector";

test("explicit authorization annotations are retained as security-boundary signals", () => {
  assert.ok(detectSecuritySensitiveArea("src/orders.py", "@app.get('/orders')\ndef orders(user = Depends(requireAuth)): pass").includes("explicit authorization boundary"));
  assert.ok(detectSecuritySensitiveArea("src/Orders.java", "@PreAuthorize(\"hasRole('ADMIN')\") void list() {}").includes("explicit authorization boundary"));
});

test("database operations inside loop bodies are retained as performance-review signals", () => {
  assert.ok(detectPerformanceSensitivePath("src/orders.ts", "for (const id of ids) { await repository.find(id); }").includes("database operation inside loop"));
  assert.ok(detectPerformanceSensitivePath("src/orders.py", "for order in orders:\n    session.query(Order).filter_by(id=order.id).first()").includes("database operation inside loop"));
});

test("security and performance findings retain scoped structural evidence", () => {
  const intelligence: RepoIntelligence = {
    workspaceRoot: "/repo",
    indexedAt: new Date().toISOString(),
    files: [
      { path: "src/orders.ts", language: "typescript", sizeBytes: 1, lineCount: 1, isTest: false, isGenerated: false, summary: "orders" },
      { path: "src/store.ts", language: "typescript", sizeBytes: 1, lineCount: 1, isTest: false, isGenerated: false, summary: "store" }
    ],
    symbols: [],
    dependencies: [{ from: "src/orders.ts", to: "src/store.ts", kind: "local" }],
    tests: [],
    apis: [{ method: "POST", path: "/orders", filePath: "src/orders.ts", line: 4 }],
    services: [],
    calls: [{ filePath: "src/orders.ts", caller: "createOrder", callee: "repository.save", line: 8 }],
    engineeringEntities: [{ kind: "repository", name: "OrderRepository", filePath: "src/orders.ts", line: 7, properties: {} }],
    ownershipHints: [],
    frameworkHints: [],
    securitySensitiveAreas: ["src/orders.ts: authentication boundary"],
    performanceSensitivePaths: ["src/orders.ts: database write"],
    modernizationCandidates: []
  };
  const findings = buildIntelligenceFindings(intelligence, analyzeRepositoryGraph(intelligence));

  for (const category of ["security", "performance"] as const) {
    const finding = findings.find((item) => item.category === category)!;
    assert.match(finding.description, /Structural context/);
    assert.match(finding.description, /API boundaries/);
    assert.match(finding.description, /persistence entities/);
    assert.ok(finding.evidence.some((item) => item.includes("call evidence")));
    assert.ok(finding.evidenceMetadata.some((item) => item.warnings?.some((warning) => warning.includes("structural context"))));
  }
});

test("graph impact follows resolved call evidence to discover affected tests", () => {
  const intelligence: RepoIntelligence = {
    workspaceRoot: "/repo", indexedAt: new Date().toISOString(),
    files: [
      { path: "src/orders.ts", language: "typescript", sizeBytes: 1, lineCount: 1, isTest: false, isGenerated: false, summary: "orders" },
      { path: "tests/orders.test.ts", language: "typescript", sizeBytes: 1, lineCount: 1, isTest: true, isGenerated: false, summary: "orders tests" }
    ],
    symbols: [], dependencies: [], tests: [{ testFile: "tests/orders.test.ts", targetFile: "src/orders.ts", confidence: 0.95, reason: "resolved call" }], apis: [], services: [], ownershipHints: [], frameworkHints: [],
    calls: [{ filePath: "tests/orders.test.ts", caller: "orders test", callee: "createOrder", line: 4, targetFilePath: "src/orders.ts", targetLine: 2 }],
    securitySensitiveAreas: [], performanceSensitivePaths: [], modernizationCandidates: []
  };
  const impact = analyzeRepositoryGraph(intelligence).impactedBy(["src/orders.ts"]);
  assert.deepEqual(impact.tests, ["tests/orders.test.ts"]);
  assert.ok(impact.files.includes("tests/orders.test.ts"));
});

test("explicit authorization and database-in-loop markers receive scoped finding titles", () => {
  const intelligence: RepoIntelligence = {
    workspaceRoot: "/repo", indexedAt: new Date().toISOString(),
    files: [{ path: "src/orders.ts", language: "typescript", sizeBytes: 1, lineCount: 1, isTest: false, isGenerated: false, summary: "orders" }],
    symbols: [], dependencies: [], tests: [], apis: [], services: [], ownershipHints: [], frameworkHints: [],
    securitySensitiveAreas: ["src/orders.ts: explicit authorization boundary"],
    performanceSensitivePaths: ["src/orders.ts: database operation inside loop"],
    modernizationCandidates: []
  };
  const findings = buildIntelligenceFindings(intelligence, analyzeRepositoryGraph(intelligence));
  const authorization = findings.find((finding) => finding.title === "Explicit authorization boundary");
  const databaseLoop = findings.find((finding) => finding.title === "Database operation inside loop");
  assert.ok(authorization);
  assert.ok(databaseLoop && databaseLoop.severity === "medium");
  assert.ok(authorization.evidenceMetadata.some((item) => item.warnings?.some((warning) => warning.includes("does not prove"))));
  assert.ok(databaseLoop.evidenceMetadata.some((item) => item.warnings?.some((warning) => warning.includes("not a measured"))));
});
