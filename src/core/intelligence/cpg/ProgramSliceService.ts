import type {
  CpgEdge,
  CpgNode,
  CpgScopeArtifact,
  CpgSliceQuery,
  CpgSliceResult,
} from "../../../shared/contracts/cpg";

const BACKWARD = new Set([
  "FLOWS_TO",
  "REACHING_DEFINITION",
  "ARGUMENT_TO_PARAMETER",
  "RETURN_TO_CALL",
  "RECEIVER_TO_CALL",
  "DEFINES",
]);
const FORWARD = BACKWARD;

export class ProgramSliceService {
  slice(artifact: CpgScopeArtifact, raw: CpgSliceQuery): CpgSliceResult {
    const query = {
      includeConditions: true,
      maxNodes: 100,
      maxDepth: 8,
      maxPaths: 10,
      timeBudgetMs: 500,
      ...raw,
    };
    const started = Date.now();
    const start = query.nodeId
      ? artifact.nodes.find((node) => node.id === query.nodeId)
      : findByLocation(artifact.nodes, query.location);
    if (!start)
      throw new Error(
        "The selected CPG node or source location was not found in the active scope shard.",
      );
    const allowed = query.direction === "backward" ? BACKWARD : FORWARD;
    const adjacency = new Map<string, CpgEdge[]>();
    for (const edge of artifact.edges) {
      if (!allowed.has(edge.type)) continue;
      const key = query.direction === "backward" ? edge.targetId : edge.sourceId;
      const list = adjacency.get(key) ?? [];
      list.push(edge);
      adjacency.set(key, list);
    }
    const selectedNodes = new Map([[start.id, start]]);
    const selectedEdges = new Map<string, CpgEdge>();
    const paths: string[][] = [];
    const queue: Array<{ id: string; depth: number; path: string[] }> = [
      { id: start.id, depth: 0, path: [start.id] },
    ];
    let truncated = false;
    while (queue.length) {
      if (Date.now() - started >= query.timeBudgetMs || selectedNodes.size >= query.maxNodes) {
        truncated = true;
        break;
      }
      const current = queue.shift()!;
      const nextEdges = adjacency.get(current.id) ?? [];
      if (current.depth >= query.maxDepth || nextEdges.length === 0) {
        if (paths.length < query.maxPaths) paths.push(current.path);
        else truncated = true;
        continue;
      }
      for (const edge of nextEdges) {
        const nextId = query.direction === "backward" ? edge.sourceId : edge.targetId;
        const node = artifact.nodes.find((item) => item.id === nextId);
        if (!node) continue;
        selectedNodes.set(node.id, node);
        selectedEdges.set(edge.id, edge);
        if (!current.path.includes(nextId))
          queue.push({ id: nextId, depth: current.depth + 1, path: [...current.path, nextId] });
      }
    }
    const conditions = query.includeConditions ? guardingConditions(artifact, selectedNodes) : [];
    for (const condition of conditions) selectedNodes.set(condition.id, condition);
    const nodes = [...selectedNodes.values()].slice(0, query.maxNodes);
    const fragments = nodes
      .filter((node) => node.range && node.code)
      .sort(sourceOrder)
      .map((node, order) => ({ nodeId: node.id, range: node.range!, code: node.code!, order }));
    const unsupportedBoundaries = artifact.diagnostics
      .filter(
        (item) =>
          item.code === "unsupported-aliasing" ||
          item.code === "dynamic-property" ||
          item.code === "unresolved-call" ||
          item.code === "incomplete-exception-model",
      )
      .map((item) => item.message)
      .slice(0, 100);
    const confidence =
      selectedEdges.size === 0
        ? 1
        : Math.min(...[...selectedEdges.values()].map((edge) => edge.confidence));
    return {
      generation: artifact.descriptor.generation,
      scope: artifact.descriptor,
      direction: query.direction,
      nodes,
      edges: [...selectedEdges.values()].slice(0, 1200),
      fragments,
      paths: paths.slice(0, query.maxPaths),
      conditions,
      diagnostics: artifact.diagnostics.slice(0, 100),
      unsupportedBoundaries,
      confidence,
      truncated,
    };
  }
}

function findByLocation(
  nodes: CpgNode[],
  location?: CpgSliceQuery["location"],
): CpgNode | undefined {
  if (!location) return undefined;
  return nodes
    .filter((node) => node.range && contains(node.range, location))
    .sort((left, right) => size(left.range!) - size(right.range!))[0];
}
function contains(
  outer: NonNullable<CpgNode["range"]>,
  inner: NonNullable<CpgNode["range"]>,
): boolean {
  return (
    (outer.startLine < inner.startLine ||
      (outer.startLine === inner.startLine && outer.startColumn <= inner.startColumn)) &&
    (outer.endLine > inner.endLine ||
      (outer.endLine === inner.endLine && outer.endColumn >= inner.endColumn))
  );
}
function size(range: NonNullable<CpgNode["range"]>): number {
  return (range.endLine - range.startLine) * 100000 + range.endColumn - range.startColumn;
}
function sourceOrder(left: CpgNode, right: CpgNode): number {
  return (
    left.range!.startLine - right.range!.startLine ||
    left.range!.startColumn - right.range!.startColumn
  );
}
function guardingConditions(artifact: CpgScopeArtifact, selected: Map<string, CpgNode>): CpgNode[] {
  const ids = new Set<string>();
  for (const edge of artifact.edges)
    if (
      (edge.type === "CFG_TRUE" || edge.type === "CFG_FALSE" || edge.type === "CFG_CASE") &&
      selected.has(edge.targetId)
    )
      ids.add(edge.sourceId);
  return [...ids]
    .map((id) => artifact.nodes.find((node) => node.id === id))
    .filter((node): node is CpgNode => Boolean(node))
    .slice(0, 100);
}
