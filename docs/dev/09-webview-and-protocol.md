# 09 — Webview UI and the Message Protocol

---

## The UI in one paragraph

`src/webview/App.tsx` is **one React class component, 2,822 lines**. There is no
router, no Redux/Zustand/Context, no hooks (React 16.0.0, classic JSX runtime).
Navigation is a `Nav` string in component state. Every view is a method on the
class. The same bundle is served to both the VS Code webview and the standalone
Browser View.

```
src/webview/
├── main.tsx              5 LOC   ReactDOM.render(<App/>, #root)
├── App.tsx           2,822 LOC   everything
├── model.ts            574 LOC   view-model types (hand-mirrored, see below)
├── GraphCanvas.tsx     216 LOC   the graph renderer
├── vscodeApi.ts         76 LOC   the ONLY surface-aware file
├── react-globals.d.ts   47 LOC   declares global React/ReactDOM (UMD)
├── index.html                    Browser View shell
└── theme.css                     → dist/media/webview.css
```

### Navigation model

```ts
type Nav = "Home" | "Intelligence" | "Work" | "Activity";
type IntelligenceView = "Overview" | "Explorer" | "Graph" | "CPG" | "Flows" | "Query";
```

Four top-level tabs; the Intelligence tab has six sub-views.

---

## The two host surfaces

`src/webview/vscodeApi.ts` is the entire abstraction. It exports one object:

```ts
export const vscode = {
  postMessage(message: unknown): void,
  onMessage(listener): () => void,
  surface: "vscode" | "browser"
};
```

Surface detection:

```ts
const nativeApi = typeof acquireVsCodeApi === "function" ? acquireVsCodeApi() : undefined;
```

| | VS Code webview | Browser View |
|---|---|---|
| Outbound | `nativeApi.postMessage(msg)` | `POST /command` with `{ message, expectedStateVersion }` |
| Inbound | `window` `message` event | `new EventSource("/events", { withCredentials: true })` |
| Delivery | native | `deliver()` re-dispatches a synthetic `MessageEvent` onto `window` |

**`deliver()` is the clever bit** (`vscodeApi.ts:8`): the SSE path re-dispatches
messages as real `window` `MessageEvent`s, so `App.tsx` can use one code path
(`window.addEventListener("message", …)`) regardless of surface.

### Optimistic concurrency (browser surface only)

```
vscodeApi tracks lastStateVersion, updated from every APPLICATION_STATE message.
Every POST /command carries expectedStateVersion.

→ 409 Conflict  ⇒ GET /state, deliver a fresh APPLICATION_STATE,
                  then deliver a NOTIFICATION telling the user to retry
→ other !ok     ⇒ deliver a NOTIFICATION with the server's error
→ ok            ⇒ adopt the returned stateVersion if it's newer
```

This exists because both surfaces can be open at once against the same
`ApplicationStore`. The VS Code surface does **not** do version checking — it is
in-process and trusted.

---

## The Browser View server

`src/extension/browser-view/browserViewServer.ts` (408 LOC), `node:http`.

Auth flow:
1. Extension starts the server and generates a **one-shot bootstrap token**.
2. The URL opened in the browser carries that token.
3. The server exchanges it for an **HttpOnly session cookie**.
4. Subsequent requests use the cookie (`credentials: "same-origin"` /
   `withCredentials: true`).

Endpoints:

| Route | Method | Purpose |
|---|---|---|
| `/` | GET | serves `dist/media/index.html` |
| `/events` | GET | SSE stream; sends a full state snapshot on connect |
| `/command` | POST | `{ message, expectedStateVersion }` → `{ stateVersion }` or 409 |
| `/state` | GET | current `KeystoneApplicationState` |
| static | GET | the rest of `dist/media/` |

SSE reconnection is handled by the browser automatically, and the server sends a
current snapshot on every connect — so a dropped connection self-heals.

### CSP

Two different policies:

- **VS Code webview** — `extension/ui/vscodeHtml.ts` generates a **nonce-based**
  CSP per panel load.
- **Browser View** — `src/webview/index.html` uses a strict `'self'`-only policy.

Neither allows inline scripts without a nonce, and there are no external origins.
If you add a script tag or an external font/CDN, it will be blocked — check the
webview DevTools console (*Developer: Open Webview Developer Tools*).

---

## The message protocol

The contract lives in **core**: `src/core/integration/webview/messageRouter.ts`
(530 LOC). `src/extension/types/messageRouter.ts` is a 6-line re-export.

### Webview → Extension: 41 message types

| Group | Messages |
|---|---|
| Lifecycle | `WEBVIEW_READY` |
| Indexing | `INDEX_REPO` (`force?`), `LOAD_INTELLIGENCE`, `CANCEL_INGESTION`, `CANCEL_ANALYSIS`, `REINDEX_AFFECTED_AND_VALIDATE` |
| Intent | `ANALYZE_INTENT`, `ENHANCE_INTENT`, `LOAD_ENHANCEMENT_SESSIONS`, `DELETE_ENHANCEMENT_SESSION`, `APPROVE_INTENT_RESEARCH` |
| Context | `CLEAR_CONTEXT_CACHE`, `RETRIEVE_CONTEXT_ORIGINAL`, `LOAD_CONTEXT_PACKET`, `RECORD_CONTEXT_FEEDBACK`, `REQUEST_CORRECTION_PACKET` |
| Intelligence views | `QUERY_INTELLIGENCE`, `EXPLORE_INTELLIGENCE`, `LOAD_INTELLIGENCE_GRAPH`, `LOAD_CPG_VIEW`, `OPEN_SOURCE_LOCATION` |
| SDLC | `CREATE_SDLC_PLAN`, `SDLC_TRANSITION`, `APPROVE_SPECIFICATION`, `RESOLVE_SDLC_FINDING`, `COMPLETE_TASK`, `RECORD_DECISION` |
| Delegation | `APPROVE_DELEGATION`, `COPY_COPILOT_PROMPT`, `COPY_PR_MARKDOWN` |
| Validation | `RUN_VALIDATION` (`scope: "impacted" \| "all"`) |
| Modernization | `ANALYZE_MODERNIZATION`, `ACCEPT_MODERNIZATION` |
| Handoff | `CREATE_TASK_HANDOFF`, `RESTORE_TASK_HANDOFF`, `LOAD_RESTORED_TASK_HANDOFF` |
| ValueEdge | `CONFIGURE_VALUEEDGE`, `IMPORT_VALUEEDGE_FEATURE`, `PUBLISH_VALUEEDGE_STORIES` |
| Misc | `SAVE_SETTINGS`, `OPEN_BROWSER_VIEW` |

✅ **All 41 have a handler** in `vscodeProvider.ts` — verified programmatically,
zero unhandled.

### Extension → Webview: 30 message types

| # | Type | # | Type |
|--:|---|--:|---|
| 1 | `STATE_UPDATE` | 16 | `TASK_COMPLETION_RESULT` |
| 2 | `INDEX_PROGRESS` | 17 | `TASK_DECISION_RESULT` |
| 3 | `ERROR` | 18 | `TASK_HANDOFF_CREATED` |
| 4 | `TASK_RESULT` | 19 | `TASK_HANDOFF_RESTORED` |
| 5 | `INTENT_ENHANCED` | 20 | `TASK_HANDOFFS_RESULT` |
| 6 | `ENHANCEMENT_SESSIONS_RESULT` | 21 | `APPLICATION_STATE` |
| 7 | `CONTEXT_ORIGINAL_RESULT` | 22 | `SDLC_PLAN_RESULT` |
| 8 | `CONTEXT_PACKET_RESULT` | 23 | `BROWSER_VIEW_OPENED` |
| 9 | `CORRECTION_PACKET_RESULT` | 24 | `VALUEEDGE_FEATURE_RESULT` |
| 10 | `VALIDATION_RESULT` | 25 | `VALUEEDGE_PUBLISH_RESULT` |
| 11 | `QA_BACKGROUND_STATUS` | 26 | `INTELLIGENCE_QUERY_RESULT` |
| 12 | `BACKGROUND_ANALYSIS_STATUS` | 27 | `INTELLIGENCE_EXPLORER_RESULT` |
| 13 | `MODERNIZATION_PROPOSAL` | 28 | `INTELLIGENCE_GRAPH_RESULT` |
| 14 | `MODERNIZATION_PLAN` | 29 | `CPG_VIEW_RESULT` |
| 15 | `DELEGATION_RESULT` | 30 | `NOTIFICATION` |

### Two state-delivery mechanisms — don't confuse them

| | `STATE_UPDATE` | `APPLICATION_STATE` |
|---|---|---|
| Payload | `Partial<KeystoneWebviewState>` | full `KeystoneApplicationState` |
| Source | `CockpitService` (per workspace) | `ApplicationStore` (global, versioned) |
| Semantics | merge into existing state | replace; carries `version` |
| Concurrency | none | drives `lastStateVersion` |

---

## 🔴 The protocol is not type-checked at the webview boundary

This is the single biggest correctness risk in the UI, and it has two parts.

### Part 1 — `webview/model.ts` does not contain the message unions

The webview may not import `@core/*` (enforced — verified 0 violations), so
`model.ts` hand-mirrors what it needs. But it mirrors only the **view-model
types** (`TaskResult`, `IntelligenceSummary`, `SdlcPlan`, `ApplicationState`, …).

It declares **zero** message-union members:

```
core   messageRouter.ts:  WebviewToExtensionMessage = 41 variants
                          ExtensionToWebviewMessage = 30 variants
webview model.ts:         WebviewToExtensionMessage = (absent)
                          ExtensionToWebviewMessage = (absent)
```

### Part 2 — `App.tsx` handles messages as untyped bags

```ts
// App.tsx:121
private readonly onMessage = (event: MessageEvent): void =>
  this.handle(event.data as { type?: string; [key: string]: unknown });
```

and dispatch is a long `else if` chain on `message.type === "…"` string literals
(lines 139–~340). Outbound messages are equally untyped:

```ts
vscode.postMessage({ type: "INDEX_REPO", force: true });   // no type checking
```

### What this means for you

- **Renaming or repayloading a message will not produce a compile error.** It
  will produce a silently ignored message at runtime.
- A typo in a message type string is invisible to `tsc`.
- The 41/30 counts above are your manual checklist.

### Procedure when changing a message

1. Edit the union in `src/core/integration/webview/messageRouter.ts`.
2. Add/update the handler in `src/extension/ui/vscodeProvider.ts`
   (find it with `grep -n '"YOUR_MESSAGE"' src/extension/ui/vscodeProvider.ts`).
3. Add/update the sender or handler in `src/webview/App.tsx`.
4. If the payload references a view-model type, mirror that type in
   `src/webview/model.ts`.
5. `npm run typecheck` will catch (1) and (2), but **not** (3) or (4). Test the
   round-trip by hand.

A worthwhile improvement (not yet done) is to have `build.mjs` generate
`model.ts`'s message unions from the core file, or add a script that diffs the
two. See [KI-05](14-known-issues.md).

---

## The graph renderer

`src/webview/GraphCanvas.tsx` (216 LOC) declares its own view types:

```ts
interface VisualGraphNode { … }
interface VisualGraphEdge { … }
```

**⚠️ TRAP — these are view models, not a competing data store.** They are
populated from the OKF projection through
`core/intelligence/explorer/intelligenceExplorer.ts`. The path

```
OKF snapshot → projections/graph.json → intelligenceExplorer → INTELLIGENCE_GRAPH_RESULT → GraphCanvas
```

is live and is guarded by `scripts/verify-graph-stack.mjs`. Do not assume a
same-named type elsewhere in the tree is related — a separate `KGNode`/`KGEdge`
model was deleted precisely because it looked live and was not.

---

## Adding a UI feature — the full path

```
1. core/integration/webview/cockpitService.ts   add an async method (the real work)
2. core/integration/webview/messageRouter.ts    add W2E and/or E2W message variants
3. extension/ui/vscodeProvider.ts               add the handler → call the service
                                                → post the result back
4. src/webview/model.ts                         mirror any new view-model types
5. src/webview/App.tsx                          add the sender + the handler branch
                                                + the render method
6. npm run build && F5                          verify by hand — the boundary is untyped
```

Next: [`10-workflow-sdlc.md`](10-workflow-sdlc.md).
