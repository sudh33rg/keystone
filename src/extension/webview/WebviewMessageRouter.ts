import type { ConfigurationService } from "../../core/configuration/ConfigurationService";
import type { IntelligenceQueryService } from "../../core/intelligence/IntelligenceQueryService";
import type { IntelligenceRuntime } from "../../core/intelligence/runtime/IntelligenceRuntime";
import type { ContinuousIntelligenceState } from "../../core/intelligence/runtime/IntelligenceRuntime";
import type { WorkspaceStateStore } from "../../core/persistence/WorkspaceStateStore";
import type {
  BootstrapSnapshot,
  WorkspaceSummary,
} from "../../shared/contracts/domain";
import {
  hostMessage,
  WebviewRequestSchema,
  type HostMessage,
  type WebviewRequest,
} from "../../shared/contracts/messages";
import { KeystoneError } from "../../shared/errors/KeystoneError";
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
import type { DeliveryCoordinator } from "../../core/delivery/GitDeliveryService";
import type { TeamWorkflowService } from "../../core/team/TeamWorkflowService";
import type { ExecutionRoutingService } from "../../core/workflows/ExecutionRoutingService";
import type { OrchestrationService } from "../../core/orchestration/OrchestrationService";
import type { WorkflowInstance } from "../../shared/contracts/orchestration";
import type {
  ContextBudget,
  DevelopmentTask,
  DevelopmentWorkflowSnapshot,
} from "../../shared/contracts/delegation";

type PostMessage = (message: HostMessage) => Thenable<boolean>;

export interface IntelligenceServiceRegistry {
  intelligenceRuntime: IntelligenceRuntime;
  intelligenceQuery: IntelligenceQueryService;
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
  copilot: CopilotAdapter;
  agents: CopilotAgentRegistry;
  context: TaskContextService;
  delegation: DelegationService;
  currentEditor?(): string | undefined;
  currentSelection?():
    { relativePath: string; startLine: number; endLine: number } | undefined;
  execution: TaskExecutionService;
  validation: ValidationOrchestrator;
  completion: CompletionDecisionService;
  workflowCompletion: WorkflowCompletionService;
  delivery: DeliveryCoordinator;
  team: TeamWorkflowService;
  routing: ExecutionRoutingService;
  orchestration: OrchestrationService;
  workspaceTrusted(): boolean;
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
    this.runtimeSubscription = services.intelligenceRuntime.onDidChange(
      (state) => {
        this.pendingRuntimeState = state;
        this.runtimeEventRevision += 1;
        this.scheduleRuntimeEvent();
        this.scheduleOverviewEvent();
      },
    );
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
      if (state && !this.disposed) void this.postMessage(hostMessage("intelligence/runtime", state));
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
      if (this.lastQueryGeneration && overview.generation && overview.generation !== this.lastQueryGeneration)
        await this.postMessage(hostMessage("intelligence/queryInvalidated", { queryId: crypto.randomUUID(), generation: overview.generation, message: `Query cache invalidated by generation ${overview.generation}.` }));
      if (overview.generation) {
        const delegationGenerationChanged = Boolean((this.lastQueryGeneration && overview.generation !== this.lastQueryGeneration) || this.services.workflow.list().some((workflow) => workflow.intelligenceGeneration !== overview.generation));
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
        recommendedAction:
          "Reload the Keystone view. If the problem continues, review the logs.",
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
      const error = KeystoneError.fromUnknown(
        cause,
        request.type,
        request.requestId,
      );
      this.logger.error(error);
      await this.sendError(request.requestId, error);
    }
  }

  private async route(request: WebviewRequest): Promise<void> {
    this.ensureWorkspaceTrust(request);
    switch (request.type) {
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
      case "navigation/set": {
        const state = await this.store.setActiveSection(
          request.payload.section,
        );
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
        await this.sendSuccess(request.requestId, await this.cancellableQuery(request.requestId, (signal) => this.services.intelligenceQuery.diagnostics(request.payload, signal)));
        return;
      case "intelligence/scan/start":
        await this.sendSuccess(
          request.requestId,
          this.services.intelligenceRuntime.start(),
        );
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
            this.services.intelligenceQuery.neighborhood(
              request.payload,
              signal,
            ),
          ),
        );
        return;
      case "intelligence/technologies":
        await this.sendSuccess(
          request.requestId,
          await this.cancellableQuery(request.requestId, (signal) =>
            this.services.intelligenceQuery.technologies(
              request.payload,
              signal,
            ),
          ),
        );
        return;
      case "intelligence/adapter-diagnostics":
        await this.sendSuccess(
          request.requestId,
          await this.cancellableQuery(request.requestId, (signal) =>
            this.services.intelligenceQuery.adapterDiagnostics(
              request.payload,
              signal,
            ),
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
            this.services.intelligenceQuery.suggestions(
              request.payload,
              signal,
            ),
          ),
        );
        return;
      case "intelligence/query/templates":
        await this.sendSuccess(
          request.requestId,
          this.services.intelligenceQuery.templates(),
        );
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
        await this.services.openSource(
          request.payload.relativePath,
          request.payload.range,
        );
        await this.sendSuccess(request.requestId);
        return;
      case "workflow/capture": {
        const workflow = await this.cancellableQuery(
          request.requestId,
          (signal) =>
            this.services.workflow.capture(
              request.payload.text,
              request.payload.mode,
              request.payload.title,
              signal,
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
        await this.sendSuccess(
          request.requestId,
          this.services.workflow.list(),
        );
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
          await this.services.workflow.submitForReview(
            request.payload.workflowId,
          ),
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
          await this.services.workflow.generateTasks(
            request.payload.workflowId,
          ),
          "Dependency-ordered task graph generated.",
        );
        return;
      case "workflow/reconcile": {
        const workflow = await this.services.workflow.reconcileStaleness(
          request.payload.workflowId,
        );
        const type =
          workflow.status === "stale" ? "workflow/stale" : "workflow/updated";
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
      case "copilot/capabilities":
        await this.sendSuccess(
          request.requestId,
          this.services.copilot.getCapabilities() ??
            (await this.services.copilot.refreshCapabilities()),
        );
        return;
      case "copilot/refreshCapabilities": {
        const previousFingerprint =
          this.services.copilot.getCapabilities()?.fingerprint;
        const capabilities = await this.cancellableQuery(
          request.requestId,
          (signal) => this.services.copilot.refreshCapabilities(signal),
        );
        if (
          previousFingerprint &&
          previousFingerprint !== capabilities.fingerprint
        )
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
        await this.sendSuccess(
          request.requestId,
          this.services.agents.getProfiles(),
        );
        return;
      case "copilot/refreshAgents": {
        const agents = await this.cancellableQuery(
          request.requestId,
          (signal) => this.services.agents.refresh(undefined, signal),
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
          throw new Error(
            "The selected agent is not in the current evidence-backed registry.",
          );
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
      case "context/build":
      case "context/regenerate": {
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
          request.payload.budget,
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
        await this.sendSuccess(
          request.requestId,
          this.services.context.get(request.payload.taskId),
        );
        return;
      case "context/update":
        await this.sendSuccess(
          request.requestId,
          await this.services.context.restore(
            request.payload.taskId,
            request.payload.itemId,
          ),
        );
        return;
      case "context/removeItem":
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
        await this.sendSuccess(
          request.requestId,
          await this.services.context.pin(
            request.payload.taskId,
            request.payload.itemId,
            true,
          ),
        );
        return;
      case "context/unpinItem":
        await this.sendSuccess(
          request.requestId,
          await this.services.context.pin(
            request.payload.taskId,
            request.payload.itemId,
            false,
          ),
        );
        return;
      case "context/addEntity": {
        const existing = this.services.context.get(request.payload.taskId);
        const context = await this.buildContext(
          request.payload.workflowId,
          request.payload.taskId,
          existing?.budget,
          [
            ...(existing?.items
              .filter((item) => item.pinned && item.sourceEntityId)
              .map((item) => item.sourceEntityId!) ?? []),
            request.payload.entityId,
          ],
          existing?.items
            .filter((item) => item.pinned && item.relativePath)
            .map((item) => item.relativePath!),
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
          existing?.budget,
          existing?.items
            .filter((item) => item.pinned && item.sourceEntityId)
            .map((item) => item.sourceEntityId!),
          [
            ...(existing?.items
              .filter((item) => item.pinned && item.relativePath)
              .map((item) => item.relativePath!) ?? []),
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
          request.payload.budget,
          existing?.items
            .filter((item) => item.pinned && item.sourceEntityId)
            .map((item) => item.sourceEntityId!),
          existing?.items
            .filter((item) => item.pinned && item.relativePath)
            .map((item) => item.relativePath!),
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
      case "delegation/prepare": {
        const context = this.services.context.get(request.payload.taskId);
        if (!context)
          throw new Error(
            "Build and review context before preparing delegation.",
          );
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
            message:
              "Deterministic prompt prepared; explicit approval is required.",
          }),
        );
        await this.sendSuccess(request.requestId, prepared);
        return;
      }
      case "delegation/getPrompt":
        await this.sendSuccess(
          request.requestId,
          this.services.delegation.getPrepared(request.payload.taskId),
        );
        return;
      case "delegation/approve":
        await this.sendSuccess(
          request.requestId,
          await this.services.delegation.approve(
            request.payload.taskId,
            request.payload.promptFingerprint,
            request.payload.contextFingerprint,
          ),
        );
        return;
      case "delegation/start": {
        const context = this.services.context.get(request.payload.taskId);
        if (!context) throw new Error("Reviewed context is required.");
        try {
          const session = await this.cancellableQuery(
            request.requestId,
            (signal) =>
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
        const prepared = this.services.delegation.getPrepared(
          request.payload.taskId,
        );
        if (!prepared?.approved)
          throw new Error("Approve the exact prompt before copying it.");
        await this.services.copilot.copyPrompt(prepared.prompt);
        await this.sendSuccess(request.requestId);
        return;
      }
      case "delegation/confirmStarted": {
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
        const session = await this.services.delegation.confirmStopped(
          request.payload.sessionId,
        );
        await this.postMessage(
          hostMessage("delegation/statusChanged", {
            taskId: session.taskId,
            sessionId: session.id,
            status: session.status,
            message:
              "External execution stopped; completion remains unverified.",
          }),
        );
        await this.sendSuccess(request.requestId, session);
        return;
      }
      case "delegation/cancel": {
        const session = await this.services.delegation.cancel(
          request.payload.workflowId,
          request.payload.sessionId,
        );
        await this.postMessage(
          hostMessage("delegation/cancelled", {
            taskId: session.taskId,
            sessionId: session.id,
            status: session.status,
            message:
              "Keystone tracking cancelled; unsupported external work may continue.",
          }),
        );
        await this.sendSuccess(request.requestId, session);
        return;
      }
      case "delegation/status": {
        const session = this.services.delegation.sessions.get(
          request.payload.sessionId,
        );
        if (session) {
          const refreshed = await this.services.delegation.refreshChanges(
            session.id,
          );
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
        await this.sendSuccess(
          request.requestId,
          this.services.execution.sessions.list(),
        );
        return;
      case "execution/get":
        await this.sendSuccess(
          request.requestId,
          this.services.execution.get(request.payload.sessionId),
        );
        return;
      case "execution/confirmStarted": {
        const session = await this.services.execution.confirmStarted(
          request.payload.sessionId,
        );
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
        const session = await this.services.execution.confirmStopped(
          request.payload.sessionId,
        );
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
        const session = await this.services.execution.cancel(
          request.payload.sessionId,
        );
        await this.postMessage(
          hostMessage("execution/statusChanged", {
            sessionId: session.id,
            taskId: session.taskId,
            status: session.status,
            message:
              "Execution tracking cancelled; no completion claim was made.",
          }),
        );
        await this.sendSuccess(request.requestId, session);
        return;
      }
      case "execution/observeChanges": {
        const session = await this.services.execution.observeChanges(
          request.payload.sessionId,
        );
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
            message:
              "Result captured as untrusted claims plus repository observations.",
          }),
        );
        await this.sendSuccess(request.requestId, session);
        return;
      }
      case "validation/plan": {
        const plan = await this.services.validation.plan(
          request.payload.sessionId,
          {
            testMode: request.payload.testMode,
            excludedTestEntityIds: request.payload.excludedTestEntityIds,
          },
        );
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
      case "validation/run": {
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
            message:
              "Validation completed; completion remains a separate explicit decision.",
          }),
        );
        await this.sendSuccess(request.requestId, run);
        return;
      }
      case "validation/cancel":
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
      case "validation/rerunStep":
        await this.sendSuccess(
          request.requestId,
          await this.services.validation.rerunStep(
            request.payload.runId,
            request.payload.stepId,
          ),
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
            message:
              "Focused repair context prepared; previous attempts remain immutable.",
          }),
        );
        await this.sendSuccess(request.requestId, plan);
        return;
      }
      case "retry/buildContext":
      case "retry/prepare":
        await this.sendSuccess(
          request.requestId,
          this.services.execution.getRetry(request.payload.sessionId),
        );
        return;
      case "retry/start": {
        const session = await this.services.execution.startRetry(
          request.payload.sessionId,
        );
        const plan = this.services.execution.getRetry(
          request.payload.sessionId,
        )!;
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
      case "completion/evaluate": {
        const decision = this.services.completion.evaluate(
          request.payload.sessionId,
        );
        await this.postMessage(
          hostMessage("completion/readinessChanged", {
            sessionId: request.payload.sessionId,
            status: decision.status,
            blockers: decision.blockers.length,
            message:
              "Completion evaluated only from current validation and repository evidence.",
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
              message:
                "Dependencies satisfied; tasks unlocked but were not delegated.",
            }),
          );
        if (result.report)
          await this.postMessage(
            hostMessage("completion/workflowCompleted", {
              workflowId: result.report.workflowId,
              reportId: result.report.id,
              message:
                "All tasks completed; local workflow report generated without PR or push.",
            }),
          );
        await this.sendSuccess(request.requestId, result);
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
        await this.sendSuccess(request.requestId, await this.services.delivery.capabilities.refresh(this.services.delivery.root));
        return;
      case "git/repositoryState":
        await this.sendSuccess(request.requestId, await this.services.delivery.repositories.getState(this.services.delivery.root));
        return;
      case "git/remotes":
        await this.sendSuccess(request.requestId, (await this.services.delivery.repositories.getState(this.services.delivery.root)).remotes);
        return;
      case "git/branches": {
        const state = await this.services.delivery.repositories.getState(this.services.delivery.root);
        await this.sendSuccess(request.requestId, { current: state.branch, upstream: state.upstreamBranch, defaultBranch: state.defaultBranch, detached: state.detachedHead });
        return;
      }
      case "git/diff": {
        const controller = new AbortController(); this.queryControllers.set(request.requestId, controller);
        try { await this.sendSuccess(request.requestId, await this.services.delivery.adapter.diff(this.services.delivery.root, request.payload.path, request.payload.mode, request.payload.maxBytes, controller.signal)); } finally { this.queryControllers.delete(request.requestId); }
        return;
      }
      case "git/readiness":
        await this.sendSuccess(request.requestId, await this.services.delivery.evaluate(request.payload.workflowId));
        return;
      case "delivery/createChangeSet":
      case "delivery/rebuildChangeSet": {
        const changeSet = await this.services.delivery.createChangeSet(request.payload.workflowId);
        await this.postMessage(hostMessage("delivery/changeSetChanged", { changeSetId: changeSet.id, message: "Delivery change set rebuilt from current repository and workflow evidence." }));
        await this.sendSuccess(request.requestId, changeSet);
        return;
      }
      case "delivery/getChangeSet":
        await this.sendSuccess(request.requestId, this.services.delivery.getChangeSet(request.payload.changeSetId));
        return;
      case "delivery/includeFile":
      case "delivery/excludeFile": {
        const changeSet = await this.services.delivery.decideFile(request.payload.changeSetId, request.payload.fileId, request.type === "delivery/includeFile", request.payload.explanation);
        await this.postMessage(hostMessage("delivery/changeSetChanged", { changeSetId: changeSet.id, message: "Reviewed file selection changed; dependent approvals must be renewed." }));
        await this.sendSuccess(request.requestId, changeSet);
        return;
      }
      case "delivery/attributeFile": {
        const changeSet = await this.services.delivery.attributeFile(request.payload.changeSetId, request.payload.fileId, request.payload.attribution, request.payload.explanation);
        await this.postMessage(hostMessage("delivery/changeSetChanged", { changeSetId: changeSet.id, message: "File attribution was explicitly updated." }));
        await this.sendSuccess(request.requestId, changeSet);
        return;
      }
      case "commitPlan/create": {
        const plan = await this.services.delivery.createCommitPlan(request.payload.changeSetId, request.payload.convention);
        await this.postMessage(hostMessage("commitPlan/changed", { commitPlanId: plan.id, message: "Deterministic commit plan created for review." }));
        await this.sendSuccess(request.requestId, plan);
        return;
      }
      case "commitPlan/get":
        await this.sendSuccess(request.requestId, this.services.delivery.getCommitPlan(request.payload.commitPlanId));
        return;
      case "commitPlan/update": {
        const plan = await this.services.delivery.commits.save({ ...request.payload.plan, status: "draft", updatedAt: new Date().toISOString() });
        await this.sendSuccess(request.requestId, plan);
        return;
      }
      case "commitPlan/merge": {
        const current = this.requireCommitPlan(request.payload.commitPlanId);
        await this.sendSuccess(request.requestId, await this.services.delivery.commits.merge(current, request.payload.commitIds));
        return;
      }
      case "commitPlan/split": {
        const current = this.requireCommitPlan(request.payload.commitPlanId);
        await this.sendSuccess(request.requestId, await this.services.delivery.commits.split(current, request.payload.commitId, request.payload.fileIds, request.payload.title));
        return;
      }
      case "commitPlan/reorder": {
        const current = this.requireCommitPlan(request.payload.commitPlanId);
        await this.sendSuccess(request.requestId, await this.services.delivery.commits.reorder(current, request.payload.commitIds));
        return;
      }
      case "commitPlan/moveFile": {
        const current = this.requireCommitPlan(request.payload.commitPlanId);
        await this.sendSuccess(request.requestId, await this.services.delivery.commits.moveFile(current, request.payload.fileId, request.payload.targetCommitId));
        return;
      }
      case "commitPlan/approve": {
        const current = this.requireCommitPlan(request.payload.commitPlanId);
        const plan = await this.services.delivery.commits.save({ ...current, status: "approved", updatedAt: new Date().toISOString() });
        await this.sendSuccess(request.requestId, plan);
        return;
      }
      case "git/stage":
      case "git/unstage": {
        const changeSet = this.requireChangeSet(request.payload.changeSetId); const repository = await this.services.delivery.repositories.getState(this.services.delivery.root);
        const approval = await this.services.delivery.approvals.approve({ action: request.type === "git/stage" ? "stage" : "unstage", repositoryId: changeSet.repositoryId, branch: changeSet.branch, changeSetId: changeSet.id, changeSetFingerprint: changeSet.fingerprint, paths: request.payload.paths, message: repository.fingerprint, risks: changeSet.findings, safelyRetryable: true });
        const result = request.type === "git/stage" ? await this.services.delivery.mutations.stage(this.services.delivery.root, approval.id, changeSet) : await this.services.delivery.mutations.unstage(this.services.delivery.root, approval.id, changeSet);
        await this.postMessage(hostMessage(result.status === "succeeded" ? "git/actionCompleted" : "git/actionFailed", result.status === "succeeded" ? { action: approval.action, resultId: result.id, message: result.sanitizedOutput } : { action: approval.action, message: result.sanitizedOutput }));
        await this.sendSuccess(request.requestId, result);
        return;
      }
      case "git/createBranch": {
        const state = await this.services.delivery.repositories.getState(this.services.delivery.root);
        const approval = await this.services.delivery.approvals.approve({ action: "create-branch", repositoryId: state.repositoryId, branch: state.branch, paths: [], message: state.fingerprint, remoteBranch: request.payload.branch, risks: ["Creates and switches the current local branch."], safelyRetryable: false });
        await this.sendSuccess(request.requestId, await this.services.delivery.mutations.createBranch(this.services.delivery.root, approval.id));
        return;
      }
      case "git/commit": {
        const changeSet = this.requireChangeSet(request.payload.changeSetId); const plan = this.requireCommitPlan(request.payload.commitPlanId);
        if (plan.status !== "approved") throw new Error("The commit plan must be explicitly approved before commit creation.");
        const approval = await this.services.delivery.approvals.approve({ action: "commit", repositoryId: changeSet.repositoryId, branch: changeSet.branch, changeSetId: changeSet.id, changeSetFingerprint: changeSet.fingerprint, commitPlanId: plan.id, proposedCommitId: request.payload.proposedCommitId, paths: [], message: request.payload.message, risks: changeSet.findings, safelyRetryable: false });
        const result = await this.services.delivery.mutations.commit(this.services.delivery.root, approval.id, changeSet, plan);
        if (result.status === "succeeded") { const commits = plan.commits.map((item) => item.id === request.payload.proposedCommitId ? { ...item, createdCommitHash: result.commitHash, actualFiles: result.affectedPaths } : item); const completed = commits.every((item) => item.createdCommitHash); await this.services.delivery.commits.save({ ...plan, commits, status: completed ? "completed" : "partially-created", updatedAt: new Date().toISOString() }); }
        await this.sendSuccess(request.requestId, result);
        return;
      }
      case "git/push": {
        const state = await this.services.delivery.repositories.getState(this.services.delivery.root);
        const approval = await this.services.delivery.approvals.approve({ action: "push", repositoryId: state.repositoryId, branch: state.branch, paths: [], remote: request.payload.remote, remoteBranch: request.payload.branch, risks: ["Publishes local commits to the selected remote branch."], safelyRetryable: true });
        await this.sendSuccess(request.requestId, await this.services.delivery.mutations.push(this.services.delivery.root, approval.id));
        return;
      }
      case "pullRequest/capabilities": {
        const state = await this.services.delivery.repositories.getState(this.services.delivery.root); const detected = await this.services.delivery.providers.detect(this.services.delivery.root, state);
        await this.sendSuccess(request.requestId, detected.capability);
        return;
      }
      case "pullRequest/templates": {
        const state = await this.services.delivery.repositories.getState(this.services.delivery.root); const detected = await this.services.delivery.providers.detect(this.services.delivery.root, state);
        await this.sendSuccess(request.requestId, detected.provider ? await detected.provider.discoverTemplates(this.services.delivery.root) : []);
        return;
      }
      case "pullRequest/createDraft": {
        const changeSet = this.requireChangeSet(request.payload.changeSetId); const plan = this.requireCommitPlan(request.payload.commitPlanId); const state = await this.services.delivery.repositories.getState(this.services.delivery.root); const detected = await this.services.delivery.providers.detect(this.services.delivery.root, state);
        let draft = await this.services.delivery.drafts.create(changeSet, plan, detected.capability, request.payload.baseBranch);
        const template = detected.provider ? (await detected.provider.discoverTemplates(this.services.delivery.root))[0] : undefined;
        if (template?.body.trim()) draft = await this.services.delivery.updateDraft({ ...draft, body: `${template.body.trim()}\n\n${draft.body}`.slice(0, 20_000) });
        await this.sendSuccess(request.requestId, draft);
        return;
      }
      case "pullRequest/updateDraft":
        await this.sendSuccess(request.requestId, await this.services.delivery.updateDraft(request.payload.draft));
        return;
      case "pullRequest/validate": {
        const draft = this.requireDraft(request.payload.draftId); const state = await this.services.delivery.repositories.getState(this.services.delivery.root); const detected = await this.services.delivery.providers.detect(this.services.delivery.root, state);
        await this.sendSuccess(request.requestId, this.services.delivery.draftValidation.validate(draft, detected.capability, state));
        return;
      }
      case "pullRequest/approve": {
        const draft = this.requireDraft(request.payload.draftId); await this.services.delivery.approvals.approve({ action: "create-pr", repositoryId: draft.repository, branch: draft.headBranch, paths: [], message: draft.fingerprint, risks: draft.riskSummary, safelyRetryable: false }); const value = { ...draft, status: "approved" as const, updatedAt: new Date().toISOString() }; await this.services.delivery.persistence.update((state) => ({ ...state, pullRequestDrafts: state.pullRequestDrafts.map((item) => item.id === draft.id ? value : item) }));
        await this.sendSuccess(request.requestId, value);
        return;
      }
      case "pullRequest/create": {
        const draft = this.requireDraft(request.payload.draftId); const state = await this.services.delivery.repositories.getState(this.services.delivery.root); const detected = await this.services.delivery.providers.detect(this.services.delivery.root, state); const validation = this.services.delivery.draftValidation.validate(draft, detected.capability, state); if (!validation.ready || !detected.provider) throw new Error(validation.blockers.join(" ") || "Pull-request provider unavailable.");
        const approval = this.services.delivery.persistence.snapshot.approvals.find((item) => item.action === "create-pr" && item.message === draft.fingerprint && !item.consumedAt); if (!approval) throw new Error("A current explicit pull-request approval is required.");
        const result = detected.capability.directCreationAvailable ? await this.services.delivery.creation.create(approval.id, draft, detected.provider, detected.capability) : await this.services.delivery.creation.assisted(approval.id, draft, detected.provider);
        await this.sendSuccess(request.requestId, result);
        return;
      }
      case "pullRequest/confirmExternalCreation": {
        const draft = this.requireDraft(request.payload.draftId); await this.sendSuccess(request.requestId, await this.services.delivery.creation.confirmExternal(draft, request.payload.url)); return;
      }
      case "pullRequest/status":
      case "pullRequest/refresh":
        await this.sendSuccess(request.requestId, this.services.delivery.persistence.snapshot.pullRequestResults.find((item) => item.draftId === request.payload.draftId));
        return;
      case "team/participants":
        await this.sendSuccess(request.requestId, this.services.team.participants.list()); return;
      case "team/addParticipant": {
        const participant = await this.services.team.participants.create(request.payload); await this.postMessage(hostMessage("team/participantsChanged", { participantIds: this.services.team.participants.list().map((item) => item.id), message: "Participant added to local team metadata." })); await this.sendSuccess(request.requestId, participant); return;
      }
      case "team/updateParticipant": {
        const participant = await this.services.team.participants.update(request.payload); await this.postMessage(hostMessage("team/participantsChanged", { participantIds: this.services.team.participants.list().map((item) => item.id), message: "Participant metadata updated." })); await this.sendSuccess(request.requestId, participant); return;
      }
      case "team/removeParticipant":
        await this.services.team.participants.remove(request.payload.participantId); await this.postMessage(hostMessage("team/participantsChanged", { participantIds: this.services.team.participants.list().map((item) => item.id), message: "Participant removed from local team metadata." })); await this.sendSuccess(request.requestId); return;
      case "team/capabilities":
        await this.sendSuccess(request.requestId, { identityAssurance: "self-asserted-local", capabilities: ["participants", "explicit-assignment-acceptance", "reviewed-handoff", "json-zip-export", "repository-reconciliation", "read-only-import"], limitations: ["No authentication or authorization provider", "No cloud sync or real-time presence", "No automatic Git mutation or execution continuation"] }); return;
      case "assignment/create": {
        const assignment = await this.services.team.assignments.create(request.payload); await this.postMessage(hostMessage("assignment/created", { assignmentId: assignment.id, message: "Assignment created and awaiting explicit acceptance." })); await this.sendSuccess(request.requestId, assignment); return;
      }
      case "assignment/get":
        await this.sendSuccess(request.requestId, this.services.team.assignments.get(request.payload.assignmentId)); return;
      case "assignment/list":
      case "progress/assignments":
        await this.sendSuccess(request.requestId, this.services.team.assignments.list(request.payload.workflowId)); return;
      case "assignment/update":
        await this.sendSuccess(request.requestId, await this.services.team.assignments.update(request.payload.assignmentId, request.payload.patch)); return;
      case "assignment/accept":
      case "assignment/reject":
      case "assignment/requestClarification": {
        const decision = request.type === "assignment/accept" ? "accepted" : request.type === "assignment/reject" ? "rejected" : "clarification-requested"; const assignment = await this.services.team.assignments.decide(request.payload, decision); await this.postMessage(hostMessage("assignment/statusChanged", { assignmentId: assignment.id, message: `Assignment is ${assignment.status}.` })); await this.sendSuccess(request.requestId, assignment); return;
      }
      case "assignment/reassign": {
        const assignment = await this.services.team.reassignments.reassign(request.payload); await this.postMessage(hostMessage("assignment/reassigned", { assignmentId: assignment.id, message: "Assignment reassigned with an auditable continuity record." })); await this.sendSuccess(request.requestId, assignment); return;
      }
      case "assignment/cancel": {
        const assignment = await this.services.team.assignments.cancel(request.payload); await this.postMessage(hostMessage("assignment/statusChanged", { assignmentId: assignment.id, message: "Assignment cancelled with an explicit reason." })); await this.sendSuccess(request.requestId, assignment); return;
      }
      case "handoff/prepare": {
        await this.postMessage(hostMessage("handoff/preparationStarted", { message: "Preparing immutable, evidence-linked handoff package." })); const packageData = await this.services.team.packages.build(request.payload); await this.postMessage(hostMessage("handoff/prepared", { packageId: packageData.id, message: "Handoff package prepared for review and export." })); await this.sendSuccess(request.requestId, packageData); return;
      }
      case "handoff/get":
        await this.sendSuccess(request.requestId, this.services.team.store.snapshot.packages.find((item) => item.id === request.payload.packageId)); return;
      case "handoff/validate":
        await this.sendSuccess(request.requestId, this.services.team.validator.validate(request.payload.package, this.services.team.store.snapshot.settings)); return;
      case "handoff/export": {
        const packageData = this.services.team.store.snapshot.packages.find((item) => item.id === request.payload.packageId); if (!packageData) throw new Error("Handoff package not found."); const destination = await this.services.team.artifacts.export(packageData, request.payload.mode); if (destination) await this.postMessage(hostMessage("handoff/exported", { packageId: packageData.id, message: "Reviewed handoff artifact exported." })); await this.sendSuccess(request.requestId, { ...(destination ? { destination } : {}) }); return;
      }
      case "handoff/import": {
        const artifact = await this.services.team.artifacts.selectImport(); if (!artifact) { await this.sendSuccess(request.requestId, undefined); return; } const imported = await this.cancellableQuery(request.requestId, (signal) => this.services.team.imports.importJson(artifact.bytes, artifact.source, artifact.label, signal)); await this.postMessage(hostMessage("handoff/imported", { packageId: imported.package.id, message: "Handoff imported for review; no repository or execution state was changed." })); await this.sendSuccess(request.requestId, { package: imported.package, validation: imported.validation, importId: imported.record.id }); return;
      }
      case "handoff/reconcile": {
        const packageData = this.services.team.store.snapshot.packages.find((item) => item.id === request.payload.packageId); if (!packageData) throw new Error("Handoff package not found."); const reconciliation = await this.services.team.reconciliation.reconcile(packageData); await this.postMessage(hostMessage("handoff/reconciliationCompleted", { packageId: packageData.id, message: `Repository reconciliation classified the receiver as ${reconciliation.compatibility}.` })); await this.sendSuccess(request.requestId, reconciliation); return;
      }
      case "handoff/accept":
      case "handoff/reject":
      case "handoff/importReadOnly": {
        const decision = request.type === "handoff/accept" ? "accepted" : request.type === "handoff/reject" ? "rejected" : "read-only"; const acceptance = await this.services.team.acceptance.decide({ ...request.payload, decision }); let contextMessage = "";
        if (decision === "accepted") {
          const packageData = this.services.team.store.snapshot.packages.find((item) => item.id === acceptance.packageId); const workflow = packageData ? this.services.workflow.get(packageData.workflowId) : undefined; const task = workflow?.tasks.find((item) => item.id === packageData?.taskId);
          if (packageData && workflow?.specification && task) {
            try { const rebuilt = await this.services.context.build({ task, specification: workflow.specification, pinnedEntityIds: packageData.context.flatMap((item) => item.canonicalEntityIds), pinnedFiles: packageData.context.flatMap((item) => item.sourcePaths), currentFile: this.services.currentEditor?.(), currentSelection: this.services.currentSelection?.() }); contextMessage = ` Fresh receiver context ${rebuilt.id} was rebuilt and remains unreviewed.`; }
            catch (cause) { contextMessage = " Receiver context could not be rebuilt automatically and must be prepared before delegation."; this.logger.warning("handoff.context.rebuild", contextMessage, cause); }
          }
        }
        await this.postMessage(hostMessage(decision === "accepted" ? "handoff/accepted" : "handoff/rejected", { packageId: acceptance.packageId, message: decision === "accepted" ? `Handoff accepted; a fresh execution approval is still required.${contextMessage}` : `Handoff retained as ${decision}.` })); await this.sendSuccess(request.requestId, acceptance); return;
      }
      case "handoff/cancel":
        await this.services.team.store.update((state) => ({ ...state, packages: state.packages.filter((item) => item.id !== request.payload.packageId) })); await this.sendSuccess(request.requestId); return;
      case "progress/workflows":
        await this.sendSuccess(request.requestId, this.services.team.store.snapshot.progress.slice(-500)); return;
      case "progress/tasks":
      case "progress/refresh": {
        const progress = this.services.team.progress.get(request.payload.workflowId); await this.services.team.store.update((state) => ({ ...state, progress: [...state.progress.filter((item) => item.workflowId !== progress.workflowId), progress].slice(-500) })); await this.postMessage(hostMessage("progress/changed", { workflowId: progress.workflowId, message: "Local workflow progress snapshot refreshed." })); await this.sendSuccess(request.requestId, progress); return;
      }
      case "progress/audit":
        await this.sendSuccess(request.requestId, this.services.team.audit.list(this.services.team.store.snapshot, request.payload)); return;
      case "orchestration/create": {
        const value = await this.services.orchestration.create(request.payload.workflowId, request.payload.policyProfileId, request.payload.definitionId); await this.orchestrationEvent("orchestration/created", value, "Orchestration instance created from approved workflow state."); await this.sendSuccess(request.requestId, value); return;
      }
      case "orchestration/get":
      case "orchestration/status": await this.sendSuccess(request.requestId, this.services.orchestration.get(request.payload.orchestrationId)); return;
      case "orchestration/list": await this.sendSuccess(request.requestId, this.services.orchestration.list()); return;
      case "orchestration/definitions": await this.sendSuccess(request.requestId, this.services.orchestration.definitions.list()); return;
      case "orchestration/policies": await this.sendSuccess(request.requestId, this.services.orchestration.policies.list()); return;
      case "orchestration/plan": { const value = await this.services.orchestration.plan(request.payload.orchestrationId); await this.orchestrationEvent("orchestration/planned", value, "Executable plan generated; execution remains blocked pending approval."); await this.sendSuccess(request.requestId, value); return; }
      case "orchestration/validatePlan": { const value = this.services.orchestration.get(request.payload.orchestrationId); await this.sendSuccess(request.requestId, { valid: Boolean(value?.plan && value.taskStates.length && !value.diagnostics.some((item) => item.severity === "error")), blockers: value?.diagnostics.filter((item) => item.severity === "error").map((item) => item.message) ?? ["Orchestration instance was not found."], warnings: value?.diagnostics.filter((item) => item.severity === "warning").map((item) => item.message) ?? [] }); return; }
      case "orchestration/start": { const value = await this.services.orchestration.start(request.payload.orchestrationId); await this.orchestrationEvent("orchestration/started", value, "Approved orchestration workflow started."); await this.sendSuccess(request.requestId, value); return; }
      case "orchestration/pause": { const value = await this.services.orchestration.pause(request.payload.orchestrationId); await this.orchestrationEvent("orchestration/paused", value, "Workflow paused with evidence preserved."); await this.sendSuccess(request.requestId, value); return; }
      case "orchestration/resume": { const value = await this.services.orchestration.resume(request.payload.orchestrationId, request.payload); await this.orchestrationEvent("orchestration/resumed", value, "Workflow resume reconciliation completed."); await this.sendSuccess(request.requestId, value); return; }
      case "orchestration/cancel": { const value = await this.services.orchestration.cancel(request.payload.orchestrationId); await this.orchestrationEvent("orchestration/cancelled", value, "Workflow cancelled without deleting user or Git changes."); await this.sendSuccess(request.requestId, value); return; }
      case "orchestration/recover": { const value = await this.services.orchestration.recover(request.payload.orchestrationId, request.payload); await this.orchestrationEvent("orchestration/recovered", value, "Persisted state reconciled; interrupted work was not inferred complete."); await this.sendSuccess(request.requestId, value); return; }
      case "orchestration/taskReadiness": await this.sendSuccess(request.requestId, this.services.orchestration.taskReadiness(request.payload.orchestrationId, request.payload.taskId)); return;
      case "orchestration/startTask": { const value = await this.services.orchestration.startTask(request.payload.orchestrationId, request.payload.taskId); await this.orchestrationEvent("orchestration/taskStarted", value, "Task started after readiness validation.", request.payload.taskId); await this.sendSuccess(request.requestId, value); return; }
      case "orchestration/pauseTask": { const value = await this.services.orchestration.pauseTask(request.payload.orchestrationId, request.payload.taskId, request.payload.reason); await this.orchestrationEvent("orchestration/taskBlocked", value, "Task paused with state preserved.", request.payload.taskId); await this.sendSuccess(request.requestId, value); return; }
      case "orchestration/cancelTask": { const value = await this.services.orchestration.cancelTask(request.payload.orchestrationId, request.payload.taskId, request.payload.reason); await this.orchestrationEvent("orchestration/taskProgress", value, "Task cancelled without deleting repository changes.", request.payload.taskId); await this.sendSuccess(request.requestId, value); return; }
      case "orchestration/retryTask": { const value = await this.services.orchestration.retryTask(request.payload.orchestrationId, request.payload.taskId, request.payload.reason, request.payload.agentId); await this.orchestrationEvent("orchestration/taskProgress", value, "Bounded retry planned; no delegation started automatically.", request.payload.taskId); await this.sendSuccess(request.requestId, value); return; }
      case "orchestration/changeAgent": { if (!request.payload.agentId) throw new Error("An explicit agent ID is required."); const value = await this.services.orchestration.changeAgent(request.payload.orchestrationId, request.payload.taskId, request.payload.agentId, request.payload.reason); await this.orchestrationEvent("orchestration/taskProgress", value, "Agent changed; context review was invalidated.", request.payload.taskId); await this.sendSuccess(request.requestId, value); return; }
      case "orchestration/skipOptionalTask": this.services.orchestration.skipOptionalTask(); return;
      case "orchestration/schedule":
      case "orchestration/conflicts": await this.sendSuccess(request.requestId, this.services.orchestration.schedule(request.payload.orchestrationId)); return;
      case "orchestration/approvals": await this.sendSuccess(request.requestId, this.services.orchestration.get(request.payload.orchestrationId)?.approvalGates ?? []); return;
      case "orchestration/approve":
      case "orchestration/reject":
      case "orchestration/requestChanges":
      case "orchestration/override": { const decision = request.type === "orchestration/approve" ? "approved" : request.type === "orchestration/reject" ? "rejected" : request.type === "orchestration/requestChanges" ? "changes-requested" : "overridden"; const value = await this.services.orchestration.decide(request.payload.orchestrationId, request.payload.gateId, decision, request.payload.reason, request.payload.riskAcknowledged); await this.orchestrationEvent("orchestration/approvalResolved", value, `Approval gate ${decision}.`); await this.sendSuccess(request.requestId, value); return; }
      case "orchestration/audit": await this.sendSuccess(request.requestId, this.services.orchestration.get(request.payload.orchestrationId)?.audit ?? []); return;
      case "orchestration/qaPlan":
      case "orchestration/qaRun": await this.sendSuccess(request.requestId, this.services.orchestration.reviewPlan(request.payload.orchestrationId, "qa")); return;
      case "orchestration/securityPlan":
      case "orchestration/securityRun": await this.sendSuccess(request.requestId, this.services.orchestration.reviewPlan(request.payload.orchestrationId, "security")); return;
      case "orchestration/performancePlan":
      case "orchestration/performanceRun": await this.sendSuccess(request.requestId, this.services.orchestration.reviewPlan(request.payload.orchestrationId, "performance")); return;
      case "orchestration/validationPlan":
      case "orchestration/runValidation":
      case "orchestration/rerunValidation": await this.sendSuccess(request.requestId, this.services.orchestration.reviewPlan(request.payload.orchestrationId, "validation")); return;
      case "orchestration/cancelValidation": await this.sendSuccess(request.requestId); return;
      case "orchestration/qaAccept":
      case "orchestration/securityAccept":
      case "orchestration/performanceAccept": { const value = await this.services.orchestration.resolveFinding(request.payload.orchestrationId, request.payload.findingId, "accepted", request.payload.reason); await this.sendSuccess(request.requestId, value); return; }
      case "orchestration/qaReturn": { const value = await this.services.orchestration.resolveFinding(request.payload.orchestrationId, request.payload.findingId, "rejected", request.payload.reason); await this.sendSuccess(request.requestId, value); return; }
      case "orchestration/qaFinding":
      case "orchestration/securityFinding":
      case "orchestration/performanceFinding": { const value = this.services.orchestration.get(request.payload.orchestrationId); if (!value) throw new Error("Orchestration instance not found."); await this.sendSuccess(request.requestId, value); return; }
      case "orchestration/metrics": await this.sendSuccess(request.requestId, this.services.orchestration.get(request.payload.orchestrationId)?.metrics ?? { workflowDurationMs: 0, waitingForUserMs: 0, delegationCount: 0, validationDurationMs: 0, retryCount: 0, staleCount: 0, cancellationCount: 0, approvalCount: 0 }); return;
      case "orchestration/report": { const value = this.services.orchestration.get(request.payload.orchestrationId); if (!value) throw new Error("Orchestration instance not found."); await this.sendSuccess(request.requestId, value); return; }
      case "execution/route":
        await this.sendSuccess(request.requestId, this.services.routing.decide(request.payload)); return;
      case "request/cancel":
        this.queryControllers.get(request.payload.targetRequestId)?.abort();
        await this.sendSuccess(request.requestId);
        return;
    }
  }

  private requireChangeSet(id: string) { const value = this.services.delivery.getChangeSet(id); if (!value) throw new Error("Delivery change set not found."); return value; }
  private ensureWorkspaceTrust(request: WebviewRequest): void {
    // Production always supplies the trust provider. Treat an omitted provider in
    // isolated read-only harnesses as trusted for backwards-compatible tests.
    if (this.services.workspaceTrusted?.() !== false) return;
    const blocked = new Set<WebviewRequest["type"]>([
      "delegation/approve", "delegation/start", "delegation/openCopilot", "delegation/copyPrompt", "delegation/confirmStarted",
      "execution/start", "execution/confirmStarted", "execution/captureResult", "retry/start", "retry/manualRepair",
      "validation/approveCommand", "validation/run", "validation/rerunStep", "validation/override",
      "git/stage", "git/unstage", "git/createBranch", "git/commit", "git/push", "pullRequest/approve", "pullRequest/create", "pullRequest/confirmExternalCreation",
      "orchestration/start", "orchestration/startTask", "orchestration/retryTask",
    ]);
    if (request.type === "handoff/export" && request.payload.mode === "repository-artifact") blocked.add(request.type);
    if (!blocked.has(request.type)) return;
    throw new KeystoneError({ code: "WORKSPACE_TRUST_REQUIRED", category: "WORKSPACE", message: "Keystone blocked an executable, external-delegation, or repository-mutating action in Restricted Mode.", operation: request.type, recoverable: true, recommendedAction: "Trust the workspace after reviewing its contents, then retry the explicitly approved action.", retryable: true, correlationId: request.requestId });
  }
  private async orchestrationEvent(type: "orchestration/created" | "orchestration/planned" | "orchestration/started" | "orchestration/paused" | "orchestration/resumed" | "orchestration/cancelled" | "orchestration/recovered" | "orchestration/approvalResolved" | "orchestration/taskStarted" | "orchestration/taskBlocked" | "orchestration/taskProgress", value: WorkflowInstance, message: string, taskId?: string): Promise<void> { await this.postMessage(hostMessage(type, { orchestrationId: value.id, status: value.status, ...(value.currentStage ? { stage: value.currentStage } : {}), ...(taskId ? { taskId } : {}), message, at: new Date().toISOString() })); }
  private requireCommitPlan(id: string) { const value = this.services.delivery.getCommitPlan(id); if (!value) throw new Error("Commit plan not found."); return value; }
  private requireDraft(id: string) { const value = this.services.delivery.getDraft(id); if (!value) throw new Error("Pull-request draft not found."); return value; }

  private async sendWorkflow(
    requestId: string,
    workflow: DevelopmentWorkflowSnapshot,
    message: string,
  ): Promise<void> {
    await this.postMessage(
      hostMessage("workflow/updated", workflowEvent(workflow, message)),
    );
    await this.sendSuccess(requestId, workflow);
  }

  private async reconcileDelegationState(generation: number): Promise<void> {
    for (const current of this.services.workflow.list()) {
      try {
        const workflow = await this.services.workflow.reconcileStaleness(
          current.id,
        );
        const staleAssignments = await this.services.team.reconcileStaleness(current.id);
        for (const assignment of staleAssignments) await this.postMessage(hostMessage("assignment/stale", { assignmentId: assignment.id, message: "Assignment became stale after canonical workflow or repository state changed." }));
        const staleTasks = workflow.tasks.filter(
          (task) => task.status === "stale",
        );
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
        this.logger.error(
          KeystoneError.fromUnknown(cause, "workflow.reconcile.generation"),
        );
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
    budget: Partial<ContextBudget> | undefined,
    pinnedEntityIds: string[] | undefined,
    pinnedFiles: string[] | undefined,
    requestId: string,
  ) {
    const { task, specification } = resolveTask(
      this.services.workflow,
      workflowId,
      taskId,
    );
    const controller = new AbortController();
    this.queryControllers.set(requestId, controller);
    try {
      await this.postMessage(
        hostMessage("context/buildProgress", {
          taskId,
          progress: 30,
          message:
            "Ranking repository entities, tests, relationships, and source ranges.",
        }),
      );
      return await this.services.context.build({
        task,
        specification,
        selectedAgentId: task.assignedAgentId,
        budget,
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

  private async sendError(
    requestId: string,
    error: KeystoneError,
  ): Promise<void> {
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
  if (
    raw &&
    typeof raw === "object" &&
    "requestId" in raw &&
    typeof raw.requestId === "string"
  )
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
  if (!workflow.specification)
    throw new Error("The workflow has no specification.");
  return { workflow, task, specification: workflow.specification };
}
