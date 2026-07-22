import { useCallback, useEffect, useMemo, useState } from "react";
import {
  Background,
  Controls,
  MarkerType,
  ReactFlow,
  type Edge,
  type Node,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import type {
  IntelligenceCanvasEdge,
  IntelligenceCanvasMode,
  IntelligenceCanvasNode,
  IntelligenceCanvasSearchItem,
  IntelligenceEngineeringQueryResult,
  IntelligenceGraphSlice,
} from "../../../shared/contracts/intelligenceCanvas";
import type { HostBridge } from "../../services/HostBridge";

const MODES: Array<{ id: IntelligenceCanvasMode; label: string }> = [
  { id: "architecture", label: "Architecture" },
  { id: "calls", label: "Calls" },
  { id: "dependencies", label: "Dependencies" },
  { id: "flow", label: "Flow" },
  { id: "tests", label: "Tests" },
];
type LooseRequest = (type: string, payload: unknown) => Promise<unknown>;

export function IntelligenceCanvasWorkspace({
  bridge,
  intelligenceRevision,
  initialEntityId,
  initialQuery = "",
  initialGraph,
  embedded = false,
}: {
  bridge: HostBridge;
  intelligenceRevision: string;
  initialEntityId?: string;
  initialQuery?: string;
  initialGraph?: IntelligenceGraphSlice;
  embedded?: boolean;
}): React.JSX.Element {
  const request = bridge.request.bind(bridge) as LooseRequest;
  const [input, setInput] = useState(initialQuery);
  const [candidates, setCandidates] = useState<IntelligenceCanvasSearchItem[]>([]);
  const [graph, setGraph] = useState<IntelligenceGraphSlice | undefined>(initialGraph);
  const [mode, setMode] = useState<IntelligenceCanvasMode>("calls");
  const [depth, setDepth] = useState(1);
  const [relationships, setRelationships] = useState<string[]>(["calls", "routes-to"]);
  const [selectedNode, setSelectedNode] = useState<IntelligenceCanvasNode>();
  const [selectedEdge, setSelectedEdge] = useState<IntelligenceCanvasEdge>();
  const [evidence, setEvidence] = useState<Array<{ id: string; filePath: string; excerpt: string; provider: string; evidenceType: string; confidence: number }>>([]);
  const [showRelationships, setShowRelationships] = useState(false);
  const [summary, setSummary] = useState<string>();
  const [selectedPath, setSelectedPath] = useState<{ entityIds: string[]; edgeIds: string[]; evidenceIds: string[] }>();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  const stale = Boolean(graph && graph.intelligenceRevision !== intelligenceRevision);

  const loadGraph = useCallback((rootId: string, nextMode = mode, nextDepth = depth, nextRelationships = relationships, direction: "inbound" | "outbound" | "both" = "both"): void => {
    setBusy(true);
    setError(undefined);
    void request("intelligence.canvas.graph", {
      rootEntityIds: [rootId], mode: nextMode, direction, depth: nextDepth,
      relationshipTypes: nextRelationships, maxNodes: 75, maxEdges: 150, minimumConfidence: 0,
      intelligenceRevision,
    }).then((value) => {
      setGraph(value as IntelligenceGraphSlice);
      setCandidates([]);
    }).catch(report(setError)).finally(() => setBusy(false));
  }, [depth, intelligenceRevision, mode, relationships, request]);

  useEffect(() => { if (initialEntityId) loadGraph(initialEntityId); }, [initialEntityId]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { if (initialGraph) setGraph(initialGraph); }, [initialGraph]);

  const search = (): void => {
    setBusy(true);
    setError(undefined);
    setSummary(undefined);
    setSelectedPath(undefined);
    void request("intelligence.canvas.search", { query: input, limit: 20 })
      .then((value) => setCandidates((value as { items: IntelligenceCanvasSearchItem[] }).items))
      .catch(report(setError)).finally(() => setBusy(false));
  };
  const ask = (): void => {
    setBusy(true);
    setError(undefined);
    void request("intelligence.canvas.query", { text: input, intelligenceRevision, limits: { maxNodes: 75, maxEdges: 150, depth } })
      .then((value) => {
        const result = value as IntelligenceEngineeringQueryResult;
        setSummary(result.summary);
        setSelectedPath(result.path);
        if (result.graph) setGraph(result.graph);
        setCandidates(result.subjectCandidates);
      }).catch(report(setError)).finally(() => setBusy(false));
  };
  const chooseEdge = (edge: IntelligenceCanvasEdge): void => {
    setSelectedEdge(edge);
    setSelectedNode(undefined);
    setEvidence([]);
    void request("intelligence.canvas.evidence", { evidenceIds: edge.evidenceIds, intelligenceRevision })
      .then((value) => setEvidence((value as { items: typeof evidence }).items)).catch(report(setError));
  };
  const updateMode = (next: IntelligenceCanvasMode): void => {
    setMode(next);
    const nextRelationships = defaultRelationships(next);
    setRelationships(nextRelationships);
    const root = graph?.rootEntityIds[0] ?? initialEntityId;
    if (root) loadGraph(root, next, depth, nextRelationships);
  };
  const updateDepth = (next: number): void => {
    setDepth(next);
    const root = graph?.rootEntityIds[0] ?? initialEntityId;
    if (root) loadGraph(root, mode, next, relationships);
  };
  const toggleRelationship = (relationship: string): void => {
    const next = relationships.includes(relationship) ? relationships.filter((item) => item !== relationship) : [...relationships, relationship];
    setRelationships(next);
    const root = graph?.rootEntityIds[0] ?? initialEntityId;
    if (root && next.length) loadGraph(root, mode, depth, next);
  };
  const expand = (direction: "inbound" | "outbound"): void => {
    if (!selectedNode) return;
    setBusy(true);
    void request("intelligence.canvas.expand", {
      rootEntityIds: [selectedNode.id], mode, direction, depth: 1, relationshipTypes: relationships,
      maxNodes: 75, maxEdges: 150, minimumConfidence: 0, intelligenceRevision,
    }).then((value) => setGraph(mergeGraphs(graph, value as IntelligenceGraphSlice))).catch(report(setError)).finally(() => setBusy(false));
  };
  const collapse = (): void => {
    if (!selectedNode || !graph || graph.rootEntityIds.includes(selectedNode.id)) return;
    const adjacent = new Set(graph.edges.filter((edge) => edge.sourceId === selectedNode.id || edge.targetId === selectedNode.id).map((edge) => edge.id));
    setGraph({ ...graph, nodes: graph.nodes.filter((node) => node.id !== selectedNode.id), edges: graph.edges.filter((edge) => !adjacent.has(edge.id)) });
    setSelectedNode(undefined);
  };
  const entityAction = (type: string): void => {
    if (!selectedNode) return;
    void request(type, { entityId: selectedNode.id, intelligenceRevision }).then(() => setSummary(actionSummary(type))).catch(report(setError));
  };
  const guided = (action: "callers" | "callees" | "dependencies" | "dependents" | "tests"): void => {
    if (!selectedNode) return;
    const specification = action === "callers" ? { mode: "calls" as const, direction: "inbound" as const, types: ["calls", "routes-to"] }
      : action === "callees" ? { mode: "calls" as const, direction: "outbound" as const, types: ["calls", "routes-to"] }
      : action === "dependencies" ? { mode: "dependencies" as const, direction: "outbound" as const, types: ["imports", "depends-on"] }
      : action === "dependents" ? { mode: "dependencies" as const, direction: "inbound" as const, types: ["imports", "depends-on"] }
      : { mode: "tests" as const, direction: "outbound" as const, types: ["tested-by", "imports", "calls"] };
    setMode(specification.mode); setRelationships(specification.types); loadGraph(selectedNode.id, specification.mode, 1, specification.types, specification.direction);
  };
  const addPathToContext = (): void => {
    if (!selectedPath) return;
    void request("intelligence.canvas.addPathContext", { entityIds: selectedPath.entityIds, edgeIds: selectedPath.edgeIds, evidenceIds: selectedPath.evidenceIds, intelligenceRevision })
      .then(() => setSummary(`Added bounded flow path (${selectedPath.entityIds.length} entities, ${selectedPath.edgeIds.length} relationships) to Development context.`))
      .catch(report(setError));
  };

  const flow = useMemo(() => layoutGraph(graph), [graph]);
  return (
    <section className="intelligence-canvas-workspace" aria-label="Intelligence canvas workspace">
      {!embedded && <header className="canvas-query-bar">
        <label htmlFor="intelligence-canvas-query">Search or ask Intelligence</label>
        <div>
          <input id="intelligence-canvas-query" value={input} onChange={(event) => setInput(event.target.value)}
            placeholder="Ask about callers, dependencies, flows, or tests…" />
          <button className="ghost-button" onClick={search} disabled={!input.trim()}>Search</button>
          <button className="primary-button" onClick={ask} disabled={!input.trim()}>Ask</button>
        </div>
      </header>}
      {!embedded && <div className="canvas-mode-bar" role="toolbar" aria-label="Intelligence view mode">
        {MODES.map((item) => <button key={item.id} aria-pressed={mode === item.id} onClick={() => updateMode(item.id)}>{item.label}</button>)}
        <label>Graph depth <select aria-label="Graph depth" value={depth} onChange={(event) => updateDepth(Number(event.target.value))}>
          {[1, 2, 3, 4].map((value) => <option key={value}>{value}</option>)}
        </select></label>
        <button onClick={() => setShowRelationships((value) => !value)}>Relationship list</button>
      </div>}
      {!embedded && <div className="canvas-filter-row">
        {relationshipsForMode(mode).map((relationship) => <label key={relationship}><input type="checkbox" aria-label={`${relationship} relationship`}
          checked={relationships.includes(relationship)} onChange={() => toggleRelationship(relationship)} />{relationship}</label>)}
      </div>}
      {stale && <div className="canvas-notice warning" role="status">This result is stale because repository Intelligence advanced. <button onClick={() => graph && loadGraph(graph.rootEntityIds[0]!)}>Refresh Result</button></div>}
      {graph?.truncation.truncated && <div className="canvas-notice warning" role="status">This result is truncated at the configured graph bounds. Expand a branch or narrow the filters.</div>}
      {summary && <div className="canvas-notice" role="status">{summary}</div>}
      {selectedPath && <div className="canvas-notice"><strong>Bounded path selected</strong> · {selectedPath.entityIds.length} entities · {selectedPath.edgeIds.length} relationships <button onClick={addPathToContext}>Add Flow to Context</button></div>}
      {error && <div className="diagnostic error" role="alert">{error}</div>}
      {candidates.length > 0 && <div className="canvas-candidates" aria-label="Entity matches">{candidates.map((candidate) =>
        <button key={candidate.id} onClick={() => loadGraph(candidate.id)}><strong>{candidate.qualifiedLabel}</strong><small>{candidate.context}</small></button>)}</div>}
      {!graph ? <div className="canvas-empty"><strong>Search for a real repository symbol</strong><span>Or ask a bounded question about callers, dependencies, flows, or tests. Keystone only displays indexed entities and evidence.</span></div> :
        <div className="intelligence-canvas-layout">
          <div className="intelligence-canvas" aria-label={`${mode} graph`}>
            {typeof ResizeObserver !== "undefined" && <ReactFlow nodes={flow.nodes} edges={flow.edges} fitView minZoom={.2} maxZoom={2}
              onNodeClick={(_, node) => setSelectedNode(graph.nodes.find((item) => item.id === node.id))}
              onEdgeClick={(_, edge) => { const item = graph.edges.find((candidate) => candidate.id === edge.id); if (item) chooseEdge(item); }}>
              <Background /><Controls showInteractive={false} />
            </ReactFlow>}
            <div className="canvas-node-index" aria-label="Accessible graph entities">{graph.nodes.map((node) =>
              <button key={node.id} className={selectedNode?.id === node.id ? "selected" : ""} onClick={() => { setSelectedNode(node); setSelectedEdge(undefined); }}>{node.label} · {node.kind}</button>)}</div>
            <div className="canvas-edge-index">{graph.edges.map((edge) => <button key={edge.id} onClick={() => chooseEdge(edge)}>{edge.relationshipType} edge · {labelFor(graph, edge.sourceId)} → {labelFor(graph, edge.targetId)}</button>)}</div>
          </div>
          <aside className="canvas-inspector" aria-label="Intelligence inspector">
            {selectedNode ? <><h3>Selected entity</h3><strong>{selectedNode.qualifiedLabel}</strong><span>{selectedNode.kind} · {selectedNode.filePath}</span>
              {selectedNode.range && <span>Lines {selectedNode.range.startLine + 1}–{selectedNode.range.endLine + 1}</span>}<span>{selectedNode.confidence.toFixed(2)} confidence · {selectedNode.inferred ? "inferred" : "resolved"}</span><span>{graph.edges.filter((edge) => edge.sourceId === selectedNode.id).length} outgoing · {graph.edges.filter((edge) => edge.targetId === selectedNode.id).length} incoming relationships</span>
              <div className="button-row"><button onClick={() => expand("inbound")}>Expand inbound</button><button onClick={() => expand("outbound")}>Expand outbound</button><button onClick={collapse}>Collapse branch</button></div>
              <div className="button-row"><button onClick={() => guided("callers")}>Show callers</button><button onClick={() => guided("callees")}>Show callees</button><button onClick={() => guided("dependencies")}>Show dependencies</button><button onClick={() => guided("dependents")}>Show dependents</button><button onClick={() => guided("tests")}>Show tests</button></div>
              <div className="button-row"><button onClick={() => entityAction("intelligence.canvas.openSource")}>Open Source</button><button onClick={() => entityAction("intelligence.canvas.addScope")}>Add to Development Scope</button><button onClick={() => entityAction("intelligence.canvas.addContext")}>Add to Context</button></div></>
              : selectedEdge ? <><h3>Selected relationship</h3><strong>{selectedEdge.relationshipType}</strong><span>{selectedEdge.confidence.toFixed(2)} confidence{selectedEdge.inferred ? " · inferred" : " · proven"}</span>
                <h4>Evidence</h4>{evidence.length ? evidence.map((item) => <article key={item.id}><strong>{item.filePath}</strong><p>{item.excerpt}</p><small>{item.provider} · {item.evidenceType} · {item.confidence.toFixed(2)}</small><button onClick={() => void request("intelligence.canvas.openEvidenceSource", { evidenceId: item.id, intelligenceRevision }).catch(report(setError))}>Open evidence source</button></article>) : <span>The relationship exists in stored Intelligence, but source evidence is unavailable.</span>}</>
              : <><h3>Inspector</h3><span>Select an entity or relationship to inspect source-backed details.</span></>}
          </aside>
        </div>}
      {showRelationships && <ul aria-label="Accessible relationships">{graph?.edges.map((edge) => <li key={edge.id}>{labelFor(graph, edge.sourceId)} {edge.relationshipType} {labelFor(graph, edge.targetId)}</li>)}</ul>}
    </section>
  );
}

function defaultRelationships(mode: IntelligenceCanvasMode): string[] {
  if (mode === "architecture") return ["contains", "imports", "depends-on"];
  if (mode === "dependencies") return ["imports", "depends-on"];
  if (mode === "tests") return ["tested-by", "imports", "calls"];
  if (mode === "flow") return ["routes-to", "calls", "reads", "writes", "flows-to"];
  return ["calls"];
}
function relationshipsForMode(mode: IntelligenceCanvasMode): string[] {
  if (mode === "architecture") return ["contains", "imports", "depends-on", "implements", "extends"];
  if (mode === "dependencies") return ["imports", "depends-on"];
  if (mode === "tests") return ["tested-by", "imports", "calls"];
  if (mode === "flow") return ["calls", "routes-to", "reads", "writes", "flows-to"];
  return ["calls"];
}
function layoutGraph(graph?: IntelligenceGraphSlice): { nodes: Node[]; edges: Edge[] } {
  if (!graph) return { nodes: [], edges: [] };
  return {
    nodes: graph.nodes.map((node, index) => ({ id: node.id, position: { x: (index % 4) * 230, y: Math.floor(index / 4) * 130 }, data: { label: `${node.label}\n${node.kind}` }, className: `canvas-flow-node kind-${node.kind}` })),
    edges: graph.edges.map((edge) => ({ id: edge.id, source: edge.sourceId, target: edge.targetId, label: edge.label, animated: false, markerEnd: { type: MarkerType.ArrowClosed }, style: edge.inferred ? { strokeDasharray: "5 4" } : undefined })),
  };
}
function mergeGraphs(previous: IntelligenceGraphSlice | undefined, next: IntelligenceGraphSlice): IntelligenceGraphSlice {
  if (!previous) return next;
  return { ...next, rootEntityIds: previous.rootEntityIds, nodes: unique([...previous.nodes, ...next.nodes]), edges: unique([...previous.edges, ...next.edges]), truncation: { ...next.truncation, truncated: previous.truncation.truncated || next.truncation.truncated, expandableEntityIds: [...new Set([...previous.truncation.expandableEntityIds, ...next.truncation.expandableEntityIds])] } };
}
function unique<T extends { id: string }>(items: T[]): T[] { return [...new Map(items.map((item) => [item.id, item])).values()]; }
function labelFor(graph: IntelligenceGraphSlice | undefined, id: string): string { return graph?.nodes.find((node) => node.id === id)?.label ?? id; }
function report(setter: (value: string) => void): (cause: unknown) => void { return (cause) => setter(cause instanceof Error ? cause.message : String(cause)); }
function actionSummary(type: string): string { return type.endsWith("openSource") ? "Opened source." : type.endsWith("addScope") ? "Added entity to Development scope." : "Added bounded Intelligence selection to context."; }
