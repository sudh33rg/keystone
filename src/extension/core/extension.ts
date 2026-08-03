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
  const createBackgroundWorkerCoordinator = (): BackgroundWorkerCoordinator =>
    new BackgroundWorkerCoordinator({
      maxRetries: vscode.workspace
        .getConfiguration("keystone.intelligence")
        .get<number>("workerRetries", 2)
    });
  const reportBackgroundWorker = (
    event: Parameters<VscodeProvider["reportBackgroundWorker"]>[0]
  ): void => {
    provider.reportBackgroundWorker(event);
    if (event.status === "failed") {
      const message = `${event.kind} worker ${event.workerId ?? ""} failed: ${event.error ?? "unknown error"}`;
      if (event.retrying) output.warn(`${message} A bounded retry is scheduled.`);
      else output.error(message);
    } else if (event.status === "stale" || event.status === "cancelled") {
      output.warn(
        `${event.kind} worker ${event.workerId ?? ""} ${event.status}: ${event.reason ?? ""}`
      );
    }
  };
  const launchBackgroundWorkers = async (
    root: string,
    coordinator: BackgroundWorkerCoordinator,
    indexed?: boolean
  ): Promise<void> => {
    const indexedSuccessfully = indexed ?? (await provider.indexWorkspace(root));
    if (!indexedSuccessfully) {
      output.warn(
        `Intelligence refresh did not promote a new snapshot for ${root}; attempting worker recovery from the last validated OKF snapshot.`
      );
    }
    const input = await provider.getBackgroundWorkerInput(root);
    if (!input) {
      output.warn(
        `Background workers were not started because ${root} has no validated OKF input.`
      );
      return;
    }
    coordinator.start(root, reportBackgroundWorker, input);
  };

  context.subscriptions.push(statusBar, output, qaService, provider.attachQaService(qaService), {
    dispose: () => {
      for (const coordinator of backgroundWorkers.values()) coordinator.dispose();
      backgroundWorkers.clear();
    }
  });
  indexCommands(context, provider);

  statusBar.text = "Keystone: Ready | Intelligence cached in .keystone";
  statusBar.show();

  const startWorkspace = (folder: vscode.WorkspaceFolder): void => {
    const root = folder.uri.fsPath;
    output.info(`Workspace opened; starting automatic intelligence for ${root}.`);
    const coordinator = backgroundWorkers.get(root) ?? createBackgroundWorkerCoordinator();
    backgroundWorkers.set(root, coordinator);
    const startBackgroundWorkers = async (): Promise<void> => {
      await launchBackgroundWorkers(root, coordinator);
    };
    void startBackgroundWorkers().catch((error) =>
      output.error(
        `Background workers could not start for ${root}: ${error instanceof Error ? error.message : String(error)}`
      )
    );
  };

  for (const folder of vscode.workspace.workspaceFolders ?? []) startWorkspace(folder);
  context.subscriptions.push(
    vscode.workspace.onDidChangeWorkspaceFolders((event) => {
      for (const folder of event.removed) {
        backgroundWorkers.get(folder.uri.fsPath)?.dispose();
        backgroundWorkers.delete(folder.uri.fsPath);
      }
      for (const folder of event.added) startWorkspace(folder);
    })
  );

  const refreshTimers = new Map<string, NodeJS.Timeout>();
  const refreshPaths = new Map<string, Set<string>>();
  const recoveryTimers = new Map<string, NodeJS.Timeout>();
  const queueIntelligenceRefresh = (uri: vscode.Uri): void => {
    const relative = vscode.workspace.asRelativePath(uri, false).replace(/\\/g, "/");
    if (
      /(^|\/)(\.keystone|\.git|node_modules|dist|out|build|coverage|cache|\.cache|__pycache__|env|\.env|venv|\.venv|site-packages|vendor|target|\.next|\.nuxt|\.gradle|\.idea)(\/|$)/.test(
        relative
      )
    )
      return;
    if (/\.(log|tmp|swp|class|jar|png|jpe?g|gif|ico|woff2?)$/i.test(relative)) return;
    const folder = vscode.workspace.getWorkspaceFolder(uri);
    if (!folder) return;
    const root = folder.uri.fsPath;
    if (!provider.shouldQueueAutomaticRefresh(root)) return;
    const pendingPaths = refreshPaths.get(root) ?? new Set<string>();
    pendingPaths.add(relative);
    refreshPaths.set(root, pendingPaths);
    const existingTimer = refreshTimers.get(root);
    if (existingTimer) clearTimeout(existingTimer);
    output.debug(`Repository change detected: ${relative}. Intelligence refresh scheduled.`);
    refreshTimers.set(
      root,
      setTimeout(() => {
        refreshTimers.delete(root);
        const changedPaths = [...(refreshPaths.get(root) ?? [])];
        refreshPaths.delete(root);
        if (!provider.shouldQueueAutomaticRefresh(root)) return;
        const coordinator = backgroundWorkers.get(root) ?? createBackgroundWorkerCoordinator();
        backgroundWorkers.set(root, coordinator);
        coordinator.dispose("superseded");
        void provider
          .indexWorkspace(root, changedPaths)
          .then((indexed) => launchBackgroundWorkers(root, coordinator, indexed))
          .catch((error) =>
            output.error(
              `Background workers could not restart for ${root}: ${error instanceof Error ? error.message : String(error)}`
            )
          );
      }, 2_000)
    );
  };
  const queueIntelligenceRecovery = (uri: vscode.Uri): void => {
    const relative = vscode.workspace.asRelativePath(uri, false).replace(/\\/g, "/");
    if (relative !== ".keystone" && !relative.startsWith(".keystone/")) return;
    const folder = vscode.workspace.getWorkspaceFolder(uri);
    if (!folder) return;
    const root = folder.uri.fsPath;
    backgroundWorkers.get(root)?.dispose("superseded");
    const existingTimer = recoveryTimers.get(root);
    if (existingTimer) clearTimeout(existingTimer);
    recoveryTimers.set(
      root,
      setTimeout(() => {
        recoveryTimers.delete(root);
        void provider.ensureWorkspaceIntelligence(root);
      }, 750)
    );
  };
  const watcher = vscode.workspace.createFileSystemWatcher("**/*");
  context.subscriptions.push(
    watcher,
    watcher.onDidCreate(queueIntelligenceRefresh),
    watcher.onDidChange(queueIntelligenceRefresh),
    watcher.onDidDelete(queueIntelligenceRefresh),
    watcher.onDidDelete(queueIntelligenceRecovery),
    vscode.window.onDidChangeActiveTextEditor(() => {
      void provider.activeWorkspaceChanged();
    }),
    {
      dispose: () => {
        for (const timer of refreshTimers.values()) clearTimeout(timer);
        refreshTimers.clear();
        refreshPaths.clear();
        for (const timer of recoveryTimers.values()) clearTimeout(timer);
        recoveryTimers.clear();
      }
    }
  );
}

/** Called when the extension is deactivated. */
export function deactivate(): void {
  // VS Code disposes registered subscriptions.
}
