// CircularDependencyService.ts
// Provides circular dependency detection at the file, module, and symbol levels.

import type { IntelligenceSnapshotReader } from "../../persistence/IntelligenceStore";
import type { IntelligenceRelationshipRecord } from "../../../shared/contracts/intelligence";

export interface Cycle {
  id: string;
  level: "file" | "module" | "symbol";
  nodes: string[];
  labels: string[];
  relationshipCount: number;
  relationshipTypes: string[];
  severity: "low" | "medium" | "high";
}

export interface CircularDependencyResult {
  generation: number;
  cycles: Cycle[];
  totalCycles: number;
  affectedFiles: number;
  affectedModules: number;
  affectedSymbols: number;
}

export class CircularDependencyService {
  private readonly dependencyTypes = new Set([
    "keystone.core.IMPORTS",
    "keystone.core.REFERENCES",
    "keystone.core.CALLS",
    "keystone.core.INSTANTIATES",
    "keystone.core.DEPENDS_ON",
    "keystone.core.USES",
  ]);

  constructor(private readonly store: IntelligenceSnapshotReader) {}

  async detectAll(signal?: AbortSignal): Promise<CircularDependencyResult> {
    const snapshot = this.store.getSnapshot();
    if (!snapshot) {
      throw new Error("Intelligence snapshot unavailable.");
    }

    const dependencyEdges = snapshot.relationships.filter(
      (r) => this.dependencyTypes.has(r.type),
    );

    const fileCycles = await this.findCyclesAtLevel(dependencyEdges, snapshot.files, "file", signal);
    const moduleCycles = await this.findCyclesAtLevel(
      dependencyEdges,
      snapshot.files.filter((f) => f.moduleId),
      "module",
      signal,
    );
    const symbolCycles = await this.findCyclesAtLevel(dependencyEdges, snapshot.symbols, "symbol", signal);

    const allCycles = [...fileCycles, ...moduleCycles, ...symbolCycles];
    const affectedFiles = new Set(allCycles.flatMap((c) => c.level === "file" ? c.nodes : [])).size;
    const affectedModules = new Set(allCycles.flatMap((c) => c.level === "module" ? c.nodes : [])).size;
    const affectedSymbols = new Set(allCycles.flatMap((c) => c.level === "symbol" ? c.nodes : [])).size;

    return {
      generation: snapshot.manifest.generation,
      cycles: allCycles,
      totalCycles: allCycles.length,
      affectedFiles,
      affectedModules,
      affectedSymbols,
    };
  }

  async detectAtLevel(
    level: "file" | "module" | "symbol",
    signal?: AbortSignal,
  ): Promise<Cycle[]> {
    const snapshot = this.store.getSnapshot();
    if (!snapshot) {
      throw new Error("Intelligence snapshot unavailable.");
    }

    const dependencyEdges = snapshot.relationships.filter(
      (r) => this.dependencyTypes.has(r.type),
    );

    switch (level) {
      case "file":
        return this.findCyclesAtLevel(dependencyEdges, snapshot.files, "file", signal);
      case "module":
        return this.findCyclesAtLevel(
          dependencyEdges,
          snapshot.files.filter((f) => f.moduleId),
          "module",
          signal,
        );
      case "symbol":
        return this.findCyclesAtLevel(dependencyEdges, snapshot.symbols, "symbol", signal);
    }
  }

  private async findCyclesAtLevel<T extends { id: string }>(
    edges: IntelligenceRelationshipRecord[],
    nodes: T[],
    level: "file" | "module" | "symbol",
    signal?: AbortSignal,
  ): Promise<Cycle[]> {
    // Build adjacency list
    const adjacency = new Map<string, string[]>();
    for (const node of nodes) {
      adjacency.set(node.id, []);
    }
    for (const edge of edges) {
      if (adjacency.has(edge.sourceId) && adjacency.has(edge.targetId)) {
        const list = adjacency.get(edge.sourceId)!;
        if (!list.includes(edge.targetId)) {
          list.push(edge.targetId);
        }
      }
    }

    // Find cycles using DFS with path tracking
    const visited = new Set<string>();
    const onStack = new Set<string>();
    const stack: string[] = [];
    const cycles: Cycle[] = [];
    const seenCycleKeys = new Set<string>();

    const edgeByPair = new Map<string, string>();
    for (const edge of edges) {
      if (adjacency.has(edge.sourceId) && adjacency.has(edge.targetId)) {
        edgeByPair.set(`${edge.sourceId}->${edge.targetId}`, edge.id);
      }
    }

    let index = 0;
    for (const node of nodes) {
      if ((index + 1) % 500 === 0) {
        if (signal?.aborted) {
          const error = new Error("Cancelled.");
          error.name = "AbortError";
          throw error;
        }
        await new Promise<void>((resolve) => setImmediate(resolve));
      }
      index++;

      if (!visited.has(node.id)) {
        this.dfsFindCycles(
          node.id,
          adjacency,
          visited,
          onStack,
          stack,
          edges,
          cycles,
          seenCycleKeys,
          level,
        );
      }
    }

    return cycles;
  }

  private dfsFindCycles(
    nodeId: string,
    adjacency: Map<string, string[]>,
    visited: Set<string>,
    onStack: Set<string>,
    stack: string[],
    edges: IntelligenceRelationshipRecord[],
    cycles: Cycle[],
    seenCycleKeys: Set<string>,
    level: "file" | "module" | "symbol",
  ): void {
    visited.add(nodeId);
    onStack.add(nodeId);
    stack.push(nodeId);

    const neighbors = adjacency.get(nodeId) ?? [];
    for (const neighbor of neighbors) {
      if (!visited.has(neighbor)) {
        this.dfsFindCycles(neighbor, adjacency, visited, onStack, stack, edges, cycles, seenCycleKeys, level);
      } else if (onStack.has(neighbor)) {
        // Found a cycle - extract it from the stack
        const cycleStartIdx = stack.indexOf(neighbor);
        if (cycleStartIdx >= 0) {
          const cycleNodes = stack.slice(cycleStartIdx);
          const cycleKey = this.normalizeCycleKey(cycleNodes);
          if (!seenCycleKeys.has(cycleKey)) {
            seenCycleKeys.add(cycleKey);

            const labels = cycleNodes.map((id) => this.getLabel(id));
            const relTypes = new Set<string>();
            for (let i = 0; i < cycleNodes.length; i++) {
              const from = cycleNodes[i]!;
              const to = cycleNodes[(i + 1) % cycleNodes.length]!;
              const edge = edges.find((e) => e.sourceId === from && e.targetId === to);
              if (edge) relTypes.add(edge.type);
            }

            cycles.push({
              id: `cycle:${level}:${cycleKey}`,
              level,
              nodes: cycleNodes,
              labels,
              relationshipCount: relTypes.size,
              relationshipTypes: [...relTypes],
              severity: cycleNodes.length > 4 ? "high" : cycleNodes.length > 2 ? "medium" : "low",
            });
          }
        }
      }
    }

    stack.pop();
    onStack.delete(nodeId);
  }

  private normalizeCycleKey(nodes: string[]): string {
    // Find the lexicographically smallest rotation to normalize the cycle
    if (nodes.length === 0) return "";
    let minIdx = 0;
    for (let i = 1; i < nodes.length; i++) {
      if (nodes[i]!.localeCompare(nodes[minIdx]!) < 0) {
        minIdx = i;
      }
    }
    const rotated = [...nodes.slice(minIdx), ...nodes.slice(0, minIdx)];
    return rotated.join("|");
  }

  private getLabel(id: string): string {
    return id;
  }
}
