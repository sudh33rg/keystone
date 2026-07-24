import type { IntelligenceQueryResult, QueryResultItem } from "../../../shared/contracts/query";
import {
  DiagramKindSchema,
  FlowOrientationSchema,
  type GuidedNode,
  type GuidedEdge,
  type GuidedDiagram,
  type GuidedStep,
  type NodeKind,
  type EdgeInteraction,
  type ConfidenceCategory,
  type ContextCandidate,
  type GuidedRequest,
} from "../../../shared/contracts/guidedIntelligence";

/**
 * Pure, deterministic mapping helpers that turn canonical Intelligence query
 * results into the guided canonical diagram/entity model. Kept free of any
 * service dependency so they can be unit-tested directly and reused by every
 * guided submenu (systems, architecture, flows, messaging, data, ...).
 */

export const RELATIONSHIP_TO_INTERACTION: Record<string, EdgeInteraction> = {
  "keystone.core.CALLS": "calls",
  "keystone.core.INSTANTIATES": "calls",
  "keystone.core.EXECUTES": "calls",
  "keystone.core.IMPORTS": "imports",
  "keystone.core.RE_EXPORTS": "imports",
  "keystone.core.REFERENCES": "depends-on",
  "keystone.core.USES": "depends-on",
  "keystone.core.DEPENDS_ON": "depends-on",
  "keystone.core.ROUTES_TO": "http-request",
  "keystone.core.HANDLES": "http-request",
  "keystone.core.IMPLEMENTS_CONTRACT_OPERATION": "rpc",
  "keystone.core.READS_FROM": "database-read",
  "keystone.core.WRITES_TO": "database-write",
  "keystone.core.PERSISTS": "database-write",
  "keystone.core.READS_CONFIGURATION": "configuration-dependency",
  "keystone.core.USES_CONFIGURATION": "configuration-dependency",
  "keystone.core.CONFIGURED_BY": "configuration-dependency",
  "keystone.core.EMITS": "event-publish",
  "keystone.core.PRODUCES": "event-publish",
  "keystone.core.CONSUMES": "event-subscribe",
  "keystone.core.FLOWS_TO": "flow-step",
  "keystone.core.TARGETS": "http-request",
  "keystone.core.TRIGGERS": "queue-send",
  "keystone.core.SERIALIZES_WITH": "event-publish",
  "keystone.core.VALIDATES_WITH": "calls",
  "keystone.core.DEFINES_TECHNOLOGY": "depends-on",
  "keystone.core.USES_TECHNOLOGY": "depends-on",
  "keystone.core.FOREIGN_KEY": "foreign-key",
  "keystone.core.ORM_HAS_FIELD": "contains",
  "keystone.core.DB_TABLE_HAS_COLUMN": "contains",
  "keystone.core.ROUTE_EXPOSES": "http-request",
  "keystone.core.MIGRATION_APPLIES": "database-write",
};

export const TYPE_TO_NODE_KIND: Record<string, NodeKind> = {
  "keystone.core.Application": "application",
  "keystone.core.Service": "service",
  "keystone.core.Worker": "worker",
  "keystone.core.ScheduledJob": "scheduled-job",
  "keystone.core.Library": "library",
  "keystone.core.Database": "database",
  "keystone.core.Cache": "cache",
  "keystone.core.Broker": "broker",
  "keystone.core.Topic": "topic",
  "keystone.core.Queue": "queue",
  "keystone.core.ExternalService": "external-api",
  "keystone.core.Infrastructure": "infrastructure",
  "keystone.core.Module": "module",
  "keystone.core.Framework": "library",
  "keystone.core.ORM": "library",
  "keystone.core.DatabaseDetection": "database",
  "keystone.core.Route": "route",
  "keystone.core.Class": "symbol",
  "keystone.core.Function": "symbol",
  "keystone.core.Interface": "symbol",
  "keystone.core.Test": "test",
  "keystone.core.ORMEntity": "entity",
  "keystone.core.SchemaTable": "table",
};

export function classifyInteraction(type: string): EdgeInteraction {
  if (RELATIONSHIP_TO_INTERACTION[type]) return RELATIONSHIP_TO_INTERACTION[type];
  const upper = type.toUpperCase();
  if (upper.includes("MESSAGE") || upper.includes("EVENT")) return upper.includes("CONSUM") || upper.includes("SUBSCRIB") ? "event-subscribe" : "event-publish";
  if (upper.includes("QUEUE")) return upper.includes("RECEIV") || upper.includes("CONSUM") ? "queue-receive" : "queue-send";
  if (upper.includes("READ")) return "database-read";
  if (upper.includes("WRITE") || upper.includes("PERSIST")) return "database-write";
  if (upper.includes("CALL")) return "calls";
  if (upper.includes("IMPORT")) return "imports";
  if (upper.includes("ROUTE") || upper.includes("HTTP")) return "http-request";
  if (upper.includes("FOREIGN")) return "foreign-key";
  return "depends-on";
}

export function classifyNodeKind(type: string | undefined, fallback: NodeKind): NodeKind {
  if (type && TYPE_TO_NODE_KIND[type]) return TYPE_TO_NODE_KIND[type];
  if (type) {
    const lower = type.toLowerCase();
    if (lower.includes("db") || lower.includes("table")) return "table";
    if (lower.includes("controller")) return "symbol";
    if (lower.includes("repository") || lower.includes("dao")) return "symbol";
    if (lower.includes("service")) return "service";
    if (lower.includes("handler")) return "handler";
  }
  return fallback;
}

export function classifyConfidence(resolution: string | undefined, classification: string | undefined): ConfidenceCategory {
  const v = (classification ?? resolution ?? "candidate").toLowerCase();
  if (v.includes("exact")) return "exact";
  if (v.includes("unresolved")) return "unresolved";
  if (v.includes("resolved") || v === "compiler") return "resolved";
  if (v.includes("cpg")) return "cpg-assisted";
  if (v.includes("framework")) return "convention-based";
  if (v.includes("convention")) return "convention-based";
  if (v.includes("structur")) return "structurally-inferred";
  if (v === "candidate") return "candidate";
  return "candidate";
}

export function toGuidedNode(item: QueryResultItem): GuidedNode {
  return {
    id: item.id,
    kind: classifyNodeKind(item.type, "symbol"),
    label: item.name,
    sublabel: item.qualifiedName,
    entityId: item.id,
    entityType: item.type,
    confidence: item.confidence,
    classification: classifyConfidence(undefined, item.classification),
    evidenceIds: [],
    actions: ["open-source", "show-impact", "add-to-context"],
  };
}

export function toGuidedEdge(rel: {
  id: string;
  sourceId: string;
  targetId: string;
  type: string;
  confidence: number;
  resolution?: string;
  evidenceIds: string[];
}): GuidedEdge {
  return {
    id: rel.id,
    source: rel.sourceId,
    target: rel.targetId,
    interaction: classifyInteraction(rel.type),
    label: rel.type.replace("keystone.core.", ""),
    confidence: rel.confidence,
    classification: classifyConfidence(rel.resolution, undefined),
    evidenceIds: rel.evidenceIds,
    dashed: rel.resolution === "unresolved" || rel.resolution === "candidate",
  };
}

export function buildContextCandidates(items: QueryResultItem[]): ContextCandidate[] {
  return items.slice(0, 12).map((item) => ({
    id: item.id,
    kind: item.type,
    label: item.name,
    entityId: item.id,
    reason: `Detected ${item.type} with ${(item.confidence * 100).toFixed(0)}% confidence.`,
    confidence: item.confidence,
  }));
}

/** Map a query result into a canonical diagram for the requested guided view. */
export function buildDiagramForResult(request: GuidedRequest, result: IntelligenceQueryResult): GuidedDiagram {
  const items = result.data?.items ?? [];
  const nodes: GuidedNode[] = items.map(toGuidedNode);
  const edges: GuidedEdge[] = (result.data?.relationships ?? []).map((rel) =>
    toGuidedEdge({
      id: rel.id,
      sourceId: rel.sourceId,
      targetId: rel.targetId,
      type: rel.type,
      confidence: rel.confidence,
      resolution: rel.resolution,
      evidenceIds: rel.evidenceIds,
    }),
  );
  const isFlow = request.view === "flows" || request.view === "messaging";
  const kind = isFlow ? "ordered-flow" : request.view === "systems" ? "system-landscape" : "component-architecture";
  const orientation = isFlow
    ? request.orientation ?? (request.action === "startup" ? "top-to-bottom" : "left-to-right")
    : undefined;
  const steps: GuidedStep[] = (result.data?.paths ?? []).flatMap((path) =>
    path.steps.map((step, idx) => ({
      index: idx,
      nodeId: step.entityId,
      edgeId: step.relationshipId,
      boundary: step.capabilityBoundary,
      summary: step.entityName,
    })),
  );
  return {
    kind: DiagramKindSchema.parse(kind),
    ...(orientation ? { orientation: FlowOrientationSchema.parse(orientation) } : {}),
    nodes,
    edges,
    containers: [],
    steps,
    legend: legendFor(kind),
  };
}

export function legendFor(kind: string): GuidedDiagram["legend"] {
  if (kind === "ordered-flow" || kind === "swimlane-flow" || kind === "sequence-diagram") {
    return [
      { kind: "actor", label: "Actor / entry point" },
      { kind: "service", label: "Service / module" },
      { kind: "handler", label: "Handler" },
      { kind: "database", label: "Database / table" },
      { kind: "broker", label: "Broker / queue" },
      { kind: "error", label: "Error / fallback" },
      { kind: "unresolved", label: "Inferred / unresolved" },
    ];
  }
  return [
    { kind: "application", label: "Application" },
    { kind: "service", label: "Service" },
    { kind: "database", label: "Database" },
    { kind: "broker", label: "Message broker" },
    { kind: "external-api", label: "External API" },
    { kind: "library", label: "Library" },
  ];
}
