import type { ConfigurationService } from "../../core/configuration/ConfigurationService";
import { HomeStateService } from "../../core/home/HomeStateService";
import { WorkflowService, WorkflowServiceError } from "../../core/workflow/WorkflowService";
import { DevelopmentService, DevelopmentServiceError } from "../../core/development/DevelopmentService";
import { SourceScopeService, SourceScopeError } from "../../core/development/SourceScopeService";
import type { VsCodeDevelopmentAdapter } from "../development/VsCodeDevelopmentAdapter";
import type { ExecutionConfigurationService } from "../../core/development/ExecutionConfigurationService";
import type { DevelopmentScopeItem } from "../../shared/contracts/development";
import type { IntelligenceQueryService } from "../../core/intelligence/IntelligenceQueryService";
import type { IntelligenceGraphSliceService } from "../../core/intelligence/canvas/IntelligenceGraphSliceService";
import type { IntelligenceEngineeringQueryService } from "../../core/intelligence/canvas/IntelligenceEngineeringQueryService";
import type { ImpactQaService } from "../../core/impactQa/ImpactQaService";
import type { IntelligenceRuntime } from "../../core/intelligence/runtime/IntelligenceRuntime";
import type { ContinuousIntelligenceState } from "../../core/intelligence/runtime/IntelligenceRuntime";
import type { WorkspaceStateStore } from "../../core/persistence/WorkspaceStateStore";
import type { BootstrapSnapshot, WorkspaceSummary } from "../../shared/contracts/domain";
import {
  hostMessage,
  WebviewRequestSchema,
  type HostMessage,
  type WebviewRequest,
} from "../../shared/contracts/messages";
import { KeystoneError } from "../../shared/errors/KeystoneError";
import { HandoffError } from "../../shared/contracts/handoff";
import type { KeystoneLogger } from "../../shared/logging/KeystoneLogger";
import type { CpgQueryService } from "../../core/intelligence/cpg/CpgQueryService";
import type { IntelligenceQuery } from "../../shared/contracts/query";
import type { CopilotAdapter } from "../../core/copilot/CopilotAdapter";
import type { CopilotAgentRegistry } from "../../core/copilot/AgentRegistry";
import type { DelegationService } from "../../core/copilot/DelegationService";
import type { TaskContextService } from "../../core/context/TaskContextService";
import type { DevelopmentWorkflowService } from "../../core/workflows/DevelopmentWorkflowService";
import type { TaskExecutionService } from "../../core/execution/TaskExecutionService";
import type { ValidationOrchestrator } from "../../core/validation/TaskValidationService";
import type {
  CompletionDecisionService,
  WorkflowCompletionService,
} from "../../core/execution/CompletionService";
import type { RepositoryReadService } from "../../core/repository/RepositoryReadService";
import type { ExecutionRoutingService } from "../../core/workflows/ExecutionRoutingService";
import type { OrchestrationService } from "../../core/orchestration/OrchestrationService";
import type { BuildWorkspaceService } from "../../core/workflows/BuildWorkspaceService";
import type { CopilotCustomizationService } from "../../core/copilot/CopilotCustomizationService";
import type { ReviewCompletionService } from "../../core/review/ReviewCompletionService";
import type {
  CopilotCapabilityService,
  CopilotToolAuditService,
  CopilotToolExecutionService,
  CopilotToolRegistry,
} from "../../core/copilot/CopilotIntegrationService";
import type { CopilotAssistedLaunchService } from "../../core/copilot/KeystoneChatAndLaunchService";
import type { CopilotIntegrationPersistenceStore } from "../../core/persistence/CopilotIntegrationPersistenceStore";
import type { HealthCheckService } from "../../core/health/HealthCheckService";
import type { BuildTaskState } from "../../shared/contracts/build";
import type { WorkflowInstance } from "../../shared/contracts/orchestration";
import type {
  DevelopmentTask,
  DevelopmentWorkflowSnapshot,
} from "../../shared/contracts/delegation";
import type {
  KeystoneDashboardState,
  KeystonePanelState,
  OpenKeystoneRequest,
  ValidatedNavigation,
} from "../../shared/contracts/nativeShell";

type PostMessage = (message: HostMessage) => Thenable<boolean>;

export interface IntelligenceServiceRegistry {
  canonicalWorkflow: WorkflowService;
  development: DevelopmentService;
  developmentScope?: SourceScopeService;
  developmentHost?: VsCodeDevelopmentAdapter;
  executionConfiguration: ExecutionConfigurationService;
  intelligenceRuntime: IntelligenceRuntime;
  intelligenceQuery: IntelligenceQueryService;
  intelligenceCanvas: IntelligenceGraphSliceService;
  intelligenceEngineeringQuery: IntelligenceEngineeringQueryService;
  impactQa?: ImpactQaService;
  stageWorkspace?: import("../../core/workflows/StageWorkspaceService").StageWorkspaceService;
  testIntelligence?: import("../../core/impactQa/TestIntelligenceService").TestIntelligenceService;
  cpgQuery: CpgQueryService;
  openSource(
    relativePath: string,
    range?: {
      startLine: number;
      startColumn: number;
      endLine: number;
      endColumn: number;
    },
  ): Promise<void>;
  workflow: DevelopmentWorkflowService;
  buildWorkspace: BuildWorkspaceService;
  customizations: CopilotCustomizationService;
  copilot: CopilotAdapter;
  agents: CopilotAgentRegistry;
  context: TaskContextService;
  delegation: DelegationService;
  currentEditor?(): string | undefined;
  currentSelection?(): { relativePath: string; startLine: number; endLine: number } | undefined;
  execution: TaskExecutionService;
  validation: ValidationOrchestrator;
  completion: CompletionDecisionService;
  workflowCompletion: WorkflowCompletionService;
  repository: RepositoryReadService;
  review: ReviewCompletionService;
  prReview?: import("../../core/review/PrReviewService").PrReviewService;
  taskHandoff?: import("../../core/handoff/TaskHandoffService").TaskHandoffService;
  routing: ExecutionRoutingService;
  orchestration: OrchestrationService;
  workspaceTrusted(): boolean;
  integrationCapabilities: CopilotCapabilityService;
  copilotIntegrationStore: CopilotIntegrationPersistenceStore;
  toolRegistry: CopilotToolRegistry;
  toolExecution: CopilotToolExecutionService;
  toolAudit: CopilotToolAuditService;
  assistedLaunch: CopilotAssistedLaunchService;
  healthCheck: HealthCheckService;
  nativeShell?: {
    dashboard(): KeystoneDashboardState;
    refreshDashboard(): KeystoneDashboardState;
    openDashboardItem(id: string): Promise<ValidatedNavigation>;
    panel(): KeystonePanelState;
    updatePanel(payload: Record<string, unknown>): Promise<KeystonePanelState>;
    pending(): ValidatedNavigation | undefined;
    validate(request: OpenKeystoneRequest): ValidatedNavigation;
    open(request: OpenKeystoneRequest): Promise<ValidatedNavigation>;
  };
}

/** Convert the webview's legacy budget payload (number or partial ContextBudget) into a token ceiling. */
function budgetTokens(
  budget: number | { maxEstimatedTokens?: number } | undefined,
): number | undefined {
  if (budget == null) return undefined;
  if (typeof budget === "number") return budget;
  return budget.maxEstimatedTokens;
}

export class WebviewMessageRouter {
  private readonly responses = new Map<string, HostMessage>();
  private readonly queryControllers = new Map<string, AbortController>();
  private readonly runtimeSubscription: { dispose(): void };
  private runtimeEventRevision = 0;
  private pendingRuntimeState: ContinuousIntelligenceState | undefined;
  private runtimeEventTimer: ReturnType<typeof setTimeout> | undefined;
  private overviewEventTimer: ReturnType<typeof setTimeout> | undefined;
  private disposed = false;
  private lastQueryGeneration = 0;

  constructor(
    private readonly store: WorkspaceStateStore,
    private readonly configuration: ConfigurationService,
    private readonly logger: KeystoneLogger,
    private readonly extensionVersion: string,
    private readonly workspaceSummary: () => WorkspaceSummary,
    private readonly postMessage: PostMessage,
    private readonly services: IntelligenceServiceRegistry,
  ) {
    this.runtimeSubscription = services.intelligenceRuntime.onDidChange((state) => {
      this.pendingRuntimeState = state;
      this.runtimeEventRevision += 1;
      this.scheduleRuntimeEvent();
      this.scheduleOverviewEvent();
    });
  }

  private impactQa(): ImpactQaService {
    if (!this.services.impactQa) throw Object.assign(new Error("Impact Analysis and QA are unavailable in this workspace."), { code: "internal-error" });
    return this.services.impactQa;
  }

  private testIntelligence(): import("../../core/impactQa/TestIntelligenceService").TestIntelligenceService {
    if (!this.services.testIntelligence) throw Object.assign(new Error("Test Intelligence is unavailable in this workspace."), { code: "internal-error" });
    return this.services.testIntelligence;
  }

  private async routeTestIntelligence(req: WebviewRequest): Promise<void> {
    const service = this.testIntelligence();
    const p = req.payload as Record<string, unknown>;
    const send = async (result: unknown): Promise<void> => {
      const aggregate = await result;
      await this.postMessage(hostMessage("testIntelligence.updated", aggregate as never));
      await this.sendSuccess(req.requestId, aggregate);
    };
    switch (req.type) {
      case "testIntelligence.load":
        await send(service.load(p.workflowId as string)); return;
      case "testIntelligence.createGenerationRequest":
        await send(service.createGenerationRequest(p.workflowId as string, p.coverageGapId as string)); return;
      case "testIntelligence.deriveScenarios":
        await send(service.deriveScenarios(p.workflowId as string, p.generationRequestId as string)); return;
      case "testIntelligence.updateScenario":
        await send(service.updateScenario(p.workflowId as string, p.scenarioId as string, { title: p.title as string | undefined, behaviour: p.behaviour as string | undefined, selected: p.selected as boolean | undefined, removalReason: p.removalReason as string | undefined })); return;
      case "testIntelligence.approveScenarios":
        await send(service.approveScenarios(p.workflowId as string, p.generationRequestId as string)); return;
      case "testIntelligence.buildGenerationContext": {
        const built = await service.buildGenerationContext(p.workflowId as string, p.generationRequestId as string, p.budgetTokens as number);
        await this.postMessage(hostMessage("testIntelligence.updated", built.state as never));
        await this.sendSuccess(req.requestId, built); return;
      }
      case "testIntelligence.approveGenerationContext":
        await send(service.markStaleForInputs(p.workflowId as string, "Generation context re-approved.")); return;
      case "testIntelligence.recordProposal":
        await send(service.recordProposal(p.workflowId as string, p.generationRequestId as string, p.proposal as never)); return;
      case "testIntelligence.validateProposalPolicy":
        await send(service.load(p.workflowId as string)); return;
      case "testIntelligence.applyProposal": {
        const applied = await service.applyProposal(p.workflowId as string, p.proposalId as string, p.selectedChangeIds as string[]);
        await this.postMessage(hostMessage("testIntelligence.updated", applied.state as never));
        await this.sendSuccess(req.requestId, applied); return;
      }
      case "testIntelligence.revertApplied":
        await send(service.revertApplied(p.workflowId as string, p.appliedChangeId as string)); return;
      case "testIntelligence.createFailureAnalysis":
        await send(service.createFailureAnalysis(p.workflowId as string, p.testFailureId as string, {
          workflowId: p.workflowId as string,
          qaExecutionId: "qa-execution-ui",
          testFailureId: p.testFailureId as string,
          changedProductionFiles: [],
          changedTestFiles: [],
          changedFixtureFiles: [],
          testFilePath: (p.testFilePath as string | undefined) ?? "unknown",
          message: (p.message as string | undefined) ?? "",
          normalizedMessage: (p.normalizedMessage as string | undefined) ?? (p.message as string | undefined) ?? "",
          stackFrames: (p.stackFrames as string[] | undefined) ?? [],
          exceptionType: (p.exceptionType as string | undefined) ?? undefined,
          assertionLocation: undefined,
          specification: undefined,
          expectedContractText: undefined,
          currentContractText: undefined,
          environmentProblems: [],
          infrastructureProblems: [],
          previousOutcomes: [],
          timedOut: false,
          signatureVariesAcrossRuns: false,
          orderOrTimingSensitive: false,
        })); return;
      case "testIntelligence.acceptFailureClassification":
        await send(service.acceptFailureClassification(p.workflowId as string, p.analysisId as string, p.category as never)); return;
      case "testIntelligence.requestRepeatedRuns":
        await send(service.requestRepeatedRuns(p.workflowId as string, p.testId as string, p.count as number, p.mode as string, p.seed as string | undefined)); return;
      case "testIntelligence.loadFlakyHistory":
        await send(service.loadFlakyHistory(p.workflowId as string, p.testId as string)); return;
      case "testIntelligence.createRemediationProposal":
        await send(service.createRemediationProposal(p.workflowId as string, p.analysisId as string, p.proposal as never)); return;
      case "testIntelligence.validateRemediationPolicy":
        await send(service.load(p.workflowId as string)); return;
      case "testIntelligence.applyRemediation": {
        const applied = await service.applyRemediation(p.workflowId as string, p.proposalId as string, p.selectedChangeIds as string[]);
        await this.postMessage(hostMessage("testIntelligence.updated", applied.state as never));
        await this.sendSuccess(req.requestId, applied); return;
      }
      case "testIntelligence.runValidationSequence":
        await send(service.runValidationSequence(p.workflowId as string, p.source as never, p.sourceRecordId as string, [])); return;
      case "testIntelligence.loadValidationState":
        await send(service.loadValidationState(p.workflowId as string, p.source as never, p.sourceRecordId as string)); return;
      case "testIntelligence.refreshQaDecision":
        await send(service.load(p.workflowId as string)); return;
      default:
        throw new Error(`Unhandled Test Intelligence request: ${req.type}`);
    }
  }


  dispose(): void {
    this.disposed = true;
    this.runtimeSubscription.dispose();
    if (this.runtimeEventTimer) clearTimeout(this.runtimeEventTimer);
    if (this.overviewEventTimer) clearTimeout(this.overviewEventTimer);
    this.runtimeEventTimer = undefined;
    this.overviewEventTimer = undefined;
    for (const controller of this.queryControllers.values()) controller.abort();
    this.queryControllers.clear();
    this.responses.clear();
  }

  private scheduleRuntimeEvent(): void {
    if (this.runtimeEventTimer || this.disposed) return;
    this.runtimeEventTimer = setTimeout(() => {
      this.runtimeEventTimer = undefined;
      const state = this.pendingRuntimeState;
      if (state && !this.disposed)
        void this.postMessage(hostMessage("intelligence/runtime", state));
    }, 100);
  }

  private scheduleOverviewEvent(): void {
    if (this.overviewEventTimer) clearTimeout(this.overviewEventTimer);
    if (this.disposed) return;
    const revision = this.runtimeEventRevision;
    this.overviewEventTimer = setTimeout(() => {
      this.overviewEventTimer = undefined;
      void this.publishOverviewEvent(revision);
    }, 350);
  }

  private async publishOverviewEvent(eventRevision: number): Promise<void> {
    try {
      const overview = await this.services.intelligenceQuery.overview();
      if (this.disposed || eventRevision !== this.runtimeEventRevision) {
        if (!this.disposed) this.scheduleOverviewEvent();
        return;
      }
      await this.postMessage(hostMessage("intelligence/updated", overview));
      if (
        this.lastQueryGeneration &&
        overview.generation &&
        overview.generation !== this.lastQueryGeneration
      )
        await this.postMessage(
          hostMessage("intelligence/queryInvalidated", {
            queryId: crypto.randomUUID(),
            generation: overview.generation,
            message: `Query cache invalidated by generation ${overview.generation}.`,
          }),
        );
      if (overview.generation) {
        const delegationGenerationChanged = Boolean(
          (this.lastQueryGeneration && overview.generation !== this.lastQueryGeneration) ||
          this.services.workflow
            .list()
            .some((workflow) => workflow.intelligenceGeneration !== overview.generation),
        );
        this.lastQueryGeneration = overview.generation;
        if (delegationGenerationChanged) void this.reconcileDelegationState(overview.generation);
      }
    } catch (cause) {
      this.logger.error(KeystoneError.fromUnknown(cause, "intelligence.overview.event"));
    }
  }

  async handle(raw: unknown): Promise<void> {
    const parsed = WebviewRequestSchema.safeParse(raw);
    if (!parsed.success) {
      const requestId = readRequestId(raw);
      const error = new KeystoneError({
        code: "WEBVIEW_MESSAGE_INVALID",
        category: "WEBVIEW",
        message: "Keystone rejected an invalid Webview request.",
        technicalDetails: parsed.error.issues
          .map((issue) => `${issue.path.join(".")}: ${issue.message}`)
          .join("; "),
        operation: "webview.route",
        recoverable: true,
        recommendedAction: "Reload the Keystone view. If the problem continues, review the logs.",
        retryable: true,
        correlationId: requestId,
      });
      this.logger.error(error);
      await this.sendError(requestId, error);
      return;
    }

    const request = parsed.data;
    const cached = this.responses.get(request.requestId);
    if (cached) {
      await this.postMessage(cached);
      return;
    }

    try {
      await this.route(request);
    } catch (cause) {
      const structured = cause instanceof DevelopmentServiceError || cause instanceof SourceScopeError || (cause instanceof Error && "code" in cause && typeof cause.code === "string");
      const error = structured
        ? new KeystoneError({ code: (cause as Error & { code: string }).code, category: "WORKSPACE", message: (cause as Error).message, technicalDetails: `${request.type} failed for correlation ${"correlationId" in request.payload ? request.payload.correlationId : request.requestId}.`, operation: request.type, recoverable: true, recommendedAction: "Correct the Development input or workspace state, then retry.", retryable: true, correlationId: request.requestId, cause })
        : KeystoneError.fromUnknown(cause, request.type, request.requestId);
      this.logger.error(error);
      await this.sendError(request.requestId, error);
    }
  }

  private async route(request: WebviewRequest): Promise<void> {
    this.ensureWorkspaceTrust(request);
    switch (request.type) {      case "workflow.create": {
        try {
          const workflow = await this.services.canonicalWorkflow.createWorkflow(
            { intent: request.payload.intent, workType: request.payload.workType, ...(request.payload.specification ? { specification: request.payload.specification } : {}) },
            request.payload.correlationId,
          );
          try {
            if (!(this.store.snapshot.activityRecords ?? []).some((activity) => activity.resultReference === workflow.id)) {
              const timestamp = new Date().toISOString();
              await this.store.update("activityRecords", [
                ...(this.store.snapshot.activityRecords ?? []),
                { id: crypto.randomUUID(), workflowId: workflow.id, category: "recovery", title: "Workflow created", status: "completed", progress: 100, currentAction: workflow.intent.text, startedAt: timestamp, completedAt: timestamp, resultReference: workflow.id, cancellationRequested: false, createdAt: timestamp, updatedAt: timestamp },
              ]);
            }
          } catch (activityError) {
            this.logger.warning("workflow.activity.write", "The workflow was persisted, but its optional Home activity record could not be saved.", { error: activityError instanceof Error ? activityError.message : String(activityError), workflowId: workflow.id });
          }
          await this.sendSuccess(request.requestId, { type: "workflow.created", correlationId: request.payload.correlationId, workflow });
        } catch (cause) {
          const error = cause instanceof WorkflowServiceError
            ? { code: cause.code, message: cause.message, recoverable: cause.recoverable }
            : { code: "WORKFLOW_PERSISTENCE_FAILED", message: "Keystone could not persist the workflow. Check repository write access, then try again.", recoverable: true };
          await this.sendSuccess(request.requestId, { type: "workflow.creationFailed", correlationId: request.payload.correlationId, error });
        }
        return;
      }
      case "workflow.loadActive":
        await this.sendSuccess(request.requestId, this.services.canonicalWorkflow.getActiveWorkflow());
        return;
      case "workflow.listCanonical":
        await this.sendSuccess(request.requestId, this.services.canonicalWorkflow.listWorkflows());
        return;
      case "workflow.getCanonical":
        await this.sendSuccess(request.requestId, this.services.canonicalWorkflow.getWorkflow(request.payload.workflowId));
        return;
      case "workflow.setActiveCanonical":
        await this.sendSuccess(request.requestId, await this.services.canonicalWorkflow.setActiveWorkflow(request.payload.workflowId));
        return;
      case "stage.understand.load":
      case "stage.understand.initializeIntelligence":
      case "stage.understand.analyzeIntent":
      case "stage.understand.approveAnalysis":
      case "stage.understand.setScopeItem":
      case "stage.understand.resolveAmbiguity":
      case "stage.understand.setConfiguration":
      case "stage.understand.generateContext":
      case "stage.understand.approveContext":
      case "stage.understand.delegate":
      case "stage.understand.captureResult":
      case "stage.understand.validateResult":
      case "stage.understand.acceptWarnings":
      case "stage.understand.complete":
      case "stage.investigation.load":
      case "stage.investigation.upsertQuestion":
      case "stage.investigation.setConclusion":
      case "stage.investigation.complete":
      case "stage.complete.load":
      case "stage.complete.archive":
      case "stage.plan.load":
      case "stage.plan.setConfiguration":
      case "stage.plan.generateContext":
      case "stage.plan.approveContext":
      case "stage.plan.delegate":
      case "stage.plan.capturePlan":
      case "stage.plan.approvePlan":
      case "stage.plan.complete":
        await this.routeStageWorkspace(request);
        return;
      case "development.initialize": {
        let aggregate = await this.services.development.initializeStage(request.payload.workflowId, request.payload.correlationId);
        if (this.services.developmentScope && aggregate.scopeItems.length) aggregate = await this.services.development.replaceScopeAvailability(request.payload.workflowId, aggregate.workItem.id, await this.services.developmentScope.refreshAvailability(aggregate.scopeItems));
        await this.sendSuccess(request.requestId, aggregate); return;
      }
      case "development.load": {
        let aggregate = await this.services.development.load(request.payload.workflowId);
        if (this.services.developmentScope && aggregate.scopeItems.length) aggregate = await this.services.development.replaceScopeAvailability(request.payload.workflowId, aggregate.workItem.id, await this.services.developmentScope.refreshAvailability(aggregate.scopeItems));
        await this.sendSuccess(request.requestId, aggregate); return;
      }
      case "development.updateObjective":
        await this.sendSuccess(request.requestId, await this.services.development.updateObjective(request.payload.workflowId, request.payload.workItemId, request.payload.objective, request.payload.correlationId)); return;
      case "development.addCurrentFile": {
        const host = this.requireDevelopmentHost(); const scope = this.requireDevelopmentScope(); const aggregate = await this.services.development.load(request.payload.workflowId);
        const item = await scope.createFileItem({ workflowId: request.payload.workflowId, workItemId: request.payload.workItemId, fileUri: host.currentFileUri(), source: "current-editor", existing: aggregate.scopeItems });
        await this.sendSuccess(request.requestId, await this.services.development.addScopeItem(request.payload.workflowId, request.payload.workItemId, item, request.payload.correlationId)); return;
      }
      case "development.addSelectedFiles": {
        const host = this.requireDevelopmentHost(); const scope = this.requireDevelopmentScope(); const aggregate = await this.services.development.load(request.payload.workflowId); const uris = await host.pickFileUris();
        const created: DevelopmentScopeItem[] = [];
        for (const fileUri of uris) created.push(await scope.createFileItem({ workflowId: request.payload.workflowId, workItemId: request.payload.workItemId, fileUri, source: "file-picker", existing: [...aggregate.scopeItems, ...created] }));
        let next = aggregate;
        for (let index = 0; index < created.length; index++) next = await this.services.development.addScopeItem(request.payload.workflowId, request.payload.workItemId, created[index]!, `${request.payload.correlationId}:${index}`);
        await this.sendSuccess(request.requestId, next); return;
      }
      case "development.addCurrentSelection": {
        const host = this.requireDevelopmentHost(); const scope = this.requireDevelopmentScope(); const aggregate = await this.services.development.load(request.payload.workflowId); const selected = await host.currentSelectionSymbol();
        const item = await scope.createSymbolItem({ workflowId: request.payload.workflowId, workItemId: request.payload.workItemId, fileUri: selected?.fileUri ?? "", source: "current-selection", existing: aggregate.scopeItems, symbol: selected?.symbol });
        await this.sendSuccess(request.requestId, await this.services.development.addScopeItem(request.payload.workflowId, request.payload.workItemId, item, request.payload.correlationId)); return;
      }
      case "development.addIntelligenceSymbol": {
        const host = this.requireDevelopmentHost(); const scope = this.requireDevelopmentScope(); const aggregate = await this.services.development.load(request.payload.workflowId); const selected = await host.intelligenceSymbol(request.payload.entityId);
        const item = await scope.createSymbolItem({ workflowId: request.payload.workflowId, workItemId: request.payload.workItemId, fileUri: selected?.fileUri ?? "", source: "intelligence", existing: aggregate.scopeItems, symbol: selected?.symbol });
        await this.sendSuccess(request.requestId, await this.services.development.addScopeItem(request.payload.workflowId, request.payload.workItemId, item, request.payload.correlationId)); return;
      }
      case "development.removeScopeItem":
        await this.sendSuccess(request.requestId, await this.services.development.removeScopeItem(request.payload.workflowId, request.payload.workItemId, request.payload.scopeItemId, request.payload.correlationId)); return;
      case "development.preparePrompt":
        await this.sendSuccess(request.requestId, await this.services.development.preparePrompt(request.payload.workflowId, request.payload.workItemId, this.services.developmentHost?.repositoryName() ?? this.workspaceSummary().name, request.payload.notes, request.payload.correlationId)); return;
      case "development.context.build":
        await this.sendSuccess(request.requestId, await this.services.development.buildContextPackage(request.payload.workflowId, request.payload.workItemId, request.payload.budgetTokens, request.payload.notes, request.payload.pinnedItemIds, request.payload.correlationId)); return;
      case "development.context.changeBudget":
        await this.sendSuccess(request.requestId, await this.services.development.changeContextBudget(request.payload.workflowId, request.payload.workItemId, request.payload.packageId, request.payload.revision, request.payload.budgetTokens, request.payload.notes, request.payload.pinnedItemIds, request.payload.correlationId)); return;
      case "development.context.approve":
        await this.sendSuccess(request.requestId, await this.services.development.approveContextPackage(request.payload.workflowId, request.payload.workItemId, request.payload.packageId, request.payload.revision, request.payload.fingerprint, request.payload.correlationId)); return;
      case "development.context.pin":
        await this.sendSuccess(request.requestId, await this.services.development.pinContextItem(request.payload.workflowId, request.payload.workItemId, request.payload.packageId, request.payload.revision, request.payload.itemId, request.payload.pinned, request.payload.correlationId)); return;
      case "development.context.remove":
        await this.sendSuccess(request.requestId, await this.services.development.removeContextItem(request.payload.workflowId, request.payload.workItemId, request.payload.packageId, request.payload.revision, request.payload.itemId, request.payload.overrideRequired, request.payload.correlationId)); return;
      case "development.context.restore":
        await this.sendSuccess(request.requestId, await this.services.development.restoreContextItem(request.payload.workflowId, request.payload.workItemId, request.payload.packageId, request.payload.revision, request.payload.itemId, request.payload.correlationId)); return;
      case "development.copyPrompt":
        await this.sendSuccess(request.requestId, await this.services.development.copyPrompt(request.payload.workflowId, request.payload.workItemId, request.payload.correlationId)); return;
      case "development.confirmHandoff":
        await this.sendSuccess(request.requestId, await this.services.development.confirmHandoff(request.payload.workflowId, request.payload.workItemId, request.payload.correlationId)); return;
      case "development.recordManualOrigin":
        await this.sendSuccess(request.requestId, await this.services.development.recordManualOrigin(request.payload.workflowId, request.payload.workItemId, request.payload.correlationId)); return;
      case "development.loadChanges":
        await this.sendSuccess(request.requestId, await this.services.development.detectChanges(request.payload.workflowId, request.payload.workItemId)); return;
      case "development.recordResult":
        await this.services.development.recordResult(request.payload.workflowId, request.payload.workItemId, { summary: request.payload.summary, ...(request.payload.decisions !== undefined ? { decisions: request.payload.decisions } : {}), ...(request.payload.assumptions !== undefined ? { assumptions: request.payload.assumptions } : {}), ...(request.payload.testsRun !== undefined ? { testsRun: request.payload.testsRun } : {}), ...(request.payload.unresolvedIssues !== undefined ? { unresolvedIssues: request.payload.unresolvedIssues } : {}) }, request.payload.correlationId);
        await this.sendSuccess(request.requestId, await this.services.development.load(request.payload.workflowId)); return;
      case "development.associateChangedFiles":
        await this.sendSuccess(request.requestId, await this.services.development.associateChangedFiles(request.payload.workflowId, request.payload.workItemId, request.payload.resultId, request.payload.associated, request.payload.excluded, request.payload.correlationId)); return;
      case "development.confirmNoCode":
        await this.sendSuccess(request.requestId, await this.services.development.confirmNoCode(request.payload.workflowId, request.payload.workItemId, request.payload.resultId, request.payload.explanation, request.payload.confirmed, request.payload.correlationId)); return;
      case "development.reviewResult":
        await this.sendSuccess(request.requestId, await this.services.development.reviewResult(request.payload.workflowId, request.payload.workItemId, request.payload.resultId, request.payload.decision, request.payload.correlationId)); return;
      case "development.complete":
        await this.sendSuccess(request.requestId, await this.services.development.completeDevelopment(request.payload.workflowId, request.payload.workItemId, request.payload.correlationId)); return;
      case "impact.load": await this.sendSuccess(request.requestId, await this.impactQa().load(request.payload.workflowId)); return;
      case "impact.detect": await this.sendSuccess(request.requestId, await this.impactQa().detect(request.payload.workflowId, request.payload.manualSelection)); return;
      case "impact.openChangedFile": await this.impactQa().openChangedFile(request.payload.workflowId, request.payload.path); await this.sendSuccess(request.requestId, { opened: true }); return;
      case "impact.acceptChangeSet": await this.sendSuccess(request.requestId, await this.impactQa().acceptChangeSet(request.payload.workflowId, request.payload.expectedHash)); return;
      case "impact.analyze": await this.sendSuccess(request.requestId, await this.impactQa().analyze(request.payload.workflowId, request.payload.expectedHash)); return;
      case "impact.acceptAnalysis": await this.sendSuccess(request.requestId, await this.impactQa().acceptImpact(request.payload.workflowId, request.payload.impactAnalysisId, request.payload.expectedHash)); return;
      case "qa.generatePlan": await this.sendSuccess(request.requestId, await this.impactQa().generatePlan(request.payload.workflowId)); return;
      case "qa.updatePlan": await this.sendSuccess(request.requestId, await this.impactQa().updatePlan(request.payload.workflowId, request.payload.itemId, request.payload.selected, request.payload.overrideReason)); return;
      case "qa.approvePlan": await this.sendSuccess(request.requestId, await this.impactQa().approvePlan(request.payload.workflowId, request.payload.expectedHash)); return;
      case "qa.execute": await this.sendSuccess(request.requestId, await this.impactQa().execute(request.payload.workflowId, request.payload.qaPlanId, (progress) => { void this.postMessage(hostMessage("qa.progress", { workflowId: request.payload.workflowId, ...progress })); })); return;
      case "qa.cancel": await this.sendSuccess(request.requestId, { cancelled: this.impactQa().cancel(request.payload.commandId) }); return;
      case "testIntelligence.load":
      case "testIntelligence.createGenerationRequest":
      case "testIntelligence.deriveScenarios":
      case "testIntelligence.updateScenario":
      case "testIntelligence.approveScenarios":
      case "testIntelligence.buildGenerationContext":
      case "testIntelligence.approveGenerationContext":
      case "testIntelligence.recordProposal":
      case "testIntelligence.validateProposalPolicy":
      case "testIntelligence.applyProposal":
      case "testIntelligence.revertApplied":
      case "testIntelligence.createFailureAnalysis":
      case "testIntelligence.acceptFailureClassification":
      case "testIntelligence.requestRepeatedRuns":
      case "testIntelligence.loadFlakyHistory":
      case "testIntelligence.createRemediationProposal":
      case "testIntelligence.validateRemediationPolicy":
      case "testIntelligence.applyRemediation":
      case "testIntelligence.runValidationSequence":
      case "testIntelligence.loadValidationState":
      case "testIntelligence.refreshQaDecision":
        await this.routeTestIntelligence(request); return;
      case "executionConfiguration.load":
      case "executionConfiguration.discoverInstructions":
      case "executionConfiguration.listSkills":
      case "executionConfiguration.validateProfile":
        await this.sendSuccess(request.requestId, await this.services.executionConfiguration.load(request.payload.workflowId, request.payload.workItemId)); return;
      case "executionConfiguration.detectConflicts":
        await this.sendSuccess(request.requestId, await this.services.executionConfiguration.detectSelection(request.payload.workflowId, request.payload.workItemId, request.payload.instructionIds)); return;
      case "executionConfiguration.refresh":
        await this.sendSuccess(request.requestId, await this.services.executionConfiguration.refresh(request.payload.workflowId, request.payload.workItemId)); return;
      case "executionConfiguration.createManualAgent":
        await this.sendSuccess(request.requestId, await this.services.executionConfiguration.createManualAgent({ displayName: request.payload.displayName, ...(request.payload.chatCommandId !== undefined ? { chatCommandId: request.payload.chatCommandId } : {}), ...(request.payload.usageNote !== undefined ? { usageNote: request.payload.usageNote } : {}) }, request.payload.correlationId)); return;
      case "executionConfiguration.updateManualAgent":
        await this.sendSuccess(request.requestId, await this.services.executionConfiguration.updateManualAgent(request.payload.agentId, { displayName: request.payload.displayName, ...(request.payload.chatCommandId !== undefined ? { chatCommandId: request.payload.chatCommandId } : {}), ...(request.payload.usageNote !== undefined ? { usageNote: request.payload.usageNote } : {}) }, request.payload.correlationId)); return;
      case "executionConfiguration.deleteManualAgent":
        await this.sendSuccess(request.requestId, await this.services.executionConfiguration.deleteManualAgent(request.payload.agentId, request.payload.correlationId)); return;
      case "executionConfiguration.addInstructionFile": {
        const path = await this.requireDevelopmentHost().pickInstructionPath();
        const result = path ? await this.services.executionConfiguration.addInstructionPath(path, request.payload.workflowId, request.payload.workItemId, request.payload.correlationId) : await this.services.executionConfiguration.load(request.payload.workflowId, request.payload.workItemId);
        await this.sendSuccess(request.requestId, result); return;
      }
      case "executionConfiguration.previewInstruction":
        await this.sendSuccess(request.requestId, await this.services.executionConfiguration.previewInstruction(request.payload.instructionId)); return;
      case "executionConfiguration.previewSkill":
        await this.sendSuccess(request.requestId, this.services.executionConfiguration.skill(request.payload.skillId)); return;
      case "executionConfiguration.saveProfile":
        await this.sendSuccess(request.requestId, await this.services.executionConfiguration.saveProfile({ workflowId: request.payload.workflowId, workItemId: request.payload.workItemId, executionCapabilityId: request.payload.executionCapabilityId, ...(request.payload.agentConfigurationId ? { agentConfigurationId: request.payload.agentConfigurationId } : {}), skillId: request.payload.skillId, instructionIds: request.payload.instructionIds }, request.payload.correlationId)); return;
      case "home/getState": {
        const home = new HomeStateService(
          this.workspaceSummary,
          this.services.intelligenceQuery,
          this.services.canonicalWorkflow,
          () => this.store.snapshot.activityRecords ?? [],
          this.services.development,
        );
        await this.sendSuccess(request.requestId, await home.getState());
        return;
      }
      case "app/bootstrap": {
        const bootstrap: BootstrapSnapshot = {
          extensionVersion: this.extensionVersion,
          workspace: this.workspaceSummary(),
          state: this.store.snapshot,
          activity: {
            operation: "Continuous repository intelligence",
            detail:
              "The last complete local generation remains available while background reconciliation runs.",
            status: "completed",
            progress: 100,
            cancellable: false,
            updatedAt: new Date().toISOString(),
          },
          implementation: {
            phase: 15,
            phaseName: "Product integration and end-to-end hardening",
            completedTasks: [
              "Repository Intelligence foundation",
              "Continuous ingestion",
              "Semantic graph and progressive CPG",
              "Universal repository adapters",
              "Query and analysis engine",
              "Intent through Task Handoff workflows",
            ],
            nextTask: "Resolve the remaining integration release gates",
          },
        };
        await this.postMessage(hostMessage("bootstrap/ready", bootstrap));
        await this.sendSuccess(request.requestId, bootstrap);
        return;
      }
      case "app/ping":
        await this.sendSuccess(request.requestId, {
          serverTime: new Date().toISOString(),
        });
        return;
      case "dashboard/getState":
        await this.sendSuccess(request.requestId, this.requireNativeShell().dashboard());
        return;
      case "dashboard/refresh":
        await this.sendSuccess(request.requestId, this.requireNativeShell().refreshDashboard());
        return;
      case "dashboard/openAction":
        await this.sendSuccess(
          request.requestId,
          await this.requireNativeShell().openDashboardItem(request.payload.itemId),
        );
        return;
      case "panel/getState":
        await this.sendSuccess(request.requestId, this.requireNativeShell().panel());
        return;
      case "panel/updateState":
        await this.sendSuccess(
          request.requestId,
          await this.requireNativeShell().updatePanel(request.payload),
        );
        return;
      case "panel/getPendingNavigation":
        await this.sendSuccess(request.requestId, this.requireNativeShell().pending());
        return;
      case "navigation/validateTarget":
      case "navigation/resolveFallback":
        await this.sendSuccess(
          request.requestId,
          this.requireNativeShell().validate(request.payload),
        );
        return;
      case "navigation/open":
        await this.sendSuccess(
          request.requestId,
          await this.requireNativeShell().open(request.payload),
        );
        return;
      case "navigation/set": {
        const state =
          "route" in request.payload
            ? await this.store.setActiveRoute(request.payload.route)
            : await this.store.setActiveSection(request.payload.section);
        await this.postMessage(hostMessage("state/updated", state));
        await this.sendSuccess(request.requestId, state);
        return;
      }
      case "settings/open":
        await this.configuration.openSettings(request.payload.query);
        await this.sendSuccess(request.requestId);
        return;
      case "logs/show":
        this.logger.show();
        await this.sendSuccess(request.requestId);
        return;
      case "intelligence/overview": {
        const overview = await this.services.intelligenceQuery.overview();
        await this.postMessage(hostMessage("intelligence/updated", overview));
        await this.sendSuccess(request.requestId, overview);
        return;
      }
      case "intelligence/diagnostics":
        await this.sendSuccess(
          request.requestId,
          await this.cancellableQuery(request.requestId, (signal) =>
            this.services.intelligenceQuery.diagnostics(request.payload, signal),
          ),
        );
        return;
      case "intelligence/scan/start":
        await this.sendSuccess(request.requestId, this.services.intelligenceRuntime.start());
        return;
      case "intelligence/scan/cancel":
        this.services.intelligenceRuntime.cancel();
        await this.sendSuccess(request.requestId);
        return;
      case "intelligence/runtime/pause":
        this.services.intelligenceRuntime.pause();
        await this.sendSuccess(request.requestId);
        return;
      case "intelligence/runtime/resume":
        this.services.intelligenceRuntime.resume();
        await this.sendSuccess(request.requestId);
        return;
      case "intelligence/search":
        await this.sendSuccess(
          request.requestId,
          await this.cancellableQuery(request.requestId, (signal) =>
            this.services.intelligenceQuery.search(request.payload, signal),
          ),
        );
        return;
      case "intelligence/entity":
        await this.sendSuccess(
          request.requestId,
          await this.cancellableQuery(request.requestId, (signal) =>
            this.services.intelligenceQuery.entity(request.payload.id, signal),
          ),
        );
        return;
      case "intelligence/neighborhood":
        await this.sendSuccess(
          request.requestId,
          await this.cancellableQuery(request.requestId, (signal) =>
            this.services.intelligenceQuery.neighborhood(request.payload, signal),
          ),
        );
        return;
      case "intelligence.canvas.search":
        await this.sendSuccess(request.requestId, this.services.intelligenceCanvas.searchEntities(request.payload));
        return;
      case "intelligence.canvas.graph":
      case "intelligence.canvas.expand":
        await this.sendSuccess(request.requestId, this.services.intelligenceCanvas.getGraphSlice(request.payload));
        return;
      case "intelligence.canvas.evidence": {
        if (request.payload.intelligenceRevision !== this.services.intelligenceCanvas.currentRevision()) throw new Error("The requested Intelligence revision is stale. Refresh the result.");
        await this.sendSuccess(request.requestId, this.services.intelligenceCanvas.getEvidence(request.payload.evidenceIds));
        return;
      }
      case "intelligence.canvas.query":
        await this.sendSuccess(request.requestId, this.services.intelligenceEngineeringQuery.execute(request.payload));
        return;
      case "intelligence.canvas.openSource": {
        const entity = this.services.intelligenceCanvas.getEntity(request.payload.entityId, request.payload.intelligenceRevision);
        await this.services.openSource(entity.filePath, entity.range);
        await this.sendSuccess(request.requestId);
        return;
      }
      case "intelligence.canvas.openEvidenceSource": {
        const evidence = this.services.intelligenceCanvas.getEvidenceSource(request.payload.evidenceId, request.payload.intelligenceRevision);
        await this.services.openSource(evidence.filePath, evidence.range);
        await this.sendSuccess(request.requestId);
        return;
      }
      case "intelligence.canvas.addScope":
      case "intelligence.canvas.addContext": {
        this.services.intelligenceCanvas.getEntity(request.payload.entityId, request.payload.intelligenceRevision);
        const workflow = this.services.canonicalWorkflow.getActiveWorkflow();
        if (!workflow) throw new Error("Start or open a workflow before adding Intelligence to Development.");
        const aggregate = await this.services.development.load(workflow.id);
        const host = this.requireDevelopmentHost();
        const scope = this.requireDevelopmentScope();
        const selected = await host.intelligenceSymbol(request.payload.entityId);
        const item = await scope.createSymbolItem({ workflowId: workflow.id, workItemId: aggregate.workItem.id, fileUri: selected?.fileUri ?? "", source: "intelligence", existing: aggregate.scopeItems, symbol: selected?.symbol });
        await this.sendSuccess(request.requestId, await this.services.development.addScopeItem(workflow.id, aggregate.workItem.id, item, `${request.requestId}:${request.type}`));
        return;
      }
      case "intelligence.canvas.addPathContext": {
        const path = this.services.intelligenceCanvas.describePath(request.payload);
        const workflow = this.services.canonicalWorkflow.getActiveWorkflow();
        if (!workflow) throw new Error("Start or open a workflow before adding an Intelligence path to context.");
        const host = this.requireDevelopmentHost();
        const scope = this.requireDevelopmentScope();
        let aggregate = await this.services.development.load(workflow.id);
        for (let index = 0; index < request.payload.entityIds.length; index += 1) {
          const entityId = request.payload.entityIds[index]!;
          if (aggregate.scopeItems.some((item) => item.symbol?.entityId === entityId)) continue;
          const selected = await host.intelligenceSymbol(entityId);
          const item = await scope.createSymbolItem({ workflowId: workflow.id, workItemId: aggregate.workItem.id, fileUri: selected?.fileUri ?? "", source: "intelligence", existing: aggregate.scopeItems, symbol: selected?.symbol });
          aggregate = await this.services.development.addScopeItem(workflow.id, aggregate.workItem.id, item, `${request.requestId}:path:${index}`);
        }
        aggregate = await this.services.development.addIntelligenceSelection(workflow.id, aggregate.workItem.id, { kind: "call-flow", ...path }, `${request.requestId}:path-selection`);
        await this.sendSuccess(request.requestId, aggregate);
        return;
      }
      case "intelligence/technologies":
        await this.sendSuccess(
          request.requestId,
          await this.cancellableQuery(request.requestId, (signal) =>
            this.services.intelligenceQuery.technologies(request.payload, signal),
          ),
        );
        return;
      case "intelligence/adapter-diagnostics":
        await this.sendSuccess(
          request.requestId,
          await this.cancellableQuery(request.requestId, (signal) =>
            this.services.intelligenceQuery.adapterDiagnostics(request.payload, signal),
          ),
        );
        return;
      case "intelligence/query":
        await this.sendSuccess(
          request.requestId,
          await this.runUnifiedQuery(request.requestId, request.payload),
        );
        return;
      case "intelligence/query/compile":
        await this.sendSuccess(
          request.requestId,
          this.services.intelligenceQuery.compile(request.payload),
        );
        return;
      case "intelligence/query/cancel":
        this.queryControllers.get(request.payload.queryId)?.abort();
        await this.postMessage(
          hostMessage("intelligence/queryCancelled", {
            queryId: request.payload.queryId,
            message: "Query cancellation requested.",
          }),
        );
        await this.sendSuccess(request.requestId);
        return;
      case "intelligence/query/suggestions":
        await this.sendSuccess(
          request.requestId,
          await this.cancellableQuery(request.requestId, (signal) =>
            this.services.intelligenceQuery.suggestions(request.payload, signal),
          ),
        );
        return;
      case "intelligence/query/templates":
        await this.sendSuccess(request.requestId, this.services.intelligenceQuery.templates());
        return;
      case "intelligence/query/explanation":
        await this.sendSuccess(
          request.requestId,
          this.services.intelligenceQuery.explanation(request.payload.queryId),
        );
        return;
      case "intelligence/path":
        await this.sendSuccess(
          request.requestId,
          await this.runUnifiedQuery(request.requestId, {
            query: { ...request.payload, operation: "PATH" },
          }),
        );
        return;
      case "intelligence/impact":
        await this.sendSuccess(
          request.requestId,
          await this.runUnifiedQuery(request.requestId, {
            query: { ...request.payload, operation: "IMPACT" },
          }),
        );
        return;
      case "intelligence/flow":
        await this.sendSuccess(
          request.requestId,
          await this.runUnifiedQuery(request.requestId, {
            query: { ...request.payload, operation: "FLOW" },
          }),
        );
        return;
      case "intelligence/architecture":
        await this.sendSuccess(
          request.requestId,
          await this.runUnifiedQuery(request.requestId, {
            query: request.payload,
          }),
        );
        return;
      case "intelligence/dependencies":
        await this.sendSuccess(
          request.requestId,
          await this.runUnifiedQuery(request.requestId, {
            query: request.payload,
          }),
        );
        return;
      case "intelligence/tests":
        await this.sendSuccess(
          request.requestId,
          await this.runUnifiedQuery(request.requestId, {
            query: request.payload,
          }),
        );
        return;
      case "intelligence/changes":
        await this.sendSuccess(
          request.requestId,
          await this.runUnifiedQuery(request.requestId, {
            query: request.payload,
          }),
        );
        return;
      case "intelligence/cpg":
        await this.sendSuccess(
          request.requestId,
          await this.runUnifiedQuery(request.requestId, {
            query: request.payload,
          }),
        );
        return;
      case "intelligence/cpg/scope":
        await this.sendSuccess(
          request.requestId,
          await this.cancellableQuery(request.requestId, (signal) =>
            this.services.cpgQuery.scope(request.payload, signal),
          ),
        );
        return;
      case "intelligence/cpg/slice":
        await this.sendSuccess(
          request.requestId,
          await this.cancellableQuery(request.requestId, (signal) =>
            this.services.cpgQuery.slice(request.payload, signal),
          ),
        );
        return;
      case "intelligence/source/open":
        await this.services.openSource(request.payload.relativePath, request.payload.range);
        await this.sendSuccess(request.requestId);
        return;
      case "workflow/capture": {
        const workflow = await this.cancellableQuery(request.requestId, (signal) =>
          this.services.workflow.capture(
            request.payload.text,
            request.payload.mode,
            request.payload.title,
            signal,
            {
              workType: request.payload.workType,
              repositoryScope: request.payload.repositoryScope,
            },
          ),
        );
        await this.postMessage(
          hostMessage(
            "workflow/updated",
            workflowEvent(
              workflow,
              "Intent resolved through Keystone Intelligence and specification draft created.",
            ),
          ),
        );
        await this.sendSuccess(request.requestId, workflow);
        return;
      }
      case "workflow/list":
        await this.sendSuccess(request.requestId, this.services.workflow.list());
        return;
      case "workflow/get":
        await this.sendSuccess(
          request.requestId,
          this.services.workflow.get(request.payload.workflowId),
        );
        return;
      case "workflow/spec/submit":
        await this.sendWorkflow(
          request.requestId,
          await this.services.workflow.submitForReview(request.payload.workflowId),
          "Specification submitted for review.",
        );
        return;
      case "workflow/spec/revise":
        await this.sendWorkflow(
          request.requestId,
          await this.services.workflow.revise(
            request.payload.workflowId,
            request.payload.patch,
            request.payload.reason,
          ),
          "Specification revised; material task state was invalidated.",
        );
        return;
      case "workflow/spec/resolveDecision":
        await this.sendWorkflow(
          request.requestId,
          await this.services.workflow.resolveDecision(
            request.payload.workflowId,
            request.payload.decisionId,
            request.payload.resolution,
          ),
          "Specification decision resolved.",
        );
        return;
      case "workflow/spec/approve":
        await this.sendWorkflow(
          request.requestId,
          await this.services.workflow.approve(
            request.payload.workflowId,
            request.payload.expectedRevision,
            request.payload.rationale,
          ),
          "Specification explicitly approved.",
        );
        return;
      case "workflow/tasks/generate":
        await this.sendWorkflow(
          request.requestId,
          await this.services.workflow.generateTasks(request.payload.workflowId),
          "Dependency-ordered task graph generated.",
        );
        return;
      case "workflow/reconcile": {
        const workflow = await this.services.workflow.reconcileStaleness(
          request.payload.workflowId,
        );
        const type = workflow.status === "stale" ? "workflow/stale" : "workflow/updated";
        await this.postMessage(
          hostMessage(
            type,
            workflowEvent(
              workflow,
              workflow.status === "stale"
                ? "Relevant repository intelligence changed."
                : "Workflow remains current.",
            ),
          ),
        );
        await this.sendSuccess(request.requestId, workflow);
        return;
      }
      case "workbench/getCreateContext": {
        const snapshot = this.services.workflow.getCurrentSnapshot();
        const workspace = this.workspaceSummary();
        const capabilities = this.services.copilot.getCapabilities();
        await this.sendSuccess(request.requestId, {
          schemaVersion: 1,
          repository: {
            available: Boolean(snapshot),
            trusted: this.services.workspaceTrusted?.() !== false,
            ...(snapshot
              ? {
                  id: snapshot.repository.id,
                  name: workspace.name,
                  branch: snapshot.repository.branch,
                  head: snapshot.repository.headCommit,
                }
              : {}),
          },
          intelligence: {
            status: snapshot
              ? workspace.indexStatus === "partial"
                ? "partial"
                : "ready"
              : ["scanning", "reconciling", "indexing"].includes(workspace.indexStatus)
                ? "building"
                : "unavailable",
            generation: snapshot?.manifest.generation ?? 0,
            message: snapshot
              ? `Generation ${snapshot.manifest.generation} is available.`
              : "No complete Intelligence generation is available.",
          },
          activeEditor: this.services.currentEditor?.(),
          copilot: {
            available: capabilities?.extensionDetected ?? false,
            directInvocation: capabilities?.directInvocationAvailable ?? false,
            summary: capabilities?.extensionDetected
              ? capabilities.directInvocationAvailable
                ? "GitHub Copilot direct invocation is available."
                : "GitHub Copilot is available through an assisted path."
              : "GitHub Copilot is unavailable; workflow planning remains available.",
          },
          workflowDefinitions: workbenchDefinitions(),
        });
        return;
      }
      case "workbench/createWorkflow": {
        const activeEditor = this.services.currentEditor?.();
        const scope =
          request.payload.repositoryScope.kind === "current-file"
            ? {
                kind: "current-file" as const,
                paths: activeEditor ? [activeEditor] : [],
              }
            : request.payload.repositoryScope;
        if (scope.kind === "current-file" && !scope.paths.length)
          throw new Error("No active repository file is available for current-file scope.");
        const workflow = await this.cancellableQuery(request.requestId, (signal) =>
          this.services.workflow.createWorkbenchDraft(
            { ...request.payload, repositoryScope: scope },
            signal,
          ),
        );
        await this.store.setActiveRoute(`/workbench/${workflow.id}/define`);
        await this.postMessage(
          hostMessage(
            "workbench/workflowCreated",
            workbenchEvent(workflow, "define", "Workflow draft created from the developer intent."),
          ),
        );
        await this.sendSuccess(request.requestId, workflow);
        return;
      }
      case "workbench/getWorkflow": {
        const workflow = this.services.workflow.get(request.payload.workflowId);
        await this.sendSuccess(
          request.requestId,
          workflow ? this.services.workflow.getWorkbenchState(workflow.id) : undefined,
        );
        return;
      }
      case "workbench/listWorkflows":
        await this.sendSuccess(request.requestId, this.services.workflow.list());
        return;
      case "workbench/openWorkflow":
      case "workbench/navigateStage": {
        const state = this.services.workflow.getWorkbenchState(request.payload.workflowId);
        const target = state.stageStates.find((item) => item.stage === request.payload.stage)!;
        if (["blocked", "unavailable"].includes(target.status))
          throw new Error(
            `${stageTitle(target.stage)} is unavailable. ${target.blockers.map((item) => `${item.message} ${item.recoveryAction}`).join(" ")}`,
          );
        await this.store.setActiveRoute(`/workbench/${state.workflow.id}/${request.payload.stage}`);
        await this.postMessage(
          hostMessage(
            "workbench/stageStateChanged",
            workbenchEvent(
              state.workflow,
              request.payload.stage,
              `Workbench opened ${stageTitle(request.payload.stage)}.`,
            ),
          ),
        );
        await this.sendSuccess(
          request.requestId,
          this.services.workflow.getWorkbenchState(state.workflow.id),
        );
        return;
      }
      case "workbench/getDefineState":
        await this.sendSuccess(
          request.requestId,
          this.services.workflow.getDefineState(request.payload.workflowId),
        );
        return;
      case "workbench/updateIntent": {
        const workflow = await this.services.workflow.updateIntent(
          request.payload.workflowId,
          request.payload.intent,
          request.payload.reason,
        );
        await this.sendWorkbenchWorkflow(
          request.requestId,
          workflow,
          "workbench/intentChanged",
          "Intent revision saved; derived state was marked stale where required.",
        );
        return;
      }
      case "workbench/updateScope": {
        const workflow = await this.services.workflow.updateScope(
          request.payload.workflowId,
          request.payload.repositoryScope,
          request.payload.reason,
        );
        await this.sendWorkbenchWorkflow(
          request.requestId,
          workflow,
          "workbench/intentChanged",
          "Repository scope revision saved.",
        );
        return;
      }
      case "workbench/updateConstraints": {
        const workflow = await this.services.workflow.updateConstraints(
          request.payload.workflowId,
          request.payload.constraints,
          request.payload.reason,
        );
        await this.sendWorkbenchWorkflow(
          request.requestId,
          workflow,
          "workbench/intentChanged",
          "Workflow constraints revision saved.",
        );
        return;
      }
      case "workbench/getClarifications":
        await this.sendSuccess(
          request.requestId,
          this.services.workflow.get(request.payload.workflowId)?.clarifications ?? [],
        );
        return;
      case "workbench/answerClarification": {
        const workflow = await this.services.workflow.answerClarification(
          request.payload.workflowId,
          request.payload.clarificationId,
          request.payload.answer,
          request.payload.rationale,
        );
        await this.sendWorkbenchWorkflow(
          request.requestId,
          workflow,
          "workbench/clarificationChanged",
          "Clarification answered and recorded as a durable workflow decision.",
        );
        return;
      }
      case "workbench/deferClarification": {
        const workflow = await this.services.workflow.setClarificationStatus(
          request.payload.workflowId,
          request.payload.clarificationId,
          "deferred",
        );
        await this.sendWorkbenchWorkflow(
          request.requestId,
          workflow,
          "workbench/clarificationChanged",
          "Clarification explicitly deferred.",
        );
        return;
      }
      case "workbench/markClarificationNotApplicable": {
        const workflow = await this.services.workflow.setClarificationStatus(
          request.payload.workflowId,
          request.payload.clarificationId,
          "not-applicable",
        );
        await this.sendWorkbenchWorkflow(
          request.requestId,
          workflow,
          "workbench/clarificationChanged",
          "Clarification explicitly marked not applicable.",
        );
        return;
      }
      case "workbench/reopenClarification": {
        const workflow = await this.services.workflow.setClarificationStatus(
          request.payload.workflowId,
          request.payload.clarificationId,
          "open",
        );
        await this.sendWorkbenchWorkflow(
          request.requestId,
          workflow,
          "workbench/clarificationChanged",
          "Clarification reopened.",
        );
        return;
      }
      case "workbench/generateSpecification": {
        const workflow = await this.services.workflow.generateSpecification(
          request.payload.workflowId,
        );
        await this.sendWorkbenchWorkflow(
          request.requestId,
          workflow,
          "workbench/specificationGenerated",
          "Deterministic specification draft generated.",
        );
        return;
      }
      case "workbench/updateSpecification": {
        const workflow = await this.services.workflow.revise(
          request.payload.workflowId,
          request.payload.patch,
          request.payload.reason,
        );
        await this.sendWorkbenchWorkflow(
          request.requestId,
          workflow,
          "workbench/workflowChanged",
          "Specification draft revision saved.",
        );
        return;
      }
      case "workbench/generateAcceptanceCriteria": {
        const workflow = await this.services.workflow.generateAcceptanceCriteria(
          request.payload.workflowId,
        );
        await this.sendWorkbenchWorkflow(
          request.requestId,
          workflow,
          "workbench/workflowChanged",
          "Structured acceptance criteria regenerated.",
        );
        return;
      }
      case "workbench/approveSpecification": {
        const state = this.services.workflow.getWorkbenchState(request.payload.workflowId);
        if (
          state.summary.repositoryFreshness !== "current" ||
          state.summary.intelligenceFreshness !== "current"
        )
          throw new Error(
            "Specification approval requires the workflow repository and Intelligence generation to be current. Review stale-state diagnostics and reconcile first.",
          );
        const workflow = await this.services.workflow.approve(
          request.payload.workflowId,
          request.payload.expectedRevision,
          request.payload.rationale,
        );
        await this.sendWorkbenchWorkflow(
          request.requestId,
          workflow,
          "workbench/specificationApproved",
          "Immutable specification revision approved; Plan is ready.",
        );
        return;
      }
      case "workbench/getPlanState":
        await this.sendSuccess(
          request.requestId,
          this.services.workflow.getPlanState(request.payload.workflowId),
        );
        return;
      case "workbench/generateTaskPlan": {
        const workflow = await this.services.workflow.generateTaskPlan(request.payload.workflowId);
        await this.sendWorkbenchWorkflow(
          request.requestId,
          workflow,
          "workbench/taskPlanGenerated",
          "Deterministic task-plan draft generated.",
        );
        return;
      }
      case "workbench/updateTask": {
        const workflow = await this.services.workflow.updateTask(
          request.payload.workflowId,
          request.payload.taskId,
          request.payload.expectedPlanRevision,
          request.payload.patch,
        );
        await this.sendWorkbenchWorkflow(
          request.requestId,
          workflow,
          "workbench/taskPlanChanged",
          "Task-plan revision updated.",
        );
        return;
      }
      case "workbench/addTask": {
        const workflow = await this.services.workflow.addTask(
          request.payload.workflowId,
          request.payload.expectedPlanRevision,
          request.payload.task,
        );
        await this.sendWorkbenchWorkflow(
          request.requestId,
          workflow,
          "workbench/taskPlanChanged",
          "Task added to a new plan revision.",
        );
        return;
      }
      case "workbench/removeTask": {
        const workflow = await this.services.workflow.removeTask(
          request.payload.workflowId,
          request.payload.taskId,
          request.payload.expectedPlanRevision,
        );
        await this.sendWorkbenchWorkflow(
          request.requestId,
          workflow,
          "workbench/taskPlanChanged",
          "Task removed from a new plan revision.",
        );
        return;
      }
      case "workbench/reorderTask": {
        const workflow = await this.services.workflow.reorderTask(
          request.payload.workflowId,
          request.payload.taskId,
          request.payload.direction,
          request.payload.expectedPlanRevision,
        );
        await this.sendWorkbenchWorkflow(
          request.requestId,
          workflow,
          "workbench/taskPlanChanged",
          `Task moved ${request.payload.direction} in a new plan revision.`,
        );
        return;
      }
      case "workbench/updateDependency": {
        const workflow = await this.services.workflow.updateDependency(
          request.payload.workflowId,
          request.payload.taskId,
          request.payload.dependencyId,
          request.payload.action,
          request.payload.expectedPlanRevision,
        );
        await this.sendWorkbenchWorkflow(
          request.requestId,
          workflow,
          "workbench/taskPlanChanged",
          "Task dependency updated and plan validation rerun.",
        );
        return;
      }
      case "workbench/validateTaskPlan":
        await this.sendSuccess(
          request.requestId,
          this.services.workflow.validateTaskPlan(request.payload.workflowId),
        );
        return;
      case "workbench/approveTaskPlan": {
        const workflow = await this.services.workflow.approveTaskPlan(
          request.payload.workflowId,
          request.payload.expectedPlanRevision,
        );
        await this.sendWorkbenchWorkflow(
          request.requestId,
          workflow,
          "workbench/taskPlanApproved",
          "Reviewed task-plan revision approved; Build is ready. No delegation was started.",
        );
        return;
      }
      case "workbench/getStageStates":
        await this.sendSuccess(
          request.requestId,
          this.services.workflow.getStageStates(request.payload.workflowId),
        );
        return;
      case "workbench/getSummary":
        await this.sendSuccess(
          request.requestId,
          this.services.workflow.getWorkbenchState(request.payload.workflowId).summary,
        );
        return;
      case "build/getTaskQueue":
        await this.sendSuccess(
          request.requestId,
          this.services.buildWorkspace.queue(request.payload.workflowId),
        );
        return;
      case "build/getTaskState":
        await this.sendSuccess(
          request.requestId,
          await this.services.buildWorkspace.state(
            request.payload.workflowId,
            request.payload.taskId,
          ),
        );
        return;
      case "build/selectTask": {
        const workflow = this.services.workflow.get(request.payload.workflowId);
        if (
          !workflow?.specification ||
          workflow.specification.revision !== request.payload.specificationRevision ||
          workflow.intelligenceGeneration !== request.payload.intelligenceGeneration
        )
          throw new Error(
            "Task selection is stale; refresh the Build workspace before selecting it.",
          );
        const state = await this.services.buildWorkspace.select(
          request.payload.workflowId,
          request.payload.taskId,
        );
        await this.postMessage(
          hostMessage(
            "build/taskSelected",
            buildEvent(state, "Task selected after canonical readiness refresh."),
          ),
        );
        await this.sendSuccess(request.requestId, state);
        return;
      }
      case "build/startTask": {
        const state = await this.services.buildWorkspace.start(
          request.payload.workflowId,
          request.payload.taskId,
        );
        await this.postMessage(
          hostMessage(
            "build/taskStarted",
            buildEvent(state, "Task started without automatic delegation."),
          ),
        );
        await this.sendSuccess(request.requestId, state);
        return;
      }
      case "build/pauseTask": {
        const state = await this.services.buildWorkspace.pause(
          request.payload.workflowId,
          request.payload.taskId,
        );
        await this.postMessage(
          hostMessage(
            "build/taskPaused",
            buildEvent(state, "Task paused; state and baseline were preserved."),
          ),
        );
        await this.sendSuccess(request.requestId, state);
        return;
      }
      case "build/resumeTask": {
        const state = await this.services.buildWorkspace.resume(
          request.payload.workflowId,
          request.payload.taskId,
        );
        await this.postMessage(
          hostMessage(
            "build/taskStarted",
            buildEvent(state, "Task resumed after readiness revalidation."),
          ),
        );
        await this.sendSuccess(request.requestId, state);
        return;
      }
      case "build/blockTask": {
        const state = await this.services.buildWorkspace.block(
          request.payload.workflowId,
          request.payload.taskId,
          `${request.payload.category}: ${request.payload.reason}. Next: ${request.payload.suggestedAction}`,
        );
        await this.postMessage(
          hostMessage("build/taskBlocked", buildEvent(state, "Task explicitly blocked.")),
        );
        await this.sendSuccess(request.requestId, state);
        return;
      }
      case "build/cancelTask": {
        const state = await this.services.buildWorkspace.cancel(
          request.payload.workflowId,
          request.payload.taskId,
        );
        await this.postMessage(
          hostMessage(
            "build/taskChanged",
            buildEvent(state, "Task cancelled; no repository action was performed."),
          ),
        );
        await this.sendSuccess(request.requestId, state);
        return;
      }
      case "build/getCopilotCapabilities": {
        const value =
          this.services.copilot.getCapabilities() ??
          (await this.services.copilot.refreshCapabilities());
        await this.sendSuccess(request.requestId, value);
        return;
      }
      case "build/getCustomizations": {
        const workflow = this.services.workflow.get(request.payload.workflowId);
        const task = workflow?.tasks.find((item) => item.id === request.payload.taskId);
        if (!task) throw new Error("Task not found.");
        await this.sendSuccess(
          request.requestId,
          await this.cancellableQuery(request.requestId, (signal) =>
            this.services.customizations.discover(task, signal),
          ),
        );
        return;
      }
      case "build/updateCustomizationSelection": {
        await this.services.customizations.select(
          request.payload.taskId,
          request.payload.customizationId,
          request.payload.selected,
        );
        const workflow = this.services.workflow.get(request.payload.workflowId);
        const task = workflow?.tasks.find((item) => item.id === request.payload.taskId);
        if (!workflow || !task) throw new Error("Task not found.");
        if (this.services.context.get(task.id))
          await this.services.context.invalidate(
            task.id,
            "Copilot customization selection changed; regenerate context before delegation.",
          );
        const value = await this.services.customizations.discover(task);
        await this.postMessage(
          hostMessage(
            "build/contextCompleted",
            buildEvent(
              await this.services.buildWorkspace.state(workflow.id, task.id),
              "Customization changed; existing context is stale.",
            ),
          ),
        );
        await this.sendSuccess(request.requestId, value);
        return;
      }
      case "build/getAgents":
        await this.sendSuccess(request.requestId, this.services.agents.getProfiles());
        return;
      case "copilot/capabilities":
        await this.sendSuccess(
          request.requestId,
          this.services.copilot.getCapabilities() ??
            (await this.services.copilot.refreshCapabilities()),
        );
        return;
      case "copilot/refreshCapabilities": {
        const previousFingerprint = this.services.copilot.getCapabilities()?.fingerprint;
        const capabilities = await this.cancellableQuery(request.requestId, (signal) =>
          this.services.copilot.refreshCapabilities(signal),
        );
        if (previousFingerprint && previousFingerprint !== capabilities.fingerprint)
          await this.invalidatePreparedDelegations(
            "Detected Copilot capabilities changed; rebuild context and approve the current prompt before delegation.",
          );
        await this.postMessage(
          hostMessage("copilot/capabilitiesChanged", {
            fingerprint: capabilities.fingerprint,
            capabilities,
          }),
        );
        await this.sendSuccess(request.requestId, capabilities);
        return;
      }
      case "copilot/agents":
        await this.sendSuccess(request.requestId, this.services.agents.getProfiles());
        return;
      case "copilot/refreshAgents": {
        const agents = await this.cancellableQuery(request.requestId, (signal) =>
          this.services.agents.refresh(undefined, signal),
        );
        await this.postMessage(
          hostMessage("copilot/agentsChanged", {
            agents,
            refreshedAt: new Date().toISOString(),
          }),
        );
        await this.sendSuccess(request.requestId, agents);
        return;
      }
      case "copilot/agentRecommendation": {
        const { task } = resolveTask(
          this.services.workflow,
          request.payload.workflowId,
          request.payload.taskId,
        );
        await this.sendSuccess(
          request.requestId,
          this.services.agents.recommend(task, request.payload.selectionMode),
        );
        return;
      }
      case "copilot/selectAgent": {
        const agent = this.services.agents.getProfile(request.payload.agentId);
        if (!agent)
          throw new Error("The selected agent is not in the current evidence-backed registry.");
        await this.services.agents.selections.select(
          request.payload.taskId,
          agent,
          request.payload.confirmed,
        );
        const workflow = await this.services.workflow.assignAgent(
          request.payload.workflowId,
          request.payload.taskId,
          agent.id,
        );
        await this.sendWorkflow(
          request.requestId,
          workflow,
          `Agent ${agent.displayName} selected.`,
        );
        return;
      }
      case "copilot/getCapabilities":
      case "copilot/getIntegrationStatus":
        await this.sendSuccess(
          request.requestId,
          await this.services.integrationCapabilities.refresh(),
        );
        return;
      case "copilot/listCustomizations":
      case "copilot/refreshCustomizations":
      case "copilot/getApplicableCustomizations": {
        const { task } = resolveTask(
          this.services.workflow,
          request.payload.workflowId!,
          request.payload.taskId!,
        );
        await this.sendSuccess(
          request.requestId,
          await this.services.customizations.discoverRecords(task),
        );
        return;
      }
      case "copilot/getCustomization": {
        const { task } = resolveTask(
          this.services.workflow,
          request.payload.workflowId!,
          request.payload.taskId!,
        );
        const items = await this.services.customizations.discoverRecords(task);
        await this.sendSuccess(
          request.requestId,
          items.find((item) => item.id === request.payload.customizationId),
        );
        return;
      }
      case "copilot/setCustomizationEnabled": {
        const { task } = resolveTask(
          this.services.workflow,
          request.payload.workflowId!,
          request.payload.taskId!,
        );
        await this.services.customizations.select(
          task.id,
          request.payload.customizationId,
          request.payload.enabled,
        );
        await this.sendSuccess(
          request.requestId,
          await this.services.customizations.discoverRecords(task),
        );
        return;
      }
      case "copilot/listAgents":
        await this.sendSuccess(request.requestId, this.services.agents.getProfiles());
        return;
      case "copilot/getAgent":
        await this.sendSuccess(
          request.requestId,
          this.services.agents.getProfile(request.payload.agentId),
        );
        return;
      case "copilot/recommendAgent": {
        const { task } = resolveTask(
          this.services.workflow,
          request.payload.workflowId!,
          request.payload.taskId!,
        );
        await this.sendSuccess(request.requestId, this.services.agents.recommend(task));
        return;
      }
      case "copilot/listKeystoneTools":
        await this.sendSuccess(request.requestId, this.services.toolRegistry.list());
        return;
      case "copilot/getToolStatus":
        await this.sendSuccess(
          request.requestId,
          this.services.toolRegistry.list().find((item) => item.name === request.payload.toolName),
        );
        return;
      case "copilot/getToolAudit":
        await this.sendSuccess(
          request.requestId,
          this.services.toolAudit.list().slice(-request.payload.limit),
        );
        return;
      case "copilot/testTool":
        await this.sendSuccess(
          request.requestId,
          await this.cancellableQuery(request.requestId, (signal) =>
            this.services.toolExecution.execute(
              request.payload.toolName,
              request.payload.input,
              signal,
            ),
          ),
        );
        return;
      case "copilot/prepareAssistedLaunch": {
        const { task } = resolveTask(
          this.services.workflow,
          request.payload.workflowId!,
          request.payload.taskId!,
        );
        const customizations = await this.services.customizations.discoverRecords(task);
        await this.sendSuccess(
          request.requestId,
          await this.services.assistedLaunch.prepare(
            request.payload.workflowId!,
            request.payload.taskId!,
            customizations,
            {
              ...(request.payload.selectedAgentId
                ? { selectedAgentId: request.payload.selectedAgentId }
                : {}),
              ...(request.payload.intendedAgentLabel
                ? { intendedAgentLabel: request.payload.intendedAgentLabel }
                : {}),
            },
          ),
        );
        return;
      }
      case "copilot/getPreparedPrompt":
        await this.sendSuccess(
          request.requestId,
          this.services.assistedLaunch.get(request.payload.launchId),
        );
        return;
      case "copilot/openChat":
        await this.sendSuccess(
          request.requestId,
          await this.services.assistedLaunch.open(request.payload.launchId),
        );
        return;
      case "copilot/copyPrompt":
        await this.sendSuccess(
          request.requestId,
          await this.services.assistedLaunch.copy(request.payload.launchId),
        );
        return;
      case "copilot/confirmSubmission":
        await this.sendSuccess(
          request.requestId,
          await this.services.assistedLaunch.confirm(request.payload.launchId),
        );
        return;
      case "copilot/cancelAssistedLaunch":
        await this.sendSuccess(
          request.requestId,
          await this.services.assistedLaunch.cancel(request.payload.launchId),
        );
        return;
      case "copilot/getParticipantStatus": {
        const capabilities = await this.services.integrationCapabilities.refresh();
        await this.sendSuccess(request.requestId, {
          available: capabilities.chatParticipantAvailable,
          enabled: this.services.copilotIntegrationStore.snapshot.settings.participantEnabled,
          ...(!capabilities.chatParticipantAvailable
            ? {
                limitation:
                  capabilities.limitations.find((item) => item.includes("participant")) ??
                  "Chat participant unavailable.",
              }
            : {}),
        });
        return;
      }
      case "copilot/openParticipant":
        await this.services.copilot.openCopilot();
        await this.sendSuccess(request.requestId, undefined);
        return;
      case "copilot/disableParticipant":
        await this.services.copilotIntegrationStore.update((state) => ({
          ...state,
          settings: { ...state.settings, participantEnabled: false },
        }));
        await this.sendSuccess(request.requestId, { enabled: false as const });
        return;
      case "build/selectAgent": {
        const agent = request.payload.agentId
          ? this.services.agents.getProfile(request.payload.agentId)
          : await this.services.agents.addUnverifiedAlias(request.payload.intendedAgentLabel!);
        if (!agent)
          throw new Error("The selected agent is not in the current evidence-backed registry.");
        await this.services.agents.selections.select(
          request.payload.taskId,
          agent,
          request.payload.confirmed,
        );
        const workflow = await this.services.workflow.assignAgent(
          request.payload.workflowId,
          request.payload.taskId,
          agent.id,
        );
        await this.sendWorkflow(
          request.requestId,
          workflow,
          agent.availability === "unknown"
            ? `Unverified intended agent ${agent.displayName} selected for assisted or clipboard use.`
            : `Agent ${agent.displayName} selected.`,
        );
        return;
      }
      case "context/build":
      case "context/regenerate":
      case "build/createContext":
      case "build/regenerateContext": {
        await this.postMessage(
          hostMessage("context/buildStarted", {
            taskId: request.payload.taskId,
            progress: 0,
            message: "Collecting bounded canonical context candidates.",
          }),
        );
        const context = await this.buildContext(
          request.payload.workflowId,
          request.payload.taskId,
          budgetTokens(request.payload.budget),
          request.payload.pinnedEntityIds,
          request.payload.pinnedFiles,
          request.requestId,
        );
        await this.postMessage(
          hostMessage("context/buildCompleted", {
            taskId: request.payload.taskId,
            contextPackageId: context.id,
            progress: 100,
            message: `Context built with ${context.items.length} included and ${context.exclusions.length} excluded items.`,
            fingerprint: context.contentFingerprint,
          }),
        );
        await this.sendSuccess(request.requestId, context);
        return;
      }
      case "context/get":
      case "build/getContext":
        await this.sendSuccess(
          request.requestId,
          this.services.context.get(request.payload.taskId),
        );
        return;
      case "context/update":
      case "build/updateContextItem":
        await this.sendSuccess(
          request.requestId,
          await this.services.context.restore(request.payload.taskId, request.payload.itemId),
        );
        return;
      case "context/removeItem":
      case "build/excludeContextItem":
        await this.sendSuccess(
          request.requestId,
          await this.services.context.remove(
            request.payload.taskId,
            request.payload.itemId,
            request.payload.overrideRequired,
          ),
        );
        return;
      case "context/pinItem":
      case "build/pinContextItem":
        await this.sendSuccess(
          request.requestId,
          await this.services.context.pin(request.payload.taskId, request.payload.itemId, true),
        );
        return;
      case "context/unpinItem":
        await this.sendSuccess(
          request.requestId,
          await this.services.context.pin(request.payload.taskId, request.payload.itemId, false),
        );
        return;
      case "context/addEntity": {
        const existing = this.services.context.get(request.payload.taskId);
        const context = await this.buildContext(
          request.payload.workflowId,
          request.payload.taskId,
          existing?.budget.requestedTokens,
          [
            ...(existing?.items
              .filter((item) => item.pinned && item.sourceReference.symbolId)
              .map((item) => item.sourceReference.symbolId!) ?? []),
            request.payload.entityId,
          ],
          existing?.items
            .filter((item) => item.pinned && item.sourceReference.filePath)
            .map((item) => item.sourceReference.filePath!),
          request.requestId,
        );
        await this.sendSuccess(request.requestId, context);
        return;
      }
      case "context/addFile": {
        const existing = this.services.context.get(request.payload.taskId);
        const context = await this.buildContext(
          request.payload.workflowId,
          request.payload.taskId,
          existing?.budget.requestedTokens,
          existing?.items
            .filter((item) => item.pinned && item.sourceReference.symbolId)
            .map((item) => item.sourceReference.symbolId!),
          [
            ...(existing?.items
              .filter((item) => item.pinned && item.sourceReference.filePath)
              .map((item) => item.sourceReference.filePath!) ?? []),
            request.payload.relativePath,
          ],
          request.requestId,
        );
        await this.sendSuccess(request.requestId, context);
        return;
      }
      case "context/changeBudget": {
        const existing = this.services.context.get(request.payload.taskId);
        const context = await this.buildContext(
          request.payload.workflowId,
          request.payload.taskId,
          budgetTokens(request.payload.budget),
          existing?.items
            .filter((item) => item.pinned && item.sourceReference.symbolId)
            .map((item) => item.sourceReference.symbolId!),
          existing?.items
            .filter((item) => item.pinned && item.sourceReference.filePath)
            .map((item) => item.sourceReference.filePath!),
          request.requestId,
        );
        await this.sendSuccess(request.requestId, context);
        return;
      }
      case "context/validate":
        await this.sendSuccess(
          request.requestId,
          await this.services.context.review(
            request.payload.taskId,
            request.payload.contentFingerprint,
          ),
        );
        return;
      case "delegation/prepare":
      case "build/prepareDelegation": {
        const context = this.services.context.get(request.payload.taskId);
        if (!context) throw new Error("Build and review context before preparing delegation.");
        const prepared = await this.services.delegation.prepare(
          request.payload.workflowId,
          request.payload.taskId,
          context,
          request.payload.userSections,
        );
        await this.postMessage(
          hostMessage("delegation/prepared", {
            taskId: request.payload.taskId,
            status: "awaiting-context-review",
            message: "Deterministic prompt prepared; explicit approval is required.",
          }),
        );
        await this.sendSuccess(request.requestId, prepared);
        return;
      }
      case "delegation/getPrompt":
      case "build/getPromptPreview":
        await this.sendSuccess(
          request.requestId,
          this.services.delegation.getPrepared(request.payload.taskId),
        );
        return;
      case "delegation/approve":
      case "build/approveDelegation":
        await this.sendSuccess(
          request.requestId,
          await this.services.delegation.approve(
            request.payload.taskId,
            request.payload.promptFingerprint,
            request.payload.contextFingerprint,
          ),
        );
        return;
      case "delegation/start":
      case "build/startDelegation": {
        const context = this.services.context.get(request.payload.taskId);
        if (!context) throw new Error("Reviewed context is required.");
        try {
          const session = await this.cancellableQuery(request.requestId, (signal) =>
            this.services.delegation.start(
              request.payload.workflowId,
              request.payload.taskId,
              context,
              request.payload.overlapOverride,
              signal,
            ),
          );
          await this.postMessage(
            hostMessage("delegation/started", {
              taskId: request.payload.taskId,
              sessionId: session.id,
              status: session.status,
              message: `Delegation entered ${session.mode} mode without claiming completion.`,
            }),
          );
          await this.sendSuccess(request.requestId, session);
          return;
        } catch (cause) {
          await this.postMessage(
            hostMessage("delegation/failed", {
              taskId: request.payload.taskId,
              status: "failed",
              message: cause instanceof Error ? cause.message : String(cause),
            }),
          );
          throw cause;
        }
      }
      case "delegation/openCopilot":
        await this.services.copilot.openCopilot();
        await this.sendSuccess(request.requestId);
        return;
      case "delegation/copyPrompt": {
        const prepared = this.services.delegation.getPrepared(request.payload.taskId);
        if (!prepared?.approved) throw new Error("Approve the exact prompt before copying it.");
        await this.services.copilot.copyPrompt(prepared.prompt);
        await this.sendSuccess(request.requestId);
        return;
      }
      case "delegation/confirmStarted":
      case "build/confirmAssistedState": {
        const session = await this.services.delegation.confirmStarted(
          request.payload.workflowId,
          request.payload.sessionId,
        );
        await this.postMessage(
          hostMessage("delegation/statusChanged", {
            taskId: session.taskId,
            sessionId: session.id,
            status: session.status,
            message: "External execution start was user-confirmed.",
          }),
        );
        await this.sendSuccess(request.requestId, session);
        return;
      }
      case "delegation/confirmStopped": {
        const session = await this.services.delegation.confirmStopped(request.payload.sessionId);
        await this.postMessage(
          hostMessage("delegation/statusChanged", {
            taskId: session.taskId,
            sessionId: session.id,
            status: session.status,
            message: "External execution stopped; completion remains unverified.",
          }),
        );
        await this.sendSuccess(request.requestId, session);
        return;
      }
      case "delegation/cancel":
      case "build/cancelDelegation": {
        const session = await this.services.delegation.cancel(
          request.payload.workflowId,
          request.payload.sessionId,
        );
        await this.postMessage(
          hostMessage("delegation/cancelled", {
            taskId: session.taskId,
            sessionId: session.id,
            status: session.status,
            message: "Keystone tracking cancelled; unsupported external work may continue.",
          }),
        );
        await this.sendSuccess(request.requestId, session);
        return;
      }
      case "delegation/status": {
        const session = this.services.delegation.sessions.get(request.payload.sessionId);
        if (session) {
          const refreshed = await this.services.delegation.refreshChanges(session.id);
          await this.sendSuccess(request.requestId, refreshed);
        } else await this.sendSuccess(request.requestId);
        return;
      }
      case "execution/start": {
        const session = await this.services.execution.start(
          request.payload.workflowId,
          request.payload.taskId,
          request.payload.delegationSessionId,
        );
        await this.postMessage(
          hostMessage("execution/statusChanged", {
            sessionId: session.id,
            taskId: session.taskId,
            status: session.status,
            message:
              "Execution session prepared from the persisted delegation baseline; explicit start remains required.",
          }),
        );
        await this.sendSuccess(request.requestId, session);
        return;
      }
      case "execution/list":
        await this.sendSuccess(request.requestId, this.services.execution.sessions.list());
        return;
      case "execution/get":
      case "build/getExecutionState":
        await this.sendSuccess(
          request.requestId,
          this.services.execution.get(request.payload.sessionId),
        );
        return;
      case "execution/confirmStarted": {
        const session = await this.services.execution.confirmStarted(request.payload.sessionId);
        await this.postMessage(
          hostMessage("execution/statusChanged", {
            sessionId: session.id,
            taskId: session.taskId,
            status: session.status,
            message: "Execution start explicitly confirmed.",
          }),
        );
        await this.sendSuccess(request.requestId, session);
        return;
      }
      case "execution/confirmStopped": {
        const session = await this.services.execution.confirmStopped(request.payload.sessionId);
        await this.postMessage(
          hostMessage("execution/statusChanged", {
            sessionId: session.id,
            taskId: session.taskId,
            status: session.status,
            message: "Execution stopped; result capture is required.",
          }),
        );
        await this.sendSuccess(request.requestId, session);
        return;
      }
      case "execution/cancel": {
        const session = await this.services.execution.cancel(request.payload.sessionId);
        await this.postMessage(
          hostMessage("execution/statusChanged", {
            sessionId: session.id,
            taskId: session.taskId,
            status: session.status,
            message: "Execution tracking cancelled; no completion claim was made.",
          }),
        );
        await this.sendSuccess(request.requestId, session);
        return;
      }
      case "execution/observeChanges":
      case "build/getRepositoryChanges":
      case "build/refreshChanges": {
        const session = await this.services.execution.observeChanges(request.payload.sessionId);
        await this.postMessage(
          hostMessage("execution/repositoryChanged", {
            sessionId: session.id,
            taskId: session.taskId,
            changeCount: session.observedChanges.length,
            message:
              "Repository changes observed and deterministically attributed; changes are not completion proof.",
          }),
        );
        await this.sendSuccess(request.requestId, session);
        return;
      }
      case "execution/attributeChange":
      case "build/updateChangeAttribution":
        await this.sendSuccess(
          request.requestId,
          await this.services.execution.attributeChange(
            request.payload.sessionId,
            request.payload.relativePath,
            request.payload.classification,
            request.payload.reason,
          ),
        );
        return;
      case "execution/captureResult": {
        const session = await this.services.execution.captureResult(
          request.payload.sessionId,
          request.payload,
          false,
        );
        await this.postMessage(
          hostMessage("execution/resultCaptured", {
            sessionId: session.id,
            taskId: session.taskId,
            mode: session.resultCapture!.mode,
            message: "Result captured as untrusted claims plus repository observations.",
            ...(session.postEditVerifierResult
              ? {
                  postEditVerifierResult: {
                    passed: session.postEditVerifierResult.passed,
                    verdict: session.postEditVerifierResult.verdict,
                    signals: session.postEditVerifierResult.signals.slice(0, 20),
                  },
                }
              : {}),
          }),
        );
        await this.sendSuccess(request.requestId, session);
        return;
      }
      case "validation/plan": {
        const plan = await this.services.validation.plan(request.payload.sessionId, {
          testMode: request.payload.testMode,
          excludedTestEntityIds: request.payload.excludedTestEntityIds,
        });
        await this.postMessage(
          hostMessage("validation/planned", {
            sessionId: plan.executionSessionId,
            planId: plan.id,
            stepCount: plan.steps.length,
            message:
              "Deterministic validation plan created from approved criteria, repository commands, changed entities, and evidence-ranked impacted tests.",
          }),
        );
        await this.sendSuccess(request.requestId, plan);
        return;
      }
      case "validation/getPlan":
      case "build/getValidationPlan":
        await this.sendSuccess(
          request.requestId,
          this.services.validation.getPlan(request.payload.planId),
        );
        return;
      case "validation/updatePlan":
        await this.sendSuccess(
          request.requestId,
          await this.services.validation.updatePlan(request.payload.planId, {
            testMode: request.payload.testMode,
            excludedTestEntityIds: request.payload.excludedTestEntityIds,
          }),
        );
        return;
      case "validation/approveCommand":
        await this.sendSuccess(
          request.requestId,
          await this.services.validation.approveCommand(
            request.payload.planId,
            request.payload.stepId,
          ),
        );
        return;
      case "validation/run":
      case "build/runValidation": {
        const plan = this.services.validation.getPlan(request.payload.planId);
        if (!plan) throw new Error("Validation plan not found.");
        const run = await this.services.validation.run(
          plan.id,
          (step, index, total, output) => {
            void this.postMessage(
              hostMessage("validation/progress", {
                sessionId: plan.executionSessionId,
                stepId: step.id,
                progress: total ? Math.round((index / total) * 100) : 0,
                message: step.description,
                ...(output ? { output } : {}),
              }),
            );
          },
          (runId) => {
            void this.postMessage(
              hostMessage("validation/started", {
                sessionId: plan.executionSessionId,
                planId: plan.id,
                runId,
                message:
                  "Safe managed validation started; the persisted run can be cancelled by ID.",
              }),
            );
          },
        );
        await this.postMessage(
          hostMessage("validation/completed", {
            sessionId: plan.executionSessionId,
            runId: run.id,
            status: run.status,
            message: "Validation completed; completion remains a separate explicit decision.",
          }),
        );
        await this.sendSuccess(request.requestId, run);
        return;
      }
      case "validation/cancel":
      case "build/cancelValidation":
        this.services.validation.cancel(request.payload.runId);
        await this.postMessage(
          hostMessage("validation/cancelled", {
            runId: request.payload.runId,
            message: "Validation cancellation requested.",
          }),
        );
        await this.sendSuccess(request.requestId);
        return;
      case "validation/getRun":
        await this.sendSuccess(
          request.requestId,
          this.services.validation.getRun(request.payload.runId),
        );
        return;
      case "build/getAcceptanceCriteriaState":
        await this.sendSuccess(
          request.requestId,
          this.services.validation.getRun(request.payload.runId)?.acceptanceCriteriaResults ?? [],
        );
        return;
      case "validation/rerunStep":
      case "build/rerunValidation":
        await this.sendSuccess(
          request.requestId,
          await this.services.validation.rerunStep(request.payload.runId, request.payload.stepId),
        );
        return;
      case "validation/override":
        await this.sendSuccess(
          request.requestId,
          await this.services.validation.override(
            request.payload.runId,
            request.payload.targetType,
            request.payload.targetId,
            request.payload.reason,
          ),
        );
        return;
      case "validation/manualEvidence":
      case "build/addManualEvidence":
        await this.sendSuccess(
          request.requestId,
          await this.services.validation.addManualEvidence(
            request.payload.runId,
            request.payload.criterionId,
            request.payload.statement,
          ),
        );
        return;
      case "retry/plan":
      case "build/prepareRetry":
      case "build/updateRetryAgent":
      case "retry/selectAgent":
      case "retry/manualRepair":
      case "retry/createRepairTask": {
        const plan = await this.services.execution.planRetry(
          request.payload.sessionId,
          request.payload.mode,
          request.payload.reason,
          request.payload.agentId,
        );
        await this.postMessage(
          hostMessage("retry/prepared", {
            sessionId: request.payload.sessionId,
            retryId: plan.id,
            message: "Focused repair context prepared; previous attempts remain immutable.",
          }),
        );
        await this.sendSuccess(request.requestId, plan);
        return;
      }
      case "retry/buildContext":
      case "retry/prepare":
      case "build/approveRetry":
        await this.sendSuccess(
          request.requestId,
          this.services.execution.getRetry(request.payload.sessionId),
        );
        return;
      case "retry/start":
      case "build/startRetry": {
        const session = await this.services.execution.startRetry(request.payload.sessionId);
        const plan = this.services.execution.getRetry(request.payload.sessionId)!;
        await this.postMessage(
          hostMessage("retry/started", {
            sessionId: session.id,
            retryId: plan.id,
            message:
              "Retry execution session created from reduced repair context; explicit start remains required.",
          }),
        );
        await this.sendSuccess(request.requestId, session);
        return;
      }
      case "completion/evaluate":
      case "build/getCompletionReadiness":
      case "build/requestCompletionReview": {
        const decision = this.services.completion.evaluate(request.payload.sessionId);
        await this.postMessage(
          hostMessage("completion/readinessChanged", {
            sessionId: request.payload.sessionId,
            status: decision.status,
            blockers: decision.blockers.length,
            message: "Completion evaluated only from current validation and repository evidence.",
          }),
        );
        await this.sendSuccess(request.requestId, decision);
        return;
      }
      case "completion/completeTask":
      case "completion/acceptWithOverride": {
        const result = await this.services.completion.complete(
          request.payload.sessionId,
          request.payload.confirm,
          request.payload.overrideReason,
        );
        const session = this.services.execution.get(request.payload.sessionId)!;
        await this.postMessage(
          hostMessage("completion/taskCompleted", {
            sessionId: session.id,
            taskId: session.taskId,
            message: "Task explicitly completed from validation evidence.",
          }),
        );
        if (result.unlockedTaskIds.length)
          await this.postMessage(
            hostMessage("completion/dependenciesUnlocked", {
              taskIds: result.unlockedTaskIds,
              message: "Dependencies satisfied; tasks unlocked but were not delegated.",
            }),
          );
        if (result.report)
          await this.postMessage(
            hostMessage("completion/workflowCompleted", {
              workflowId: result.report.workflowId,
              reportId: result.report.id,
              message: "All tasks completed; local workflow report generated without PR or push.",
            }),
          );
        await this.sendSuccess(request.requestId, result);
        return;
      }
      case "review/getState":
        await this.sendSuccess(
          request.requestId,
          this.services.review.getState(request.payload.workflowId),
        );
        return;
      case "review/getSummary":
        await this.sendSuccess(
          request.requestId,
          this.services.review.getState(request.payload.workflowId).summary,
        );
        return;
      case "review/getTraceability":
        await this.sendSuccess(
          request.requestId,
          this.services.review.getState(request.payload.workflowId).traceability,
        );
        return;
      case "review/getChanges":
        await this.sendSuccess(
          request.requestId,
          this.services.review.getState(request.payload.workflowId).changes,
        );
        return;
      case "review/getQa":
        await this.sendSuccess(
          request.requestId,
          this.services.review
            .getState(request.payload.workflowId)
            .findings.filter((item) => item.source === "qa"),
        );
        return;
      case "review/getSecurity":
        await this.sendSuccess(
          request.requestId,
          this.services.review
            .getState(request.payload.workflowId)
            .findings.filter((item) => item.source === "security"),
        );
        return;
      case "review/getPerformance":
        await this.sendSuccess(
          request.requestId,
          this.services.review
            .getState(request.payload.workflowId)
            .findings.filter((item) => item.source === "performance"),
        );
        return;
      case "review/getDocumentation":
        await this.sendSuccess(
          request.requestId,
          this.services.review
            .getState(request.payload.workflowId)
            .findings.filter((item) => item.source === "documentation"),
        );
        return;
      case "review/getDiff": {
        await this.sendSuccess(
          request.requestId,
          await this.services.repository.getDiff(request.payload.path),
        );
        return;
      }
      case "review/attributeChange": {
        const session = this.services.execution.sessions
          .list()
          .filter(
            (item) =>
              item.workflowId === request.payload.workflowId &&
              item.observedChanges.some((change) => change.relativePath === request.payload.path),
          )
          .at(-1);
        if (!session)
          throw new Error("No retained task-attributed execution change matches this path.");
        const value = await this.services.execution.attributeChange(
          session.id,
          request.payload.path,
          request.payload.classification,
          request.payload.reason,
        );
        await this.publishReviewEvent(
          "review/stateChanged",
          request.payload.workflowId,
          `Change ${request.payload.path} marked ${request.payload.classification} by the reviewer.`,
        );
        await this.sendSuccess(request.requestId, value);
        return;
      }
      case "review/addNote": {
        const note = await this.services.review.addNote(request.payload);
        await this.publishReviewEvent(
          "review/noteChanged",
          request.payload.workflowId,
          "Review note added.",
        );
        await this.sendSuccess(request.requestId, note);
        return;
      }
      case "review/updateNote": {
        const note = await this.services.review.updateNote(
          request.payload.workflowId,
          request.payload.noteId,
          request.payload.text,
          request.payload.blocking,
        );
        await this.publishReviewEvent(
          "review/noteChanged",
          request.payload.workflowId,
          "Review note updated.",
        );
        await this.sendSuccess(request.requestId, note);
        return;
      }
      case "review/resolveNote": {
        const note = await this.services.review.resolveNote(
          request.payload.workflowId,
          request.payload.noteId,
          request.payload.resolution,
        );
        await this.publishReviewEvent(
          "review/noteChanged",
          request.payload.workflowId,
          "Review note resolved.",
        );
        await this.sendSuccess(request.requestId, note);
        return;
      }
      case "review/dispositionFinding": {
        const value = await this.services.review.disposition(
          request.payload.workflowId,
          request.payload.findingId,
          request.payload.disposition,
          request.payload.reason,
          request.payload.scope,
        );
        await this.publishReviewEvent(
          "review/stateChanged",
          request.payload.workflowId,
          "Finding disposition recorded with explicit user approval.",
        );
        await this.sendSuccess(request.requestId, value);
        return;
      }
      case "review/requestChanges":
      case "review/returnToBuild":
      case "review/returnToDefine": {
        const value = await this.services.review.requestChanges(request.payload);
        await this.publishReviewEvent(
          "review/changesRequested",
          request.payload.workflowId,
          request.type === "review/returnToDefine"
            ? "Review returned to Define with retained history."
            : "Review returned to Build with retained history.",
        );
        await this.sendSuccess(request.requestId, value);
        return;
      }
      case "review/createFollowUpTask": {
        const value = await this.services.review.createFollowUp(request.payload);
        await this.publishReviewEvent(
          "review/changesRequested",
          request.payload.workflowId,
          "Follow-up task created from Review.",
        );
        await this.sendSuccess(request.requestId, value);
        return;
      }
      case "review/getReadiness": {
        const value = this.services.review.getState(request.payload.workflowId);
        await this.sendSuccess(request.requestId, {
          ready: value.readinessBlockers.length === 0,
          blockers: value.readinessBlockers,
          warnings: value.warnings,
        });
        return;
      }
      case "review/getPrChecklist":
        await this.sendSuccess(
          request.requestId,
          this.services.review.getState(request.payload.workflowId).checklist,
        );
        return;
      case "taskHandoff/checkEligibility": {
        const svc = this.requireTaskHandoff();
        await this.sendSuccess(request.requestId, svc.checkEligibility(request.payload.workflowId));
        return;
      }
      case "taskHandoff/createDraft": {
        const svc = this.requireTaskHandoff();
        await this.sendSuccess(request.requestId, await svc.createDraft(request.payload.workflowId));
        return;
      }
      case "taskHandoff/updateDraft": {
        const svc = this.requireTaskHandoff();
        await this.sendSuccess(request.requestId, await svc.updateDraft(request.payload.workflowId, request.payload.handoffId, request.payload));
        return;
      }
      case "taskHandoff/runPrivacyScan": {
        const svc = this.requireTaskHandoff();
        await this.sendSuccess(request.requestId, svc.runPrivacyScan(request.payload.handoffId));
        return;
      }
      case "taskHandoff/markRedacted": {
        const svc = this.requireTaskHandoff();
        await this.sendSuccess(request.requestId, svc.markRedacted(request.payload.handoffId, request.payload.findingId));
        return;
      }
      case "taskHandoff/export": {
        const svc = this.requireTaskHandoff();
        await this.sendSuccess(request.requestId, await svc.exportPackage(request.payload.handoffId, request.payload.expectedRevision, request.payload.targetPath));
        return;
      }
      case "taskHandoff/listHistory": {
        const svc = this.requireTaskHandoff();
        await this.sendSuccess(request.requestId, svc.listHistory(request.payload.workflowId));
        return;
      }
      case "taskHandoff/previewImport": {
        const svc = this.requireTaskHandoff();
        await this.sendSuccess(request.requestId, svc.previewImport(request.payload.rawContent));
        return;
      }
      case "taskHandoff/acceptImport": {
        const svc = this.requireTaskHandoff();
        await this.sendSuccess(request.requestId, await svc.acceptImport(request.payload.rawContent, request.payload.receiverLabel, request.payload.receiverNotes));
        return;
      }
      case "taskHandoff/rejectImport": {
        const svc = this.requireTaskHandoff();
        await this.sendSuccess(request.requestId, svc.rejectImport(request.payload.rawContent));
        return;
      }
      // Phase 10 — Evidence-Backed PR Review (deterministic; no git/PR writes).
      case "pr-review/prepare": {
        const svc = this.requirePrReview();
        await this.sendSuccess(request.requestId, await svc.prepare(request.payload.workflowId, request.payload.overrideChangeSet, request.payload.confirmPartial));
        return;
      }
      case "pr-review/getState": {
        const svc = this.requirePrReview();
        await this.sendSuccess(request.requestId, svc.persisted);
        return;
      }
      case "pr-review/getFindings": {
        const svc = this.requirePrReview();
        const review = svc.getReview(request.payload.workflowId);
        await this.sendSuccess(request.requestId, svc.getFindings(review.id));
        return;
      }
      case "pr-review/updateFindingStatus": {
        const svc = this.requirePrReview();
        await this.sendSuccess(
          request.requestId,
          await svc.updateFindingStatus(
            request.payload.workflowId,
            request.payload.findingId,
            request.payload.status,
            request.payload.resolutionEvidence,
            request.payload.justification,
          ),
        );
        return;
      }
      case "pr-review/calculateReadiness": {
        const svc = this.requirePrReview();
        await this.sendSuccess(request.requestId, svc.calculateReadiness(request.payload.workflowId));
        return;
      }
      case "pr-review/approveReadiness": {
        const svc = this.requirePrReview();
        await this.sendSuccess(request.requestId, await svc.approveReadiness(request.payload.workflowId, request.payload.decision, request.payload.reason));
        return;
      }
      case "pr-review/generatePackage": {
        const svc = this.requirePrReview();
        await this.sendSuccess(request.requestId, svc.generatePackage(request.payload.workflowId));
        return;
      }
      case "pr-review/updatePackage": {
        const svc = this.requirePrReview();
        await this.sendSuccess(request.requestId, await svc.updatePackage(request.payload.workflowId, request.payload.title, request.payload.description));
        return;
      }
      case "review/approve":
      case "review/approveWithWarnings":
      case "review/reject": {
        const value =
          request.type === "review/reject"
            ? await this.services.review.reject(request.payload.workflowId, request.payload.reason)
            : await this.services.review.approve(
                request.payload.workflowId,
                request.payload.reason,
                request.type === "review/approveWithWarnings",
              );
        await this.publishReviewEvent(
          request.type === "review/reject" ? "review/changesRequested" : "review/approved",
          request.payload.workflowId,
          `Review decision recorded: ${value.status}.`,
        );
        await this.sendSuccess(request.requestId, value);
        return;
      }
      case "complete/getState":
        await this.sendSuccess(
          request.requestId,
          await this.services.review.getCompletionState(request.payload.workflowId),
        );
        return;
      case "complete/getOptions":
        await this.sendSuccess(
          request.requestId,
          (await this.services.review.getCompletionState(request.payload.workflowId)).options,
        );
        return;
      case "complete/getReport":
        await this.sendSuccess(
          request.requestId,
          this.services.review.persisted.completions.find(
            (item) => item.workflowId === request.payload.workflowId,
          ),
        );
        return;
      case "complete/completeLocally":
      case "complete/closePartial":
      case "complete/cancelWithChanges": {
        const mode =
          request.type === "complete/completeLocally"
            ? "local"
            : request.type === "complete/closePartial"
              ? "closed-partial"
              : "cancelled-with-changes";
        const value = await this.services.review.complete(
          request.payload.workflowId,
          mode,
          request.payload.reason,
        );
        await this.publishReviewEvent(
          request.type === "complete/closePartial"
            ? "complete/workflowClosedPartial"
            : "complete/workflowCompleted",
          request.payload.workflowId,
          `Workflow recorded as ${value.status}; repository files were not mutated.`,
        );
        await this.sendSuccess(request.requestId, value);
        return;
      }
      case "complete/archive": {
        const value = await this.services.review.archive(request.payload.workflowId);
        await this.publishReviewEvent(
          "complete/workflowCompleted",
          request.payload.workflowId,
          "Completed workflow archived.",
        );
        await this.sendSuccess(request.requestId, value);
        return;
      }
      case "completion/getWorkflowReport":
        await this.sendSuccess(
          request.requestId,
          this.services.workflowCompletion.get(request.payload.workflowId),
        );
        return;
      case "git/capabilities":
      case "git/refresh":
      case "git/status":
        await this.sendSuccess(
          request.requestId,
          await this.services.repository.getStatus(),
        );
        return;
      case "git/repositoryState":
        await this.sendSuccess(
          request.requestId,
          await this.services.repository.getStatus(),
        );
        return;
      case "git/remotes":
        await this.sendSuccess(
          request.requestId,
          (await this.services.repository.getRepositoryIdentity()).sanitizedRemoteUrl,
        );
        return;
      case "git/branches": {
        const identity = await this.services.repository.getRepositoryIdentity();
        await this.sendSuccess(request.requestId, {
          current: identity.branch,
          detached: identity.branch === undefined,
        });
        return;
      }
      case "git/identity": {
        await this.sendSuccess(request.requestId, await this.services.repository.getRepositoryIdentity());
        return;
      }
      case "git/history": {
        await this.sendSuccess(
          request.requestId,
          await this.services.repository.getHistory({ limit: request.payload.limit ?? 50 }),
        );
        return;
      }
      case "git/diff":
      case "build/getDiff": {
        await this.sendSuccess(
          request.requestId,
          await this.services.repository.getDiff(request.payload.path),
        );
        return;
      }
      case "orchestration/create": {
        const value = await this.services.orchestration.create(
          request.payload.workflowId,
          request.payload.policyProfileId,
          request.payload.definitionId,
        );
        await this.orchestrationEvent(
          "orchestration/created",
          value,
          "Orchestration instance created from approved workflow state.",
        );
        await this.sendSuccess(request.requestId, value);
        return;
      }
      case "orchestration/get":
      case "orchestration/status":
        await this.sendSuccess(
          request.requestId,
          this.services.orchestration.get(request.payload.orchestrationId),
        );
        return;
      case "orchestration/list":
        await this.sendSuccess(request.requestId, this.services.orchestration.list());
        return;
      case "orchestration/definitions":
        await this.sendSuccess(request.requestId, this.services.orchestration.definitions.list());
        return;
      case "orchestration/policies":
        await this.sendSuccess(request.requestId, this.services.orchestration.policies.list());
        return;
      case "orchestration/plan": {
        const value = await this.services.orchestration.plan(request.payload.orchestrationId);
        await this.orchestrationEvent(
          "orchestration/planned",
          value,
          "Executable plan generated; execution remains blocked pending approval.",
        );
        await this.sendSuccess(request.requestId, value);
        return;
      }
      case "orchestration/validatePlan": {
        const value = this.services.orchestration.get(request.payload.orchestrationId);
        await this.sendSuccess(request.requestId, {
          valid: Boolean(
            value?.plan &&
            value.taskStates.length &&
            !value.diagnostics.some((item) => item.severity === "error"),
          ),
          blockers: value?.diagnostics
            .filter((item) => item.severity === "error")
            .map((item) => item.message) ?? ["Orchestration instance was not found."],
          warnings:
            value?.diagnostics
              .filter((item) => item.severity === "warning")
              .map((item) => item.message) ?? [],
        });
        return;
      }
      case "orchestration/start": {
        const value = await this.services.orchestration.start(request.payload.orchestrationId);
        await this.orchestrationEvent(
          "orchestration/started",
          value,
          "Approved orchestration workflow started.",
        );
        await this.sendSuccess(request.requestId, value);
        return;
      }
      case "orchestration/pause": {
        const value = await this.services.orchestration.pause(request.payload.orchestrationId);
        await this.orchestrationEvent(
          "orchestration/paused",
          value,
          "Workflow paused with evidence preserved.",
        );
        await this.sendSuccess(request.requestId, value);
        return;
      }
      case "orchestration/resume": {
        const value = await this.services.orchestration.resume(
          request.payload.orchestrationId,
          request.payload,
        );
        await this.orchestrationEvent(
          "orchestration/resumed",
          value,
          "Workflow resume reconciliation completed.",
        );
        await this.sendSuccess(request.requestId, value);
        return;
      }
      case "orchestration/cancel": {
        const value = await this.services.orchestration.cancel(request.payload.orchestrationId);
        await this.orchestrationEvent(
          "orchestration/cancelled",
          value,
          "Workflow cancelled without deleting user or Git changes.",
        );
        await this.sendSuccess(request.requestId, value);
        return;
      }
      case "orchestration/recover": {
        const value = await this.services.orchestration.recover(
          request.payload.orchestrationId,
          request.payload,
        );
        await this.orchestrationEvent(
          "orchestration/recovered",
          value,
          "Persisted state reconciled; interrupted work was not inferred complete.",
        );
        await this.sendSuccess(request.requestId, value);
        return;
      }
      case "orchestration/taskReadiness":
        await this.sendSuccess(
          request.requestId,
          this.services.orchestration.taskReadiness(
            request.payload.orchestrationId,
            request.payload.taskId,
          ),
        );
        return;
      case "orchestration/startTask": {
        const value = await this.services.orchestration.startTask(
          request.payload.orchestrationId,
          request.payload.taskId,
        );
        await this.orchestrationEvent(
          "orchestration/taskStarted",
          value,
          "Task started after readiness validation.",
          request.payload.taskId,
        );
        await this.sendSuccess(request.requestId, value);
        return;
      }
      case "orchestration/pauseTask": {
        const value = await this.services.orchestration.pauseTask(
          request.payload.orchestrationId,
          request.payload.taskId,
          request.payload.reason,
        );
        await this.orchestrationEvent(
          "orchestration/taskBlocked",
          value,
          "Task paused with state preserved.",
          request.payload.taskId,
        );
        await this.sendSuccess(request.requestId, value);
        return;
      }
      case "orchestration/cancelTask": {
        const value = await this.services.orchestration.cancelTask(
          request.payload.orchestrationId,
          request.payload.taskId,
          request.payload.reason,
        );
        await this.orchestrationEvent(
          "orchestration/taskProgress",
          value,
          "Task cancelled without deleting repository changes.",
          request.payload.taskId,
        );
        await this.sendSuccess(request.requestId, value);
        return;
      }
      case "orchestration/retryTask": {
        const value = await this.services.orchestration.retryTask(
          request.payload.orchestrationId,
          request.payload.taskId,
          request.payload.reason,
          request.payload.agentId,
        );
        await this.orchestrationEvent(
          "orchestration/taskProgress",
          value,
          "Bounded retry planned; no delegation started automatically.",
          request.payload.taskId,
        );
        await this.sendSuccess(request.requestId, value);
        return;
      }
      case "orchestration/changeAgent": {
        if (!request.payload.agentId) throw new Error("An explicit agent ID is required.");
        const value = await this.services.orchestration.changeAgent(
          request.payload.orchestrationId,
          request.payload.taskId,
          request.payload.agentId,
          request.payload.reason,
        );
        await this.orchestrationEvent(
          "orchestration/taskProgress",
          value,
          "Agent changed; context review was invalidated.",
          request.payload.taskId,
        );
        await this.sendSuccess(request.requestId, value);
        return;
      }
      case "orchestration/skipOptionalTask":
        this.services.orchestration.skipOptionalTask();
        return;
      case "orchestration/schedule":
      case "orchestration/conflicts":
        await this.sendSuccess(
          request.requestId,
          this.services.orchestration.schedule(request.payload.orchestrationId),
        );
        return;
      case "orchestration/approvals":
        await this.sendSuccess(
          request.requestId,
          this.services.orchestration.get(request.payload.orchestrationId)?.approvalGates ?? [],
        );
        return;
      case "orchestration/approve":
      case "orchestration/reject":
      case "orchestration/requestChanges":
      case "orchestration/override": {
        const decision =
          request.type === "orchestration/approve"
            ? "approved"
            : request.type === "orchestration/reject"
              ? "rejected"
              : request.type === "orchestration/requestChanges"
                ? "changes-requested"
                : "overridden";
        const value = await this.services.orchestration.decide(
          request.payload.orchestrationId,
          request.payload.gateId,
          decision,
          request.payload.reason,
          request.payload.riskAcknowledged,
        );
        await this.orchestrationEvent(
          "orchestration/approvalResolved",
          value,
          `Approval gate ${decision}.`,
        );
        await this.sendSuccess(request.requestId, value);
        return;
      }
      case "orchestration/audit":
        await this.sendSuccess(
          request.requestId,
          this.services.orchestration.get(request.payload.orchestrationId)?.audit ?? [],
        );
        return;
      case "orchestration/qaPlan":
      case "orchestration/qaRun":
        await this.sendSuccess(
          request.requestId,
          this.services.orchestration.reviewPlan(request.payload.orchestrationId, "qa"),
        );
        return;
      case "orchestration/securityPlan":
      case "orchestration/securityRun":
        await this.sendSuccess(
          request.requestId,
          this.services.orchestration.reviewPlan(request.payload.orchestrationId, "security"),
        );
        return;
      case "orchestration/performancePlan":
      case "orchestration/performanceRun":
        await this.sendSuccess(
          request.requestId,
          this.services.orchestration.reviewPlan(request.payload.orchestrationId, "performance"),
        );
        return;
      case "orchestration/validationPlan":
      case "orchestration/runValidation":
      case "orchestration/rerunValidation":
        await this.sendSuccess(
          request.requestId,
          this.services.orchestration.reviewPlan(request.payload.orchestrationId, "validation"),
        );
        return;
      case "orchestration/cancelValidation":
        await this.sendSuccess(request.requestId);
        return;
      case "orchestration/qaAccept":
      case "orchestration/securityAccept":
      case "orchestration/performanceAccept": {
        const value = await this.services.orchestration.resolveFinding(
          request.payload.orchestrationId,
          request.payload.findingId,
          "accepted",
          request.payload.reason,
        );
        await this.sendSuccess(request.requestId, value);
        return;
      }
      case "orchestration/qaReturn": {
        const value = await this.services.orchestration.resolveFinding(
          request.payload.orchestrationId,
          request.payload.findingId,
          "rejected",
          request.payload.reason,
        );
        await this.sendSuccess(request.requestId, value);
        return;
      }
      case "orchestration/qaFinding":
      case "orchestration/securityFinding":
      case "orchestration/performanceFinding": {
        const value = this.services.orchestration.get(request.payload.orchestrationId);
        if (!value) throw new Error("Orchestration instance not found.");
        await this.sendSuccess(request.requestId, value);
        return;
      }
      case "orchestration/metrics":
        await this.sendSuccess(
          request.requestId,
          this.services.orchestration.get(request.payload.orchestrationId)?.metrics ?? {
            workflowDurationMs: 0,
            waitingForUserMs: 0,
            delegationCount: 0,
            validationDurationMs: 0,
            retryCount: 0,
            staleCount: 0,
            cancellationCount: 0,
            approvalCount: 0,
          },
        );
        return;
      case "orchestration/report": {
        const value = this.services.orchestration.get(request.payload.orchestrationId);
        if (!value) throw new Error("Orchestration instance not found.");
        await this.sendSuccess(request.requestId, value);
        return;
      }
      case "execution/route":
        await this.sendSuccess(request.requestId, this.services.routing.decide(request.payload));
        return;
      case "request/cancel":
        this.queryControllers.get(request.payload.targetRequestId)?.abort();
        await this.sendSuccess(request.requestId);
        return;
    }
  }

  private requireNativeShell(): NonNullable<IntelligenceServiceRegistry["nativeShell"]> {
    if (!this.services.nativeShell)
      throw new Error("The Keystone native shell has not finished initializing.");
    return this.services.nativeShell;
  }

  private ensureWorkspaceTrust(request: WebviewRequest): void {
    // Production always supplies the trust provider. Treat an omitted provider in
    // isolated read-only harnesses as trusted for backwards-compatible tests.
    if (this.services.workspaceTrusted?.() !== false) return;
    const blocked = new Set<WebviewRequest["type"]>([
      "delegation/approve",
      "delegation/start",
      "delegation/openCopilot",
      "delegation/copyPrompt",
      "delegation/confirmStarted",
      "execution/start",
      "execution/confirmStarted",
      "execution/captureResult",
      "retry/start",
      "retry/manualRepair",
      "validation/approveCommand",
      "validation/run",
      "validation/rerunStep",
      "validation/override",
      "orchestration/start",
      "orchestration/startTask",
      "orchestration/retryTask",
      "workbench/createWorkflow",
      "build/startTask",
      "build/resumeTask",
      "build/approveDelegation",
      "build/startDelegation",
      "build/confirmAssistedState",
      "build/runValidation",
      "build/rerunValidation",
      "build/startRetry",
    ]);
    if (!blocked.has(request.type)) return;
    if (!blocked.has(request.type)) return;
    throw new KeystoneError({
      code: "WORKSPACE_TRUST_REQUIRED",
      category: "WORKSPACE",
      message:
        "Keystone blocked an executable, external-delegation, or repository-mutating action in Restricted Mode.",
      operation: request.type,
      recoverable: true,
      recommendedAction:
        "Trust the workspace after reviewing its contents, then retry the explicitly approved action.",
      retryable: true,
      correlationId: request.requestId,
    });
  }
  private async orchestrationEvent(
    type:
      | "orchestration/created"
      | "orchestration/planned"
      | "orchestration/started"
      | "orchestration/paused"
      | "orchestration/resumed"
      | "orchestration/cancelled"
      | "orchestration/recovered"
      | "orchestration/approvalResolved"
      | "orchestration/taskStarted"
      | "orchestration/taskBlocked"
      | "orchestration/taskProgress",
    value: WorkflowInstance,
    message: string,
    taskId?: string,
  ): Promise<void> {
    await this.postMessage(
      hostMessage(type, {
        orchestrationId: value.id,
        status: value.status,
        ...(value.currentStage ? { stage: value.currentStage } : {}),
        ...(taskId ? { taskId } : {}),
        message,
        at: new Date().toISOString(),
      }),
    );
  }

  private async sendWorkflow(
    requestId: string,
    workflow: DevelopmentWorkflowSnapshot,
    message: string,
  ): Promise<void> {
    await this.postMessage(hostMessage("workflow/updated", workflowEvent(workflow, message)));
    await this.sendSuccess(requestId, workflow);
  }

  private async sendWorkbenchWorkflow(
    requestId: string,
    workflow: DevelopmentWorkflowSnapshot,
    type:
      | "workbench/workflowChanged"
      | "workbench/intentChanged"
      | "workbench/clarificationChanged"
      | "workbench/specificationGenerated"
      | "workbench/specificationApproved"
      | "workbench/taskPlanGenerated"
      | "workbench/taskPlanChanged"
      | "workbench/taskPlanApproved",
    message: string,
  ): Promise<void> {
    const state = this.services.workflow.getWorkbenchState(workflow.id);
    await this.postMessage(
      hostMessage(type, workbenchEvent(workflow, state.summary.currentStage, message)),
    );
    await this.postMessage(
      hostMessage(
        "workbench/stageStateChanged",
        workbenchEvent(
          workflow,
          state.summary.currentStage,
          "Workbench readiness recalculated from canonical workflow state.",
        ),
      ),
    );
    await this.sendSuccess(requestId, workflow);
  }

  private async reconcileDelegationState(generation: number): Promise<void> {
    for (const current of this.services.workflow.list()) {
      try {
        const workflow = await this.services.workflow.reconcileStaleness(current.id);
        const staleTasks = workflow.tasks.filter((task) => task.status === "stale");
        for (const task of staleTasks) {
          if (this.services.context.get(task.id))
            await this.services.context.invalidate(
              task.id,
              `Intelligence generation ${generation} changed relevant task inputs.`,
            );
          await this.services.delegation.invalidate(
            task.id,
            `Intelligence generation ${generation} changed relevant task inputs.`,
          );
          await this.postMessage(
            hostMessage("context/invalidated", {
              taskId: task.id,
              message:
                "Relevant repository intelligence changed; context and prompt approval were invalidated.",
            }),
          );
        }
        await this.postMessage(
          hostMessage(
            workflow.status === "stale" ? "workflow/stale" : "workflow/updated",
            workflowEvent(
              workflow,
              workflow.status === "stale"
                ? "Repository intelligence changed relevant approved work."
                : "Workflow reconciled against the new intelligence generation.",
            ),
          ),
        );
      } catch (cause) {
        this.logger.error(KeystoneError.fromUnknown(cause, "workflow.reconcile.generation"));
      }
    }
  }

  private async invalidatePreparedDelegations(reason: string): Promise<void> {
    for (const workflow of this.services.workflow.list())
      for (const task of workflow.tasks)
        if (this.services.delegation.getPrepared(task.id))
          await this.services.delegation.invalidate(task.id, reason);
  }

  private async buildContext(
    workflowId: string,
    taskId: string,
    budgetTokens: number | undefined,
    pinnedEntityIds: string[] | undefined,
    pinnedFiles: string[] | undefined,
    requestId: string,
  ) {
    const { task, specification } = resolveTask(this.services.workflow, workflowId, taskId);
    const controller = new AbortController();
    this.queryControllers.set(requestId, controller);
    try {
      await this.postMessage(
        hostMessage("context/buildProgress", {
          taskId,
          progress: 30,
          message: "Ranking repository entities, tests, relationships, and source ranges.",
        }),
      );
      return await this.services.context.build({
        task,
        specification,
        selectedAgentId: task.assignedAgentId,
        budget: budgetTokens ? { maxEstimatedTokens: budgetTokens } : undefined,
        pinnedEntityIds,
        pinnedFiles,
        currentFile: this.services.currentEditor?.(),
        currentSelection: this.services.currentSelection?.(),
        signal: controller.signal,
      });
    } finally {
      this.queryControllers.delete(requestId);
    }
  }

  private async sendSuccess(requestId: string, data?: unknown): Promise<void> {
    const response = hostMessage("response/success", {
      requestId,
      ...(data === undefined ? {} : { data }),
    });
    this.remember(requestId, response);
    await this.postMessage(response);
  }

  private async publishReviewEvent(
    type:
      | "review/stateChanged"
      | "review/noteChanged"
      | "review/changesRequested"
      | "review/approved"
      | "review/stale"
      | "complete/optionsChanged"
      | "complete/handoffPrepared"
      | "complete/workflowCompleted"
      | "complete/workflowClosedPartial",
    workflowId: string,
    message: string,
  ): Promise<void> {
    const state = this.services.review.getState(workflowId);
    await this.postMessage(
      hostMessage(type, {
        workflowId,
        specificationRevision: state.summary.specificationRevision,
        repositoryFingerprint: state.repositoryFingerprint,
        message,
        at: new Date().toISOString(),
      }),
    );
  }

  private requireCurrentApprovedReview(workflowId: string, fingerprint: string) {
    const review = this.services.review.getState(workflowId);
    if (
      !review.summary.completionReady ||
      !review.decision ||
      !["approved", "approved-with-warnings"].includes(review.decision.status)
    )
      throw new Error("A current approved Review with no blocking findings is required.");
    if (review.repositoryFingerprint !== fingerprint)
      throw new Error(
        "Repository evidence changed after Review. Refresh, revalidate affected work, and approve Review again.",
      );
    return review;
  }

  private async cancellableQuery<T>(
    requestId: string,
    query: (signal: AbortSignal) => Promise<T>,
  ): Promise<T> {
    const controller = new AbortController();
    this.queryControllers.set(requestId, controller);
    try {
      return await query(controller.signal);
    } finally {
      this.queryControllers.delete(requestId);
    }
  }

  private async runUnifiedQuery(
    requestId: string,
    payload: { text?: string; query?: IntelligenceQuery; currentFile?: string },
  ): Promise<Awaited<ReturnType<IntelligenceQueryService["unified"]>>> {
    const operation = payload.query?.operation;
    await this.postMessage(
      hostMessage("intelligence/queryStarted", {
        queryId: requestId,
        ...(operation ? { operation } : {}),
        message: "Deterministic intelligence query started.",
      }),
    );
    await this.postMessage(
      hostMessage("intelligence/queryProgress", {
        queryId: requestId,
        ...(operation ? { operation } : {}),
        progress: 10,
        message: "Resolving generation and seed entities.",
      }),
    );
    try {
      const result = await this.cancellableQuery(requestId, (signal) =>
        this.services.intelligenceQuery.unified(payload, signal, requestId),
      );
      this.lastQueryGeneration = result.generation;
      await this.postMessage(
        hostMessage("intelligence/queryCompleted", {
          queryId: requestId,
          operation: result.operation,
          generation: result.generation,
          progress: 100,
          message: `Query completed in ${result.executionTimeMs.toFixed(1)} ms.`,
        }),
      );
      return result;
    } catch (cause) {
      if (cause instanceof Error && cause.name === "AbortError")
        await this.postMessage(
          hostMessage("intelligence/queryCancelled", {
            queryId: requestId,
            ...(operation ? { operation } : {}),
            message: "Query cancelled.",
          }),
        );
      else
        await this.postMessage(
          hostMessage("intelligence/queryFailed", {
            queryId: requestId,
            ...(operation ? { operation } : {}),
            message: cause instanceof Error ? cause.message : String(cause),
          }),
        );
      throw cause;
    }
  }

  private requireDevelopmentHost(): VsCodeDevelopmentAdapter {
    if (!this.services.developmentHost) throw new DevelopmentServiceError("file-outside-workspace", "Development source scope requires an open file-backed workspace.");
    return this.services.developmentHost;
  }

  private requireDevelopmentScope(): SourceScopeService {
    if (!this.services.developmentScope) throw new DevelopmentServiceError("file-outside-workspace", "Development source scope requires an open file-backed workspace.");
    return this.services.developmentScope;
  }

  private requireTaskHandoff(): import("../../core/handoff/TaskHandoffService").TaskHandoffService {
    if (!this.services.taskHandoff) throw new HandoffError("task-handoff-unavailable", "Task Handoff is not available in this workspace.", true, "handoff");
    return this.services.taskHandoff;
  }

  private requirePrReview(): import("../../core/review/PrReviewService").PrReviewService {
    if (!this.services.prReview) throw new KeystoneError({ code: "pr-review-unavailable", category: "WORKSPACE", message: "PR Review is not available in this workspace.", technicalDetails: "PrReviewService is not registered.", operation: "pr-review", recoverable: true, recommendedAction: "Retry after the workspace finishes initializing.", retryable: true });
    return this.services.prReview;
  }

  private requireStageWorkspace(): import("../../core/workflows/StageWorkspaceService").StageWorkspaceService {
    if (!this.services.stageWorkspace)
      throw new KeystoneError({ code: "stage-workspace-unavailable", category: "WORKSPACE", message: "The stage workspace is not available in this workspace.", technicalDetails: "StageWorkspaceService is not registered.", operation: "stage-workspace", recoverable: true, recommendedAction: "Retry after the workspace finishes initializing.", retryable: true });
    return this.services.stageWorkspace;
  }

  private async routeStageWorkspace(request: WebviewRequest): Promise<void> {
    const service = this.requireStageWorkspace();
    try {
      switch (request.type) {
        case "stage.understand.load":
          await this.sendSuccess(request.requestId, await service.loadUnderstand(request.payload.workflowId)); return;
        case "stage.understand.initializeIntelligence":
          await this.sendSuccess(request.requestId, await service.initializeIntelligence(request.payload.workflowId)); return;
        case "stage.understand.analyzeIntent":
          await this.sendSuccess(request.requestId, await service.analyzeIntent(request.payload.workflowId)); return;
        case "stage.understand.approveAnalysis":
          await this.sendSuccess(request.requestId, await service.approveAnalysis(request.payload.workflowId)); return;
        case "stage.understand.setScopeItem":
          await this.sendSuccess(request.requestId, await service.setScopeItemIncluded(request.payload.workflowId, request.payload.itemId, request.payload.included, request.payload.reason)); return;
        case "stage.understand.resolveAmbiguity":
          await this.sendSuccess(request.requestId, await service.resolveAmbiguity(request.payload.workflowId, request.payload.ambiguityId, request.payload.resolution)); return;
        case "stage.understand.setConfiguration": {
          await this.sendSuccess(request.requestId, await service.setConfiguration(request.payload.workflowId, {
            ...(request.payload.mode ? { mode: request.payload.mode } : {}),
            ...(request.payload.skill ? { skill: request.payload.skill } : {}),
            ...(request.payload.agentId !== undefined ? { agentId: request.payload.agentId } : {}),
            ...(request.payload.instructionIds ? { instructionIds: request.payload.instructionIds } : {}),
            ...(request.payload.conflictResolutions ? { conflictResolutions: request.payload.conflictResolutions } : {}),
          })); return;
        }
        case "stage.understand.previewInstruction":
          await this.sendSuccess(request.requestId, await service.previewInstruction(request.payload.instructionId)); return;
        case "stage.understand.generateContext":
          await this.sendSuccess(request.requestId, await service.generateContext(request.payload.workflowId)); return;
        case "stage.understand.approveContext":
          await this.sendSuccess(request.requestId, await service.approveContext(request.payload.workflowId, request.payload.packageId, request.payload.revision)); return;
        case "stage.understand.delegate":
          await this.sendSuccess(request.requestId, await service.delegate(request.payload.workflowId)); return;
        case "stage.understand.captureResult":
          await this.sendSuccess(request.requestId, await service.captureResult(request.payload.workflowId, { source: request.payload.source, content: request.payload.content, ...(request.payload.referencedFiles ? { referencedFiles: request.payload.referencedFiles } : {}), ...(request.payload.unresolvedQuestions ? { unresolvedQuestions: request.payload.unresolvedQuestions } : {}), ...(request.payload.notes !== undefined ? { notes: request.payload.notes } : {}) })); return;
        case "stage.understand.validateResult":
          await this.sendSuccess(request.requestId, await service.validateResult(request.payload.workflowId)); return;
        case "stage.understand.acceptWarnings":
          await this.sendSuccess(request.requestId, await service.acceptValidationWarnings(request.payload.workflowId)); return;
        case "stage.understand.complete":
          await this.sendSuccess(request.requestId, await service.completeUnderstand(request.payload.workflowId)); return;
        case "stage.investigation.load":
          await this.sendSuccess(request.requestId, await service.loadInvestigation(request.payload.workflowId)); return;
        case "stage.investigation.upsertQuestion":
          await this.sendSuccess(request.requestId, await service.upsertQuestion(request.payload.workflowId, { ...(request.payload.questionId ? { questionId: request.payload.questionId } : {}), ...(request.payload.text !== undefined ? { text: request.payload.text } : {}), ...(request.payload.required !== undefined ? { required: request.payload.required } : {}), ...(request.payload.answer !== undefined ? { answer: request.payload.answer } : {}), ...(request.payload.evidence ? { evidence: request.payload.evidence } : {}) })); return;
        case "stage.investigation.setConclusion":
          await this.sendSuccess(request.requestId, await service.setConclusion(request.payload.workflowId, request.payload.conclusion, request.payload.limitations, request.payload.accepted)); return;
        case "stage.investigation.complete":
          await this.sendSuccess(request.requestId, await service.completeInvestigation(request.payload.workflowId)); return;
        case "stage.complete.load":
          await this.sendSuccess(request.requestId, service.loadComplete(request.payload.workflowId)); return;
        case "stage.complete.archive":
          await this.sendSuccess(request.requestId, await service.archiveWorkflow(request.payload.workflowId)); return;
        case "stage.plan.load":
          await this.sendSuccess(request.requestId, await service.loadPlan(request.payload.workflowId)); return;
        case "stage.plan.setConfiguration":
          await this.sendSuccess(request.requestId, await service.setPlanConfiguration(request.payload.workflowId, { ...(request.payload.mode ? { mode: request.payload.mode } : {}), ...(request.payload.skill ? { skill: request.payload.skill } : {}) })); return;
        case "stage.plan.generateContext":
          await this.sendSuccess(request.requestId, await service.generatePlanContext(request.payload.workflowId)); return;
        case "stage.plan.approveContext":
          await this.sendSuccess(request.requestId, await service.approvePlanContext(request.payload.workflowId, request.payload.packageId, request.payload.revision)); return;
        case "stage.plan.delegate":
          await this.sendSuccess(request.requestId, await service.delegatePlan(request.payload.workflowId)); return;
        case "stage.plan.capturePlan":
          await this.sendSuccess(request.requestId, await service.capturePlan(request.payload.workflowId, { planResult: request.payload.planResult, ...(request.payload.tasks ? { tasks: request.payload.tasks } : {}), ...(request.payload.validationExpectations ? { validationExpectations: request.payload.validationExpectations } : {}) })); return;
        case "stage.plan.approvePlan":
          await this.sendSuccess(request.requestId, await service.approvePlan(request.payload.workflowId)); return;
        case "stage.plan.complete":
          await this.sendSuccess(request.requestId, await service.completePlan(request.payload.workflowId)); return;
        default:
          return;
      }
    } catch (cause) {
      const stageError = cause as { name?: string; code?: string; message?: string; recoverable?: boolean };
      const error = stageError?.name === "StageWorkspaceError" || stageError?.name === "WorkflowServiceError"
        ? new KeystoneError({ code: stageError.code ?? "stage-workspace-failed", category: "WORKSPACE", message: stageError.message ?? "The stage action failed.", technicalDetails: `${request.type} failed.`, operation: request.type, recoverable: stageError.recoverable ?? true, recommendedAction: "Correct the stage input, then retry.", retryable: true, correlationId: request.requestId })
        : cause instanceof KeystoneError
          ? cause
          : new KeystoneError({ code: "stage-workspace-failed", category: "WORKSPACE", message: cause instanceof Error ? cause.message : "The stage action failed.", technicalDetails: `${request.type} failed.`, operation: request.type, recoverable: true, recommendedAction: "Retry the stage action.", retryable: true, correlationId: request.requestId, ...(cause instanceof Error ? { cause } : {}) });
      await this.sendError(request.requestId, error);
    }
  }

  private async sendError(requestId: string, error: KeystoneError): Promise<void> {
    const response = hostMessage("response/error", {
      requestId,
      error: error.serialize(),
    });
    this.remember(requestId, response);
    await this.postMessage(response);
  }

  private remember(requestId: string, response: HostMessage): void {
    this.responses.set(requestId, response);
    if (this.responses.size > 100) {
      const oldest = this.responses.keys().next().value;
      if (oldest) this.responses.delete(oldest);
    }
  }
}

function readRequestId(raw: unknown): string {
  if (raw && typeof raw === "object" && "requestId" in raw && typeof raw.requestId === "string")
    return raw.requestId;
  return crypto.randomUUID();
}

function workflowEvent(workflow: DevelopmentWorkflowSnapshot, message: string) {
  return {
    workflowId: workflow.id,
    revision: workflow.revision,
    status: workflow.status,
    message,
  };
}

function workbenchEvent(
  workflow: DevelopmentWorkflowSnapshot,
  stage: "define" | "plan" | "build" | "validate" | "review" | "complete",
  message: string,
) {
  return {
    workflowId: workflow.id,
    repositoryId: workflow.repositoryId,
    specificationRevision: workflow.specification?.revision,
    taskPlanRevision: workflow.taskGraph?.revision,
    stage,
    message,
    at: new Date().toISOString(),
  };
}
function buildEvent(state: BuildTaskState, message: string) {
  return {
    workflowId: state.workflow.id,
    taskId: state.task.id,
    specificationRevision: state.task.specificationRevision,
    intelligenceGeneration: state.workflow.intelligenceGeneration,
    message,
    at: new Date().toISOString(),
  };
}
function stageTitle(stage: string): string {
  return `${stage.slice(0, 1).toUpperCase()}${stage.slice(1)}`;
}
function workbenchDefinitions() {
  return [
    {
      workType: "feature" as const,
      definitionId: "feature-development",
      label: "Feature",
      description:
        "Add user-visible behavior with specification, implementation, tests, and review.",
    },
    {
      workType: "bug" as const,
      definitionId: "bug-fix",
      label: "Bug fix",
      description: "Investigate and repair incorrect behavior with regression evidence.",
    },
    {
      workType: "refactor" as const,
      definitionId: "refactoring",
      label: "Refactoring",
      description: "Improve internal structure without changing approved behavior.",
    },
    {
      workType: "test" as const,
      definitionId: "feature-development",
      label: "Test work",
      description: "Add or improve deterministic verification and coverage.",
    },
    {
      workType: "modernization" as const,
      definitionId: "modernization",
      label: "Modernization",
      description: "Move toward an approved target while preserving compatibility.",
    },
    {
      workType: "investigation" as const,
      definitionId: "quick-fix",
      label: "Investigation",
      description: "Understand a bounded problem and produce evidence before implementation.",
    },
  ];
}

function resolveTask(
  workflows: DevelopmentWorkflowService,
  workflowId: string,
  taskId: string,
): {
  workflow: DevelopmentWorkflowSnapshot;
  task: DevelopmentTask;
  specification: NonNullable<DevelopmentWorkflowSnapshot["specification"]>;
} {
  const workflow = workflows.get(workflowId);
  if (!workflow) throw new Error(`Workflow ${workflowId} was not found.`);
  const task = workflow.tasks.find((item) => item.id === taskId);
  if (!task) throw new Error(`Task ${taskId} was not found.`);
  if (!workflow.specification) throw new Error("The workflow has no specification.");
  return { workflow, task, specification: workflow.specification };
}
