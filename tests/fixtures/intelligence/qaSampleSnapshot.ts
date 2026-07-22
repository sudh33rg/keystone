/**
 * QA sample fixture (spec §52 integration tests).
 *
 * A minimal but COMPLETE IntelligenceSnapshot that satisfies IntelligenceSnapshotSchema's
 * superRefine (every entity's evidenceIds resolve to an evidence record with matching
 * subjectId; every relationship endpoint is a known entity). Used by the QA lifecycle
 * integration test to exercise change-set -> impact -> tests -> gaps -> risk -> plan -> gates.
 *
 * Scenario encoded:
 *   - OrderService.createOrder (production, public contract) calls calculatePrice and saveOrder.
 *   - OrderController (route handler for POST /orders) calls OrderService.createOrder.
 *   - OrderService is changed (modified) -> root.
 *   - Tests: OrderService.test.ts (unit) calls OrderService.createOrder; OrdersApi.test.ts (integration) calls OrderController.
 *   - Flows: POST /orders -> createOrder -> calculatePrice -> saveOrder -> publish OrderCreated.
 */
import type { IntelligenceSnapshot } from "../../../src/shared/contracts/intelligence";
import { IntelligenceSnapshotSchema } from "../../../src/shared/contracts/intelligence";

function ev(id: string, subjectId: string, statement: string) {
  return {
    id,
    subjectId,
    sourceKind: "source-file" as const,
    workspaceRootId: "root1",
    relativePath: "src/order/OrderService.ts",
    extractorId: "fixture",
    extractorVersion: "1",
    derivation: "extracted" as const,
    contentHash: "h",
    generation: 1,
    confidence: 1,
    statement,
  };
}

function sym(id: string, fileId: string, name: string, type: string, properties: Record<string, unknown> = {}) {
  return {
    id,
    repositoryId: "repo1",
    fileId,
    type,
    name,
    qualifiedName: `app.${name}`,
    language: "typescript",
    range: { startLine: 1, startColumn: 1, endLine: 10, endColumn: 1 },
    visibility: "public" as const,
    exported: true,
    evidenceIds: [`e-${id}`],
    confidence: 1,
    properties,
    generation: 1,
  };
}

function file(id: string, path: string, isTest = false, category: "source" | "test" = "source") {
  return {
    id,
    repositoryId: "repo1",
    workspaceRootId: "root1",
    relativePath: path,
    language: "typescript",
    category,
    analysisLevel: "deep" as const,
    byteSize: 100,
    modifiedAt: new Date().toISOString(),
    isTest,
    classification: { category, analysisLevel: "deep" as const, included: true, generated: false, binary: false, sensitive: false, ruleId: "fixture", reason: "Phase 7 test fixture" },
    evidenceIds: [`e-${id}`],
    generation: 1,
  };
}

function rel(id: string, sourceId: string, targetId: string, type: string, confidence = 1, resolution: "exact" | "compiler" | "framework" | "syntactic" | "convention" | "candidate" | "external" | "unresolved" = "exact") {
  return {
    id,
    repositoryId: "repo1",
    sourceId,
    targetId,
    type,
    resolution,
    evidenceIds: [`e-${id}`],
    derivation: "extracted" as const,
    confidence,
    generation: 1,
  };
}

export function buildQaSampleSnapshot(): IntelligenceSnapshot {
  const files = [
    file("f-controller", "src/order/OrderController.ts"),
    file("f-service", "src/order/OrderService.ts"),
    file("f-price", "src/order/PriceCalculator.ts"),
    file("f-repo", "src/order/OrderRepository.ts"),
    file("f-event", "src/order/OrderEvents.ts"),
    file("f-test-unit", "src/order/OrderService.test.ts", true, "test"),
    file("f-test-int", "src/order/OrdersApi.integration.test.ts", true, "test"),
  ];

  const syms = [
    sym("s-controller", "f-controller", "OrderController", "class", { isRoute: true, isEntryPoint: true }),
    sym("s-createOrder", "f-service", "createOrder", "method", { isPersistence: false }),
    sym("s-calculatePrice", "f-price", "calculatePrice", "function"),
    sym("s-saveOrder", "f-repo", "saveOrder", "method", { isPersistence: true }),
    sym("s-publish", "f-event", "publishOrderCreated", "function", { isEventPublisher: true }),
    sym("s-test-unit", "f-test-unit", "createsOrder", "method"),
    sym("s-test-int", "f-test-int", "postsOrder", "method"),
  ];

  const relationships = [
    rel("r-ctrl-call", "s-controller", "s-createOrder", "calls"),
    rel("r-create-call-price", "s-createOrder", "s-calculatePrice", "calls"),
    rel("r-create-call-save", "s-createOrder", "s-saveOrder", "calls"),
    rel("r-create-pub", "s-createOrder", "s-publish", "publishes"),
    rel("r-test-unit", "s-test-unit", "s-createOrder", "calls"),
    rel("r-test-int", "s-test-int", "s-controller", "calls"),
  ];

  const evidence = [
    ev("e-s-controller", "s-controller", "OrderController symbol"),
    ev("e-s-createOrder", "s-createOrder", "createOrder symbol"),
    ev("e-s-calculatePrice", "s-calculatePrice", "calculatePrice symbol"),
    ev("e-s-saveOrder", "s-saveOrder", "saveOrder symbol"),
    ev("e-s-publish", "s-publish", "publishOrderCreated symbol"),
    ev("e-s-test-unit", "s-test-unit", "unit test symbol"),
    ev("e-s-test-int", "s-test-int", "integration test symbol"),
    ev("e-f-controller", "f-controller", "controller file"),
    ev("e-f-service", "f-service", "service file"),
    ev("e-f-price", "f-price", "price file"),
    ev("e-f-repo", "f-repo", "repo file"),
    ev("e-f-event", "f-event", "event file"),
    ev("e-f-test-unit", "f-test-unit", "unit test file"),
    ev("e-f-test-int", "f-test-int", "integration test file"),
    ev("e-r-ctrl-call", "r-ctrl-call", "call edge"),
    ev("e-r-create-call-price", "r-create-call-price", "call edge"),
    ev("e-r-create-call-save", "r-create-call-save", "call edge"),
    ev("e-r-create-pub", "r-create-pub", "publish edge"),
    ev("e-r-test-unit", "r-test-unit", "test edge"),
    ev("e-r-test-int", "r-test-int", "test edge"),
    ev("e-repo", "repo1", "repository evidence"),
    ev("e-root1", "root1", "root evidence"),
  ];

  return IntelligenceSnapshotSchema.parse({
    manifest: {
      schemaVersion: 1 as const,
      generation: 1,
      scanRevision: 1,
      repositoryId: "repo1",
      status: "ready" as const,
      createdAt: new Date().toISOString(),
      completedAt: new Date().toISOString(),
      extractorVersions: {},
    },
    repository: {
      id: "repo1",
      displayName: "sample",
      workspaceRoots: [{ id: "root1", name: "root", evidenceIds: ["e-root1"] }],
      evidenceIds: ["e-repo"],
    },
    files,
    symbols: syms,
    relationships,
    evidence,
    diagnostics: [],
    indexes: {
      byName: {}, byQualifiedName: {}, byPath: {}, byType: {},
      byLanguage: {}, incoming: {}, outgoing: {}, routeHandlers: { "POST /orders": ["s-controller"] },
      testTargets: {}, packageMembership: {}, configurationUsage: {},
    },
  });
}
