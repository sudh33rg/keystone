import * as vscode from "vscode";
import { ConfigurationService } from "../core/configuration/ConfigurationService";
import { WorkspaceStateStore } from "../core/persistence/WorkspaceStateStore";
import { KeystoneError } from "../shared/errors/KeystoneError";
import { KeystoneLogger } from "../shared/logging/KeystoneLogger";
import { KeystoneViewProvider } from "./webview/KeystoneViewProvider";
import { VsCodeCopilotAdapter } from "../core/copilot/CopilotAdapter";
import { AgentRegistry } from "../core/copilot/AgentRegistry";
import { IgnorePolicy } from "../core/intelligence/IgnorePolicy";
import { RepositoryIndexService } from "../core/intelligence/RepositoryIndexService";
import { WorkspaceAdapter } from "./adapters/WorkspaceAdapter";
import { GitAdapter } from "./adapters/GitAdapter";
import { LanguageServiceAdapter } from "./adapters/LanguageServiceAdapter";
import { ContextEngine } from "../core/context/ContextEngine";
import { TaskGraphService } from "../core/tasks/TaskGraphService";
import { WorkflowOrchestrator } from "../core/workflows/WorkflowOrchestrator";
import { ValidationEngine } from "../core/validation/ValidationEngine";
import { DelegationService } from "../core/copilot/DelegationService";
import { ContextCompressionEngine } from "../core/context/ContextCompressionEngine";
import { ContextPreviewService } from "../core/context/ContextPreview";
import { ExternalChangeDetector } from "../core/tasks/ExternalChangeDetector";
import { IntentEngine } from "../core/intent/IntentEngine";
import { SpecificationService } from "../core/specifications/SpecificationService";

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

  // Initialize adapters
  const workspaceAdapter = new WorkspaceAdapter();
  const gitAdapter = new GitAdapter();
  const languageServiceAdapter = new LanguageServiceAdapter();
  const ignorePolicy = new IgnorePolicy();

  // Initialize core services
  const repositoryIndex = new RepositoryIndexService(
    workspaceAdapter,
    gitAdapter,
    languageServiceAdapter,
    ignorePolicy,
    store,
    logger!
  );

  const copilotAdapter = new VsCodeCopilotAdapter();
  const agentRegistry = new AgentRegistry(copilotAdapter, configuration);
  const contextEngine = new ContextEngine(workspaceAdapter, repositoryIndex, agentRegistry, ignorePolicy);
  const taskGraphService = new TaskGraphService(store);
  const workflowOrchestrator = new WorkflowOrchestrator(store, taskGraphService);
  const validationEngine = new ValidationEngine(workspaceAdapter, gitAdapter);
  const delegationService = new DelegationService(copilotAdapter, agentRegistry, contextEngine);
  const compressionEngine = new ContextCompressionEngine(12000);
  const contextPreview = new ContextPreviewService(compressionEngine);
  const externalChangeDetector = new ExternalChangeDetector(gitAdapter, workspaceAdapter);
  const intentEngine = new IntentEngine();
  const specificationService = new SpecificationService(store);

  const packageVersion = (context.extension.packageJSON as { version?: unknown }).version;
  const extensionVersion = typeof packageVersion === "string" ? packageVersion : "0.0.0";
  const provider = new KeystoneViewProvider(
    context.extensionUri,
    extensionVersion,
    store,
    configuration,
    logger!,
    // Pass service references for message routing
    {
      repositoryIndex,
      agentRegistry,
      contextEngine,
      taskGraphService,
      workflowOrchestrator,
      validationEngine,
      delegationService,
      contextPreview,
      externalChangeDetector,
      intentEngine,
      specificationService
    }
  );

  context.subscriptions.push(
    vscode.window.registerWebviewViewProvider(KeystoneViewProvider.viewType, provider, {
      webviewOptions: { retainContextWhenHidden: false }
    }),
    vscode.commands.registerCommand("keystone.open", async () => {
      await vscode.commands.executeCommand("workbench.view.extension.keystone");
    }),
    vscode.commands.registerCommand("keystone.showLogs", () => logger?.show()),
    vscode.commands.registerCommand("keystone.index.restart", async () => {
      const branch = await gitAdapter.getCurrentBranch();
      if (branch) {
        await repositoryIndex.start(branch, {
          onProgress: (stage) => logger?.info("index.progress", `Indexing: ${stage}`),
          onComplete: (index) => logger?.info("index.complete", "Repository indexing complete.", { version: index.indexVersion }),
          onError: (error) => logger?.error("index.error", "Repository indexing failed.", { error })
        });
      }
    }),
    vscode.commands.registerCommand("keystone.spec.create", async () => {
      const title = await vscode.window.showInputBox({ prompt: "Specification title" });
      if (title) {
        const spec = specificationService.create("intent-1", title, "workflow-1");
        logger?.info("spec.create", "Specification created.", { id: spec.id });
      }
    }),
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
