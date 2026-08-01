import { routeForIntent } from "./routingPolicy";
import type { ContextPack, IntentAnalysis, RouteDecision, RouteKind, RouteStep } from "../../domain/types";

export function routeIntent(analysis: IntentAnalysis, contextPack?: ContextPack): RouteDecision {
  const selectedRoute = routeForIntent(analysis);
  const steps = buildSteps(selectedRoute, analysis.needsCodeChange);
  const tokenSaving = estimateTokenSaving(selectedRoute, contextPack);
  return {
    selectedRoute,
    confidence: Math.max(0.45, Math.min(0.95, analysis.confidence)),
    reason: explainRoute(selectedRoute, analysis.needsCodeChange),
    steps,
    estimatedTokenSaving: tokenSaving,
    requiredApprovals: selectedRoute === "human-review" ? ["approve modernization plan before Copilot delegation"] : selectedRoute === "hybrid" || selectedRoute === "copilot" ? ["approve Copilot delegation prompt"] : [],
    risks: analysis.riskHints.length > 0 ? analysis.riskHints.map((hint) => `Task mentions ${hint}`) : ["No major risk keyword detected"],
    fallbackPath: selectedRoute === "human-review" ? "hybrid" : "human-review"
  };
}

/** Estimate token savings based on route and context pack size. */
function estimateTokenSaving(route: RouteKind, contextPack?: ContextPack): number {
  if (!contextPack) {
    return route === "copilot" ? 35 : route === "hybrid" ? 72 : 88;
  }

  const packedTokens = contextPack.estimatedPackedTokens ?? 0;
  const rawTokens = contextPack.estimatedRawTokens ?? 0;

  if (rawTokens === 0) return route === "copilot" ? 35 : route === "hybrid" ? 72 : 88;

  const reductionPercent = contextPack.estimatedReductionPercent ?? 0;

  switch (route) {
    case "copilot":
      return Math.max(10, Math.min(50, reductionPercent * 0.6));
    case "hybrid":
      return Math.max(40, Math.min(85, reductionPercent * 0.85));
    case "graph-only":
      return Math.max(70, Math.min(99, reductionPercent * 0.99));
    default:
      // Fallback for unknown route kinds
      return 72;
  }
}

function buildSteps(route: RouteKind, needsCodeChange: boolean): RouteStep[] {
  const steps: RouteStep[] = [
    step("graph", "Inspect repository intelligence", "keystone", "ready"),
    step("retrieve", "Retrieve evidence from deterministic OKF intelligence", "keystone", "ready")
  ];
  if (needsCodeChange || route === "copilot" || route === "hybrid") {
    steps.push(step("context", "Build compact context pack", "keystone", "ready"));
    steps.push(step("copilot", "Generate Copilot delegation prompt", "copilot", "requires-approval"));
  }
  steps.push(step("validation", "Run QA, security, performance, modernization checks", "keystone", "pending"));
  steps.push(step("evidence", "Prepare PR evidence", "keystone", "pending"));
  return steps;
}

function step(id: string, label: string, owner: RouteStep["owner"], status: RouteStep["status"]): RouteStep {
  return { id, label, owner, status, description: label };
}

function explainRoute(route: RouteKind, needsCodeChange: boolean): string {
  if (route === "hybrid") {
    return "This task requires code changes, so Copilot is recommended for implementation. Keystone handles repo analysis, context preparation, QA planning, security checks, and performance checks locally before spending Copilot tokens.";
  }
  if (route === "graph-only") {
    return "This task can be answered from deterministic repository intelligence without Copilot delegation.";
  }
  if (route === "human-review") {
    return "This task needs human approval before implementation because modernization or unclear scope can change behavior.";
  }
  if (route === "copilot") {
    return "This task is implementation-heavy. Keystone will still prepare a compact prompt and validation evidence before user-approved Copilot delegation.";
  }
  return needsCodeChange ? "Graph inspection is not enough because code changes are likely." : "Repository graph inspection is sufficient for the requested analysis.";
}
