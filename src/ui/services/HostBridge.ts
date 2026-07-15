import { BootstrapSnapshotSchema, PersistedFoundationStateSchema, SCHEMA_VERSION, type BootstrapSnapshot, type PersistedFoundationState } from "../../shared/contracts/domain";
import { IntelligenceEntityDetailsSchema, IntelligenceNeighborhoodSchema, IntelligenceOverviewSchema, IntelligenceSearchResultSchema, emptyIntelligenceOverview, type IntelligenceOverview } from "../../shared/contracts/intelligence";
import {
  HostMessageSchema,
  hostMessage,
  type HostMessage,
  type WebviewPayload,
  type WebviewRequest,
  type WebviewRequestType,
  type WebviewResult
} from "../../shared/contracts/messages";
import { CpgQueryResultSchema, CpgSliceResultSchema } from "../../shared/contracts/cpg";
import { IntelligenceQueryResultSchema, QueryCompilationSchema, QueryExplanationSchema, QuerySuggestionsResultSchema, QueryTemplatesResultSchema } from "../../shared/contracts/query";

interface VsCodeApi {
  postMessage(message: unknown): void;
  getState(): unknown;
  setState(state: unknown): void;
}

declare function acquireVsCodeApi(): VsCodeApi;

type Listener = (message: HostMessage) => void;

interface PendingRequest {
  type: WebviewRequestType;
  resolve(value: unknown): void;
  reject(reason: Error): void;
  timer: number;
  removeAbort?: () => void;
}

export class HostBridge {
  private readonly pending = new Map<string, PendingRequest>();
  private readonly listeners = new Set<Listener>();

  constructor(private readonly api: VsCodeApi) {
    window.addEventListener("message", this.receive);
  }

  request<T extends WebviewRequestType>(type: T, payload: WebviewPayload<T>, options?: { signal?: AbortSignal }): Promise<WebviewResult<T>> {
    const requestId = crypto.randomUUID();
    const request = { requestId, type, timestamp: new Date().toISOString(), schemaVersion: SCHEMA_VERSION, payload } as WebviewRequest;
    return new Promise<WebviewResult<T>>((resolve, reject) => {
      if (options?.signal?.aborted) {
        reject(new DOMException("The Keystone request was cancelled.", "AbortError"));
        return;
      }
      const timer = window.setTimeout(() => {
        this.settle(requestId);
        reject(new Error(`Keystone host request timed out: ${type}`));
        this.postCancellation(requestId);
      }, 15_000);
      const pending: PendingRequest = { type, resolve, reject, timer };
      if (options?.signal) {
        const abort = (): void => {
          this.settle(requestId);
          reject(new DOMException("The Keystone request was cancelled.", "AbortError"));
          this.postCancellation(requestId);
        };
        options.signal.addEventListener("abort", abort, { once: true });
        pending.removeAbort = () => options.signal?.removeEventListener("abort", abort);
      }
      this.pending.set(requestId, pending);
      this.api.postMessage(request);
    });
  }

  subscribe(listener: Listener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  dispose(): void {
    window.removeEventListener("message", this.receive);
    for (const [requestId, request] of this.pending) {
      window.clearTimeout(request.timer);
      request.removeAbort?.();
      request.reject(new Error("The Keystone Webview was disposed."));
      this.pending.delete(requestId);
    }
    this.listeners.clear();
  }

  private readonly receive = (event: MessageEvent<unknown>): void => {
    const parsed = HostMessageSchema.safeParse(event.data);
    if (!parsed.success) return;
    const message = parsed.data;
    if (message.type === "response/success" || message.type === "response/error") {
      const pending = this.pending.get(message.payload.requestId);
      if (pending) {
        this.settle(message.payload.requestId);
        if (message.type === "response/success") {
          try {
            pending.resolve(validateResult(pending.type, message.payload.data));
          } catch (cause) {
            pending.reject(cause instanceof Error ? cause : new Error(String(cause)));
          }
        } else {
          pending.reject(new Error(`${message.payload.error.message} ${message.payload.error.recommendedAction}`));
        }
      }
    }
    for (const listener of this.listeners) listener(message);
  };

  private settle(requestId: string): void {
    const pending = this.pending.get(requestId);
    if (!pending) return;
    window.clearTimeout(pending.timer);
    pending.removeAbort?.();
    this.pending.delete(requestId);
  }

  private postCancellation(targetRequestId: string): void {
    this.api.postMessage({
      requestId: crypto.randomUUID(),
      type: "request/cancel",
      timestamp: new Date().toISOString(),
      schemaVersion: SCHEMA_VERSION,
      payload: { targetRequestId }
    } satisfies WebviewRequest);
  }
}

export function createHostBridge(): HostBridge {
  if (typeof acquireVsCodeApi === "function") return new HostBridge(acquireVsCodeApi());
  if (import.meta.env.DEV) return new HostBridge(createPreviewApi());
  throw new Error("Keystone must run inside a VS Code Webview.");
}

function validateResult(type: WebviewRequestType, value: unknown): unknown {
  switch (type) {
    case "app/bootstrap": return BootstrapSnapshotSchema.parse(value);
    case "navigation/set": return PersistedFoundationStateSchema.parse(value);
    case "intelligence/overview": return IntelligenceOverviewSchema.parse(value);
    case "intelligence/search": return IntelligenceSearchResultSchema.parse(value);
    case "intelligence/entity": return value === undefined ? undefined : IntelligenceEntityDetailsSchema.parse(value);
    case "intelligence/neighborhood": return IntelligenceNeighborhoodSchema.parse(value);
    case "intelligence/cpg/scope": return value === undefined ? undefined : CpgQueryResultSchema.parse(value);
    case "intelligence/cpg/slice": return value === undefined ? undefined : CpgSliceResultSchema.parse(value);
    case "intelligence/query":
    case "intelligence/path":
    case "intelligence/impact":
    case "intelligence/flow":
    case "intelligence/architecture":
    case "intelligence/dependencies":
    case "intelligence/tests":
    case "intelligence/changes":
    case "intelligence/cpg": return IntelligenceQueryResultSchema.parse(value);
    case "intelligence/query/compile": return QueryCompilationSchema.parse(value);
    case "intelligence/query/suggestions": return QuerySuggestionsResultSchema.parse(value);
    case "intelligence/query/templates": return QueryTemplatesResultSchema.parse(value);
    case "intelligence/query/explanation": return value === undefined ? undefined : QueryExplanationSchema.parse(value);
    case "app/ping": return value;
    case "intelligence/scan/start": return value;
    case "settings/open":
    case "logs/show":
    case "intelligence/scan/cancel":
    case "intelligence/runtime/pause":
    case "intelligence/runtime/resume":
    case "intelligence/source/open":
    case "intelligence/query/cancel":
    case "request/cancel": return undefined;
  }
}

function createPreviewApi(): VsCodeApi {
  let state: PersistedFoundationState = {
    schemaVersion: SCHEMA_VERSION,
    revision: 0,
    activeSection: "home",
    workflowCount: 0,
    updatedAt: new Date().toISOString()
  };
  let overview: IntelligenceOverview = emptyIntelligenceOverview("not-indexed");
  const dispatch = (message: HostMessage): void => { window.dispatchEvent(new MessageEvent("message", { data: message })); };
  return {
    getState: () => state,
    setState: (next) => { if (next && typeof next === "object") state = next as PersistedFoundationState; },
    postMessage: (message) => {
      const request = message as WebviewRequest;
      window.setTimeout(() => {
        let data: unknown;
        if (request.type === "app/bootstrap") {
          const snapshot: BootstrapSnapshot = {
            extensionVersion: "0.1.0-dev",
            workspace: { name: "Local UI preview", rootCount: 1, trust: "trusted", indexStatus: overview.status },
            state,
            activity: { operation: "Intelligence preview", detail: "Local visual test mode.", status: "completed", progress: 100, cancellable: false, updatedAt: new Date().toISOString() },
            implementation: { phase: 6, phaseName: "Complete deterministic query engine", completedTasks: ["Semantic graph", "Local CPG", "Universal adapters", "Bounded explainable queries"], nextTask: "OKF projection" }
          };
          dispatch(hostMessage("bootstrap/ready", snapshot));
          data = snapshot;
        } else if (request.type === "navigation/set") {
          state = { ...state, activeSection: request.payload.section, revision: state.revision + 1, updatedAt: new Date().toISOString() };
          dispatch(hostMessage("state/updated", state));
          data = state;
        } else if (request.type === "intelligence/overview") {
          dispatch(hostMessage("intelligence/updated", overview));
          data = overview;
        } else if (request.type === "intelligence/scan/start") {
          overview = { ...emptyIntelligenceOverview("scanning", true) };
          dispatch(hostMessage("intelligence/updated", overview));
          data = { scanRevision: 1 };
        } else if (request.type === "app/ping") data = { serverTime: new Date().toISOString() };
        dispatch(hostMessage("response/success", { requestId: request.requestId, ...(data === undefined ? {} : { data }) }));
      }, 0);
    }
  };
}
