import { useEffect, useMemo, useState } from "react";
import type { CpgNode, CpgQueryResult, CpgSliceResult } from "../../../shared/contracts/cpg";
import type { IntelligenceEntityDetails } from "../../../shared/contracts/intelligence";
import type { HostBridge } from "../../services/HostBridge";

const EXECUTABLE = new Set([
  "keystone.core.Function",
  "keystone.core.Method",
  "keystone.core.Constructor",
  "keystone.core.Component",
  "keystone.core.Hook",
]);

export function CodeAnalysis({
  bridge,
  entity,
  onError,
}: {
  bridge: HostBridge;
  entity: IntelligenceEntityDetails;
  onError: (message: string) => void;
}): React.JSX.Element | null {
  const [graph, setGraph] = useState<CpgQueryResult>();
  const [slice, setSlice] = useState<CpgSliceResult>();
  const [selected, setSelected] = useState<string>();
  const [loading, setLoading] = useState(true);
  const supported = EXECUTABLE.has(entity.entity.type) || Boolean(entity.entity.signature);
  useEffect(() => {
    if (!supported) return;
    const controller = new AbortController();
    void bridge
      .request(
        "intelligence/cpg/scope",
        {
          semanticSymbolId: entity.entity.id,
          overlays: ["control-flow", "data-flow", "calls"],
          maxNodes: 250,
          includeSource: true,
        },
        { signal: controller.signal },
      )
      .then((result) => {
        setGraph(result);
        setSelected(result?.nodes.find((node) => selectable(node))?.id);
      })
      .catch((cause: unknown) => {
        if (!(cause instanceof DOMException && cause.name === "AbortError"))
          onError(cause instanceof Error ? cause.message : String(cause));
      })
      .finally(() => setLoading(false));
    return () => controller.abort();
  }, [bridge, entity.entity.id, onError, supported]);
  const selectableNodes = useMemo(() => graph?.nodes.filter(selectable) ?? [], [graph]);
  if (!supported) return null;
  const runSlice = (direction: "backward" | "forward"): void => {
    if (!selected) return;
    setLoading(true);
    void bridge
      .request("intelligence/cpg/slice", {
        semanticSymbolId: entity.entity.id,
        nodeId: selected,
        direction,
        includeConditions: true,
        maxNodes: 100,
        maxDepth: 8,
        maxPaths: 10,
        timeBudgetMs: 500,
      })
      .then(setSlice)
      .catch((cause: unknown) => onError(cause instanceof Error ? cause.message : String(cause)))
      .finally(() => setLoading(false));
  };
  return (
    <section className="code-analysis" aria-label="Code analysis">
      <div className="code-analysis-heading">
        <h3>Code analysis</h3>
        {loading && <span>Analyzing…</span>}
      </div>
      {!loading && !graph && <p>No persistent CPG scope is available for this entity.</p>}
      {graph && (
        <>
          <div className="cpg-summary">
            <Summary label="Parameters" value={graph.scope.summary.parameters} />
            <Summary label="Returns" value={graph.scope.summary.returns} />
            <Summary label="Calls" value={graph.scope.summary.calls} />
            <Summary label="Branches" value={graph.scope.summary.branches} />
            <Summary label="Reads" value={graph.scope.summary.reads} />
            <Summary label="Writes" value={graph.scope.summary.writes} />
            <Summary label="Locals" value={graph.scope.summary.localVariables} />
            <Summary label="Unresolved" value={graph.scope.summary.unresolvedCalls} />
          </div>
          <p className="entity-freshness">
            {graph.scope.analysisLevel} CPG · {graph.nodes.length} nodes · {graph.edges.length}{" "}
            edges{graph.truncated ? " · bounded" : ""}
          </p>
          <div className="cpg-controls">
            <label htmlFor="cpg-node">Trace value</label>
            <select
              id="cpg-node"
              value={selected ?? ""}
              onChange={(event) => setSelected(event.target.value)}
            >
              {selectableNodes.map((node) => (
                <option key={node.id} value={node.id}>
                  {node.kind} · {node.code ?? node.properties?.variable ?? node.id}
                </option>
              ))}
            </select>
            <button
              className="ghost-button"
              disabled={!selected || loading}
              onClick={() => runSlice("backward")}
            >
              Trace backward
            </button>
            <button
              className="ghost-button"
              disabled={!selected || loading}
              onClick={() => runSlice("forward")}
            >
              Trace forward
            </button>
          </div>
          <ControlFlow
            graph={graph}
            relativePath={entity.entity.relativePath}
            bridge={bridge}
            onError={onError}
          />
          {graph.diagnostics.length > 0 && (
            <div className="cpg-diagnostics">
              <h4>Analysis diagnostics</h4>
              {graph.diagnostics.map((diagnostic) => (
                <p key={diagnostic.id}>
                  <strong>{diagnostic.code}</strong> {diagnostic.message}
                </p>
              ))}
            </div>
          )}
        </>
      )}
      {slice && (
        <SliceViewer
          result={slice}
          relativePath={entity.entity.relativePath}
          bridge={bridge}
          onError={onError}
        />
      )}
    </section>
  );
}

function ControlFlow({
  graph,
  relativePath,
  bridge,
  onError,
}: {
  graph: CpgQueryResult;
  relativePath: string;
  bridge: HostBridge;
  onError: (message: string) => void;
}): React.JSX.Element {
  const cfg = graph.edges.filter((edge) => edge.type.startsWith("CFG_"));
  const ids = new Set(cfg.flatMap((edge) => [edge.sourceId, edge.targetId]));
  const nodes = graph.nodes
    .filter((node) => ids.has(node.id))
    .sort((left, right) => (left.range?.startLine ?? -1) - (right.range?.startLine ?? -1));
  return (
    <div className="cfg-view">
      <h4>Control flow</h4>
      <div className="cfg-list">
        {nodes.map((node) => (
          <button
            key={node.id}
            className={`cfg-node ${node.kind.toLowerCase()}`}
            onClick={() =>
              node.range &&
              void bridge
                .request("intelligence/source/open", { relativePath, range: node.range })
                .catch((cause: unknown) =>
                  onError(cause instanceof Error ? cause.message : String(cause)),
                )
            }
          >
            <strong>{node.kind}</strong>
            <span>{node.code ?? "synthetic"}</span>
            <small>
              {cfg
                .filter((edge) => edge.sourceId === node.id)
                .map((edge) => edge.type.replace("CFG_", ""))
                .join(" · ") || "terminal"}
            </small>
          </button>
        ))}
      </div>
    </div>
  );
}

function SliceViewer({
  result,
  relativePath,
  bridge,
  onError,
}: {
  result: CpgSliceResult;
  relativePath: string;
  bridge: HostBridge;
  onError: (message: string) => void;
}): React.JSX.Element {
  return (
    <div className="slice-view">
      <h4>{result.direction === "backward" ? "Value contributors" : "Downstream uses"}</h4>
      <p>
        {Math.round(result.confidence * 100)}% confidence · {result.paths.length} paths
        {result.truncated ? " · truncated" : ""}
      </p>
      {result.fragments.map((fragment) => (
        <button
          key={fragment.nodeId}
          onClick={() =>
            void bridge
              .request("intelligence/source/open", { relativePath, range: fragment.range })
              .catch((cause: unknown) =>
                onError(cause instanceof Error ? cause.message : String(cause)),
              )
          }
        >
          <span>{fragment.range.startLine + 1}</span>
          <code>{fragment.code}</code>
        </button>
      ))}
      {result.conditions.length > 0 && (
        <p>
          <strong>Conditions:</strong>{" "}
          {result.conditions.map((node) => node.code ?? node.kind).join(" · ")}
        </p>
      )}
      {result.unsupportedBoundaries.map((boundary) => (
        <p key={boundary} className="semantic-error">
          {boundary}
        </p>
      ))}
    </div>
  );
}

function Summary({ label, value }: { label: string; value: number }): React.JSX.Element {
  return (
    <div>
      <strong>{value}</strong>
      <span>{label}</span>
    </div>
  );
}
function selectable(node: CpgNode): boolean {
  return (
    node.properties?.read === true ||
    node.properties?.write === true ||
    [
      "PARAMETER",
      "CALL",
      "CONSTRUCTOR_CALL",
      "RETURN_STATEMENT",
      "ASSIGNMENT",
      "VARIABLE_DECLARATION",
    ].includes(node.kind)
  );
}
