/**
 * IntelligenceVisualizationService (spec §29). Orchestrates a view request:
 *   1. resolve seed entity selectors to entity ids (spec §17)
 *   2. dispatch to the matching view builder
 *   3. assemble the canonical IntelligenceVisualization via VisualizationModelBuilder
 *
 * Deterministic, no LLM. The existing IntelligenceSnapshot is the source of
 * truth; builders only read parsed records.
 */
import type {
  IntelligenceSnapshot,
  IntelligenceSymbolRecord,
  IntelligenceFileRecord,
} from "../../../shared/contracts/intelligence";
import type {
  IntelligenceVisualization,
  IntelligenceVisualizationRequest,
  EntitySelector,
  IntelligenceViewType,
  IntelligenceNodeKind,
  IntelligenceVisualNode,
  IntelligenceVisualEdge,
} from "../../../shared/contracts/visualization";
import { VisualizationModelBuilder } from "./VisualizationModelBuilder";
import type { BuilderContext } from "./BaseViewBuilder";
import { ArchitectureViewBuilder } from "./ArchitectureViewBuilder";
import { DependencyViewBuilder } from "./DependencyViewBuilder";
import { CallViewBuilder } from "./CallViewBuilder";
import { FlowViewBuilder } from "./FlowViewBuilder";
import { DataFlowViewBuilder } from "./DataFlowViewBuilder";
import { TestMappingViewBuilder } from "./TestMappingViewBuilder";
import { ImpactViewBuilder } from "./ImpactViewBuilder";
import { SchemaViewBuilder } from "./SchemaViewBuilder";
import { TechnologyViewBuilder } from "./TechnologyViewBuilder";

export interface VisualizationBuildOptions {
  repositoryRevision?: string;
  intelligenceRevision?: string;
  workflowId?: string;
  stageId?: string;
  workItemId?: string;
  changedEntityIds?: string[];
}

export class IntelligenceVisualizationService {
  constructor(private snapshot: IntelligenceSnapshot) {}

  /**
   * Resolve an EntitySelector (id / qualified name / name / path / route /
   * database / package) to concrete entity ids. Does not require exact graph
   * ids (spec §17).
   */
  resolveSeeds(selectors: EntitySelector[]): string[] {
    const found = new Set<string>();
    for (const sel of selectors) {
      if (sel.id) {
        if (this.entityExists(sel.id)) found.add(sel.id);
        continue;
      }
      const value = sel.value ?? "";
      const byKind = sel.entityTypes;
      const matches = this.searchEntities(value, sel.kind, byKind);
      for (const m of matches) found.add(m);
    }
    return Array.from(found);
  }

  private entityExists(id: string): boolean {
    return (
      this.snapshot.symbols.some((s) => s.id === id) ||
      this.snapshot.files.some((f) => f.id === id) ||
      this.snapshot.repository.id === id
    );
  }

  /** Lightweight search used by the in-canvas search box (spec §17). */
  searchEntities(
    query: string,
    kind: EntitySelector["kind"] = "name",
    entityTypes?: EntitySelector["entityTypes"],
  ): string[] {
    const q = query.toLowerCase();
    const out: string[] = [];
    const considerSymbol = (s: IntelligenceSymbolRecord) => {
      if (entityTypes && !entityTypes.includes(symbolKindToVisual(s.type))) return;
      switch (kind) {
        case "qualified-name":
          if (s.qualifiedName.toLowerCase().includes(q)) out.push(s.id);
          break;
        case "route":
          if (
            s.type === "keystone.core.Route" &&
            (s.qualifiedName.toLowerCase().includes(q) ||
              String(s.properties?.routePath ?? "")
                .toLowerCase()
                .includes(q))
          )
            out.push(s.id);
          break;
        case "database":
          if (
            (s.type === "keystone.core.Table" || s.type === "keystone.core.Entity") &&
            s.name.toLowerCase().includes(q)
          )
            out.push(s.id);
          break;
        case "path":
          break;
        default:
          if (s.name.toLowerCase().includes(q)) out.push(s.id);
      }
    };
    const considerFile = (f: IntelligenceFileRecord) => {
      if (entityTypes && !entityTypes.includes("file")) return;
      if (kind === "path" || kind === "name") {
        if (f.relativePath.toLowerCase().includes(q)) out.push(f.id);
      }
    };
    for (const s of this.snapshot.symbols) considerSymbol(s);
    for (const f of this.snapshot.files) considerFile(f);
    return Array.from(new Set(out));
  }

  async build(
    request: IntelligenceVisualizationRequest,
    options: VisualizationBuildOptions = {},
  ): Promise<IntelligenceVisualization> {
    const seeds = request.seeds
      ? this.resolveSeeds(request.seeds)
      : (request.scope?.rootEntityIds ?? []);
    const ctx: BuilderContext = {
      snapshot: this.snapshot,
      seeds,
      direction: request.direction,
      maxDepth: request.maxDepth,
      changedEntityIds: options.changedEntityIds,
    };

    const built = await this.dispatch(request.viewType, ctx, request);
    return VisualizationModelBuilder.build({
      viewType: request.viewType,
      title: this.titleFor(request.viewType, seeds),
      rootEntityIds: seeds,
      request,
      nodes: built.nodes,
      edges: built.edges,
      groups: [],
      repositoryRevision: options.repositoryRevision,
      intelligenceRevision: options.intelligenceRevision,
      workflowId: options.workflowId,
      stageId: options.stageId,
      workItemId: options.workItemId,
      changedEntityIds: options.changedEntityIds,
    });
  }

  private async dispatch(
    viewType: IntelligenceViewType,
    ctx: BuilderContext,
    request: IntelligenceVisualizationRequest,
  ): Promise<{ nodes: IntelligenceVisualNode[]; edges: IntelligenceVisualEdge[] }> {
    switch (viewType) {
      case "architecture":
        return ArchitectureViewBuilder.build(ctx);
      case "dependencies":
        return DependencyViewBuilder.build(ctx);
      case "calls":
        return CallViewBuilder.build(ctx);
      case "flow":
        return FlowViewBuilder.build(ctx, request.layout?.strategy !== "auto");
      case "data":
        return DataFlowViewBuilder.build(ctx);
      case "tests":
        return TestMappingViewBuilder.build(ctx);
      case "impact":
        return ImpactViewBuilder.build(ctx);
      case "evidence":
        // Evidence view reuses the dependency graph as its backbone.
        return DependencyViewBuilder.build(ctx);
      case "schema":
        return SchemaViewBuilder.build(ctx);
      case "technology":
        return TechnologyViewBuilder.build(ctx);
    }
  }

  private titleFor(viewType: IntelligenceViewType, seeds: string[]): string {
    if (seeds.length === 0) return `${capitalize(viewType)} view`;
    const first =
      this.snapshot.symbols.find((s) => s.id === seeds[0]) ??
      this.snapshot.files.find((f) => f.id === seeds[0]);
    const label = first
      ? "symbol" in first
        ? (first as IntelligenceSymbolRecord).name
        : (first as IntelligenceFileRecord).relativePath
      : seeds[0];
    return `${capitalize(viewType)} — ${label}`;
  }
}

function capitalize(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

function symbolKindToVisual(type: string): IntelligenceNodeKind {
  const map: Record<string, IntelligenceNodeKind> = {
    "keystone.core.Repository": "repository",
    "keystone.core.Package": "package",
    "keystone.core.Module": "module",
    "keystone.core.Directory": "directory",
    "keystone.core.File": "file",
    "keystone.core.Class": "class",
    "keystone.core.Interface": "interface",
    "keystone.core.Function": "function",
    "keystone.core.Method": "method",
    "keystone.core.Route": "route",
    "keystone.core.Event": "event",
    "keystone.core.BackgroundJob": "job",
    "keystone.core.Database": "database",
    "keystone.core.Table": "table",
    "keystone.core.Entity": "entity",
    "keystone.core.ExternalService": "external-service",
    "keystone.core.TestSuite": "test-file",
    "keystone.core.TestCase": "test-case",
    "keystone.core.Fixture": "fixture",
    "keystone.core.ConfigurationKey": "configuration",
  };
  return map[type] ?? "unknown";
}
