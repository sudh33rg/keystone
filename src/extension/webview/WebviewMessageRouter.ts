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

type PostMessage = (message: HostMessage) => Thenable<boolean>;

export class WebviewMessageRouter {
  private readonly responses = new Map<string, HostMessage>();

  constructor(
    private readonly store: WorkspaceStateStore,
    private readonly configuration: ConfigurationService,
    private readonly logger: KeystoneLogger,
    private readonly extensionVersion: string,
    private readonly workspaceSummary: () => WorkspaceSummary,
    private readonly postMessage: PostMessage
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
            operation: "Foundation ready",
            detail: "The secure extension shell is active. Repository intelligence is the next implementation phase.",
            status: "completed",
            progress: 100,
            cancellable: false,
            updatedAt: new Date().toISOString()
          },
          implementation: {
            phase: 1,
            phaseName: "Extension foundation",
            completedTasks: ["T-101", "T-102", "T-103", "T-104", "T-105", "T-106", "T-107"],
            nextTask: "T-201 · Workspace, filesystem, Git, and language-service adapters"
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
