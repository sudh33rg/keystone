/**
 * DataFlowViewBuilder (spec §10). Visualizes how data moves using READS_FROM /
 * WRITES_TO / USES_CONFIGURATION. Clearly separates proven data flow from
 * structural association / inferred transformation / unresolved flow.
 * Never presents a plain CALLS edge as a proven data-flow edge.
 */
import type {
  IntelligenceVisualNode,
  IntelligenceVisualEdge,
} from "../../../shared/contracts/visualization";
import type { BuilderContext } from "./BaseViewBuilder";
import { BaseViewBuilder } from "./BaseViewBuilder";
import { GraphTraversalService } from "./GraphTraversalService";

export class DataFlowViewBuilder extends BaseViewBuilder {
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
        (r.type.includes("READS_FROM") ||
          r.type.includes("WRITES_TO") ||
          r.type.includes("USES_CONFIGURATION")),
    );
    const nodes = Array.from(entityIds).map((id) => this.buildNode(id));
    const edges = rels.map((r) =>
      this.buildEdge(r, {
        relationship: r.type.includes("READS_FROM")
          ? "reads"
          : r.type.includes("USES_CONFIGURATION")
            ? "configures"
            : "writes",
      }),
    );
    return { nodes, edges };
  }

  static async build(ctx: BuilderContext) {
    return new DataFlowViewBuilder(ctx).build();
  }
}
