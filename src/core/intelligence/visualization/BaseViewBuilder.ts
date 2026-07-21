/**
 * Base utilities shared by all view builders.
 *
 * A view builder consumes the existing IntelligenceSnapshot (the single source
 * of truth) and produces canonical IntelligenceVisualNode / IntelligenceVisualEdge
 * arrays. It never re-ingests; it reads parsed records only.
 */
import type {
  IntelligenceSnapshot,
  IntelligenceSymbolRecord,
  IntelligenceFileRecord,
  IntelligenceRelationshipRecord,
} from "../../../shared/contracts/intelligence";
import type {
  IntelligenceVisualNode,
  IntelligenceVisualEdge,
  IntelligenceRelationship,
  IntelligenceNodeKind,
} from "../../../shared/contracts/visualization";
import {
  nodeIdForEntity,
  edgeIdForRelationship,
  relationshipKind,
  confidenceCategoryFor,
  isUnresolved,
  isInferred,
  nodeKindForEntity,
} from "./mapping";

export interface BuilderContext {
  snapshot: IntelligenceSnapshot;
  /** seed entity ids (already resolved). */
  seeds: string[];
  direction: "inbound" | "outbound" | "both";
  maxDepth: number;
  changedEntityIds?: string[];
}

export abstract class BaseViewBuilder {
  protected snapshot: IntelligenceSnapshot;
  protected ctx: BuilderContext;

  constructor(ctx: BuilderContext) {
    this.snapshot = ctx.snapshot;
    this.ctx = ctx;
  }

  protected symbolById(id: string): IntelligenceSymbolRecord | undefined {
    return this.snapshot.symbols.find((s) => s.id === id);
  }
  protected fileById(id: string): IntelligenceFileRecord | undefined {
    return this.snapshot.files.find((f) => f.id === id);
  }

  protected buildNode(
    entityId: string,
    overrides: Partial<IntelligenceVisualNode> = {},
  ): IntelligenceVisualNode {
    const symbol = this.symbolById(entityId);
    const file = this.fileById(entityId);
    const kind: IntelligenceNodeKind = nodeKindForEntity(symbol, file);
    const label = symbol?.name ?? file?.relativePath ?? entityId;
    const secondary = symbol ? file?.relativePath : file?.category;
    return {
      id: nodeIdForEntity(entityId),
      entityId,
      kind,
      label,
      secondaryLabel: secondary,
      description: symbol?.signature,
      source: symbol
        ? {
            filePath: file?.relativePath,
            startLine: symbol.range?.startLine,
            endLine: symbol.range?.endLine,
            symbolId: symbol.id,
          }
        : file
          ? { filePath: file.relativePath }
          : undefined,
      confidence: symbol?.confidence ?? 1,
      evidenceIds: symbol?.evidenceIds ?? file?.evidenceIds ?? [],
      state: {
        selected: this.ctx.seeds.includes(entityId),
        expanded: false,
        highlighted: false,
        changed: (this.ctx.changedEntityIds ?? []).includes(entityId),
        impacted: false,
        unresolved: false,
        stale: false,
        ...overrides.state,
      },
      metrics: {
        packageId: file?.packageId ?? "",
        moduleId: file?.moduleId ?? "",
        ...overrides.metrics,
      },
      ...overrides,
    };
  }

  protected buildEdge(
    rel: IntelligenceRelationshipRecord,
    overrides: Partial<IntelligenceVisualEdge> = {},
  ): IntelligenceVisualEdge {
    const relationship: IntelligenceRelationship = relationshipKind(rel.type);
    const unresolved = isUnresolved(rel);
    const inferred = isInferred(rel);
    return {
      id: edgeIdForRelationship(rel.id),
      sourceNodeId: nodeIdForEntity(rel.sourceId),
      targetNodeId: nodeIdForEntity(rel.targetId),
      relationship,
      direction: "forward",
      confidence: rel.confidence,
      evidenceIds: rel.evidenceIds,
      confidenceCategory: confidenceCategoryFor(rel),
      state: {
        highlighted: false,
        inferred,
        unresolved,
        collapsed: false,
        ...overrides.state,
      },
      metrics: {
        ...(rel.properties as Record<string, string | number | boolean>),
        ...overrides.metrics,
      },
      ...overrides,
    };
  }

  /** Collect all relationship records relevant to the traversed entity set. */
  protected relationshipsTouching(entityIds: Set<string>): IntelligenceRelationshipRecord[] {
    return this.snapshot.relationships.filter(
      (rel) => entityIds.has(rel.sourceId) || entityIds.has(rel.targetId),
    );
  }

  abstract build(): { nodes: IntelligenceVisualNode[]; edges: IntelligenceVisualEdge[] };
}
