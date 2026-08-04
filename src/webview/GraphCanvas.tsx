export interface VisualGraphNode {
  id: string;
  label: string;
  kind: string;
  path?: string;
  line?: number;
  seed?: boolean;
  communityId?: string;
  communityLabel?: string;
  architectureAnchor?: { weightedDegree: number; reason: string };
  lensRole?: "target" | "direct" | "available" | "out-of-scope" | "included" | "retained" | "excluded" | "candidate" | "used-by";
  lensReason?: string;
  estimatedTokens?: number;
  confidence?: number;
}
export interface VisualGraphEdge {
  id: string;
  sourceId: string;
  targetId: string;
  kind: string;
  origin?: "EXTRACTED" | "RESOLVED" | "INFERRED" | "AMBIGUOUS";
  confidence?: number;
  evidenceIds?: string[];
  sourceLocation?: { workspaceRelativePath: string; startLine?: number; endLine?: number };
  resolutionExplanation?: string;
}

interface Props {
  nodes: readonly VisualGraphNode[];
  edges: readonly VisualGraphEdge[];
  selectedId?: string;
  onSelect: (node: VisualGraphNode) => void;
  onSelectEdge?: (edge: VisualGraphEdge) => void;
  selectedEdgeId?: string;
  emptyText?: string;
}
interface State {
  zoom: number;
  panX: number;
  panY: number;
  dragging: boolean;
  startX: number;
  startY: number;
  originX: number;
  originY: number;
}
interface Positioned extends VisualGraphNode {
  x: number;
  y: number;
}

interface CommunityGroup {
  id: string;
  label: string;
  x: number;
  y: number;
  width: number;
  height: number;
}

export class GraphCanvas extends React.Component<Props, State> {
  state: State = {
    zoom: 1,
    panX: 0,
    panY: 0,
    dragging: false,
    startX: 0,
    startY: 0,
    originX: 0,
    originY: 0
  };

  render(): JSX.Element {
    if (!this.props.nodes.length)
      return <div className="empty graph-empty">{this.props.emptyText ?? "No graph data."}</div>;
    const positioned = layout(this.props.nodes, this.props.edges);
    const positions = new Map(positioned.map((node) => [node.id, node]));
    const communities = communityGroups(positioned);
    return (
      <div className="graph-shell">
        <div className="graph-toolbar">
          <button onClick={() => this.setState({ zoom: Math.max(0.45, this.state.zoom - 0.15) })}>
            −
          </button>
          <span>{Math.round(this.state.zoom * 100)}%</span>
          <button onClick={() => this.setState({ zoom: Math.min(2.4, this.state.zoom + 0.15) })}>
            +
          </button>
          <button onClick={() => this.setState({ zoom: 1, panX: 0, panY: 0 })}>Reset</button>
          <span className="graph-hint">Drag to pan · scroll to zoom · click a node or edge to inspect</span>
        </div>
        <svg
          className="graph-canvas"
          viewBox="0 0 1200 720"
          onMouseDown={(event: any) => this.begin(event)}
          onMouseMove={(event: any) => this.move(event)}
          onMouseUp={() => this.end()}
          onMouseLeave={() => this.end()}
          onWheel={(event: any) => this.wheel(event)}
        >
          <defs>
            <marker
              id="keystone-arrow"
              markerWidth="8"
              markerHeight="8"
              refX="7"
              refY="3"
              orient="auto"
            >
              <path d="M0,0 L0,6 L8,3 z" className="graph-arrow" />
            </marker>
          </defs>
          <g
            transform={`translate(${this.state.panX} ${this.state.panY}) scale(${this.state.zoom})`}
          >
            {communities.map((community) => (
              <g className="graph-community" key={community.id}>
                <rect x={community.x} y={community.y} width={community.width} height={community.height} rx="18" />
                <text x={community.x + 14} y={community.y + 19}>{clip(community.label, 28)}</text>
              </g>
            ))}
            {this.props.edges.map((edge) => {
              const from = positions.get(edge.sourceId),
                to = positions.get(edge.targetId);
              if (!from || !to) return null;
              return (
                <g key={edge.id} className={this.props.selectedEdgeId === edge.id ? "edge-selected" : ""} onClick={(event: any) => { event.stopPropagation(); this.props.onSelectEdge?.(edge); }}>
                  <line
                    x1={from.x}
                    y1={from.y}
                    x2={to.x}
                    y2={to.y}
                    className={`graph-edge edge-${safe(edge.kind)} origin-${safe(edge.origin ?? "EXTRACTED")}`}
                    markerEnd="url(#keystone-arrow)"
                  />
                  <text x={(from.x + to.x) / 2} y={(from.y + to.y) / 2 - 5} className="edge-label">
                    {clip(edge.kind, 18)}
                  </text>
                  <title>{`${edge.kind}${edge.origin ? ` (${edge.origin})` : ""}${edge.confidence ? ` · ${Math.round(edge.confidence * 100)}% confidence` : ""}`}</title>
                </g>
              );
            })}
            {positioned.map((node) => (
              <g
                key={node.id}
                className={`graph-node ${node.seed ? "seed" : ""} ${node.architectureAnchor ? "anchor" : ""} ${node.lensRole ? `lens-${safe(node.lensRole)}` : ""} ${this.props.selectedId === node.id ? "selected" : ""}`}
                transform={`translate(${node.x} ${node.y})`}
                onMouseDown={(event: any) => event.stopPropagation()}
                onClick={() => this.props.onSelect(node)}
              >
                <rect x="-72" y="-27" width="144" height="54" rx="9" />
                <text y="-5" textAnchor="middle" className="node-kind">
                  {node.kind}
                </text>
                <text y="13" textAnchor="middle" className="node-label">
                  {clip(node.label, 20)}
                </text>
                {node.lensRole && <text y="42" textAnchor="middle" className="node-role">{node.lensRole}</text>}
                {node.architectureAnchor && <text y="-39" textAnchor="middle" className="node-badge">◆ anchor</text>}
              </g>
            ))}
          </g>
        </svg>
      </div>
    );
  }
  private begin(event: any): void {
    this.setState({
      dragging: true,
      startX: event.clientX,
      startY: event.clientY,
      originX: this.state.panX,
      originY: this.state.panY
    });
  }
  private wheel(event: any): void {
    event.preventDefault();
    this.setState({ zoom: Math.max(0.45, Math.min(2.4, this.state.zoom + (event.deltaY < 0 ? 0.1 : -0.1))) });
  }
  private move(event: any): void {
    if (!this.state.dragging) return;
    this.setState({
      panX: this.state.originX + (event.clientX - this.state.startX),
      panY: this.state.originY + (event.clientY - this.state.startY)
    });
  }
  private end(): void {
    if (this.state.dragging) this.setState({ dragging: false });
  }
}

function layout(
  nodes: readonly VisualGraphNode[],
  edges: readonly VisualGraphEdge[]
): Positioned[] {
  const byId = new Map(nodes.map((node) => [node.id, node]));
  const adjacency = new Map<string, string[]>();
  for (const edge of edges) {
    if (!byId.has(edge.sourceId) || !byId.has(edge.targetId)) continue;
    const a = adjacency.get(edge.sourceId) ?? [];
    a.push(edge.targetId);
    adjacency.set(edge.sourceId, a);
    const b = adjacency.get(edge.targetId) ?? [];
    b.push(edge.sourceId);
    adjacency.set(edge.targetId, b);
  }
  const roots = nodes.filter((node) => node.seed).map((node) => node.id);
  if (!roots.length && nodes[0]) roots.push(nodes[0].id);
  const depth = new Map<string, number>();
  const queue = roots.map((id) => ({ id, d: 0 }));
  for (const root of roots) depth.set(root, 0);
  while (queue.length) {
    const current = queue.shift()!;
    for (const next of adjacency.get(current.id) ?? []) {
      if (depth.has(next)) continue;
      depth.set(next, current.d + 1);
      queue.push({ id: next, d: current.d + 1 });
    }
  }
  let maxDepth = Math.max(0, ...depth.values());
  for (const node of nodes) {
    if (!depth.has(node.id)) depth.set(node.id, ++maxDepth);
  }
  const levels = new Map<number, VisualGraphNode[]>();
  for (const node of nodes) {
    const d = Math.min(depth.get(node.id) ?? 0, 7);
    const list = levels.get(d) ?? [];
    list.push(node);
    levels.set(d, list);
  }
  const width = 1080,
    height = 620,
    left = 95,
    top = 55;
  const levelKeys = [...levels.keys()].sort((a, b) => a - b);
  const columnGap = levelKeys.length <= 1 ? 0 : width / (levelKeys.length - 1);
  const output: Positioned[] = [];
  levelKeys.forEach((level, column) => {
    const list = levels
      .get(level)!
      .sort((a, b) => a.kind.localeCompare(b.kind) || a.label.localeCompare(b.label));
    const gap = height / (list.length + 1);
    list.forEach((node, row) =>
      output.push({ ...node, x: left + column * columnGap, y: top + (row + 1) * gap })
    );
  });
  return output;
}

function communityGroups(nodes: Positioned[]): CommunityGroup[] {
  const groups = new Map<string, Positioned[]>();
  for (const node of nodes) {
    if (!node.communityId) continue;
    const list = groups.get(node.communityId) ?? [];
    list.push(node);
    groups.set(node.communityId, list);
  }
  return [...groups].map(([id, members]) => {
    const minX = Math.min(...members.map((node) => node.x)) - 92;
    const maxX = Math.max(...members.map((node) => node.x)) + 92;
    const minY = Math.min(...members.map((node) => node.y)) - 52;
    const maxY = Math.max(...members.map((node) => node.y)) + 52;
    return { id, label: members[0].communityLabel ?? id, x: minX, y: minY, width: Math.max(180, maxX - minX), height: Math.max(116, maxY - minY) };
  });
}
function safe(value: string): string {
  return value.replace(/[^a-z0-9]+/gi, "-").toLowerCase();
}
function clip(value: string, max: number): string {
  return value.length > max ? `${value.slice(0, max - 1)}…` : value;
}
