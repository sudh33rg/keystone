import * as vscode from "vscode";
import { rename, stat } from "node:fs/promises";
import { join } from "node:path";
import { ConfigurationService } from "../core/configuration/ConfigurationService";
import { DefaultIgnorePolicy } from "../core/intelligence/IgnorePolicy";
import { IntelligenceQueryService } from "../core/intelligence/IntelligenceQueryService";
import { IntelligenceGraphSliceService } from "../core/intelligence/canvas/IntelligenceGraphSliceService";
import { IntelligenceEngineeringQueryService } from "../core/intelligence/canvas/IntelligenceEngineeringQueryService";
import { RepositoryIndexService } from "../core/intelligence/RepositoryIndexService";
import { TreeSitterExtractionAdapter } from "../core/intelligence/extraction/TreeSitterExtractionAdapter";
import { TechnologyDetectionService } from "../core/intelligence/technology/TechnologyDetectionService";
import { SchemaSurfaceExtractor } from "../core/intelligence/schema/SchemaSurfaceExtractor";
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
import { DevelopmentContextPackageService } from "../core/context/DevelopmentContextPackageService";
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
import { RepositoryReadService } from "../core/repository/RepositoryReadService";
import { ScopeCorrectionMigration } from "../core/persistence/ScopeCorrectionMigration";
import { OrchestrationPersistenceStore } from "../core/persistence/OrchestrationPersistenceStore";
import { OrchestrationService } from "../core/orchestration/OrchestrationService";
import { StartupStateService } from "../core/integration/ProductIntegrationService";
import { CopilotCustomizationService } from "../core/copilot/CopilotCustomizationService";
import { BuildWorkspaceService } from "../core/workflows/BuildWorkspaceService";
import { ReviewPersistenceStore } from "../core/persistence/ReviewPersistenceStore";
import { ReviewCompletionService } from "../core/review/ReviewCompletionService";
import { PrReviewService } from "../core/review/PrReviewService";
import { PrReviewPersistenceStore } from "../core/persistence/PrReviewPersistenceStore";
import { HandoffPersistenceStore } from "../core/persistence/HandoffPersistenceStore";
import { TaskHandoffService } from "../core/handoff/TaskHandoffService";
import { RepositoryIdentityService } from "../core/handoff/RepositoryIdentityService";
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
import { FileWorkflowPersistence, WorkflowService } from "../core/workflow/WorkflowService";
import { FileStageWorkspacePersistence, StageWorkspaceService } from "../core/workflows/StageWorkspaceService";
import { DevelopmentService, FileDevelopmentPersistence } from "../core/development/DevelopmentService";
import { SourceScopeService } from "../core/development/SourceScopeService";
import { ManualHandoffService } from "../core/development/ManualHandoffService";
import { WorkspaceChangeService } from "../core/development/WorkspaceChangeService";
import { DEVELOPMENT_FILE_EXCLUDE_GLOB, VsCodeDevelopmentAdapter } from "./development/VsCodeDevelopmentAdapter";
import { ExecutionCapabilityDiscoveryService } from "../core/development/ExecutionCapabilityDiscoveryService";
import { InstructionDiscoveryService } from "../core/development/InstructionDiscoveryService";
import { DevelopmentSkillService } from "../core/development/DevelopmentSkillService";
import { InstructionConflictDetector } from "../core/development/InstructionConflictDetector";
import { ExecutionConfigurationService, FileExecutionConfigurationPersistence } from "../core/development/ExecutionConfigurationService";
import { ImpactQaPersistence } from "../core/impactQa/ImpactQaPersistence";
import { ImpactQaService } from "../core/impactQa/ImpactQaService";
import { TestIntelligenceService } from "../core/impactQa/TestIntelligenceService";
import { QaTestIntelligencePersistence } from "../core/impactQa/QaTestIntelligencePersistence";

let logger: KeystoneLogger | undefined;

/** Build a bounded, path-independent repository identity for Task Handoff compatibility. */
async function buildTaskHandoffRepositoryIdentity(
  svc: RepositoryIdentityService,
  repository: RepositoryReadService,
  workspace: { getRoots(): ReadonlyArray<{ name: string; uri: string }> },
): Promise<import("../shared/contracts/handoff").HandoffRepositoryIdentity> {
  const roots = workspace.getRoots();
  let remoteUrl: string | undefined;
  try {
    const identity = await repository.getRepositoryIdentity();
    remoteUrl = identity.sanitizedRemoteUrl;
  } catch {
    remoteUrl = undefined;
  }
  const repositoryName = remoteUrl?.split("/").pop()?.replace(/\.git$/, "") ?? roots[0]?.name ?? "workspace";
  return svc.build({
    repositoryName,
    manifestHashes: [],
    ...(remoteUrl ? { git: { remoteUrl } } : {}),
    workspaceRootCount: roots.length,
  });
}

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
  const canonicalWorkflowRoot = storageRoot ?? context.storageUri?.fsPath ?? context.globalStorageUri.fsPath;
  const canonicalWorkflow = new WorkflowService(
    new FileWorkflowPersistence(join(canonicalWorkflowRoot, "workflows", "phase-2.json")),
  );
  await canonicalWorkflow.initialize();

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
  const treeSitterAdapter = new TreeSitterExtractionAdapter(); // disabled by default; flip enabled to activate polyglot extraction
  const technologyAdapter = new TechnologyDetectionService(); // disabled by default; flip enabled to activate Phase B technology detection
  const schemaAdapter = new SchemaSurfaceExtractor(); // disabled by default; flip enabled to activate Phase C schema surface
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
    undefined,
    undefined,
    treeSitterAdapter,
    technologyAdapter,
    schemaAdapter,
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
  const intelligenceCanvas = new IntelligenceGraphSliceService(intelligenceStore);
  const intelligenceEngineeringQuery = new IntelligenceEngineeringQueryService(intelligenceCanvas);
  const development = new DevelopmentService(new FileDevelopmentPersistence(canonicalWorkflowRoot), canonicalWorkflow);
  await development.initialize();
  development.setHandoffService(new ManualHandoffService({ writeText: async (value) => { await vscode.env.clipboard.writeText(value); } }));
  const developmentHost = repositoryUri ? new VsCodeDevelopmentAdapter(repositoryUri, language, intelligenceQuery) : undefined;
  const developmentScope = repositoryRoot && developmentHost ? new SourceScopeService(repositoryRoot, developmentHost) : undefined;
  const capabilityDiscovery = new ExecutionCapabilityDiscoveryService({
    clipboardAvailable: async () => typeof vscode.env.clipboard?.writeText === "function",
    registeredCommands: async () => vscode.commands.getCommands(true),
    discoveredAgents: async () => [],
  });
  const instructionDiscovery = new InstructionDiscoveryService(repositoryRoot ?? canonicalWorkflowRoot);
  const skillService = new DevelopmentSkillService();
  const builtInDevelopmentSkill = skillService.builtInDevelopmentSkill();
  const builtInTestGenerationSkill = skillService.builtInTestGenerationSkill();
  const conflictDetector = new InstructionConflictDetector();
  const executionConfiguration = new ExecutionConfigurationService(new FileExecutionConfigurationPersistence(canonicalWorkflowRoot), {
    discoverCapabilities: async (manualAgents) => capabilityDiscovery.discover(manualAgents),
    discoverInstructions: async (paths) => instructionDiscovery.discover(paths),
    previewInstruction: async (path) => instructionDiscovery.preview(path),
    listSkills: () => skillService.list([builtInDevelopmentSkill, builtInTestGenerationSkill]),
    conflicts: (instructions, unavailable = []) => [...conflictDetector.detect(instructions), ...conflictDetector.unresolved(unavailable)],
    invalidatePrompt: async (workItemId) => development.invalidatePrompt(workItemId),
  });
  await executionConfiguration.initialize();
  development.setExecutionConfigurationService(executionConfiguration);
  const contextStore = new ContextPersistenceStore(storageRoot);
  await contextStore.initialize();
  if (developmentHost) development.setContextPackageService(new DevelopmentContextPackageService(contextStore), (path, range) => developmentHost.readScopeContent(path, range));
  development.setWorkspaceChangeService(new WorkspaceChangeService({ detect: async () => {
    if (!repositoryUri || !developmentHost) return undefined;
    await git.getMetadata(repositoryUri.toString());
    if (!git.isGitRepository(repositoryUri.toString())) return undefined;
    const [changes, stagedFiles] = await Promise.all([git.getReconciliationChanges(repositoryUri.toString()), git.getStagedFiles(repositoryUri.toString())]);
    const staged = new Set(stagedFiles);
    return changes.map((change) => ({ path: developmentHost.relativePath(vscode.Uri.parse(change.uri)), status: change.kind, staged: staged.has(change.uri), ...(change.originalUri ? { previousPath: developmentHost.relativePath(vscode.Uri.parse(change.originalUri)) } : {}) }));
  } }));
  const impactQa = new ImpactQaService(
    repositoryRoot ?? canonicalWorkflowRoot,
    new ImpactQaPersistence(canonicalWorkflowRoot),
    canonicalWorkflow,
    intelligenceStore,
    { detect: async () => {
      if (!repositoryUri || !developmentHost) return undefined;
      const metadata = await git.getMetadata(repositoryUri.toString());
      if (!git.isGitRepository(repositoryUri.toString())) return undefined;
      const [changes, stagedFiles] = await Promise.all([git.getReconciliationChanges(repositoryUri.toString()), git.getStagedFiles(repositoryUri.toString())]);
      const staged = new Set(stagedFiles);
      return { source: "git", baseRevision: metadata.headCommit, headRevision: metadata.headCommit, files: changes.map((change) => ({ path: developmentHost.relativePath(vscode.Uri.parse(change.uri)), changeType: change.kind, staged: staged.has(change.uri), ...(change.originalUri ? { oldPath: developmentHost.relativePath(vscode.Uri.parse(change.originalUri)) } : {}) })) };
    } },
    {
      workspaceFiles: async () => new Set(repositoryUri && developmentHost ? (await vscode.workspace.findFiles(new vscode.RelativePattern(repositoryUri, "**/*"), DEVELOPMENT_FILE_EXCLUDE_GLOB, 20_000)).map((uri) => developmentHost.relativePath(uri)) : []),
      pickChangedFiles: async () => developmentHost ? (await developmentHost.pickFileUris()).map((uri) => developmentHost.relativePath(vscode.Uri.parse(uri))) : [],
      openSource: async (path) => openSource(path),
    },
  );
  await impactQa.initialize();
  const testIntelligence = new TestIntelligenceService(
    repositoryRoot ?? canonicalWorkflowRoot,
    new QaTestIntelligencePersistence(canonicalWorkflowRoot),
    impactQa,
    development,
    {
      workspaceFiles: async () => new Set(repositoryUri && developmentHost ? (await vscode.workspace.findFiles(new vscode.RelativePattern(repositoryUri, "**/*"), DEVELOPMENT_FILE_EXCLUDE_GLOB, 20_000)).map((uri) => developmentHost.relativePath(uri)) : []),
      readSource: async (relativePath) => {
        const root = repositoryUri ?? vscode.Uri.file(repositoryRoot ?? canonicalWorkflowRoot);
        const uri = vscode.Uri.joinPath(root, ...relativePath.split("/"));
        const bytes = await vscode.workspace.fs.readFile(uri);
        return Buffer.from(bytes).toString("utf8");
      },
    },
  );
  await testIntelligence.initialize();
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
  const stageWorkspace = new StageWorkspaceService(
    new FileStageWorkspacePersistence(join(canonicalWorkflowRoot, "workflows", "stage-workspace.json")),
    canonicalWorkflow,
    intelligenceStore,
    copilot,
    () => { intelligenceRuntime.start(); return Promise.resolve(); },
  );
  await stageWorkspace.initialize();
  const agents = new CopilotAgentRegistry(copilot, delegationStore);
  agents.restore();
  await new ConfiguredAgentLoader(workspace, agents).load();
  const taskContext = new TaskContextService(
    null,
    delegationStore,
    contextStore,
  );
  taskContext.useEngine(
    new ContextPackageService(
      intelligenceStore,
      intelligenceQuery,
      workspace,
      contextStore,
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
  const repositoryRead = new RepositoryReadService(repositoryRoot ?? process.cwd());

  // Initialize HealthCheckService with standard health checks
  const healthCheck = new HealthCheckService();
  healthCheck.register(HealthCheckService.createIntelligenceCheck(intelligenceRuntime));
  healthCheck.register(HealthCheckService.createGitCheck(git));
  healthCheck.register(HealthCheckService.createWorkspaceCheck(workspace));
  healthCheck.register(HealthCheckService.createPersistenceCheck(intelligenceStore));
  healthCheck.register(HealthCheckService.createCopilotCheck(copilotIntegrationStore));
  healthCheck.register(HealthCheckService.createWorkflowCheck(workflow));

  const reviewStore = new ReviewPersistenceStore(storageRoot);
  const review = new ReviewCompletionService(reviewStore, workflow, executionStore, repositoryRead);
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
  const prReviewStore = new PrReviewPersistenceStore(storageRoot);
  const prReview = new PrReviewService(review, prReviewStore);
  await prReview.initialize();
  // Phase 11 — Task Handoff (portable local package; no git/PR/account operations).
  const handoffStore = new HandoffPersistenceStore(storageRoot);
  const repositoryIdentityService = new RepositoryIdentityService();
  const repositoryIdentity = await buildTaskHandoffRepositoryIdentity(repositoryIdentityService, repositoryRead, workspace);
  const handoffService = new TaskHandoffService({
    workflows: {
      getActiveWorkflowId: () => canonicalWorkflow.getActiveWorkflow()?.id ?? null,
      getWorkflow: (id: string) => {
        const cwf = canonicalWorkflow.getWorkflow(id);
        if (!cwf) return undefined;
        return {
          id: cwf.id,
          intentText: cwf.intent.text,
          workType: cwf.intent.workType,
          ...(cwf.specification ? { specificationText: cwf.specification.text, specificationRevision: cwf.specification.revision } : {}),
          status: cwf.status,
          stages: cwf.stages.map((s) => ({ id: s.id, type: s.type, displayName: s.displayName, order: s.order, status: s.status })),
          currentStageId: cwf.currentStageId,
          createdAt: cwf.createdAt,
          updatedAt: cwf.updatedAt,
          revision: 0,
        };
      },
      getRevision: (_id: string) => 0,
    },
    development: { load: async () => undefined },
    evidence: { buildBundle: () => ({ evidenceIncluded: false, findingsAndRemediation: [], contextPackages: [] }) },
    references: { buildManifest: () => ({ files: [], symbols: [], instructions: [], skills: [], intelligenceRevision: "gen-0" }) },
    repository: { build: () => repositoryIdentity },
    localReferences: { build: () => ({ fileHashes: new Map(), instructionHashes: new Map(), skillState: new Map(), symbolLocations: new Map() }) },
    store: handoffStore,
  });
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
    persistenceWarnings: () => scopeMigration.diagnostics,
    handoffAttention: () => 0,
  };
  const panelState = new KeystonePanelStateService(nativeStore);
  const launchValidation = new KeystoneLaunchValidationService(nativeSource);
  const dashboardViewModels = new KeystoneDashboardViewModelService(nativeSource);
  const serviceRegistry: IntelligenceServiceRegistry = {
    canonicalWorkflow,
    stageWorkspace,
    development,
    developmentScope,
    developmentHost,
    executionConfiguration,
    healthCheck,
    intelligenceRuntime,
    intelligenceQuery,
    intelligenceCanvas,
    intelligenceEngineeringQuery,
    impactQa,
    testIntelligence,
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
    repository: repositoryRead,
    review,
    prReview,
    taskHandoff: handoffService,
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
