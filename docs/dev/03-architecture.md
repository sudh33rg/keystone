# 03 — Architecture

---

## The layer model

```
┌─────────────────────────────────────────────────────────────────────┐
│  src/webview/          PRESENTATION                                  │
│  React 16 class component. Knows nothing about Node, VS Code, or     │
│  core. Talks only via the message protocol.                          │
│  Imports allowed: relative ./*.js only.                              │
└─────────────────────────────────────────────────────────────────────┘
                    ▲  postMessage / SSE  (see 09)
                    │
┌─────────────────────────────────────────────────────────────────────┐
│  src/extension/        HOST ADAPTER                                  │
│  The ONLY layer allowed to `import * as vscode`. Owns activation,    │
│  commands, webview lifecycle, workers, the Browser View server.      │
│  Imports allowed: vscode, node:*, @core/*, sibling @vscode/*         │
└─────────────────────────────────────────────────────────────────────┘
                    ▲
                    │
┌─────────────────────────────────────────────────────────────────────┐
│  src/core/             DOMAIN + APPLICATION LOGIC                    │
│  Pure-ish TypeScript. Uses node:* freely (fs, path, crypto) but      │
│  NEVER imports `vscode`. This is what makes the verify-*.mjs         │
│  harnesses possible — core can run in plain Node.                    │
│                                                                      │
│    domain/        shared vocabulary types                            │
│    platform/      storage, git (read-only), config, events, metrics  │
│    intelligence/  ingestion → pipeline → OKF → CPG → explorer        │
│    context/       intent classification, retrieval, compression      │
│    workflow/      SDLC, agents, quality, handoff, modernization      │
│    integration/   webview contract (CockpitService), ValueEdge       │
│    application/   ApplicationStore (shared UI state)                 │
└─────────────────────────────────────────────────────────────────────┘
                    │
                    ▼
        <target-repo>/.keystone/    (JSON / JSONL / gzip / Markdown)
```

### The layering is genuinely enforced — verified

I checked every import in all 132 source files:

| Rule                                                         | Result              |
| ------------------------------------------------------------ | ------------------- |
| `core/` never imports `vscode`                               | ✅ **0 violations** |
| `core/` never imports `@vscode/*` or `@webview/*`            | ✅ **0 violations** |
| `webview/` never imports `@core/*`, `@vscode/*`, or `node:*` | ✅ **0 violations** |
| Only `extension/` imports the VS Code API                    | ✅ exactly 9 files  |

The nine files that import `vscode`:

```
extension/core/extension.ts             extension/ui/vscodeProvider.ts
extension/core/qaService.ts             extension/ui/vscodeHtml.ts
extension/core/statusBar.ts             extension/commands/indexCommands.ts
extension/task-handoff/taskStateRestorer.ts
extension/commands/cacheMaintenance.ts
extension/intelligence/vscodeLanguageServiceEnricher.ts
```

**Treat this boundary as sacred.** It is the single most valuable structural
property of this codebase: it is why `core` can be exercised by standalone Node
scripts (`scripts/verify-*.mjs` `require()` the built `dist/app/core/**`) with no
VS Code test harness.

If you need a VS Code capability inside `core`, define a **provider interface**
in `core` and implement it in `extension`. The existing example is
`SemanticEnrichmentProvider` (`core/intelligence/languages/semanticEnrichment.ts`),
implemented by `VscodeLanguageServiceEnricher`
(`extension/intelligence/vscodeLanguageServiceEnricher.ts`).

---

## Measured cross-layer dependency edges

Top edges by import count (module-to-module, cross-directory only):

```
23  core/integration  →  core/workflow          CockpitService orchestrates workflow
19  core/integration  →  core/intelligence      …and intelligence
17  core/intelligence →  core/domain            shared vocabulary
13  core/workflow     →  core/intelligence      workflow reads the graph
12  core/context      →  core/intelligence      retrieval reads the graph
10  core/intelligence →  core/platform          storage/config
 9  extension/ui      →  core/workflow          provider drives SDLC/handoff
 8  core/workflow     →  core/domain
 6  core/context      →  core/domain
 6  core/workflow     →  core/platform
 4  core/workflow     →  core/context
 4  extension/ui      →  core/intelligence
 4  extension/workers →  core/intelligence
 1  core/intelligence →  core/workflow          ← the one back-edge, see below
```

**⚠️ TRAP — one back-edge exists.** `core/intelligence → core/workflow` (1 import).
Intelligence is conceptually _below_ workflow, so this inverts the intended
direction. Not currently harmful, but do not add more.

### Most-depended-upon modules

Change these carefully; the blast radius is large.

| Importers | Module                                                                       |
| --------- | ---------------------------------------------------------------------------- |
| 36        | `core/domain/types.ts` — the shared vocabulary (613 LOC, 50+ exported types) |
| 21        | `core/intelligence/okf/types.ts`                                             |
| 10        | `core/intelligence/okf/canonicalContext.ts`                                  |
| 10        | `core/platform/config/defaults.ts`                                           |
| 8         | `core/intelligence/pipeline/derivedGraph.ts`                                 |
| 8         | `core/workflow/sdlc/engine.ts`                                               |
| 7         | `core/intelligence/pipeline/findings.ts`                                     |
| 7         | `core/intelligence/cpg/types.ts`                                             |
| 7         | `core/workflow/handoff/contracts.ts`                                         |

---

## Process and thread model

```
VS Code Extension Host process (Node)
│
├── main thread
│   ├── activate() / commands / status bar
│   ├── VscodeProvider  (webview lifecycle, message routing)
│   ├── CockpitService  (per workspace root)
│   ├── the 21-stage intelligence pipeline (async, cancellable)
│   └── BrowserViewServer (node:http) — only if opened
│
├── worker_threads: intelligence stage pool
│   └── pipeline/stageWorkerPool.ts → pipeline/intelligenceStageWorker.ts
│       bounded by keystone.intelligence.maxWorkers (default 5, max 16)
│
├── worker_thread: TypeScript semantic analysis
│   └── cpg/typescriptSemanticWorker.ts  (isolated, memory-heavy)
│
└── worker_threads × 4: background analysis
    └── extension/workers/backgroundAnalysisWorker.ts
        kinds: qa | security | performance | modernization
        120,000 ms hard timeout each, two retries by default, with persisted
        attempt/retry metadata and digest/run-matched restart resume
        (backgroundWorkerCoordinator.ts)
        each writes .keystone/background/<kind>.json atomically (tmp + rename)
```

### Worker lifecycle rules

- `BackgroundWorkerCoordinator.start()` calls `this.dispose()` first — starting
  always cancels the previous generation.
- A monotonically increasing `generation` counter guards against late events from
  terminated workers (`backgroundWorkerCoordinator.ts:41,62,77`).
- Workers are spawned by **built path**:
  `path.join(__dirname, "../workers/backgroundAnalysisWorker.js")`.
  This is why `dist/app/` must mirror `src/`.

---

## Activation sequence

`src/extension/core/extension.ts:14` — `activate(context)`:

1. `createStatusBar()` → status bar item.
2. `vscode.window.createOutputChannel("Keystone Intelligence", { log: true })`
   → the primary debugging surface.
3. `new VscodeProvider(extensionUri, statusBar, output, context)`.
4. `new QaService()`; `provider.attachQaService(qaService)`.
5. `indexCommands(context, provider)` — registers 9 commands (7 declared).
6. Status bar → `"Keystone: Ready | Intelligence cached in .keystone"`.
7. **For every open workspace folder**, `startWorkspace(folder)`:
   - `provider.indexWorkspace(root)` — full pipeline run.
   - if that promoted a new OKF snapshot, or failed while preserving one →
     `provider.getBackgroundWorkerInput(root)`
   - → `coordinator.start(root, cb, input)` — spawn the 4 background workers.
   - **Background workers start only when a validated promoted OKF snapshot exists.**
8. Subscribe to `onDidChangeWorkspaceFolders` → start/dispose per folder.
9. Create `vscode.workspace.createFileSystemWatcher("**/*")` with two handlers:

   | Handler                     | Debounce | Trigger                   | Action                        |
   | --------------------------- | -------- | ------------------------- | ----------------------------- |
   | `queueIntelligenceRefresh`  | 2,000 ms | any create/change/delete  | re-index + restart workers    |
   | `queueIntelligenceRecovery` | 750 ms   | delete under `.keystone/` | `ensureWorkspaceIntelligence` |

10. `onDidChangeActiveTextEditor` → `provider.activeWorkspaceChanged()`.

### The watcher's ignore list

`extension.ts:73-78` — a hardcoded regex, **separate** from the ingestion ignore
list in `core/platform/config/defaults.ts`:

```
.keystone .git node_modules dist out build coverage cache .cache
__pycache__ env .env venv .venv site-packages vendor target
.next .nuxt .gradle .idea
```

plus extensions `.log .tmp .swp .class .jar .png .jpe?g .gif .ico .woff2?`

**⚠️ TRAP — two ignore lists that can drift.** `IGNORED_DIRECTORIES` in
`defaults.ts` has ~50 entries; this watcher regex has ~20. A directory ignored by
ingestion but _not_ by the watcher will trigger pointless re-index cycles. If you
add an ignore rule, consider both places.

---

## The two god objects

Two files hold most of the wiring. You will end up in both.

### `src/extension/ui/vscodeProvider.ts` — 2,366 LOC

The host-side controller. Responsibilities:

- webview panel lifecycle + HTML injection
- `handleMessage()` — a long `if (message.type === …)` chain starting at line 461
  (**not** a `switch`; grep for the literal message name to find a handler)
- indexing orchestration and debouncing (`indexGeneration`, `analysisGeneration`,
  `pendingIndexRoots`, `pendingAffectedPaths`)
- owns `Map<string, CockpitService>` — one service per workspace root
- owns `ApplicationStore`, `SDLCEngine`, Browser View handle, ValueEdge feature
- task handoff create/restore, background worker event fan-out

### `src/core/integration/webview/cockpitService.ts` — 2,900 LOC

The core-side façade. One instance per workspace root. ~35 public async methods —
`loadState`, `index`, `analyze`, `queryIntelligence`, `exploreIntelligence`,
`graphIntelligence`, `cpgIntelligence`, `approveDelegation`, `runValidation`,
`analyzeModernization`, `createCorrectionPacket`, etc.

**This is the seam.** Almost every feature is reachable from a `CockpitService`
method, and `CockpitService` never touches `vscode`. If you want to understand a
feature end-to-end, find its `CockpitService` method and read outward.

**⚠️ Both files are well past a healthy size.** They are the natural
decomposition targets — see [`14-known-issues.md`](14-known-issues.md).

---

## Message contract ownership

The protocol types live in **core**, not extension:

```
core/integration/webview/messageRouter.ts   ← 552 LOC, the real contract
    WebviewToExtensionMessage   (38 variants)
    ExtensionToWebviewMessage   (30 variants)
    KeystoneWebviewState, KeystoneTaskResult, WorkspaceSummary, …

extension/types/messageRouter.ts            ← 6 LOC, pure re-export
src/webview/model.ts                        ← 574 LOC, HAND-MIRRORED copy
```

**⚠️ TRAP — the webview types are a manual copy, not an import.** Because
`webview/` may not import `@core/*`, `src/webview/model.ts` redeclares the shapes
it needs. **Changing a message payload requires editing two files**, and nothing
enforces that they agree. Type-drift here fails silently at runtime.

Details and the full protocol table: [`09-webview-and-protocol.md`](09-webview-and-protocol.md).

---

## Storage architecture

Everything persists to `<target-repo>/.keystone/`. There is no database; the
formats are JSON, JSONL, gzipped JSON, and Markdown.

**Atomic-write pattern**, used consistently for anything important:

1. write to `<target>.<pid>.<timestamp>.tmp`
2. `fs.rename()` into place (atomic on POSIX)

Examples: `backgroundAnalysisWorker.ts:26-28`, `backgroundWorkerCoordinator.ts:129-153`.

**OKF promotion** uses a stronger variant (`okf/store.ts:118-176`):

1. write everything to `okf.candidate-<extractionRunId>/`
2. copy that to `snapshots/<extractionRunId>/` (the archive)
3. `rename(okf → okf.previous)`
4. `rename(candidate → okf)`
5. write `current.json` pointer
6. `rm -rf okf.previous`
7. generate the portable Markdown bundle

So a crash mid-promotion leaves either the old snapshot or the new one — never a
torn one.

Full layout: [`08-storage-layout.md`](08-storage-layout.md).

---

## Design principles the code actually follows

1. **Determinism over cleverness.** No LLM in ingestion. Same input → same OKF.
2. **Evidence for every claim.** Every OKF unit/relationship carries `provenance`
   with `evidenceIds`; every evidence record carries extractor, version, run ID,
   source location, and a freshness flag.
3. **Read-only Git.** Lint-enforced. `core/platform/git/gitReadOnly.ts` is the
   only Git surface and one of only three files permitted to spawn a process.
4. **Unbounded knowledge, bounded prompt.** Ingestion has no file cap
   (`check-active-boundary.mjs` asserts this). Only the Copilot context pack is
   compressed.
5. **Human approval gates.** Delegation, specification approval, and
   modernization acceptance all require an explicit user action.
6. **Fail soft during ingestion.** A stage failure records a warning and the
   pipeline continues degraded rather than aborting
   (`pipeline.ts:218-225` falls back to `emptyRepoIntelligence`).

Next: [`04-code-map.md`](04-code-map.md).
