/**
 * Phase 4 performance defaults (spec §22).
 *
 * Explicit limits so large graphs are sliced and progressively expanded instead
 * of being fully loaded into the webview. All values are overridable per
 * request via `limitOverrides`.
 */
export interface VisualizationPerformanceDefaults {
  /** Initial architecture nodes before expansion. */
  initialArchitectureNodes: number;
  /** Initial detailed-graph nodes (calls/flow/data/tests/impact). */
  initialDetailedNodes: number;
  /** Hard warning threshold: if visible nodes exceed this, warn. */
  hardVisibleNodeWarning: number;
  /** Default traversal depth. */
  defaultTraversalDepth: number;
  /** Maximum interactive depth (bounded to keep UI responsive). */
  maxInteractiveDepth: number;
  /** Default edge cap. */
  initialDetailedEdges: number;
  /** Candidate cap for search results. */
  searchResultCap: number;
}

export const DEFAULT_PERFORMANCE: VisualizationPerformanceDefaults = {
  initialArchitectureNodes: 100,
  initialDetailedNodes: 150,
  hardVisibleNodeWarning: 300,
  defaultTraversalDepth: 2,
  maxInteractiveDepth: 6,
  initialDetailedEdges: 400,
  searchResultCap: 50,
};

export const PERFORMANCE_PRESETS: Record<string, Partial<VisualizationPerformanceDefaults>> = {
  tiny: { initialArchitectureNodes: 25, initialDetailedNodes: 40, hardVisibleNodeWarning: 80 },
  large: { initialArchitectureNodes: 250, initialDetailedNodes: 400, hardVisibleNodeWarning: 800 },
};
