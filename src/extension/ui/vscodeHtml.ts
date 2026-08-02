import * as vscode from "vscode";
import { randomBytes } from "node:crypto";

/**
 * Generates the HTML for the VSCode webview panel.
 * Injects a nonce for CSP, and references the bundled script and styles.
 */
export function getWebviewHtml(webview: vscode.Webview, extensionUri: vscode.Uri): string {
  const nonce = createNonce();
  const scriptUri = webview.asWebviewUri(
    vscode.Uri.joinPath(extensionUri, "dist", "media", "webview.js")
  );
  const styleUri = webview.asWebviewUri(
    vscode.Uri.joinPath(extensionUri, "dist", "media", "webview.css")
  );
  const reactUri = webview.asWebviewUri(
    vscode.Uri.joinPath(extensionUri, "dist", "media", "react.production.min.js")
  );
  const reactDomUri = webview.asWebviewUri(
    vscode.Uri.joinPath(extensionUri, "dist", "media", "react-dom.production.min.js")
  );

  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src ${webview.cspSource} https: data:; style-src ${webview.cspSource} 'unsafe-inline'; script-src 'nonce-${nonce}';" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <link href="${styleUri}" rel="stylesheet" />
  <title>Keystone</title>
</head>
<body>
  <div id="root"></div>
  <script nonce="${nonce}" src="${reactUri}"></script>
  <script nonce="${nonce}" src="${reactDomUri}"></script>
  <script nonce="${nonce}" type="module" src="${scriptUri}"></script>
</body>
</html>`;
}

function createNonce(): string {
  return randomBytes(24).toString("base64url");
}
