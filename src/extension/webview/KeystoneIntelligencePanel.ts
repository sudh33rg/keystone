// KeystoneIntelligencePanel.ts
// Provides a dedicated Webview panel for the new intelligence services:
// Exported Symbols, Wildcard Search, Module Mapping, Circular Dependencies,
// Node Metrics, Dead Code, Filtered Subgraph, and Cyclomatic Complexity.

import * as vscode from "vscode";
import type { IntelligenceSnapshotReader } from "../../core/persistence/IntelligenceStore";
import { ExportedSymbolsService } from "../../core/intelligence/services/ExportedSymbolsService";
import { WildcardSearchService } from "../../core/intelligence/services/WildcardSearchService";
import { ModuleMappingService } from "../../core/intelligence/services/ModuleMappingService";
import { CircularDependencyService } from "../../core/intelligence/services/CircularDependencyService";
import { NodeMetricsService } from "../../core/intelligence/services/NodeMetricsService";
import { DeadCodeService } from "../../core/intelligence/services/DeadCodeService";
import { FilteredSubgraphService } from "../../core/intelligence/services/FilteredSubgraphService";
import { CyclomaticComplexityService } from "../../core/intelligence/services/CyclomaticComplexityService";

export class KeystoneIntelligencePanel implements vscode.Disposable {
  static readonly viewType = "keystone.intelligence.explorer";
  private panel?: vscode.WebviewPanel;
  private disposables: vscode.Disposable[] = [];

  constructor(
    private readonly extensionUri: vscode.Uri,
    private readonly store: IntelligenceSnapshotReader,
  ) {}

  show(): void {
    if (this.panel) {
      this.panel.reveal(vscode.ViewColumn.Two, true);
      return;
    }

    this.panel = vscode.window.createWebviewPanel(
      KeystoneIntelligencePanel.viewType,
      "Keystone Intelligence Explorer",
      vscode.ViewColumn.Two,
      {
        enableScripts: true,
        retainContextWhenHidden: true,
        localResourceRoots: [
          vscode.Uri.joinPath(this.extensionUri, "dist"),
        ],
      },
    );

    this.panel.webview.html = this.getHtmlForWebview();

    this.panel.onDidDispose(() => this.dispose(), null, this.disposables);

    this.panel.webview.onDidReceiveMessage(
      async (message) => {
        await this.handleMessage(message);
      },
      null,
      this.disposables,
    );
  }

  private async handleMessage(message: unknown): Promise<void> {
    if (!this.panel) return;

    const msg = message as { type: string; payload?: unknown };
    try {
      switch (msg.type) {
        case "exported-symbols/list": {
          const service = new ExportedSymbolsService(this.store);
          const fileId = (msg.payload as { fileId?: string })?.fileId;
          if (!fileId) {
            const result = await service.listAllExported();
            this.panel.webview.postMessage({
              type: "exported-symbols/result",
              data: result,
            });
          } else {
            const result = await service.listFileExports(fileId);
            this.panel.webview.postMessage({
              type: "exported-symbols/result",
              data: result,
            });
          }
          break;
        }
        case "wildcard-search": {
          const service = new WildcardSearchService(this.store);
          const payload = msg.payload as { pattern: string; fields?: ("name" | "qualifiedName" | "relativePath" | "type" | "language")[]; limit?: number } | undefined;
          const result = await service.search(
            payload ?? { pattern: "" },
          );
          this.panel.webview.postMessage({
            type: "wildcard-search/result",
            data: result,
          });
          break;
        }
        case "module-mapping": {
          const service = new ModuleMappingService(this.store);
          const result = await service.mapModules();
          this.panel.webview.postMessage({
            type: "module-mapping/result",
            data: result,
          });
          break;
        }
        case "circular-dependencies": {
          const service = new CircularDependencyService(this.store);
          const result = await service.detectAll();
          this.panel.webview.postMessage({
            type: "circular-dependencies/result",
            data: result,
          });
          break;
        }
        case "node-metrics": {
          const service = new NodeMetricsService(this.store);
          const result = await service.computeAll();
          this.panel.webview.postMessage({
            type: "node-metrics/result",
            data: result,
          });
          break;
        }
        case "dead-code": {
          const service = new DeadCodeService(this.store);
          const result = await service.detect();
          this.panel.webview.postMessage({
            type: "dead-code/result",
            data: result,
          });
          break;
        }
        case "filtered-subgraph": {
          const service = new FilteredSubgraphService(this.store);
          const payload = msg.payload as { seedIds: string[]; direction?: "incoming" | "outgoing" | "both"; maxDepth?: number } | undefined;
          const result = await service.extract(
            payload ?? { seedIds: [] },
          );
          this.panel.webview.postMessage({
            type: "filtered-subgraph/result",
            data: result,
          });
          break;
        }
        case "cyclomatic-complexity": {
          const service = new CyclomaticComplexityService(this.store);
          const result = await service.analyze();
          this.panel.webview.postMessage({
            type: "cyclomatic-complexity/result",
            data: result,
          });
          break;
        }
        default:
          break;
      }
    } catch (error) {
      this.panel.webview.postMessage({
        type: "error",
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  private getHtmlForWebview(): string {
    return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Keystone Intelligence Explorer</title>
  <style>
    body {
      font-family: var(--vscode-font-family);
      background-color: var(--vscode-editor-background);
      color: var(--vscode-editor-foreground);
      margin: 0;
      padding: 0;
    }
    .tabs {
      display: flex;
      border-bottom: 1px solid var(--vscode-panel-border);
      background-color: var(--vscode-sideBar-background);
    }
    .tab {
      padding: 8px 16px;
      cursor: pointer;
      border: none;
      background: none;
      color: var(--vscode-sideBar-foreground);
      font-size: 13px;
    }
    .tab:hover {
      background-color: var(--vscode-sideBarSectionHeader-hoverBackground);
    }
    .tab.active {
      background-color: var(--vscode-editor-background);
      color: var(--vscode-editor-foreground);
      border-bottom: 2px solid var(--vscode-focusBorder);
    }
    .content {
      padding: 16px;
      overflow-y: auto;
      height: calc(100vh - 40px);
    }
    .section {
      margin-bottom: 24px;
    }
    .section h2 {
      font-size: 16px;
      margin-bottom: 12px;
      color: var(--vscode-titleBar-activeForeground);
    }
    .card {
      background-color: var(--vscode-editor-background);
      border: 1px solid var(--vscode-panel-border);
      border-radius: 4px;
      padding: 12px;
      margin-bottom: 8px;
    }
    .card-header {
      display: flex;
      justify-content: space-between;
      align-items: center;
      margin-bottom: 8px;
    }
    .card-title {
      font-weight: 600;
      font-size: 14px;
    }
    .card-meta {
      font-size: 12px;
      color: var(--vscode-descriptionForeground);
    }
    .badge {
      display: inline-block;
      padding: 2px 8px;
      border-radius: 12px;
      font-size: 11px;
      font-weight: 500;
    }
    .badge-high { background-color: var(--vscode-errorForeground); color: white; }
    .badge-medium { background-color: var(--vscode-warningForeground); color: white; }
    .badge-low { background-color: var(--vscode-infoForeground); color: white; }
    .badge-success { background-color: var(--vscode-testing-iconPassed); color: white; }
    input, select {
      width: 100%;
      padding: 6px 8px;
      margin-bottom: 8px;
      background-color: var(--vscode-input-background);
      color: var(--vscode-input-foreground);
      border: 1px solid var(--vscode-input-border);
      border-radius: 2px;
    }
    button {
      padding: 6px 12px;
      background-color: var(--vscode-button-background);
      color: var(--vscode-button-foreground);
      border: none;
      border-radius: 2px;
      cursor: pointer;
    }
    button:hover {
      background-color: var(--vscode-button-hoverBackground);
    }
    .loading {
      text-align: center;
      padding: 20px;
      color: var(--vscode-descriptionForeground);
    }
    .error {
      color: var(--vscode-errorForeground);
      padding: 8px;
      background-color: var(--vscode-errorForeground);
      opacity: 0.1;
      border-radius: 4px;
    }
  </style>
</head>
<body>
  <div class="tabs">
    <button class="tab active" data-tab="exported">Exported Symbols</button>
    <button class="tab" data-tab="search">Wildcard Search</button>
    <button class="tab" data-tab="modules">Modules</button>
    <button class="tab" data-tab="cycles">Cycles</button>
    <button class="tab" data-tab="metrics">Metrics</button>
    <button class="tab" data-tab="deadcode">Dead Code</button>
    <button class="tab" data-tab="subgraph">Subgraph</button>
    <button class="tab" data-tab="complexity">Complexity</button>
  </div>
  <div class="content">
    <div id="tab-exported" class="tab-content">
      <div class="section">
        <h2>Exported Symbols</h2>
        <button id="btn-list-all">List All Exported</button>
        <div id="exported-results"></div>
      </div>
    </div>
    <div id="tab-search" class="tab-content" style="display:none">
      <div class="section">
        <h2>Wildcard Search</h2>
        <input type="text" id="search-pattern" placeholder="Enter pattern (e.g., *.ts, Foo*, **/test/*)" />
        <button id="btn-search">Search</button>
        <div id="search-results"></div>
      </div>
    </div>
    <div id="tab-modules" class="tab-content" style="display:none">
      <div class="section">
        <h2>Module Mapping</h2>
        <button id="btn-modules">Map Modules</button>
        <div id="modules-results"></div>
      </div>
    </div>
    <div id="tab-cycles" class="tab-content" style="display:none">
      <div class="section">
        <h2>Circular Dependencies</h2>
        <button id="btn-cycles">Detect Cycles</button>
        <div id="cycles-results"></div>
      </div>
    </div>
    <div id="tab-metrics" class="tab-content" style="display:none">
      <div class="section">
        <h2>Node Metrics</h2>
        <button id="btn-metrics">Compute Metrics</button>
        <div id="metrics-results"></div>
      </div>
    </div>
    <div id="tab-deadcode" class="tab-content" style="display:none">
      <div class="section">
        <h2>Dead Code Detection</h2>
        <button id="btn-deadcode">Detect Dead Code</button>
        <div id="deadcode-results"></div>
      </div>
    </div>
    <div id="tab-subgraph" class="tab-content" style="display:none">
      <div class="section">
        <h2>Filtered Subgraph</h2>
        <input type="text" id="subgraph-seeds" placeholder="Seed IDs (comma-separated)" />
        <select id="subgraph-direction">
          <option value="both">Both</option>
          <option value="outgoing">Outgoing</option>
          <option value="incoming">Incoming</option>
        </select>
        <button id="btn-subgraph">Extract Subgraph</button>
        <div id="subgraph-results"></div>
      </div>
    </div>
    <div id="tab-complexity" class="tab-content" style="display:none">
      <div class="section">
        <h2>Cyclomatic Complexity</h2>
        <button id="btn-complexity">Analyze Complexity</button>
        <div id="complexity-results"></div>
      </div>
    </div>
  </div>
  <script>
    const vscode = acquireVsCodeApi();
    const tabs = document.querySelectorAll('.tab');
    const contents = document.querySelectorAll('.tab-content');

    tabs.forEach(tab => {
      tab.addEventListener('click', () => {
        tabs.forEach(t => t.classList.remove('active'));
        contents.forEach(c => c.style.display = 'none');
        tab.classList.add('active');
        document.getElementById('tab-' + tab.dataset.tab).style.display = 'block';
      });
    });

    function send(type, payload = {}) {
      vscode.postMessage({ type, payload });
    }

    function showLoading(containerId) {
      document.getElementById(containerId).innerHTML = '<div class="loading">Loading...</div>';
    }

    function showError(containerId, error) {
      document.getElementById(containerId).innerHTML = '<div class="error">' + error + '</div>';
    }

    function renderResults(containerId, data) {
      if (!data || !data.length) {
        document.getElementById(containerId).innerHTML = '<div class="loading">No results found.</div>';
        return;
      }
      let html = '';
      for (const item of data) {
        html += '<div class="card"><div class="card-header"><span class="card-title">' + (item.name || item.moduleName || item.qualifiedName || item.id) + '</span><span class="card-meta">' + (item.type || item.level || '') + '</span></div>';
        if (item.relativePath) html += '<div class="card-meta">' + item.relativePath + '</div>';
        if (item.cyclomaticComplexity !== undefined) html += '<div class="card-meta">Complexity: ' + item.cyclomaticComplexity + '</div>';
        if (item.totalDegree !== undefined) html += '<div class="card-meta">Degree: ' + item.totalDegree + '</div>';
        if (item.risk) html += '<span class="badge badge-' + item.risk + '">' + item.risk + '</span>';
        if (item.level) html += '<span class="badge badge-' + item.level + '">' + item.level + '</span>';
        html += '</div>';
      }
      document.getElementById(containerId).innerHTML = html;
    }

    document.getElementById('btn-list-all').addEventListener('click', () => {
      showLoading('exported-results');
      send('exported-symbols/list');
    });

    document.getElementById('btn-search').addEventListener('click', () => {
      const pattern = document.getElementById('search-pattern').value;
      if (!pattern) return;
      showLoading('search-results');
      send('wildcard-search', { pattern });
    });

    document.getElementById('btn-modules').addEventListener('click', () => {
      showLoading('modules-results');
      send('module-mapping');
    });

    document.getElementById('btn-cycles').addEventListener('click', () => {
      showLoading('cycles-results');
      send('circular-dependencies');
    });

    document.getElementById('btn-metrics').addEventListener('click', () => {
      showLoading('metrics-results');
      send('node-metrics');
    });

    document.getElementById('btn-deadcode').addEventListener('click', () => {
      showLoading('deadcode-results');
      send('dead-code');
    });

    document.getElementById('btn-subgraph').addEventListener('click', () => {
      const seeds = document.getElementById('subgraph-seeds').value.split(',').map(s => s.trim()).filter(Boolean);
      const direction = document.getElementById('subgraph-direction').value;
      showLoading('subgraph-results');
      send('filtered-subgraph', { seedIds: seeds, direction });
    });

    document.getElementById('btn-complexity').addEventListener('click', () => {
      showLoading('complexity-results');
      send('cyclomatic-complexity');
    });

    window.addEventListener('message', event => {
      const message = event.data;
      if (message.type === 'error') {
        showError('exported-results', message.error);
        return;
      }
      if (message.type === 'exported-symbols/result') {
        const items = message.data?.exported || [];
        renderResults('exported-results', items.slice(0, 50));
      } else if (message.type === 'wildcard-search/result') {
        renderResults('search-results', message.data?.matches || []);
      } else if (message.type === 'module-mapping/result') {
        renderResults('modules-results', message.data?.modules || []);
      } else if (message.type === 'circular-dependencies/result') {
        renderResults('cycles-results', message.data?.cycles || []);
      } else if (message.type === 'node-metrics/result') {
        renderResults('metrics-results', message.data?.nodes?.slice(0, 50) || []);
      } else if (message.type === 'dead-code/result') {
        renderResults('deadcode-results', message.data?.candidates || []);
      } else if (message.type === 'filtered-subgraph/result') {
        renderResults('subgraph-results', message.data?.nodes || []);
      } else if (message.type === 'cyclomatic-complexity/result') {
        renderResults('complexity-results', message.data?.results?.slice(0, 50) || []);
      }
    });
  </script>
</body>
</html>`;
  }

  dispose(): void {
    this.panel?.dispose();
    for (const disposable of this.disposables) disposable.dispose();
    this.disposables = [];
  }
}
