/**
 * VisualizationModelBuilder — deterministic assembly of the canonical
 * IntelligenceVisualization model from a built set of nodes/edges/groups.
 *
 * Responsibilities (spec §5, §16, §22):
 *  - assign stable ids, normalize node/edge kinds and confidence categories
 *  - compute metrics (counts, hidden, unresolved, low-confidence)
 *  - apply filters and produce disclosure when nodes/edges are hidden
 *  - compute a content hash for change-detection / saved-view staleness
 *  - cap nodes/edges with explicit truncation warnings
 *
 * This is renderer-independent and does NOT touch any graph-rendering package.
 */
import type {
  IntelligenceVisualization,
  IntelligenceVisualNode,
  IntelligenceVisualEdge,
  IntelligenceVisualGroup,
  IntelligenceVisualWarning,
  IntelligenceVisualizationMetrics,
  IntelligenceVisualizationRequest,
  IntelligenceVisualizationFilters,
  IntelligenceVisualizationState,
  IntelligenceViewType,
  IntelligenceNodeKind,
  IntelligenceRelationship,
} from "../../../shared/contracts/visualization";
import { IntelligenceVisualizationSchema } from "../../../shared/contracts/visualization";
import { DEFAULT_PERFORMANCE } from "./VisualizationDefaults";
import { isLowConfidence } from "./mapping";

export interface BuildInput {
  viewType: IntelligenceViewType;
  title: string;
  rootEntityIds: string[];
  request: IntelligenceVisualizationRequest;
  nodes: IntelligenceVisualNode[];
  edges: IntelligenceVisualEdge[];
  groups: IntelligenceVisualGroup[];
  repositoryRevision?: string;
  intelligenceRevision?: string;
  workflowId?: string;
  stageId?: string;
  workItemId?: string;
  changedEntityIds?: string[];
}

function fnv1a(input: string): string {
  let hash = 0x811c9dc5;
  for (let i = 0; i < input.length; i += 1) {
    hash ^= input.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(16).padStart(8, "0");
}

export class VisualizationModelBuilder {
  static build(input: BuildInput): IntelligenceVisualization {
    const filters = (input.request.filters ?? {}) as IntelligenceVisualizationFilters;
    const maxNodes =
      input.request.limitOverrides?.maxNodes ??
      (input.viewType === "architecture"
        ? DEFAULT_PERFORMANCE.initialArchitectureNodes
        : DEFAULT_PERFORMANCE.initialDetailedNodes);
    const maxEdges =
      input.request.limitOverrides?.maxEdges ?? DEFAULT_PERFORMANCE.initialDetailedEdges;

    const warnings: IntelligenceVisualWarning[] = [];

    // --- Apply filters (operate on the model, not unrelated UI state) ---
    const filtered = VisualizationModelBuilder.applyFilters(
      input.nodes,
      input.edges,
      filters,
      warnings,
    );

    // --- Node / edge caps (truncation) ---
    let visibleNodes = filtered.nodes;
    let truncated = false;
    if (visibleNodes.length > maxNodes) {
      truncated = true;
      const kept = visibleNodes.slice(0, maxNodes);
      const omittedCount = visibleNodes.length - kept.length;
      warnings.push({
        code: "node-limit",
        severity: "warning",
        message: `Node limit reached: showing ${maxNodes} of ${visibleNodes.length} candidate nodes.`,
        omitted: `${omittedCount} nodes were not rendered.`,
        refineHint:
          "Narrow the scope (fewer root entities or deeper filtering) or expand a selected branch progressively.",
      });
      visibleNodes = kept;
    }
    const visibleNodeIds = new Set(visibleNodes.map((n) => n.id));
    let visibleEdges = filtered.edges.filter(
      (e) => visibleNodeIds.has(e.sourceNodeId) && visibleNodeIds.has(e.targetNodeId),
    );
    if (visibleEdges.length > maxEdges) {
      truncated = true;
      const omitted = visibleEdges.length - maxEdges;
      warnings.push({
        code: "edge-limit",
        severity: "info",
        message: `Edge limit reached: showing ${maxEdges} of ${visibleEdges.length} candidate edges.`,
        omitted: `${omitted} edges were not rendered.`,
        refineHint: "Increase maxEdges via limitOverrides, or filter relationship types.",
      });
      visibleEdges = visibleEdges.slice(0, maxEdges);
    }

    // --- Hard visible-node warning (spec §22) ---
    if (visibleNodes.length > DEFAULT_PERFORMANCE.hardVisibleNodeWarning) {
      warnings.push({
        code: "truncated",
        severity: "warning",
        message: `Large graph: ${visibleNodes.length} visible nodes exceeds the ${DEFAULT_PERFORMANCE.hardVisibleNodeWarning}-node warning threshold.`,
        omitted: "",
        refineHint:
          "Use grouping, filters, or reduce traversal depth to keep the canvas responsive.",
      });
    }

    // --- Hard depth warning if requested depth was clamped ---
    const maxDepth =
      input.request.maxDepth > DEFAULT_PERFORMANCE.maxInteractiveDepth
        ? DEFAULT_PERFORMANCE.maxInteractiveDepth
        : input.request.maxDepth;
    if (input.request.maxDepth > DEFAULT_PERFORMANCE.maxInteractiveDepth) {
      warnings.push({
        code: "depth-limit",
        severity: "info",
        message: `Traversal depth clamped from ${input.request.maxDepth} to ${DEFAULT_PERFORMANCE.maxInteractiveDepth}.`,
        omitted: "",
        refineHint: "Expand individual branches instead of raising the global depth.",
      });
    }

    // --- Metrics ---
    const hiddenNodeCount = input.nodes.length - filtered.nodes.length;
    const unresolvedEdgeCount = visibleEdges.filter((e) => e.state.unresolved).length;
    const lowConfidenceEdgeCount = visibleEdges.filter((e) => isLowConfidence(e.confidence)).length;

    const metrics: IntelligenceVisualizationMetrics = {
      nodeCount: visibleNodes.length,
      edgeCount: visibleEdges.length,
      hiddenNodeCount,
      unresolvedEdgeCount,
      lowConfidenceEdgeCount,
      truncated,
    };

    // --- Selection / expanded / highlighted state (preserved across views) ---
    const selected = new Set(input.request.scope?.rootEntityIds ?? []);
    const expanded = new Set(
      input.request.scope?.rootEntityIds ??
        (input.request as unknown as { expandedNodeIds?: string[] }).expandedNodeIds ??
        [],
    );
    const state: IntelligenceVisualizationState = {
      selectedNodeIds: visibleNodes.filter((n) => selected.has(n.entityId)).map((n) => n.id),
      expandedNodeIds: visibleNodes.filter((n) => expanded.has(n.entityId)).map((n) => n.id),
      hiddenNodeIds: [],
      highlightedEdgeIds: [],
    };

    const model: IntelligenceVisualization = {
      id: `viz:${input.viewType}:${fnv1a(JSON.stringify(input.rootEntityIds) + input.viewType + visibleNodes.length)}`,
      viewType: input.viewType,
      title: input.title,
      scope: {
        rootEntityIds: input.rootEntityIds,
        repositoryRevision: input.repositoryRevision,
        intelligenceRevision: input.intelligenceRevision,
        workflowId: input.workflowId,
        stageId: input.stageId,
        workItemId: input.workItemId,
        changedEntityIds: input.changedEntityIds,
      },
      nodes: visibleNodes,
      edges: visibleEdges,
      groups: input.groups,
      warnings,
      metrics,
      state,
      filters,
      direction: input.request.direction,
      maxDepth,
      layout: {
        strategy: input.request.limitOverrides?.startStrategy ?? "auto",
        fitToView: input.request.layout?.fitToView ?? true,
      },
      metadata: {
        generatedAt: new Date().toISOString(),
        contentHash: VisualizationModelBuilder.contentHash(
          visibleNodes,
          visibleEdges,
          input.intelligenceRevision ?? "",
        ),
        truncated,
        repositoryRevision: input.repositoryRevision,
        intelligenceRevision: input.intelligenceRevision,
      },
    };

    // Validate strict schema at the boundary.
    return IntelligenceVisualizationSchema.parse(model);
  }

  /** Filter nodes/edges per spec §16. Returns kept nodes + a disclosure. */
  static applyFilters(
    nodes: IntelligenceVisualNode[],
    edges: IntelligenceVisualEdge[],
    filters: IntelligenceVisualizationFilters,
    warnings: IntelligenceVisualWarning[],
  ): { nodes: IntelligenceVisualNode[]; edges: IntelligenceVisualEdge[] } {
    const entityTypes = filters.entityTypes;
    const relationshipTypes = filters.relationshipTypes;
    const confidenceAtLeast = filters.confidenceAtLeast ?? 0;

    let keptNodes = nodes;
    if (entityTypes && entityTypes.length > 0) {
      const set = new Set<IntelligenceNodeKind>(entityTypes);
      keptNodes = keptNodes.filter((n) => set.has(n.kind));
    }
    if (filters.productionOnly) {
      keptNodes = keptNodes.filter(
        (n) => n.kind !== "test-file" && n.kind !== "test-case" && n.kind !== "fixture",
      );
    }
    if (filters.testsOnly) {
      keptNodes = keptNodes.filter(
        (n) => n.kind === "test-file" || n.kind === "test-case" || n.kind === "fixture",
      );
    }
    if (filters.generatedExcluded) {
      keptNodes = keptNodes.filter((n) => !n.entityId.includes(":gen:"));
    }
    if (filters.externalDependenciesExcluded) {
      keptNodes = keptNodes.filter((n) => n.kind !== "external-service");
    }
    if (filters.packageIds && filters.packageIds.length > 0) {
      const set = new Set(filters.packageIds);
      keptNodes = keptNodes.filter((n) => set.has(n.metrics?.packageId as string));
    }
    if (filters.moduleIds && filters.moduleIds.length > 0) {
      const set = new Set(filters.moduleIds);
      keptNodes = keptNodes.filter((n) => set.has(n.metrics?.moduleId as string));
    }
    if (filters.changedOnly) {
      keptNodes = keptNodes.filter((n) => n.state.changed);
    }
    if (filters.impactedOnly) {
      keptNodes = keptNodes.filter((n) => n.state.impacted);
    }

    const keptNodeIds = new Set(keptNodes.map((n) => n.id));
    let keptEdges = edges.filter(
      (e) => keptNodeIds.has(e.sourceNodeId) && keptNodeIds.has(e.targetNodeId),
    );

    if (relationshipTypes && relationshipTypes.length > 0) {
      const set = new Set<IntelligenceRelationship>(relationshipTypes);
      keptEdges = keptEdges.filter((e) => set.has(e.relationship));
    }
    if (confidenceAtLeast > 0) {
      keptEdges = keptEdges.filter((e) => e.confidence >= confidenceAtLeast);
      keptNodes = keptNodes.filter((n) => n.confidence >= confidenceAtLeast);
    }
    if (filters.inferredExcluded) {
      keptEdges = keptEdges.filter((e) => !e.state.inferred);
    }
    if (filters.unresolvedExcluded) {
      keptEdges = keptEdges.filter((e) => !e.state.unresolved);
    }

    if (keptNodes.length < nodes.length) {
      warnings.push({
        code: "truncated",
        severity: "info",
        message: `Filters hid ${nodes.length - keptNodes.length} node(s).`,
        omitted: `${nodes.length - keptNodes.length} nodes hidden by active filters.`,
        refineHint: "Clear a filter to reveal hidden nodes.",
      });
    }

    return { nodes: keptNodes, edges: keptEdges };
  }

  /** Deterministic content hash used for saved-view staleness detection. */
  static contentHash(
    nodes: IntelligenceVisualNode[],
    edges: IntelligenceVisualEdge[],
    intelligenceRevision: string,
  ): string {
    const serialized = JSON.stringify({
      n: nodes.map((x) => [x.entityId, x.kind, x.confidence]),
      e: edges.map((x) => [x.sourceNodeId, x.targetNodeId, x.relationship]),
      r: intelligenceRevision,
    });
    return `sha256:${fnv1a(serialized)}:${fnv1a(serialized.split("").reverse().join(""))}`;
  }
}
