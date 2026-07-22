/**
 * Static HTML export for intelligence snapshots.
 *
 * Deterministic, no LLM, no runtime I/O beyond writing a file.
 * Generates a self-contained HTML document embedding the current
 * visualization graph as JSON plus a minimal renderer.
 */
export interface StaticHtmlExportOptions {
  title?: string;
  maxNodes?: number;
  maxEdges?: number;
}

export class GraphExportService {
  async exportSnapshotAsStaticHtml(
    snapshot: Record<string, unknown>,
    options: StaticHtmlExportOptions = {},
  ): Promise<string> {
    const maxNodes = options.maxNodes ?? 500;
    const maxEdges = options.maxEdges ?? 2000;
    const title = options.title ?? "Intelligence snapshot";

    const nodes = Array.isArray((snapshot.nodes as any) ?? (snapshot.symbols as any))
      ? ((snapshot.nodes as any) ?? (snapshot.symbols as any)).slice(0, maxNodes)
      : [];
    const edges = Array.isArray((snapshot.edges as any) ?? (snapshot.relationships as any))
      ? ((snapshot.edges as any) ?? (snapshot.relationships as any)).slice(0, maxEdges)
      : [];

    const escapedTitle = escapeHtml(String(title));
    const json = JSON.stringify({ title, generatedAt: new Date().toISOString(), nodes, edges });

    return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>${escapedTitle}</title>
  <style>
    :root { box-sizing: border-box; }
    *, *::before, *::after { box-sizing: inherit; }
    body { margin: 0; font-family: ui-sans-serif, system-ui, -apple-system, Segoe UI, Roboto, Helvetica, Arial, sans-serif; background: #0b0c10; color: #c5c6c7; }
    header { padding: 16px; border-bottom: 1px solid #1f2833; }
    h1 { margin: 0 0 6px 0; font-size: 18px; color: #66fcf1; }
    .meta { color: #8a8f98; font-size: 12px; }
    main { padding: 16px; }
    .canvas { width: 100%; height: calc(100vh - 80px); background: #0b0c10; }
    .node { stroke: #45a29e; stroke-width: 1.2; }
    .edge { stroke: #1f2833; stroke-opacity: 0.85; }
    .label { fill: #c5c6c7; font-size: 10px; pointer-events: none; }
  </style>
</head>
<body>
  <header>
    <h1>${escapedTitle}</h1>
    <div class="meta">Exported ${new Date().toISOString()}</div>
  </header>
  <main>
    <svg id="graph" class="canvas" xmlns="http://www.w3.org/2000/svg"></svg>
  </main>
  <script>
    (function() {
      const data = ${json};
      const svg = document.getElementById("graph");
      const width = svg.clientWidth || 1200;
      const height = svg.clientHeight || 800;
      svg.setAttribute("viewBox", "0 0 " + width + " " + height);

      const index = new Map();
      data.nodes.forEach(function(n, i) {
        n.x = Math.min(Math.max(60, (i * 137) % width), width - 60);
        n.y = Math.min(Math.max(60, (i * 251) % height), height - 60);
        index.set(n.id, n);
      });

      const frag = document.createDocumentFragment();
      data.edges.forEach(function(e) {
        const s = index.get(e.sourceId || e.sourceNodeId);
        const t = index.get(e.targetId || e.targetNodeId);
        if (!s || !t) return;
        const line = document.createElementNS("http://www.w3.org/2000/svg", "line");
        line.setAttribute("x1", s.x);
        line.setAttribute("y1", s.y);
        line.setAttribute("x2", t.x);
        line.setAttribute("y2", t.y);
        line.setAttribute("class", "edge");
        frag.appendChild(line);
      });

      data.nodes.forEach(function(n) {
        const g = document.createElementNS("http://www.w3.org/2000/svg", "g");
        const circle = document.createElementNS("http://www.w3.org/2000/svg", "circle");
        circle.setAttribute("cx", n.x);
        circle.setAttribute("cy", n.y);
        circle.setAttribute("r", 10);
        circle.setAttribute("fill", "#0b0c10");
        circle.setAttribute("class", "node");
        const text = document.createElementNS("http://www.w3.org/2000/svg", "text");
        text.setAttribute("x", n.x + 14);
        text.setAttribute("y", n.y + 4);
        text.setAttribute("class", "label");
        text.textContent = (n.name || n.label || n.id || "").toString();
        g.appendChild(circle);
        g.appendChild(text);
        frag.appendChild(g);
      });

      svg.appendChild(frag);
    })();
  </script>
</body>
</html>`;
  }
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}
