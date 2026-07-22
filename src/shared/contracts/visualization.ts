/**
 * Canonical visualization model for Keystone Phase 4 — Intelligence Visualization.
 *
 * These schemas are the single renderer-independent source of truth for the
 * Intelligence Explorer canvas. They are produced deterministically from the
 * existing local Intelligence snapshot (files, symbols, relationships, evidence,
 * CPG records) and the existing query results. No LLM is involved.
 *
 * The model deliberately separates:
 *  - the visualization data (nodes / edges / groups / warnings / metrics)
 *  - the view request (scope, filters, traversal, layout)
 *  - the visualization state (selection, expanded, hidden, highlighted)
 *  - persisted views (saved views, snapshots, local feedback)
 *  - workflow/context integration (workflow association, context candidates)
 *
 * Rendering libraries remain replaceable behind this abstraction.
 */
import { z } from "zod";

// ---------------------------------------------------------------------------
// Enum vocabularies (mirrors spec §5)
// ---------------------------------------------------------------------------

export const IntelligenceViewTypeSchema = z.enum([
  "architecture",
  "dependencies",
  "calls",
  "flow",
  "data",
  "tests",
  "impact",
  "evidence",
  "schema",
  "technology",
]);
export type IntelligenceViewType = z.infer<typeof IntelligenceViewTypeSchema>;

export const IntelligenceNodeKindSchema = z.enum([
  "repository",
  "package",
  "module",
  "directory",
  "file",
  "class",
  "interface",
  "function",
  "method",
  "route",
  "event",
  "job",
  "database",
  "table",
  "entity",
  "external-service",
  "test-file",
  "test-case",
  "fixture",
  "configuration",
  "unknown",
]);
export type IntelligenceNodeKind = z.infer<typeof IntelligenceNodeKindSchema>;

export const IntelligenceRelationshipSchema = z.enum([
  "contains",
  "imports",
  "depends-on",
  "calls",
  "returns-to",
  "reads",
  "writes",
  "publishes",
  "subscribes",
  "routes-to",
  "maps-to",
  "tests",
  "covers",
  "inherits",
  "implements",
  "uses",
  "configures",
  "impacts",
  "defines-technology",
  "uses-technology",
  "foreign-key",
  "db-table-has-column",
  "orm-has-field",
  "migration-applies",
  "route-exposes",
  "unknown",
]);
export type IntelligenceRelationship = z.infer<typeof IntelligenceRelationshipSchema>;

export const IntelligenceGroupingBasisSchema = z.enum([
  "declared",
  "derived",
  "inferred",
  "unresolved",
]);
export type IntelligenceGroupingBasis = z.infer<typeof IntelligenceGroupingBasisSchema>;

export const IntelligenceConfidenceCategorySchema = z.enum([
  "proven",
  "structural",
  "inferred",
  "unresolved",
]);
export type IntelligenceConfidenceCategory = z.infer<typeof IntelligenceConfidenceCategorySchema>;

export const TraversalDirectionSchema = z.enum(["inbound", "outbound", "both"]);
export type TraversalDirection = z.infer<typeof TraversalDirectionSchema>;

export const ImpactCategorySchema = z.enum([
  "direct-caller",
  "direct-dependent",
  "transitive-dependent",
  "contract-consumer",
  "data-consumer",
  "flow-participant",
  "mapped-test",
  "configuration-consumer",
  "unresolved-possible-impact",
]);
export type ImpactCategory = z.infer<typeof ImpactCategorySchema>;

// ---------------------------------------------------------------------------
// Node / Edge / Group
// ---------------------------------------------------------------------------

export const IntelligenceVisualNodeSchema = z
  .object({
    id: z.string().min(1).max(500),
    entityId: z.string().min(1).max(500),
    kind: IntelligenceNodeKindSchema,
    label: z.string().min(1).max(500),
    secondaryLabel: z.string().max(500).optional(),
    description: z.string().max(4000).optional(),
    source: z
      .object({
        filePath: z.string().max(1024).optional(),
        startLine: z.number().int().nonnegative().optional(),
        endLine: z.number().int().nonnegative().optional(),
        symbolId: z.string().max(500).optional(),
      })
      .strict()
      .optional(),
    confidence: z.number().min(0).max(1),
    evidenceIds: z.array(z.string().min(1).max(500)).max(200),
    state: z
      .object({
        selected: z.boolean(),
        expanded: z.boolean(),
        highlighted: z.boolean(),
        changed: z.boolean(),
        impacted: z.boolean(),
        unresolved: z.boolean(),
        stale: z.boolean(),
      })
      .strict(),
    metrics: z.record(z.string(), z.union([z.string(), z.number(), z.boolean()])).optional(),
    // Layout hint (manual positions preserved only as view metadata).
    layout: z.object({ x: z.number(), y: z.number() }).strict().optional(),
  })
  .strict();
export type IntelligenceVisualNode = z.infer<typeof IntelligenceVisualNodeSchema>;

export const IntelligenceVisualEdgeSchema = z
  .object({
    id: z.string().min(1).max(500),
    sourceNodeId: z.string().min(1).max(500),
    targetNodeId: z.string().min(1).max(500),
    relationship: IntelligenceRelationshipSchema,
    direction: z.enum(["forward", "reverse", "bidirectional"]),
    confidence: z.number().min(0).max(1),
    evidenceIds: z.array(z.string().min(1).max(500)).max(200),
    // Confidence category for visual semantics (see spec §24). Distinguishes
    // proven data flow from structural association / inferred / unresolved.
    confidenceCategory: IntelligenceConfidenceCategorySchema.optional(),
    // Optional typed payload for security / data-flow overlays (Phase 5+).
    overlay: z
      .object({
        kind: z.enum(["source", "sanitizer", "sink", "sensitive-data"]),
        note: z.string().max(500).optional(),
      })
      .strict()
      .optional(),
    state: z
      .object({
        highlighted: z.boolean(),
        inferred: z.boolean(),
        unresolved: z.boolean(),
        collapsed: z.boolean(),
      })
      .strict(),
    metrics: z.record(z.string(), z.union([z.string(), z.number(), z.boolean()])).optional(),
  })
  .strict();
export type IntelligenceVisualEdge = z.infer<typeof IntelligenceVisualEdgeSchema>;

export const IntelligenceVisualGroupSchema = z
  .object({
    id: z.string().min(1).max(500),
    label: z.string().min(1).max(500),
    kind: IntelligenceNodeKindSchema,
    basis: IntelligenceGroupingBasisSchema,
    childNodeIds: z.array(z.string().min(1).max(500)).max(2000),
    collapsed: z.boolean(),
    description: z.string().max(2000).optional(),
  })
  .strict();
export type IntelligenceVisualGroup = z.infer<typeof IntelligenceVisualGroupSchema>;

export const IntelligenceVisualWarningSchema = z
  .object({
    code: z.enum([
      "truncated",
      "node-limit",
      "edge-limit",
      "depth-limit",
      "incomplete-intelligence",
      "unresolved-relationship",
      "low-confidence",
      "stale-view",
      "cancelled",
    ]),
    severity: z.enum(["info", "warning", "error"]),
    message: z.string().min(1).max(2000),
    // What was omitted, why, and how to refine.
    omitted: z.string().min(1).max(2000).default(""),
    refineHint: z.string().min(1).max(2000).default(""),
  })
  .strict();
export type IntelligenceVisualWarning = z.infer<typeof IntelligenceVisualWarningSchema>;

// ---------------------------------------------------------------------------
// Evidence summary (renderer-friendly; raw records behind an advanced view)
// ---------------------------------------------------------------------------

export const VisualizationEvidenceSchema = z
  .object({
    id: z.string().min(1).max(500),
    subjectId: z.string().min(1).max(500),
    sourceKind: z
      .enum([
        "workspace-inventory",
        "source-file",
        "language-provider",
        "typescript-compiler",
        "framework-rule",
        "manifest",
        "configuration",
        "adapter",
        "documentation",
        "schema",
        "database",
        "ci",
        "infrastructure",
      ])
      .optional(),
    relativePath: z.string().max(1024),
    range: z
      .object({
        startLine: z.number().int().nonnegative(),
        startColumn: z.number().int().nonnegative(),
        endLine: z.number().int().nonnegative(),
        endColumn: z.number().int().nonnegative(),
      })
      .strict()
      .optional(),
    parserId: z.string().max(200).optional(),
    parserVersion: z.string().max(200).optional(),
    derivation: z.enum([
      "extracted",
      "resolved",
      "calculated",
      "framework-rule",
      "runtime-observed",
      "user-asserted",
    ]),
    confidence: z.number().min(0).max(1),
    statement: z.string().min(1).max(4000),
    // Local user feedback applied to this evidence (see feedback contract).
    feedback: z.enum(["rejected", "confirmed", "hidden"]).optional(),
  })
  .strict();
export type VisualizationEvidence = z.infer<typeof VisualizationEvidenceSchema>;

// ---------------------------------------------------------------------------
// Metrics / metadata
// ---------------------------------------------------------------------------

export const IntelligenceVisualizationMetricsSchema = z
  .object({
    nodeCount: z.number().int().nonnegative(),
    edgeCount: z.number().int().nonnegative(),
    hiddenNodeCount: z.number().int().nonnegative(),
    unresolvedEdgeCount: z.number().int().nonnegative(),
    lowConfidenceEdgeCount: z.number().int().nonnegative(),
    truncated: z.boolean(),
  })
  .strict();
export type IntelligenceVisualizationMetrics = z.infer<
  typeof IntelligenceVisualizationMetricsSchema
>;

export const IntelligenceVisualizationMetadataSchema = z
  .object({
    generatedAt: z.string().datetime(),
    contentHash: z.string().min(1).max(256),
    truncated: z.boolean(),
    generation: z.number().int().nonnegative().optional(),
    repositoryRevision: z.string().max(200).optional(),
    intelligenceRevision: z.string().max(200).optional(),
  })
  .strict();
export type IntelligenceVisualizationMetadata = z.infer<
  typeof IntelligenceVisualizationMetadataSchema
>;

// ---------------------------------------------------------------------------
// Scope / Filters / Layout
// ---------------------------------------------------------------------------

export const IntelligenceVisualizationScopeSchema = z
  .object({
    rootEntityIds: z.array(z.string().min(1).max(500)).max(50),
    repositoryRevision: z.string().max(200).optional(),
    intelligenceRevision: z.string().max(200).optional(),
    // Optional workflow association (spec §18).
    workflowId: z.string().max(200).optional(),
    stageId: z.string().max(200).optional(),
    workItemId: z.string().max(200).optional(),
    changedEntityIds: z.array(z.string().min(1).max(500)).max(200).optional(),
  })
  .strict();
export type IntelligenceVisualizationScope = z.infer<typeof IntelligenceVisualizationScopeSchema>;

export const IntelligenceVisualizationFiltersSchema = z
  .object({
    entityTypes: z.array(IntelligenceNodeKindSchema).max(30).optional(),
    relationshipTypes: z.array(IntelligenceRelationshipSchema).max(30).optional(),
    productionOnly: z.boolean().optional(),
    testsOnly: z.boolean().optional(),
    generatedExcluded: z.boolean().optional(),
    externalDependenciesExcluded: z.boolean().optional(),
    confidenceAtLeast: z.number().min(0).max(1).default(0),
    inferredExcluded: z.boolean().optional(),
    unresolvedExcluded: z.boolean().optional(),
    changedOnly: z.boolean().optional(),
    impactedOnly: z.boolean().optional(),
    packageIds: z.array(z.string().min(1).max(200)).max(30).optional(),
    moduleIds: z.array(z.string().min(1).max(200)).max(30).optional(),
  })
  .strict();
export type IntelligenceVisualizationFilters = z.infer<
  typeof IntelligenceVisualizationFiltersSchema
>;

export const LayoutStrategySchema = z.enum([
  "hierarchical",
  "layered",
  "force-directed",
  "left-to-right",
  "radial",
  "grouped",
  "auto",
]);
export type LayoutStrategy = z.infer<typeof LayoutStrategySchema>;

export const IntelligenceVisualizationLayoutSchema = z
  .object({
    strategy: LayoutStrategySchema,
    fitToView: z.boolean().default(true),
  })
  .strict();
export type IntelligenceVisualizationLayout = z.infer<typeof IntelligenceVisualizationLayoutSchema>;

export const IntelligenceVisualizationStateSchema = z
  .object({
    selectedNodeIds: z.array(z.string().min(1).max(500)).max(200),
    expandedNodeIds: z.array(z.string().min(1).max(500)).max(2000),
    hiddenNodeIds: z.array(z.string().min(1).max(500)).max(2000),
    highlightedEdgeIds: z.array(z.string().min(1).max(500)).max(2000),
    highlightedPathNodeIds: z.array(z.string().min(1).max(500)).max(2000).optional(),
  })
  .strict();
export type IntelligenceVisualizationState = z.infer<typeof IntelligenceVisualizationStateSchema>;

// ---------------------------------------------------------------------------
// The canonical model
// ---------------------------------------------------------------------------

export const IntelligenceVisualizationSchema = z
  .object({
    id: z.string().min(1).max(500),
    viewType: IntelligenceViewTypeSchema,
    title: z.string().min(1).max(500),
    scope: IntelligenceVisualizationScopeSchema,
    // Traversal + filter state needed to reproduce / restore a view (spec §16, §20).
    filters: IntelligenceVisualizationFiltersSchema,
    direction: TraversalDirectionSchema,
    maxDepth: z.number().int().min(1).max(10),
    nodes: z.array(IntelligenceVisualNodeSchema).max(5000),
    edges: z.array(IntelligenceVisualEdgeSchema).max(8000),
    groups: z.array(IntelligenceVisualGroupSchema).max(500),
    warnings: z.array(IntelligenceVisualWarningSchema).max(50),
    metrics: IntelligenceVisualizationMetricsSchema,
    state: IntelligenceVisualizationStateSchema,
    layout: IntelligenceVisualizationLayoutSchema,
    metadata: IntelligenceVisualizationMetadataSchema,
  })
  .strict();
export type IntelligenceVisualization = z.infer<typeof IntelligenceVisualizationSchema>;

// ---------------------------------------------------------------------------
// View request (webview -> host)
// ---------------------------------------------------------------------------

export const EntitySelectorSchema = z
  .object({
    id: z.string().min(1).max(500).optional(),
    value: z.string().min(1).max(512).optional(),
    kind: z
      .enum(["stable-id", "qualified-name", "name", "path", "route", "database", "package"])
      .default("name"),
    entityTypes: z.array(IntelligenceNodeKindSchema).max(20).optional(),
  })
  .strict()
  .refine((value) => Boolean(value.id || value.value), {
    message: "An entity selector requires an id or value.",
  });
export type EntitySelector = z.infer<typeof EntitySelectorSchema>;

export const EvidenceRequestSchema = z
  .object({
    evidenceId: z.string().min(1).max(500),
  })
  .strict();
export type EvidenceRequest = z.infer<typeof EvidenceRequestSchema>;

export const IntelligenceVisualizationRequestSchema = z
  .object({
    viewType: IntelligenceViewTypeSchema,
    seeds: z.array(EntitySelectorSchema).max(20).optional(),
    scope: IntelligenceVisualizationScopeSchema.optional(),
    filters: IntelligenceVisualizationFiltersSchema.optional(),
    direction: TraversalDirectionSchema.default("both"),
    maxDepth: z.number().int().min(1).max(10).default(2),
    layout: IntelligenceVisualizationLayoutSchema.optional(),
    limitOverrides: z
      .object({
        maxNodes: z.number().int().min(1).max(5000).optional(),
        maxEdges: z.number().int().min(1).max(8000).optional(),
        startStrategy: LayoutStrategySchema.optional(),
      })
      .strict()
      .optional(),
    // Reuse an existing intelligence query result (avoid rebuild when possible).
    reuseQueryResultId: z.string().uuid().optional(),
  })
  .strict();
export type IntelligenceVisualizationRequest = z.infer<
  typeof IntelligenceVisualizationRequestSchema
>;

// ---------------------------------------------------------------------------
// Saved views (spec §20) and snapshots (spec §21)
// ---------------------------------------------------------------------------

export const SavedIntelligenceViewSchema = z
  .object({
    id: z.string().uuid(),
    name: z.string().min(1).max(200),
    viewType: IntelligenceViewTypeSchema,
    rootEntityIds: z.array(z.string().min(1).max(500)).max(50),
    filters: IntelligenceVisualizationFiltersSchema,
    direction: TraversalDirectionSchema,
    maxDepth: z.number().int().min(1).max(10),
    expandedNodeIds: z.array(z.string().min(1).max(500)).max(2000),
    hiddenNodeIds: z.array(z.string().min(1).max(500)).max(2000),
    highlightedPathNodeIds: z.array(z.string().min(1).max(500)).max(2000).optional(),
    layoutStrategy: LayoutStrategySchema.optional(),
    layoutPositions: z.record(z.string(), z.object({ x: z.number(), y: z.number() })).optional(),
    repositoryRevision: z.string().max(200).optional(),
    intelligenceRevision: z.string().max(200).optional(),
    workflowId: z.string().max(200).optional(),
    // Materialization hash of the referenced intelligence at save time.
    sourceFingerprint: z.string().min(1).max(256),
    // When the live intelligence fingerprint diverges, the view is stale.
    stale: z.boolean().default(false),
    createdAt: z.string().datetime(),
    updatedAt: z.string().datetime(),
  })
  .strict();
export type SavedIntelligenceView = z.infer<typeof SavedIntelligenceViewSchema>;

export const VisualizationSnapshotSchema = z
  .object({
    id: z.string().uuid(),
    title: z.string().min(1).max(500),
    viewType: IntelligenceViewTypeSchema,
    // Structured, reopenable reference (not a large rendered image).
    selectedEntityIds: z.array(z.string().min(1).max(500)).max(200),
    visibleRelationshipTypes: z.array(IntelligenceRelationshipSchema).max(30),
    filters: IntelligenceVisualizationFiltersSchema,
    layoutStrategy: LayoutStrategySchema.optional(),
    layoutPositions: z.record(z.string(), z.object({ x: z.number(), y: z.number() })).optional(),
    intelligenceRevision: z.string().max(200),
    evidenceIds: z.array(z.string().min(1).max(500)).max(200),
    // Optional lightweight preview image path (only if practical).
    previewImagePath: z.string().max(1024).optional(),
    workflowId: z.string().max(200).optional(),
    stageId: z.string().max(200).optional(),
    createdAt: z.string().datetime(),
  })
  .strict();
export type VisualizationSnapshot = z.infer<typeof VisualizationSnapshotSchema>;

// ---------------------------------------------------------------------------
// Local feedback (spec §28) — visualization overrides only, never mutated source
// ---------------------------------------------------------------------------

export const VisualizationFeedbackSchema = z
  .object({
    id: z.string().uuid(),
    // Either an edge or an evidence record is the subject.
    targetKind: z.enum(["edge", "evidence", "grouping"]),
    targetId: z.string().min(1).max(500),
    action: z.enum(["reject", "confirm", "hide", "mark-misleading"]),
    note: z.string().max(2000).optional(),
    createdAt: z.string().datetime(),
  })
  .strict();
export type VisualizationFeedback = z.infer<typeof VisualizationFeedbackSchema>;

// ---------------------------------------------------------------------------
// Context-package integration (spec §19) — typed candidates, not raw canvas text
// ---------------------------------------------------------------------------

export const VisualizationContextCandidateSchema = z
  .object({
    candidateType: z.enum([
      "symbol-signature",
      "flow-compressed",
      "module-summary",
      "test-relationship",
      "evidence-reference",
      "data-flow",
      "dependency",
      "file",
    ]),
    title: z.string().min(1).max(500),
    sourceType: z.enum([
      "symbol",
      "call-flow",
      "data-flow",
      "dependency",
      "test",
      "repository-file",
      "evidence",
    ]),
    sourceReference: z
      .object({
        filePath: z.string().max(1024).optional(),
        symbolId: z.string().max(500).optional(),
        entityId: z.string().max(500).optional(),
        evidenceId: z.string().max(500).optional(),
        flowId: z.string().max(500).optional(),
        revision: z.string().max(200).optional(),
        startLine: z.number().int().nonnegative().optional(),
        endLine: z.number().int().nonnegative().optional(),
      })
      .strict(),
    content: z.string().min(1).max(40000),
    confidence: z.number().min(0).max(1),
    reasons: z.array(z.string().min(1).max(1000)).max(20),
  })
  .strict();
export type VisualizationContextCandidate = z.infer<typeof VisualizationContextCandidateSchema>;

export const VisualizationContextRequestSchema = z
  .object({
    workflowId: z.string().min(1).max(200),
    stageId: z.string().min(1).max(200),
    workItemId: z.string().uuid().optional(),
    candidates: z.array(VisualizationContextCandidateSchema).min(1).max(100),
  })
  .strict();
export type VisualizationContextRequest = z.infer<typeof VisualizationContextRequestSchema>;
