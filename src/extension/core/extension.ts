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
  const changeTimers = new Map<string, ReturnType<typeof setTimeout>>();
  const pendingChanges = new Map<string, Set<string>>();
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
    // Startup consumes the promoted snapshot. Only the first run (or an
    // explicit UI refresh) is allowed to invoke the indexing pipeline.
    let indexedSuccessfully = indexed ?? true;
    let input = await provider.getBackgroundWorkerInput(root);
    if (!input && indexed === undefined) {
      await provider.ensureWorkspaceIntelligence(root);
      input = await provider.getBackgroundWorkerInput(root);
      indexedSuccessfully = Boolean(input);
    }
    if (!indexedSuccessfully) {
      output.warn(
        `Intelligence refresh did not promote a new snapshot for ${root}; attempting worker recovery from the last validated OKF snapshot.`
      );
    }
    if (!input) {
      output.warn(
        `Background workers were not started because ${root} has no validated OKF input.`
      );
      return;
    }
    coordinator.start(root, reportBackgroundWorker, input);
  };

  context.subscriptions.push(
    statusBar,
    output,
    qaService,
    provider.attachQaService(qaService),
    provider.registerLanguageModelTools(),
    {
      dispose: () => {
        for (const coordinator of backgroundWorkers.values()) coordinator.dispose();
        backgroundWorkers.clear();
      }
    }
  );
  indexCommands(context, provider);

  statusBar.text = "Keystone: Ready | Intelligence cached in .keystone";
  statusBar.show();

  const startWorkspace = (folder: vscode.WorkspaceFolder): void => {
    const root = folder.uri.fsPath;
    output.info(`Workspace opened; using the promoted intelligence snapshot for ${root}.`);
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

  context.subscriptions.push(
    vscode.window.onDidChangeActiveTextEditor(() => {
      void provider.activeWorkspaceChanged();
    })
  );
  // Reconciliation is scoped to the active Intent. It refreshes only when an existing
  // package has relevant stale evidence, so ordinary edits do not produce alerts.
  for (const folder of vscode.workspace.workspaceFolders ?? []) {
    const watcher = vscode.workspace.createFileSystemWatcher(`${folder.uri.fsPath}/**`);
    const reconcile = (uri: vscode.Uri) => {
      const root = folder.uri.fsPath;
      const paths = pendingChanges.get(root) ?? new Set<string>();
      paths.add(uri.fsPath);
      pendingChanges.set(root, paths);
      const existing = changeTimers.get(root);
      if (existing) clearTimeout(existing);
      changeTimers.set(
        root,
        setTimeout(() => {
          changeTimers.delete(root);
          const changed = [...(pendingChanges.get(root) ?? [])];
          pendingChanges.delete(root);
          void provider.workspaceFilesChanged(root, changed);
        }, 300)
      );
    };
    context.subscriptions.push(
      watcher,
      watcher.onDidCreate(reconcile),
      watcher.onDidChange(reconcile),
      watcher.onDidDelete(reconcile)
    );
  }
}

/** Called when the extension is deactivated. */
export function deactivate(): void {
  // VS Code disposes registered subscriptions.
}
