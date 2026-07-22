import type { IntelligenceSnapshotReader } from "../../persistence/IntelligenceStore";
import type {
  IntelligenceEvidenceRecord,
  IntelligenceFileRecord,
  IntelligenceRelationshipRecord,
  IntelligenceSnapshot,
  IntelligenceSymbolRecord,
} from "../../../shared/contracts/intelligence";
import {
  INTELLIGENCE_CANVAS_RELATIONSHIPS,
  type IntelligenceCanvasEdge,
  type IntelligenceCanvasNode,
  type IntelligenceCanvasRelationship,
  type IntelligenceCanvasSearchItem,
  type IntelligenceGraphSlice,
  type IntelligenceGraphSliceRequest,
} from "../../../shared/contracts/intelligenceCanvas";
import { fileKind, isInferred, relationshipKind, symbolKind } from "../visualization/mapping";
import { ArchitectureViewBuilder } from "../visualization/ArchitectureViewBuilder";

export class IntelligenceCanvasError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "IntelligenceCanvasError";
  }
}

type Entity = IntelligenceSymbolRecord | IntelligenceFileRecord;
type CanonicalRelationship = IntelligenceCanvasEdge;

const MAX_DEPTH = 4;
const MAX_NODES = 200;
const MAX_EDGES = 400;

export class IntelligenceGraphSliceService {
  constructor(private readonly snapshots: IntelligenceSnapshotReader) {}

  searchEntities(input: { query: string; limit: number }): {
    items: IntelligenceCanvasSearchItem[];
    intelligenceRevision: string;
    stale: boolean;
  } {
    const snapshot = this.requireSnapshot();
    const query = input.query.trim().toLocaleLowerCase();
    const limit = Math.max(1, Math.min(input.limit, 50));
    if (!query) return { items: [], intelligenceRevision: revision(snapshot), stale: false };

    let ranked = this.entities(snapshot)
      .map((entity, order) => ({ item: this.searchItem(snapshot, entity, query), order }))
      .filter((entry): entry is { item: IntelligenceCanvasSearchItem; order: number } => Boolean(entry.item))
      .sort((left, right) => right.item.matchScore - left.item.matchScore || left.order - right.order);
    const bestPrefixLength = Math.min(...ranked
      .filter(({ item }) => item.matchScore === .8)
      .map(({ item }) => item.label.length), Number.POSITIVE_INFINITY);
    ranked = ranked.filter(({ item }) => item.matchScore !== .8 || item.label.length === bestPrefixLength);
    const items = ranked
      .slice(0, limit)
      .map(({ item }) => item);
    return { items, intelligenceRevision: revision(snapshot), stale: false };
  }

  getGraphSlice(input: IntelligenceGraphSliceRequest): IntelligenceGraphSlice {
    const snapshot = this.requireSnapshot();
    this.validateRequest(input, snapshot);
    if (input.mode === "architecture") return this.architectureSlice(snapshot, input);
    const canonical = this.canonicalRelationships(snapshot)
      .filter((edge) => edge.confidence >= input.minimumConfidence)
      .filter((edge) => this.relationshipAllowed(edge.relationshipType, input.relationshipTypes, input.mode));
    const entityMap = new Map(this.entities(snapshot).map((entity) => [entity.id, entity]));
    const selected = new Set(input.rootEntityIds);
    let frontier = [...input.rootEntityIds];
    const chosenEdges: CanonicalRelationship[] = [];
    let nodeLimitReached = false;
    let edgeLimitReached = false;
    const expandable = new Set<string>();

    for (let level = 0; level < input.depth && frontier.length > 0; level += 1) {
      const next: string[] = [];
      for (const root of frontier) {
        const adjacent = canonical.filter((edge) =>
          (input.direction !== "inbound" && edge.sourceId === root)
          || (input.direction !== "outbound" && edge.targetId === root));
        for (const edge of adjacent) {
          const other = edge.sourceId === root ? edge.targetId : edge.sourceId;
          if (!entityMap.has(other)) continue;
          if (!selected.has(other) && selected.size >= input.maxNodes) {
            nodeLimitReached = true;
            expandable.add(root);
            continue;
          }
          if (!chosenEdges.some((item) => item.id === edge.id) && chosenEdges.length >= input.maxEdges) {
            edgeLimitReached = true;
            expandable.add(root);
            continue;
          }
          if (!selected.has(other)) {
            selected.add(other);
            next.push(other);
          }
          if (!chosenEdges.some((item) => item.id === edge.id)) chosenEdges.push(edge);
        }
      }
      frontier = next;
    }

    for (const id of selected) {
      if (canonical.some((edge) => edge.sourceId === id && !selected.has(edge.targetId))) expandable.add(id);
      if (canonical.some((edge) => edge.targetId === id && !selected.has(edge.sourceId))) expandable.add(id);
    }
    const nodes = [...selected]
      .map((id) => entityMap.get(id))
      .filter((entity): entity is Entity => Boolean(entity))
      .map((entity) => this.node(snapshot, entity, canonical));
    return {
      rootEntityIds: [...input.rootEntityIds],
      nodes,
      edges: chosenEdges,
      request: {
        mode: input.mode,
        direction: input.direction,
        depth: input.depth,
        relationshipTypes: [...input.relationshipTypes],
        maxNodes: input.maxNodes,
        maxEdges: input.maxEdges,
        minimumConfidence: input.minimumConfidence,
      },
      truncation: {
        truncated: nodeLimitReached || edgeLimitReached,
        nodeLimitReached,
        edgeLimitReached,
        expandableEntityIds: [...expandable],
      },
      intelligenceRevision: revision(snapshot),
    };
  }

  getEvidence(ids: string[]): { items: Array<{
    id: string; filePath: string; range?: IntelligenceEvidenceRecord["range"]; provider: string;
    evidenceType: string; excerpt: string; confidence: number;
  }>; intelligenceRevision: string } {
    const snapshot = this.requireSnapshot();
    const requested = new Set(ids);
    return {
      items: snapshot.evidence.filter((item) => requested.has(item.id)).map((item) => ({
        id: item.id,
        filePath: item.relativePath,
        range: item.range,
        provider: item.extractorId,
        evidenceType: item.sourceKind,
        excerpt: item.statement,
        confidence: item.confidence,
      })),
      intelligenceRevision: revision(snapshot),
    };
  }

  getEvidenceSource(evidenceId: string, intelligenceRevision: string): { filePath: string; range?: IntelligenceEvidenceRecord["range"] } {
    const snapshot = this.requireSnapshot();
    if (intelligenceRevision !== revision(snapshot)) throw new IntelligenceCanvasError("The requested Intelligence revision is stale. Refresh the result.");
    const evidence = snapshot.evidence.find((item) => item.id === evidenceId);
    if (!evidence) throw new IntelligenceCanvasError("Source evidence is unavailable for this relationship.");
    return { filePath: evidence.relativePath, range: evidence.range };
  }

  findPath(sourceId: string, targetId: string, maxDepth: number): {
    entityIds: string[]; edgeIds: string[]; evidenceIds: string[];
  } | undefined {
    const snapshot = this.requireSnapshot();
    const edges = this.canonicalRelationships(snapshot);
    const queue: Array<{ entityIds: string[]; edges: CanonicalRelationship[] }> = [{ entityIds: [sourceId], edges: [] }];
    const seen = new Set([sourceId]);
    while (queue.length) {
      const current = queue.shift()!;
      const tail = current.entityIds[current.entityIds.length - 1]!;
      if (tail === targetId) return {
        entityIds: current.entityIds,
        edgeIds: current.edges.map((edge) => edge.id),
        evidenceIds: current.edges.flatMap((edge) => edge.evidenceIds),
      };
      if (current.edges.length >= maxDepth) continue;
      for (const edge of edges.filter((item) => item.sourceId === tail)) {
        if (seen.has(edge.targetId)) continue;
        seen.add(edge.targetId);
        queue.push({ entityIds: [...current.entityIds, edge.targetId], edges: [...current.edges, edge] });
      }
    }
    return undefined;
  }

  currentRevision(): string { return revision(this.requireSnapshot()); }

  getEntity(entityId: string, intelligenceRevision?: string): IntelligenceCanvasNode {
    const snapshot = this.requireSnapshot();
    if (intelligenceRevision && intelligenceRevision !== revision(snapshot)) throw new IntelligenceCanvasError("The requested Intelligence revision is stale. Refresh the result.");
    const entity = this.entities(snapshot).find((item) => item.id === entityId);
    if (!entity) throw new IntelligenceCanvasError(`Unknown Intelligence entity: ${entityId}`);
    return this.node(snapshot, entity, this.canonicalRelationships(snapshot));
  }

  describePath(input: { entityIds: string[]; edgeIds: string[]; evidenceIds: string[]; intelligenceRevision: string }): {
    label: string; content: string; entityIds: string[]; edgeIds: string[]; evidenceIds: string[]; intelligenceRevision: string;
  } {
    const snapshot = this.requireSnapshot();
    if (input.intelligenceRevision !== revision(snapshot)) throw new IntelligenceCanvasError("The requested Intelligence revision is stale. Refresh the result.");
    if (input.entityIds.length < 2 || input.entityIds.length > 20 || input.edgeIds.length !== input.entityIds.length - 1) throw new IntelligenceCanvasError("The selected flow path is not a valid bounded path.");
    const entities = input.entityIds.map((id) => this.getEntity(id, input.intelligenceRevision));
    const edges = this.canonicalRelationships(snapshot);
    const pathEdges = input.edgeIds.map((id, index) => {
      const edge = edges.find((candidate) => candidate.id === id && candidate.sourceId === input.entityIds[index] && candidate.targetId === input.entityIds[index + 1]);
      if (!edge) throw new IntelligenceCanvasError("The selected flow path no longer matches stored Intelligence relationships.");
      return edge;
    });
    const actualEvidence = [...new Set(pathEdges.flatMap((edge) => edge.evidenceIds))];
    if (input.evidenceIds.some((id) => !actualEvidence.includes(id))) throw new IntelligenceCanvasError("The selected flow contains evidence that is not attached to the stored path.");
    const evidenceById = new Map(snapshot.evidence.map((item) => [item.id, item]));
    const label = `Flow: ${entities.map((entity) => entity.qualifiedLabel).join(" → ")}`;
    const steps = pathEdges.map((edge, index) => `${index + 1}. ${entities[index]!.qualifiedLabel} ${edge.relationshipType} ${entities[index + 1]!.qualifiedLabel}`);
    const evidence = actualEvidence.map((id) => evidenceById.get(id)).filter((item): item is IntelligenceEvidenceRecord => Boolean(item)).map((item) => `- ${item.relativePath}${item.range ? `:${item.range.startLine + 1}–${item.range.endLine + 1}` : ""} (${item.extractorId})`);
    return { label, content: `${label}\n\nSteps:\n${steps.join("\n")}\n\nEvidence:\n${evidence.length ? evidence.join("\n") : "- Stored relationship evidence has no source location."}\n\nStatic Intelligence path at revision ${revision(snapshot)}; runtime order is not claimed.`, entityIds: [...input.entityIds], edgeIds: [...input.edgeIds], evidenceIds: actualEvidence, intelligenceRevision: revision(snapshot) };
  }

  private validateRequest(input: IntelligenceGraphSliceRequest, snapshot: IntelligenceSnapshot): void {
    if (!input.rootEntityIds.length) throw new IntelligenceCanvasError("At least one root entity is required.");
    const ids = new Set(this.entities(snapshot).map((entity) => entity.id));
    const missing = input.rootEntityIds.find((id) => !ids.has(id));
    if (missing) throw new IntelligenceCanvasError(`Unknown Intelligence entity: ${missing}`);
    if (input.intelligenceRevision && input.intelligenceRevision !== revision(snapshot)) {
      throw new IntelligenceCanvasError("The requested Intelligence revision is stale. Refresh the result.");
    }
    if (!Number.isInteger(input.depth) || input.depth < 1 || input.depth > MAX_DEPTH) {
      throw new IntelligenceCanvasError(`Graph depth must be between 1 and ${MAX_DEPTH}.`);
    }
    if (!Number.isInteger(input.maxNodes) || input.maxNodes < input.rootEntityIds.length || input.maxNodes > MAX_NODES) {
      throw new IntelligenceCanvasError(`Node limit must be between the root count and ${MAX_NODES}.`);
    }
    if (!Number.isInteger(input.maxEdges) || input.maxEdges < 1 || input.maxEdges > MAX_EDGES) {
      throw new IntelligenceCanvasError(`Edge limit must be between 1 and ${MAX_EDGES}.`);
    }
    const supported = new Set<string>(INTELLIGENCE_CANVAS_RELATIONSHIPS);
    const unsupported = input.relationshipTypes.find((type) => !supported.has(type));
    if (unsupported) throw new IntelligenceCanvasError(`Unsupported relationship: ${unsupported}`);
    if (input.minimumConfidence < 0 || input.minimumConfidence > 1) throw new IntelligenceCanvasError("Minimum confidence must be between 0 and 1.");
  }

  private requireSnapshot(): IntelligenceSnapshot {
    const snapshot = this.snapshots.getSnapshot();
    if (!snapshot) throw new IntelligenceCanvasError("Repository Intelligence is not indexed yet.");
    return snapshot;
  }

  private entities(snapshot: IntelligenceSnapshot): Entity[] { return [...snapshot.symbols, ...snapshot.files]; }

  private searchItem(snapshot: IntelligenceSnapshot, entity: Entity, query: string): IntelligenceCanvasSearchItem | undefined {
    const symbol = isSymbol(entity) ? entity : undefined;
    const file = symbol ? snapshot.files.find((item) => item.id === symbol.fileId) : entity as IntelligenceFileRecord;
    if (!file) return undefined;
    const label = symbol?.name ?? file.relativePath.split("/").at(-1)!;
    const qualifiedLabel = symbol?.qualifiedName ?? file.relativePath;
    const haystacks = [label, qualifiedLabel, file.relativePath].map((value) => value.toLocaleLowerCase());
    if (!haystacks.some((value) => value.includes(query))) return undefined;
    const score = haystacks[0] === query ? 1 : haystacks[1] === query || haystacks[2] === query ? .95
      : haystacks.some((value) => value.startsWith(query)) ? .8 : .6;
    return {
      id: entity.id,
      label,
      qualifiedLabel,
      kind: symbol ? symbolKind(symbol.type) : fileKind(file),
      filePath: file.relativePath,
      range: symbol?.range,
      matchScore: score,
      context: `${symbol ? symbolKind(symbol.type) : fileKind(file)} · ${file.relativePath}${symbol ? `:${symbol.range.startLine + 1}` : ""}`,
    };
  }

  private node(snapshot: IntelligenceSnapshot, entity: Entity, edges: CanonicalRelationship[]): IntelligenceCanvasNode {
    const symbol = isSymbol(entity) ? entity : undefined;
    const file = symbol ? snapshot.files.find((item) => item.id === symbol.fileId) : entity as IntelligenceFileRecord;
    if (!file) throw new IntelligenceCanvasError(`Entity ${entity.id} refers to an unavailable file.`);
    const inbound = edges.some((edge) => edge.targetId === entity.id);
    const outbound = edges.some((edge) => edge.sourceId === entity.id);
    return {
      id: entity.id,
      label: symbol?.name ?? file.relativePath.split("/").at(-1)!,
      qualifiedLabel: symbol?.qualifiedName ?? file.relativePath,
      kind: symbol ? symbolKind(symbol.type) : fileKind(file),
      filePath: file.relativePath,
      range: symbol?.range,
      confidence: symbol?.confidence ?? 1,
      inferred: false,
      expandable: { inbound, outbound },
    };
  }

  private canonicalRelationships(snapshot: IntelligenceSnapshot): CanonicalRelationship[] {
    const groups = new Map<string, { records: IntelligenceRelationshipRecord[]; type: IntelligenceCanvasRelationship; sourceId: string; targetId: string }>();
    for (const relationship of snapshot.relationships) {
      let type = canonicalRelationship(relationship.type);
      if (!type) continue;
      let sourceId = relationship.sourceId;
      let targetId = relationship.targetId;
      if (type === "tested-by") [sourceId, targetId] = [targetId, sourceId];
      const key = `${sourceId}\0${targetId}\0${type}`;
      const group = groups.get(key) ?? { records: [], type, sourceId, targetId };
      group.records.push(relationship);
      groups.set(key, group);
    }
    return [...groups.values()].map(({ records, type, sourceId, targetId }) => {
      records.sort((left, right) => left.id.localeCompare(right.id));
      return {
        id: records[0]!.id,
        sourceId,
        targetId,
        relationshipType: type,
        label: type,
        confidence: Math.max(...records.map((record) => record.confidence)),
        inferred: records.some(isInferred),
        evidenceIds: [...new Set(records.flatMap((record) => record.evidenceIds))],
      };
    }).sort((left, right) => left.id.localeCompare(right.id));
  }

  private architectureSlice(snapshot: IntelligenceSnapshot, input: IntelligenceGraphSliceRequest): IntelligenceGraphSlice {
    const built = new ArchitectureViewBuilder({ snapshot, seeds: input.rootEntityIds, direction: input.direction, maxDepth: input.depth }).build();
    const nodeLimitReached = built.nodes.length > input.maxNodes;
    const retainedNodes = built.nodes.slice(0, input.maxNodes);
    const retainedIds = new Set(retainedNodes.map((node) => node.entityId));
    const eligibleEdges = built.edges.filter((edge) => retainedIds.has(stripNodeId(edge.sourceNodeId)) && retainedIds.has(stripNodeId(edge.targetNodeId)));
    const edgeLimitReached = eligibleEdges.length > input.maxEdges;
    const nodes: IntelligenceCanvasNode[] = retainedNodes.map((node) => ({
      id: node.entityId, label: node.label, qualifiedLabel: node.label, kind: node.kind,
      filePath: node.source?.filePath ?? "", range: node.source?.startLine === undefined ? undefined : { startLine: node.source.startLine, startColumn: 0, endLine: node.source.endLine ?? node.source.startLine, endColumn: 0 },
      confidence: node.confidence, inferred: false, expandable: { inbound: false, outbound: node.entityId === snapshot.repository.id || node.entityId !== input.rootEntityIds[0] },
    }));
    const edges: IntelligenceCanvasEdge[] = eligibleEdges.slice(0, input.maxEdges).map((edge) => ({
      id: edge.id, sourceId: stripNodeId(edge.sourceNodeId), targetId: stripNodeId(edge.targetNodeId),
      relationshipType: edge.relationship === "inherits" ? "extends" : edge.relationship === "tests" || edge.relationship === "covers" ? "tested-by" : isCanvasRelationship(edge.relationship) ? edge.relationship : "unknown",
      label: edge.relationship, confidence: edge.confidence, inferred: edge.state.inferred, evidenceIds: edge.evidenceIds,
    }));
    const expandableEntityIds = nodeLimitReached || edgeLimitReached ? nodes.filter((node) => node.expandable.outbound).map((node) => node.id) : [];
    return { rootEntityIds: [...input.rootEntityIds], nodes, edges, request: { mode: input.mode, direction: input.direction, depth: input.depth, relationshipTypes: [...input.relationshipTypes], maxNodes: input.maxNodes, maxEdges: input.maxEdges, minimumConfidence: input.minimumConfidence }, truncation: { truncated: nodeLimitReached || edgeLimitReached, nodeLimitReached, edgeLimitReached, expandableEntityIds }, intelligenceRevision: revision(snapshot) };
  }

  private relationshipAllowed(type: IntelligenceCanvasRelationship, requested: string[], mode: IntelligenceGraphSliceRequest["mode"]): boolean {
    if (requested.includes(type)) return true;
    if (mode === "calls" && requested.includes("calls") && type === "routes-to") return true;
    return false;
  }
}

function canonicalRelationship(raw: string): IntelligenceCanvasRelationship | undefined {
  const mapped = relationshipKind(raw);
  if (mapped === "tests" || mapped === "covers") return "tested-by";
  if (mapped === "inherits") return "extends";
  if (mapped === "contains" || mapped === "imports" || mapped === "depends-on" || mapped === "calls"
    || mapped === "implements" || mapped === "routes-to" || mapped === "reads" || mapped === "writes") return mapped;
  return undefined;
}

function revision(snapshot: IntelligenceSnapshot): string { return String(snapshot.manifest.generation); }

function isSymbol(entity: Entity): entity is IntelligenceSymbolRecord { return "qualifiedName" in entity; }
function stripNodeId(id: string): string { return id.startsWith("n:") ? id.slice(2) : id; }
function isCanvasRelationship(value: string): value is IntelligenceCanvasRelationship { return (INTELLIGENCE_CANVAS_RELATIONSHIPS as readonly string[]).includes(value); }
