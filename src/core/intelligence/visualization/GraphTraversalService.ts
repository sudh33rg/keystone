/**
 * GraphTraversalService — deterministic bounded traversal over the existing
 * Intelligence snapshot relationships (spec §15, §22).
 *
 * Produces the set of entity ids reachable within `maxDepth` in the requested
 * direction. Used by every view builder and by interactive "expand neighbours"
 * / "show inbound" / "show outbound" canvas actions.
 */
import type {
  IntelligenceSnapshot,
  IntelligenceRelationshipRecord,
} from "../../../shared/contracts/intelligence";
import type { TraversalDirection } from "../../../shared/contracts/visualization";

export interface TraversalResult {
  /** entityId -> distance (1 = direct neighbour). */
  distances: Map<string, number>;
  /** ordered entity ids by discovery. */
  order: string[];
}

export class GraphTraversalService {
  static buildAdjacency(relationships: IntelligenceRelationshipRecord[]): {
    outgoing: Map<string, IntelligenceRelationshipRecord[]>;
    incoming: Map<string, IntelligenceRelationshipRecord[]>;
  } {
    const outgoing = new Map<string, IntelligenceRelationshipRecord[]>();
    const incoming = new Map<string, IntelligenceRelationshipRecord[]>();
    for (const rel of relationships) {
      if (!outgoing.has(rel.sourceId)) outgoing.set(rel.sourceId, []);
      outgoing.get(rel.sourceId)!.push(rel);
      if (!incoming.has(rel.targetId)) incoming.set(rel.targetId, []);
      incoming.get(rel.targetId)!.push(rel);
    }
    return { outgoing, incoming };
  }

  static traverse(
    snapshot: IntelligenceSnapshot,
    seeds: string[],
    direction: TraversalDirection,
    maxDepth: number,
  ): TraversalResult {
    const { outgoing, incoming } = GraphTraversalService.buildAdjacency(snapshot.relationships);
    const distances = new Map<string, number>();
    const order: string[] = [];
    const queue: Array<{ id: string; depth: number }> = [];

    for (const seed of seeds) {
      if (!distances.has(seed)) {
        distances.set(seed, 0);
        order.push(seed);
      }
      queue.push({ id: seed, depth: 0 });
    }

    while (queue.length > 0) {
      const { id, depth } = queue.shift()!;
      if (depth >= maxDepth) continue;
      const nextDepth = depth + 1;
      const edges =
        direction === "inbound"
          ? (incoming.get(id) ?? [])
          : direction === "outbound"
            ? (outgoing.get(id) ?? [])
            : [...(outgoing.get(id) ?? []), ...(incoming.get(id) ?? [])];
      for (const rel of edges) {
        // Follow the edge in the direction(s) requested.
        const next = direction === "inbound" ? rel.sourceId : rel.targetId;
        if (!distances.has(next)) {
          distances.set(next, nextDepth);
          order.push(next);
          queue.push({ id: next, depth: nextDepth });
        }
      }
    }
    return { distances, order };
  }

  /** All relationships touching any of the given entity ids (bidirectional). */
  static edgesForEntities(
    snapshot: IntelligenceSnapshot,
    entityIds: Set<string>,
  ): IntelligenceRelationshipRecord[] {
    return snapshot.relationships.filter(
      (rel) => entityIds.has(rel.sourceId) || entityIds.has(rel.targetId),
    );
  }
}
