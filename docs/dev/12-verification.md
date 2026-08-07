# 12 — Verification

Focused tests live under [`tests/`](../../tests) and run through the dependency-free
Node test runner (`npm test`). Broader verification is done by standalone Node
scripts that `require()` built output under `dist/app/`. This works because
`core/` never imports `vscode` ([`03-architecture.md`](03-architecture.md)) —
the domain logic runs in plain Node.

Every result below is real output captured from an actual run.

---

## Current baseline — all green ✅

```bash
npm run verify:source
```

```
> node scripts/clean.mjs
> tsc -p tsconfig.json --noEmit
> tsc -p tsconfig.webview.json --noEmit
> node scripts/lint.mjs
Linted 147 active source file(s).
Active boundary verified: 144 reachable monolithic source files, npm lockfile
present, no legacy engines, no arbitrary ingestion caps, and Git remains read-only.
```

```bash
npm run build
```
```
Built extension/core and webview modules.
Built 5 webview module(s).
```

| Gate | Status |
|---|---|
| `npm run build` | ✅ |
| `npm run typecheck` (extension + webview) | ✅ |
| `npm test` | ✅ — focused Node test suites |
| `npm run lint` | ✅ |
| `node scripts/check-active-boundary.mjs` | ✅ |
| `npm run verify:core` | ✅ |
| `npm run verify:okf` | ✅ |

The exact counts change as the extension evolves; rerun the listed commands
instead of using this historical output as an acceptance result.

### Reconciling the file counts

| Number | Meaning |
|---|---|
| **132** | all `.ts`/`.tsx` under `src/` (what `lint.mjs` walks) |
| **3** | `.d.ts` files (`src/types/vscode`, `src/types/vscode-test-electron`, `src/webview/react-globals.d.ts`) |
| **129** | non-`.d.ts` source files (what the boundary check counts as reachable) |
| **124 + 5** | build output: 124 core/extension `.js` + 5 webview `.js` |

132 − 3 `.d.ts` = 129. **Nothing is orphaned** — the counts are consistent.

(124 + 5 = 129 emitted modules; the webview's 5 are `webview.js`, `App.js`,
`GraphCanvas.js`, `model.js`, `vscodeApi.js`.)

---

## The verification ladder

Run these in order of increasing cost.

### Tier 1 — source gates (seconds, no build)

```bash
npm run verify:source
```
= `clean` → `typecheck` → `lint` → `check-active-boundary`

| Script | What it proves |
|---|---|
| `tsc --noEmit` ×2 | the code typechecks under both tsconfigs |
| `scripts/lint.mjs` | no prohibited patterns; every `@core/@vscode/@webview` alias resolves |
| `scripts/check-active-boundary.mjs` | reachability, lockfile present, no legacy engines, **no ingestion caps**, **Git read-only** |

`check-active-boundary.mjs` is the guardian of the product's structural promises.
If you add a file cap to ingestion or a Git write, this fails.

### Tier 2 — core harness (build + ~5s)

```bash
npm run verify:core     # = build && node scripts/verify-core.mjs
```

Real output:
```
PASS revisionGuard: sidecar round-trip, no forced rebuild when gitless
PASS snapshotPrune: kept 1, removed 4, freed 4.0 MB
PASS clearIntelligenceCache: removed 2.0 MB

ALL CORE VERIFICATION PASSED
```

Covers `ingestion/revisionGuard.ts` and `ingestion/snapshotPrune.ts`. It creates
real temp repos with `fs.mkdtemp`, writes 1 MB dummy snapshots, and asserts real
byte reclamation — not mocks.

Assertions:
- gitless repo → `current()` and `detectMismatch()` return `undefined`
- `revision.json` sidecar round-trips
- gitless + prior record → **no** forced rebuild
- `reclaimSnapshotArchives` keeps exactly 1 of 5, footprint shrinks, `freedBytes > 0`
- `clearIntelligenceCache` removes the whole `intelligence/` dir

### Tier 3 — OKF / graph harness (build + ~10s)

```bash
npm run verify:okf   # = build && verify-call-resolution.mjs && verify-graph-stack.mjs
```

Real output:
```
PASS call-resolution: base.method 'helper.doWork' resolved via import scope
     (no global fallback, no unresolvedCallee)
CALL-RESOLUTION VERIFICATION PASSED

PASS graph-stack: OKF emitted 1 calls edge(s); explorer projected 6 node(s), 5 edge(s)
PASS graph-stack: canonical graph is OKF-derived (intelligenceExplorer -> GraphCanvas),
     independent of deleted intelligence/graph/*
GRAPH-STACK SIGN-OFF PASSED
```

**These two protect the most subtle invariants in the codebase:**

- `verify-call-resolution.mjs` — a method call `helper.doWork()` must resolve via
  **import scope**, not a global name match. A global fallback would create false
  call edges between unrelated same-named methods across the whole repo. Run this
  after any change to `cpg/typescriptSemantic.ts`.
- `verify-graph-stack.mjs` — the UI graph must be **OKF-derived**
  (`OKF → intelligenceExplorer → GraphCanvas`) and must not depend on the deleted
  `intelligence/graph/*` model. This is the regression gate against reintroducing
  a second graph store.

### Tier 4 — cross-feature (build + slow)

```bash
npm run verify:cross-feature   # = build && node scripts/verify-final.mjs
```

A ~40 KB harness that loads ~15 built modules and exercises them together:

```
LANGUAGE_DEFINITIONS, LanguageCapabilityRegistry, analyzeLanguageFile,
buildRepositoryIntelligence, indexRepository,
OkfSnapshotStore, validateOkfSnapshot, KEYSTONE_OKF_PROFILE, validatePortableOkfBundle,
CpgShardStore, SDLCEngine,
TaskStatePackageBuilder, verifyTaskStatePackage,
encryptHandoffPackage, decryptHandoffPackage,
ApplicationStore, startBrowserViewServer, ValueEdgeClient, CockpitService
```

This is the closest thing to an integration test suite. Run it before any change
that spans layers (handoff, OKF format, SDLC, browser view).

### Tier 5 — production acceptance (very slow)

```bash
npm run verify:production   # = build && node scripts/verify-production-acceptance.mjs
```

Copies the **actual project** into a temp workspace, then spawns
`scripts/verify-production-cockpit.mjs` as a child process (twice, once per mode)
with `NODE_OPTIONS=--max-old-space-size=2048`. It indexes a real repository
end-to-end.

Use this before packaging a release, not during normal development.

### Packaging verification

```bash
npm run package:vsix    # build + stage + zip → dist/keystone-1.0.0.vsix
npm run verify:vsix     # requires `unzip` on PATH
```

`verify-vsix.mjs` asserts, for both `dist/keystone-<version>.vsix` and
`dist/keystone.vsix`:

**Required entries:**
```
extension.vsixmanifest
extension/package.json
extension/dist/app/extension/core/extension.js
extension/dist/media/index.html
extension/dist/media/webview.js
extension/dist/media/react.production.min.js
extension/dist/media/react-dom.production.min.js
extension/node_modules/typescript/lib/typescript.js
```

**Forbidden entries** — the archive must contain no:
- nested `.vsix`
- `/src/**.ts` or `/src/**.tsx` (no source leakage)
- `/.keystone/` (no captured workspace state)

### Evidence capture

```bash
npm run evidence:browser   # build && node scripts/evidence-browser.mjs
```
Captures Browser View evidence artifacts.

---

## What is *not* covered

Be honest with yourself about this list when you make a change:

| Area | Coverage |
|---|---|
| `core/` domain logic | partial — via verify-core / verify-final |
| OKF format + validation | good — verify-final + verify-graph-stack |
| Call resolution | good — dedicated script |
| Handoff crypto round-trip | good — verify-final |
| **The webview UI** | ❌ **none** — no DOM tests, no component tests |
| **The message protocol** | ❌ **none** — and the boundary is untyped ([KI-01](14-known-issues.md#ki-01)) |
| **VS Code integration** | ❌ **none** — no `@vscode/test-electron` (the type stub exists, the package doesn't) |
| Individual pipeline stages | ❌ none in isolation |
| Error/degraded paths | ❌ mostly none |

**Practical consequence:** for anything touching `src/webview/` or the message
protocol, **manual testing in the Extension Development Host is the only
verification that exists.** Budget time for it.

---

## Recommended workflow

```bash
# while iterating
npm run build && <reload the Extension Development Host with Cmd+R>

# before you consider a change done
npm run verify:source

# if you touched core/ intelligence, okf, or cpg
npm run verify:core && npm run verify:okf

# if you touched handoff, sdlc, browser view, or cross-layer plumbing
npm run verify:cross-feature

# before packaging
npm run verify:production && npm run package:vsix && npm run verify:vsix
```

---

## Adding a verification script

Follow the existing convention (documented in `verify-core.mjs`'s own header):

1. Name it `scripts/verify-<thing>.mjs`.
2. Build first, then `require()` from `dist/app/...` — never import `src/`
   directly:
   ```js
   const require = createRequire(import.meta.url);
   const built = (...s) => path.join(process.cwd(), "dist", "app", ...s);
   const { Thing } = require(built("core", "…", "thing.js"));
   ```
3. Use `node:assert/strict`.
4. Create real temp workspaces with `fs.mkdtemp(path.join(os.tmpdir(), "keystone-…"))`
   and clean them up in a `finally`.
5. `console.log("PASS …")` per assertion group; throw to fail.
6. Exit non-zero on failure:
   ```js
   main().catch((error) => { console.error("VERIFICATION FAILED:", error); process.exit(1); });
   ```
7. Wire it into an `npm run verify:*` script in `package.json`.

Next: [`13-conventions.md`](13-conventions.md).
