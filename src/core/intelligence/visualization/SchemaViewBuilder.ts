/** SchemaViewBuilder — Phase D data/schema subgraph. */
import type {
  IntelligenceVisualNode,
  IntelligenceVisualEdge,
} from "../../../shared/contracts/visualization";
import type { BuilderContext } from "./BaseViewBuilder";
import { BaseViewBuilder } from "./BaseViewBuilder";

const SCHEMA_NODE_TYPES = new Set([
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
]);

const SCHEMA_REL_TYPES = new Set([
  "keystone.core.DB_TABLE_HAS_COLUMN",
  "keystone.core.FOREIGN_KEY",
  "keystone.core.ORM_HAS_FIELD",
  "keystone.core.MIGRATION_APPLIES",
  "keystone.core.ROUTE_EXPOSES",
  "keystone.core.DEFINES_TECHNOLOGY",
]);

const REL_TYPE_TO_CANONICAL: Record<string, any> = {
  "keystone.core.DB_TABLE_HAS_COLUMN": "contains",
  "keystone.core.FOREIGN_KEY": "uses",
  "keystone.core.ORM_HAS_FIELD": "contains",
  "keystone.core.MIGRATION_APPLIES": "uses",
  "keystone.core.ROUTE_EXPOSES": "uses",
  "keystone.core.DEFINES_TECHNOLOGY": "contains",
};

export class SchemaViewBuilder extends BaseViewBuilder {
  build(): { nodes: IntelligenceVisualNode[]; edges: IntelligenceVisualEdge[] } {
    const seeds = new Set(this.ctx.seeds);
    const directTypeMatch = new Set<string>();
    for (const s of this.snapshot.symbols) {
      if (SCHEMA_NODE_TYPES.has(s.type)) directTypeMatch.add(s.id);
    }

    const relatedIdSet = new Set<string>([...seeds, ...directTypeMatch]);
    for (const rel of this.snapshot.relationships) {
      if (!SCHEMA_REL_TYPES.has(rel.type)) continue;
      if (seeds.has(rel.sourceId) || seeds.has(rel.targetId) || directTypeMatch.has(rel.sourceId) || directTypeMatch.has(rel.targetId)) {
        relatedIdSet.add(rel.sourceId);
        relatedIdSet.add(rel.targetId);
      }
    }

    const rels = this.snapshot.relationships.filter(
      (r) => relatedIdSet.has(r.sourceId) && relatedIdSet.has(r.targetId) && SCHEMA_REL_TYPES.has(r.type),
    );
    const nodes = Array.from(relatedIdSet).map((id) => this.buildNode(id));
    const edges = rels.map((r) =>
      this.buildEdge(r, {
        relationship: REL_TYPE_TO_CANONICAL[r.type] ?? "unknown",
        confidenceCategory: "structural",
      }),
    );
    return { nodes, edges };
  }

  static async build(ctx: BuilderContext) {
    return new SchemaViewBuilder(ctx).build();
  }
}
