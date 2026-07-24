import { z } from "zod";
import { QueryResultItemSchema, QueryPathSchema, EvidenceSummarySchema } from "./query";

/**
 * Canonical guided-intelligence envelope.
 *
 * The guided experience never invents facts: every field is derived from the
 * existing Intelligence snapshot, semantic graph, CPG, architecture projection,
 * messaging/route/schema extraction, security/performance services and OKF. The
 * orchestration service (`IntelligenceOrchestrationService`) is a facade over
 * those backends and returns ONE canonical result per user action.
 */

export const IntelligenceSubmenuSchema = z.enum([
  "overview",
  "systems",
  "architecture",
  "flows",
  "messaging",
  "apis",
  "data",
  "dependencies",
  "code",
  "tests",
  "impact",
  "security",
  "performance",
  "okf",
  "explore",
  "ask",
]);
export type IntelligenceSubmenu = z.infer<typeof IntelligenceSubmenuSchema>;

export const DiagramKindSchema = z.enum([
  "system-landscape",
  "component-architecture",
  "dependency-graph",
  "ordered-flow",
  "swimlane-flow",
  "sequence-diagram",
  "entity-relationship",
  "data-access",
  "transaction-diagram",
]);
export type DiagramKind = z.infer<typeof DiagramKindSchema>;

export const FlowOrientationSchema = z.enum(["left-to-right", "top-to-bottom", "swimlanes"]);
export type FlowOrientation = z.infer<typeof FlowOrientationSchema>;

export const NodeKindSchema = z.enum([
  "repository",
  "system",
  "application",
  "service",
  "worker",
  "scheduled-job",
  "library",
  "database",
  "cache",
  "broker",
  "topic",
  "queue",
  "external-api",
  "infrastructure",
  "module",
  "layer",
  "file",
  "symbol",
  "route",
  "message",
  "entity",
  "table",
  "actor",
  "handler",
  "transformation",
  "validation",
  "condition",
  "error",
  "test",
  "unresolved",
]);
export type NodeKind = z.infer<typeof NodeKindSchema>;

export const EdgeInteractionSchema = z.enum([
  "http-request",
  "rpc",
  "method-call",
  "event-publish",
  "event-subscribe",
  "queue-send",
  "queue-receive",
  "database-read",
  "database-write",
  "cache-read",
  "cache-write",
  "file-access",
  "configuration-dependency",
  "contains",
  "depends-on",
  "calls",
  "imports",
  "foreign-key",
  "flow-step",
  "response",
  "async-boundary",
]);
export type EdgeInteraction = z.infer<typeof EdgeInteractionSchema>;

export const ConfidenceCategorySchema = z.enum([
  "exact",
  "resolved",
  "structurally-inferred",
  "convention-based",
  "cpg-assisted",
  "candidate",
  "unresolved",
]);
export type ConfidenceCategory = z.infer<typeof ConfidenceCategorySchema>;

export const GuidedNodeSchema = z
  .object({
    id: z.string().min(1),
    kind: NodeKindSchema,
    label: z.string().min(1),
    sublabel: z.string().optional(),
    entityId: z.string().optional(),
    entityType: z.string().optional(),
    confidence: z.number().min(0).max(1),
    classification: ConfidenceCategorySchema,
    evidenceIds: z.array(z.string()).max(40).default([]),
    containerId: z.string().optional(),
    actions: z.array(z.string()).max(20).default([]),
    details: z.record(z.string(), z.union([z.string(), z.number(), z.boolean()])).optional(),
  })
  .strict();
export type GuidedNode = z.infer<typeof GuidedNodeSchema>;

export const GuidedEdgeSchema = z
  .object({
    id: z.string().min(1),
    source: z.string().min(1),
    target: z.string().min(1),
    interaction: EdgeInteractionSchema,
    label: z.string().optional(),
    operation: z.string().optional(),
    protocol: z.string().optional(),
    confidence: z.number().min(0).max(1),
    classification: ConfidenceCategorySchema,
    evidenceIds: z.array(z.string()).max(40).default([]),
    dashed: z.boolean().default(false),
  })
  .strict();
export type GuidedEdge = z.infer<typeof GuidedEdgeSchema>;

export const GuidedContainerSchema = z
  .object({
    id: z.string().min(1),
    kind: NodeKindSchema,
    label: z.string().min(1),
    parentId: z.string().optional(),
  })
  .strict();
export type GuidedContainer = z.infer<typeof GuidedContainerSchema>;

export const GuidedStepSchema = z
  .object({
    index: z.number().int().nonnegative(),
    nodeId: z.string().min(1),
    edgeId: z.string().optional(),
    boundary: z.string().optional(),
    summary: z.string().optional(),
  })
  .strict();
export type GuidedStep = z.infer<typeof GuidedStepSchema>;

export const GuidedDiagramSchema = z
  .object({
    kind: DiagramKindSchema,
    orientation: FlowOrientationSchema.optional(),
    nodes: z.array(GuidedNodeSchema).max(800),
    edges: z.array(GuidedEdgeSchema).max(2000),
    containers: z.array(GuidedContainerSchema).max(200).default([]),
    steps: z.array(GuidedStepSchema).max(200).default([]),
    legend: z.array(z.object({ kind: NodeKindSchema, label: z.string() }).strict()).max(40).default([]),
  })
  .strict();
export type GuidedDiagram = z.infer<typeof GuidedDiagramSchema>;

export const OrientationCrumbSchema = z
  .object({
    level: z.string().min(1),
    label: z.string().min(1),
    target: z
      .object({ submenu: IntelligenceSubmenuSchema, entityId: z.string().optional() })
      .strict()
      .optional(),
  })
  .strict();
export type OrientationCrumb = z.infer<typeof OrientationCrumbSchema>;

export const GuidedFollowUpSchema = z
  .object({
    label: z.string().min(1),
    action: z.string().min(1),
    payload: z.record(z.string(), z.union([z.string(), z.number(), z.boolean()])).optional(),
  })
  .strict();
export type GuidedFollowUp = z.infer<typeof GuidedFollowUpSchema>;

export const ContextCandidateSchema = z
  .object({
    id: z.string().min(1),
    kind: z.string().min(1),
    label: z.string().min(1),
    entityId: z.string().optional(),
    reason: z.string().min(1),
    confidence: z.number().min(0).max(1),
    estimatedTokens: z.number().int().nonnegative().optional(),
  })
  .strict();
export type ContextCandidate = z.infer<typeof ContextCandidateSchema>;

export const GuidedResultSchema = z
  .object({
    view: IntelligenceSubmenuSchema,
    title: z.string().min(1),
    answer: z.string().min(1),
    entities: z.array(QueryResultItemSchema).max(200).default([]),
    diagram: GuidedDiagramSchema.optional(),
    flowPaths: z.array(QueryPathSchema).max(20).default([]),
    evidence: z.array(EvidenceSummarySchema).max(100).default([]),
    confidence: z.number().min(0).max(1).default(0),
    limitations: z.array(z.string()).max(20).default([]),
    diagnostics: z.array(z.string()).max(20).default([]),
    orientation: z.array(OrientationCrumbSchema).max(12).default([]),
    followUps: z.array(GuidedFollowUpSchema).max(24).default([]),
    contextCandidates: z.array(ContextCandidateSchema).max(60).default([]),
    generation: z.number().int().nonnegative(),
  })
  .strict();
export type GuidedResult = z.infer<typeof GuidedResultSchema>;

export const GuidedRequestSchema = z
  .object({
    view: IntelligenceSubmenuSchema,
    action: z.string().min(1).max(80),
    entityId: z.string().optional(),
    entityValue: z.string().optional(),
    orientation: FlowOrientationSchema.optional(),
    limits: z
      .object({ depth: z.number().int().min(1).max(20).default(4), results: z.number().int().min(1).max(100).default(40) })
      .strict()
      .optional(),
  })
  .strict();
export type GuidedRequest = z.infer<typeof GuidedRequestSchema>;

export const GuidedContextSelectionSchema = z
  .object({
    items: z.array(ContextCandidateSchema).max(60),
    workflowId: z.string().optional(),
    workItemId: z.string().optional(),
  })
  .strict();
export type GuidedContextSelection = z.infer<typeof GuidedContextSelectionSchema>;
