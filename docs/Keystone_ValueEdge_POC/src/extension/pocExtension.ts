import * as vscode from "vscode";
import { join } from "node:path";
import { ConfigurationService } from "../core/configuration/ConfigurationService";
import { DefaultIgnorePolicy } from "../core/intelligence/IgnorePolicy";
import { IntelligenceQueryService } from "../core/intelligence/IntelligenceQueryService";
import { RepositoryIndexService } from "../core/intelligence/RepositoryIndexService";
import { TreeSitterExtractionAdapter } from "../core/intelligence/extraction/TreeSitterExtractionAdapter";
import { TechnologyDetectionService } from "../core/intelligence/technology/TechnologyDetectionService";
import { SchemaSurfaceExtractor } from "../core/intelligence/schema/SchemaSurfaceExtractor";
import { IntelligenceRuntime } from "../core/intelligence/runtime/IntelligenceRuntime";
import { WorkerPoolManager } from "../core/intelligence/runtime/WorkerPoolManager";
import { SemanticExtractionWorker } from "../core/intelligence/semantic/SemanticExtractionWorker";
import { TYPESCRIPT_SEMANTIC_PARSER_ID, TYPESCRIPT_SEMANTIC_PARSER_VERSION } from "../core/intelligence/semantic/SemanticVersion";
import { StartupReconciler } from "../core/intelligence/runtime/StartupReconciler";
import { CpgQueryService } from "../core/intelligence/cpg/CpgQueryService";
import { CPG_PROVIDER_ID, CPG_PROVIDER_VERSION } from "../shared/contracts/cpg";
import { UNIVERSAL_ADAPTER_VERSIONS } from "../core/intelligence/adapters/AdapterVersions";
import { IntelligenceStore } from "../core/persistence/IntelligenceStore";
import { KeystoneLogger } from "../shared/logging/KeystoneLogger";
import { VsCodeGitAdapter } from "./adapters/GitAdapter";
import { VsCodeLanguageServiceAdapter } from "./adapters/LanguageServiceAdapter";
import { VsCodeWorkspaceAdapter } from "./adapters/WorkspaceAdapter";
import { VsCodeRepositoryMonitor } from "./intelligence/VsCodeRepositoryMonitor";
import { ValueEdgePoc } from "../poc/ValueEdgePoc";
import { PocViewProvider } from "./PocViewProvider";

let logger: KeystoneLogger | undefined;

/** POC runtime: local Repository Intelligence + ValueEdge story generation only. */
export async function activate(context: vscode.ExtensionContext): Promise<void> {
  const configuration = new ConfigurationService();
  const output = vscode.window.createOutputChannel("Keystone ValueEdge POC");
  logger = new KeystoneLogger(output, () => configuration.read().logging.level);
  context.subscriptions.push(output);

  const repositoryUri = vscode.workspace.workspaceFolders?.find((folder) => folder.uri.scheme === "file")?.uri;
  if (!repositoryUri) {
    const viewProvider = new PocViewProvider(context.extensionUri);
    context.subscriptions.push(
      viewProvider,
      vscode.window.registerWebviewViewProvider(PocViewProvider.viewType, viewProvider, {
        webviewOptions: { retainContextWhenHidden: false },
      }),
    );
    logger.info("poc.activate", "POC view registered. Open a local repository to enable intelligence and story generation.");
    return;
  }

  const storageRoot = join(repositoryUri.fsPath, ".keystone-poc");
  const workspace = new VsCodeWorkspaceAdapter();
  const git = new VsCodeGitAdapter();
  const language = new VsCodeLanguageServiceAdapter();
  const ignorePolicy = new DefaultIgnorePolicy();
  const indexingConfiguration = workspace.getIndexingConfiguration();
  const workers = new WorkerPoolManager(indexingConfiguration.workerCount);
  const semanticWorker = new SemanticExtractionWorker();
  workers.attach(semanticWorker);
  const intelligenceStore = new IntelligenceStore(storageRoot, undefined, workers, indexingConfiguration.retainedGenerations);

  const repositoryIndex = new RepositoryIndexService(
    workspace, git, language, ignorePolicy, intelligenceStore, logger, workers,
    undefined, undefined, semanticWorker, undefined, undefined,
    new TreeSitterExtractionAdapter(), new TechnologyDetectionService(), new SchemaSurfaceExtractor(),
  );
  const monitor = new VsCodeRepositoryMonitor(workspace, git, ignorePolicy, logger);
  const startup = new StartupReconciler(workspace, git, intelligenceStore, {
    [TYPESCRIPT_SEMANTIC_PARSER_ID]: TYPESCRIPT_SEMANTIC_PARSER_VERSION,
    [CPG_PROVIDER_ID]: CPG_PROVIDER_VERSION,
    ...UNIVERSAL_ADAPTER_VERSIONS,
  });
  const intelligenceRuntime = new IntelligenceRuntime(workspace, git, intelligenceStore, repositoryIndex, workers, monitor, logger, startup);
  const intelligenceQuery = new IntelligenceQueryService(intelligenceStore, intelligenceRuntime, new CpgQueryService(intelligenceStore));
  const poc = new ValueEdgePoc(intelligenceQuery);
  const viewProvider = new PocViewProvider(context.extensionUri, poc, () => intelligenceRuntime.start());

  context.subscriptions.push(
    viewProvider,
    vscode.window.registerWebviewViewProvider(PocViewProvider.viewType, viewProvider, {
      webviewOptions: { retainContextWhenHidden: false },
    }),
    { dispose: () => intelligenceRuntime.dispose() },
  );

  logger.info("poc.activate", "POC activated: one Activity Bar view, Repository Intelligence + ValueEdge story generation only.");
  intelligenceRuntime.start();
}

export function deactivate(): void {
  logger = undefined;
}
