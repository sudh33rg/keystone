import * as vscode from "vscode";
import { rename, stat } from "node:fs/promises";
import { join } from "node:path";
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
import { FileMemento, WorkspaceStateStore } from "../core/persistence/WorkspaceStateStore";
import { DelegationPersistenceStore } from "../core/persistence/DelegationPersistenceStore";
import { ExecutionPersistenceStore } from "../core/persistence/ExecutionPersistenceStore";
import { DevelopmentWorkflowService } from "../core/workflows/DevelopmentWorkflowService";
import { ExecutionRoutingService } from "../core/workflows/ExecutionRoutingService";
import { CapabilityDrivenCopilotAdapter } from "../core/copilot/CopilotAdapter";
import { CopilotAgentRegistry } from "../core/copilot/AgentRegistry";
import { ContextCandidateCollector, TaskContextService } from "../core/context/TaskContextService";
import { DelegationService, DelegationTrackingService } from "../core/copilot/DelegationService";
import { KeystoneError } from "../shared/errors/KeystoneError";
import { KeystoneLogger } from "../shared/logging/KeystoneLogger";
import { VsCodeGitAdapter } from "./adapters/GitAdapter";
import { VsCodeLanguageServiceAdapter } from "./adapters/LanguageServiceAdapter";
import { VsCodeWorkspaceAdapter } from "./adapters/WorkspaceAdapter";
import { VsCodeRepositoryMonitor } from "./intelligence/VsCodeRepositoryMonitor";
import { KeystoneViewProvider } from "./webview/KeystoneViewProvider";
import { VsCodeCopilotEnvironment } from "./copilot/VsCodeCopilotEnvironment";
import { ConfiguredAgentLoader } from "./copilot/ConfiguredAgentLoader";
import { TaskExecutionService } from "../core/execution/TaskExecutionService";
import { ValidationOrchestrator } from "../core/validation/TaskValidationService";
import { CompletionDecisionService, WorkflowCompletionService } from "../core/execution/CompletionService";
import { DeliveryPersistenceStore } from "../core/persistence/DeliveryPersistenceStore";
import { ClipboardPullRequestProvider, DeliveryCoordinator, GitHubPullRequestProvider, PullRequestProviderRegistry } from "../core/delivery/GitDeliveryService";
import { GitExecutableDeliveryAdapter } from "./git/GitDeliveryAdapter";
import { VsCodeGitDeliveryAdapter } from "./git/VsCodeGitDeliveryAdapter";
import { TeamWorkflowPersistenceStore } from "../core/persistence/TeamWorkflowPersistenceStore";
import { TeamWorkflowService } from "../core/team/TeamWorkflowService";
import { ScopeCorrectionMigration } from "../core/persistence/ScopeCorrectionMigration";
import { canonicalJson, sha256 } from "../core/team/HandoffSecurity";
import { VsCodeTeamArtifactAdapter } from "./team/VsCodeTeamArtifactAdapter";
import { OrchestrationPersistenceStore } from "../core/persistence/OrchestrationPersistenceStore";
import { OrchestrationService } from "../core/orchestration/OrchestrationService";
import { StartupStateService } from "../core/integration/ProductIntegrationService";
import { CopilotCustomizationService } from "../core/copilot/CopilotCustomizationService";
import { BuildWorkspaceService } from "../core/workflows/BuildWorkspaceService";

let logger: KeystoneLogger | undefined;

export async function activate(context: vscode.ExtensionContext): Promise<void> {
  const startedAt = performance.now();
  const productStartup = new StartupStateService();
  const configuration = new ConfigurationService();
  const output = vscode.window.createOutputChannel("Keystone");
  logger = new KeystoneLogger(output, () => configuration.read().logging.level);
  productStartup.transition("workspace-detecting", "running", "Detecting workspace and repository scope.");
  const repositoryUri = vscode.workspace.workspaceFolders?.find((folder) => folder.uri.scheme === "file")?.uri;
  const repositoryRoot = repositoryUri?.fsPath;
  const storageRoot = repositoryRoot ? join(repositoryRoot, ".keystone") : undefined;
  const previousStorageRoot = context.storageUri?.scheme === "file" ? context.storageUri.fsPath : undefined;
  await migrateWorkspaceStorage(previousStorageRoot, storageRoot);
  const scopeMigration = await new ScopeCorrectionMigration(storageRoot).run();
  for (const diagnostic of scopeMigration.diagnostics) logger.warning("persistence.scope-correction", diagnostic);
  if (scopeMigration.archived.length) logger.info("persistence.scope-correction", "Archived obsolete future-roadmap state.", { scopes: scopeMigration.archived });
  const workspaceState = new WorkspaceStateStore(storageRoot ? await FileMemento.open(join(storageRoot, "state", "workspace.json")) : context.workspaceState);
  productStartup.transition("persistence-restoring", "running", "Restoring extension-managed product state.");
  await initializeFoundationState(workspaceState);

  const workspace = new VsCodeWorkspaceAdapter();
  const git = new VsCodeGitAdapter();
  const language = new VsCodeLanguageServiceAdapter();
  const ignorePolicy = new DefaultIgnorePolicy();
  const indexingConfiguration = workspace.getIndexingConfiguration();
  const workers = new WorkerPoolManager(indexingConfiguration.workerCount);
  const semanticWorker = new SemanticExtractionWorker();
  workers.attach(semanticWorker);
  const intelligenceStore = new IntelligenceStore(storageRoot, undefined, workers, indexingConfiguration.retainedGenerations);
  const repositoryIndex = new RepositoryIndexService(workspace, git, language, ignorePolicy, intelligenceStore, logger, workers, undefined, undefined, semanticWorker);
  const monitor = new VsCodeRepositoryMonitor(workspace, git, ignorePolicy, logger);
  const startup = new StartupReconciler(workspace, git, intelligenceStore, { [TYPESCRIPT_SEMANTIC_PARSER_ID]: TYPESCRIPT_SEMANTIC_PARSER_VERSION, [CPG_PROVIDER_ID]: CPG_PROVIDER_VERSION, ...UNIVERSAL_ADAPTER_VERSIONS });
  const intelligenceRuntime = new IntelligenceRuntime(workspace, git, intelligenceStore, repositoryIndex, workers, monitor, logger, startup);
  productStartup.transition("intelligence-checking", "running", "Checking the last complete Intelligence generation.");
  const cpgQuery = new CpgQueryService(intelligenceStore);
  const intelligenceQuery = new IntelligenceQueryService(intelligenceStore, intelligenceRuntime, cpgQuery);
  const delegationStore = new DelegationPersistenceStore(storageRoot);
  const workflow = new DevelopmentWorkflowService(delegationStore, intelligenceStore, intelligenceQuery);
  const routing = new ExecutionRoutingService();
  await workflow.initialize();
  const copilot = new CapabilityDrivenCopilotAdapter(new VsCodeCopilotEnvironment());
  const agents = new CopilotAgentRegistry(copilot, delegationStore);
  agents.restore();
  await new ConfiguredAgentLoader(workspace, agents).load();
  const taskContext = new TaskContextService(new ContextCandidateCollector(intelligenceStore, intelligenceQuery, workspace), delegationStore);
  const delegation = new DelegationService(copilot, agents, delegationStore, workflow, intelligenceStore, new DelegationTrackingService(git, workspace, intelligenceStore));
  const executionStore = new ExecutionPersistenceStore(storageRoot);
  const execution = new TaskExecutionService(executionStore, delegation, workflow, git, workspace, intelligenceStore, agents);
  await execution.initialize();
  const validation = new ValidationOrchestrator(executionStore, execution, workspace, intelligenceStore, workflow);
  const completion = new CompletionDecisionService(executionStore, execution, workflow, intelligenceStore);
  const customizations = new CopilotCustomizationService(workspace, delegationStore);
  const buildWorkspace = new BuildWorkspaceService(delegationStore, workflow, copilot, agents, customizations, taskContext, delegation, execution, validation, completion);
  const workflowCompletion = new WorkflowCompletionService(executionStore, workflow, intelligenceStore);
  const deliveryStore = new DeliveryPersistenceStore(storageRoot);
  const deliveryRepositoryRoot = repositoryRoot ?? process.cwd();
  const deliveryGit = new VsCodeGitDeliveryAdapter(new GitExecutableDeliveryAdapter(() => Boolean(vscode.extensions.getExtension("vscode.git"))));
  const githubProvider = new GitHubPullRequestProvider({
    detected: () => Promise.resolve(Boolean(vscode.extensions.getExtension("github.vscode-pull-request-github"))),
    commands: async () => vscode.commands.getCommands(true),
    openCreate: async () => {
      const commands = await vscode.commands.getCommands(true);
      if (!commands.includes("pr.create")) throw new Error("The installed GitHub provider does not expose assisted PR creation.");
      await vscode.commands.executeCommand("pr.create");
    },
  });
  const clipboardProvider = new ClipboardPullRequestProvider(async (value) => { await vscode.env.clipboard.writeText(value); });
  const delivery = new DeliveryCoordinator(deliveryRepositoryRoot, deliveryGit, deliveryStore, workflow, executionStore, intelligenceStore, new PullRequestProviderRegistry([githubProvider, clipboardProvider]));
  await delivery.initialize();
  const teamStore = new TeamWorkflowPersistenceStore(storageRoot);
  const team = new TeamWorkflowService(
    teamStore,
    workflow,
    {
      current: () => {
        const snapshot = intelligenceStore.getSnapshot();
        if (!snapshot) throw new Error("Repository intelligence is unavailable for handoff reconciliation.");
        const relevantFileFingerprints = Object.fromEntries(snapshot.files.filter((file) => file.contentHash).slice(0, 500).map((file) => [file.relativePath, file.contentHash!]));
        return {
          repositoryId: snapshot.repository.id,
          ...(snapshot.repository.branch ? { branch: snapshot.repository.branch } : {}),
          ...(snapshot.repository.headCommit ? { baseCommit: snapshot.repository.headCommit, headCommit: snapshot.repository.headCommit } : {}),
          intelligenceGeneration: snapshot.manifest.generation,
          repositoryFingerprint: sha256(canonicalJson({ repository: snapshot.repository, generation: snapshot.manifest.generation, relevantFileFingerprints })),
          relevantFileFingerprints,
        };
      },
      compare: (sender, receiver) => sender.headCommit && receiver.headCommit ? deliveryGit.compareCommits(deliveryRepositoryRoot, sender.headCommit, receiver.headCommit) : Promise.resolve("missing-commits"),
      resolveEntities: (ids) => {
        const snapshot = intelligenceStore.getSnapshot(); if (!snapshot) return ids;
        const known = new Set([...snapshot.files.map((item) => item.id), ...snapshot.symbols.map((item) => item.id)]);
        return ids.filter((id) => !known.has(id));
      },
      providerVersions: () => ({ ...(intelligenceStore.getSnapshot()?.manifest.extractorVersions ?? {}), [CPG_PROVIDER_ID]: CPG_PROVIDER_VERSION }),
    },
    (taskId) => taskContext.get(taskId),
    new VsCodeTeamArtifactAdapter(repositoryUri),
    {
      snapshot: (taskId, workflowId) => {
        const executionState = executionStore.snapshot;
        const sessions = executionState.sessions.filter((item) => item.taskId === taskId);
        const latest = sessions.at(-1);
        const runIds = [...new Set(sessions.flatMap((item) => item.validationRunIds))];
        const runs = executionState.runs.filter((item) => runIds.includes(item.id));
        const latestRun = runs.at(-1);
        const deliveryState = deliveryStore.snapshot;
        const changeSet = deliveryState.changeSets.filter((item) => item.workflowId === workflowId).at(-1);
        const commitPlan = changeSet ? deliveryState.commitPlans.filter((item) => item.changeSetId === changeSet.id).at(-1) : undefined;
        const actionResults = deliveryState.actionResults.filter((item) => item.status === "succeeded");
        return {
          ...(latest ? { execution: { sessionIds: sessions.map((item) => item.id), latestStatus: latest.status, selectedAgentId: latest.agentId, delegationMode: latest.delegationMode, ...(latest.contextFingerprint ? { contextFingerprint: latest.contextFingerprint } : {}), ...(latest.promptFingerprint ? { promptFingerprint: latest.promptFingerprint } : {}), attemptCount: Math.max(...sessions.map((item) => item.retryAttempt + 1)), transferred: true as const, continuationRequiresNewApproval: true as const, observedChangeCount: latest.observedChanges.length } } : {}),
          ...(runs.length ? { validation: { planIds: [...new Set(sessions.flatMap((item) => item.validationPlanId ? [item.validationPlanId] : []))], runIds, ...(latestRun ? { latestStatus: latestRun.status } : {}), passedSteps: runs.reduce((total, run) => total + run.stepResults.filter((item) => item.status === "passed").length, 0), failedSteps: runs.reduce((total, run) => total + run.stepResults.filter((item) => item.status === "failed").length, 0), criterionResults: latestRun?.acceptanceCriteriaResults.map((item) => ({ criterionId: item.criterionId, status: item.status, evidenceIds: item.evidenceIds })) ?? [], findingSummaries: latestRun?.findings.map((item) => `${item.severity}: ${item.title} — ${item.description}`) ?? [], overrideIds: executionState.overrides.filter((item) => runIds.includes(item.validationRunId ?? "")).map((item) => item.id), repositoryFingerprint: latestRun?.repositoryFingerprint, providerVersions: { ...(intelligenceStore.getSnapshot()?.manifest.extractorVersions ?? {}), [CPG_PROVIDER_ID]: CPG_PROVIDER_VERSION } } } : {}),
          ...(changeSet ? { delivery: { changeSetId: changeSet.id, changeSetFingerprint: changeSet.fingerprint, ...(commitPlan ? { commitPlanId: commitPlan.id } : {}), commitHashes: actionResults.flatMap((item) => item.commitHash ? [item.commitHash] : []), pushStatus: actionResults.filter((item) => item.action === "push").at(-1)?.status, pullRequestStatus: deliveryState.pullRequestResults.at(-1)?.status, pullRequestUrl: deliveryState.pullRequestResults.at(-1)?.url } } : {}),
          changedFiles: latest?.observedChanges.map((item) => ({ path: item.relativePath, kind: item.kind, classification: item.userOverride?.classification ?? item.classification, availability: "local-unavailable" as const, summary: item.reasons.join(" ").slice(0, 2000) })) ?? [],
          changedEntities: latest?.changedEntities.map((item) => ({ entityId: item.entityId, qualifiedName: item.qualifiedName, entityType: item.entityType, relativePath: item.relativePath, changeKind: item.changeKind, ...(item.afterFingerprint ? { fingerprint: item.afterFingerprint } : {}), evidenceIds: item.evidenceIds })) ?? [],
        };
      },
    },
  );
  await team.initialize();
  const orchestrationStore = new OrchestrationPersistenceStore(storageRoot);
  const orchestration = new OrchestrationService(orchestrationStore, workflow, routing);
  await orchestration.initialize();
  productStartup.transition("feature-services-ready", "ready", "Product services restored; background Intelligence repair may continue.");
  const repositoryArtifactsEnabled = vscode.workspace.getConfiguration("keystone.team").get<boolean>("repositoryArtifactsEnabled", false);
  if (team.store.snapshot.settings.repositoryArtifactsEnabled !== repositoryArtifactsEnabled) await team.store.update((state) => ({ ...state, settings: { ...state.settings, repositoryArtifactsEnabled } }));

  const packageVersion = (context.extension.packageJSON as { version?: unknown }).version;
  const extensionVersion = typeof packageVersion === "string" ? packageVersion : "0.0.0";
  const provider = new KeystoneViewProvider(
    context.extensionUri,
    extensionVersion,
    workspaceState,
    configuration,
    logger,
    { intelligenceRuntime, intelligenceQuery, cpgQuery, openSource, workflow, buildWorkspace, customizations, routing, orchestration, workspaceTrusted: () => vscode.workspace.isTrusted, copilot, agents, context: taskContext, delegation, execution, validation, completion, workflowCompletion, delivery, team, currentEditor: () => { const uri = vscode.window.activeTextEditor?.document.uri.toString(); return uri ? workspace.resolveFile(uri)?.relativePath : undefined; }, currentSelection: () => { const editor = vscode.window.activeTextEditor; if (!editor || editor.selection.isEmpty) return undefined; const resolved = workspace.resolveFile(editor.document.uri.toString()); return resolved ? { relativePath: resolved.relativePath, startLine: editor.selection.start.line, endLine: editor.selection.end.line } : undefined; } }
  );

  context.subscriptions.push(
    vscode.window.registerWebviewPanelSerializer(KeystoneViewProvider.viewType, {
      deserializeWebviewPanel: (panel) => provider.restore(panel)
    }),
    vscode.commands.registerCommand("keystone.open", async () => {
      await provider.show();
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
      if (event.affectsConfiguration("keystone")) logger?.info("configuration.changed", "Keystone configuration changed. Refresh agent discovery to apply profile changes.");
    }),
    { dispose: () => intelligenceRuntime.dispose() },
    provider,
    { dispose: () => { void semanticWorker.dispose(); } },
    { dispose: () => logger?.dispose() }
  );
  productStartup.transition("ready", "ready", "Keystone is ready.");
  logger.info("activation.startup-state", productStartup.snapshot.message, productStartup.snapshot);

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

async function migrateWorkspaceStorage(previousRoot: string | undefined, repositoryStorageRoot: string | undefined): Promise<void> {
  if (!previousRoot || !repositoryStorageRoot || previousRoot === repositoryStorageRoot) return;
  try {
    await stat(repositoryStorageRoot);
    return;
  } catch (cause) {
    if (!(cause instanceof Error && "code" in cause && cause.code === "ENOENT")) return;
  }
  try {
    await stat(previousRoot);
    await rename(previousRoot, repositoryStorageRoot);
  } catch (cause) {
    if (!(cause instanceof Error && "code" in cause && cause.code === "ENOENT")) {
      logger?.warning("persistence.repository-migration", "Existing VS Code workspace storage could not be moved to .keystone; Keystone will create repository-local state.", cause);
    }
  }
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
