import type { EvidenceMetadata, RepoIntelligence } from "../../domain/types";

export interface RepositoryGraphEdge {
  readonly from: string;
  readonly to: string;
  readonly evidence?: EvidenceMetadata;
}

export interface RepositoryGraphAnalysis {
  readonly localEdges: ReadonlyArray<RepositoryGraphEdge>;
  readonly hubs: ReadonlyArray<{
    path: string;
    incoming: number;
    outgoing: number;
    degree: number;
    evidence: readonly EvidenceMetadata[];
  }>;
  readonly entryPoints: readonly string[];
  readonly orphanSourceFiles: readonly string[];
  readonly cycles: ReadonlyArray<readonly string[]>;
  readonly communities: ReadonlyArray<{
    id: string;
    files: readonly string[];
    internalEdges: number;
    evidence: readonly EvidenceMetadata[];
  }>;
  readonly flows: ReadonlyArray<{
    entryPoint: string;
    files: readonly string[];
    depth: number;
    evidence: readonly EvidenceMetadata[];
  }>;
  impactedBy(
    changedFiles: readonly string[],
    maxDepth?: number
  ): { files: string[]; tests: string[]; depth: number };
}

/** Shared, bounded graph projection consumed by downstream intelligence stages. */
export function analyzeRepositoryGraph(intelligence: RepoIntelligence): RepositoryGraphAnalysis {
  const files = new Set(intelligence.files.map((file) => file.path));
  const localEdges = intelligence.dependencies
    .filter(
      (edge) =>
        (edge.kind === "local" || edge.kind === "import") &&
        files.has(edge.from) &&
        files.has(edge.to)
    )
    .map((edge) => ({ from: edge.from, to: edge.to, evidence: edge.evidence }));
  const edgesByNode = edgeAdjacency(localEdges);
  const outgoing = adjacency(localEdges, "from", "to");
  const incoming = adjacency(localEdges, "to", "from");
  const hubs = [...files]
    .map((path) => ({
      path,
      incoming: incoming.get(path)?.size ?? 0,
      outgoing: outgoing.get(path)?.size ?? 0,
      degree: (incoming.get(path)?.size ?? 0) + (outgoing.get(path)?.size ?? 0),
      evidence: edgeEvidence(edgesByNode.get(path) ?? [])
    }))
    .filter((item) => item.degree > 0)
    .sort((a, b) => b.degree - a.degree || a.path.localeCompare(b.path))
    .slice(0, 20);
  const apiFiles = new Set(intelligence.apis.map((api) => api.filePath));
  const entryPoints = [...files]
    .filter((file) => /(^|\/)(index|main|app|server|cli)\.[^.]+$/i.test(file) || apiFiles.has(file))
    .sort();
  const entryPointSet = new Set(entryPoints);
  const orphanSourceFiles = intelligence.files
    .filter((file) => !file.isTest && !file.isGenerated && isCode(file.path))
    .map((file) => file.path)
    .filter((file) => !incoming.has(file) && !outgoing.has(file) && !entryPointSet.has(file))
    .sort();
  const cycles = findCycles(files, outgoing);
  const communities = findCommunities(files, localEdges, edgesByNode);
  const flows = entryPoints.map((entryPoint) =>
    traceFlow(entryPoint, outgoing, edgesByNode, 8, 100)
  );

  return {
    localEdges,
    hubs,
    entryPoints,
    orphanSourceFiles,
    cycles,
    communities,
    flows,
    impactedBy: createGraphImpactAnalyzer([...files], localEdges, intelligence.tests)
  };
}

export function createGraphImpactAnalyzer(
  filePaths: readonly string[],
  localEdges: ReadonlyArray<RepositoryGraphEdge>,
  tests: RepoIntelligence["tests"]
): RepositoryGraphAnalysis["impactedBy"] {
  const files = new Set(filePaths);
  const incoming = adjacency(localEdges, "to", "from");
  return (changedFiles, maxDepth = 6) => {
    const seen = new Set(changedFiles.filter((file) => files.has(file)));
    let frontier = [...seen];
    let depth = 0;
    while (frontier.length && depth < maxDepth && seen.size < 2000) {
      depth += 1;
      const next: string[] = [];
      for (const file of frontier) {
        for (const dependent of incoming.get(file) ?? []) {
          if (!seen.has(dependent)) {
            seen.add(dependent);
            next.push(dependent);
          }
        }
      }
      frontier = next;
    }
    const impacted = [...seen].sort();
    const impactedSet = new Set(impacted);
    const relatedTests = tests
      .filter(
        (test) =>
          impactedSet.has(test.testFile) ||
          Boolean(test.targetFile && impactedSet.has(test.targetFile))
      )
      .map((test) => test.testFile);
    return { files: impacted, tests: [...new Set(relatedTests)].sort(), depth };
  };
}

function findCommunities(
  files: Set<string>,
  edges: ReadonlyArray<RepositoryGraphEdge>,
  edgesByNode: ReadonlyMap<string, ReadonlyArray<RepositoryGraphEdge>>
): Array<{
  id: string;
  files: readonly string[];
  internalEdges: number;
  evidence: readonly EvidenceMetadata[];
}> {
  const undirected = new Map<string, Set<string>>();
  for (const edge of edges) {
    const left = undirected.get(edge.from) ?? new Set<string>();
    left.add(edge.to);
    undirected.set(edge.from, left);
    const right = undirected.get(edge.to) ?? new Set<string>();
    right.add(edge.from);
    undirected.set(edge.to, right);
  }
  const seen = new Set<string>();
  const result: Array<{
    id: string;
    files: readonly string[];
    internalEdges: number;
    evidence: readonly EvidenceMetadata[];
  }> = [];
  for (const file of [...files].sort()) {
    if (seen.has(file) || !undirected.has(file)) continue;
    const component: string[] = [];
    const queue = [file];
    seen.add(file);
    while (queue.length) {
      const current = queue.shift()!;
      component.push(current);
      for (const neighbor of undirected.get(current) ?? [])
        if (!seen.has(neighbor)) {
          seen.add(neighbor);
          queue.push(neighbor);
        }
    }
    component.sort();
    const members = new Set(component);
    const internalEdges: RepositoryGraphEdge[] = [];
    const seenEdges = new Set<RepositoryGraphEdge>();
    for (const member of component)
      for (const edge of edgesByNode.get(member) ?? [])
        if (!seenEdges.has(edge) && members.has(edge.from) && members.has(edge.to)) {
          seenEdges.add(edge);
          internalEdges.push(edge);
        }
    result.push({
      id: `community:${component[0]}`,
      files: component,
      internalEdges: internalEdges.length,
      evidence: edgeEvidence(internalEdges)
    });
  }
  return result.sort((a, b) => b.files.length - a.files.length || a.id.localeCompare(b.id));
}

function traceFlow(
  entryPoint: string,
  outgoing: Map<string, Set<string>>,
  edgesByNode: ReadonlyMap<string, ReadonlyArray<RepositoryGraphEdge>>,
  maxDepth: number,
  limit: number
) {
  const seen = new Set([entryPoint]);
  const queue: Array<{ file: string; depth: number }> = [{ file: entryPoint, depth: 0 }];
  let reachedDepth = 0;
  while (queue.length && seen.size < limit) {
    const current = queue.shift()!;
    reachedDepth = Math.max(reachedDepth, current.depth);
    if (current.depth >= maxDepth) continue;
    for (const target of outgoing.get(current.file) ?? []) {
      if (!seen.has(target)) {
        seen.add(target);
        queue.push({ file: target, depth: current.depth + 1 });
      }
    }
  }
  const flowEdges: RepositoryGraphEdge[] = [];
  const seenEdges = new Set<RepositoryGraphEdge>();
  for (const file of seen)
    for (const edge of edgesByNode.get(file) ?? [])
      if (!seenEdges.has(edge) && seen.has(edge.from) && seen.has(edge.to)) {
        seenEdges.add(edge);
        flowEdges.push(edge);
      }
  return {
    entryPoint,
    files: [...seen].sort(),
    depth: reachedDepth,
    evidence: edgeEvidence(flowEdges)
  };
}

function edgeAdjacency(
  edges: ReadonlyArray<RepositoryGraphEdge>
): Map<string, RepositoryGraphEdge[]> {
  const result = new Map<string, RepositoryGraphEdge[]>();
  for (const edge of edges) {
    const from = result.get(edge.from) ?? [];
    from.push(edge);
    result.set(edge.from, from);
    const to = result.get(edge.to) ?? [];
    if (edge.to !== edge.from) to.push(edge);
    result.set(edge.to, to);
  }
  return result;
}

function adjacency(
  edges: ReadonlyArray<RepositoryGraphEdge>,
  source: "from" | "to",
  target: "from" | "to"
): Map<string, Set<string>> {
  const result = new Map<string, Set<string>>();
  for (const edge of edges) {
    const targets = result.get(edge[source]) ?? new Set<string>();
    targets.add(edge[target]);
    result.set(edge[source], targets);
  }
  return result;
}

function edgeEvidence(edges: readonly RepositoryGraphEdge[]): EvidenceMetadata[] {
  const byKey = new Map<string, EvidenceMetadata>();
  for (const edge of edges) {
    if (!edge.evidence) continue;
    const key = [
      edge.evidence.source,
      edge.evidence.evidencePath ?? "",
      edge.evidence.evidenceLine ?? "",
      edge.evidence.extractorVersion
    ].join("|");
    byKey.set(key, edge.evidence);
  }
  return [...byKey.values()].sort(
    (a, b) =>
      (a.evidencePath ?? "").localeCompare(b.evidencePath ?? "") ||
      (a.evidenceLine ?? 0) - (b.evidenceLine ?? 0) ||
      a.source.localeCompare(b.source)
  );
}

function findCycles(
  files: Set<string>,
  outgoing: Map<string, Set<string>>
): Array<readonly string[]> {
  const indexByNode = new Map<string, number>();
  const lowLink = new Map<string, number>();
  const stack: string[] = [];
  const onStack = new Set<string>();
  const cycles: string[][] = [];
  let index = 0;
  const visit = (node: string): void => {
    indexByNode.set(node, index);
    lowLink.set(node, index);
    index += 1;
    stack.push(node);
    onStack.add(node);
    for (const target of outgoing.get(node) ?? []) {
      if (!indexByNode.has(target)) {
        visit(target);
        lowLink.set(node, Math.min(lowLink.get(node)!, lowLink.get(target)!));
      } else if (onStack.has(target))
        lowLink.set(node, Math.min(lowLink.get(node)!, indexByNode.get(target)!));
    }
    if (lowLink.get(node) === indexByNode.get(node)) {
      const component: string[] = [];
      let current: string;
      do {
        current = stack.pop()!;
        onStack.delete(current);
        component.push(current);
      } while (current !== node);
      if (component.length > 1 || outgoing.get(node)?.has(node)) cycles.push(component.sort());
    }
  };
  for (const file of files) if (!indexByNode.has(file)) visit(file);
  return cycles.sort((a, b) => b.length - a.length || a[0].localeCompare(b[0]));
}

function isCode(file: string): boolean {
  return /\.(?:[cm]?[jt]sx?|py|java|go|rs|cs|rb|php|swift|kt)$/i.test(file);
}
