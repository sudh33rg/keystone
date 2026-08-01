import * as vscode from "vscode";

import { VscodeProvider } from "../ui/vscodeProvider";
import { indexCommands } from "../commands/indexCommands";
import { createStatusBar } from "./statusBar";
import { QaService } from "./qaService";
import { BackgroundWorkerCoordinator } from "./backgroundWorkerCoordinator";

/**
 * Extension entry point — called by VS Code when activated.
 * Sets up the status bar, registers the webview view provider,
 * and wires up all commands.
 */
export function activate(context: vscode.ExtensionContext): void {
  const statusBar = createStatusBar();
  const output = vscode.window.createOutputChannel("Keystone Intelligence", { log: true });
  const provider = new VscodeProvider(context.extensionUri, statusBar, output, context);
  const qaService = new QaService();
  const backgroundWorkers = new Map<string, BackgroundWorkerCoordinator>();

  context.subscriptions.push(statusBar, output, qaService, provider.attachQaService(qaService), { dispose: () => { for (const coordinator of backgroundWorkers.values()) coordinator.dispose(); backgroundWorkers.clear(); } });
  indexCommands(context, provider, qaService);

  statusBar.text = "Keystone: Ready | Intelligence cached in .keystone";
  statusBar.show();

  const startWorkspace = (folder: vscode.WorkspaceFolder): void => {
    const root = folder.uri.fsPath;
    output.info(`Workspace opened; starting automatic intelligence for ${root}.`);
    void provider.indexWorkspace(root);
    const coordinator = backgroundWorkers.get(root) ?? new BackgroundWorkerCoordinator();
    backgroundWorkers.set(root, coordinator);
    coordinator.start(root, event => provider.reportBackgroundWorker(event));
  };

  for (const folder of vscode.workspace.workspaceFolders ?? []) startWorkspace(folder);
  context.subscriptions.push(
    vscode.workspace.onDidChangeWorkspaceFolders((event) => {
      for (const folder of event.removed) { backgroundWorkers.get(folder.uri.fsPath)?.dispose(); backgroundWorkers.delete(folder.uri.fsPath); }
      for (const folder of event.added) startWorkspace(folder);
    })
  );

  const refreshTimers = new Map<string, NodeJS.Timeout>();
  const queueIntelligenceRefresh = (uri: vscode.Uri): void => {
    const relative = vscode.workspace.asRelativePath(uri, false).replace(/\\/g, "/");
    if (/(^|\/)(\.keystone|\.git|node_modules|dist|out|build|coverage|cache|\.cache|__pycache__|env|\.env|venv|\.venv|site-packages|vendor|target|\.next|\.nuxt|\.gradle|\.idea)(\/|$)/.test(relative)) return;
    if (/\.(log|tmp|swp|class|jar|png|jpe?g|gif|ico|woff2?)$/i.test(relative)) return;
    const folder = vscode.workspace.getWorkspaceFolder(uri);
    if (!folder) return;
    const root = folder.uri.fsPath;
    const existingTimer = refreshTimers.get(root);
    if (existingTimer) clearTimeout(existingTimer);
    output.debug(`Repository change detected: ${relative}. Intelligence refresh scheduled.`);
    refreshTimers.set(root, setTimeout(() => {
      refreshTimers.delete(root);
      void provider.indexWorkspace(root);
      const coordinator = backgroundWorkers.get(root) ?? new BackgroundWorkerCoordinator();
      backgroundWorkers.set(root, coordinator);
      coordinator.start(root, event => provider.reportBackgroundWorker(event));
    }, 2_000));
  };
  const watcher = vscode.workspace.createFileSystemWatcher("**/*");
  context.subscriptions.push(
    watcher,
    watcher.onDidCreate(queueIntelligenceRefresh),
    watcher.onDidChange(queueIntelligenceRefresh),
    watcher.onDidDelete(queueIntelligenceRefresh),
    vscode.window.onDidChangeActiveTextEditor(() => { void provider.activeWorkspaceChanged(); }),
    { dispose: () => { for (const timer of refreshTimers.values()) clearTimeout(timer); refreshTimers.clear(); } }
  );
}

/** Called when the extension is deactivated. */
export function deactivate(): void {
  // VS Code disposes registered subscriptions.
}
