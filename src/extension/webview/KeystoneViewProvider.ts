import * as vscode from "vscode";
import type { ConfigurationService } from "../../core/configuration/ConfigurationService";
import type { WorkspaceStateStore } from "../../core/persistence/WorkspaceStateStore";
import type { WorkspaceSummary } from "../../shared/contracts/domain";
import type { KeystoneLogger } from "../../shared/logging/KeystoneLogger";
import { WebviewMessageRouter } from "./WebviewMessageRouter";

export class KeystoneViewProvider implements vscode.WebviewViewProvider {
  static readonly viewType = "keystone.controlCenter";

  constructor(
    private readonly extensionUri: vscode.Uri,
    private readonly extensionVersion: string,
    private readonly store: WorkspaceStateStore,
    private readonly configuration: ConfigurationService,
    private readonly logger: KeystoneLogger
  ) {}

  async resolveWebviewView(webviewView: vscode.WebviewView): Promise<void> {
    const assetsRoot = vscode.Uri.joinPath(this.extensionUri, "dist", "webview");
    webviewView.webview.options = {
      enableScripts: true,
      enableCommandUris: false,
      localResourceRoots: [assetsRoot]
    };

    webviewView.webview.html = await this.createHtml(webviewView.webview, assetsRoot);
    const router = new WebviewMessageRouter(
      this.store,
      this.configuration,
      this.logger,
      this.extensionVersion,
      workspaceSummary,
      (message) => webviewView.webview.postMessage(message)
    );

    webviewView.webview.onDidReceiveMessage(
      (message: unknown) => {
        void router.handle(message);
      },
      undefined
    );

    this.logger.info("webview.resolve", "Keystone control center resolved.");
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

function workspaceSummary(): WorkspaceSummary {
  const roots = vscode.workspace.workspaceFolders ?? [];
  return {
    name: roots.length === 0 ? "No workspace open" : roots.length === 1 ? roots[0]?.name ?? "Workspace" : `${roots[0]?.name ?? "Workspace"} +${roots.length - 1}`,
    rootCount: roots.length,
    trust: vscode.workspace.isTrusted ? "trusted" : "restricted",
    indexStatus: "not-started"
  };
}

function createNonce(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(18));
  return Array.from(bytes, (value) => value.toString(16).padStart(2, "0")).join("");
}

function fallbackHtml(): string {
  return "<!doctype html><html><body><h1>Keystone</h1><p>Build the extension with <code>npm run build</code>, then reload this window.</p></body></html>";
}
