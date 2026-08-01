import type { GraphNode, GraphNodeKind, KnowledgeGraph, TemporalEdge } from "./types";

export type FileGraphEvidence = {
  file?: GraphNode;
  declaredSymbols: GraphNode[];
  declaredRoutes: GraphNode[];
  configUsages: GraphNode[];
  runtimeBehaviors: GraphNode[];
  owners: GraphNode[];
  recentChanges: GraphNode[];
  coveringTests: GraphNode[];
  imports: GraphNode[];
  importedBy: GraphNode[];
};

export function findNodesByKind(graph: KnowledgeGraph, kind: GraphNodeKind): GraphNode[] {
  return graph.nodes.filter((node) => node.kind === kind);
}

export function findFileNodesByRole(graph: KnowledgeGraph, role: string): GraphNode[] {
  return graph.nodes.filter((node) => node.kind === "file" && node.metadata.role === role);
}

export function findPackageScripts(graph: KnowledgeGraph): GraphNode[] {
  return findNodesByKind(graph, "package_script");
}

export function findPackageDependencies(graph: KnowledgeGraph): GraphNode[] {
  return findNodesByKind(graph, "package_dependency");
}

export function findTests(graph: KnowledgeGraph): GraphNode[] {
  return findNodesByKind(graph, "test");
}

export function findRoutes(
  graph: KnowledgeGraph,
  input: { method?: string; routePath?: string; sourcePath?: string } = {}
): GraphNode[] {
  const method = input.method?.toUpperCase();
  const routePath = input.routePath ? normalizeRoutePath(input.routePath) : undefined;

  return graph.nodes
    .filter(
      (node) =>
        node.kind === "route" &&
        (!method || node.metadata.method === method) &&
        (!routePath || normalizeRoutePath(String(node.metadata.routePath ?? "")) === routePath) &&
        (!input.sourcePath || node.metadata.path === input.sourcePath)
    )
    .sort(compareNodes);
}

export function findConfigUsages(
  graph: KnowledgeGraph,
  input: { name?: string; sourcePath?: string } = {}
): GraphNode[] {
  const name = input.name?.toLowerCase();

  return graph.nodes
    .filter(
      (node) =>
        node.kind === "config_usage" &&
        (!name || String(node.metadata.configName ?? node.name).toLowerCase() === name) &&
        (!input.sourcePath || node.metadata.path === input.sourcePath)
    )
    .sort(compareNodes);
}

export function findRuntimeBehaviors(
  graph: KnowledgeGraph,
  input: { behaviorType?: string; signal?: string; sourcePath?: string; routePath?: string; configName?: string } = {}
): GraphNode[] {
  const signal = input.signal?.toLowerCase();
  const routePath = input.routePath ? normalizeRoutePath(input.routePath) : undefined;
  const configName = input.configName?.toLowerCase();

  return graph.nodes
    .filter(
      (node) =>
        node.kind === "runtime_behavior" &&
        (!input.behaviorType || node.metadata.behaviorType === input.behaviorType) &&
        (!signal || `${node.name} ${node.metadata.signal ?? ""}`.toLowerCase().includes(signal)) &&
        (!input.sourcePath || node.metadata.sourcePath === input.sourcePath) &&
        (!routePath || normalizeRoutePath(String(node.metadata.routePath ?? "")) === routePath) &&
        (!configName || String(node.metadata.configName ?? "").toLowerCase() === configName)
    )
    .sort(compareNodes);
}

export function findNodeByPath(graph: KnowledgeGraph, path: string): GraphNode | undefined {
  return (
    graph.nodes.find((node) => node.kind === "file" && node.metadata.path === path) ??
    graph.nodes.find((node) => typeof node.metadata.path === "string" && node.metadata.path === path)
  );
}

export function findImportedFilePaths(graph: KnowledgeGraph, sourcePath: string): string[] {
  const sourceNode = findNodeByPath(graph, sourcePath);
  if (!sourceNode) {
    return [];
  }

  const importedNodeIds = graph.edges
    .filter((edge) => edge.kind === "imports" && edge.fromNodeId === sourceNode.id)
    .map((edge) => edge.toNodeId);

  return graph.nodes
    .filter((node) => importedNodeIds.includes(node.id) && typeof node.metadata.path === "string")
    .map((node) => node.metadata.path as string)
    .sort();
}

export function findCalledSymbolNames(graph: KnowledgeGraph, symbolName: string): string[] {
  const sourceNodes = graph.nodes.filter((node) => node.kind === "symbol" && node.name === symbolName);
  const calledNodeIds = graph.edges
    .filter((edge) => edge.kind === "calls" && sourceNodes.some((node) => node.id === edge.fromNodeId))
    .map((edge) => edge.toNodeId);

  return graph.nodes
    .filter((node) => calledNodeIds.includes(node.id))
    .map((node) => node.name)
    .sort();
}

export function findRuntimeBehaviorsForPath(graph: KnowledgeGraph, path: string): GraphNode[] {
  const sourceNode = findNodeByPath(graph, path);
  if (!sourceNode) {
    return [];
  }

  const behaviorNodeIds = graph.edges
    .filter((edge) => edge.kind === "observes" && edge.fromNodeId === sourceNode.id)
    .map((edge) => edge.toNodeId);

  return graph.nodes
    .filter((node) => node.kind === "runtime_behavior" && behaviorNodeIds.includes(node.id))
    .sort((left, right) => left.name.localeCompare(right.name));
}

export function findTestsCoveringPath(graph: KnowledgeGraph, path: string): GraphNode[] {
  const sourceNode = findNodeByPath(graph, path);
  if (!sourceNode) {
    return [];
  }

  const testFileNodeIds = graph.edges
    .filter((edge) => edge.kind === "covers" && edge.toNodeId === sourceNode.id)
    .map((edge) => edge.fromNodeId);

  return graph.nodes
    .filter((node) => node.kind === "file" && node.metadata.role === "test" && testFileNodeIds.includes(node.id))
    .sort(compareNodes);
}

export function findFileEvidence(graph: KnowledgeGraph, path: string): FileGraphEvidence {
  const file = findNodeByPath(graph, path);
  if (!file) {
    return {
      declaredSymbols: [],
      declaredRoutes: [],
      configUsages: [],
      runtimeBehaviors: [],
      owners: [],
      recentChanges: [],
      coveringTests: [],
      imports: [],
      importedBy: []
    };
  }

  const declaredNodeIds = graph.edges
    .filter((edge) => edge.kind === "declares" && edge.fromNodeId === file.id)
    .map((edge) => edge.toNodeId!);
  const importNodeIds = graph.edges
    .filter((edge) => edge.kind === "imports" && edge.fromNodeId === file.id)
    .map((edge) => edge.toNodeId!);
  const importedByNodeIds = graph.edges
    .filter((edge) => edge.kind === "imports" && edge.toNodeId === file.id)
    .map((edge) => edge.fromNodeId!);
  const ownerNodeIds = graph.edges
    .filter((edge) => edge.kind === "owns" && edge.toNodeId === file.id)
    .map((edge) => edge.fromNodeId!);
  const changeNodeIds = graph.edges
    .filter((edge) => edge.kind === "changes" && edge.toNodeId === file.id)
    .map((edge) => edge.fromNodeId!);

  return {
    file,
    declaredSymbols: findNodesByIds(graph, declaredNodeIds, "symbol"),
    declaredRoutes: findNodesByIds(graph, declaredNodeIds, "route"),
    configUsages: findNodesByIds(graph, declaredNodeIds, "config_usage"),
    runtimeBehaviors: findRuntimeBehaviorsForPath(graph, path),
    owners: findNodesByIds(graph, ownerNodeIds, "owner"),
    recentChanges: findNodesByIds(graph, changeNodeIds, "change"),
    coveringTests: findTestsCoveringPath(graph, path),
    imports: findNodesByIds(graph, importNodeIds, "file"),
    importedBy: findNodesByIds(graph, importedByNodeIds, "file")
  };
}

function findNodesByIds(graph: KnowledgeGraph, ids: string[], kind?: GraphNodeKind): GraphNode[] {
  return graph.nodes
    .filter((node) => ids.includes(node.id) && (!kind || node.kind === kind))
    .sort(compareNodes);
}

function normalizeRoutePath(value: string): string {
  return value.toLowerCase().replace(/:[a-z0-9_]+/g, ":param");
}

function compareNodes(left: GraphNode, right: GraphNode): number {
  return left.id.localeCompare(right.id);
}

export function findCallersOfSymbol(graph: KnowledgeGraph, symbolName: string): GraphNode[] {
  const calleeNode = findSymbolNode(graph, symbolName);
  if (!calleeNode) {
    return [];
  }

  const callerNodeIds = graph.edges
    .filter((edge) => edge.kind === "calls" && edge.toNodeId === calleeNode.id)
    .map((edge) => edge.fromNodeId);

  return graph.nodes
    .filter((node) => callerNodeIds.includes(node.id))
    .sort(compareNodes);
}

export function findCalleesOfSymbol(graph: KnowledgeGraph, symbolName: string): GraphNode[] {
  const callerNode = findSymbolNode(graph, symbolName);
  if (!callerNode) {
    return [];
  }

  const calleeNodeIds = graph.edges
    .filter((edge) => edge.kind === "calls" && edge.fromNodeId === callerNode.id)
    .map((edge) => edge.toNodeId);

  return graph.nodes
    .filter((node) => calleeNodeIds.includes(node.id))
    .sort(compareNodes);
}

export function findOwnersOfFile(graph: KnowledgeGraph, filePath: string): GraphNode[] {
  const fileNode = findNodeByPath(graph, filePath);
  if (!fileNode) {
    return [];
  }

  const ownerNodeIds = graph.edges
    .filter((edge) => edge.kind === "owns" && edge.toNodeId === fileNode.id)
    .map((edge) => edge.fromNodeId);

  return graph.nodes
    .filter((node) => node.kind === "owner" && ownerNodeIds.includes(node.id))
    .sort(compareNodes);
}

export function findRecentChangesForFile(graph: KnowledgeGraph, filePath: string): GraphNode[] {
  const fileNode = findNodeByPath(graph, filePath);
  if (!fileNode) {
    return [];
  }

  const changeNodeIds = graph.edges
    .filter((edge) => edge.kind === "changes" && edge.toNodeId === fileNode.id)
    .map((edge) => edge.fromNodeId);

  return graph.nodes
    .filter((node) => node.kind === "change" && changeNodeIds.includes(node.id))
    .sort(compareNodes);
}

export function findFilesWithMatchingSymbol(graph: KnowledgeGraph, symbolName: string): GraphNode[] {
  const matchingSymbolNodes = graph.nodes.filter(
    (node) => node.kind === "symbol" && node.name === symbolName
  );
  const symbolFileIds = new Set(
    matchingSymbolNodes
      .map((node) => typeof node.metadata.path === "string" ? node.metadata.path : undefined)
      .filter((path): path is string => Boolean(path))
  );

  return graph.nodes
    .filter((node) => node.kind === "file" && symbolFileIds.has(typeof node.metadata.path === "string" ? node.metadata.path : ""))
    .sort(compareNodes);
}

function findSymbolNode(graph: KnowledgeGraph, symbolName: string): GraphNode | undefined {
  return graph.nodes.find((node) => node.kind === "symbol" && node.name === symbolName);
}

// ---------------------------------------------------------------------------
// Temporal Query Functions (inspired by Graphiti's temporal knowledge graphs)
// ---------------------------------------------------------------------------

/**
 * Get edges that are valid at a specific time.
 */
export function getValidEdgesAt(graph: KnowledgeGraph, time?: number): {
  edges: typeof graph.edges;
  temporalInfo: TemporalEdge[];
} {
  const t = time ?? Date.now();
  const temporalEdges = graph.edges.filter(
    (edge) => edge.validAt !== undefined || edge.invalidAt !== undefined
  );

  const validTemporal = temporalEdges.filter((edge) => {
    if (edge.invalidAt !== undefined && t >= edge.invalidAt) return false;
    if (edge.validAt !== undefined && t < edge.validAt) return false;
    return true;
  });

  // Combine valid temporal edges with non-temporal edges (always valid)
  const nonTemporalEdges = graph.edges.filter(
    (edge) => edge.validAt === undefined && edge.invalidAt === undefined
  );

  return {
    edges: [...nonTemporalEdges, ...validTemporal],
    temporalInfo: temporalEdges.map((edge) => ({
      edgeId: edge.id,
      validAt: edge.validAt,
      invalidAt: edge.invalidAt,
      isValid: () => validTemporal.some((e) => e.id === edge.id),
      getBounds: () => ({ validAt: edge.validAt, invalidAt: edge.invalidAt }),
    })),
  };
}

/**
 * Find contradictions: edges between the same source/target/kind where one is newer.
 */
export function findContradictions(graph: KnowledgeGraph): {
  contradictionGroups: Array<{
    edges: typeof graph.edges;
    validAt: number;
    invalidAt: number;
    invalidatedIds: string[];
  }>;
} {
  // Group edges by source-target-kind
  const edgeGroups = new Map<string, typeof graph.edges>();

  for (const edge of graph.edges) {
    const key = `${edge.source}->${edge.target}:${edge.kind}`;
    const existing = edgeGroups.get(key) || [];
    existing.push(edge);
    edgeGroups.set(key, existing);
  }

  const contradictionGroups = [];

  for (const [, edges] of Object.entries(edgeGroups) as [string, typeof graph.edges][]) {
    const temporal = edges.filter(
      (e) => e.validAt !== undefined || e.invalidAt !== undefined
    );

    if (temporal.length < 2) continue;

    // Sort by validAt (descending - newest first)
    const sorted = [...temporal].sort((a, b) => {
      const aValid = a.validAt ?? 0;
      const bValid = b.validAt ?? 0;
      return bValid - aValid;
    });

    // The newest valid edge invalidates older ones
    const newest = sorted[0];
    const invalidatedIds = sorted
      .slice(1)
      .filter((e) => e.id !== newest.id)
      .map((e) => e.id);

    if (invalidatedIds.length > 0) {
      contradictionGroups.push({
        edges: temporal,
        validAt: newest.validAt ?? 0,
        invalidAt: newest.invalidAt ?? 0,
        invalidatedIds,
      });
    }
  }

  return { contradictionGroups };
}

/**
 * Get temporal context for an edge (when it was true, what episodes established it).
 */
export function getEdgeTemporalContext(
  graph: KnowledgeGraph,
  edgeId: string
): {
  edge: (typeof graph.edges)[number] | undefined;
  validAt?: number;
  invalidAt?: number;
  isValid: boolean;
  episodeId?: string;
} {
  const edge = graph.edges.find((e) => e.id === edgeId);
  if (!edge) {
    return { edge: undefined, isValid: false };
  }

  const isValid = !edge.invalidated &&
    (edge.invalidAt === undefined || Date.now() < edge.invalidAt) &&
    (edge.validAt === undefined || Date.now() >= edge.validAt);

  return {
    edge,
    validAt: edge.validAt,
    invalidAt: edge.invalidAt,
    isValid,
    episodeId: edge.episodeId,
  };
}
