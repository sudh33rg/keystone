/**
 * Saved-view + snapshot + feedback logic (spec §20, §21, §28).
 *
 * Pure, storage-backend-agnostic services. The extension wires a persistence
 * backend (Memento / file) behind `VisualizationPersistenceStore`; these
 * classes own the *rules* (staleness detection, fingerprint comparison,
 * feedback merge) so they are unit-testable headlessly.
 */
import type {
  SavedIntelligenceView,
  VisualizationSnapshot,
  VisualizationFeedback,
  IntelligenceVisualization,
} from "../../../shared/contracts/visualization";

export class SavedIntelligenceViewService {
  /** Compute a source fingerprint from an intelligence revision. */
  static fingerprint(intelligenceRevision: string | undefined): string {
    return `fp:${intelligenceRevision ?? "unknown"}`;
  }

  /**
   * Mark a saved view stale when the live intelligence fingerprint diverges
   * from the one captured at save time (spec §20).
   */
  static evaluateStaleness(
    view: SavedIntelligenceView,
    currentIntelligenceRevision: string | undefined,
  ): SavedIntelligenceView {
    const current = SavedIntelligenceViewService.fingerprint(currentIntelligenceRevision);
    const stale = view.sourceFingerprint !== current;
    if (stale === view.stale) return view;
    return { ...view, stale };
  }

  /** True when a reopened view's referenced intelligence moved materially. */
  static isStale(
    view: SavedIntelligenceView,
    currentIntelligenceRevision: string | undefined,
  ): boolean {
    return (
      view.sourceFingerprint !==
      SavedIntelligenceViewService.fingerprint(currentIntelligenceRevision)
    );
  }

  /** Build a saveable view from the current visualization + user-provided name. */
  static fromVisualization(
    viz: IntelligenceVisualization,
    name: string,
    intelligenceRevision: string | undefined,
  ): Omit<SavedIntelligenceView, "id" | "createdAt" | "updatedAt"> {
    return {
      name,
      viewType: viz.viewType,
      rootEntityIds: viz.scope.rootEntityIds,
      filters: viz.filters,
      direction: viz.direction,
      maxDepth: viz.maxDepth,
      expandedNodeIds: viz.state.expandedNodeIds,
      hiddenNodeIds: viz.state.hiddenNodeIds,
      highlightedPathNodeIds: viz.state.highlightedPathNodeIds,
      layoutStrategy: viz.layout.strategy === "auto" ? undefined : viz.layout.strategy,
      layoutPositions: collectLayout(viz),
      repositoryRevision: viz.scope.repositoryRevision,
      intelligenceRevision: viz.scope.intelligenceRevision,
      workflowId: viz.scope.workflowId,
      sourceFingerprint: SavedIntelligenceViewService.fingerprint(intelligenceRevision),
      stale: false,
    };
  }
}

export class VisualizationSnapshotService {
  static fromVisualization(
    viz: IntelligenceVisualization,
    title: string,
    workflowId?: string,
    stageId?: string,
  ): Omit<VisualizationSnapshot, "id" | "createdAt"> {
    const evidenceIds = new Set<string>();
    for (const n of viz.nodes) n.evidenceIds.forEach((e) => evidenceIds.add(e));
    for (const e of viz.edges) e.evidenceIds.forEach((x) => evidenceIds.add(x));
    return {
      title,
      viewType: viz.viewType,
      selectedEntityIds: viz.state.selectedNodeIds.map((id) => id.replace(/^n:/, "")),
      visibleRelationshipTypes: dedupeTypes(viz.edges.map((e) => e.relationship)),
      filters: viz.filters ?? emptyFilters(),
      layoutStrategy: viz.layout.strategy === "auto" ? undefined : viz.layout.strategy,
      layoutPositions: collectLayout(viz),
      intelligenceRevision: viz.scope.intelligenceRevision ?? "",
      evidenceIds: Array.from(evidenceIds),
      previewImagePath: undefined,
      workflowId,
      stageId,
    };
  }
}

export class VisualizationFeedbackStore {
  private feedback: VisualizationFeedback[] = [];

  add(entry: VisualizationFeedback): void {
    // De-duplicate identical targets so re-flagging is idempotent.
    this.feedback = this.feedback.filter(
      (f) =>
        !(
          f.targetKind === entry.targetKind &&
          f.targetId === entry.targetId &&
          f.action === entry.action
        ),
    );
    this.feedback.push(entry);
  }

  remove(targetKind: VisualizationFeedback["targetKind"], targetId: string): void {
    this.feedback = this.feedback.filter(
      (f) => !(f.targetKind === targetKind && f.targetId === targetId),
    );
  }

  list(): VisualizationFeedback[] {
    return [...this.feedback];
  }

  /** Edges/groups hidden or rejected by the user (visualization overrides). */
  hiddenTargetIds(): Set<string> {
    const set = new Set<string>();
    for (const f of this.feedback) {
      if (f.action === "hide" || f.action === "reject") set.add(f.targetId);
    }
    return set;
  }

  confirmedTargetIds(): Set<string> {
    const set = new Set<string>();
    for (const f of this.feedback) {
      if (f.action === "confirm") set.add(f.targetId);
    }
    return set;
  }
}

// --- local helpers ---
function emptyFilters() {
  return {
    entityTypes: undefined,
    relationshipTypes: undefined,
    productionOnly: undefined,
    testsOnly: undefined,
    generatedExcluded: undefined,
    externalDependenciesExcluded: undefined,
    confidenceAtLeast: 0,
    inferredExcluded: undefined,
    unresolvedExcluded: undefined,
    changedOnly: undefined,
    impactedOnly: undefined,
    packageIds: undefined,
    moduleIds: undefined,
  };
}

function collectLayout(
  viz: IntelligenceVisualization,
): Record<string, { x: number; y: number }> | undefined {
  const positions: Record<string, { x: number; y: number }> = {};
  for (const n of viz.nodes) {
    if (n.layout) positions[n.id] = n.layout;
  }
  return Object.keys(positions).length > 0 ? positions : undefined;
}

function dedupeTypes<T>(arr: T[]): T[] {
  return Array.from(new Set(arr));
}
