/** TechnologyViewBuilder — Phase D technology subgraph. */
import type {
  IntelligenceVisualNode,
  IntelligenceVisualEdge,
  IntelligenceRelationship,
} from "../../../shared/contracts/visualization";
import type { IntelligenceRelationshipRecord } from "../../../shared/contracts/intelligence";
import type { BuilderContext } from "./BaseViewBuilder";
import { BaseViewBuilder } from "./BaseViewBuilder";

const PHASE_C_TYPES = new Set([
  "keystone.core.Database",
  "keystone.core.Table",
  "keystone.core.Entity",
  "keystone.core.ORMEntity",
  "keystone.core.ORMField",
  "keystone.core.SchemaTable",
  "keystone.core.SchemaColumn",
  "keystone.core.SchemaForeignKey",
  "keystone.core.Migration",
  "keystone.core.Route",
  "keystone.core.ExternalService",
  "keystone.core.Framework",
  "keystone.core.ORM",
]);

const PHASE_C_REL_TYPES = new Set([
  "keystone.core.DB_TABLE_HAS_COLUMN",
  "keystone.core.FOREIGN_KEY",
  "keystone.core.ORM_HAS_FIELD",
  "keystone.core.MIGRATION_APPLIES",
  "keystone.core.ROUTE_EXPOSES",
  "keystone.core.DEFINES_TECHNOLOGY",
  "keystone.core.USES_TECHNOLOGY",
]);

export class TechnologyViewBuilder extends BaseViewBuilder {
  build(): { nodes: IntelligenceVisualNode[]; edges: IntelligenceVisualEdge[] } {
    const entityIds = new Set<string>();
    for (const s of this.snapshot.symbols) {
      if (PHASE_C_TYPES.has(s.type)) entityIds.add(s.id);
    }
    for (const s of this.ctx.seeds) entityIds.add(s);

    const rels = this.snapshot.relationships.filter(
      (r) => entityIds.has(r.sourceId) && entityIds.has(r.targetId) && PHASE_C_REL_TYPES.has(r.type),
    );
    const nodes = Array.from(entityIds).map((id) => this.buildNode(id));
    const edges = rels.map((r) => this.buildTechnologyEdge(r));
    return { nodes, edges };
  }

  private buildTechnologyEdge(rel: IntelligenceRelationshipRecord): IntelligenceVisualEdge {
    const relationship = this.mapRelationship(rel.type);
    return this.buildEdge(rel, {
      relationship,
      confidenceCategory: "structural",
    });
  }

  private mapRelationship(type: string): IntelligenceRelationship {
    if (type.includes("DEFINES_TECHNOLOGY")) return "contains";
    if (type.includes("USES_TECHNOLOGY")) return "uses";
    if (type.includes("FOREIGN_KEY")) return "uses";
    if (type.includes("HAS_COLUMN")) return "contains";
    if (type.includes("ORM_HAS_FIELD")) return "contains";
    if (type.includes("MIGRATION_APPLIES")) return "uses";
    if (type.includes("ROUTE_EXPOSES")) return "uses";
    return "unknown";
  }

  static async build(ctx: BuilderContext) {
    return new TechnologyViewBuilder(ctx).build();
  }
}
