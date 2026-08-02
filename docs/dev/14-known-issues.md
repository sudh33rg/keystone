# 14 — Known Issues and Debt Register

An honest inventory. Every entry was verified against the code or real tool
output. Nothing here is speculative.

| ID | Severity | Issue |
|---|---|---|
| [KI-00](#ki-00) | 🔴 High | ~74 modified + 9 untracked source files are uncommitted |
| [KI-01](#ki-01) | 🔴 High | The webview message boundary is completely untyped |
| [KI-02](#ki-02) | 🟠 Medium | Two 2,300+ LOC god objects |
| [KI-03](#ki-03) | 🟠 Medium | No test framework; UI and protocol have zero coverage |
| [KI-04](#ki-04) | 🟠 Medium | Two commands registered but undeclared → unreachable |
| [KI-05](#ki-05) | 🟡 Low | Five dead config files for uninstalled tools |
| [KI-06](#ki-06) | 🟡 Low | `npm run watch` doesn't watch |
| [KI-07](#ki-07) | 🟡 Low | `README.md` documents a `vendor/` directory that doesn't exist |
| [KI-08](#ki-08) | 🟡 Low | Two divergent ignore lists |
| [KI-09](#ki-09) | 🟡 Low | Empty `core/context/compression/` directory |
| [KI-10](#ki-10) | 🟡 Low | One architectural back-edge: `intelligence → workflow` |
| [KI-11](#ki-11) | 🟡 Low | Webview build output is flat-by-basename |
| [KI-12](#ki-12) | 🟡 Low | `RedactionReport.safeToShare` is hardcoded `true` |
| [KI-13](#ki-13) | 🟡 Low | `tokenEstimator` is a 3-line heuristic |
| [KI-14](#ki-14) | 🟡 Low | Vendored VS Code type stub will block unfamiliar APIs |
| [KI-15](#ki-15) | ℹ️ Info | Older `docs/*.md` are stale product specs |

---

## KI-00 — Uncommitted work dominates the repo 🔴 {#ki-00}

**Evidence:**
```
$ git status --short | wc -l
74
$ git log --oneline -3
107e103 gdfg
4dde3f2 sdfgsdf
30b3014 fdsfdsf
```

**9 untracked source files** — real modules that have never been committed:
```
src/core/intelligence/ingestion/engineeringEntityDetector.ts
src/core/intelligence/ingestion/extractionCache.ts
src/core/intelligence/ingestion/revisionGuard.ts
src/core/intelligence/ingestion/snapshotPrune.ts
src/core/intelligence/okf/canonicalContext.ts
src/core/workflow/agents/canonicalTaskEvidence.ts
src/extension/commands/cacheMaintenance.ts
scripts/verify-core.mjs
scripts/verify-call-resolution.mjs
scripts/verify-graph-stack.mjs
```

**Why it matters:** the entire green baseline (build ✅, typecheck ✅, lint ✅)
exists only in the working directory. `git stash` or a bad checkout destroys it.
`git diff` is useless as a review tool because everything is a diff. You cannot
bisect. The commit messages carry zero information.

**Fix:** commit the current known-good state in logical chunks *before* making
any new change. At minimum:
```bash
git add -A && git commit -m "checkpoint: green baseline (build/typecheck/lint pass)"
```
Then adopt real commit messages going forward. This is the highest-value action
in this document.

---

## KI-01 — The message boundary is untyped 🔴 {#ki-01}

**Evidence:**

`core/integration/webview/messageRouter.ts` defines
`WebviewToExtensionMessage` (**41** variants) and `ExtensionToWebviewMessage`
(**30** variants). `src/webview/model.ts` declares **0** of them.

`src/webview/App.tsx:121`:
```ts
private readonly onMessage = (event: MessageEvent): void =>
  this.handle(event.data as { type?: string; [key: string]: unknown });
```

Dispatch is a ~200-line `else if` chain on string literals. Outbound sends are
untyped object literals:
```ts
vscode.postMessage({ type: "INDEX_REPO", force: true });
```

**Why it matters:** renaming a message type or changing a payload produces **no
compile error**. The message is silently ignored at runtime. A typo is invisible.
This is the single largest source of potential silent breakage in the product.

**Root cause:** the `webview/` layer legitimately may not import `@core/*`
([`13-conventions.md`](13-conventions.md) rule 7), so types are hand-mirrored —
but only the view-model types were mirrored, not the message unions.

**Fix options, cheapest first:**
1. Add a `scripts/check-protocol.mjs` that parses both files and fails when the
   message-type sets diverge. Wire into `verify:source`.
2. Generate the webview's message unions from the core file during `build.mjs`
   (write a `model.generated.ts`).
3. Mirror the unions by hand in `model.ts` and type `handle()` as a discriminated
   union — gives real exhaustiveness checking in `App.tsx`.

**Mitigation until then:** the 41/30 tables in
[`09-webview-and-protocol.md`](09-webview-and-protocol.md) are your manual
checklist. All 41 inbound messages currently *do* have handlers (verified).

---

## KI-02 — Two god objects 🟠 {#ki-02}

| File | LOC |
|---|---:|
| `src/webview/App.tsx` | 2,822 |
| `src/core/integration/webview/cockpitService.ts` | 2,900 |
| `src/extension/ui/vscodeProvider.ts` | 2,366 |
| `src/core/workflow/modernization/modernization-api.ts` | 1,499 |
| `src/core/workflow/sdlc/engine.ts` | 1,461 |
| `src/core/intelligence/pipeline/pipeline.ts` | 1,452 |

`App.tsx` is **one React class component** holding all navigation, all views, and
all handlers. `vscodeProvider.ts` mixes webview lifecycle, message dispatch,
indexing orchestration, debouncing, handoff, and worker fan-out.

**Why it matters:** merge conflicts, impossible code review, no unit-testable
seams, and a hard onboarding cliff.

**Fix direction (incremental, low risk):**
- `App.tsx` → extract each view into its own presentational component file, keep
  state in `App`. Start with the six `IntelligenceView` sub-views.
- `vscodeProvider.ts` → extract the `handleMessage` chain into a dispatch map
  (`Record<MessageType, Handler>`) in a separate module. This also creates the
  natural place to enforce KI-01.
- `pipeline.ts` → the `STAGES[]` table could move to `pipeline/stages/*.ts`.

Do **not** attempt a big-bang refactor — there are no tests to catch regressions
(KI-03).

---

## KI-03 — No test framework 🟠 {#ki-03}

No vitest, jest, mocha. No `tests/` directory. `scripts/test.mjs` exists with
nothing to run. `tsconfig.extension-test.json` references `tests/integration/**`
which does not exist. `src/types/vscode-test-electron/index.d.ts` is a stub for
an uninstalled package.

**What coverage does exist:** 6 standalone Node harnesses
([`12-verification.md`](12-verification.md)) covering revision guard, snapshot
pruning, call resolution, the graph stack, and a cross-feature suite.

**What has zero coverage:**
- the entire webview UI
- the message protocol (compounding KI-01)
- VS Code integration
- individual pipeline stages
- error/degraded paths

**Fix:** the existing `verify-*.mjs` convention works well and requires no
dependencies. Extend it before reaching for a framework. If you do add one,
vitest fits the ESM/TS setup with the least friction — but note it would be the
first dev dependency beyond prettier and types.

---

## KI-04 — Two commands are unreachable 🟠 {#ki-04}

**Evidence:**
```
Registered in code:  keystone.reclaimCache, keystone.clearCache
Declared in package.json contributes.commands:  (absent)
activationEvents:                               (absent)
```

`src/extension/commands/cacheMaintenance.ts:19` and `:31` register them;
`indexCommands.ts:38` calls the registration. But without a `contributes.commands`
entry they never appear in the Command Palette.

**Why it matters:** these are the *only* user-facing way to reclaim disk. Given
`.keystone/` can reach multiple GB ([`08-storage-layout.md`](08-storage-layout.md)),
users have no supported way to clean up.

**Fix** — add to `package.json`:
```jsonc
// contributes.commands
{ "command": "keystone.reclaimCache", "title": "Keystone: Reclaim Intelligence Cache" },
{ "command": "keystone.clearCache",   "title": "Keystone: Clear Intelligence Cache" }
// activationEvents
"onCommand:keystone.reclaimCache",
"onCommand:keystone.clearCache"
```

Workaround today: `rm -rf .keystone/intelligence/snapshots`.

---

## KI-05 — Dead configuration files 🟡 {#ki-05}

| File | Tool | Installed? |
|---|---|---|
| `esbuild.config.mjs` | esbuild | ❌ |
| `vite.config.ts` | vite | ❌ |
| `eslint.config.js` | eslint | ❌ |
| `tsconfig.eslint.json` | (for the above) | — |
| `tsconfig.extension-test.json` | `tests/` that doesn't exist | — |

`node_modules` contains 25 packages; none of these tools are among them.

**Why it matters:** a new developer edits `eslint.config.js` to add a rule and
nothing happens. Wasted hours.

**Fix:** either delete them, or add a header comment to each:
`// NOT USED — see docs/dev/02-build-system.md. The real build is scripts/build.mjs.`
Keeping them as a record of intent is defensible; leaving them unmarked is not.

---

## KI-06 — `npm run watch` doesn't watch 🟡 {#ki-06}

`scripts/build.mjs:8-11` prints:
> Keystone local toolchain performs a full deterministic rebuild on each
> invocation; external file watching is intentionally not bundled.

…then does one normal build. `.vscode/tasks.json` still declares a `npm: watch`
task with a `$tsc-watch` problem matcher that will never fire.

**Fix:** rename the script to `build:once`, or implement watching with
`fs.watch`. At minimum, remove the misleading task from `tasks.json`.

---

## KI-07 — `README.md` documents a nonexistent `vendor/` 🟡 {#ki-07}

`README.md:49`:
> The npm toolchain required to build the extension is vendored under `vendor/`,
> so the source can be installed in an offline environment.

```
$ ls -d vendor
ls: vendor: No such file or directory
```

It also instructs `npm install --offline --ignore-scripts`, which will fail.

**Fix:** correct `README.md` to say `npm install`.

---

## KI-08 — Two divergent ignore lists 🟡 {#ki-08}

| List | Location | Size |
|---|---|---:|
| Ingestion | `core/platform/config/defaults.ts:7` `IGNORED_DIRECTORIES` | **~60** entries |
| File watcher | `extension/core/extension.ts:77` (regex in `queueIntelligenceRefresh`) | **~19** directory patterns |

The watcher regex additionally filters files by extension
(`extension.ts:82`: `.log .tmp .swp .class .jar .png .jpg .jpeg .gif .ico .woff .woff2`),
which `IGNORED_DIRECTORIES` does not enumerate.

A directory ignored by ingestion but not the watcher triggers pointless
re-index cycles (2s debounce each).

**Fix:** derive the watcher regex from `IGNORED_DIRECTORIES`. Note the watcher
also filters extensions (`.log .tmp .swp .class .jar` + images/fonts), which the
ingestion list doesn't — keep that part separate.

---

## KI-09 — Empty `core/context/compression/` directory 🟡 {#ki-09}

```
$ ls -la src/core/context/compression/
total 0     (empty)
```
Its `types.ts` was deleted; compression now lives inside
`intentContextBuilder.ts`. The empty directory misleads.

**Fix:** `rmdir src/core/context/compression`.

---

## KI-10 — Architectural back-edge 🟡 {#ki-10}

`core/intelligence → core/workflow` (1 import). Intelligence is conceptually
*below* workflow; every other edge runs the other way (13 imports
`workflow → intelligence`).

**Fix:** invert via an interface in `intelligence`, or accept and document it.
The important thing is **not adding more**.

---

## KI-11 — Webview build output is flat-by-basename 🟡 {#ki-11}

`scripts/build.mjs` writes every `src/webview/**` file to
`dist/media/<basename>.js`. Two files with the same basename in different
subdirectories would silently overwrite each other.

Today `src/webview/` is flat, so it works. **It will break the moment someone
adds `src/webview/views/App.tsx`.**

**Fix:** preserve relative paths in the webview output, as `buildApplication()`
already does for `dist/app/`.

---

## KI-12 — `safeToShare` is hardcoded 🟡 {#ki-12}

`handoffSecurity.ts:167` always sets `report.safeToShare = true`, regardless of
findings. The real gate is `assertNoHighConfidenceSecrets()`, which throws.

**Why it matters:** a reader of the `RedactionReport` may treat `safeToShare` as
a verdict. It isn't one.

**Fix:** compute it — `safeToShare: !findings.some(f => f.confidence === "HIGH")`.

---

## KI-13 — Token estimation is a heuristic 🟡 {#ki-13}

`core/context/tokenEstimator.ts` is **3 lines** — a divide. Context-pack budgets
that claim token counts are approximations, not measurements.

**Fix:** acceptable for now, but label it in the UI, or adopt a real BPE
tokenizer if budgets start mattering precisely.

---

## KI-14 — Vendored VS Code type stub 🟡 {#ki-14}

`src/types/vscode/index.d.ts` is a **hand-written 227-LOC partial** of the VS Code
API, picked up via `typeRoots`. There is no `@types/vscode`.

**Symptom you will hit:** `npm run typecheck` reports "property does not exist"
for a VS Code API that definitely exists.

**Fix:** extend the stub with the members you need. Do **not** install
`@types/vscode` casually — it would change many inferred types at once across a
codebase with no test safety net.

---

## KI-15 — Older docs are stale ℹ️ {#ki-15}

`docs/*.md` outside `docs/dev/` are product/specification documents describing
intent. They are not maintained against the code. Treat
[`docs/dev/`](README.md) as authoritative for *how the code works today* and the
older docs as authoritative for *what the product is trying to be*.

See the table in [`docs/dev/README.md`](README.md).

---

## Suggested order of attack

1. **KI-00** — commit the baseline. Everything else is riskier without it.
2. **KI-04** — 4 lines of JSON; restores disk management for users.
3. **KI-07, KI-09, KI-05** — documentation/cruft cleanup, near-zero risk.
4. **KI-01** — add the protocol drift check (option 1). High value, low risk.
5. **KI-11, KI-08, KI-12** — small correctness fixes.
6. **KI-03** then **KI-02** — build test seams first, then decompose. Never the
   reverse.

Next: [`15-recipes.md`](15-recipes.md).
