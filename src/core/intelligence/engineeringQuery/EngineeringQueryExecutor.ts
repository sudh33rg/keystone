/**
 * EngineeringQueryExecutor (spec §13, §16).
 *
 * Orchestates a single engineering query execution:
 *   resolve -> (already resolved by caller) -> plan -> build Phase4 visualization
 *   -> assemble EngineeringQueryResult with evidence + refinements + no-result state.
 *
 * Reuses the EXISTING IntelligenceVisualizationService (Phase4) and the
 * IntelligenceSnapshot. Never invents relationships or executes query text as code.
 */
import type { IntelligenceSnapshot } from "../../../shared/contracts/intelligence";
import type {
  EngineeringQuery,
  EngineeringQueryResult,
  EngineeringQueryResultItem,
  ResolvedEntitySummary,
  EngineeringQueryIntent,
} from "../../../shared/contracts/engineeringQuery";
import type {
  IntelligenceVisualization,
  IntelligenceVisualizationRequest,
} from "../../../shared/contracts/visualization";
import type { IntelligenceVisualizationService } from "../visualization/IntelligenceVisualizationService";
import { createHash } from "node:crypto";
import type { QueryResultExplanationService } from "./QueryResultExplanationService";

export interface ExecuteInput {
  query: EngineeringQuery;
  snapshot: IntelligenceSnapshot;
  selectedSubjectIds: string[];
  selectedTargetIds?: string[];
  signal?: AbortSignal;
}

export interface ExecuteOutput {
  result: EngineeringQueryResult;
  visualization: IntelligenceVisualization | undefined;
}

const INTENT_VIEW_TYPE: Record<
  EngineeringQueryIntent,
  IntelligenceVisualizationRequest["viewType"]
> = {
  "find-entity": "architecture",
  "describe-entity": "architecture",
  "show-callers": "calls",
  "show-callees": "calls",
  "show-usages": "calls",
  "show-references": "calls",
  "show-dependencies": "dependencies",
  "show-dependents": "dependencies",
  "show-implementations": "architecture",
  "show-inheritance": "architecture",
  "show-related-tests": "tests",
  "show-covered-code": "tests",
  "show-impact": "impact",
  "show-flow": "flow",
  "show-path": "flow",
  "show-data-reads": "data",
  "show-data-writes": "data",
  "show-data-flow": "data",
  "show-entry-points": "calls",
  "show-side-effects": "impact",
  "show-architecture": "architecture",
  "show-evidence": "evidence",
  "show-configuration-usage": "dependencies",
  "show-event-handlers": "calls",
  "show-api-storage-path": "flow",
  "compare-entities": "architecture",
};

export class EngineeringQueryExecutor {
  constructor(
    private readonly vizService: IntelligenceVisualizationService,
    private readonly explanation: QueryResultExplanationService,
  ) {}

  async execute(input: ExecuteInput): Promise<ExecuteOutput> {
    const started = Date.now();
    const { query, snapshot } = input;
    const intent = query.interpretation.intent;
    const viewType = INTENT_VIEW_TYPE[intent];

    const seeds = input.selectedSubjectIds.map((id) => ({ id, kind: "stable-id" as const }));

    const filters = this.filtersFromQuery(query);
    const direction = query.scope.traversalDirection ?? this.defaultDirection(intent);
    const maxDepth = query.scope.traversalDepth ?? 2;

    let visualization: IntelligenceVisualization | undefined;
    let errorCode: string | undefined;
    try {
      visualization = await this.vizService.build(
        {
          viewType,
          seeds,
          scope: {
            rootEntityIds: seeds.map((s) => s.id),
            repositoryRevision: snapshot.repository.id,
            intelligenceRevision: query.metadata.intelligenceRevision,
          },
          filters,
          direction,
          maxDepth,
        },
        {
          intelligenceRevision: query.metadata.intelligenceRevision,
          workflowId: query.metadata.workflowId,
          stageId: query.metadata.stageId,
          workItemId: query.metadata.workItemId,
        },
      );
    } catch (err) {
      errorCode = "visualization-failed";
      void err;
    }

    const items = this.buildItems(
      query,
      snapshot,
      visualization,
      input.selectedSubjectIds,
      input.selectedTargetIds ?? [],
    );
    const evidenceIds = this.collectEvidence(visualization);
    const { unresolvedCount, lowConfidenceCount } = this.countConfidence(visualization);

    const summary = this.explanation.summarize({
      query,
      snapshot,
      items,
      visualization,
      selectedSubjectIds: input.selectedSubjectIds,
      selectedTargetIds: input.selectedTargetIds ?? [],
    });

    const refinements = this.explanation.suggestRefinements(query, {
      foundResults: items.length > 0,
      hasTarget: (input.selectedTargetIds ?? []).length > 0 || intent === "show-path",
    });

    const result: EngineeringQueryResult = {
      id: crypto.randomUUID(),
      queryId: query.id,
      interpretationSummary: {
        intent,
        subjects: input.selectedSubjectIds
          .map((id) => this.summaryFor(id, snapshot))
          .filter(Boolean) as ResolvedEntitySummary[],
        targets: (input.selectedTargetIds ?? [])
          .map((id) => this.summaryFor(id, snapshot))
          .filter(Boolean) as ResolvedEntitySummary[],
        scopeDescription: this.scopeDescription(query),
        confidence: query.interpretation.confidence,
      },
      summary,
      items,
      visualization,
      evidence: { evidenceIds, unresolvedCount, lowConfidenceCount },
      refinements,
      metadata: {
        executedAt: new Date().toISOString(),
        durationMs: Date.now() - started,
        intelligenceRevision: query.metadata.intelligenceRevision,
        contentHash: this.contentHash(visualization),
      },
    };

    if (errorCode) {
      query.execution.error = {
        code: errorCode,
        message: "The visualization could not be built from the current intelligence.",
        recoverable: true,
        suggestedAction: "Try refining the subject or widening the scope.",
        affectedStep: "s5",
      };
      query.execution.status = "failed";
    } else if (items.length === 0) {
      query.execution.status = "partial";
    } else {
      query.execution.status = "completed";
    }
    query.execution.completedAt = new Date().toISOString();
    query.execution.resultId = result.id;

    return { result, visualization };
  }

  private filtersFromQuery(query: EngineeringQuery): IntelligenceVisualizationRequest["filters"] {
    const m = new Set(query.interpretation.modifiers);
    return {
      productionOnly: query.scope.includeProduction && !query.scope.includeTests ? true : undefined,
      testsOnly: query.scope.includeTests && !query.scope.includeProduction ? true : undefined,
      generatedExcluded: !query.scope.includeGenerated,
      externalDependenciesExcluded: !query.scope.includeExternal,
      confidenceAtLeast: query.scope.confidenceThreshold ?? 0,
      inferredExcluded: m.has("high-confidence-only") ? true : undefined,
      unresolvedExcluded: m.has("high-confidence-only") ? true : undefined,
      changedOnly: m.has("changed-code-only") ? true : undefined,
      packageIds: query.scope.packageIds,
      moduleIds: query.scope.moduleIds,
    };
  }

  private defaultDirection(intent: EngineeringQueryIntent): "inbound" | "outbound" | "both" {
    if (intent === "show-callers" || intent === "show-dependents" || intent === "show-entry-points")
      return "inbound";
    if (
      intent === "show-callees" ||
      intent === "show-dependencies" ||
      intent === "show-usages" ||
      intent === "show-data-reads" ||
      intent === "show-data-writes" ||
      intent === "show-data-flow" ||
      intent === "show-side-effects"
    )
      return "outbound";
    return "both";
  }

  private buildItems(
    query: EngineeringQuery,
    snapshot: IntelligenceSnapshot,
    viz: IntelligenceVisualization | undefined,
    subjectIds: string[],
    targetIds: string[],
  ): EngineeringQueryResultItem[] {
    if (!viz) return [];
    const out: EngineeringQueryResultItem[] = [];
    const seen = new Set<string>();
    for (const node of viz.nodes) {
      if (seen.has(node.entityId)) continue;
      seen.add(node.entityId);
      const sym = snapshot.symbols.find((s) => s.id === node.entityId);
      const file = snapshot.files.find((f) => f.id === node.entityId);
      out.push({
        entityId: node.entityId,
        displayName: sym?.name ?? file?.relativePath ?? node.entityId,
        kind: node.kind,
        relativePath: sym
          ? (snapshot.files.find((f) => f.id === sym.fileId)?.relativePath ?? "")
          : (file?.relativePath ?? ""),
        relationship: node.secondaryLabel,
        confidenceCategory: this.categoryFor(node),
        reason:
          node.evidenceIds.length > 0 ? `${node.evidenceIds.length} evidence record(s)` : undefined,
        isSubject: subjectIds.includes(node.entityId),
        isTarget: targetIds.includes(node.entityId),
      });
    }
    return out.slice(0, 5000);
  }

  private collectEvidence(viz: IntelligenceVisualization | undefined): string[] {
    if (!viz) return [];
    const ids = new Set<string>();
    for (const n of viz.nodes) for (const e of n.evidenceIds) ids.add(e);
    return [...ids].slice(0, 2000);
  }

  private countConfidence(viz: IntelligenceVisualization | undefined): {
    unresolvedCount: number;
    lowConfidenceCount: number;
  } {
    if (!viz) return { unresolvedCount: 0, lowConfidenceCount: 0 };
    let unresolved = 0;
    let low = 0;
    for (const n of viz.nodes) {
      const c = this.categoryFor(n);
      if (c === "unresolved") unresolved++;
      else if (c === "inferred") low++;
    }
    return { unresolvedCount: unresolved, lowConfidenceCount: low };
  }

  private categoryFor(
    node: IntelligenceVisualization["nodes"][number],
  ): "proven" | "derived" | "inferred" | "unresolved" {
    if (node.state?.unresolved) return "unresolved";
    if (node.confidence >= 0.9) return "proven";
    if (node.confidence >= 0.6) return "derived";
    return "inferred";
  }

  private summaryFor(
    id: string,
    snapshot: IntelligenceSnapshot,
  ): ResolvedEntitySummary | undefined {
    const sym = snapshot.symbols.find((s) => s.id === id);
    if (sym) {
      const file = snapshot.files.find((f) => f.id === sym.fileId);
      return {
        entityId: id,
        displayName: sym.name,
        kind: sym.type,
        relativePath: file?.relativePath ?? "",
      };
    }
    const file = snapshot.files.find((f) => f.id === id);
    if (file) {
      return {
        entityId: id,
        displayName: file.relativePath.split("/").pop() ?? file.relativePath,
        kind: "keystone.core.File",
        relativePath: file.relativePath,
      };
    }
    return undefined;
  }

  private scopeDescription(query: EngineeringQuery): string {
    const s = query.scope;
    const parts: string[] = [`repository ${s.repositoryId}`];
    if (s.packageIds?.length) parts.push(`packages: ${s.packageIds.join(", ")}`);
    if (s.moduleIds?.length) parts.push(`modules: ${s.moduleIds.join(", ")}`);
    if (!s.includeTests) parts.push("production only");
    else parts.push("includes tests");
    if (s.includeExternal) parts.push("includes external");
    if (s.traversalDepth) parts.push(`depth ${s.traversalDepth}`);
    if (s.traversalDirection) parts.push(`direction ${s.traversalDirection}`);
    if (s.confidenceThreshold) parts.push(`confidence >= ${s.confidenceThreshold}`);
    return parts.join("; ");
  }

  private contentHash(viz: IntelligenceVisualization | undefined): string {
    const raw = viz
      ? JSON.stringify({ n: viz.nodes.length, e: viz.edges.length, g: viz.groups.length })
      : "empty";
    return String(createHash("sha256").update(raw).digest("hex").slice(0, 32));
  }
}
