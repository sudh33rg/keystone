/**
 * QueryResultExplanationService (spec §15, §17, §18, §19).
 *
 * Deterministic, evidence-graded explanations. Distinghuishes proven /
 * derived / inferred / unresolved. Produces:
 *   - summary (title + description derived from result data, never invented)
 *   - no-result explanations with concrete refinement actions (§18)
 *   - refinement suggestions (§19)
 */
import type {
  EngineeringQuery,
  EngineeringQueryResultItem,
  QueryRefinementSuggestion,
} from "../../../shared/contracts/engineeringQuery";
import type { IntelligenceVisualization } from "../../../shared/contracts/visualization";
import type { IntelligenceSnapshot } from "../../../shared/contracts/intelligence";

export interface SummarizeInput {
  query: EngineeringQuery;
  snapshot: IntelligenceSnapshot;
  items: EngineeringQueryResultItem[];
  visualization: IntelligenceVisualization | undefined;
  selectedSubjectIds: string[];
  selectedTargetIds: string[];
}

export interface SuggestInput {
  foundResults: boolean;
  hasTarget: boolean;
}

export class QueryResultExplanationService {
  summarize(input: SummarizeInput): {
    title: string;
    description: string;
    findingCount: number;
    warningCount: number;
    truncated: boolean;
  } {
    const { query, items, visualization } = input;
    const intent = query.interpretation.intent;
    const subjectNames = input.selectedSubjectIds
      .map((id) => this.nameFor(id, input.snapshot))
      .filter(Boolean);
    const subjectLabel = subjectNames.join(", ") || "the selected subject";

    const title = this.titleFor(intent, subjectLabel);

    let description: string;
    let warningCount: number;
    let truncated = false;

    if (items.length === 0) {
      description = this.noResultReason(query, input);
      warningCount = 1;
    } else {
      const proven = items.filter((i) => i.confidenceCategory === "proven").length;
      const inferred = items.filter((i) => i.confidenceCategory === "inferred").length;
      const unresolved = items.filter((i) => i.confidenceCategory === "unresolved").length;
      const parts: string[] = [`${items.length} result item(s) for ${subjectLabel}.`];
      if (proven) parts.push(`${proven} proven by direct evidence.`);
      if (inferred) parts.push(`${inferred} inferred (medium confidence).`);
      if (unresolved) parts.push(`${unresolved} unresolved relationship(s).`);
      description = parts.join(" ");
      warningCount = unresolved;
    }

    if (visualization) {
      const warns = visualization.warnings ?? [];
      truncated =
        warns.some((w) => (w.omitted?.length ?? 0) > 0) ||
        (visualization.metrics?.truncated ?? false);
    }

    return {
      title,
      description,
      findingCount: items.length,
      warningCount,
      truncated,
    };
  }

  private noResultReason(query: EngineeringQuery, input: SummarizeInput): string {
    const intent = query.interpretation.intent;
    const reasons: string[] = [];
    if (query.interpretation.ambiguityState === "unresolved") {
      reasons.push("The subject could not be resolved to any entity in the current intelligence.");
    } else if (query.interpretation.ambiguityState === "needs-selection") {
      reasons.push("Multiple entities matched; select one to continue.");
    } else {
      reasons.push(
        "No relationship of the requested kind was found in the current intelligence graph.",
      );
      reasons.push(
        "The relationship may be dynamic (e.g. ORM, reflection) or the intelligence revision may be incomplete.",
      );
    }
    void intent;
    void input;
    return reasons.join(" ");
  }

  suggestRefinements(query: EngineeringQuery, ctx: SuggestInput): QueryRefinementSuggestion[] {
    const out: QueryRefinementSuggestion[] = [];
    const m = new Set(query.interpretation.modifiers);

    if (!ctx.foundResults) {
      out.push({
        id: "include-inferred",
        label: "Include inferred relationships",
        kind: "change-confidence",
        patch: { confidenceThreshold: 0 },
      });
      out.push({
        id: "increase-depth",
        label: "Increase traversal depth",
        kind: "change-depth",
        patch: { traversalDepth: Math.min(12, (query.scope.traversalDepth ?? 2) + 2) },
      });
      if (!query.scope.includeTests) {
        out.push({
          id: "include-tests",
          label: "Include tests",
          kind: "include-tests",
          patch: { includeTests: true },
        });
      }
      return out;
    }

    if (!m.has("transitive")) {
      out.push({
        id: "transitive",
        label: "Include transitive relationships",
        kind: "switch-direct-transitive",
        patch: { modifiers: [...query.interpretation.modifiers, "transitive"] },
      });
    }
    if (!query.scope.includeTests) {
      out.push({
        id: "include-tests",
        label: "Include tests",
        kind: "include-tests",
        patch: { includeTests: true },
      });
    }
    if (!query.scope.includeExternal) {
      out.push({
        id: "include-external",
        label: "Include external dependencies",
        kind: "include-external",
        patch: { includeExternal: true },
      });
    }
    out.push({
      id: "increase-depth",
      label: "Increase depth",
      kind: "change-depth",
      patch: { traversalDepth: Math.min(12, (query.scope.traversalDepth ?? 2) + 1) },
    });
    if (ctx.hasTarget || query.interpretation.intent === "show-path") {
      out.push({
        id: "all-paths",
        label: "Show all paths",
        kind: "switch-path-mode",
        patch: { modifiers: [...query.interpretation.modifiers, "all-paths"] },
      });
    }
    out.push({
      id: "to-workflow",
      label: "Add result to workflow context",
      kind: "add-to-workflow-context",
    });
    return out.slice(0, 30);
  }

  private titleFor(intent: EngineeringQuery["interpretation"]["intent"], subject: string): string {
    const verb: Record<string, string> = {
      "find-entity": "Find",
      "describe-entity": "Describe",
      "show-callers": "Callers of",
      "show-callees": "Callees of",
      "show-usages": "Usages of",
      "show-references": "References of",
      "show-dependencies": "Dependencies of",
      "show-dependents": "Dependents of",
      "show-implementations": "Implementations of",
      "show-inheritance": "Inheritance of",
      "show-related-tests": "Tests related to",
      "show-covered-code": "Code covered by",
      "show-impact": "Impact of changing",
      "show-flow": "Flow from",
      "show-path": "Path from",
      "show-data-reads": "Data reads of",
      "show-data-writes": "Data writes of",
      "show-data-flow": "Data flow of",
      "show-entry-points": "Entry points of",
      "show-side-effects": "Side effects of",
      "show-architecture": "Architecture around",
      "show-evidence": "Evidence for",
      "show-configuration-usage": "Configuration usage of",
      "show-event-handlers": "Event handlers for",
      "show-api-storage-path": "API to storage path for",
      "compare-entities": "Compare",
    };
    return `${verb[intent] ?? "Query"} ${subject}`.trim();
  }

  private nameFor(id: string, snapshot: IntelligenceSnapshot): string | undefined {
    const sym = snapshot.symbols.find((s) => s.id === id);
    if (sym) return sym.name;
    const file = snapshot.files.find((f) => f.id === id);
    if (file) return file.relativePath.split("/").pop() ?? file.relativePath;
    return undefined;
  }
}
