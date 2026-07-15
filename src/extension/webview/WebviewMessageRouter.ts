import type { ConfigurationService } from "../../core/configuration/ConfigurationService";
import type { IntelligenceQueryService } from "../../core/intelligence/IntelligenceQueryService";
import type { IntelligenceRuntime } from "../../core/intelligence/runtime/IntelligenceRuntime";
import type { WorkspaceStateStore } from "../../core/persistence/WorkspaceStateStore";
import type { BootstrapSnapshot, WorkspaceSummary } from "../../shared/contracts/domain";
import { hostMessage, WebviewRequestSchema, type HostMessage, type WebviewRequest } from "../../shared/contracts/messages";
import { KeystoneError } from "../../shared/errors/KeystoneError";
import type { KeystoneLogger } from "../../shared/logging/KeystoneLogger";
import type { CpgQueryService } from "../../core/intelligence/cpg/CpgQueryService";
import type { IntelligenceQuery } from "../../shared/contracts/query";

type PostMessage = (message: HostMessage) => Thenable<boolean>;

export interface IntelligenceServiceRegistry {
  intelligenceRuntime: IntelligenceRuntime;
  intelligenceQuery: IntelligenceQueryService;
  cpgQuery: CpgQueryService;
  openSource(relativePath: string, range?: { startLine: number; startColumn: number; endLine: number; endColumn: number }): Promise<void>;
}

export class WebviewMessageRouter {
  private readonly responses = new Map<string, HostMessage>();
  private readonly queryControllers = new Map<string, AbortController>();
  private readonly runtimeSubscription: { dispose(): void };
  private runtimeEventRevision = 0;
  private lastQueryGeneration = 0;

  constructor(
    private readonly store: WorkspaceStateStore,
    private readonly configuration: ConfigurationService,
    private readonly logger: KeystoneLogger,
    private readonly extensionVersion: string,
    private readonly workspaceSummary: () => WorkspaceSummary,
    private readonly postMessage: PostMessage,
    private readonly services: IntelligenceServiceRegistry
  ) {
    this.runtimeSubscription = services.intelligenceRuntime.onDidChange((state) => {
      const eventRevision = ++this.runtimeEventRevision;
      void this.postMessage(hostMessage("intelligence/runtime", state));
      void this.services.intelligenceQuery.overview().then((overview) => {
        if (eventRevision === this.runtimeEventRevision) {
          void this.postMessage(hostMessage("intelligence/updated", overview));
          if (this.lastQueryGeneration && overview.generation && overview.generation !== this.lastQueryGeneration) void this.postMessage(hostMessage("intelligence/queryInvalidated", { queryId: crypto.randomUUID(), generation: overview.generation, message: `Query cache invalidated by generation ${overview.generation}.` }));
          if (overview.generation) this.lastQueryGeneration = overview.generation;
        }
      }).catch((cause: unknown) => this.logger.error(KeystoneError.fromUnknown(cause, "intelligence.overview.event")));
    });
  }

  dispose(): void {
    this.runtimeSubscription.dispose();
    for (const controller of this.queryControllers.values()) controller.abort();
    this.queryControllers.clear();
    this.responses.clear();
  }

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
            operation: "Continuous repository intelligence",
            detail: "The last complete local generation remains available while background reconciliation runs.",
            status: "completed",
            progress: 100,
            cancellable: false,
            updatedAt: new Date().toISOString()
          },
          implementation: {
            phase: 6,
            phaseName: "Complete deterministic query engine",
            completedTasks: ["Continuous ingestion", "TypeScript semantic graph", "Progressive CPG", "Evidence-backed universal adapters", "Bounded explainable queries"],
            nextTask: "Milestone 7 · OKF projection"
          }
        };
        await this.postMessage(hostMessage("bootstrap/ready", bootstrap));
        await this.sendSuccess(request.requestId, bootstrap);
        return;
      }
      case "app/ping":
        await this.sendSuccess(request.requestId, { serverTime: new Date().toISOString() });
        return;
      case "navigation/set": {
        const state = await this.store.setActiveSection(request.payload.section);
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
        await this.sendSuccess(request.requestId, await this.cancellableQuery(request.requestId, (signal) => this.services.intelligenceQuery.search(request.payload, signal)));
        return;
      case "intelligence/entity":
        await this.sendSuccess(request.requestId, await this.cancellableQuery(request.requestId, (signal) => this.services.intelligenceQuery.entity(request.payload.id, signal)));
        return;
      case "intelligence/neighborhood":
        await this.sendSuccess(request.requestId, await this.cancellableQuery(request.requestId, (signal) => this.services.intelligenceQuery.neighborhood(request.payload, signal)));
        return;
      case "intelligence/technologies":
        await this.sendSuccess(request.requestId, await this.cancellableQuery(request.requestId, (signal) => this.services.intelligenceQuery.technologies(request.payload, signal)));
        return;
      case "intelligence/adapter-diagnostics":
        await this.sendSuccess(request.requestId, await this.cancellableQuery(request.requestId, (signal) => this.services.intelligenceQuery.adapterDiagnostics(request.payload, signal)));
        return;
      case "intelligence/query":
        await this.sendSuccess(request.requestId, await this.runUnifiedQuery(request.requestId, request.payload));
        return;
      case "intelligence/query/compile":
        await this.sendSuccess(request.requestId, this.services.intelligenceQuery.compile(request.payload));
        return;
      case "intelligence/query/cancel":
        this.queryControllers.get(request.payload.queryId)?.abort();
        await this.postMessage(hostMessage("intelligence/queryCancelled", { queryId: request.payload.queryId, message: "Query cancellation requested." }));
        await this.sendSuccess(request.requestId);
        return;
      case "intelligence/query/suggestions":
        await this.sendSuccess(request.requestId, await this.cancellableQuery(request.requestId, (signal) => this.services.intelligenceQuery.suggestions(request.payload, signal)));
        return;
      case "intelligence/query/templates":
        await this.sendSuccess(request.requestId, this.services.intelligenceQuery.templates());
        return;
      case "intelligence/query/explanation":
        await this.sendSuccess(request.requestId, this.services.intelligenceQuery.explanation(request.payload.queryId));
        return;
      case "intelligence/path":
        await this.sendSuccess(request.requestId, await this.runUnifiedQuery(request.requestId, { query: { ...request.payload, operation: "PATH" } }));
        return;
      case "intelligence/impact":
        await this.sendSuccess(request.requestId, await this.runUnifiedQuery(request.requestId, { query: { ...request.payload, operation: "IMPACT" } }));
        return;
      case "intelligence/flow":
        await this.sendSuccess(request.requestId, await this.runUnifiedQuery(request.requestId, { query: { ...request.payload, operation: "FLOW" } }));
        return;
      case "intelligence/architecture":
        await this.sendSuccess(request.requestId, await this.runUnifiedQuery(request.requestId, { query: request.payload }));
        return;
      case "intelligence/dependencies":
        await this.sendSuccess(request.requestId, await this.runUnifiedQuery(request.requestId, { query: request.payload }));
        return;
      case "intelligence/tests":
        await this.sendSuccess(request.requestId, await this.runUnifiedQuery(request.requestId, { query: request.payload }));
        return;
      case "intelligence/changes":
        await this.sendSuccess(request.requestId, await this.runUnifiedQuery(request.requestId, { query: request.payload }));
        return;
      case "intelligence/cpg":
        await this.sendSuccess(request.requestId, await this.runUnifiedQuery(request.requestId, { query: request.payload }));
        return;
      case "intelligence/cpg/scope":
        await this.sendSuccess(request.requestId, await this.cancellableQuery(request.requestId, (signal) => this.services.cpgQuery.scope(request.payload, signal)));
        return;
      case "intelligence/cpg/slice":
        await this.sendSuccess(request.requestId, await this.cancellableQuery(request.requestId, (signal) => this.services.cpgQuery.slice(request.payload, signal)));
        return;
      case "intelligence/source/open":
        await this.services.openSource(request.payload.relativePath, request.payload.range);
        await this.sendSuccess(request.requestId);
        return;
      case "request/cancel":
        this.queryControllers.get(request.payload.targetRequestId)?.abort();
        await this.sendSuccess(request.requestId);
        return;
    }
  }

  private async sendSuccess(requestId: string, data?: unknown): Promise<void> {
    const response = hostMessage("response/success", { requestId, ...(data === undefined ? {} : { data }) });
    this.remember(requestId, response);
    await this.postMessage(response);
  }

  private async cancellableQuery<T>(requestId: string, query: (signal: AbortSignal) => Promise<T>): Promise<T> {
    const controller = new AbortController();
    this.queryControllers.set(requestId, controller);
    try { return await query(controller.signal); }
    finally { this.queryControllers.delete(requestId); }
  }

  private async runUnifiedQuery(requestId: string, payload: { text?: string; query?: IntelligenceQuery; currentFile?: string }): Promise<Awaited<ReturnType<IntelligenceQueryService["unified"]>>> {
    const operation = payload.query?.operation;
    await this.postMessage(hostMessage("intelligence/queryStarted", { queryId: requestId, ...(operation ? { operation } : {}), message: "Deterministic intelligence query started." }));
    await this.postMessage(hostMessage("intelligence/queryProgress", { queryId: requestId, ...(operation ? { operation } : {}), progress: 10, message: "Resolving generation and seed entities." }));
    try {
      const result = await this.cancellableQuery(requestId, (signal) => this.services.intelligenceQuery.unified(payload, signal, requestId));
      this.lastQueryGeneration = result.generation;
      await this.postMessage(hostMessage("intelligence/queryCompleted", { queryId: requestId, operation: result.operation, generation: result.generation, progress: 100, message: `Query completed in ${result.executionTimeMs.toFixed(1)} ms.` }));
      return result;
    } catch (cause) {
      if (cause instanceof Error && cause.name === "AbortError") await this.postMessage(hostMessage("intelligence/queryCancelled", { queryId: requestId, ...(operation ? { operation } : {}), message: "Query cancelled." }));
      else await this.postMessage(hostMessage("intelligence/queryFailed", { queryId: requestId, ...(operation ? { operation } : {}), message: cause instanceof Error ? cause.message : String(cause) }));
      throw cause;
    }
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
  if (raw && typeof raw === "object" && "requestId" in raw && typeof raw.requestId === "string") return raw.requestId;
  return crypto.randomUUID();
}
