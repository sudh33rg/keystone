/**
 * FlowViewBuilder (spec §9). Converts low-level graph paths into ordered
 * engineering flows: entry point -> steps -> side effects -> boundaries.
 * Supports a simplified (collapsed intermediates) and detailed (full graph)
 * rendering. Simplified flow retains traceability via childNodeIds.
 */
import type {
  IntelligenceVisualNode,
  IntelligenceVisualEdge,
  IntelligenceVisualGroup,
} from "../../../shared/contracts/visualization";
import type { BuilderContext } from "./BaseViewBuilder";
import { BaseViewBuilder } from "./BaseViewBuilder";
import { GraphTraversalService } from "./GraphTraversalService";
import { nodeIdForEntity } from "./mapping";

export class FlowViewBuilder extends BaseViewBuilder {
  /** Build a single flow path from a seed entry point following CALLS/WRIES_TO. */
  buildPath(seed: string): {
    nodes: IntelligenceVisualNode[];
    edges: IntelligenceVisualEdge[];
    steps: string[];
  } {
    const { order } = GraphTraversalService.traverse(
      this.snapshot,
      [seed],
      "outbound",
      this.ctx.maxDepth,
    );
    const entityIds = new Set<string>(order);
    entityIds.add(seed);
    const rels = this.snapshot.relationships.filter(
      (r) =>
        entityIds.has(r.sourceId) &&
        entityIds.has(r.targetId) &&
        (r.type.includes("CALLS") ||
          r.type.includes("ROUTES_TO") ||
          r.type.includes("WRIES_TO") ||
          r.type.includes("READS_FROM")),
    );
    const nodes = Array.from(entityIds).map((id) => this.buildNode(id));
    const edges = rels.map((r) => this.buildEdge(r));
    return { nodes, edges, steps: order };
  }

  /**
   * Build a collapsed/simplified flow: keep entry + terminal (storage/external)
   * nodes, collapse chain intermediates into a group. Detailed when detailed=true.
   */
  build(detailed = false): {
    nodes: IntelligenceVisualNode[];
    edges: IntelligenceVisualEdge[];
    groups: IntelligenceVisualGroup[];
  } {
    const groups: IntelligenceVisualGroup[] = [];
    if (this.ctx.seeds.length === 0) {
      // No seed: show all route entry points and their immediate chains.
      const routes = this.snapshot.symbols.filter((s) => s.type === "keystone.core.Route");
      this.ctx.seeds.push(...routes.map((r) => r.id));
    }
    const allNodes: IntelligenceVisualNode[] = [];
    const allEdges: IntelligenceVisualEdge[] = [];
    for (const seed of this.ctx.seeds) {
      const path = this.buildPath(seed);
      allNodes.push(...path.nodes);
      allEdges.push(...path.edges);
      if (!detailed && path.nodes.length > 3) {
        const intermediates = path.nodes.slice(1, -1).map((n) => n.id);
        groups.push({
          id: `flow:${seed}`,
          label: `Flow from ${path.nodes[0]?.label ?? seed}`,
          kind: "method",
          basis: "derived",
          childNodeIds: intermediates,
          collapsed: true,
          description: "Simplified flow: intermediate steps collapsed (expand to reveal).",
        });
        // Mark intermediates collapsed in state.
        for (const n of path.nodes.slice(1, -1)) {
          n.state.expanded = false;
          n.state.highlighted = false;
        }
      }
    }
    return { nodes: dedupe(allNodes), edges: dedupeEdges(allEdges), groups };
  }

  static async build(ctx: BuilderContext, detailed = false) {
    return new FlowViewBuilder(ctx).build(detailed);
  }
}

function dedupe<T extends { id: string }>(arr: T[]): T[] {
  const seen = new Set<string>();
  return arr.filter((x) => (seen.has(x.id) ? false : (seen.add(x.id), true)));
}
function dedupeEdges(arr: IntelligenceVisualEdge[]): IntelligenceVisualEdge[] {
  const seen = new Set<string>();
  return arr.filter((x) => (seen.has(x.id) ? false : (seen.add(x.id), true)));
}
export { nodeIdForEntity };
