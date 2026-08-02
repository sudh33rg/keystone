# 01 — Getting Started

Goal: from a fresh clone to seeing Keystone index a real repository, in about ten
minutes.

---

## Prerequisites

| Requirement | Declared | Verified on this machine |
|---|---|---|
| Node.js | `>=20` (`package.json` `engines.node`) | v22.23.1 ✅ |
| npm | `npm@11.12.1` (`packageManager`) | 10.9.8 — works fine |
| VS Code | `^1.92.0` (`engines.vscode`) | needed to run the extension |

There is no Python, Docker, or database dependency.

---

## Step 1 — Install

```bash
cd /Users/sudheer/workspace/keystone
npm install
```

The dependency tree is deliberately tiny. Total installed packages: **25**.

```
Runtime deps:  typescript@5.8.3, react@16.0.0, react-dom@16.0.0
Dev deps:      @types/node, @types/react, @types/react-dom,
               undici-types, prettier@3.9.6
```

**⚠️ TRAP — `README.md` is wrong here.** It says:

> ```bash
> npm install --offline --ignore-scripts
> ```
> The npm toolchain required to build the extension is vendored under `vendor/`

There is **no `vendor/` directory** in this repo. Use a plain `npm install`.

**⚠️ TRAP — React 16.0.0 is pinned and it matters.** The build copies
`node_modules/react/umd/react.production.min.js` and the react-dom equivalent
directly into `dist/media/` (`scripts/build.mjs:114-122`). Those UMD paths must
exist. React 16 also means the webview uses `ReactDOM.render` and a class
component, not `createRoot` and hooks.

---

## Step 2 — Build

```bash
npm run build
```

Real output:

```
> keystone@1.0.0 build
> npm run clean && node scripts/build.mjs

Built 124 extension/core module(s).
Built 5 webview module(s).
```

This produces:

```
dist/
├── app/                 ← CommonJS, one .js per .ts, mirrors src/ layout
│   ├── core/
│   └── extension/
│       └── core/extension.js     ← package.json "main" points here
└── media/               ← the webview bundle
    ├── index.html
    ├── webview.js       ← from src/webview/main.tsx
    ├── App.js, GraphCanvas.js, model.js, vscodeApi.js
    ├── webview.css      ← copied from src/webview/theme.css
    ├── react.production.min.js
    └── react-dom.production.min.js
```

See [`02-build-system.md`](02-build-system.md) for why this looks nothing like a
normal esbuild/vite setup.

---

## Step 3 — Launch the Extension Development Host

Open this folder in VS Code and press **F5**.

`.vscode/launch.json` runs the `Keystone Extension` configuration, which:
- runs `preLaunchTask: npm: compile` (which is `npm run build`),
- launches a new VS Code window with `--extensionDevelopmentPath=${workspaceFolder}`,
- opens `${workspaceFolder}` (this repo) as the target workspace.

**Recommendation:** change the last `args` entry to point at a *different, small*
repository. Keystone will index whatever workspace is open, and indexing this
repo means the extension is analysing itself — confusing when you are learning,
and it will create a `.keystone/` folder here.

---

## Step 4 — Watch it work

In the Extension Development Host window:

1. **Nothing needs to be clicked first.** `activate()` runs on
   `onStartupFinished` and immediately starts indexing every open workspace
   folder (`src/extension/core/extension.ts:57`).
2. Open the **Output** panel → channel **"Keystone Intelligence"**. This is a
   `LogOutputChannel`; it is the single best debugging surface in the product.
3. Run **`Keystone: Open Application`** from the Command Palette to open the UI.
4. Run **`Keystone: Index Repository`** to force a re-index.

### What you should see on disk

Inside the *target* workspace (not this repo):

```
.keystone/
├── intelligence/
│   ├── manifest.json        ← status: indexing → ready|error
│   ├── activity.json        ← rolling event log, good for debugging
│   ├── summary.json         ← the big one
│   ├── snapshot.json
│   ├── current.json         ← pointer to the promoted OKF run
│   ├── stages/01-structural.json … 21-runtime-observability.json
│   ├── okf/                 ← ★ the canonical model
│   ├── okf-bundle/          ← portable Markdown mirror
│   ├── cpg/                 ← gzipped per-file CPG shards
│   └── snapshots/<runId>/   ← archived previous runs
└── background/{qa,security,performance,modernization}.json
```

**⚠️ Disk usage is significant.** See [`08-storage-layout.md`](08-storage-layout.md)
for measured figures and the cache-reclaim commands.

---

## Step 5 — Know your baseline

Run all four gates now, before you change anything:

```bash
npm run build                            # ✅ passes
npm run lint                             # ✅ passes — "Linted 132 active source file(s)."
node scripts/check-active-boundary.mjs   # ✅ passes — 129 reachable files
npm run typecheck                        # ✅ passes — both projects clean
```

Or in one command:

```bash
npm run verify:source   # clean + typecheck + lint + boundary check
```

Real output:

```
Linted 132 active source file(s).
Active boundary verified: 129 reachable monolithic source files, npm lockfile
present, no legacy engines, no arbitrary ingestion caps, and Git remains read-only.
```

**⚠️ This green state is uncommitted.** `git status` shows ~74 modified files
against `HEAD`. Commit or stash-tag the known-good state before you start, so you
can bisect your own changes later ([KI-00](14-known-issues.md#ki-00)).

---

## Step 6 — Deeper verification (optional, slower)

```bash
npm run verify:core      # build + revisionGuard / snapshotPrune harness
npm run verify:okf       # build + call-resolution + graph-stack harness
```

Real output from `verify:okf`:

```
PASS call-resolution: base.method 'helper.doWork' resolved via import scope
PASS graph-stack: OKF emitted 1 calls edge(s); explorer projected 6 node(s), 5 edge(s)
GRAPH-STACK SIGN-OFF PASSED
```

Full catalogue in [`12-verification.md`](12-verification.md).

---

## The commands the extension exposes

Declared in `package.json` → `contributes.commands`:

| Command ID | Palette title |
|---|---|
| `keystone.focusVscode` | Keystone: Open Application |
| `keystone.indexRepo` | Keystone: Index Repository |
| `keystone.analyzeTask` | Keystone: Analyze Intent |
| `keystone.openBrowserView` | Keystone: Open Browser View |
| `keystone.configureValueEdge` | Keystone: Configure ValueEdge |
| `keystone.importValueEdgeFeature` | Keystone: Import ValueEdge Feature |
| `keystone.publishValueEdgeStories` | Keystone: Publish Approved Stories to ValueEdge |

**🔴 BROKEN — two commands are registered but undeclared.**
`keystone.reclaimCache` and `keystone.clearCache` are registered at
`src/extension/commands/cacheMaintenance.ts:19` and `:31` but are missing from
`contributes.commands`, so they never appear in the Command Palette and are
effectively unreachable by users. See [`14-known-issues.md`](14-known-issues.md#ki-04).

---

## Settings

`contributes.configuration` (`package.json:65-101`):

| Setting | Type | Default | Meaning |
|---|---|---|---|
| `keystone.enabled` | boolean | `true` | Enable Keystone commands |
| `keystone.intelligence.maxWorkers` | number (1–16) | `5` | Concurrent stage workers |
| `keystone.valueEdge.baseUrl` | string | `""` | ValueEdge tenant URL |
| `keystone.valueEdge.sharedSpaceId` | string | `""` | |
| `keystone.valueEdge.workspaceId` | string | `""` | |
| `keystone.valueEdge.clientId` | string | `""` | Secret goes in `SecretStorage`, not here |

---

## Packaging (rarely needed)

```bash
npm run package:vsix   # build + stage + zip → dist/keystone-1.0.0.vsix
npm run verify:vsix    # asserts required entries present, forbidden absent
```

`scripts/verify-vsix.mjs` requires `unzip` on `PATH` and asserts the VSIX
contains `extension/dist/app/extension/core/extension.js`, the media bundle,
both React UMD files, and a bundled `typescript` — and that it contains **no**
`src/**.ts`, no nested `.vsix`, and no `.keystone/`.

Next: [`02-build-system.md`](02-build-system.md).
