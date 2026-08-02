declare const acquireVsCodeApi: undefined | (() => { postMessage(message: unknown): void });

type Listener = (message: unknown) => void;
const listeners = new Set<Listener>();
const nativeApi = typeof acquireVsCodeApi === "function" ? acquireVsCodeApi() : undefined;
let lastStateVersion = 1;

function deliver(message: unknown): void {
  if (
    message &&
    typeof message === "object" &&
    (message as { type?: string }).type === "APPLICATION_STATE"
  ) {
    const version = Number((message as { state?: { version?: number } }).state?.version);
    if (Number.isSafeInteger(version) && version > 0) lastStateVersion = version;
  }
  window.dispatchEvent(new MessageEvent("message", { data: message }));
  for (const listener of listeners) listener(message);
}

if (!nativeApi && typeof EventSource !== "undefined") {
  const source = new EventSource("/events", { withCredentials: true });
  source.addEventListener("message", (event) =>
    deliver(JSON.parse((event as MessageEvent<string>).data) as unknown)
  );
  source.addEventListener("error", () => {
    // EventSource reconnects automatically and receives a current state snapshot.
  });
}

async function postBrowserMessage(message: unknown): Promise<void> {
  const response = await fetch("/command", {
    method: "POST",
    credentials: "same-origin",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ message, expectedStateVersion: lastStateVersion })
  });
  if (response.status === 409) {
    const stateResponse = await fetch("/state", { credentials: "same-origin" });
    if (stateResponse.ok) deliver({ type: "APPLICATION_STATE", state: await stateResponse.json() });
    deliver({
      type: "NOTIFICATION",
      level: "error",
      message:
        "The Browser View was refreshed because another surface changed Keystone state. Retry the action."
    });
    return;
  }
  if (!response.ok) {
    const detail = (await response.json().catch(() => ({}))) as { error?: string };
    deliver({
      type: "NOTIFICATION",
      level: "error",
      message: detail.error ?? `Browser View command failed (${response.status}).`
    });
    return;
  }
  const result = (await response.json().catch(() => ({}))) as { stateVersion?: number };
  if (Number.isSafeInteger(result.stateVersion) && Number(result.stateVersion) > lastStateVersion)
    lastStateVersion = Number(result.stateVersion);
}

export const vscode = {
  postMessage(message: unknown): void {
    if (nativeApi) {
      nativeApi.postMessage(message);
      return;
    }
    void postBrowserMessage(message);
  },
  onMessage(listener: Listener): () => void {
    listeners.add(listener);
    return () => listeners.delete(listener);
  },
  surface: nativeApi ? ("vscode" as const) : ("browser" as const)
};
