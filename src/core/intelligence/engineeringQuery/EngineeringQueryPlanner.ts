/**
 * EngineeringQueryPlanner (spec §12, §16).
 *
 * Translates an interpreted query (intent + direction + modifiers + scope) into a
 * deterministic plan of operations over the EXISTING intelligence graph / query
 * operations / Phase4 visualization builders. Never invents operations.
 *
 * The expected `view` drives which Phase4 visualization the executor builds.
 */
import type {
  EngineeringQueryIntent,
  EngineeringQueryPlan,
  EngineeringQueryScope,
  QueryModifier,
  QueryPlanStep,
} from "../../../shared/contracts/engineeringQuery";

const INTENT_VIEW: Record<EngineeringQueryIntent, EngineeringQueryPlan["expectedView"]> = {
  "find-entity": "list",
  "describe-entity": "list",
  "show-callers": "calls",
  "show-callees": "calls",
  "show-usages": "calls",
  "show-references": "calls",
  "show-dependencies": "dependencies",
  "show-dependents": "dependencies",
  "show-implementations": "tree",
  "show-inheritance": "tree",
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

const INTENT_VIEW_TYPE = (
  view: EngineeringQueryPlan["expectedView"],
): EngineeringQueryPlan["expectedView"] => view;

export interface PlannerInput {
  intent: EngineeringQueryIntent;
  direction?: "inbound" | "outbound" | "both";
  modifiers: QueryModifier[];
  depthOverride?: number;
  scope: EngineeringQueryScope;
}

export class EngineeringQueryPlanner {
  /** Bounded default limits (spec §29). */
  static readonly DEFAULT_LIMITS = {
    maximumNodes: 150,
    maximumEdges: 800,
    maximumPaths: 20,
    maximumDepth: 2,
  };

  plan(input: PlannerInput): EngineeringQueryPlan {
    const view = INTENT_VIEW[input.intent];
    const steps: QueryPlanStep[] = [];
    const mk = (
      id: string,
      operation: QueryPlanStep["operation"],
      inputs: Record<string, unknown> = {},
      dependsOn: string[] = [],
      optional = false,
    ): QueryPlanStep => ({ id, operation, inputs, dependsOn, optional });
    steps.push(mk("s1", "resolve-entity"));

    const hasTarget =
      input.intent === "show-path" ||
      input.intent === "show-api-storage-path" ||
      input.intent === "compare-entities";

    if (hasTarget) {
      steps.push(mk("s2", "resolve-entity", { role: "target" }, ["s1"]));
      steps.push(mk("s3", "find-path", {}, ["s2"]));
    } else if (input.intent === "show-related-tests") {
      steps.push(mk("s2", "find-tests", {}, ["s1"]));
    } else if (input.intent === "show-covered-code") {
      steps.push(mk("s2", "find-covered-code", {}, ["s1"]));
    } else if (
      input.intent === "show-data-reads" ||
      input.intent === "show-data-writes" ||
      input.intent === "show-data-flow"
    ) {
      steps.push(mk("s2", "find-data-access", {}, ["s1"]));
    } else if (input.intent === "show-impact") {
      steps.push(mk("s2", "build-impact", {}, ["s1"]));
    } else if (input.intent === "show-flow") {
      steps.push(mk("s2", "build-flow", {}, ["s1"]));
    } else {
      steps.push(mk("s2", "traverse-graph", { direction: input.direction ?? "both" }, ["s1"]));
    }

    steps.push(mk("s3b", "load-evidence", {}, ["s2"], true));
    steps.push(mk("s4", "rank-results", {}, ["s2"]));
    steps.push(mk("s5", "group-results", {}, ["s4"]));

    const depth = input.modifiers.includes("one-level")
      ? 1
      : (input.depthOverride ??
        (input.modifiers.includes("transitive")
          ? 4
          : EngineeringQueryPlanner.DEFAULT_LIMITS.maximumDepth));

    return {
      intent: input.intent,
      steps,
      expectedView: INTENT_VIEW_TYPE(view),
      limits: {
        maximumNodes: EngineeringQueryPlanner.DEFAULT_LIMITS.maximumNodes,
        maximumEdges: EngineeringQueryPlanner.DEFAULT_LIMITS.maximumEdges,
        maximumPaths: EngineeringQueryPlanner.DEFAULT_LIMITS.maximumPaths,
        maximumDepth: Math.min(12, depth),
      },
    };
  }

  expectedView(intent: EngineeringQueryIntent): EngineeringQueryPlan["expectedView"] {
    return INTENT_VIEW[intent];
  }
}
