import { HostMessageSchema, hostMessage, type HostMessage, type WebviewRequest } from "../../shared/contracts/messages";
import { SCHEMA_VERSION, type BootstrapSnapshot, type PersistedFoundationState } from "../../shared/contracts/domain";

interface VsCodeApi {
  postMessage(message: unknown): void;
  getState(): unknown;
  setState(state: unknown): void;
}

declare function acquireVsCodeApi(): VsCodeApi;

type RequestType = WebviewRequest["type"];
type PayloadFor<T extends RequestType> = Extract<WebviewRequest, { type: T }>["payload"];
type Listener = (message: HostMessage) => void;

export class HostBridge {
  private readonly pending = new Map<string, { resolve: (value: unknown) => void; reject: (reason: Error) => void; timer: number }>();
  private readonly listeners = new Set<Listener>();

  constructor(private readonly api: VsCodeApi) {
    window.addEventListener("message", this.receive);
  }

  request<T extends RequestType>(type: T, payload: PayloadFor<T>): Promise<unknown> {
    const requestId = crypto.randomUUID();
    const request = { requestId, type, timestamp: new Date().toISOString(), schemaVersion: SCHEMA_VERSION, payload } as WebviewRequest;
    return new Promise((resolve, reject) => {
      const timer = window.setTimeout(() => {
        this.pending.delete(requestId);
        reject(new Error(`Keystone host request timed out: ${type}`));
      }, 15_000);
      this.pending.set(requestId, { resolve, reject, timer });
      this.api.postMessage(request);
    });
  }

  subscribe(listener: Listener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  dispose(): void {
    window.removeEventListener("message", this.receive);
    for (const request of this.pending.values()) window.clearTimeout(request.timer);
    this.pending.clear();
    this.listeners.clear();
  }

  private readonly receive = (event: MessageEvent<unknown>): void => {
    const parsed = HostMessageSchema.safeParse(event.data);
    if (!parsed.success) return;
    const message: HostMessage = parsed.data;
    if (message.type === "response/success" || message.type === "response/error") {
      const pending = this.pending.get(message.payload.requestId);
      if (pending) {
        window.clearTimeout(pending.timer);
        this.pending.delete(message.payload.requestId);
        if (message.type === "response/success") pending.resolve(message.payload.data);
        else pending.reject(new Error(`${message.payload.error.message} ${message.payload.error.recommendedAction}`));
      }
    }
    for (const listener of this.listeners) listener(message);
  };
}

export function createHostBridge(): HostBridge {
  if (typeof acquireVsCodeApi === "function") return new HostBridge(acquireVsCodeApi());
  if (import.meta.env.DEV) return new HostBridge(createPreviewApi());
  throw new Error("Keystone must run inside a VS Code Webview.");
}

function createPreviewApi(): VsCodeApi {
  let state: PersistedFoundationState = {
    schemaVersion: SCHEMA_VERSION,
    revision: 0,
    activeSection: "home",
    workflowCount: 0,
    updatedAt: new Date().toISOString()
  };
  const dispatch = (message: HostMessage): void => {
    window.dispatchEvent(new MessageEvent("message", { data: message }));
  };
  const success = (requestId: string): void => dispatch(hostMessage("response/success", { requestId }));

  return {
    getState: () => state,
    setState: (next) => {
      if (next && typeof next === "object") state = next as PersistedFoundationState;
    },
    postMessage: (message) => {
      const request = message as WebviewRequest;
      window.setTimeout(() => {
        if (request.type === "app/bootstrap") {
          const snapshot: BootstrapSnapshot = {
            extensionVersion: "0.1.0-dev",
            workspace: { name: "Local UI preview", rootCount: 1, trust: "trusted", indexStatus: "not-started" },
            state,
            activity: { operation: "Foundation preview", detail: "Local visual test mode; no repository operations are connected.", status: "completed", progress: 100, cancellable: false, updatedAt: new Date().toISOString() },
            implementation: { phase: 1, phaseName: "Extension foundation", completedTasks: ["T-101", "T-102", "T-103", "T-104", "T-105", "T-106", "T-107"], nextTask: "T-201 · Workspace, filesystem, Git, and language-service adapters" }
          };
          dispatch(hostMessage("bootstrap/ready", snapshot));
        }
        if (request.type === "navigation/set") {
          state = { ...state, activeSection: request.payload.section, revision: state.revision + 1, updatedAt: new Date().toISOString() };
          dispatch(hostMessage("state/updated", state));
        }
        success(request.requestId);
      }, 0);
    }
  };
}
