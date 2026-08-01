import type { IntentAnalysis, RouteKind } from "../../domain/types";

export function routeForIntent(analysis: IntentAnalysis): RouteKind {
  switch (analysis.intentType) {
    case "explain":
    case "qa-analysis":
    case "security-review":
    case "performance-review":
      return "graph-only";
    case "pr-summary":
      return "graph-only";
    case "feature":
    case "bugfix":
    case "test":
      return "hybrid";
    case "refactor":
      return analysis.riskHints.length > 0 ? "hybrid" : "copilot";
    case "modernization":
      return "human-review";
    case "unknown":
      return "human-review";
  }
}
