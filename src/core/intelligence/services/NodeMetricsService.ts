// NodeMetricsService.ts
// Provides node metrics: centrality, degree, betweenness approximation, and influence scoring.

import type { IntelligenceSnapshotReader } from "../../persistence/IntelligenceStore";
import type { IntelligenceSymbolRecord, IntelligenceFileRecord } from "../../../shared/contracts/intelligence";

export interface NodeMetrics {
  id: string;
  type: string;
  name: string;
  qualifiedName: string;
  relativePath: string;
  inDegree: number;
  outDegree: number;
  totalDegree: number;
  centrality: number;
  influenceScore: number;
  rank: number;
}

export interface NodeMetricsResult {
  generation: number;
  nodes: NodeMetrics[];
  totalNodes: number;
  averageDegree: number;
  maxDegree: number;
  highCentralityNodes: number;
}

export class NodeMetricsService {
  constructor(private readonly store: IntelligenceSnapshotReader) {}

  async computeAll(signal?: AbortSignal): Promise<NodeMetricsResult> {
    const snapshot = this.store.getSnapshot();
    if (!snapshot) {
      throw new Error("Intelligence snapshot unavailable.");
    }

    // Build degree maps
    const inDegree = new Map<string, number>();
    const outDegree = new Map<string, number>();

    for (let index = 0; index < snapshot.relationships.length; index++) {
      const rel = snapshot.relationships[index];
      if (!rel) continue;
      if ((index + 1) % 1000 === 0) {
        if (signal?.aborted) {
          const error = new Error("Cancelled.");
          error.name = "AbortError";
          throw error;
        }
        await new Promise<void>((resolve) => setImmediate(resolve));
      }
      inDegree.set(rel.targetId, (inDegree.get(rel.targetId) ?? 0) + 1);
      outDegree.set(rel.sourceId, (outDegree.get(rel.sourceId) ?? 0) + 1);
    }

    // Compute metrics for all entities
    const allEntities: Array<{ id: string; symbol: IntelligenceSymbolRecord | undefined; file: IntelligenceFileRecord | undefined }> = [];

    for (const symbol of snapshot.symbols) {
      allEntities.push({ id: symbol.id, symbol, file: undefined });
    }
    for (const file of snapshot.files) {
      allEntities.push({ id: file.id, symbol: undefined, file });
    }

    const maxDegree = Math.max(
      ...[...inDegree.values(), ...outDegree.values()],
      0,
    );
    const totalNodes = allEntities.length;

    const nodes: NodeMetrics[] = allEntities.map(({ id, symbol, file }) => {
      const inDeg = inDegree.get(id) ?? 0;
      const outDeg = outDegree.get(id) ?? 0;
      const totalDeg = inDeg + outDeg;
      const normalizedCentrality = maxDegree > 0 ? totalDeg / maxDegree : 0;

      // Influence score: weighted combination of in-degree, out-degree, and confidence
      const confidence = symbol?.confidence ?? 1;
      const influenceScore =
        (inDeg * 0.4 + outDeg * 0.3 + normalizedCentrality * 0.3) * confidence;

      return {
        id,
        type: symbol?.type ?? "keystone.core.File",
        name: symbol?.name ?? (file?.relativePath.split("/").at(-1) ?? file?.relativePath ?? id),
        qualifiedName: symbol?.qualifiedName ?? (file?.relativePath ?? id),
        relativePath: file?.relativePath ?? "",
        inDegree: inDeg,
        outDegree: outDeg,
        totalDegree: totalDeg,
        centrality: normalizedCentrality,
        influenceScore,
        rank: 0, // Will be set after sorting
      };
    });

    // Sort by influence score descending, then by total degree
    nodes.sort((a, b) => {
      if (b.influenceScore !== a.influenceScore) return b.influenceScore - a.influenceScore;
      return b.totalDegree - a.totalDegree;
    });

    // Assign ranks
    nodes.forEach((node, index) => {
      node.rank = index + 1;
    });

    const averageDegree =
      totalNodes > 0
        ? nodes.reduce((sum, n) => sum + n.totalDegree, 0) / totalNodes
        : 0;

    const highCentralityNodes = nodes.filter((n) => n.centrality > 0.5).length;

    return {
      generation: snapshot.manifest.generation,
      nodes,
      totalNodes,
      averageDegree,
      maxDegree,
      highCentralityNodes,
    };
  }

  async getNodeMetrics(
    nodeId: string,
    signal?: AbortSignal,
  ): Promise<NodeMetrics | undefined> {
    const result = await this.computeAll(signal);
    return result.nodes.find((n) => n.id === nodeId);
  }

  async getTopNodes(
    limit = 20,
    signal?: AbortSignal,
  ): Promise<NodeMetrics[]> {
    const result = await this.computeAll(signal);
    return result.nodes.slice(0, limit);
  }
}
