# 00 — Orientation

Read this once. It gives you the mental model everything else hangs off.

---

## 1. What Keystone actually is

A **VS Code extension**, written in TypeScript, that runs entirely on the
developer's machine. It has no server, no cloud component, no database, and no
LLM dependency for its core function.

Its job is to answer this question well:

> "For the change I am about to make, what is the *minimum correct set of
> context* — files, symbols, call paths, tests, risks, constraints — that an AI
> coding assistant needs, and what is the evidence for each item in that set?"

The product framing (from `README.md`, still accurate as intent):

> Keystone understands, plans, retrieves, compresses, coordinates, and validates.
> GitHub Copilot generates.

### What that means concretely

| Keystone does | Keystone does not |
|---------------|-------------------|
| Parse and index every file deterministically | Call an LLM to understand code |
| Persist a knowledge graph to `.keystone/` | Send anything to a remote service (except optional ValueEdge) |
| Rank and compress context for a prompt | Generate code |
| Read Git metadata | Write to Git — ever (lint-enforced) |
| Track an SDLC story lifecycle | Manage a real ticket system (ValueEdge is a thin optional bridge) |
| Encrypt a task-state package for handoff | Sync state to a shared backend |

---

## 2. The one diagram that matters

```
┌───────────────────────────────────────────────────────────────────────────┐
│ VS CODE EXTENSION HOST  (node, one process)                                │
│                                                                            │
│  extension.ts::activate()          ← src/extension/core/extension.ts:14    │
│      │                                                                     │
│      ├── createStatusBar()                                                 │
│      ├── new VscodeProvider(...)   ← the god-object UI bridge (2,366 LOC)  │
│      ├── new QaService()                                                   │
│      ├── indexCommands(context, provider)                                  │
│      ├── FileSystemWatcher("**/*")  → debounced 2s reindex                 │
│      └── per-workspace BackgroundWorkerCoordinator                         │
│                │                                                           │
│                ├─ worker_thread: qa            ┐                           │
│                ├─ worker_thread: security      │ 4 threads, 120s timeout   │
│                ├─ worker_thread: performance   │ each writes               │
│                └─ worker_thread: modernization ┘ .keystone/background/*.json│
│                                                                            │
│  VscodeProvider ──owns──> CockpitService (per workspace root, 2,900 LOC)   │
│                            │                                               │
│                            └─ orchestrates core/: intelligence, context,   │
│                               workflow, platform, integration              │
│                                                                            │
│  VscodeProvider ──renders──> WebviewPanel  (React 16, CSP + nonce)         │
│  VscodeProvider ──optionally──> BrowserViewServer (localhost HTTP + SSE)   │
└───────────────────────────────────────────────────────────────────────────┘
                          │                              │
                  postMessage bridge            fetch + EventSource
                          │                              │
                    ┌─────┴──────────────────────────────┴─────┐
                    │  src/webview/App.tsx  (2,822 LOC, ONE     │
                    │  React class component, no router,        │
                    │  no state library, shared by both hosts)  │
                    └───────────────────────────────────────────┘
                          │
                    writes to
                          ▼
            ┌──────────────────────────────────┐
            │  <target-repo>/.keystone/        │  ← NOT in this repo.
            │  intelligence/okf/  ← canonical  │     Written into whatever
            │  intelligence/cpg/               │     repo the user opens.
            │  tasks/ state/ background/ ...   │
            └──────────────────────────────────┘
```

**⚠️ TRAP:** `.keystone/` is created inside the **user's opened repository**, not
inside the Keystone repo. This repo has no `.keystone/` unless you run the
extension on itself. `.gitignore` excludes it.

---

## 3. The data model in one page

There is exactly **one canonical persisted model: OKF** (Open Knowledge Format —
a local profile, see [`05-data-model-okf.md`](05-data-model-okf.md)).

Everything else is either (a) an in-memory intermediate on the way to OKF, or
(b) a projection derived from OKF.

```
                      ┌──────────────────────────┐
   in-memory          │ RepoIntelligence         │  src/core/domain/types.ts:…
   intermediate       │ files, symbols, deps,    │  the raw structural model
                      │ apis, tests, calls, …    │
                      └────────────┬─────────────┘
                                   │ 21 stages add analysis
                      ┌────────────▼─────────────┐
   in-memory +        │ RepositoryIntelligence   │  pipeline/types.ts:73
   snapshot.json      │ Snapshot                 │  + stages/health/findings
                      └────────────┬─────────────┘
                                   │ repoIntelligenceToOkf()
                      ┌────────────▼─────────────┐
   ★ CANONICAL ★      │ KeystoneOkfSnapshot      │  okf/types.ts:168
   .keystone/         │  units[]                 │  4 JSONL files +
   intelligence/okf/  │  relationships[]         │  manifest.json
                      │  observations[]          │
                      │  evidence[]              │
                      └────────────┬─────────────┘
                                   │ projections (okf/projections.ts)
              ┌────────────────────┼────────────────────┬──────────────┐
              ▼                    ▼                    ▼              ▼
        graph.json          search.jsonl      cpg-bindings.jsonl   okf-bundle/
        (UI graph)          (query index)     (CPG↔OKF link)       (portable .md)
```

**Rule of thumb:** if you need to know something about the repository, read it
from OKF or an OKF projection. If you are tempted to add a second parallel store,
stop — that has already been tried and deleted once.

---

## 4. The two runtime surfaces

The same `App.tsx` renders in two places. `src/webview/vscodeApi.ts` abstracts the
difference and it is the *only* file that knows which surface it is on.

| | VS Code Webview | Browser View |
|---|---|---|
| Transport out | `acquireVsCodeApi().postMessage` | `POST /command` (fetch) |
| Transport in | `window` `message` event | `GET /events` (SSE) |
| Auth | VS Code's own sandbox | HttpOnly session cookie + one-shot bootstrap token |
| Served by | `vscodeHtml.ts` (nonce CSP) | `browserViewServer.ts` from `dist/media/` |
| Detection | `typeof acquireVsCodeApi === "function"` | fallback | 

`vscodeApi.ts` also implements **optimistic-concurrency**: every browser command
carries `expectedStateVersion`; a `409` forces a full state resync.

---

## 5. Threading and concurrency model

| Thing | Where it runs | Notes |
|-------|--------------|-------|
| Activation, commands, UI | Extension host main thread | |
| Intelligence pipeline (21 stages) | Extension host main thread, `async` | Can be cancelled via `AbortSignal` |
| Stage worker pool | `worker_threads`, max configurable | `keystone.intelligence.maxWorkers`, default 5, range 1–16 |
| TypeScript semantic analysis | `worker_threads` (isolated) | `cpg/typescriptSemanticWorker.ts` |
| QA / security / performance / modernization | 4 dedicated `worker_threads` | `backgroundAnalysisWorker.ts`, 120s hard timeout each |
| Browser View HTTP server | Extension host, `node:http` | Only when the user opens it |

**⚠️ TRAP:** worker entry points are resolved as **built `.js` paths at runtime**
(`backgroundWorkerCoordinator.ts:56` does `path.join(__dirname, "../workers/backgroundAnalysisWorker.js")`).
If you rename or move a worker file you must keep the emitted `dist/app/...`
layout intact, and workers will silently fail to start if you only ran a partial
build.

---

## 6. What state exists and who owns it

| State | Owner | Lifetime |
|-------|-------|----------|
| `ApplicationStore` (`core/application/applicationStore.ts`) | in-memory, versioned | extension session; broadcast to both surfaces |
| `CockpitService` per workspace root | `VscodeProvider.services` Map | extension session |
| OKF snapshot | `.keystone/intelligence/okf/` | persistent, promoted atomically |
| Snapshot archives | `.keystone/intelligence/snapshots/<runId>/` | persistent until pruned |
| Task workspaces | `.keystone/tasks/NNNN_slug/` | persistent |
| SDLC plan | `.keystone/state/sdlc/active-plan.json` | persistent |
| Background analysis | `.keystone/background/*.json` | overwritten each run |
| Restored handoffs | VS Code `workspaceState` (`WorkspaceStateTaskStore`) | per workspace |
| ValueEdge client secret | VS Code `SecretStorage` | never on disk in plaintext |

---

## 7. Before you change anything

Run this and read the output — it is your baseline:

```bash
npm run build      # passes  → 124 core/extension modules + 5 webview modules
npm run lint       # passes  → custom gate, 132 files
npm run typecheck  # passes  → both projects clean
node scripts/check-active-boundary.mjs   # verifies the active reachable source boundary
```

All four are green in the current working tree. If any of them starts failing,
you introduced it.

**⚠️ But the tree is not committed.** ~74 files are modified relative to `HEAD`,
and the recent commit messages are `gdfg` / `sdfgsdf` / `fdsfdsf`. The green
state lives only in your working directory. Before you start changing things,
consider committing the current known-good state so you have something to diff
against — see [KI-00](14-known-issues.md#ki-00).

Next: [`01-getting-started.md`](01-getting-started.md).
