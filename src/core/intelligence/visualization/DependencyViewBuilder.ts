/**
 * DependencyViewBuilder (spec §7).
 * Forward + reverse dependencies: module/file imports, package deps,
 * external libraries, cycles, isolated modules. Uses IMPORTS / DEPENDS_ON
 * relationships from the existing snapshot.
 */
import type {
  IntelligenceVisualNode,
  IntelligenceVisualEdge,
} from "../../../shared/contracts/visualization";
import type { BuilderContext } from "./BaseViewBuilder";
import { BaseViewBuilder } from "./BaseViewBuilder";
import { GraphTraversalService } from "./GraphTraversalService";

export class DependencyViewBuilder extends BaseViewBuilder {
  build(): { nodes: IntelligenceVisualNode[]; edges: IntelligenceVisualEdge[] } {
    const traversal = GraphTraversalService.traverse(
      this.snapshot,
      this.ctx.seeds,
      this.ctx.direction,
      this.ctx.maxDepth,
    );
    const entityIds = new Set(traversal.order);
    // Expand seeds themselves if no traversal hit.
    for (const s of this.ctx.seeds) entityIds.add(s);

    const rels = this.snapshot.relationships.filter(
      (r) =>
        entityIds.has(r.sourceId) &&
        entityIds.has(r.targetId) &&
        (r.type.includes("IMPORTS") || r.type.includes("DEPENDS_ON") || r.type.includes("USES")),
    );

    const nodes = Array.from(entityIds).map((id) => this.buildNode(id));
    const edges = rels.map((r) =>
      this.buildEdge(r, {
        relationship: r.type.includes("DEPENDS_ON")
          ? "depends-on"
          : r.type.includes("USES")
            ? "uses"
            : "imports",
      }),
    );
    return { nodes, edges };
  }

  /** Detect cycles among the dependency edges (spec §7). */
  static detectCycles(
    snapshot: Parameters<typeof GraphTraversalService.traverse>[0],
    entityIds: Set<string>,
  ): string[][] {
    const adj = new Map<string, string[]>();
    for (const r of snapshot.relationships) {
      if (
        (r.type.includes("IMPORTS") || r.type.includes("DEPENDS_ON")) &&
        entityIds.has(r.sourceId) &&
        entityIds.has(r.targetId)
      ) {
        if (!adj.has(r.sourceId)) adj.set(r.sourceId, []);
        adj.get(r.sourceId)!.push(r.targetId);
      }
    }
    const cycles: string[][] = [];
    const seen = new Set<string>();
    const dfs = (node: string, stack: string[], onStack: Set<string>) => {
      if (onStack.has(node)) {
        const idx = stack.indexOf(node);
        cycles.push(stack.slice(idx));
        return;
      }
      if (seen.has(node)) return;
      seen.add(node);
      onStack.add(node);
      stack.push(node);
      for (const next of adj.get(node) ?? []) dfs(next, stack, onStack);
      stack.pop();
      onStack.delete(node);
    };
    for (const n of entityIds) dfs(n, [], new Set());
    return cycles;
  }

  static async build(ctx: BuilderContext) {
    return new DependencyViewBuilder(ctx).build();
  }
}
