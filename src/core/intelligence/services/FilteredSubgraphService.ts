// FilteredSubgraphService.ts
// Provides filtered subgraph extraction: BFS from seed nodes with configurable
// filters on relationship types, entity types, depth, and direction.

import type { IntelligenceSnapshotReader } from "../../persistence/IntelligenceStore";
import type {
  IntelligenceSymbolRecord,
  IntelligenceFileRecord,
} from "../../../shared/contracts/intelligence";

export interface SubgraphOptions {
  /** Seed node IDs to start from. */
  seedIds: string[];
  /** Direction of traversal. Defaults to "both". */
  direction?: "incoming" | "outgoing" | "both";
  /** Maximum BFS depth. Defaults to 3. */
  maxDepth?: number;
  /** Filter relationship types. Empty means all. */
  relationshipTypes?: string[];
  /** Filter entity types. Empty means all. */
  entityTypes?: string[];
  /** Minimum confidence threshold. Defaults to 0. */
  minConfidence?: number;
  /** Maximum nodes to include. Defaults to 200. */
  maxNodes?: number;
  /** Maximum edges to include. Defaults to 500. */
  maxEdges?: number;
}

export interface SubgraphNode {
  id: string;
  type: string;
  name: string;
  qualifiedName: string;
  relativePath: string;
  distance: number;
}

export interface SubgraphEdge {
  id: string;
  sourceId: string;
  targetId: string;
  type: string;
  confidence: number;
}

export interface FilteredSubgraphResult {
  generation: number;
  nodes: SubgraphNode[];
  edges: SubgraphEdge[];
  seedCount: number;
  totalNodes: number;
  totalEdges: number;
  truncated: boolean;
  truncationReason: string | undefined;
}

export class FilteredSubgraphService {
  constructor(private readonly store: IntelligenceSnapshotReader) {}

  async extract(options: SubgraphOptions, signal?: AbortSignal): Promise<FilteredSubgraphResult> {
    const snapshot = this.store.getSnapshot();
    if (!snapshot) {
      throw new Error("Intelligence snapshot unavailable.");
    }

    const {
      seedIds,
      direction = "both",
      maxDepth = 3,
      relationshipTypes,
      entityTypes,
      minConfidence = 0,
      maxNodes = 200,
      maxEdges = 500,
    } = options;

    const selectedNodes = new Set<string>(seedIds);
    const selectedEdges = new Set<string>();
    const distances = new Map<string, number>();
    for (const id of seedIds) {
      distances.set(id, 0);
    }

    const entityById = new Map<string, IntelligenceSymbolRecord | IntelligenceFileRecord>();
    for (const s of snapshot.symbols) entityById.set(s.id, s);
    for (const f of snapshot.files) entityById.set(f.id, f);

    let frontier = [...seedIds];
    let truncated = false;
    let truncationReason: string | undefined;

    for (let depth = 0; depth < maxDepth && frontier.length > 0; depth++) {
      const next: string[] = [];
      const frontierIds = new Set(frontier);

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

        // Check relationship type filter
        if (relationshipTypes?.length && !relationshipTypes.includes(rel.type)) continue;

        // Check confidence filter
        if (rel.confidence < minConfidence) continue;

        // Determine which side is in the frontier
        const sourceInFrontier = frontierIds.has(rel.sourceId);
        const targetInFrontier = frontierIds.has(rel.targetId);

        if (direction === "outgoing" && !sourceInFrontier) continue;
        if (direction === "incoming" && !targetInFrontier) continue;

        // The node we are expanding TO
        const expandingTo = sourceInFrontier ? rel.targetId : rel.sourceId;

        const targetEntity = entityById.get(expandingTo);

        // Check entity type filter
        if (entityTypes?.length && targetEntity) {
          const entityType = "type" in targetEntity ? targetEntity.type : "keystone.core.File";
          if (!entityTypes.includes(entityType)) continue;
        }

        selectedEdges.add(rel.id);
        if (selectedEdges.size > maxEdges) {
          truncated = true;
          truncationReason = "edge limit reached";
          break;
        }

        if (!selectedNodes.has(expandingTo)) {
          if (selectedNodes.size >= maxNodes) {
            truncated = true;
            truncationReason = "node limit reached";
            break;
          }
          selectedNodes.add(expandingTo);
          distances.set(expandingTo, depth + 1);
          next.push(expandingTo);
        }
      }

      if (truncated) break;
      frontier = next;
    }

    if (frontier.length > 0 && !truncated) {
      truncated = true;
      truncationReason = "depth limit reached";
    }

    const nodes: SubgraphNode[] = [...selectedNodes]
      .map((id) => {
        const entity = entityById.get(id);
        if (!entity) return undefined;
        return {
          id,
          type: "type" in entity ? entity.type : "keystone.core.File",
          name:
            "name" in entity
              ? entity.name
              : (entity.relativePath.split("/").at(-1) ?? entity.relativePath),
          qualifiedName: "qualifiedName" in entity ? entity.qualifiedName : entity.relativePath,
          relativePath: "relativePath" in entity ? entity.relativePath : "",
          distance: distances.get(id) ?? 0,
        };
      })
      .filter((n): n is SubgraphNode => n !== undefined);

    const edges: SubgraphEdge[] = [...selectedEdges]
      .map((id) => {
        const rel = snapshot.relationships.find((r) => r.id === id);
        if (!rel) return undefined;
        return {
          id: rel.id,
          sourceId: rel.sourceId,
          targetId: rel.targetId,
          type: rel.type,
          confidence: rel.confidence,
        };
      })
      .filter((e): e is SubgraphEdge => e !== undefined);

    return {
      generation: snapshot.manifest.generation,
      nodes,
      edges,
      seedCount: seedIds.length,
      totalNodes: nodes.length,
      totalEdges: edges.length,
      truncated,
      truncationReason,
    };
  }
}
