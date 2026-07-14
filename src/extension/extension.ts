import * as vscode from "vscode";
import { ConfigurationService } from "../core/configuration/ConfigurationService";
import { WorkspaceStateStore } from "../core/persistence/WorkspaceStateStore";
import { KeystoneError } from "../shared/errors/KeystoneError";
import { KeystoneLogger } from "../shared/logging/KeystoneLogger";
import { KeystoneViewProvider } from "./webview/KeystoneViewProvider";

let logger: KeystoneLogger | undefined;

export async function activate(context: vscode.ExtensionContext): Promise<void> {
  const startedAt = performance.now();
  const configuration = new ConfigurationService();
  const output = vscode.window.createOutputChannel("Keystone");
  logger = new KeystoneLogger(output, () => configuration.read().logging.level);
  const store = new WorkspaceStateStore(context.workspaceState);

  try {
    await store.initialize();
  } catch (cause) {
    const error = KeystoneError.fromUnknown(cause, "extension.activate");
    logger.error(error);
    void vscode.window.showErrorMessage(`${error.message} ${error.recommendedAction}`);
  }

  const packageVersion = (context.extension.packageJSON as { version?: unknown }).version;
  const extensionVersion = typeof packageVersion === "string" ? packageVersion : "0.0.0";
  const provider = new KeystoneViewProvider(context.extensionUri, extensionVersion, store, configuration, logger);

  context.subscriptions.push(
    vscode.window.registerWebviewViewProvider(KeystoneViewProvider.viewType, provider, {
      webviewOptions: { retainContextWhenHidden: false }
    }),
    vscode.commands.registerCommand("keystone.open", async () => {
      await vscode.commands.executeCommand("workbench.view.extension.keystone");
    }),
    vscode.commands.registerCommand("keystone.showLogs", () => logger?.show()),
    vscode.workspace.onDidChangeConfiguration((event) => {
      if (event.affectsConfiguration("keystone")) logger?.info("configuration.changed", "Keystone configuration changed.");
    }),
    { dispose: () => logger?.dispose() }
  );

  logger.info("extension.activate", "Keystone foundation activated.", {
    durationMs: Math.round(performance.now() - startedAt),
    workspaceRoots: vscode.workspace.workspaceFolders?.length ?? 0,
    trusted: vscode.workspace.isTrusted
  });
}

export function deactivate(): void {
  logger?.info("extension.deactivate", "Keystone deactivated.");
}
