import * as vscode from "vscode";
import { ConfigurationService } from "../core/configuration/ConfigurationService";
import { DefaultIgnorePolicy } from "../core/intelligence/IgnorePolicy";
import { IntelligenceQueryService } from "../core/intelligence/IntelligenceQueryService";
import { RepositoryIndexService } from "../core/intelligence/RepositoryIndexService";
import { IntelligenceRuntime } from "../core/intelligence/runtime/IntelligenceRuntime";
import { WorkerPoolManager } from "../core/intelligence/runtime/WorkerPoolManager";
import { SemanticExtractionWorker } from "../core/intelligence/semantic/SemanticExtractionWorker";
import { TYPESCRIPT_SEMANTIC_PARSER_ID, TYPESCRIPT_SEMANTIC_PARSER_VERSION } from "../core/intelligence/semantic/SemanticVersion";
import { StartupReconciler } from "../core/intelligence/runtime/StartupReconciler";
import { CpgQueryService } from "../core/intelligence/cpg/CpgQueryService";
import { CPG_PROVIDER_ID, CPG_PROVIDER_VERSION } from "../shared/contracts/cpg";
import { UNIVERSAL_ADAPTER_VERSIONS } from "../core/intelligence/adapters/AdapterVersions";
import { IntelligenceStore } from "../core/persistence/IntelligenceStore";
import { WorkspaceStateStore } from "../core/persistence/WorkspaceStateStore";
import { KeystoneError } from "../shared/errors/KeystoneError";
import { KeystoneLogger } from "../shared/logging/KeystoneLogger";
import { VsCodeGitAdapter } from "./adapters/GitAdapter";
import { VsCodeLanguageServiceAdapter } from "./adapters/LanguageServiceAdapter";
import { VsCodeWorkspaceAdapter } from "./adapters/WorkspaceAdapter";
import { VsCodeRepositoryMonitor } from "./intelligence/VsCodeRepositoryMonitor";
import { KeystoneViewProvider } from "./webview/KeystoneViewProvider";

let logger: KeystoneLogger | undefined;

export async function activate(context: vscode.ExtensionContext): Promise<void> {
  const startedAt = performance.now();
  const configuration = new ConfigurationService();
  const output = vscode.window.createOutputChannel("Keystone");
  logger = new KeystoneLogger(output, () => configuration.read().logging.level);
  const workspaceState = new WorkspaceStateStore(context.workspaceState);
  await initializeFoundationState(workspaceState);

  const workspace = new VsCodeWorkspaceAdapter();
  const git = new VsCodeGitAdapter();
  const language = new VsCodeLanguageServiceAdapter();
  const ignorePolicy = new DefaultIgnorePolicy();
  const indexingConfiguration = workspace.getIndexingConfiguration();
  const storageRoot = context.storageUri?.scheme === "file" ? context.storageUri.fsPath : undefined;
  const workers = new WorkerPoolManager(indexingConfiguration.workerCount);
  const semanticWorker = new SemanticExtractionWorker();
  workers.attach(semanticWorker);
  const intelligenceStore = new IntelligenceStore(storageRoot, undefined, workers, indexingConfiguration.retainedGenerations);
  const repositoryIndex = new RepositoryIndexService(workspace, git, language, ignorePolicy, intelligenceStore, logger, workers, undefined, undefined, semanticWorker);
  const monitor = new VsCodeRepositoryMonitor(workspace, git, ignorePolicy, logger);
  const startup = new StartupReconciler(workspace, git, intelligenceStore, { [TYPESCRIPT_SEMANTIC_PARSER_ID]: TYPESCRIPT_SEMANTIC_PARSER_VERSION, [CPG_PROVIDER_ID]: CPG_PROVIDER_VERSION, ...UNIVERSAL_ADAPTER_VERSIONS });
  const intelligenceRuntime = new IntelligenceRuntime(workspace, git, intelligenceStore, repositoryIndex, workers, monitor, logger, startup);
  const cpgQuery = new CpgQueryService(intelligenceStore);
  const intelligenceQuery = new IntelligenceQueryService(intelligenceStore, intelligenceRuntime, cpgQuery);

  const packageVersion = (context.extension.packageJSON as { version?: unknown }).version;
  const extensionVersion = typeof packageVersion === "string" ? packageVersion : "0.0.0";
  const provider = new KeystoneViewProvider(
    context.extensionUri,
    extensionVersion,
    workspaceState,
    configuration,
    logger,
    { intelligenceRuntime, intelligenceQuery, cpgQuery, openSource }
  );

  context.subscriptions.push(
    vscode.window.registerWebviewViewProvider(KeystoneViewProvider.viewType, provider, {
      webviewOptions: { retainContextWhenHidden: false }
    }),
    vscode.commands.registerCommand("keystone.open", async () => {
      await vscode.commands.executeCommand("workbench.view.extension.keystone");
    }),
    vscode.commands.registerCommand("keystone.showLogs", () => logger?.show()),
    vscode.commands.registerCommand("keystone.index.restart", () => intelligenceRuntime.start()),
    vscode.commands.registerCommand("keystone.intelligence.overview", () => intelligenceQuery.overview()),
    vscode.commands.registerCommand("keystone.intelligence.search", (request: unknown) => intelligenceQuery.search(request as never)),
    vscode.commands.registerCommand("keystone.intelligence.entity", (id: string) => intelligenceQuery.entity(id)),
    vscode.commands.registerCommand("keystone.intelligence.neighborhood", (request: unknown) => intelligenceQuery.neighborhood(request)),
    vscode.commands.registerCommand("keystone.intelligence.technologies", (request: unknown = { limit: 50 }) => intelligenceQuery.technologies(request as never)),
    vscode.commands.registerCommand("keystone.intelligence.adapterDiagnostics", (request: unknown = { limit: 50 }) => intelligenceQuery.adapterDiagnostics(request)),
    vscode.commands.registerCommand("keystone.intelligence.cpg", (request: unknown) => cpgQuery.scope(request as never)),
    vscode.commands.registerCommand("keystone.intelligence.query", (request: unknown) => intelligenceQuery.unified(request)),
    vscode.workspace.onDidChangeConfiguration((event) => {
      if (event.affectsConfiguration("keystone")) logger?.info("configuration.changed", "Keystone configuration changed.");
    }),
    { dispose: () => intelligenceRuntime.dispose() },
    { dispose: () => { void semanticWorker.dispose(); } },
    { dispose: () => logger?.dispose() }
  );

  void intelligenceRuntime.initialize().catch((cause: unknown) => logger?.error(KeystoneError.fromUnknown(cause, "intelligence.runtime.initialize")));

  logger.info("extension.activate", "Keystone intelligence foundation activated.", {
    durationMs: Math.round(performance.now() - startedAt),
    workspaceRoots: vscode.workspace.workspaceFolders?.length ?? 0,
    trusted: vscode.workspace.isTrusted,
    intelligenceStatus: intelligenceRuntime.getState().status
  });
}

async function openSource(relativePath: string, range?: { startLine: number; startColumn: number; endLine: number; endColumn: number }): Promise<void> {
  const normalized = relativePath.replace(/\\/g, "/");
  if (!normalized || normalized.startsWith("/") || normalized.split("/").includes("..")) throw new Error("Keystone rejected an invalid source path.");
  for (const root of vscode.workspace.workspaceFolders ?? []) {
    const uri = vscode.Uri.joinPath(root.uri, ...normalized.split("/"));
    try {
      const document = await vscode.workspace.openTextDocument(uri);
      const editor = await vscode.window.showTextDocument(document, { preview: true });
      if (range) {
        const selection = new vscode.Range(range.startLine, range.startColumn, range.endLine, range.endColumn);
        editor.selection = new vscode.Selection(selection.start, selection.start);
        editor.revealRange(selection, vscode.TextEditorRevealType.InCenterIfOutsideViewport);
      }
      return;
    } catch {
      // Try the next workspace root.
    }
  }
  throw new Error(`Keystone could not open ${normalized} in the active workspace.`);
}

export function deactivate(): void {
  logger?.info("extension.deactivate", "Keystone deactivated.");
}

async function initializeFoundationState(store: WorkspaceStateStore): Promise<void> {
  try {
    await store.initialize();
  } catch (cause) {
    const error = KeystoneError.fromUnknown(cause, "extension.activate");
    logger?.error(error);
    void vscode.window.showErrorMessage(`${error.message} ${error.recommendedAction}`);
  }
}
