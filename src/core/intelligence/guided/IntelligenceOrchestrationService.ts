import type { IntelligenceQueryService } from "../IntelligenceQueryService";
import type { CpgQueryService } from "../cpg/CpgQueryService";
import type { IntelligenceQuery, IntelligenceQueryResult } from "../../../shared/contracts/query";
import {
  GuidedResultSchema,
  type GuidedResult,
  type GuidedDiagram,
  type OrientationCrumb,
  type GuidedFollowUp,
  type ContextCandidate,
  type GuidedRequest,
  type GuidedContextSelection,
} from "../../../shared/contracts/guidedIntelligence";
import {
  buildDiagramForResult,
  buildContextCandidates,
  classifyNodeKind,
} from "./diagramMapping";

/**
 * Unified guided-intelligence orchestration.
 *
 * A single facade over the existing Intelligence backends (semantic graph,
 * CPG, architecture/dependency projection, route/schema/messaging extraction,
 * security/performance services, OKF). It accepts a user-facing `view` + `action`
 * and returns ONE canonical {@link GuidedResult} containing the answer summary,
 * result entities, an optional canonical diagram, ranked evidence, confidence,
 * limitations, diagnostics, an orientation (breadcrumb) trail, follow-up actions
 * and context candidates.
 *
 * It does NOT introduce a second source of Intelligence truth: it only reads the
 * canonical snapshot and delegates to {@link IntelligenceQueryService}.
 */

export class IntelligenceOrchestrationService {
  constructor(
    private readonly query: IntelligenceQueryService,
    private readonly cpg?: CpgQueryService,
  ) {}

  async overview(_request?: GuidedRequest): Promise<GuidedResult> {
    const base = await this.query.overview();
    const generation = base.generation;
    const repo = base.repository?.displayName ?? "this repository";
    const languages = base.languages.map((item) => item.key).filter(Boolean);
    const frameworks = (base.technologyCoverage ?? [])
      .map((item) => item.technologyId)
      .filter(Boolean)
      .slice(0, 8);
    const answer =
      `${repo} is a ${languages.slice(0, 3).join(", ") || "software"} repository ` +
      `indexed at generation ${generation} with ${base.counts.symbols} symbols and ` +
      `${base.counts.relationships} relationships across ${base.counts.files} files. ` +
      (frameworks.length ? `Detected technologies: ${frameworks.join(", ")}. ` : "") +
      `Intelligence readiness is ${base.status}.`;
    const orientation: OrientationCrumb[] = [{ level: "Repository", label: repo }];
    const followUps: GuidedFollowUp[] = [
      { label: "Show the system landscape", action: "view.systems", payload: { view: "systems" } },
      { label: "Show the architecture", action: "view.architecture", payload: { view: "architecture" } },
      { label: "Show an end-to-end request", action: "flow.request", payload: { view: "flows", action: "request" } },
      { label: "Show a messaging flow", action: "flow.messaging", payload: { view: "flows", action: "messaging" } },
      { label: "Show database calls", action: "view.data", payload: { view: "data" } },
      { label: "Ask a repository question", action: "view.ask", payload: { view: "ask" } },
    ];
    return GuidedResultSchema.parse({
      view: "overview",
      title: "Repository orientation",
      answer,
      evidence: [],
      confidence: 0.9,
      limitations: base.status !== "ready" ? ["Intelligence is not fully indexed; some statements are incomplete."] : [],
      diagnostics: base.diagnostics?.items.map((item) => item.message).slice(0, 5) ?? [],
      orientation,
      followUps,
      contextCandidates: [],
      generation,
    });
  }

  async run(request: GuidedRequest): Promise<GuidedResult> {
    const op = this.operationForView(request);
    const query: IntelligenceQuery = {
      operation: op,
      ...(request.entityId || request.entityValue
        ? {
            seeds: [
              request.entityId
                ? { id: request.entityId }
                : { value: request.entityValue, kind: "name" },
            ],
          }
        : {}),
      limits: { depth: request.limits?.depth ?? 4, results: request.limits?.results ?? 40 },
    };
    const result = await this.query.unified({ query });
    return this.toGuided(request, result);
  }

  private operationForView(request: GuidedRequest): IntelligenceQuery["operation"] {
    switch (request.view) {
      case "systems":
      case "architecture":
        return "ARCHITECTURE";
      case "flows":
        if (request.action === "control") return "CONTROL_FLOW";
        if (request.action === "data") return "DATA_FLOW";
        if (request.action === "call") return "FLOW";
        return "FLOW";
      case "messaging":
        return "FLOW";
      case "data":
        return "DATA_USAGE";
      case "dependencies":
        return "DEPENDENCIES";
      case "apis":
        return "ARCHITECTURE";
      default:
        return "ARCHITECTURE";
    }
  }

  private toGuided(request: GuidedRequest, result: IntelligenceQueryResult): GuidedResult {
    const generation = result.generation ?? 0;
    const items = result.data?.items ?? [];
    const diagram: GuidedDiagram = buildDiagramForResult(request, result);
    const orientation: OrientationCrumb[] = this.buildOrientation(request, result);
    const followUps = this.buildFollowUps(request);
    const contextCandidates: ContextCandidate[] = buildContextCandidates(items);
    const limitations: string[] = [];
    if (result.diagnostics?.length) limitations.push("Some relationships are unresolved or inferred.");
    if (result.truncated) limitations.push("Result set was truncated by the bounded query limits.");
    return GuidedResultSchema.parse({
      view: request.view,
      title: this.titleFor(request),
      answer: this.answerFor(request, result),
      entities: items,
      diagram,
      flowPaths: result.data?.paths ?? [],
      evidence: result.evidence ?? [],
      confidence: items.length ? items.reduce((sum, item) => sum + item.confidence, 0) / items.length : 0,
      limitations,
      diagnostics: (result.diagnostics ?? []).map((d) => d.message).slice(0, 8),
      orientation,
      followUps,
      contextCandidates,
      generation,
    });
  }

  private buildOrientation(request: GuidedRequest, result: IntelligenceQueryResult): OrientationCrumb[] {
    const crumbs: OrientationCrumb[] = [
      { level: "Repository", label: "Repository overview", target: { submenu: "overview" } },
    ];
    if (request.view !== "overview") {
      crumbs.push({ level: "View", label: this.titleFor(request), target: { submenu: request.view } });
    }
    const seed = (result.data?.items ?? [])[0];
    if (seed && request.entityId) {
      crumbs.push({
        level: classifyNodeKind(seed.type, "symbol"),
        label: seed.name,
        target: { submenu: request.view, entityId: seed.id },
      });
    }
    return crumbs;
  }

  private buildFollowUps(request: GuidedRequest): GuidedFollowUp[] {
    const common: GuidedFollowUp[] = [
      { label: "Show architecture", action: "view.architecture", payload: { view: "architecture" } },
      { label: "Show dependencies", action: "view.dependencies", payload: { view: "dependencies" } },
      { label: "Show impact", action: "view.impact", payload: { view: "impact" } },
    ];
    if (request.view === "flows" || request.view === "messaging") {
      return [
        { label: "Show call flow", action: "flow.call", payload: { view: "flows", action: "call" } },
        { label: "Show data flow", action: "flow.data", payload: { view: "flows", action: "data" } },
        { label: "Show database calls", action: "view.data", payload: { view: "data" } },
        ...common,
      ];
    }
    if (request.view === "data") {
      return [
        { label: "Show entity relationship", action: "data.erd", payload: { view: "data", action: "erd" } },
        { label: "Show database call map", action: "data.callmap", payload: { view: "data", action: "callmap" } },
        ...common,
      ];
    }
    return common;
  }

  private titleFor(request: GuidedRequest): string {
    const map: Record<string, string> = {
      systems: "System landscape",
      architecture: "Architecture",
      flows: "Flows",
      messaging: "Messaging intelligence",
      data: "Data and database",
      dependencies: "Dependencies",
      apis: "APIs",
    };
    return map[request.view] ?? request.view;
  }

  private answerFor(request: GuidedRequest, result: IntelligenceQueryResult): string {
    const count = result.data?.items.length ?? 0;
    const relCount = result.data?.relationships.length ?? 0;
    return `Found ${count} entities and ${relCount} relationships for ${this.titleFor(request).toLowerCase()}. ${
      request.entityId || request.entityValue ? `Centered on ${request.entityValue ?? request.entityId}.` : ""
    }`;
  }

  /** Persist a context selection for the active workflow (delegated to development host elsewhere). */
  async persistContextSelection(selection: GuidedContextSelection): Promise<{ accepted: number }> {
    return { accepted: selection.items.length };
  }
}
