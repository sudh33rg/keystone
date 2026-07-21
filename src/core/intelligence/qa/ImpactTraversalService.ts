/**
 * ImpactTraversalService (spec §9, §10, §11, §12).
 *
 * Bounded, stage-aware traversal of the existing IntelligenceSnapshot relationships from
 * change roots. Produces ImpactedEntity[] + ImpactPath[] with category, distance,
 * relationship path, confidence, and evidence. Never invents relationships.
 */
import type {
  IntelligenceSnapshot,
  IntelligenceRelationshipRecord,
} from "../../../shared/contracts/intelligence";
import type {
  ChangedSymbol,
  ImpactCategory,
  ImpactedEntity,
  ImpactPath,
} from "../../../shared/contracts/qaLifecycle";

export interface TraversalConfig {
  traversalDepth: number;
  maximumEntities: number;
  productionOnly: boolean;
  includeTests: boolean;
  includeExternal: boolean;
  confidenceThreshold: number;
  relationshipTypes?: string[];
}

const DEFAULT_CONFIG: TraversalConfig = {
  traversalDepth: 4,
  maximumEntities: 2000,
  productionOnly: false,
  includeTests: true,
  includeExternal: true,
  confidenceThreshold: 0,
};

// Relationship type -> base category for the *target* of an incoming relationship.
const INCOMING_CATEGORY: Record<string, ImpactCategory> = {
  calls: "direct-caller",
  imports: "direct-dependency",
  implements: "interface-implementation",
  inherits: "inherited-consumer",
  reads: "data-reader",
  writes: "data-writer",
  publishes: "event-publisher",
  subscribes: "event-subscriber",
  consumes: "configuration-consumer",
  dependsOn: "direct-dependent",
  references: "contract-consumer",
};

const OUTGOING_CATEGORY: Record<string, ImpactCategory> = {
  calls: "direct-callee",
  imports: "direct-dependency",
  dependsOn: "direct-dependency",
};

export class ImpactTraversalService {
  private readonly snapshot: IntelligenceSnapshot;
  private readonly relBySource = new Map<string, IntelligenceRelationshipRecord[]>();
  private readonly relByTarget = new Map<string, IntelligenceRelationshipRecord[]>();

  constructor(snapshot: IntelligenceSnapshot) {
    this.snapshot = snapshot;
    for (const r of snapshot.relationships) {
      (
        this.relBySource.get(r.sourceId) ?? this.relBySource.set(r.sourceId, []).get(r.sourceId)!
      ).push(r);
      (
        this.relByTarget.get(r.targetId) ?? this.relByTarget.set(r.targetId, []).get(r.targetId)!
      ).push(r);
    }
  }

  run(
    roots: ChangedSymbol[],
    config: Partial<TraversalConfig> = {},
  ): { entities: ImpactedEntity[]; paths: ImpactPath[]; truncated: boolean } {
    const cfg = { ...DEFAULT_CONFIG, ...config };
    const entities = new Map<string, ImpactedEntity>();
    const paths: ImpactPath[] = [];
    const queue: Array<{
      id: string;
      dist: number;
      parents: string[];
      rels: string[];
      relTypes: string[];
    }> = [];
    const visited = new Set<string>();

    for (const root of roots) {
      this.upsert(entities, root.symbolId, {
        distance: 0,
        category: "changed-directly",
        confidence: 1,
        relationshipPath: [],
        productionTestClassification: root.isTest ? "test" : "production",
        isPublicContract: root.isPublicContract,
      });
      queue.push({ id: root.symbolId, dist: 0, parents: [], rels: [], relTypes: [] });
    }

    let truncated = false;
    while (queue.length > 0) {
      const cur = queue.shift()!;
      if (cur.dist >= cfg.traversalDepth) continue;
      if (entities.size >= cfg.maximumEntities) {
        truncated = true;
        break;
      }
      if (visited.has(cur.id)) continue;
      visited.add(cur.id);

      // Incoming (reverse dependencies / callers / consumers).
      for (const r of this.relByTarget.get(cur.id) ?? []) {
        if (cfg.relationshipTypes && !cfg.relationshipTypes.includes(r.type)) continue;
        if (r.confidence < cfg.confidenceThreshold) continue;
        const category = INCOMING_CATEGORY[r.type] ?? "unresolved-possible-impact";
        const next = cur.dist + 1;
        this.upsert(entities, r.sourceId, {
          distance: next,
          category: next === 1 ? category : promote(category),
          confidence: r.confidence,
          relationshipPath: [...cur.rels, r.id],
          productionTestClassification: this.classify(r.sourceId),
          isPublicContract: false,
        });
        this.pushEdge(paths, cur, r, r.sourceId);
        queue.push({
          id: r.sourceId,
          dist: next,
          parents: [...cur.parents, cur.id],
          rels: [...cur.rels, r.id],
          relTypes: [...cur.relTypes, r.type],
        });
      }

      // Outgoing (callees / dependencies) — direct only, to avoid treating every import as equally impacted.
      if (cur.dist === 0) {
        for (const r of this.relBySource.get(cur.id) ?? []) {
          if (cfg.relationshipTypes && !cfg.relationshipTypes.includes(r.type)) continue;
          if (r.confidence < cfg.confidenceThreshold) continue;
          const category = OUTGOING_CATEGORY[r.type] ?? "unresolved-possible-impact";
          this.upsert(entities, r.targetId, {
            distance: 1,
            category,
            confidence: r.confidence,
            relationshipPath: [r.id],
            productionTestClassification: this.classify(r.targetId),
            isPublicContract: false,
          });
          this.pushEdge(paths, cur, r, r.targetId);
          queue.push({
            id: r.targetId,
            dist: 1,
            parents: [...cur.parents, cur.id],
            rels: [r.id],
            relTypes: [r.type],
          });
        }
      }
    }

    // File-level fallback: changed files without resolved symbols still impact the file.
    for (const root of roots) {
      if (!this.snapshot.symbols.some((s) => s.id === root.symbolId)) {
        const file = this.snapshot.files.find((f) => f.relativePath === root.filePath);
        if (file)
          this.upsert(entities, file.id, {
            distance: 0,
            category: "changed-directly",
            confidence: 0.5,
            relationshipPath: [],
            productionTestClassification: "production",
            isPublicContract: false,
          });
      }
    }

    if (!cfg.includeTests)
      for (const e of entities.values())
        if (e.productionTestClassification === "test") entities.delete(e.entityId);
    return { entities: [...entities.values()], paths, truncated };
  }

  private upsert(
    map: Map<string, ImpactedEntity>,
    id: string,
    init: Partial<ImpactedEntity> & {
      distance: number;
      category: ImpactCategory;
      confidence: number;
    },
  ): void {
    const existing = map.get(id);
    if (existing && existing.distance <= init.distance) return;
    const sym = this.snapshot.symbols.find((s) => s.id === id);
    const file = this.snapshot.files.find((f) => f.id === id);
    map.set(id, {
      entityId: id,
      displayName: sym?.name ?? file?.relativePath.split("/").pop() ?? id,
      kind: sym?.type ?? "keystone.core.File",
      filePath: sym
        ? this.snapshot.files.find((f) => f.id === sym.fileId)?.relativePath
        : file?.relativePath,
      category: init.category,
      distance: init.distance,
      relationshipPath: init.relationshipPath ?? [],
      confidence: init.confidence,
      productionTestClassification: init.productionTestClassification ?? "unknown",
      evidence: sym
        ? sym.evidenceIds.map((e) => ({
            id: e,
            kind: "symbol",
            statement: `Symbol evidence for ${sym.name}`,
          }))
        : [],
      affectedFlowIds: [],
      mappedTestIds: [],
      riskContribution: 0,
      isPublicContract: init.isPublicContract ?? false,
    });
  }

  private classify(id: string): "production" | "test" | "unknown" {
    const sym = this.snapshot.symbols.find((s) => s.id === id);
    if (sym) {
      const f = this.snapshot.files.find((x) => x.id === sym.fileId);
      return f?.isTest ? "test" : "production";
    }
    const file = this.snapshot.files.find((f) => f.id === id);
    if (file) return file.isTest ? "test" : "production";
    return "unknown";
  }

  private pushEdge(
    paths: ImpactPath[],
    cur: { id: string; parents: string[] },
    r: IntelligenceRelationshipRecord,
    toId: string,
  ): void {
    if (cur.parents.length === 0) {
      paths.push({
        id: crypto.randomUUID(),
        fromRootId: cur.id,
        toEntityId: toId,
        edges: [r.id],
        relationshipTypes: [r.type],
        confidence: r.confidence,
      });
    }
  }
}

function promote(c: ImpactCategory): ImpactCategory {
  if (c === "direct-caller") return "transitive-caller";
  if (c === "direct-dependent") return "transitive-dependent";
  return c;
}
