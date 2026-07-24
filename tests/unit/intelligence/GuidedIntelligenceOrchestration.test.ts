import { describe, expect, it } from "vitest";
import {
  classifyInteraction,
  classifyNodeKind,
  classifyConfidence,
  toGuidedNode,
  toGuidedEdge,
  buildDiagramForResult,
  buildContextCandidates,
} from "../../../src/core/intelligence/guided/diagramMapping";
import { IntelligenceOrchestrationService } from "../../../src/core/intelligence/guided/IntelligenceOrchestrationService";
import type { IntelligenceQueryResult, QueryResultItem } from "../../../src/shared/contracts/query";
import { EvidenceSummarySchema } from "../../../src/shared/contracts/query";
import type { IntelligenceOverview } from "../../../src/shared/contracts/intelligence";

function item(partial: Partial<QueryResultItem> & Pick<QueryResultItem, "id" | "type" | "name">): QueryResultItem {
  return {
    score: 1,
    confidence: 0.9,
    classification: "exact",
    rankingReasons: [],
    ...partial,
  };
}

type LooseRel = { id: string; sourceId: string; targetId: string; type: string; confidence: number; resolution?: string; evidenceIds: string[] };
type LooseData = { kind?: string; items?: QueryResultItem[]; relationships?: LooseRel[]; paths?: unknown[] };
type LooseResult = { generation?: number; evidence?: unknown[]; diagnostics?: unknown[]; truncated?: boolean; data?: LooseData };

function result(partial: LooseResult): IntelligenceQueryResult {
  const data = partial.data ?? { kind: "architecture", items: [], relationships: [], paths: [] };
  return {
    queryId: "q1",
    operation: "ARCHITECTURE",
    executionTimeMs: 1,
    resolvedSeeds: [],
    plan: { indexesUsed: [], relationshipFamilies: [], capabilityBoundaries: [], stages: [] } as never,
    data: {
      kind: data.kind ?? "architecture",
      items: data.items ?? [],
      relationships: (data.relationships ?? []) as never,
      paths: (data.paths ?? []) as never,
    },
    evidence: (partial.evidence ?? []) as never,
    diagnostics: (partial.diagnostics ?? []) as never,
    explanation: {} as never,
    truncated: partial.truncated ?? false,
    continuationToken: undefined,
    cacheState: "bypassed",
    generation: partial.generation,
  } as unknown as IntelligenceQueryResult;
}

describe("guided diagram mapping — classification", () => {
  it("maps relationship types to interaction kinds", () => {
    expect(classifyInteraction("keystone.core.READS_FROM")).toBe("database-read");
    expect(classifyInteraction("keystone.core.WRITES_TO")).toBe("database-write");
    expect(classifyInteraction("keystone.core.PERSISTS")).toBe("database-write");
    expect(classifyInteraction("keystone.core.EMITS")).toBe("event-publish");
    expect(classifyInteraction("keystone.core.PRODUCES")).toBe("event-publish");
    expect(classifyInteraction("keystone.core.CONSUMES")).toBe("event-subscribe");
    expect(classifyInteraction("keystone.core.CALLS")).toBe("calls");
    expect(classifyInteraction("keystone.core.IMPORTS")).toBe("imports");
    expect(classifyInteraction("keystone.core.ROUTE_EXPOSES")).toBe("http-request");
    expect(classifyInteraction("keystone.core.HANDLES")).toBe("http-request");
    expect(classifyInteraction("keystone.core.FOREIGN_KEY")).toBe("foreign-key");
    expect(classifyInteraction("keystone.core.MIGRATION_APPLIES")).toBe("database-write");
  });

  it("falls back heuristically for unknown relationship types", () => {
    expect(classifyInteraction("keystone.core.MESSAGE_PUBLISHED")).toBe("event-publish");
    expect(classifyInteraction("keystone.core.MESSAGE_CONSUMED")).toBe("event-subscribe");
    expect(classifyInteraction("keystone.core.QUEUE_SENT")).toBe("queue-send");
    expect(classifyInteraction("keystone.core.QUEUE_RECEIVED")).toBe("queue-receive");
    expect(classifyInteraction("keystone.core.DB_READ")).toBe("database-read");
    expect(classifyInteraction("keystone.core.DB_WRITE")).toBe("database-write");
    expect(classifyInteraction("keystone.core.DEPENDS_ON")).toBe("depends-on");
  });

  it("maps entity types to node kinds", () => {
    expect(classifyNodeKind("keystone.core.Application", "symbol")).toBe("application");
    expect(classifyNodeKind("keystone.core.Service", "symbol")).toBe("service");
    expect(classifyNodeKind("keystone.core.Database", "symbol")).toBe("database");
    expect(classifyNodeKind("keystone.core.Route", "symbol")).toBe("route");
    expect(classifyNodeKind("keystone.core.ORMEntity", "symbol")).toBe("entity");
    expect(classifyNodeKind("keystone.core.SchemaTable", "symbol")).toBe("table");
    expect(classifyNodeKind("keystone.core.Broker", "symbol")).toBe("broker");
    expect(classifyNodeKind("SomeUnknownType", "symbol")).toBe("symbol");
  });

  it("maps resolution/classification to confidence categories", () => {
    expect(classifyConfidence("exact", "exact")).toBe("exact");
    expect(classifyConfidence("compiler", undefined)).toBe("resolved");
    expect(classifyConfidence(undefined, "cpg-assisted")).toBe("cpg-assisted");
    expect(classifyConfidence("framework", undefined)).toBe("convention-based");
    expect(classifyConfidence("unresolved", undefined)).toBe("unresolved");
    expect(classifyConfidence(undefined, "candidate")).toBe("candidate");
  });
});

describe("guided diagram mapping — diagram construction", () => {
  const items = [
    item({ id: "app1", type: "keystone.core.Application", name: "WebApp" }),
    item({ id: "svc1", type: "keystone.core.Service", name: "OrderService" }),
    item({ id: "db1", type: "keystone.core.Database", name: "OrdersDB" }),
  ];
  const relationships = [
    { id: "r1", sourceId: "app1", targetId: "svc1", type: "keystone.core.CALLS", confidence: 0.9, resolution: "exact", evidenceIds: ["e1"] },
    { id: "r2", sourceId: "svc1", targetId: "db1", type: "keystone.core.WRITES_TO", confidence: 0.8, resolution: "resolved", evidenceIds: ["e2"] },
    { id: "r3", sourceId: "svc1", targetId: "db1", type: "keystone.core.READS_FROM", confidence: 0.5, resolution: "unresolved", evidenceIds: ["e3"] },
  ];

  it("builds a system-landscape diagram for the systems view", () => {
    const res = result({ data: { kind: "architecture", items, relationships, paths: [] } });
    const diagram = buildDiagramForResult({ view: "systems", action: "landscape" }, res);
    expect(diagram.kind).toBe("system-landscape");
    expect(diagram.nodes).toHaveLength(3);
    expect(diagram.edges).toHaveLength(3);
    expect(diagram.edges.find((e) => e.id === "r2")?.interaction).toBe("database-write");
    expect(diagram.edges.find((e) => e.id === "r3")?.interaction).toBe("database-read");
    // unresolved relationship is visually distinct (dashed)
    expect(diagram.edges.find((e) => e.id === "r3")?.dashed).toBe(true);
    expect(diagram.edges.find((e) => e.id === "r1")?.dashed).toBe(false);
    // evidence is propagated onto edges
    expect(diagram.edges.find((e) => e.id === "r2")?.evidenceIds).toContain("e2");
  });

  it("builds an ordered flow with steps from query paths for the flows view", () => {
    const res = result({
      data: {
        kind: "flow",
        items,
        relationships,
        paths: [
          {
            steps: [
              { entityId: "app1", entityName: "WebApp", entityType: "keystone.core.Application", relationshipId: "r1", relationshipType: "keystone.core.CALLS", traversalDirection: "outgoing", confidence: 0.9, classification: "exact", evidenceIds: ["e1"] },
              { entityId: "svc1", entityName: "OrderService", entityType: "keystone.core.Service", relationshipId: "r2", relationshipType: "keystone.core.WRITES_TO", traversalDirection: "outgoing", confidence: 0.8, classification: "resolved", evidenceIds: ["e2"] },
              { entityId: "db1", entityName: "OrdersDB", entityType: "keystone.core.Database", relationshipId: undefined, traversalDirection: "outgoing", confidence: 0.8, classification: "resolved", evidenceIds: ["e2"] },
            ],
            confidence: 0.85,
            risk: 0,
            unsupportedBoundaries: [],
            truncated: false,
          },
        ],
      },
    });
    const diagram = buildDiagramForResult({ view: "flows", action: "request" }, res);
    expect(diagram.kind).toBe("ordered-flow");
    expect(diagram.orientation).toBe("left-to-right");
    expect(diagram.steps).toHaveLength(3);
    expect(diagram.steps[0]!.nodeId).toBe("app1");
    expect(diagram.steps[2]!.nodeId).toBe("db1");
  });

  it("uses top-to-bottom orientation for startup flows", () => {
    const res = result({ data: { kind: "flow", items, relationships, paths: [] } });
    const diagram = buildDiagramForResult({ view: "flows", action: "startup" }, res);
    expect(diagram.orientation).toBe("top-to-bottom");
  });

  it("classifies a messaging producer-to-consumer flow", () => {
    const msgItems = [
      item({ id: "prod", type: "keystone.core.Service", name: "BillingService" }),
      item({ id: "broker", type: "keystone.core.Broker", name: "EventBus" }),
      item({ id: "cons", type: "keystone.core.Service", name: "InvoiceService" }),
    ];
    const msgRels = [
      { id: "m1", sourceId: "prod", targetId: "broker", type: "keystone.core.EMITS", confidence: 0.9, resolution: "exact", evidenceIds: ["e4"] },
      { id: "m2", sourceId: "broker", targetId: "cons", type: "keystone.core.CONSUMES", confidence: 0.9, resolution: "exact", evidenceIds: ["e5"] },
    ];
    const res = result({ data: { kind: "flow", items: msgItems, relationships: msgRels, paths: [] } });
    const diagram = buildDiagramForResult({ view: "messaging", action: "flow" }, res);
    expect(diagram.edges.find((e) => e.id === "m1")?.interaction).toBe("event-publish");
    expect(diagram.edges.find((e) => e.id === "m2")?.interaction).toBe("event-subscribe");
  });
});

describe("guided diagram mapping — entities and context", () => {
  it("maps items to nodes and candidates, preserving confidence", () => {
    const it = item({ id: "x", type: "keystone.core.Service", name: "Svc", confidence: 0.7, classification: "resolved" });
    const node = toGuidedNode(it);
    expect(node.kind).toBe("service");
    expect(node.classification).toBe("resolved");
    expect(node.entityId).toBe("x");
    const candidates = buildContextCandidates([it]);
    expect(candidates[0]!.label).toBe("Svc");
    expect(candidates[0]!.confidence).toBe(0.7);
  });

  it("marks inferred/unresolved edges as dashed", () => {
    const edge = toGuidedEdge({ id: "u1", sourceId: "a", targetId: "b", type: "keystone.core.CALLS", confidence: 0.3, resolution: "unresolved", evidenceIds: [] });
    expect(edge.dashed).toBe(true);
    expect(edge.classification).toBe("unresolved");
  });
});

describe("IntelligenceOrchestrationService", () => {
  function fakeQueryService(overviewBase: IntelligenceOverview, queryResult: IntelligenceQueryResult) {
    return {
      overview: async () => overviewBase,
      unified: async () => queryResult,
    } as unknown as import("../../../src/core/intelligence/IntelligenceQueryService").IntelligenceQueryService;
  }

  const overviewBase: IntelligenceOverview = {
    status: "ready",
    pendingUpdate: false,
    generation: 7,
    repository: { id: "r", displayName: "acme-platform", workspaceRoots: [], branch: "main" },
    updatedAt: new Date().toISOString(),
    runtime: { phase: "idle", queueDepth: 0, activeWorkers: 0, workerCapacity: 0, pendingFiles: 0, lastIndexDurationMs: 0, currentGeneration: 7, totalGenerations: 1, lastError: undefined, isIndexing: false, isPaused: false, nextRecommendedAction: "none" } as never,
    counts: { files: 120, symbols: 500, relationships: 800, evidence: 200, packages: 10, tests: 30, routes: 5, externalDependencies: 8, parseFailures: 0, unresolvedReferences: 0, excluded: 0, sensitive: 0, diagnostics: 0 },
    languages: [{ key: "TypeScript", count: 120 }],
    categories: [],
    symbolTypes: [],
    relationshipTypes: [],
    confidence: [],
  } as unknown as IntelligenceOverview;

  const queryResult = result({
    generation: 7,
    evidence: [
      EvidenceSummarySchema.parse({
        id: "e1",
        subjectId: "app1",
        relativePath: "package.json",
        range: { startLine: 1, startColumn: 1, endLine: 1, endColumn: 1 },
        extractorId: "manifest",
        extractorVersion: "1",
        derivation: "extracted",
        confidence: 0.9,
        statement: "Detected application from package.json",
      }),
    ],
    data: {
      kind: "architecture",
      items: [
        item({ id: "app1", type: "keystone.core.Application", name: "WebApp" }),
        item({ id: "svc1", type: "keystone.core.Service", name: "OrderService" }),
      ],
      relationships: [{ id: "r1", sourceId: "app1", targetId: "svc1", type: "keystone.core.CALLS", confidence: 0.9, resolution: "exact", evidenceIds: ["e1"] }],
      paths: [],
    },
  });

  it("produces a repository orientation with follow-up actions", async () => {
    const svc = new IntelligenceOrchestrationService(fakeQueryService(overviewBase, queryResult));
    const res = await svc.overview();
    expect(res.view).toBe("overview");
    expect(res.answer).toContain("acme-platform");
    expect(res.orientation[0]!.level).toBe("Repository");
    expect(res.followUps.length).toBeGreaterThan(0);
    expect(res.generation).toBe(7);
  });

  it("runs a view and returns a canonical result with diagram, evidence and context candidates", async () => {
    const svc = new IntelligenceOrchestrationService(fakeQueryService(overviewBase, queryResult));
    const res = await svc.run({ view: "systems", action: "landscape" });
    expect(res.view).toBe("systems");
    expect(res.diagram?.nodes).toHaveLength(2);
    expect(res.diagram?.edges).toHaveLength(1);
    expect(res.evidence.find((e) => e.id === "e1")).toBeDefined();
    expect(res.contextCandidates.length).toBe(2);
    expect(res.orientation.some((c) => c.level === "View")).toBe(true);
  });

  it("propagates unresolved relationships as dashed edges in the diagram", async () => {
    const unresolved = result({
      data: {
        kind: "architecture",
        items: [item({ id: "a", type: "keystone.core.Service", name: "A" }), item({ id: "b", type: "keystone.core.Service", name: "B" })],
        relationships: [{ id: "ru", sourceId: "a", targetId: "b", type: "keystone.core.CALLS", confidence: 0.2, resolution: "unresolved", evidenceIds: [] }],
        paths: [],
      },
    });
    const svc = new IntelligenceOrchestrationService(fakeQueryService(overviewBase, unresolved));
    const res = await svc.run({ view: "architecture", action: "architecture" });
    expect(res.diagram?.edges[0]!.dashed).toBe(true);
    expect(res.diagram?.edges[0]!.classification).toBe("unresolved");
  });
});
