// KnowledgeGraphContextService.ts
// Provides full context retrieval (ancestors, children, imports, type edges) for a graph node.

import type { IntelligenceSnapshotReader } from "../../persistence/IntelligenceStore";
import type { IntelligenceRelationshipRecord } from "../../../shared/contracts/intelligence";

export interface GraphContext {
  id: string;
  type: string;
  name: string;
  qualifiedName: string;
  relativePath: string;
  ancestors: RelationshipInfo[];
  children: RelationshipInfo[];
  imports: RelationshipInfo[];
  typeEdges: RelationshipInfo[];
}

export interface RelationshipInfo {
  id: string;
  type: string;
  sourceId: string;
  targetId: string;
  confidence: number;
  derivation: string;
  sourceName: string;
  targetName: string;
}

export class KnowledgeGraphContextService {
  constructor(private readonly store: IntelligenceSnapshotReader) {}

  async getFullContext(
    nodeId: string,
    signal?: AbortSignal,
  ): Promise<GraphContext | undefined> {
    const snapshot = this.store.getSnapshot();
    if (!snapshot) {
      throw new Error("Intelligence snapshot unavailable.");
    }

    const node = this.findEntity(snapshot, nodeId);
    if (!node) {
      return undefined;
    }

    // Find ancestors (incoming edges recursively)
    const ancestors = await this.collectAncestors(nodeId, snapshot.relationships, snapshot, signal);

    // Find children (outgoing edges recursively)
    const children = await this.collectChildren(nodeId, snapshot.relationships, snapshot, signal);

    // Find imports (edges of kind keystone.core.IMPORTS)
    const imports = snapshot.relationships
      .filter((e) => e.sourceId === nodeId && e.type === "keystone.core.IMPORTS")
      .map((e) => this.toRelationshipInfo(e, snapshot));

    // Find type edges (edges of kind keystone.core.TYPE_OF)
    const typeEdges = snapshot.relationships
      .filter((e) => e.sourceId === nodeId && e.type === "keystone.core.TYPE_OF")
      .map((e) => this.toRelationshipInfo(e, snapshot));

    return {
      id: node.id,
      type: node.type,
      name: node.name,
      qualifiedName: node.qualifiedName,
      relativePath: node.relativePath,
      ancestors,
      children,
      imports,
      typeEdges,
    };
  }

  private async collectAncestors(
    nodeId: string,
    edges: IntelligenceRelationshipRecord[],
    snapshot: ReturnType<IntelligenceSnapshotReader["getSnapshot"]>,
    signal?: AbortSignal,
    visited = new Set<string>(),
  ): Promise<RelationshipInfo[]> {
    const result: RelationshipInfo[] = [];
    const incoming = edges.filter((e) => e.targetId === nodeId);

    for (let index = 0; index < incoming.length; index++) {
      const e = incoming[index]!;
      if ((index + 1) % 500 === 0) {
        if (signal?.aborted) {
          const error = new Error("Cancelled.");
          error.name = "AbortError";
          throw error;
        }
        await new Promise<void>((resolve) => setImmediate(resolve));
      }
      if (visited.has(e.sourceId)) continue;
      visited.add(e.sourceId);
      result.push(this.toRelationshipInfo(e, snapshot));
      const moreAncestors = await this.collectAncestors(e.sourceId, edges, snapshot, signal, visited);
      result.push(...moreAncestors);
    }

    return result;
  }

  private async collectChildren(
    nodeId: string,
    edges: IntelligenceRelationshipRecord[],
    snapshot: ReturnType<IntelligenceSnapshotReader["getSnapshot"]>,
    signal?: AbortSignal,
    visited = new Set<string>(),
  ): Promise<RelationshipInfo[]> {
    const result: RelationshipInfo[] = [];
    const outgoing = edges.filter((e) => e.sourceId === nodeId);

    for (let index = 0; index < outgoing.length; index++) {
      const e = outgoing[index]!;
      if ((index + 1) % 500 === 0) {
        if (signal?.aborted) {
          const error = new Error("Cancelled.");
          error.name = "AbortError";
          throw error;
        }
        await new Promise<void>((resolve) => setImmediate(resolve));
      }
      if (visited.has(e.targetId)) continue;
      visited.add(e.targetId);
      result.push(this.toRelationshipInfo(e, snapshot));
      const moreChildren = await this.collectChildren(e.targetId, edges, snapshot, signal, visited);
      result.push(...moreChildren);
    }

    return result;
  }

  private toRelationshipInfo(
    rel: IntelligenceRelationshipRecord,
    snapshot: ReturnType<IntelligenceSnapshotReader["getSnapshot"]>,
  ): RelationshipInfo {
    const source = this.findEntity(snapshot, rel.sourceId);
    const target = this.findEntity(snapshot, rel.targetId);
    return {
      id: rel.id,
      type: rel.type,
      sourceId: rel.sourceId,
      targetId: rel.targetId,
      confidence: rel.confidence,
      derivation: rel.derivation,
      sourceName: source?.qualifiedName ?? rel.sourceId,
      targetName: target?.qualifiedName ?? rel.targetId,
    };
  }

  private findEntity(
    snapshot: ReturnType<IntelligenceSnapshotReader["getSnapshot"]>,
    id: string,
  ): { id: string; type: string; name: string; qualifiedName: string; relativePath: string } | undefined {
    if (!snapshot) return undefined;
    const symbol = snapshot.symbols.find((s) => s.id === id);
    if (symbol) {
      const file = snapshot.files.find((f) => f.id === symbol.fileId);
      return {
        id: symbol.id,
        type: symbol.type,
        name: symbol.name,
        qualifiedName: symbol.qualifiedName,
        relativePath: file?.relativePath ?? "",
      };
    }
    const file = snapshot.files.find((f) => f.id === id);
    if (file) {
      return {
        id: file.id,
        type: "keystone.core.File",
        name: file.relativePath.split("/").at(-1) ?? file.relativePath,
        qualifiedName: file.relativePath,
        relativePath: file.relativePath,
      };
    }
    return undefined;
  }
}
