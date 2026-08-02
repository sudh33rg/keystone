# 16 — Glossary

Terms as used in this codebase. Where a word has a common industry meaning that
differs here, the Keystone-specific meaning is stated.

---

### A

**Active boundary** — the rule set enforced by `lint.mjs` and
`check-active-boundary.mjs`: no Git writes, process execution only in 3 files,
no type suppression, no obsolete concepts, no ingestion caps, every path alias
resolves. See [`13-conventions.md`](13-conventions.md).

**Activity trail** — `intelligence/activity.json`: append-only log of every
pipeline event (stage start/complete, CPG eligibility, promotion). Debugging
source of truth. See [`08-storage-layout.md`](08-storage-layout.md).

### B

**Background worker** — one of four `worker_threads`
(`qa`/`security`/`performance`/`modernization`) spawned after a new promoted OKF
snapshot. Scoped to `evidence.paths`, 120 s timeout. See
[`10-workflow-sdlc.md`](10-workflow-sdlc.md).

**Browser View** — the standalone HTTP server (`browserViewServer.ts`) that serves
the *same* webview bundle to a normal browser, with SSE + cookie auth. Surface
`"browser"` vs `"vscode"`. See [`09-webview-and-protocol.md`](09-webview-and-protocol.md).

### C

**Call graph (call resolution)** — CPG-derived directed edges of
method-invocation. Resolved by *import scope*, not global name matching
(verified by `verify-call-resolution.mjs`). See
[`07-cpg-and-languages.md`](07-cpg-and-languages.md).

**Canonical evidence** — `OkfCanonicalEvidenceEnvelope` tying an analysis result
to a specific OKF snapshot digest + scope paths, so the result is reproducible and
traceable. See [`10-workflow-sdlc.md`](10-workflow-sdlc.md).

**Context pack** — the bounded material handed to Copilot, assembled by
`intentContextBuilder.ts`. Segment kinds: `summary | selected-intelligence |
source-excerpts`. See [`10-workflow-sdlc.md`](10-workflow-sdlc.md).

**CPG** — Code Property Graph. The second live graph model, built by
`typescriptSemantic.ts` for TypeScript and `structuralParser.ts` for everything
else. Consists of `CpgNode` + `CpgEdge` shards. See
[`07-cpg-and-languages.md`](07-cpg-and-languages.md).

### D

**Degraded snapshot** — a promoted OKF snapshot carrying `status: "degraded"` when
a non-fatal stage/analysis failed. The product still works; the UI shows a
warning. See [`06-intelligence-pipeline.md`](06-intelligence-pipeline.md).

**Discoverable artifact** — a *pair* `(path, kind, hash)` the repo scanner found,
independent of whether it was indexed. Rebuild decisions use discoverables, so
adding an ignored file does not trigger re-index. See
[`06-intelligence-pipeline.md`](06-intelligence-pipeline.md).

### E

**Evidence (OKF)** — a backing artifact (file path + hash + excerpt) for a claim;
`KeystoneEvidence` in `okf/types.ts`. Distinct from *canonical evidence*.

**Extension host** — the Node.js process running `extension/core/extension.ts`.
Has `vscode` access. Never runs `core` logic that would need the browser.

### F

**Family** (intelligence) — `INTELLIGENCE_FAMILIES` (6): `repository-structure`,
`code-graph`, `build-test-qa`, `architecture-sdlc`, `context-token`,
`runtime-analysis`. Every pipeline stage belongs to one.

### H

**Handoff** — an encrypted, shareable task-state package
([`11-task-handoff.md`](11-task-handoff.md)). Created via `CREATE_TASK_HANDOFF`;
restored via `RESTORE_TASK_HANDOFF` (requires manual-sync confirmation).

### I

**Ingestion** — the `Discovery → Index → Extract` phase before the intelligence
pipeline. Produces *repo intelligence* (the *input* to OKF). See
[`06-intelligence-pipeline.md`](06-intelligence-pipeline.md).

**Intelligence** — `RepositoryIntelligenceSnapshot`: units/relationships/observations
+ stage results + health. The *output* of the intelligence pipeline, and the *input*
to OKF. Live under `.keystone/intelligence/`.

**Intelligence pipeline** — the sequence of 21 stages that turns indexed files
into the `RepositoryIntelligenceSnapshot`. See
[`06-intelligence-pipeline.md`](06-intelligence-pipeline.md).

### K

**KGNode / KGEdge** — a *deleted* graph model (`intelligence/graph/*`). Do not
infer liveness from these names; the live graph is OKF-derived. See
[`05-data-model-okf.md`](05-data-model-okf.md).

**Knowledge unit** — `KeystoneKnowledgeUnit`: a typed node in the OKF graph
(29 kinds: `data-entity`, `architecture-boundary`, `api-contract`, …). See
[`05-data-model-okf.md`](05-data-model-okf.md).

### L

**Liveness** — whether a component actually runs and is wired up, vs. existing
as dead/stub code. This docs set marks liveness explicitly for every component.

### M

**MessageRouter** — `core/integration/webview/messageRouter.ts`: the single source
of the 41→30 message protocol. See
[`09-webview-and-protocol.md`](09-webview-and-protocol.md).

### O

**OKF (Organized Knowledge Framework)** — the canonical live knowledge graph:
units / relationships / observations / evidence + projections + `graph.json`.
Frozen profile = `KEYSTONE_OKF_PROFILE`; digest = `KEYSTONE_OKF_PROFILE_DIGEST`.
Mutating the profile breaks existing snapshots. See
[`05-data-model-okf.md`](05-data-model-okf.md).

**Orphan file** — a source file not imported anywhere in the repo. Detected by
`verify-core.mjs` for `core/`. Most are intentional (entry points, `.d.ts`,
workers). See [`04-code-map.md`](04-code-map.md).

### P

**Pipeline (intelligence)** — see *Intelligence pipeline*.

**Platform boundary** — the `@core` / `@vscode` / `@webview` / `node:` split
enforced by `tsconfig` + lint + verification. See
[`03-architecture.md`](03-architecture.md).

**Profile (OKF)** — the frozen, validated declaration of legal kinds/relationships
in an OKF graph. Changing it is a breaking change. See
[`05-data-model-okf.md`](05-data-model-okf.md).

**Projection** — an OKF-derived secondary view (e.g. `graph.json`,
`summary.json`) generated by `okf/projections.ts`. Views must be projections, not
new stores. See [`05-data-model-okf.md`](05-data-model-okf.md).

### R

**Repo intelligence** — the indexed *input* to the intelligence pipeline (discoverables,
units, relationships, files). Distinct from "intelligence" (the output).

**Revision guard** — `ingestion/revisionGuard.ts`: detects when code changed
(despite `.gitignore` limits) by `rev` (git sha) or file/hash comparison, never
timestamps. See [`06-intelligence-pipeline.md`](06-intelligence-pipeline.md).

**Root path** — the workspace folder under analysis. Persisted data lives in
`<root>/.keystone/`; never in a global location.

### S

**SDLC** — the workflow layer (`core/workflow/sdlc/engine.ts`): intent → plan →
stories → human approval gates → Copilot delegation → validation. See
[`10-workflow-sdlc.md`](10-workflow-sdlc.md).

**Snapshot (OKF)** — `OkfSnapshot` / `OkfPromotion` in `okf/types.ts`. The
promoted, read-only post-pipeline state. Stored as `current.json` +
`snapshots/`. Promotion is the write barrier. See
[`05-data-model-okf.md`](05-data-model-okf.md).

**Stage (intelligence)** — one step in the 21-stage pipeline producing a
`SectionSummary` ({ summary, items, metrics }) appended to the snapshot. See
[`06-intelligence-pipeline.md`](06-intelligence-pipeline.md).

**Stage (OKF)** — an *artifact* of the intelligence pipeline, persisted as
`intelligence/stages/NN-<id>.json`. Distinct from the intelligence pipeline's
internal stage functions (but they correspond 1:1).

### T

**Target repo** — the repository being analyzed (the workspace). Keystone lives
in `node_modules` inside it; its data lives in `<root>/.keystone/`.

**Token estimator** — `core/context/tokenEstimator.ts`: a 3-line heuristic, not a
real tokenizer. Budget numbers are approximate. See
[KI-13](14-known-issues.md#ki-13).

### U

**Unit (OKF)** — synonym for *Knowledge unit*.

### V

**ValueEdge** — the only outbound network client (`core/integration/valueedge/`).
Optional; secret in `SecretStorage`. See [`10-workflow-sdlc.md`](10-workflow-sdlc.md).

**Verification** — the standalone `verify-*.mjs` harness suite ([`12-verification.md`](12-verification.md)).
This repo has **no test framework**.

### W

**Worker** — see *Background worker*. Also the two pipeline workers
(`intelligenceStageWorker.ts`, `typescriptSemanticWorker.ts`) that run outside the
extension host for isolation/perf.

### Z

*(none — alphabet ends at V here; add entries as the product grows)*

---

## Cross-reference index

| Topic | Doc |
|---|---|
| Where do I start? | [`README.md`](README.md), [`00-orientation.md`](00-orientation.md) |
| Build / run / verify | [`01-getting-started.md`](01-getting-started.md), [`02-build-system.md`](02-build-system.md), [`12-verification.md`](12-verification.md) |
| Layered architecture | [`03-architecture.md`](03-architecture.md) |
| Every file | [`04-code-map.md`](04-code-map.md) |
| OKF model | [`05-data-model-okf.md`](05-data-model-okf.md) |
| Intelligence pipeline | [`06-intelligence-pipeline.md`](06-intelligence-pipeline.md) |
| CPG + languages | [`07-cpg-and-languages.md`](07-cpg-and-languages.md) |
| `.keystone/` layout | [`08-storage-layout.md`](08-storage-layout.md) |
| Webview + protocol | [`09-webview-and-protocol.md`](09-webview-and-protocol.md) |
| SDLC / workflow | [`10-workflow-sdlc.md`](10-workflow-sdlc.md) |
| Encrypted handoff | [`11-task-handoff.md`](11-task-handoff.md) |
| Conventions | [`13-conventions.md`](13-conventions.md) |
| Known issues | [`14-known-issues.md`](14-known-issues.md) |
| How-to recipes | [`15-recipes.md`](15-recipes.md) |
