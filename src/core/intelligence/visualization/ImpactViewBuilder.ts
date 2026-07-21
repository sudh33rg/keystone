/**
 * ImpactViewBuilder (spec §13). Starting from changed/selected entities, find
 * direct dependents, transitive affected entities, affected flows, and mapped
 * tests. Each impacted entity carries: impact distance, relationship path,
 * confidence, supporting evidence, category, and whether it is production or
 * test code. This phase provides the engine + visual experience; workflow gates
 * and QA execution arrive in Phase 6.
 */
import type {
  IntelligenceVisualNode,
  IntelligenceVisualEdge,
  ImpactCategory,
} from "../../../shared/contracts/visualization";
import type { IntelligenceRelationshipRecord } from "../../../shared/contracts/intelligence";
import type { BuilderContext } from "./BaseViewBuilder";
import { BaseViewBuilder } from "./BaseViewBuilder";
import { GraphTraversalService } from "./GraphTraversalService";

export interface ImpactNode extends IntelligenceVisualNode {
  impactDistance: number;
  impactCategory: ImpactCategory;
  isTestCode: boolean;
  pathEvidenceIds: string[];
}

export class ImpactViewBuilder extends BaseViewBuilder {
  build(): { nodes: ImpactNode[]; edges: IntelligenceVisualEdge[] } {
    // Impact is inbound by default (who depends on the changed entity).
    const direction = this.ctx.direction === "outbound" ? "outbound" : "inbound";
    const traversal = GraphTraversalService.traverse(
      this.snapshot,
      this.ctx.seeds,
      direction,
      this.ctx.maxDepth,
    );

    const nodes: ImpactNode[] = [];
    const categoryByEntity = new Map<string, ImpactCategory>();
    const distanceByEntity = new Map<string, number>();

    // Classify the seed(s).
    for (const s of this.ctx.seeds) {
      distanceByEntity.set(s, 0);
      categoryByEntity.set(s, "direct-dependent");
    }

    for (const entityId of traversal.order) {
      const dist = traversal.distances.get(entityId) ?? 0;
      if (dist === 0) continue;
      distanceByEntity.set(entityId, dist);
      categoryByEntity.set(entityId, this.classify(entityId, dist, direction));
    }

    const entitySet = new Set(traversal.order);
    const rels = this.snapshot.relationships.filter(
      (r) => entitySet.has(r.sourceId) && entitySet.has(r.targetId),
    );

    for (const entityId of traversal.order) {
      const base = this.buildNode(entityId);
      const isTest =
        base.kind === "test-file" || base.kind === "test-case" || base.kind === "fixture";
      const category = categoryByEntity.get(entityId) ?? "unresolved-possible-impact";
      const pathEvidence = this.pathEvidence(entityId, rels);
      nodes.push({
        ...base,
        state: {
          ...base.state,
          impacted:
            (traversal.distances.get(entityId) ?? 0) > 0 || this.ctx.seeds.includes(entityId),
          changed: (this.ctx.changedEntityIds ?? []).includes(entityId),
        },
        impactDistance: distanceByEntity.get(entityId) ?? 0,
        impactCategory: category,
        isTestCode: isTest,
        pathEvidenceIds: pathEvidence,
      });
    }

    const edges = rels.map((r) => this.buildEdge(r));
    // Mark edges as "impacts" semantics for the impact view.
    for (const e of edges) {
      e.relationship = e.relationship === "calls" ? "impacts" : e.relationship;
    }
    return { nodes, edges };
  }

  private classify(
    entityId: string,
    dist: number,
    direction: "inbound" | "outbound",
  ): ImpactCategory {
    const node = this.buildNode(entityId);
    if (node.kind === "test-file" || node.kind === "test-case") {
      return "mapped-test";
    }
    if (node.kind === "configuration") return "configuration-consumer";
    if (node.kind === "table" || node.kind === "entity" || node.kind === "database") {
      return "data-consumer";
    }
    if (dist === 1) return direction === "inbound" ? "direct-dependent" : "direct-caller";
    return "transitive-dependent";
  }

  private pathEvidence(entityId: string, rels: IntelligenceRelationshipRecord[]): string[] {
    const ids = new Set<string>();
    for (const r of rels) {
      if (r.sourceId === entityId || r.targetId === entityId) {
        for (const e of r.evidenceIds) ids.add(e);
      }
    }
    return Array.from(ids);
  }

  static async build(ctx: BuilderContext) {
    return new ImpactViewBuilder(ctx).build();
  }
}
