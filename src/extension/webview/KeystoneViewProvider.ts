import * as vscode from "vscode";
import type { ConfigurationService } from "../../core/configuration/ConfigurationService";
import type { WorkspaceStateStore } from "../../core/persistence/WorkspaceStateStore";
import type { WorkspaceSummary } from "../../shared/contracts/domain";
import type { KeystoneLogger } from "../../shared/logging/KeystoneLogger";
import { WebviewMessageRouter, type IntelligenceServiceRegistry } from "./WebviewMessageRouter";

export class KeystoneViewProvider implements vscode.Disposable {
  static readonly viewType = "keystone.controlCenter";
  private panel: vscode.WebviewPanel | undefined;
  private router: WebviewMessageRouter | undefined;
  private receiver: vscode.Disposable | undefined;

  constructor(
    private readonly extensionUri: vscode.Uri,
    private readonly extensionVersion: string,
    private readonly store: WorkspaceStateStore,
    private readonly configuration: ConfigurationService,
    private readonly logger: KeystoneLogger,
    private readonly services: IntelligenceServiceRegistry
  ) {}

  async show(): Promise<void> {
    if (this.panel) {
      this.panel.reveal(vscode.ViewColumn.One);
      return;
    }
    const panel = vscode.window.createWebviewPanel(
      KeystoneViewProvider.viewType,
      "Keystone Control Center",
      vscode.ViewColumn.One,
      { enableScripts: true, enableCommandUris: false, retainContextWhenHidden: true }
    );
    panel.iconPath = vscode.Uri.joinPath(this.extensionUri, "resources", "keystone.svg");
    await this.attach(panel);
  }

  async restore(panel: vscode.WebviewPanel): Promise<void> {
    this.disposePanel();
    await this.attach(panel);
  }

  dispose(): void {
    const panel = this.panel;
    this.disposePanel();
    panel?.dispose();
  }

  private async attach(panel: vscode.WebviewPanel): Promise<void> {
    this.panel = panel;
    const assetsRoot = vscode.Uri.joinPath(this.extensionUri, "dist", "webview");
    panel.webview.options = {
      enableScripts: true,
      enableCommandUris: false,
      localResourceRoots: [assetsRoot]
    };
    panel.webview.html = await this.createHtml(panel.webview, assetsRoot);

    this.router = new WebviewMessageRouter(
      this.store,
      this.configuration,
      this.logger,
      this.extensionVersion,
      () => this.workspaceSummary(),
      (message) => panel.webview.postMessage(message),
      this.services
    );
    this.receiver = panel.webview.onDidReceiveMessage((message: unknown) => void this.router?.handle(message));
    panel.onDidDispose(() => {
      if (this.panel !== panel) return;
      this.disposePanel();
    });
    this.logger.info("webview.resolve", "Keystone control center opened in the editor area.");
  }

  private disposePanel(): void {
    this.receiver?.dispose();
    this.receiver = undefined;
    this.router?.dispose();
    this.router = undefined;
    this.panel = undefined;
  }

  private workspaceSummary(): WorkspaceSummary {
    const roots = vscode.workspace.workspaceFolders ?? [];
    return {
      name: roots.length === 0 ? "No workspace open" : roots.length === 1 ? roots[0]?.name ?? "Workspace" : `${roots[0]?.name ?? "Workspace"} +${roots.length - 1}`,
      rootCount: roots.length,
      trust: vscode.workspace.isTrusted ? "trusted" : "restricted",
      indexStatus: this.services.intelligenceRuntime.getState().status
    };
  }

  private async createHtml(webview: vscode.Webview, assetsRoot: vscode.Uri): Promise<string> {
    const indexUri = vscode.Uri.joinPath(assetsRoot, "index.html");
    let html: string;
    try {
      html = new TextDecoder().decode(await vscode.workspace.fs.readFile(indexUri));
    } catch (error) {
      this.logger.warning("webview.assets", "Built Webview assets were not found.", error);
      return fallbackHtml();
    }
    const nonce = createNonce();
    html = html.replace(/(src|href)="\.\/([^"#?]+)([^"]*)"/g, (_match, attribute: string, assetPath: string, suffix: string) => {
      const uri = webview.asWebviewUri(vscode.Uri.joinPath(assetsRoot, ...assetPath.split("/")));
      return `${attribute}="${uri.toString()}${suffix}"`;
    });
    html = html.replace(/<script\b/g, `<script nonce="${nonce}"`);
    const csp = [
      "default-src 'none'",
      `img-src ${webview.cspSource} data:`,
      `font-src ${webview.cspSource}`,
      `style-src ${webview.cspSource}`,
      `script-src 'nonce-${nonce}'`
    ].join("; ");
    return html.replace("<head>", `<head>\n<meta http-equiv="Content-Security-Policy" content="${csp}">`);
  }
}

function createNonce(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(18));
  return Array.from(bytes, (value) => value.toString(16).padStart(2, "0")).join("");
}

function fallbackHtml(): string {
  return "<!doctype html><html><body><h1>Keystone</h1><p>Build the extension with <code>npm run build</code>, then reload this window.</p></body></html>";
}
