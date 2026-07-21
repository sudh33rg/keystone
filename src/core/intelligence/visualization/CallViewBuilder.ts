/**
 * CallViewBuilder (spec §8). Uses CALLS / RETURNS_TO / IMPLEMENTS / INHERITS
 * from the snapshot. Distinguishes statically-resolved / inferred / unresolved /
 * framework-derived edges (carried via relationship resolution + confidence).
 */
import type {
  IntelligenceVisualNode,
  IntelligenceVisualEdge,
} from "../../../shared/contracts/visualization";
import type { BuilderContext } from "./BaseViewBuilder";
import { BaseViewBuilder } from "./BaseViewBuilder";
import { GraphTraversalService } from "./GraphTraversalService";

export class CallViewBuilder extends BaseViewBuilder {
  build(): { nodes: IntelligenceVisualNode[]; edges: IntelligenceVisualEdge[] } {
    const traversal = GraphTraversalService.traverse(
      this.snapshot,
      this.ctx.seeds,
      this.ctx.direction,
      this.ctx.maxDepth,
    );
    const entityIds = new Set<string>(traversal.order);
    for (const s of this.ctx.seeds) entityIds.add(s);

    const rels = this.snapshot.relationships.filter(
      (r) =>
        entityIds.has(r.sourceId) &&
        entityIds.has(r.targetId) &&
        (r.type.includes("CALLS") ||
          r.type.includes("RETURNS_TO") ||
          r.type.includes("IMPLEMENTS") ||
          r.type.includes("INHERITS")),
    );
    const nodes = Array.from(entityIds).map((id) => this.buildNode(id));
    const edges = rels.map((r) =>
      this.buildEdge(r, {
        relationship: r.type.includes("RETURNS_TO")
          ? "returns-to"
          : r.type.includes("IMPLEMENTS")
            ? "implements"
            : r.type.includes("INHERITS")
              ? "inherits"
              : "calls",
      }),
    );
    return { nodes, edges };
  }

  static async build(ctx: BuilderContext) {
    return new CallViewBuilder(ctx).build();
  }
}
