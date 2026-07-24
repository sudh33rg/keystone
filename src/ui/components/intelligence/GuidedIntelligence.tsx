import { useCallback, useEffect, useMemo, useState } from "react";
import type { HostBridge } from "../../services/HostBridge";
import type { GuidedResult, IntelligenceSubmenu, GuidedRequest, ContextCandidate, GuidedDiagram } from "../../../shared/contracts/guidedIntelligence";

const SECONDARY_NAV: { id: IntelligenceSubmenu; label: string; slice1: boolean }[] = [
  { id: "overview", label: "Overview", slice1: true },
  { id: "systems", label: "Systems", slice1: true },
  { id: "architecture", label: "Architecture", slice1: true },
  { id: "flows", label: "Flows", slice1: true },
  { id: "messaging", label: "Messaging", slice1: true },
  { id: "data", label: "Data and Database", slice1: true },
  { id: "apis", label: "APIs", slice1: false },
  { id: "dependencies", label: "Dependencies", slice1: false },
  { id: "code", label: "Code", slice1: false },
  { id: "tests", label: "Tests", slice1: false },
  { id: "impact", label: "Impact", slice1: false },
  { id: "security", label: "Security", slice1: false },
  { id: "performance", label: "Performance", slice1: false },
  { id: "okf", label: "OKF", slice1: false },
  { id: "explore", label: "Explore", slice1: false },
  { id: "ask", label: "Ask", slice1: false },
];

const START_ACTIONS: { label: string; request: GuidedRequest }[] = [
  { label: "Understand this repository", request: { view: "overview", action: "understand" } },
  { label: "Show the system landscape", request: { view: "systems", action: "landscape" } },
  { label: "Show the architecture", request: { view: "architecture", action: "architecture" } },
  { label: "Show how the application starts", request: { view: "flows", action: "startup" } },
  { label: "Show a request flow", request: { view: "flows", action: "request" } },
  { label: "Show a messaging flow", request: { view: "flows", action: "messaging" } },
  { label: "Show a database flow", request: { view: "data", action: "db-flow" } },
  { label: "Show APIs and routes", request: { view: "apis", action: "routes" } },
  { label: "Show data and persistence", request: { view: "data", action: "models" } },
  { label: "Show dependencies", request: { view: "dependencies", action: "system" } },
  { label: "Show tests", request: { view: "tests", action: "landscape" } },
  { label: "Show security risks", request: { view: "security", action: "summary" } },
  { label: "Show performance-sensitive paths", request: { view: "performance", action: "hotpaths" } },
  { label: "Find reusable components", request: { view: "code", action: "components" } },
  { label: "Build Copilot context", request: { view: "overview", action: "context" } },
];

const ASK_QUESTIONS: { label: string; request: GuidedRequest }[] = [
  { label: "What does this repository do?", request: { view: "overview", action: "understand" } },
  { label: "What systems exist?", request: { view: "systems", action: "landscape" } },
  { label: "How do the systems communicate?", request: { view: "systems", action: "communication" } },
  { label: "Show an end-to-end request", request: { view: "flows", action: "request" } },
  { label: "Show a messaging flow", request: { view: "flows", action: "messaging" } },
  { label: "Show the database calls for this route", request: { view: "data", action: "callmap" } },
  { label: "Who writes to this table?", request: { view: "data", action: "writers" } },
  { label: "Where are the trust boundaries?", request: { view: "security", action: "trust" } },
  { label: "What are the performance-sensitive paths?", request: { view: "performance", action: "hotpaths" } },
];

const NODE_FILL: Record<string, string> = {
  repository: "#475569",
  system: "#0ea5e9",
  application: "#2563eb",
  service: "#7c3aed",
  worker: "#0891b2",
  "scheduled-job": "#0d9488",
  library: "#64748b",
  database: "#16a34a",
  cache: "#ca8a04",
  broker: "#db2777",
  topic: "#db2777",
  queue: "#db2777",
  "external-api": "#dc2626",
  infrastructure: "#475569",
  module: "#6366f1",
  route: "#f59e0b",
  message: "#db2777",
  entity: "#16a34a",
  table: "#15803d",
  actor: "#0f172a",
  handler: "#7c3aed",
  test: "#22c55e",
  unresolved: "#94a3b8",
};

const EDGE_COLOR: Record<string, string> = {
  "database-read": "#16a34a",
  "database-write": "#15803d",
  "event-publish": "#db2777",
  "event-subscribe": "#db2777",
  "queue-send": "#db2777",
  "queue-receive": "#db2777",
  "http-request": "#2563eb",
  rpc: "#7c3aed",
  calls: "#475569",
  imports: "#94a3b8",
  "foreign-key": "#16a34a",
  "depends-on": "#cbd5e1",
  "configuration-dependency": "#ca8a04",
};

interface Props {
  bridge: HostBridge;
}

export function GuidedIntelligence({ bridge }: Props): React.JSX.Element {
  const [submenu, setSubmenu] = useState<IntelligenceSubmenu>("overview");
  const [result, setResult] = useState<GuidedResult | undefined>();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | undefined>();
  const [tray, setTray] = useState<ContextCandidate[]>([]);
  const [contextSummary, setContextSummary] = useState<string | undefined>();

  const run = useCallback(
    async (request: GuidedRequest) => {
      setLoading(true);
      setError(undefined);
      try {
        const res = await bridge.request("intelligence/guided", request);
        setResult(res);
        setSubmenu(res.view);
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e));
      } finally {
        setLoading(false);
      }
    },
    [bridge],
  );

  useEffect(() => {
    void Promise.resolve().then(() => run({ view: "overview", action: "understand" }));
  }, [run]);

  const addToTray = useCallback((candidate: ContextCandidate) => {
    setTray((prev) => (prev.some((item) => item.id === candidate.id) ? prev : [...prev, candidate]));
  }, []);

  const removeFromTray = useCallback((id: string) => {
    setTray((prev) => prev.filter((item) => item.id !== id));
  }, []);

  const buildContext = useCallback(() => {
    setContextSummary(
      `Context package prepared with ${tray.length} selected item(s): ${tray.map((item) => item.label).join(", ")}.`,
    );
  }, [tray]);

  return (
    <div className="guided-intelligence">
      <header className="guided-header">
        <div>
          <h1>Repository Intelligence</h1>
          <p className="guided-subtitle">
            Guided, evidence-backed exploration. No query language or internal identifiers required.
          </p>
        </div>
        {result?.generation !== undefined && (
          <button className="guided-refresh" onClick={() => void run({ view: "overview", action: "understand" })}>
            Refresh Intelligence
          </button>
        )}
      </header>

      <nav className="guided-secondary-nav" aria-label="Intelligence sections">
        {SECONDARY_NAV.map((item) => (
          <button
            key={item.id}
            className={`guided-tab${submenu === item.id ? " active" : ""}${item.slice1 ? "" : " planned"}`}
            onClick={() => item.slice1 && void run({ view: item.id, action: "default" })}
            disabled={!item.slice1}
            title={item.slice1 ? item.label : `${item.label} (planned for a later slice)`}
          >
            {item.label}
          </button>
        ))}
      </nav>

      {result && (
        <div className="guided-orientation" aria-label="Orientation">
          {result.orientation.map((crumb, idx) => (
            <span key={`${crumb.level}-${idx}`} className="guided-crumb">
              {idx > 0 && <span className="guided-crumb-sep"> › </span>}
              <button
                className="guided-crumb-btn"
                onClick={() => crumb.target && void run({ view: crumb.target.submenu, action: "default", entityId: crumb.target.entityId })}
                disabled={!crumb.target}
              >
                {crumb.label}
              </button>
            </span>
          ))}
          <button className="guided-crumb-return" onClick={() => void run({ view: "overview", action: "understand" })}>
            Return to Repository Overview
          </button>
        </div>
      )}

      <div className="guided-body">
        <section className="guided-main">
          {loading && <p className="guided-loading">Loading guided intelligence…</p>}
          {error && <p className="guided-error">{error}</p>}
          {!loading && !error && result && (
            <>
              <div className="guided-answer">
                <h2>{result.title}</h2>
                <p>{result.answer}</p>
                {result.limitations.length > 0 && (
                  <p className="guided-limitations">Limitations: {result.limitations.join(" ")}</p>
                )}
              </div>

              {submenu === "overview" && (
                <StartExploring actions={START_ACTIONS} onRun={run} />
              )}

              {result.diagram && result.diagram.nodes.length > 0 && (
                <GuidedDiagramView diagram={result.diagram} onNode={(id) => addToTrayForNode(result, id, addToTray)} />
              )}

              {result.entities.length > 0 && (
                <EntityList entities={result.entities} onAdd={(e) => addToTray({ id: e.id, kind: e.type, label: e.name, entityId: e.id, reason: `Detected ${e.type}.`, confidence: e.confidence })} />
              )}

              {result.followUps.length > 0 && (
                <FollowUps followUps={result.followUps} onRun={run} />
              )}

              {submenu === "ask" && <AskPanel questions={ASK_QUESTIONS} onRun={run} />}
            </>
          )}
        </section>

        <ContextTray items={tray} onRemove={removeFromTray} onBuild={buildContext} summary={contextSummary} />
      </div>
    </div>
  );
}

function addToTrayForNode(result: GuidedResult, id: string, add: (c: ContextCandidate) => void): void {
  const node = result.diagram?.nodes.find((n) => n.id === id);
  if (node) add({ id: node.id, kind: node.entityType ?? node.kind, label: node.label, entityId: node.entityId, reason: `Selected ${node.kind} from ${result.title}.`, confidence: node.confidence });
}

function StartExploring({ actions, onRun }: { actions: { label: string; request: GuidedRequest }[]; onRun: (r: GuidedRequest) => void | Promise<void> }): React.JSX.Element {
  return (
    <div className="guided-start">
      <h3>Start exploring</h3>
      <div className="guided-start-grid">
        {actions.map((a) => (
          <button key={a.label} className="guided-start-btn" onClick={() => void onRun(a.request)}>
            {a.label}
          </button>
        ))}
      </div>
    </div>
  );
}

function AskPanel({ questions, onRun }: { questions: { label: string; request: GuidedRequest }[]; onRun: (r: GuidedRequest) => void | Promise<void> }): React.JSX.Element {
  return (
    <div className="guided-ask">
      <h3>Ask a repository question</h3>
      <div className="guided-start-grid">
        {questions.map((q) => (
          <button key={q.label} className="guided-start-btn" onClick={() => void onRun(q.request)}>
            {q.label}
          </button>
        ))}
      </div>
    </div>
  );
}

function FollowUps({ followUps, onRun }: { followUps: GuidedResult["followUps"]; onRun: (r: GuidedRequest) => void | Promise<void> }): React.JSX.Element {
  return (
    <div className="guided-followups">
      <h3>Continue</h3>
      <div className="guided-followup-row">
        {followUps.map((f) => {
          const payload = f.payload ?? {};
          const view = (typeof payload.view === "string" ? payload.view : "overview") as IntelligenceSubmenu;
          const entityId = typeof payload.entityId === "string" ? payload.entityId : undefined;
          return (
            <button key={f.label} className="guided-followup-btn" onClick={() => void onRun({ view, action: f.action, entityId })}>
              {f.label}
            </button>
          );
        })}
      </div>
    </div>
  );
}

function EntityList({ entities, onAdd }: { entities: GuidedResult["entities"]; onAdd: (e: GuidedResult["entities"][number]) => void }): React.JSX.Element {
  return (
    <div className="guided-entities">
      <h3>Detected entities ({entities.length})</h3>
      <ul className="guided-entity-list">
        {entities.slice(0, 30).map((e) => (
          <li key={e.id}>
            <span className={`guided-badge conf-${e.classification}`}>{e.classification}</span>
            <span className="guided-entity-name">{e.name}</span>
            <span className="guided-entity-type">{e.type}</span>
            <button className="guided-mini-btn" onClick={() => onAdd(e)}>Add to context</button>
          </li>
        ))}
      </ul>
    </div>
  );
}

function GuidedDiagramView({ diagram, onNode }: { diagram: GuidedDiagram; onNode: (id: string) => void }): React.JSX.Element {
  const layout = useMemo(() => computeLayout(diagram), [diagram]);
  return (
    <div className="guided-diagram">
      <h3>Diagram ({diagram.kind}{diagram.orientation ? ` · ${diagram.orientation}` : ""})</h3>
      {diagram.legend.length > 0 && (
        <div className="guided-legend">
          {diagram.legend.map((l) => (
            <span key={l.kind} className="guided-legend-item">
              <span className="guided-legend-swatch" style={{ background: NODE_FILL[l.kind] ?? "#94a3b8" }} /> {l.label}
            </span>
          ))}
        </div>
      )}
      <svg className="guided-svg" viewBox={layout.viewBox} role="img" aria-label="Intelligence diagram">
        {diagram.edges.map((edge) => {
          const a = layout.pos.get(edge.source);
          const b = layout.pos.get(edge.target);
          if (!a || !b) return null;
          return (
            <line
              key={edge.id}
              x1={a.x}
              y1={a.y}
              x2={b.x}
              y2={b.y}
              stroke={EDGE_COLOR[edge.interaction] ?? "#cbd5e1"}
              strokeWidth={edge.dashed ? 1.5 : 2.5}
              strokeDasharray={edge.dashed ? "4 3" : undefined}
              markerEnd="url(#arrow)"
            >
              <title>{`${edge.interaction}${edge.label ? ` (${edge.label})` : ""} — ${edge.classification}`}</title>
            </line>
          );
        })}
        <defs>
          <marker id="arrow" markerWidth="10" markerHeight="10" refX="8" refY="3" orient="auto" markerUnits="strokeWidth">
            <path d="M0,0 L8,3 L0,6 Z" fill="#475569" />
          </marker>
        </defs>
        {diagram.nodes.map((node) => {
          const p = layout.pos.get(node.id);
          if (!p) return null;
          return (
            <g key={node.id} transform={`translate(${p.x},${p.y})`} className="guided-node" onClick={() => onNode(node.id)} style={{ cursor: "pointer" }}>
              <rect width={layout.nodeW} height={layout.nodeH} rx={6} fill={NODE_FILL[node.kind] ?? "#94a3b8"} opacity={node.classification === "unresolved" ? 0.6 : 1} />
              <text x={layout.nodeW / 2} y={layout.nodeH / 2} textAnchor="middle" dominantBaseline="middle" fill="#fff" fontSize={11} className="guided-node-label">
                {node.label.length > 18 ? `${node.label.slice(0, 16)}…` : node.label}
              </text>
              <title>{`${node.kind}: ${node.label} (${node.classification})`}</title>
            </g>
          );
        })}
      </svg>
    </div>
  );
}

interface Layout {
  pos: Map<string, { x: number; y: number }>;
  viewBox: string;
  nodeW: number;
  nodeH: number;
}

function computeLayout(diagram: GuidedDiagram): Layout {
  const nodeW = 120;
  const nodeH = 34;
  const gapX = 40;
  const gapY = 24;
  const pos = new Map<string, { x: number; y: number }>();
  const orientation = diagram.orientation ?? (diagram.kind === "ordered-flow" || diagram.kind === "swimlane-flow" ? "left-to-right" : "system-landscape");
  const nodes = diagram.nodes;
  if (orientation === "top-to-bottom" || diagram.kind === "system-landscape") {
    const cols = Math.ceil(Math.sqrt(nodes.length || 1));
    nodes.forEach((n, i) => {
      const c = i % cols;
      const r = Math.floor(i / cols);
      pos.set(n.id, { x: c * (nodeW + gapX), y: r * (nodeH + gapY) });
    });
  } else {
    // left-to-right / swimlanes: ordered steps first
    const order = new Map(diagram.steps.map((s) => [s.nodeId, s.index]));
    nodes.forEach((n, i) => {
      const rank = order.has(n.id) ? order.get(n.id)! : i;
      const lane = i % Math.max(1, Math.ceil(nodes.length / 6));
      pos.set(n.id, { x: rank * (nodeW + gapX), y: lane * (nodeH + gapY) });
    });
  }
  let maxX = 0;
  let maxY = 0;
  for (const p of pos.values()) {
    maxX = Math.max(maxX, p.x + nodeW);
    maxY = Math.max(maxY, p.y + nodeH);
  }
  return { pos, viewBox: `0 0 ${maxX + 20} ${maxY + 20}`, nodeW, nodeH };
}

function ContextTray({ items, onRemove, onBuild, summary }: { items: ContextCandidate[]; onRemove: (id: string) => void; onBuild: () => void; summary?: string }): React.JSX.Element {
  const tokens = items.reduce((sum, i) => sum + (i.estimatedTokens ?? 400), 0);
  return (
    <aside className="guided-tray" aria-label="Context tray">
      <h3>Context tray ({items.length})</h3>
      <p className="guided-tray-tokens">≈ {tokens.toLocaleString()} tokens</p>
      {items.length === 0 && <p className="guided-tray-empty">Select systems, flows, entities or evidence to build a Copilot context package.</p>}
      <ul>
        {items.map((item) => (
          <li key={item.id}>
            <span className="guided-tray-label">{item.label}</span>
            <span className="guided-tray-reason">{item.reason}</span>
            <button className="guided-mini-btn" onClick={() => onRemove(item.id)}>Remove</button>
          </li>
        ))}
      </ul>
      {items.length > 0 && (
        <button className="guided-tray-build" onClick={onBuild}>Build Context Package</button>
      )}
      {summary && <p className="guided-tray-summary">{summary}</p>}
    </aside>
  );
}
