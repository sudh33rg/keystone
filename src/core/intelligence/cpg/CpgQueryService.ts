import { CpgScopeQuerySchema, CpgSliceQuerySchema, type CpgEdge, type CpgQueryResult, type CpgScopeQuery, type CpgSliceQuery, type CpgSliceResult } from "../../../shared/contracts/cpg";
import type { IntelligenceSnapshotReader } from "../../persistence/IntelligenceStore";
import { isAstKind, isCfgEdge, isDataFlowEdge } from "./CpgFactories";
import { ProgramSliceService } from "./ProgramSliceService";

export class CpgQueryService {
  private readonly slicer = new ProgramSliceService();
  private readonly sliceCache = new Map<string, CpgSliceResult>();
  private queryLatencies: number[] = [];
  private sliceCacheHits = 0;

  constructor(private readonly store: IntelligenceSnapshotReader) {}

  async scope(raw: CpgScopeQuery, signal?: AbortSignal): Promise<CpgQueryResult | undefined> {
    const started = performance.now();
    const query = CpgScopeQuerySchema.parse(raw);
    const manifest = this.store.getCpgManifest?.();
    const scopeIds = new Set(manifest?.indexes.scopeBySymbol[query.semanticSymbolId] ?? []);
    const descriptor = manifest?.scopes.filter((scope) => scopeIds.has(scope.id)).sort((left, right) => scopePriority(left.kind) - scopePriority(right.kind) || scopeSize(left) - scopeSize(right))[0];
    if (!descriptor || !this.store.readCpgScope) return undefined;
    throwIfAborted(signal);
    const artifact = await this.store.readCpgScope(descriptor.id); if (!artifact) return undefined;
    throwIfAborted(signal);
    const allowed = (edge: CpgEdge): boolean => query.overlays.includes("ast") && (edge.type === "AST_CHILD" || edge.type === "AST_PARENT")
      || query.overlays.includes("evaluation") && (edge.type === "EVAL_NEXT" || edge.type === "EVAL_PREVIOUS")
      || query.overlays.includes("control-flow") && isCfgEdge(edge.type)
      || query.overlays.includes("data-flow") && isDataFlowEdge(edge.type)
      || query.overlays.includes("calls") && ["CALLS_SYMBOL", "INSTANTIATES_SYMBOL", "ARGUMENT_TO_PARAMETER", "RETURN_TO_CALL", "RECEIVER_TO_CALL"].includes(edge.type);
    const selectedEdges = artifact.edges.filter(allowed);
    const required = new Set([artifact.entryNodeId, artifact.exitNodeId, ...selectedEdges.flatMap((edge) => [edge.sourceId, edge.targetId])]);
    const candidates = artifact.nodes.filter((node) => required.has(node.id) || query.overlays.includes("ast") && isAstKind(node.kind));
    const nodes = candidates.slice(0, query.maxNodes).map((node) => query.includeSource ? node : { ...node, code: undefined });
    const nodeIds = new Set(nodes.map((node) => node.id));
    const edges = selectedEdges.filter((edge) => nodeIds.has(edge.sourceId) && nodeIds.has(edge.targetId)).slice(0, 2000);
    const truncated = candidates.length > nodes.length || selectedEdges.length > edges.length;
    this.recordLatency(performance.now() - started);
    return { generation: artifact.descriptor.generation, scope: artifact.descriptor, entryNodeId: artifact.entryNodeId, exitNodeId: artifact.exitNodeId, nodes, edges, diagnostics: artifact.diagnostics.slice(0, 100), truncated };
  }

  controlFlow(semanticSymbolId: string, maxNodes = 200, signal?: AbortSignal): Promise<CpgQueryResult | undefined> { return this.scope({ semanticSymbolId, overlays: ["control-flow"], maxNodes, includeSource: true }, signal); }
  dataFlow(semanticSymbolId: string, maxNodes = 200, signal?: AbortSignal): Promise<CpgQueryResult | undefined> { return this.scope({ semanticSymbolId, overlays: ["data-flow", "calls"], maxNodes, includeSource: true }, signal); }
  calls(semanticSymbolId: string, maxNodes = 200, signal?: AbortSignal): Promise<CpgQueryResult | undefined> { return this.scope({ semanticSymbolId, overlays: ["calls"], maxNodes, includeSource: true }, signal); }

  async slice(raw: CpgSliceQuery, signal?: AbortSignal): Promise<CpgSliceResult | undefined> {
    const query = CpgSliceQuerySchema.parse(raw);
    const manifest = this.store.getCpgManifest?.();
    const scopeIds = new Set(manifest?.indexes.scopeBySymbol[query.semanticSymbolId] ?? []);
    const descriptor = manifest?.scopes.filter((scope) => scopeIds.has(scope.id)).sort((left, right) => scopePriority(left.kind) - scopePriority(right.kind) || scopeSize(left) - scopeSize(right))[0];
    if (!descriptor || !this.store.readCpgScope) return undefined;
    const key = JSON.stringify([manifest?.semanticGeneration, descriptor.structuralHash, query]);
    const cached = this.sliceCache.get(key); if (cached) { this.sliceCacheHits += 1; return cached; }
    throwIfAborted(signal); const artifact = await this.store.readCpgScope(descriptor.id); if (!artifact) return undefined; throwIfAborted(signal);
    const result = this.slicer.slice(artifact, query); this.sliceCache.set(key, result); if (this.sliceCache.size > 100) this.sliceCache.delete(this.sliceCache.keys().next().value as string); return result;
  }

  conditionsForNode(semanticSymbolId: string, nodeId: string, signal?: AbortSignal): Promise<CpgSliceResult | undefined> { return this.slice({ semanticSymbolId, nodeId, direction: "backward", includeConditions: true, maxNodes: 50, maxDepth: 4, maxPaths: 5, timeBudgetMs: 250 }, signal); }
  metrics() { return { queryCount: this.queryLatencies.length, averageQueryLatencyMs: this.queryLatencies.length ? this.queryLatencies.reduce((sum, value) => sum + value, 0) / this.queryLatencies.length : 0, sliceCacheHits: this.sliceCacheHits }; }
  private recordLatency(value: number): void { this.queryLatencies.push(value); if (this.queryLatencies.length > 100) this.queryLatencies = this.queryLatencies.slice(-100); }
}

function scopeSize(scope: { range: { startLine: number; startColumn: number; endLine: number; endColumn: number } }): number { return (scope.range.endLine - scope.range.startLine) * 100000 + scope.range.endColumn - scope.range.startColumn; }
function scopePriority(kind: string): number { return kind === "callback" || kind === "module" ? 1 : 0; }
function throwIfAborted(signal?: AbortSignal): void { if (signal?.aborted) { const error = new Error("CPG query was cancelled."); error.name = "AbortError"; throw error; } }
