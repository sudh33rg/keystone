import type { ConfigurationService } from "../../core/configuration/ConfigurationService";
import type { WorkspaceStateStore } from "../../core/persistence/WorkspaceStateStore";
import {
  hostMessage,
  WebviewRequestSchema,
  type HostMessage,
  type WebviewRequest
} from "../../shared/contracts/messages";
import type { BootstrapSnapshot, WorkspaceSummary } from "../../shared/contracts/domain";
import { KeystoneError } from "../../shared/errors/KeystoneError";
import type { KeystoneLogger } from "../../shared/logging/KeystoneLogger";
import type { RepositoryIndexService } from "../../core/intelligence/RepositoryIndexService";
import type { AgentRegistry } from "../../core/copilot/AgentRegistry";
import type { ContextEngine } from "../../core/context/ContextEngine";
import type { TaskGraphService } from "../../core/tasks/TaskGraphService";
import type { WorkflowOrchestrator } from "../../core/workflows/WorkflowOrchestrator";
import type { ValidationEngine } from "../../core/validation/ValidationEngine";
import type { DelegationService } from "../../core/copilot/DelegationService";
import type { ContextPreviewService } from "../../core/context/ContextPreview";
import type { ExternalChangeDetector } from "../../core/tasks/ExternalChangeDetector";
import type { IntentEngine } from "../../core/intent/IntentEngine";
import type { SpecificationService } from "../../core/specifications/SpecificationService";

type PostMessage = (message: HostMessage) => Thenable<boolean>;

export interface ServiceRegistry {
  repositoryIndex: RepositoryIndexService;
  agentRegistry: AgentRegistry;
  contextEngine: ContextEngine;
  taskGraphService: TaskGraphService;
  workflowOrchestrator: WorkflowOrchestrator;
  validationEngine: ValidationEngine;
  delegationService: DelegationService;
  contextPreview: ContextPreviewService;
  externalChangeDetector: ExternalChangeDetector;
  intentEngine: IntentEngine;
  specificationService: SpecificationService;
}

export class WebviewMessageRouter {
  private readonly responses = new Map<string, HostMessage>();

  constructor(
    private readonly store: WorkspaceStateStore,
    private readonly configuration: ConfigurationService,
    private readonly logger: KeystoneLogger,
    private readonly extensionVersion: string,
    private readonly workspaceSummary: () => WorkspaceSummary,
    private readonly postMessage: PostMessage,
    private readonly services: ServiceRegistry
  ) {}

  async handle(raw: unknown): Promise<void> {
    const parsed = WebviewRequestSchema.safeParse(raw);
    if (!parsed.success) {
      const requestId = readRequestId(raw);
      const error = new KeystoneError({
        code: "WEBVIEW_MESSAGE_INVALID",
        category: "WEBVIEW",
        message: "Keystone rejected an invalid Webview request.",
        technicalDetails: parsed.error.issues.map((issue) => `${issue.path.join(".")}: ${issue.message}`).join("; "),
        operation: "webview.route",
        recoverable: true,
        recommendedAction: "Reload the Keystone view. If the problem continues, review the logs.",
        retryable: true,
        correlationId: requestId
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
      const error = KeystoneError.fromUnknown(cause, request.type, request.requestId);
      this.logger.error(error);
      await this.sendError(request.requestId, error);
    }
  }

  private async route(request: WebviewRequest): Promise<void> {
    switch (request.type) {
      case "app/bootstrap": {
        const bootstrap: BootstrapSnapshot = {
          extensionVersion: this.extensionVersion,
          workspace: this.workspaceSummary(),
          state: this.store.snapshot,
          activity: {
            operation: "Foundation + Intelligence ready",
            detail: "Repository intelligence, intent analysis, specification lifecycle, agents, context engine, task graph, validation, and delegation are available.",
            status: "completed",
            progress: 100,
            cancellable: false,
            updatedAt: new Date().toISOString()
          },
          implementation: {
            phase: 4,
            phaseName: "Agents, Context, Delegation + Validation",
            completedTasks: [
              "T-101", "T-102", "T-103", "T-104", "T-105", "T-106", "T-107",
              "T-201", "T-202", "T-203", "T-204", "T-205", "T-206", "T-207", "T-208",
              "T-301", "T-302", "T-303", "T-304", "T-305",
              "T-401", "T-402", "T-403", "T-404", "T-405", "T-406",
              "T-501", "T-502", "T-503", "T-504", "T-505",
              "T-601", "T-602", "T-603", "T-604", "T-605"
            ],
            nextTask: "T-701 · E2E coverage and security review"
          }
        };
        await this.postMessage(hostMessage("bootstrap/ready", bootstrap));
        await this.sendSuccess(request.requestId);
        break;
      }
      case "app/ping":
        await this.sendSuccess(request.requestId, { serverTime: new Date().toISOString() });
        break;
      case "navigation/set": {
        const state = await this.store.setActiveSection(request.payload.section);
        await this.postMessage(hostMessage("state/updated", state));
        await this.sendSuccess(request.requestId, state);
        break;
      }
      case "settings/open":
        await this.configuration.openSettings(request.payload.query);
        await this.sendSuccess(request.requestId);
        break;
      case "logs/show":
        this.logger.show();
        await this.sendSuccess(request.requestId);
        break;
      case "index/start": {
        const branch = request.payload.branch ?? "main";
        await this.services.repositoryIndex.start(branch, {
          onProgress: (stage) => this.logger?.info("index.progress", `Indexing: ${stage}`),
          onComplete: (index) => this.logger?.info("index.complete", "Repository indexing complete."),
          onError: (error) => this.logger?.error("index.error", "Indexing failed.")
        });
        await this.sendSuccess(request.requestId);
        break;
      }
      case "index/cancel": {
        this.services.repositoryIndex.cancel();
        await this.sendSuccess(request.requestId);
        break;
      }
      case "intent/analyze": {
        const analysis = this.services.intentEngine.analyze(
          request.payload.text,
          request.payload.mode ?? "full",
          this.workspaceSummary().rootPath
        );
        await this.postMessage(hostMessage("intent/updated", analysis));
        await this.sendSuccess(request.requestId, analysis);
        break;
      }
      case "spec/create": {
        const spec = this.services.specificationService.create(
          request.payload.intentId,
          request.payload.title,
          request.payload.workflowId
        );
        await this.postMessage(hostMessage("spec/updated", spec));
        await this.sendSuccess(request.requestId, spec);
        break;
      }
      case "spec/approve": {
        const spec = this.services.specificationService.approve(
          request.payload.specificationId,
          request.payload.expectedRevision
        );
        await this.postMessage(hostMessage("spec/updated", spec));
        await this.sendSuccess(request.requestId, spec);
        break;
      }
      case "agent/assign": {
        const assignment = this.services.agentRegistry.assign(
          request.payload.taskId,
          request.payload.workflowId,
          request.payload.agentId
        );
        await this.postMessage(hostMessage("agent/updated", assignment));
        await this.sendSuccess(request.requestId, assignment);
        break;
      }
      case "agent/select": {
        const selection = this.services.agentRegistry.select(request.payload.taskId);
        await this.sendSuccess(request.requestId, selection);
        break;
      }
      case "context/build": {
        const result = await this.services.contextEngine.buildPackage(
          request.payload.taskId,
          request.payload.specificationRevision,
          request.payload.baseCommit,
          request.payload.pinnedItems
        );
        await this.postMessage(hostMessage("context/updated", result.package));
        await this.sendSuccess(request.requestId, result);
        break;
      }
      case "context/preview": {
        const preview = this.services.contextPreview.generatePreview(request.payload.package);
        await this.sendSuccess(request.requestId, preview);
        break;
      }
      case "task/graph": {
        const graph = this.services.taskGraphService.generateFromSpecification(
          request.payload.specificationId,
          request.payload.specificationRevision,
          []
        );
        await this.postMessage(hostMessage("task/updated", graph));
        await this.sendSuccess(request.requestId, graph);
        break;
      }
      case "task/transition": {
        const task = this.services.taskGraphService.transitionTask(
          request.payload.taskId,
          request.payload.from,
          request.payload.to
        );
        await this.postMessage(hostMessage("task/updated", task));
        await this.sendSuccess(request.requestId, task);
        break;
      }
      case "workflow/start": {
        const workflow = this.services.workflowOrchestrator.startWorkflow(request.payload.workflow);
        await this.postMessage(hostMessage("workflow/updated", workflow));
        await this.sendSuccess(request.requestId, workflow);
        break;
      }
      case "workflow/pause": {
        const workflow = this.services.workflowOrchestrator.pauseWorkflow(request.payload.workflowId);
        await this.postMessage(hostMessage("workflow/updated", workflow));
        await this.sendSuccess(request.requestId, workflow);
        break;
      }
      case "workflow/cancel": {
        const workflow = this.services.workflowOrchestrator.cancelWorkflow(request.payload.workflowId);
        await this.postMessage(hostMessage("workflow/updated", workflow));
        await this.sendSuccess(request.requestId, workflow);
        break;
      }
      case "validation/plan": {
        const plan = await this.services.validationEngine.plan(
          request.payload.workflowId,
          request.payload.specificationRevision,
          request.payload.taskIds
        );
        await this.sendSuccess(request.requestId, plan);
        break;
      }
      case "validation/run": {
        const run = await this.services.validationEngine.run(
          request.payload.runId,
          request.payload.commands
        );
        await this.postMessage(hostMessage("validation/updated", run));
        await this.sendSuccess(request.requestId, run);
        break;
      }
      case "delegation/delegate": {
        const outcome = await this.services.delegationService.delegate(
          request.payload.taskId,
          request.payload.workflowId,
          request.payload.task,
          request.payload.specificationRevision
        );
        await this.sendSuccess(request.requestId, outcome);
        break;
      }
      case "change/detect": {
        const change = this.services.externalChangeDetector.detectChanges(request.payload.taskId);
        await this.sendSuccess(request.requestId, change);
        break;
      }
    }
  }

  private async sendSuccess(requestId: string, data?: unknown): Promise<void> {
    const response = hostMessage("response/success", { requestId, data });
    this.remember(requestId, response);
    await this.postMessage(response);
  }

  private async sendError(requestId: string, error: KeystoneError): Promise<void> {
    const response = hostMessage("response/error", { requestId, error: error.serialize() });
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
  if (raw && typeof raw === "object" && "requestId" in raw && typeof raw.requestId === "string") {
    return raw.requestId;
  }
  return crypto.randomUUID();
}
