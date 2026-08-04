import type {
  KeystoneKnowledgeRelationship,
  KeystoneKnowledgeUnit,
  KeystoneOkfSnapshot
} from "./types";

export interface StructuralCommunity {
  readonly id: string;
  readonly label: string;
  readonly memberIds: readonly string[];
  readonly dominantPaths: readonly string[];
  readonly dominantKinds: readonly string[];
  readonly internalWeight: number;
  readonly boundaryWeight: number;
}

export interface ArchitectureAnchor {
  readonly unitId: string;
  readonly communityId?: string;
  readonly weightedDegree: number;
  readonly incoming: number;
  readonly outgoing: number;
  readonly relationshipComposition: Readonly<Record<string, number>>;
  readonly reason: string;
}

export interface StructuralAnalysis {
  readonly version: 1;
  readonly algorithm: "deterministic-weighted-louvain";
  readonly generatedFrom: string;
  readonly assignments: Readonly<Record<string, string>>;
  readonly communities: readonly StructuralCommunity[];
  readonly anchors: readonly ArchitectureAnchor[];
}

export interface StructuralPath {
  readonly entityIds: readonly string[];
  readonly communityIds: readonly string[];
  readonly relationshipKinds: readonly string[];
}

const RELATIONSHIP_WEIGHT: Readonly<Record<string, number>> = {
  imports: 3,
  "depends-on": 3,
  calls: 3,
  reads: 2.5,
  writes: 2.5,
  exposes: 2,
  implements: 2,
  extends: 1.5,
  "flows-to": 2,
  publishes: 2,
  subscribes: 2,
  contains: 0.35,
  defines: 0.45,
  "configured-by": 0.5,
  "documented-by": 0.2,
  "maps-to": 0.75,
  tests: 0.25,
  covers: 0.25
};

const NOISY_KINDS = new Set([
  "configuration",
  "contract",
  "message",
  "documentation",
  "package-manager",
  "build-system"
]);
const ARCHITECTURAL_KINDS = new Set([
  "service",
  "api",
  "repository",
  "controller",
  "event",
  "component",
  "architecture-boundary",
  "module",
  "package",
  "infrastructure",
  "database",
  "table",
  "orm-entity",
  "query",
  "handler",
  "middleware",
  "symbol",
  "file"
]);

export function analyzeOkfStructure(snapshot: KeystoneOkfSnapshot): StructuralAnalysis {
  const units = snapshot.units.filter(
    (unit) => unit.lifecycle === "active" && isStructuralUnit(unit)
  );
  const byId = new Map(units.map((unit) => [unit.id, unit]));
  const edges = snapshot.relationships.filter(
    (rel) =>
      rel.lifecycle === "active" &&
      byId.has(rel.sourceId) &&
      byId.has(rel.targetId) &&
      rel.sourceId !== rel.targetId &&
      RELATIONSHIP_WEIGHT[rel.kind] !== undefined
  );
  const adjacency = new Map<string, Map<string, number>>();
  const degrees = new Map<string, number>();
  for (const unit of units) adjacency.set(unit.id, new Map());
  for (const edge of edges) {
    const weight = RELATIONSHIP_WEIGHT[edge.kind];
    const left = adjacency.get(edge.sourceId)!;
    const right = adjacency.get(edge.targetId)!;
    left.set(edge.targetId, (left.get(edge.targetId) ?? 0) + weight);
    right.set(edge.sourceId, (right.get(edge.sourceId) ?? 0) + weight);
    degrees.set(edge.sourceId, (degrees.get(edge.sourceId) ?? 0) + weight);
    degrees.set(edge.targetId, (degrees.get(edge.targetId) ?? 0) + weight);
  }

  // A single deterministic Louvain pass is enough for repository-scale subsystem discovery.
  // High-degree noise is prevented from attracting the whole graph by its capped influence.
  const labels = new Map(units.map((unit) => [unit.id, unit.id]));
  for (let pass = 0; pass < 12; pass += 1) {
    let moved = false;
    for (const unit of [...units].sort((a, b) => a.id.localeCompare(b.id))) {
      const current = labels.get(unit.id)!;
      const scores = new Map<string, number>();
      for (const [neighbor, rawWeight] of adjacency.get(unit.id) ?? []) {
        const neighborUnit = byId.get(neighbor)!;
        const hubPenalty = Math.max(0.35, Math.min(1, 6 / Math.max(6, degrees.get(neighbor) ?? 0)));
        const noisePenalty = NOISY_KINDS.has(neighborUnit.kind) ? 0.45 : 1;
        const score = rawWeight * hubPenalty * noisePenalty;
        const community = labels.get(neighbor)!;
        scores.set(community, (scores.get(community) ?? 0) + score);
      }
      const best = [...scores.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))[0];
      if (best && best[1] > (scores.get(current) ?? 0) + 0.0001) {
        labels.set(unit.id, best[0]);
        moved = true;
      }
    }
    if (!moved) break;
  }

  const groups = new Map<string, KeystoneKnowledgeUnit[]>();
  for (const unit of units) {
    const id = labels.get(unit.id)!;
    groups.set(id, [...(groups.get(id) ?? []), unit]);
  }
  const orderedGroups = [...groups.values()].sort((a, b) =>
    (b.length - a.length) || a[0].id.localeCompare(b[0].id)
  );
  const canonicalIds = new Map<string, string>();
  orderedGroups.forEach((members, index) => {
    const id = `community:${String(index + 1).padStart(3, "0")}`;
    for (const member of members) canonicalIds.set(member.id, id);
  });
  const assignments: Record<string, string> = {};
  for (const unit of units) assignments[unit.id] = canonicalIds.get(unit.id)!;

  const communities = orderedGroups.map((members) => {
    const id = canonicalIds.get(members[0].id)!;
    const internal = edges.filter((edge) => assignments[edge.sourceId] === id && assignments[edge.targetId] === id);
    const boundary = edges.filter((edge) => assignments[edge.sourceId] === id && assignments[edge.targetId] !== id);
    return {
      id,
      label: communityLabel(members),
      memberIds: members.map((member) => member.id).sort(),
      dominantPaths: dominantPaths(members),
      dominantKinds: dominantKinds(members),
      internalWeight: round(internal.reduce((sum, edge) => sum + RELATIONSHIP_WEIGHT[edge.kind], 0)),
      boundaryWeight: round(boundary.reduce((sum, edge) => sum + RELATIONSHIP_WEIGHT[edge.kind], 0))
    };
  });
  const anchors = units
    .map((unit) => anchorFor(unit, edges, degrees.get(unit.id) ?? 0, assignments[unit.id]))
    .filter((anchor): anchor is ArchitectureAnchor => Boolean(anchor))
    .sort((a, b) => b.weightedDegree - a.weightedDegree || a.unitId.localeCompare(b.unitId))
    .slice(0, 30);
  return {
    version: 1,
    algorithm: "deterministic-weighted-louvain",
    generatedFrom: snapshot.manifest.extractionRunId,
    assignments,
    communities,
    anchors
  };
}

export function shortestStructuralPath(
  snapshot: KeystoneOkfSnapshot,
  sourceId: string,
  targetId: string
): StructuralPath | undefined {
  const active = new Set(snapshot.units.filter((unit) => unit.lifecycle === "active").map((unit) => unit.id));
  if (!active.has(sourceId) || !active.has(targetId)) return undefined;
  const queue = [sourceId];
  const previous = new Map<string, { id: string; kind: string }>();
  while (queue.length) {
    const current = queue.shift()!;
    if (current === targetId) break;
    for (const rel of snapshot.relationships
      .filter((item) => item.lifecycle === "active" && RELATIONSHIP_WEIGHT[item.kind] !== undefined)
      .sort((a, b) => a.id.localeCompare(b.id))) {
      const next = rel.sourceId === current ? rel.targetId : rel.targetId === current ? rel.sourceId : undefined;
      if (!next || !active.has(next) || previous.has(next) || next === sourceId) continue;
      previous.set(next, { id: current, kind: rel.kind });
      queue.push(next);
    }
  }
  if (sourceId !== targetId && !previous.has(targetId)) return undefined;
  const entityIds: string[] = [];
  const relationshipKinds: string[] = [];
  for (let current: string | undefined = targetId; current; current = previous.get(current)?.id) {
    entityIds.unshift(current);
    const step = previous.get(current);
    if (step) relationshipKinds.unshift(step.kind);
    if (current === sourceId) break;
  }
  const analysis = analyzeOkfStructure(snapshot);
  return {
    entityIds,
    communityIds: [...new Set(entityIds.map((id) => analysis.assignments[id]).filter(Boolean))],
    relationshipKinds
  };
}

function anchorFor(
  unit: KeystoneKnowledgeUnit,
  edges: readonly KeystoneKnowledgeRelationship[],
  weightedDegree: number,
  communityId: string
): ArchitectureAnchor | undefined {
  if (weightedDegree < 4 || !ARCHITECTURAL_KINDS.has(unit.kind) || noisyName(unit.name)) return undefined;
  if (/^(get|set|add|remove|find|map|parse|format|to|from|includes|index|replace|load|save|read|write|resolve|create|update|delete|render|handle)$/i.test(unit.name)) return undefined;
  if (unit.kind === "package" && /^(node:|@types\/|react$|react-dom$)/i.test(unit.name)) return undefined;
  const related = edges.filter((edge) => edge.sourceId === unit.id || edge.targetId === unit.id);
  const composition: Record<string, number> = {};
  for (const edge of related) composition[edge.kind] = (composition[edge.kind] ?? 0) + 1;
  const meaningful = Object.entries(composition).filter(([kind]) => !["contains", "defines", "tests", "covers"].includes(kind));
  if (!meaningful.length) return undefined;
  const meaningfulDegree = related
    .filter((edge) => !["contains", "defines", "tests", "covers"].includes(edge.kind))
    .reduce((sum, edge) => sum + RELATIONSHIP_WEIGHT[edge.kind], 0);
  if (meaningfulDegree < 4) return undefined;
  const incoming = related.filter((edge) => edge.targetId === unit.id).length;
  const outgoing = related.filter((edge) => edge.sourceId === unit.id).length;
  const topKinds = meaningful.sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).slice(0, 3).map(([kind, count]) => `${count} ${kind}`);
  return {
    unitId: unit.id,
    communityId,
    weightedDegree: round(meaningfulDegree),
    incoming,
    outgoing,
    relationshipComposition: Object.fromEntries(Object.entries(composition).sort()),
    reason: `${unit.kind} junction with ${related.length} relationships, chiefly ${topKinds.join(", ")}.`
  };
}

function noisyName(name: string): boolean {
  return /(^|[./_-])(util|utils|logger|logging|di|container|dto|types?|base|common)([./_-]|$)/i.test(name);
}
function isStructuralUnit(unit: KeystoneKnowledgeUnit): boolean {
  if (!ARCHITECTURAL_KINDS.has(unit.kind)) return false;
  const path = unitPath(unit);
  return !/(^|\/)(docs?|documentation|test|tests|fixtures?)(\/|$)/i.test(path) &&
    !/(^|\/)([^/]+\.)?(test|spec)\.[^.]+$/i.test(path);
}
function unitPath(unit: KeystoneKnowledgeUnit): string {
  return String(unit.properties.path ?? unit.properties.filePath ?? "");
}
function dominantPaths(units: readonly KeystoneKnowledgeUnit[]): string[] {
  const counts = new Map<string, number>();
  for (const unit of units) {
    const path = unitPath(unit).split("/").slice(0, 2).join("/");
    if (path) counts.set(path, (counts.get(path) ?? 0) + 1);
  }
  return [...counts.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).slice(0, 3).map(([path]) => path);
}
function dominantKinds(units: readonly KeystoneKnowledgeUnit[]): string[] {
  const counts = new Map<string, number>();
  for (const unit of units) counts.set(unit.kind, (counts.get(unit.kind) ?? 0) + 1);
  return [...counts.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).slice(0, 3).map(([kind]) => kind);
}
function communityLabel(units: readonly KeystoneKnowledgeUnit[]): string {
  const paths = dominantPaths(units);
  const kinds = dominantKinds(units);
  if (paths[0]) return `Subsystem · ${paths[0]}${kinds[0] ? ` / ${kinds[0]}` : ""}`;
  const names = units.filter((unit) => ARCHITECTURAL_KINDS.has(unit.kind)).map((unit) => unit.name).sort();
  return `Subsystem · ${(names[0] ?? units[0].name).split(/[.:/]/)[0]}`;
}
function round(value: number): number { return Math.round(value * 100) / 100; }
