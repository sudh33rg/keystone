import type { CodePropertyGraph, CpgEdgeKind } from "../cpg/types";
import { queryOkfSnapshot } from "../okf/queryEngine";
import type {
  KeystoneKnowledgeRelationship,
  KeystoneKnowledgeUnit,
  KeystoneOkfSnapshot,
  OkfEvidence
} from "../okf/types";

export type IntelligenceGraphMode =
  "repository" | "architecture" | "dependencies" | "calls" | "tests" | "impact" | "flows";

export interface IntelligenceExplorerItem {
  readonly id: string;
  readonly label: string;
  readonly kind: string;
  readonly path?: string;
  readonly line?: number;
  readonly description?: string;
  readonly confidence: number;
  readonly evidenceIds: readonly string[];
  readonly incoming: number;
  readonly outgoing: number;
}

export interface IntelligenceExplorerResult {
  readonly query: string;
  readonly kind?: string;
  readonly totalActive: number;
  readonly kindCounts: Readonly<Record<string, number>>;
  readonly items: readonly IntelligenceExplorerItem[];
}

export interface IntelligenceGraphNode {
  readonly id: string;
  readonly label: string;
  readonly kind: string;
  readonly path?: string;
  readonly line?: number;
  readonly confidence: number;
  readonly evidenceIds: readonly string[];
  readonly seed: boolean;
}

export interface IntelligenceGraphEdge {
  readonly id: string;
  readonly sourceId: string;
  readonly targetId: string;
  readonly kind: string;
  readonly confidence: number;
  readonly evidenceIds: readonly string[];
}

export interface IntelligenceGraphResult {
  readonly mode: IntelligenceGraphMode;
  readonly query?: string;
  readonly seedIds: readonly string[];
  readonly nodes: readonly IntelligenceGraphNode[];
  readonly edges: readonly IntelligenceGraphEdge[];
  readonly relationshipKinds: readonly string[];
  readonly truncated: boolean;
  readonly warnings: readonly string[];
}

export interface IntelligenceCpgFile {
  readonly sourcePath: string;
  readonly nodeCount: number;
  readonly edgeCount: number;
  readonly capabilities: CodePropertyGraph["capabilities"];
}

export interface IntelligenceCpgNode {
  readonly id: string;
  readonly label: string;
  readonly kind: string;
  readonly syntaxKind: string;
  readonly path: string;
  readonly line: number;
  readonly okfId?: string;
}

export interface IntelligenceCpgEdge {
  readonly id: string;
  readonly sourceId: string;
  readonly targetId: string;
  readonly kind: CpgEdgeKind;
  readonly okfSourceId?: string;
  readonly okfTargetId?: string;
}

export interface IntelligenceCpgResult {
  readonly files: readonly IntelligenceCpgFile[];
  readonly sourcePath?: string;
  readonly capabilities?: CodePropertyGraph["capabilities"];
  readonly nodes: readonly IntelligenceCpgNode[];
  readonly edges: readonly IntelligenceCpgEdge[];
  readonly edgeKinds: readonly CpgEdgeKind[];
  readonly truncated: boolean;
  readonly warnings: readonly string[];
}

const GRAPH_RELATIONSHIPS: Record<IntelligenceGraphMode, ReadonlySet<string>> = {
  repository: new Set([
    "contains",
    "defines",
    "imports",
    "depends-on",
    "calls",
    "reads",
    "writes",
    "exposes",
    "implements",
    "extends",
    "tests",
    "covers",
    "configured-by",
    "documented-by",
    "flows-to",
    "may-impact"
  ]),
  architecture: new Set([
    "contains",
    "defines",
    "depends-on",
    "exposes",
    "configured-by",
    "documented-by"
  ]),
  dependencies: new Set(["imports", "depends-on", "configured-by"]),
  calls: new Set(["calls", "defines"]),
  tests: new Set(["tests", "covers", "defines"]),
  impact: new Set([
    "may-impact",
    "imports",
    "depends-on",
    "calls",
    "tests",
    "covers",
    "defines",
    "exposes"
  ]),
  flows: new Set(["flows-to", "calls", "reads", "writes", "defines"])
};

const ARCHITECTURE_KINDS = new Set([
  "repository",
  "workspace",
  "module",
  "package",
  "service",
  "api",
  "architecture-boundary",
  "configuration",
  "data-entity"
]);
const FLOW_KINDS = new Set([
  "call-flow",
  "data-flow",
  "symbol",
  "service",
  "api",
  "file",
  "data-entity"
]);

export function exploreOkfSnapshot(
  snapshot: KeystoneOkfSnapshot,
  options: { query?: string; kind?: string; limit?: number } = {}
): IntelligenceExplorerResult {
  const query = options.query?.trim() ?? "";
  const terms = tokenize(query);
  const units = snapshot.units.filter((unit) => unit.lifecycle === "active");
  const kindCounts: Record<string, number> = {};
  for (const unit of units) kindCounts[unit.kind] = (kindCounts[unit.kind] ?? 0) + 1;
  const incoming = new Map<string, number>();
  const outgoing = new Map<string, number>();
  for (const rel of snapshot.relationships.filter((rel) => rel.lifecycle === "active")) {
    outgoing.set(rel.sourceId, (outgoing.get(rel.sourceId) ?? 0) + 1);
    incoming.set(rel.targetId, (incoming.get(rel.targetId) ?? 0) + 1);
  }
  const evidence = new Map(snapshot.evidence.map((item) => [item.id, item]));
  const ranked = units
    .filter((unit) => !options.kind || options.kind === "all" || unit.kind === options.kind)
    .map((unit) => ({ unit, score: explorerScore(unit, query, terms) }))
    .filter((item) => !query || item.score > 0)
    .sort(
      (left, right) =>
        right.score - left.score ||
        (incoming.get(right.unit.id) ?? 0) +
          (outgoing.get(right.unit.id) ?? 0) -
          ((incoming.get(left.unit.id) ?? 0) + (outgoing.get(left.unit.id) ?? 0)) ||
        left.unit.canonicalKey.localeCompare(right.unit.canonicalKey)
    )
    .slice(0, Math.max(1, Math.min(options.limit ?? 100, 250)))
    .map(({ unit }) =>
      toExplorerItem(unit, incoming.get(unit.id) ?? 0, outgoing.get(unit.id) ?? 0, evidence)
    );
  return {
    query,
    kind: options.kind && options.kind !== "all" ? options.kind : undefined,
    totalActive: units.length,
    kindCounts,
    items: ranked
  };
}

export function buildOkfGraphView(
  snapshot: KeystoneOkfSnapshot,
  options: {
    mode?: IntelligenceGraphMode;
    query?: string;
    seedIds?: readonly string[];
    depth?: number;
    limit?: number;
  } = {}
): IntelligenceGraphResult {
  const mode = options.mode ?? "repository";
  const limit = Math.max(20, Math.min(options.limit ?? 180, 400));
  const maxDepth = Math.max(1, Math.min(options.depth ?? 2, 4));
  const units = snapshot.units.filter((unit) => unit.lifecycle === "active");
  const byId = new Map(units.map((unit) => [unit.id, unit]));
  const evidence = new Map(snapshot.evidence.map((item) => [item.id, item]));
  const allowedRelationships = GRAPH_RELATIONSHIPS[mode];
  const hasExplicitFocus = Boolean(options.query?.trim()) || Boolean(options.seedIds?.length);
  const relationships = snapshot.relationships
    .filter(
      (rel) =>
        rel.lifecycle === "active" &&
        allowedRelationships.has(rel.kind) &&
        byId.has(rel.sourceId) &&
        byId.has(rel.targetId)
    )
    .filter(
      (rel) =>
        mode !== "flows" ||
        hasExplicitFocus ||
        ["flows-to", "calls", "reads", "writes"].includes(rel.kind)
    )
    .filter(
      (rel) =>
        mode !== "flows" ||
        hasExplicitFocus ||
        (flowUnitUseful(byId.get(rel.sourceId)) && flowUnitUseful(byId.get(rel.targetId)))
    );
  const adjacency = new Map<string, KeystoneKnowledgeRelationship[]>();
  for (const rel of relationships) {
    const a = adjacency.get(rel.sourceId) ?? [];
    a.push(rel);
    adjacency.set(rel.sourceId, a);
    const b = adjacency.get(rel.targetId) ?? [];
    b.push(rel);
    adjacency.set(rel.targetId, b);
  }

  let seeds = [...new Set(options.seedIds ?? [])].filter((id) => byId.has(id));
  const query = options.query?.trim();
  if (!seeds.length && query)
    seeds = queryOkfSnapshot(snapshot, query, 24)
      .items.map((item) => item.id)
      .filter((id) => byId.has(id))
      .slice(0, 8);
  if (!seeds.length)
    seeds = defaultSeeds(units, relationships, mode).slice(
      0,
      mode === "repository" ? 5 : mode === "flows" ? 3 : 6
    );
  const effectiveDepth = mode === "repository" && !hasExplicitFocus ? 1 : maxDepth;

  const selected = new Set<string>();
  const selectedEdges = new Map<string, KeystoneKnowledgeRelationship>();
  const queue = seeds.map((id) => ({ id, depth: 0 }));
  for (const seed of seeds) selected.add(seed);
  while (queue.length && selected.size < limit) {
    const current = queue.shift()!;
    if (current.depth >= effectiveDepth) continue;
    for (const rel of adjacency.get(current.id) ?? []) {
      const next = rel.sourceId === current.id ? rel.targetId : rel.sourceId;
      if (!nodeAllowed(mode, byId.get(next)!)) continue;
      selectedEdges.set(rel.id, rel);
      if (!selected.has(next) && selected.size < limit) {
        selected.add(next);
        queue.push({ id: next, depth: current.depth + 1 });
      }
    }
  }
  // Include only edges whose endpoints are both visible. This makes the graph internally consistent.
  for (const rel of relationships)
    if (selected.has(rel.sourceId) && selected.has(rel.targetId)) selectedEdges.set(rel.id, rel);
  const nodes = [...selected]
    .map((id) => toGraphNode(byId.get(id)!, seeds.includes(id), evidence))
    .sort(
      (a, b) =>
        Number(b.seed) - Number(a.seed) ||
        a.kind.localeCompare(b.kind) ||
        a.label.localeCompare(b.label)
    );
  const edges = [...selectedEdges.values()]
    .filter((rel) => selected.has(rel.sourceId) && selected.has(rel.targetId))
    .map((rel) => ({
      id: rel.id,
      sourceId: rel.sourceId,
      targetId: rel.targetId,
      kind: rel.kind,
      confidence: rel.confidence.score,
      evidenceIds: [...rel.provenance.evidenceIds]
    }));
  return {
    mode,
    query,
    seedIds: seeds,
    nodes,
    edges,
    relationshipKinds: [...new Set(edges.map((edge) => edge.kind))].sort(),
    truncated: selected.size >= limit,
    warnings: nodes.length ? [] : ["No graph nodes matched the requested mode/query."]
  };
}

export function buildCpgExplorerResult(
  graph: CodePropertyGraph | undefined,
  files: readonly IntelligenceCpgFile[],
  options: { edgeKind?: CpgEdgeKind | "all"; focusNodeId?: string; limit?: number } = {}
): IntelligenceCpgResult {
  if (!graph)
    return {
      files,
      nodes: [],
      edges: [],
      edgeKinds: [],
      truncated: false,
      warnings: files.length
        ? ["Choose a CPG source file."]
        : ["No persisted CPG shards are available. Index the repository first."]
    };
  const limit = Math.max(24, Math.min(options.limit ?? 120, 300));
  const requested = options.edgeKind ?? "all";
  const behavioralKinds = new Set<CpgEdgeKind>(["call", "dfg", "cfg", "cdg", "eog"]);
  let allowedEdges = graph.edges.filter((edge) =>
    requested === "all" ? behavioralKinds.has(edge.kind) : edge.kind === requested
  );
  if (requested === "all" && !allowedEdges.length) allowedEdges = [...graph.edges];
  const adjacency = new Map<string, (typeof allowedEdges)[number][]>();
  for (const edge of allowedEdges) {
    const a = adjacency.get(edge.sourceId) ?? [];
    a.push(edge);
    adjacency.set(edge.sourceId, a);
    const b = adjacency.get(edge.targetId) ?? [];
    b.push(edge);
    adjacency.set(edge.targetId, b);
  }
  const nodeById = new Map(graph.nodes.map((node) => [node.id, node]));
  const declarationCandidates = graph.nodes
    .filter((node) => node.kind === "declaration")
    .sort(
      (a, b) =>
        (adjacency.get(b.id)?.length ?? 0) - (adjacency.get(a.id)?.length ?? 0) ||
        a.location.startLine - b.location.startLine
    );
  const seed =
    options.focusNodeId && nodeById.has(options.focusNodeId)
      ? options.focusNodeId
      : (declarationCandidates[0]?.id ??
        graph.nodes.find((node) => node.kind === "file")?.id ??
        graph.nodes[0]?.id);
  const selected = new Set<string>();
  const queue = seed ? [{ id: seed, depth: 0 }] : [];
  if (seed) selected.add(seed);
  while (queue.length && selected.size < limit) {
    const current = queue.shift()!;
    if (current.depth >= 4) continue;
    for (const edge of adjacency.get(current.id) ?? []) {
      const next = edge.sourceId === current.id ? edge.targetId : edge.sourceId;
      if (!selected.has(next) && selected.size < limit) {
        selected.add(next);
        queue.push({ id: next, depth: current.depth + 1 });
      }
    }
  }
  // Ensure the default frame demonstrates the behavioral CPG families that actually exist,
  // rather than showing an AST-heavy declaration dump.
  if (requested === "all") {
    for (const kind of ["call", "dfg", "cfg", "cdg", "eog"] as CpgEdgeKind[]) {
      const sample = allowedEdges.find((edge) => edge.kind === kind);
      if (!sample) continue;
      if (selected.size < limit) selected.add(sample.sourceId);
      if (selected.size < limit) selected.add(sample.targetId);
    }
  }
  if (selected.size < Math.min(limit, graph.nodes.length)) {
    for (const node of declarationCandidates.slice(0, 24)) {
      if (selected.size >= limit) break;
      selected.add(node.id);
    }
  }
  const nodes = [...selected]
    .map((id) => nodeById.get(id))
    .filter((node): node is NonNullable<typeof node> => Boolean(node))
    .sort((a, b) => a.location.startLine - b.location.startLine)
    .map((node) => ({
      id: node.id,
      label: node.name ?? node.syntaxKind,
      kind: node.kind,
      syntaxKind: node.syntaxKind,
      path: node.location.path,
      line: node.location.startLine,
      okfId: node.okfId
    }));
  const edges = allowedEdges
    .filter((edge) => selected.has(edge.sourceId) && selected.has(edge.targetId))
    .map((edge) => ({
      id: edge.id,
      sourceId: edge.sourceId,
      targetId: edge.targetId,
      kind: edge.kind,
      okfSourceId: edge.okfSourceId,
      okfTargetId: edge.okfTargetId
    }));
  return {
    files,
    sourcePath: graph.sourcePath,
    capabilities: graph.capabilities,
    nodes,
    edges,
    edgeKinds: [...new Set(graph.edges.map((edge) => edge.kind))].sort() as CpgEdgeKind[],
    truncated: graph.nodes.length > nodes.length,
    warnings:
      requested === "all" && !graph.edges.some((edge) => behavioralKinds.has(edge.kind))
        ? [
            "This shard has no persisted call/control/data-flow edges; showing structural CPG relationships instead."
          ]
        : []
  };
}

function nodeAllowed(mode: IntelligenceGraphMode, unit: KeystoneKnowledgeUnit): boolean {
  if (mode === "architecture") return ARCHITECTURE_KINDS.has(unit.kind);
  if (mode === "repository")
    return ARCHITECTURE_KINDS.has(unit.kind) || ["file", "test", "symbol"].includes(unit.kind);
  if (mode === "flows") return FLOW_KINDS.has(unit.kind) && flowUnitUseful(unit);
  if (mode === "tests")
    return (
      unit.kind === "test" ||
      unit.kind === "file" ||
      unit.kind === "symbol" ||
      unit.kind === "service" ||
      unit.kind === "api"
    );
  return true;
}
function flowUnitUseful(unit: KeystoneKnowledgeUnit | undefined): boolean {
  if (!unit) return false;
  if (["call-flow", "data-flow", "service", "api", "data-entity", "test"].includes(unit.kind))
    return true;
  if (unit.kind === "file") return !isNoisePath(unitPath(unit) ?? unit.name);
  if (unit.kind !== "symbol") return false;
  const name = unit.name.toLowerCase();
  return !/^(date|error|map|set|promise|array|object|string|number|boolean|json|console|math|regexp|buffer|url|fetch|require|process|settimeout|setinterval|clearinterval|tostring|toisostring|parse|stringify|push|pop|slice|map|filter|find|reduce|foreach)$/.test(
    name
  );
}
function isNoisePath(value: string): boolean {
  return /(?:^|\/)(?:node_modules|dist|build|coverage|docs?|scripts?|\.github)(?:\/|$)|(?:package-lock|package\.json|tsconfig|eslint|prettier|vite|webpack|rollup)/i.test(
    value
  );
}
function defaultSeeds(
  units: readonly KeystoneKnowledgeUnit[],
  relationships: readonly KeystoneKnowledgeRelationship[],
  mode: IntelligenceGraphMode
): string[] {
  const degree = new Map<string, number>();
  for (const rel of relationships) {
    degree.set(rel.sourceId, (degree.get(rel.sourceId) ?? 0) + 1);
    degree.set(rel.targetId, (degree.get(rel.targetId) ?? 0) + 1);
  }
  const candidates = units.filter((unit) => nodeAllowed(mode, unit));
  if (mode === "repository") {
    const preferred = candidates.filter((unit) =>
      [
        "repository",
        "workspace",
        "architecture-boundary",
        "module",
        "package",
        "service",
        "api",
        "data-entity"
      ].includes(unit.kind)
    );
    if (preferred.length)
      return preferred
        .sort(
          (a, b) =>
            (degree.get(b.id) ?? 0) - (degree.get(a.id) ?? 0) ||
            kindPriority(a.kind) - kindPriority(b.kind) ||
            a.canonicalKey.localeCompare(b.canonicalKey)
        )
        .map((unit) => unit.id);
  }
  if (mode === "flows") {
    const preferred = candidates.filter((unit) =>
      ["call-flow", "data-flow", "service", "api", "symbol"].includes(unit.kind)
    );
    return preferred
      .sort(
        (a, b) =>
          (degree.get(b.id) ?? 0) - (degree.get(a.id) ?? 0) ||
          kindPriority(a.kind) - kindPriority(b.kind) ||
          a.canonicalKey.localeCompare(b.canonicalKey)
      )
      .map((unit) => unit.id);
  }
  return candidates
    .sort(
      (a, b) =>
        (degree.get(b.id) ?? 0) - (degree.get(a.id) ?? 0) ||
        kindPriority(a.kind) - kindPriority(b.kind) ||
        a.canonicalKey.localeCompare(b.canonicalKey)
    )
    .map((unit) => unit.id);
}
function kindPriority(kind: string): number {
  return [
    "repository",
    "workspace",
    "architecture-boundary",
    "module",
    "package",
    "service",
    "api",
    "data-entity",
    "file",
    "symbol",
    "test",
    "call-flow",
    "data-flow"
  ].indexOf(kind) >= 0
    ? [
        "repository",
        "workspace",
        "architecture-boundary",
        "module",
        "package",
        "service",
        "api",
        "data-entity",
        "file",
        "symbol",
        "test",
        "call-flow",
        "data-flow"
      ].indexOf(kind)
    : 20;
}
function tokenize(value: string): string[] {
  return [...new Set(value.toLowerCase().match(/[a-z0-9_./:-]+/g) ?? [])].filter(
    (term) => term.length > 1
  );
}
function unitPath(unit: KeystoneKnowledgeUnit): string | undefined {
  const value = unit.properties.path ?? unit.properties.filePath;
  return typeof value === "string" ? value : undefined;
}
function unitLine(
  unit: KeystoneKnowledgeUnit,
  evidence: ReadonlyMap<string, OkfEvidence>
): number | undefined {
  for (const id of unit.provenance.evidenceIds) {
    const line = evidence.get(id)?.source.startLine;
    if (line !== undefined) return line;
  }
  return undefined;
}
function explorerScore(
  unit: KeystoneKnowledgeUnit,
  query: string,
  terms: readonly string[]
): number {
  if (!query) return kindPriority(unit.kind) < 8 ? 3 : 1;
  const path = unitPath(unit) ?? "";
  const hay =
    `${unit.kind} ${unit.name} ${unit.description ?? ""} ${unit.canonicalKey} ${path} ${JSON.stringify(unit.properties)}`.toLowerCase();
  const q = query.toLowerCase();
  let score = 0;
  if (hay.includes(q)) score += 12;
  if (unit.name.toLowerCase() === q || path.toLowerCase() === q) score += 20;
  for (const term of terms) {
    if (unit.name.toLowerCase().includes(term)) score += 5;
    if (path.toLowerCase().includes(term)) score += 4;
    if (hay.includes(term)) score += 1;
  }
  return score;
}
function toExplorerItem(
  unit: KeystoneKnowledgeUnit,
  incoming: number,
  outgoing: number,
  evidence: ReadonlyMap<string, OkfEvidence>
): IntelligenceExplorerItem {
  return {
    id: unit.id,
    label: unit.name,
    kind: unit.kind,
    path: unitPath(unit),
    line: unitLine(unit, evidence),
    description: unit.description,
    confidence: unit.confidence.score,
    evidenceIds: [...unit.provenance.evidenceIds],
    incoming,
    outgoing
  };
}
function toGraphNode(
  unit: KeystoneKnowledgeUnit,
  seed: boolean,
  evidence: ReadonlyMap<string, OkfEvidence>
): IntelligenceGraphNode {
  return {
    id: unit.id,
    label: unit.name,
    kind: unit.kind,
    path: unitPath(unit),
    line: unitLine(unit, evidence),
    confidence: unit.confidence.score,
    evidenceIds: [...unit.provenance.evidenceIds],
    seed
  };
}
