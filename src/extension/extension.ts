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
import {
  TYPESCRIPT_SEMANTIC_PARSER_ID,
  TYPESCRIPT_SEMANTIC_PARSER_VERSION,
} from "../core/intelligence/semantic/SemanticVersion";
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
import { TaskContextService } from "../core/context/TaskContextService";
import { ContextPackageService } from "../core/context/ContextPackageService";
import { ContextPersistenceStore } from "../core/context/ContextPersistenceStore";
import { DelegationService, DelegationTrackingService } from "../core/copilot/DelegationService";
import { KeystoneError } from "../shared/errors/KeystoneError";
import { KeystoneLogger } from "../shared/logging/KeystoneLogger";
import { VsCodeGitAdapter } from "./adapters/GitAdapter";
import { VsCodeLanguageServiceAdapter } from "./adapters/LanguageServiceAdapter";
import { VsCodeWorkspaceAdapter } from "./adapters/WorkspaceAdapter";
import { VsCodeRepositoryMonitor } from "./intelligence/VsCodeRepositoryMonitor";
import { VsCodeCopilotEnvironment } from "./copilot/VsCodeCopilotEnvironment";
import { ConfiguredAgentLoader } from "./copilot/ConfiguredAgentLoader";
import { TaskExecutionService } from "../core/execution/TaskExecutionService";
import { ValidationOrchestrator } from "../core/validation/TaskValidationService";
import {
  CompletionDecisionService,
  WorkflowCompletionService,
} from "../core/execution/CompletionService";
import { DeliveryPersistenceStore } from "../core/persistence/DeliveryPersistenceStore";
import {
  ClipboardPullRequestProvider,
  DeliveryCoordinator,
  GitHubPullRequestProvider,
  PullRequestProviderRegistry,
} from "../core/delivery/GitDeliveryService";
import { WorkflowFreshnessService } from "../core/freshness/WorkflowFreshnessService";
import { WorkflowRerunPlanner } from "../core/rerun/WorkflowRerunPlanner";
import { ActivityService } from "../core/activity/ActivityService";
import { ApprovalService } from "../core/approval/ApprovalService";
import { BlockerService } from "../core/blocker/BlockerService";
import { PersistenceConsistencyService } from "../core/persistence/PersistenceConsistencyService";
import { SupportBundleService } from "../core/support/SupportBundleService";
import { ResourceLimitService } from "../core/resource/ResourceLimitService";
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
import { ReviewPersistenceStore } from "../core/persistence/ReviewPersistenceStore";
import { ReviewCompletionService } from "../core/review/ReviewCompletionService";
import { CopilotIntegrationPersistenceStore } from "../core/persistence/CopilotIntegrationPersistenceStore";
import {
  CopilotCapabilityService,
  CopilotToolAuditService,
  CopilotToolExecutionService,
  CopilotToolRegistry,
} from "../core/copilot/CopilotIntegrationService";
import {
  CopilotAssistedLaunchService,
  KeystoneChatParticipantService,
} from "../core/copilot/KeystoneChatAndLaunchService";
import { VsCodeCopilotIntegration } from "./copilot/VsCodeCopilotIntegration";
import { GraphIndexerWorker } from "../workers/GraphIndexerWorker";
import { GitHistoryParser } from "../workers/GitHistoryParser";
import { SafetyCheckService } from "../core/intelligence/safety/SafetyCheckService";
import { NativeShellPersistenceStore } from "../core/persistence/NativeShellPersistenceStore";
import { CopilotToggleService } from "../core/intelligence/markdown/CopilotToggleService";
import {
  KeystoneDashboardRefreshService,
  KeystoneDashboardViewModelService,
  KeystoneLaunchValidationService,
  KeystoneNavigationService,
  KeystonePanelStateService,
  type NativeShellStateSource,
} from "../core/integration/NativeShellServices";
import { KeystonePanelService } from "./webview/KeystonePanelService";
import { KeystoneIntelligencePanel } from "./webview/KeystoneIntelligencePanel";
import {
  KeystoneCodeLensProvider,
  KeystoneCommandService,
  KeystoneContextKeyService,
  KeystoneDashboardProvider,
  KeystoneExplorerProvider,
  KeystoneNotificationService,
  KeystoneStatusBarService,
} from "./dashboard/KeystoneDashboard";
import { KeystoneInitializationSchema } from "../shared/contracts/nativeShell";
import type { IntelligenceServiceRegistry } from "./webview/WebviewMessageRouter";
import { AppRouteSchema } from "../shared/contracts/domain";
import { HealthCheckService } from "../core/health/HealthCheckService";

let logger: KeystoneLogger | undefined;

export async function activate(context: vscode.ExtensionContext): Promise<void> {
  const startedAt = performance.now();
  const productStartup = new StartupStateService();
  const configuration = new ConfigurationService();
  const output = vscode.window.createOutputChannel("Keystone");
  logger = new KeystoneLogger(output, () => configuration.read().logging.level);
  productStartup.transition(
    "workspace-detecting",
    "running",
    "Detecting workspace and repository scope.",
  );
  const repositoryUri = vscode.workspace.workspaceFolders?.find(
    (folder) => folder.uri.scheme === "file",
  )?.uri;
  const repositoryRoot = repositoryUri?.fsPath;
  const storageRoot = repositoryRoot ? join(repositoryRoot, ".keystone") : undefined;
  const previousStorageRoot =
    context.storageUri?.scheme === "file" ? context.storageUri.fsPath : undefined;
  await migrateWorkspaceStorage(previousStorageRoot, storageRoot);
  const scopeMigration = await new ScopeCorrectionMigration(storageRoot).run();
  for (const diagnostic of scopeMigration.diagnostics)
    logger.warning("persistence.scope-correction", diagnostic);
  if (scopeMigration.archived.length)
    logger.info("persistence.scope-correction", "Archived obsolete future-roadmap state.", {
      scopes: scopeMigration.archived,
    });
  const workspaceState = new WorkspaceStateStore(
    storageRoot
      ? await FileMemento.open(join(storageRoot, "state", "workspace.json"))
      : context.workspaceState,
  );
  productStartup.transition(
    "persistence-restoring",
    "running",
    "Restoring extension-managed product state.",
  );
  await initializeFoundationState(workspaceState);

  const workspace = new VsCodeWorkspaceAdapter();
  const git = new VsCodeGitAdapter();
  const language = new VsCodeLanguageServiceAdapter();
  const ignorePolicy = new DefaultIgnorePolicy();
  const indexingConfiguration = workspace.getIndexingConfiguration();
  const workers = new WorkerPoolManager(indexingConfiguration.workerCount);
  const semanticWorker = new SemanticExtractionWorker();
  workers.attach(semanticWorker);
  const intelligenceStore = new IntelligenceStore(
    storageRoot,
    undefined,
    workers,
    indexingConfiguration.retainedGenerations,
  );
  const repositoryIndex = new RepositoryIndexService(
    workspace,
    git,
    language,
    ignorePolicy,
    intelligenceStore,
    logger,
    workers,
    undefined,
    undefined,
    semanticWorker,
  );
  const monitor = new VsCodeRepositoryMonitor(workspace, git, ignorePolicy, logger);
  const startup = new StartupReconciler(workspace, git, intelligenceStore, {
    [TYPESCRIPT_SEMANTIC_PARSER_ID]: TYPESCRIPT_SEMANTIC_PARSER_VERSION,
    [CPG_PROVIDER_ID]: CPG_PROVIDER_VERSION,
    ...UNIVERSAL_ADAPTER_VERSIONS,
  });
  const intelligenceRuntime = new IntelligenceRuntime(
    workspace,
    git,
    intelligenceStore,
    repositoryIndex,
    workers,
    monitor,
    logger,
    startup,
  );
  productStartup.transition(
    "intelligence-checking",
    "running",
    "Checking the last complete Intelligence generation.",
  );
  const cpgQuery = new CpgQueryService(intelligenceStore);
  const intelligenceQuery = new IntelligenceQueryService(
    intelligenceStore,
    intelligenceRuntime,
    cpgQuery,
  );
  const delegationStore = new DelegationPersistenceStore(storageRoot);
  const copilotIntegrationStore = new CopilotIntegrationPersistenceStore(storageRoot);
  await copilotIntegrationStore.initialize();
  const workflow = new DevelopmentWorkflowService(
    delegationStore,
    intelligenceStore,
    intelligenceQuery,
  );
  const routing = new ExecutionRoutingService();
  await workflow.initialize();
  const copilot = new CapabilityDrivenCopilotAdapter(new VsCodeCopilotEnvironment());
  const agents = new CopilotAgentRegistry(copilot, delegationStore);
  agents.restore();
  await new ConfiguredAgentLoader(workspace, agents).load();
  const taskContext = new TaskContextService(
    null,
    delegationStore,
    new ContextPersistenceStore(storageRoot),
  );
  taskContext.useEngine(
    new ContextPackageService(
      intelligenceStore,
      intelligenceQuery,
      workspace,
      new ContextPersistenceStore(storageRoot),
    ),
  );
  const delegation = new DelegationService(
    copilot,
    agents,
    delegationStore,
    workflow,
    intelligenceStore,
    new DelegationTrackingService(git, workspace, intelligenceStore),
  );
  const executionStore = new ExecutionPersistenceStore(storageRoot);
  const execution = new TaskExecutionService(
    executionStore,
    delegation,
    workflow,
    git,
    workspace,
    intelligenceStore,
    agents,
  );
  await execution.initialize();
  const validation = new ValidationOrchestrator(
    executionStore,
    execution,
    workspace,
    intelligenceStore,
    workflow,
  );
  const completion = new CompletionDecisionService(
    executionStore,
    execution,
    workflow,
    intelligenceStore,
  );
  const customizations = new CopilotCustomizationService(
    workspace,
    delegationStore,
    copilotIntegrationStore,
  );
  const buildWorkspace = new BuildWorkspaceService(
    delegationStore,
    workflow,
    copilot,
    agents,
    customizations,
    taskContext,
    delegation,
    execution,
    validation,
    completion,
  );
  const workflowCompletion = new WorkflowCompletionService(
    executionStore,
    workflow,
    intelligenceStore,
  );
  const deliveryStore = new DeliveryPersistenceStore(storageRoot);
  const deliveryRepositoryRoot = repositoryRoot ?? process.cwd();
  const deliveryGit = new VsCodeGitDeliveryAdapter(
    new GitExecutableDeliveryAdapter(() => Boolean(vscode.extensions.getExtension("vscode.git"))),
  );
  const githubProvider = new GitHubPullRequestProvider({
    detected: () =>
      Promise.resolve(Boolean(vscode.extensions.getExtension("github.vscode-pull-request-github"))),
    commands: async () => vscode.commands.getCommands(true),
    openCreate: async () => {
      const commands = await vscode.commands.getCommands(true);
      if (!commands.includes("pr.create"))
        throw new Error("The installed GitHub provider does not expose assisted PR creation.");
      await vscode.commands.executeCommand("pr.create");
    },
  });
  const clipboardProvider = new ClipboardPullRequestProvider(async (value) => {
    await vscode.env.clipboard.writeText(value);
  });
  const delivery = new DeliveryCoordinator(
    deliveryRepositoryRoot,
    deliveryGit,
    deliveryStore,
    workflow,
    executionStore,
    intelligenceStore,
    new PullRequestProviderRegistry([githubProvider, clipboardProvider]),
  );
  await delivery.initialize();

  // Initialize HealthCheckService with standard health checks
  const healthCheck = new HealthCheckService();
  healthCheck.register(HealthCheckService.createIntelligenceCheck(intelligenceRuntime));
  healthCheck.register(HealthCheckService.createGitCheck(git));
  healthCheck.register(HealthCheckService.createWorkspaceCheck(workspace));
  healthCheck.register(HealthCheckService.createPersistenceCheck(intelligenceStore));
  healthCheck.register(HealthCheckService.createCopilotCheck(copilotIntegrationStore));
  healthCheck.register(HealthCheckService.createWorkflowCheck(workflow));
  healthCheck.register(HealthCheckService.createDeliveryCheck(delivery));

  const reviewStore = new ReviewPersistenceStore(storageRoot);
  const review = new ReviewCompletionService(reviewStore, workflow, executionStore, delivery);
  await review.initialize();
  workflow.setReviewStateProvider((workflowId) => {
    const state = review.getState(workflowId);
    return {
      status: state.summary.status,
      completionReady: state.summary.completionReady,
      blockers: state.readinessBlockers,
      completed: review.persisted.completions.some((item) => item.workflowId === workflowId),
    };
  });
  const teamStore = new TeamWorkflowPersistenceStore(storageRoot);
  const team = new TeamWorkflowService(
    teamStore,
    workflow,
    {
      current: () => {
        const snapshot = intelligenceStore.getSnapshot();
        if (!snapshot)
          throw new Error("Repository intelligence is unavailable for handoff reconciliation.");
        const relevantFileFingerprints = Object.fromEntries(
          snapshot.files
            .filter((file) => file.contentHash)
            .slice(0, 500)
            .map((file) => [file.relativePath, file.contentHash!]),
        );
        return {
          repositoryId: snapshot.repository.id,
          ...(snapshot.repository.branch ? { branch: snapshot.repository.branch } : {}),
          ...(snapshot.repository.headCommit
            ? {
                baseCommit: snapshot.repository.headCommit,
                headCommit: snapshot.repository.headCommit,
              }
            : {}),
          intelligenceGeneration: snapshot.manifest.generation,
          repositoryFingerprint: sha256(
            canonicalJson({
              repository: snapshot.repository,
              generation: snapshot.manifest.generation,
              relevantFileFingerprints,
            }),
          ),
          relevantFileFingerprints,
        };
      },
      compare: (sender, receiver) =>
        sender.headCommit && receiver.headCommit
          ? deliveryGit.compareCommits(
              deliveryRepositoryRoot,
              sender.headCommit,
              receiver.headCommit,
            )
          : Promise.resolve("missing-commits"),
      resolveEntities: (ids) => {
        const snapshot = intelligenceStore.getSnapshot();
        if (!snapshot) return ids;
        const known = new Set([
          ...snapshot.files.map((item) => item.id),
          ...snapshot.symbols.map((item) => item.id),
        ]);
        return ids.filter((id) => !known.has(id));
      },
      providerVersions: () => ({
        ...(intelligenceStore.getSnapshot()?.manifest.extractorVersions ?? {}),
        [CPG_PROVIDER_ID]: CPG_PROVIDER_VERSION,
      }),
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
        const changeSet = deliveryState.changeSets
          .filter((item) => item.workflowId === workflowId)
          .at(-1);
        const commitPlan = changeSet
          ? deliveryState.commitPlans.filter((item) => item.changeSetId === changeSet.id).at(-1)
          : undefined;
        const actionResults = deliveryState.actionResults.filter(
          (item) => item.status === "succeeded",
        );
        return {
          ...(latest
            ? {
                execution: {
                  sessionIds: sessions.map((item) => item.id),
                  latestStatus: latest.status,
                  selectedAgentId: latest.agentId,
                  delegationMode: latest.delegationMode,
                  ...(latest.contextFingerprint
                    ? { contextFingerprint: latest.contextFingerprint }
                    : {}),
                  ...(latest.promptFingerprint
                    ? { promptFingerprint: latest.promptFingerprint }
                    : {}),
                  attemptCount: Math.max(...sessions.map((item) => item.retryAttempt + 1)),
                  transferred: true as const,
                  continuationRequiresNewApproval: true as const,
                  observedChangeCount: latest.observedChanges.length,
                },
              }
            : {}),
          ...(runs.length
            ? {
                validation: {
                  planIds: [
                    ...new Set(
                      sessions.flatMap((item) =>
                        item.validationPlanId ? [item.validationPlanId] : [],
                      ),
                    ),
                  ],
                  runIds,
                  ...(latestRun ? { latestStatus: latestRun.status } : {}),
                  passedSteps: runs.reduce(
                    (total, run) =>
                      total + run.stepResults.filter((item) => item.status === "passed").length,
                    0,
                  ),
                  failedSteps: runs.reduce(
                    (total, run) =>
                      total + run.stepResults.filter((item) => item.status === "failed").length,
                    0,
                  ),
                  criterionResults:
                    latestRun?.acceptanceCriteriaResults.map((item) => ({
                      criterionId: item.criterionId,
                      status: item.status,
                      evidenceIds: item.evidenceIds,
                    })) ?? [],
                  findingSummaries:
                    latestRun?.findings.map(
                      (item) => `${item.severity}: ${item.title} — ${item.description}`,
                    ) ?? [],
                  overrideIds: executionState.overrides
                    .filter((item) => runIds.includes(item.validationRunId ?? ""))
                    .map((item) => item.id),
                  repositoryFingerprint: latestRun?.repositoryFingerprint,
                  providerVersions: {
                    ...(intelligenceStore.getSnapshot()?.manifest.extractorVersions ?? {}),
                    [CPG_PROVIDER_ID]: CPG_PROVIDER_VERSION,
                  },
                },
              }
            : {}),
          ...(changeSet
            ? {
                delivery: {
                  changeSetId: changeSet.id,
                  changeSetFingerprint: changeSet.fingerprint,
                  ...(commitPlan ? { commitPlanId: commitPlan.id } : {}),
                  commitHashes: actionResults.flatMap((item) =>
                    item.commitHash ? [item.commitHash] : [],
                  ),
                  pushStatus: actionResults.filter((item) => item.action === "push").at(-1)?.status,
                  pullRequestStatus: deliveryState.pullRequestResults.at(-1)?.status,
                  pullRequestUrl: deliveryState.pullRequestResults.at(-1)?.url,
                },
              }
            : {}),
          changedFiles:
            latest?.observedChanges.map((item) => ({
              path: item.relativePath,
              kind: item.kind,
              classification: item.userOverride?.classification ?? item.classification,
              availability: "local-unavailable" as const,
              summary: item.reasons.join(" ").slice(0, 2000),
            })) ?? [],
          changedEntities:
            latest?.changedEntities.map((item) => ({
              entityId: item.entityId,
              qualifiedName: item.qualifiedName,
              entityType: item.entityType,
              relativePath: item.relativePath,
              changeKind: item.changeKind,
              ...(item.afterFingerprint ? { fingerprint: item.afterFingerprint } : {}),
              evidenceIds: item.evidenceIds,
            })) ?? [],
        };
      },
    },
  );
  await team.initialize();
  const orchestrationStore = new OrchestrationPersistenceStore(storageRoot);
  const orchestration = new OrchestrationService(orchestrationStore, workflow, routing);
  await orchestration.initialize();
  const toolRegistry = new CopilotToolRegistry(
    () =>
      copilotIntegrationStore.snapshot.settings.toolsEnabled &&
      typeof vscode.lm?.registerTool === "function",
  );
  const toolAudit = new CopilotToolAuditService(copilotIntegrationStore);
  const toolExecution = new CopilotToolExecutionService(
    intelligenceQuery,
    intelligenceStore,
    workflow,
    taskContext,
    executionStore,
    toolAudit,
    () => vscode.workspace.isTrusted,
  );
  const chatParticipant = new KeystoneChatParticipantService(
    toolExecution,
    () => intelligenceStore.getSnapshot()?.repository.id,
  );
  const assistedLaunch = new CopilotAssistedLaunchService(
    copilotIntegrationStore,
    workflow,
    taskContext,
    copilot,
  );
  await assistedLaunch.recover(() => undefined);
  const vscodeCopilotIntegration = new VsCodeCopilotIntegration(
    toolRegistry,
    toolExecution,
    chatParticipant,
    () => ({
      tools: copilotIntegrationStore.snapshot.settings.toolsEnabled,
      participant: copilotIntegrationStore.snapshot.settings.participantEnabled,
    }),
  );
  const integrationCapabilities = new CopilotCapabilityService(
    () => {
      const base = copilot.getCapabilities();
      const surface = vscodeCopilotIntegration.runtimeSurface();
      return {
        chat: base?.chatAvailable ?? false,
        tools: surface.tools,
        participant: surface.participant,
        direct: base?.directInvocationAvailable ?? false,
        assisted: base?.chatAvailable ?? false,
        clipboard: true,
      };
    },
    () => workspace.getRoots().length > 0,
    copilotIntegrationStore,
  );
  await integrationCapabilities.refresh();
  productStartup.transition(
    "feature-services-ready",
    "ready",
    "Product services restored; background Intelligence repair may continue.",
  );
  const repositoryArtifactsEnabled = vscode.workspace
    .getConfiguration("keystone.team")
    .get<boolean>("repositoryArtifactsEnabled", false);
  if (team.store.snapshot.settings.repositoryArtifactsEnabled !== repositoryArtifactsEnabled)
    await team.store.update((state) => ({
      ...state,
      settings: { ...state.settings, repositoryArtifactsEnabled },
    }));

  const packageVersion = (context.extension.packageJSON as { version?: unknown }).version;
  const extensionVersion = typeof packageVersion === "string" ? packageVersion : "0.0.0";
  const nativeStore = new NativeShellPersistenceStore(storageRoot);
  await nativeStore.initialize();
  const nativeSource: NativeShellStateSource = {
    workspace: () => ({
      available: workspace.getRoots().length > 0,
      name: workspace.getRoots()[0]?.name ?? "No workspace",
      trusted: vscode.workspace.isTrusted,
      roots: workspace.getRoots().map((root) => ({ id: root.uri, name: root.name })),
    }),
    intelligence: () => {
      const state = intelligenceRuntime.getState();
      return {
        status: state.status,
        pendingUpdate: state.pendingUpdate,
        health: state.health,
        ...(state.error ? { error: state.error.message } : {}),
      };
    },
    snapshot: () => intelligenceStore.getSnapshot(),
    workflows: () => workflow.list(),
    review: (workflowId) => {
      try {
        return review.getState(workflowId);
      } catch {
        return undefined;
      }
    },
    validation: (workflowId) => {
      const sessions = executionStore.snapshot.sessions.filter(
        (entry) => entry.workflowId === workflowId,
      );
      const runIds = new Set(sessions.flatMap((entry) => entry.validationRunIds));
      const runs = executionStore.snapshot.runs.filter((entry) => runIds.has(entry.id));
      return {
        passed: runs.filter((entry) => entry.status === "passed").length,
        failed: runs.filter((entry) => entry.status === "failed").length,
      };
    },
    copilot: () => copilotIntegrationStore.snapshot.lastCapabilities,
    handoffAttention: () =>
      team.store.snapshot.imports.filter((entry) =>
        ["reviewable", "read-only", "failed", "interrupted"].includes(entry.status),
      ).length,
    persistenceWarnings: () => scopeMigration.diagnostics,
  };
  const panelState = new KeystonePanelStateService(nativeStore);
  const launchValidation = new KeystoneLaunchValidationService(nativeSource);
  const dashboardViewModels = new KeystoneDashboardViewModelService(nativeSource);
  const serviceRegistry: IntelligenceServiceRegistry = {
    healthCheck,
    intelligenceRuntime,
    intelligenceQuery,
    cpgQuery,
    openSource,
    workflow,
    buildWorkspace,
    customizations,
    routing,
    orchestration,
    workspaceTrusted: () => vscode.workspace.isTrusted,
    copilot,
    agents,
    context: taskContext,
    delegation,
    execution,
    validation,
    completion,
    workflowCompletion,
    delivery,
    review,
    team,
    integrationCapabilities,
    copilotIntegrationStore,
    toolRegistry,
    toolExecution,
    toolAudit,
    assistedLaunch,
    currentEditor: () => {
      const uri = vscode.window.activeTextEditor?.document.uri.toString();
      return uri ? workspace.resolveFile(uri)?.relativePath : undefined;
    },
    currentSelection: () => {
      const editor = vscode.window.activeTextEditor;
      if (!editor || editor.selection.isEmpty) return undefined;
      const resolved = workspace.resolveFile(editor.document.uri.toString());
      return resolved
        ? {
            relativePath: resolved.relativePath,
            startLine: editor.selection.start.line,
            endLine: editor.selection.end.line,
          }
        : undefined;
    },
  };
  const provider = new KeystonePanelService(
    context.extensionUri,
    extensionVersion,
    workspaceState,
    configuration,
    logger,
    serviceRegistry,
    panelState,
    launchValidation,
    (pendingNavigation) => {
      const workflows = workflow.list();
      const active = workflows.filter((entry) => !["cancelled"].includes(entry.status)).at(-1);
      const task = active?.tasks.find((entry) =>
        [
          "ready",
          "delegating",
          "awaiting-external-start",
          "executing",
          "blocked",
          "stale",
        ].includes(entry.status),
      );
      const snapshot = intelligenceStore.getSnapshot();
      const capabilities = copilotIntegrationStore.snapshot.lastCapabilities;
      const restored = panelState.snapshot;
      return KeystoneInitializationSchema.parse({
        schemaVersion: 1,
        extensionVersion,
        workspace: {
          available: workspace.getRoots().length > 0,
          name: workspace.getRoots()[0]?.name ?? "No workspace",
          trusted: vscode.workspace.isTrusted,
        },
        ...(snapshot
          ? {
              repository: {
                id: snapshot.repository.id,
                name: snapshot.repository.displayName,
                ...(snapshot.repository.branch ? { branch: snapshot.repository.branch } : {}),
                intelligenceStatus: intelligenceRuntime.getState().phase,
              },
            }
          : {}),
        ...(active
          ? {
              workflow: {
                id: active.id,
                title: active.specification?.title ?? active.intent.normalizedObjective,
                stage:
                  active.specification?.status !== "approved"
                    ? "define"
                    : active.taskGraph?.ready
                      ? "build"
                      : "plan",
                ...(task ? { currentTaskId: task.id } : {}),
              },
            }
          : {}),
        capabilities: {
          copilotAvailable: capabilities?.chatAvailable ?? false,
          toolsAvailable: capabilities?.languageModelToolsAvailable ?? false,
        },
        restoredRoute: restored.lastRoute,
        restoredContext: {
          ...(restored.lastWorkflowId ? { workflowId: restored.lastWorkflowId } : {}),
          ...(restored.lastTaskId ? { taskId: restored.lastTaskId } : {}),
          ...(restored.lastIntelligenceQuery
            ? { intelligenceQuery: restored.lastIntelligenceQuery }
            : {}),
          ...(restored.lastEntityId ? { entityId: restored.lastEntityId } : {}),
          ...(restored.lastDrawer ? { drawer: restored.lastDrawer } : {}),
        },
        ...(pendingNavigation
          ? {
              pendingNavigation,
              ...(pendingNavigation.recovery ? { recovery: pendingNavigation.recovery } : {}),
            }
          : {}),
        initializedAt: new Date().toISOString(),
      });
    },
  );
  const navigation = new KeystoneNavigationService(launchValidation, provider);
  const dashboardReference: { current?: KeystoneDashboardProvider } = {};
  const statusBar = new KeystoneStatusBarService(() =>
    vscode.workspace.getConfiguration("keystone.shell").get<boolean>("showStatusBar", true),
  );
  const contextKeys = new KeystoneContextKeyService();
  const notifications = new KeystoneNotificationService();
  const refresh = new KeystoneDashboardRefreshService(
    () => {
      dashboard.refresh();
      statusBar.update(dashboard.snapshot);
      void contextKeys.update(
        dashboard.snapshot,
        Boolean(provider.currentPanel?.visible),
        Boolean(copilotIntegrationStore.snapshot.lastCapabilities?.chatAvailable),
      );
      void notifications.update(dashboard.snapshot);
    },
    vscode.workspace
      .getConfiguration("keystone.shell")
      .get<number>("dashboardRefreshDebounceMs", 150),
  );
  const dashboard = new KeystoneDashboardProvider(dashboardViewModels, async (id) => {
    const destination = dashboardReference.current?.destination(id);
    if (!destination) {
      if (id === "action:open-folder") await vscode.commands.executeCommand("vscode.openFolder");
      return;
    }
    await navigation.open({
      schemaVersion: 1,
      destination,
      source: "activity-bar",
      requestedAt: new Date().toISOString(),
    });
  });
  dashboardReference.current = dashboard;
  const intelligencePanel = new KeystoneIntelligencePanel(context.extensionUri, intelligenceStore);
  const explorerProvider = new KeystoneExplorerProvider(intelligenceStore);
  const copilotToggle = new CopilotToggleService(context);
  const graphIndexer = new GraphIndexerWorker(intelligenceStore, intelligenceRuntime, logger);
  const gitHistoryParser = new GitHistoryParser(intelligenceStore, logger);
  const safetyChecker = new SafetyCheckService();
  serviceRegistry.nativeShell = {
    dashboard: () => dashboard.snapshot,
    refreshDashboard: () => {
      dashboard.refresh();
      return dashboard.snapshot;
    },
    openDashboardItem: async (id) => {
      const destination = dashboard.destination(id);
      if (!destination) throw new Error("Dashboard action is unavailable or informational only.");
      return navigation.open({
        schemaVersion: 1,
        destination,
        source: "activity-bar",
        requestedAt: new Date().toISOString(),
      });
    },
    panel: () => panelState.snapshot,
    updatePanel: (payload) =>
      panelState.route(AppRouteSchema.parse(payload.route), {
        ...(typeof payload.workflowId === "string" ? { workflowId: payload.workflowId } : {}),
        ...(typeof payload.taskId === "string" ? { taskId: payload.taskId } : {}),
        ...(typeof payload.intelligenceQuery === "string"
          ? { query: payload.intelligenceQuery }
          : {}),
        ...(typeof payload.entityId === "string" ? { entityId: payload.entityId } : {}),
        ...(typeof payload.drawer === "string" ? { drawer: payload.drawer } : {}),
      }),
    pending: () => panelState.snapshot.pendingNavigation,
    validate: (request) => launchValidation.validate(request),
    open: (request) => navigation.open(request),
  };
  const commands = new KeystoneCommandService(
    navigation,
    dashboard,
    () => {
      const active = workflow.list().at(-1);
      const task = active?.tasks.find((entry) =>
        ["ready", "executing", "blocked", "stale"].includes(entry.status),
      );
      const snapshot = intelligenceStore.getSnapshot();
      const editor = vscode.window.activeTextEditor;
      const resolved = editor ? workspace.resolveFile(editor.document.uri.toString()) : undefined;
      const file =
        resolved && snapshot
          ? snapshot.files.find((entry) => entry.relativePath === resolved.relativePath)
          : undefined;
      const line = editor?.selection.active.line;
      const symbol =
        file && line !== undefined
          ? snapshot?.symbols
              .filter(
                (entry) =>
                  entry.fileId === file.id &&
                  entry.range.startLine <= line &&
                  entry.range.endLine >= line,
              )
              .sort(
                (left, right) =>
                  left.range.endLine -
                  left.range.startLine -
                  (right.range.endLine - right.range.startLine),
              )[0]
          : undefined;
      return {
        repositoryId: snapshot?.repository.id,
        workflowId: active?.id,
        taskId: task?.id,
        entityId: symbol?.id ?? file?.id,
      };
    },
    refresh,
  );
  const codeLens = new KeystoneCodeLensProvider((uri) => {
    const resolved = workspace.resolveFile(uri.toString());
    const snapshot = intelligenceStore.getSnapshot();
    if (!resolved || !snapshot) return [];
    const file = snapshot.files.find((entry) => entry.relativePath === resolved.relativePath);
    if (!file) return [];
    return snapshot.symbols
      .filter(
        (entry) =>
          entry.fileId === file.id &&
          (entry.exported || entry.visibility === "public") &&
          [
            "keystone.core.Class",
            "keystone.core.Function",
            "keystone.core.Method",
            "keystone.core.Interface",
            "keystone.core.TypeAlias",
          ].includes(entry.type),
      )
      .sort((left, right) => left.range.startLine - right.range.startLine)
      .map((entry) => ({
        repositoryId: snapshot.repository.id,
        entityId: entry.id,
        line: entry.nameRange?.startLine ?? entry.range.startLine,
      }));
  });

  context.subscriptions.push(
    vscode.window.registerWebviewPanelSerializer(KeystonePanelService.viewType, {
      deserializeWebviewPanel: (panel) => provider.restore(panel),
    }),
    vscode.window.registerTreeDataProvider("keystone.dashboard", dashboard),
    vscode.languages.registerCodeLensProvider(
      [
        { language: "typescript", scheme: "file" },
        { language: "typescriptreact", scheme: "file" },
        { language: "javascript", scheme: "file" },
        { language: "javascriptreact", scheme: "file" },
      ],
      codeLens,
    ),
    ...commands.register(),
    vscode.commands.registerCommand("keystone.panel.metrics", () => provider.metrics),
    vscode.commands.registerCommand("keystone.showLogs", () => logger?.show()),
    vscode.commands.registerCommand("keystone.index.restart", () => intelligenceRuntime.start()),
    vscode.commands.registerCommand("keystone.intelligence.overview", () =>
      intelligenceQuery.overview(),
    ),
    vscode.commands.registerCommand("keystone.intelligence.search", (request: unknown) =>
      intelligenceQuery.search(request as never),
    ),
    vscode.commands.registerCommand("keystone.intelligence.entity", (id: string) =>
      intelligenceQuery.entity(id),
    ),
    vscode.commands.registerCommand("keystone.intelligence.neighborhood", (request: unknown) =>
      intelligenceQuery.neighborhood(request),
    ),
    vscode.commands.registerCommand(
      "keystone.intelligence.technologies",
      (request: unknown = { limit: 50 }) => intelligenceQuery.technologies(request as never),
    ),
    vscode.commands.registerCommand(
      "keystone.intelligence.adapterDiagnostics",
      (request: unknown = { limit: 50 }) => intelligenceQuery.adapterDiagnostics(request),
    ),
    vscode.commands.registerCommand("keystone.intelligence.cpg", (request: unknown) =>
      cpgQuery.scope(request as never),
    ),
    vscode.commands.registerCommand("keystone.intelligence.query", (request: unknown) =>
      intelligenceQuery.unified(request),
    ),
    vscode.commands.registerCommand("keystone.intelligence.open", () => intelligencePanel.show()),
    vscode.commands.registerCommand("keystone.intelligence.exported-symbols", () =>
      intelligencePanel.show(),
    ),
    vscode.commands.registerCommand("keystone.intelligence.wildcard-search", () =>
      intelligencePanel.show(),
    ),
    vscode.commands.registerCommand("keystone.intelligence.module-mapping", () =>
      intelligencePanel.show(),
    ),
    vscode.commands.registerCommand("keystone.intelligence.circular-dependencies", () =>
      intelligencePanel.show(),
    ),
    vscode.commands.registerCommand("keystone.intelligence.node-metrics", () =>
      intelligencePanel.show(),
    ),
    vscode.commands.registerCommand("keystone.intelligence.dead-code", () =>
      intelligencePanel.show(),
    ),
    vscode.commands.registerCommand("keystone.intelligence.filtered-subgraph", () =>
      intelligencePanel.show(),
    ),
    vscode.commands.registerCommand("keystone.intelligence.cyclomatic-complexity", () =>
      intelligencePanel.show(),
    ),
    vscode.commands.registerCommand("keystone.copilot.toggle", async () => {
      const enabled = await copilotToggle.toggle();
      vscode.window.showInformationMessage(
        `Keystone Copilot markdown generation ${enabled ? "enabled" : "disabled"}.`,
      );
    }),
    vscode.commands.registerCommand("keystone.graph.index", () => {
      try {
        graphIndexer.start();
        vscode.window.showInformationMessage("Graph indexing started.");
      } catch (error) {
        vscode.window.showErrorMessage(
          `Graph indexing failed: ${error instanceof Error ? error.message : String(error)}`,
        );
      }
    }),
    vscode.commands.registerCommand("keystone.graph.cancel", () => {
      graphIndexer.cancel();
      vscode.window.showInformationMessage("Graph indexing cancelled.");
    }),
    vscode.commands.registerCommand("keystone.git.history", async () => {
      try {
        const commits = await gitHistoryParser.parseHistory();
        vscode.window.showInformationMessage(`Parsed ${commits.length} Git commits.`);
      } catch (error) {
        vscode.window.showErrorMessage(
          `Failed to parse Git history: ${error instanceof Error ? error.message : String(error)}`,
        );
      }
    }),
    vscode.commands.registerCommand("keystone.safety.check", async () => {
      const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
      if (!workspaceFolder) {
        vscode.window.showErrorMessage("No workspace folder open.");
        return;
      }

      const result = await safetyChecker.validateOperation(workspaceFolder.uri.fsPath, "push");

      if (result.safe) {
        vscode.window.showInformationMessage(result.message);
      } else {
        vscode.window.showWarningMessage(`${result.message} ${result.details ?? ""}`);
      }
    }),
    vscode.workspace.onDidChangeConfiguration((event) => {
      if (event.affectsConfiguration("keystone"))
        logger?.info(
          "configuration.changed",
          "Keystone configuration changed. Refresh agent discovery to apply profile changes.",
        );
    }),
    { dispose: () => intelligenceRuntime.dispose() },
    provider,
    dashboard,
    refresh,
    statusBar,
    contextKeys,
    notifications,
    commands,
    intelligencePanel,
    vscode.window.createTreeView("keystone.explorer", {
      treeDataProvider: explorerProvider,
      showCollapseAll: true,
    }),
    {
      dispose: () => {
        void semanticWorker.dispose();
      },
    },
    { dispose: () => logger?.dispose() },
  );
  intelligenceRuntime.onDidChange(() => refresh.request());
  context.subscriptions.push(
    vscode.workspace.onDidChangeWorkspaceFolders(() => refresh.request()),
    vscode.window.onDidChangeActiveTextEditor(() => refresh.request()),
  );
  refresh.request();
  if (
    nativeStore.snapshot.wasOpen &&
    vscode.workspace.getConfiguration("keystone.panel").get<boolean>("reopenOnStartup", true)
  )
    void provider.open(
      {
        schemaVersion: 1,
        destination: { type: "home" },
        source: "restore",
        requestedAt: new Date().toISOString(),
      },
      nativeStore.snapshot.column,
    );
  vscodeCopilotIntegration.register(context.subscriptions, () => {
    const active = workflow
      .list()
      .filter((item) => item.tasks.some((task) => task.status !== "completed"))
      .at(-1);
    const task = active?.tasks.find((item) =>
      ["ready", "executing", "blocked"].includes(item.status),
    );
    return {
      ...(active ? { workflowId: active.id, generation: active.intelligenceGeneration } : {}),
      ...(task ? { taskId: task.id } : {}),
    };
  });
  productStartup.transition("ready", "ready", "Keystone is ready.");
  logger.info("activation.startup-state", productStartup.snapshot.message, productStartup.snapshot);

  void intelligenceRuntime
    .initialize()
    .catch((cause: unknown) =>
      logger?.error(KeystoneError.fromUnknown(cause, "intelligence.runtime.initialize")),
    );

  logger.info("extension.activate", "Keystone intelligence foundation activated.", {
    durationMs: Math.round(performance.now() - startedAt),
    workspaceRoots: vscode.workspace.workspaceFolders?.length ?? 0,
    trusted: vscode.workspace.isTrusted,
    intelligenceStatus: intelligenceRuntime.getState().status,
  });
}

async function openSource(
  relativePath: string,
  range?: {
    startLine: number;
    startColumn: number;
    endLine: number;
    endColumn: number;
  },
): Promise<void> {
  const normalized = relativePath.replace(/\\/g, "/");
  if (!normalized || normalized.startsWith("/") || normalized.split("/").includes(".."))
    throw new Error("Keystone rejected an invalid source path.");
  for (const root of vscode.workspace.workspaceFolders ?? []) {
    const uri = vscode.Uri.joinPath(root.uri, ...normalized.split("/"));
    try {
      const document = await vscode.workspace.openTextDocument(uri);
      const editor = await vscode.window.showTextDocument(document, {
        preview: true,
      });
      if (range) {
        const selection = new vscode.Range(
          range.startLine,
          range.startColumn,
          range.endLine,
          range.endColumn,
        );
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

async function migrateWorkspaceStorage(
  previousRoot: string | undefined,
  repositoryStorageRoot: string | undefined,
): Promise<void> {
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
      logger?.warning(
        "persistence.repository-migration",
        "Existing VS Code workspace storage could not be moved to .keystone; Keystone will create repository-local state.",
        cause,
      );
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
