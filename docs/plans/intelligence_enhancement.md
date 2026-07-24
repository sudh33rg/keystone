# Keystone Intelligence Enhancement Implementation Plan

> **Revised 2026-07-24.** The original 12-phase plan was written
> before large parts of the intelligence layer landed. This revision reconciles the plan
> against the current codebase and folds in extraction opportunities identified from the
> reference repos under `/Users/sudheer/workspace/refs/check/` (see "Reference-Repo
> Findings" at the end).
>
> **Incremental freshness is delivered exclusively by Keystone-owned runtime services.**
> Runtime file watching, repository revision detection, branch-state observation, startup
> reconciliation, manual refresh, change collection, scheduling, and incremental ingestion
> run through `ChangeCollector`, `IngestionScheduler`, and `StartupReconciler`.
>
> Guiding constraints (unchanged): **additive only** — no new runtime deps unless
> justified, no contract/type breaks (optional fields only), no probabilistic/LLM
> behavior in the deterministic core, gate every phase on
> `npm run typecheck && npm run lint && npm test && npm run build`.

---

## Current State (what already shipped — verified by end-to-end trace 2026-07-24)

Before planning new work, this is what the repo actually has. Each row below was
verified by tracing schema → query service → engine dispatch → tests → UI, not by
grepping for a wired `case` statement.

| Original phase | Status | Evidence in repo |
|---|---|---|
| P1 OKF concept query | **STUB — not fulfilled** | `OkfQueryService` only resolves + ranks entities and returns bare `QueryResultItem[]`. **No `methods`/`calls`/`calledBy`/`imports`/`description`/`evidence` enrichment** the original plan promised — no `okfConcept` object exists in `QueryResultItemSchema`. Plus two defects: (a) engine handler `QueryEngine.ts:1885` passes only `{id}`, never `value`, so the service's entire search-mode branch (`OkfQueryService.ts:51-68`) and `rankOkfEntity` are **dead code**; (b) **zero test coverage**; (c) no `okf-concepts` rendering in `QueryWorkspace.tsx`. Functionally equivalent to `SEARCH` today. |
| P2 IMPACT / blast radius | **DONE** ✅ | `ImpactQueryService.analyze` — incoming traversal, direct/transitive split, per-node risk scoring, 7 impact sections (direct/transitive/behavioral/contract/data/tests/architecture), metrics. Tested (`QueryEngine.test.ts:317-339`). UI renders risk factors + follow-up buttons. |
| — FLOW (not in original plan) | **DONE** ✅ | `FlowQueryService.reconstruct` — flow templates, stage matching, bounded traversal, terminal reasons, diagnostics. |
| P3/P5/P10 D3.js graph UI | **OBSOLETE** | Repo ships `@xyflow/react` (ReactFlow) + 12 view builders + `IntelligenceCanvasWorkspace.tsx`. D3 would duplicate this. |
| P4 Architecture view | **DONE (ReactFlow, not Mermaid)** ✅ | `ArchitectureQueryService.analyze` — centrality, cycles, orphan modules, layer violations, dead-code candidates. `ARCHITECTURE`/`CYCLES` ops; `ArchitectureViewBuilder.ts`; `architecture` view type. Tested (`:506-646`). |
| P6/P7/P9/P11 Security | **PARTIAL** | `SecurityIntelligenceServices.ts` (13 services) exists; **no `SECURITY_SCAN` query op / router wiring** |
| P8/P12 Repo overview | **PARTIAL** | `IntelligenceOverview.tsx` exists with counts/dependencies; no dedicated Architecture/Dependencies graph tabs |

Visualization view types already defined (`src/shared/contracts/visualization.ts`):
`architecture, dependencies, calls, flow, data, tests, impact, evidence, schema, technology`.

Query operations already defined (`src/shared/contracts/query.ts`):
`SEARCH, ENTITY, NEIGHBORHOOD, USAGES, DEPENDENCIES, DEPENDENTS, PATH, IMPACT, FLOW,
TESTS_FOR, UNTESTED, ARCHITECTURE, CYCLES, DATA_USAGE, CONFIGURATION_USAGE, CHANGES_TO,
DIFFERENCE_BETWEEN, CPG_SCOPE, CONTROL_FLOW, DATA_FLOW, BACKWARD_SLICE, FORWARD_SLICE,
CONDITIONS_FOR, OKF_CONCEPT`.

---

## Phase 0: Cleanup / correctness (do first — trivial, unblocks the rest)

### 0.1 Remove duplicate enum entries (bug)
`QueryOperationSchema` in `src/shared/contracts/query.ts` lists `IMPACT` twice
(lines 13 & 30) and `ARCHITECTURE` twice (lines 17 & 31). Zod tolerates it and tsc is
green, but it's dead/confusing. Delete the trailing duplicates (lines 30–31) so the enum
ends at `"OKF_CONCEPT"`.

**Verification:** `npm run typecheck && npm test` stays green; grep confirms each op
appears once.

---

## Phase 1: Query ranking — graph-distance & diversity rerankers *(NEW, from graphiti)*

### Overview
Keystone's `ResultRanker` (`QueryEngine.ts`) scores by exact-match tiers + token overlap
+ evidence confidence + graph degree (centrality). It has **no "distance to a focus
node" reranker** and **no diversity reranker**. Graphiti's `search_utils.py`
(`node_distance_reranker`, `maximal_marginal_relevance`, `rrf`) are the reference.
Node-distance is the cheap, high-value win (no embeddings required — pure graph BFS over
the snapshot we already hold in memory).

### Implementation
1. Add optional `centerEntityId?: string` to the query filters
   (`QueryFiltersSchema`, additive optional field).
2. In `ResultRanker` / `CompleteQueryEngine`, when `centerEntityId` is present, compute
   BFS shortest-path distance from the center over the existing in-memory adjacency
   (`context.incoming` / `context.outgoing`, already built), and add a bounded
   `RANKING_WEIGHTS.proximity` term that decays with distance. Reuse
   `GraphTraversalService`; do **not** add a graph DB.
3. (Optional, later) MMR-style diversity pass gated behind an explicit flag; only if a
   concrete query kind needs it. Skip embeddings — approximate "similarity" via shared
   module/package/token overlap so it stays deterministic and dep-free.

### Verification
Unit test: same query with vs without `centerEntityId` reorders results so nearer
symbols rank higher; distance ties fall back to existing score ordering (stable).

---

## Phase 2: Framework / route detection breadth *(NEW, from codegraph)*

### Overview
codegraph ships **21 framework resolvers** (`src/resolution/frameworks/`): Drupal, Play,
Expo, Fabric, Swift/ObjC, C#/ASP.NET, React Native, NestJS, etc. Keystone's
`TechnologyRegistry.ts` + `SchemaRules.ts` cover ~12. These are keyword/regex rules —
drop-in additions to the existing rule maps, guarded by the inert-by-default pattern
already used for technology/schema extraction.

### Implementation
1. Extend `FRAMEWORK_RULES` / route-decorator patterns in `TechnologyRegistry.ts` and
   `SchemaRules.ts` with the missing frameworks (prioritize ones present in target
   codebases: NestJS routes, ASP.NET, React Native, Play, Drupal).
2. Follow the Phase-C route gotchas already documented in the
   `keystone-intelligence-extraction` skill (namespace by token case; denylist
   library aliases; migration-framework ordering).
3. Keep additions behind the existing `enabled` flag; no pipeline changes.

### Verification
Extend `SchemaSurfaceExtractor.test.ts` / technology tests with per-framework fixtures;
`vitest run` unit-green; e2e rebuild harness asserts no unresolved endpoints.

---

## Phase 3: SECURITY_SCAN query operation *(completes original P6/P7/P9)*

### Overview
`SecurityIntelligenceServices.ts` already implements the analysis (attack surface, trust
boundaries, auth paths, sensitive-data flow, gates). The gap is exposing it as a query
operation + UI, not building the engine.

### Implementation
1. Add `"SECURITY_SCAN"` to `QueryOperationSchema` (single entry — mind Phase 0).
2. Add a `SecurityScanQueryService` facade in `QueryEngine` that assembles
   `SecurityAnalysisAssembler` output into `QueryData` (issues grouped by severity).
3. Route via existing `intelligenceQuery` handler in `WebviewMessageRouter` (no new
   message type needed — reuse the operation dispatch).
4. Optional config `securityScan.enabled` (default true) via existing state schema.

### Verification
Query a repo → issues grouped by severity with evidence links; risk scores present;
disabled flag short-circuits.

---

## Phase 4: Repository overview — Architecture & Dependencies tabs *(completes P8/P10)*

### Overview
`IntelligenceOverview.tsx` shows counts. Add graph tabs backed by the **existing**
`ArchitectureViewBuilder` / `DependencyViewBuilder` + ReactFlow — not D3, not new
handlers.

### Implementation
1. Add "Architecture" and "Dependencies" tabs to `IntelligenceOverview.tsx` that request
   the `architecture` / `dependencies` view types through the existing visualization
   dispatch and render with the shared ReactFlow component used in
   `IntelligenceCanvasWorkspace`.
2. No new message contracts; reuse `IntelligenceVisualizationService`.

### Verification
Tabs render community/dependency graphs; empty-state handled; no new deps in
`package.json`.

---

## Phase 5: Complete OKF concept enrichment *(finishes original P1 — currently a stub)*

### Overview
`OkfQueryService` today only resolves + ranks entities — it returns bare
`QueryResultItem[]` with no concept enrichment, making `OKF_CONCEPT` functionally
identical to `SEARCH`. The original plan's promise (methods, calls, called-by, imports,
description, evidence) was never implemented. This phase delivers it, fixes the dead-code
handler bug, and adds coverage.

### 5.1 Fix the engine handler bug (blocker)
`QueryEngine.ts:1885` calls `this.okf.query(context, { id: resolved[0]?.selected?.id })`
— it never forwards `value`, so the service's search-mode branch and `rankOkfEntity` are
unreachable. Pass both: `{ id: resolved[0]?.selected?.id, value: <raw seed value> }`.

### 5.2 Add the `okfConcept` result shape (additive schema)
Extend `QueryResultItemSchema` in `src/shared/contracts/query.ts` with an **optional**
`okfConcept` object (additive, non-breaking):
```typescript
okfConcept: z.object({
  description: z.string().max(1000),
  methods:   z.array(z.object({ id: z.string(), name: z.string(), line: z.number().int().nonnegative() })).max(50),
  calls:     z.array(z.object({ id: z.string(), name: z.string() })).max(100),
  calledBy:  z.array(z.object({ id: z.string(), name: z.string() })).max(100),
  imports:   z.array(z.object({ id: z.string(), name: z.string() })).max(100),
  evidenceIds: z.array(z.string()).max(30),
}).optional()
```

### 5.3 Build the concept in `OkfQueryService`
Add `buildOkfConcept(entity, context)` that derives, from the **existing** snapshot
graph (no new indexing):
- **methods** — `DECLARES`/`contains` children of the entity that are Method/Function.
- **calls** — outgoing `CALLS` relationships (target names).
- **calledBy** — incoming `CALLS` relationships (source names).
- **imports** — `IMPORTS` relationships on the entity's file.
- **description** — first evidence excerpt (reuse `context.evidenceById`).
- **evidenceIds** — the entity's `evidenceIds`.

Reuse `context.incoming` / `context.outgoing` adjacency already built by `QueryContext`.
Attach the object to the resolved item(s); keep the ranked-search fallback for value
queries.

### 5.4 Test coverage (currently zero)
Add `tests/unit/intelligence/query/OkfConcept.test.ts` asserting: exact-id lookup returns
one item with a populated `okfConcept` (methods/calls/calledBy/imports); value search
returns ranked concepts; entity with no relationships yields empty arrays not `undefined`;
evidence excerpt populates `description`.

### 5.5 UI rendering (optional, follow-on)
Add an `okf-concepts` branch in `QueryWorkspace.tsx` that renders the concept card
(description + methods/calls/called-by/imports lists) instead of falling through to the
generic result list.

### Verification
`npm run typecheck && npm run lint && npm test && npm run build` green; new OKF test file
passes; manual `okf <symbol>` query returns an enriched concept.

---

## Explicitly dropped from the original plan

- **D3.js everywhere (P3, P5, P10):** superseded by `@xyflow/react`. Adding D3 would be a
  redundant runtime dependency and violate the additive-only rule.
- **Mermaid architecture diagrams (P4):** ReactFlow `ArchitectureViewBuilder` already
  covers this interactively; static Mermaid is optional and low value.
- **Standalone "tools" duplicating views (P11, P12):** the canvas/overview surfaces
  already provide these; standalone tools would fork UI state.
- **Out-of-process sync mechanisms:** not planned. Runtime file watching, repository
  revision detection, branch-state observation, startup reconciliation, manual refresh,
  change collection, scheduling, and incremental ingestion through Keystone-owned runtime
  services (`ChangeCollector`, `IngestionScheduler`, `StartupReconciler`) are the approved
  freshness mechanisms.

---

## Reference-Repo Findings (basis for the new phases)

Evaluated `/Users/sudheer/workspace/refs/check/` (10 repos). Verdict: Keystone's
intelligence layer is stronger than all of them; only **3 narrow, additive borrows**
are worth doing (now Phases 1–2 above; security + overview are internal).

| Repo | Net-new value | Action |
|---|---|---|
| **codegraph** (TS, tree-sitter→SQLite→MCP) | 21 framework resolvers | Phase 2 |
| **graphiti** (Py temporal KG) | node-distance / MMR / RRF rerankers | Phase 1 (node-distance) |
| Keystone-Part01 | doc stubs (<500 B) | none |
| codepropertygraph (Joern/Scala) | formal CPG schema | none — Keystone has `CpgQueryService` |
| openwiki | LLM doc generation | none — probabilistic |
| fastcontext | trained explorer models | none — model weights, not patterns |
| obsidian-second-brain / strix / SWE-agent / rtk / agent-token-optimizer / tree-sitter-gram | note-taking / agents / CLI compression / grammar | none — out of domain or already covered by `ContextCompressionEngine` |

**Skip criteria applied:** anything LLM-driven, model-weight based, agent-orchestration,
or requiring a new runtime/graph DB (Neo4j, Scala/Bazel) — these re-introduce coupling or
non-determinism Keystone deliberately avoids. Anything introducing out-of-process state
that conflicts with Keystone's in-process reconciliation pipeline was likewise excluded.

---

## Suggested order

1. **Phase 0** (cleanup, minutes)
2. **Phase 5.1** (OKF handler bug fix — one-liner, unblocks OKF entirely)
3. **Phase 5.2–5.4** (OKF enrichment + tests — finishes the original headline feature)
4. **Phase 2** (framework breadth — lowest risk, high value, pure rule additions)
5. **Phase 1** (node-distance reranker — best querying-quality payoff)
6. **Phase 3** (SECURITY_SCAN — exposes existing engine)
7. **Phase 4** (overview tabs — UI polish on existing builders)
8. **Phase 5.5** (OKF UI card — follow-on polish)

## Summary of changes

| Phase | Category | Breaking? | Source |
|---|---|---|---|
| 0 | Fix duplicate enum entries | No | internal bug |
| 1 | Node-distance/diversity reranker | No (optional filter field) | graphiti |
| 2 | More framework/route rules | No (additive rules) | codegraph |
| 3 | SECURITY_SCAN query op + UI | No (additive op) | internal (engine exists) |
| 4 | Overview Architecture/Dependencies tabs | No (reuse builders) | internal |
| 5 | Complete OKF concept enrichment + bug fix + tests | No (optional `okfConcept` field) | internal (stub → done) |

**All changes remain additive.** No existing functionality is modified or removed.

---

## Phase 6: Guided Intelligence experience layer *(NEW — discovery-first UX over the existing engine)*

### Problem
Every capability above (semantic graph, CPG, architecture/dependency builders, flows,
impact, security/performance, schema/route/messaging extraction, OKF, evidence,
provenance, confidence, context packages) already exists and is deterministic — but it is
**fragmented and exposed mainly as generic graph/query tools**. A developer who knows
nothing about the repository cannot open Intelligence and understand the system through
visible buttons, guided submenus, diagrams and progressive drill-down; they must learn
internal query names, graph terminology, symbol identifiers and repository paths.

### Design (additive layer — zero changes to the deep engine)
A thin orchestration + presentation layer sits **on top of** the existing
`IntelligenceQueryService` (`unified()` + `overview()`) and `CpgQueryService`. It
introduces **no second source of truth** and no new extraction — it only reshapes existing
query results into a guided, discovery-friendly envelope.

- **Canonical guided contract** — `src/shared/contracts/guidedIntelligence.ts`:
  `GuidedRequest` (view + action + optional entity/orientation/limits) and `GuidedResult`
  (answer summary, entities, canonical `GuidedDiagram`, ordered `flowPaths`, ranked
  evidence, confidence, limitations, diagnostics, orientation breadcrumbs, follow-up
  actions, context candidates, generation). The canonical `GuidedDiagram` models
  `nodes`/`edges`/`containers`/`steps`/`orientation`/`legend` with typed `NodeKind`,
  `EdgeInteraction` (http-request, database-read/write, event-publish/subscribe,
  queue-send/receive, foreign-key, calls, imports, …), and `ConfidenceCategory`
  (exact → resolved → cpg-assisted → convention-based → structurally-inferred →
  candidate → unresolved).
- **Deterministic mapping helpers** — `src/core/intelligence/guided/diagramMapping.ts`:
  pure, dependency-free functions (`classifyInteraction`, `classifyNodeKind`,
  `classifyConfidence`, `toGuidedNode`, `toGuidedEdge`, `buildDiagramForResult`,
  `buildContextCandidates`). Relationship `type` literals (`keystone.core.READS_FROM`,
  `WRITES_TO`, `EMITS`, `CONSUMES`, `ROUTE_EXPOSES`, `FOREIGN_KEY`, …) map
  deterministically to edge interactions; entity types map to node kinds; unresolved /
  candidate relationships render dashed. Extracted as pure functions specifically so they
  are unit-testable in isolation and reusable across every guided submenu.
- **Orchestration facade** — `src/core/intelligence/guided/IntelligenceOrchestrationService.ts`:
  accepts a `GuidedRequest`, picks the correct existing `QueryOperation`
  (ARCHITECTURE / FLOW / CONTROL_FLOW / DATA_FLOW / DATA_USAGE / DEPENDENCIES),
  calls `IntelligenceQueryService.unified(...)`, and assembles one `GuidedResult` with
  diagram, orientation breadcrumbs, follow-ups and context candidates. `overview()`
  produces the repository orientation (name/type, readiness, generation, languages,
  detected technologies) plus "Start exploring" and "Ask a question" follow-ups.
- **Transport** — additive `intelligence/guided` request/response wired through
  `messages.ts`, `WebviewMessageRouter.ts`, and `HostBridge.ts`. The existing
  `intelligence/*` messages and the `/intelligence` route are left untouched.
- **UI** — `src/ui/components/intelligence/GuidedIntelligence.tsx` on a new
  `/intelligence-guided` route: full-width workspace, visible secondary navigation
  (all submenus shown as buttons — slice-1 six enabled, the rest visibly present and
  labelled as later slices, no "Coming soon" placeholders, no overflow hiding),
  orientation strip with breadcrumbs, Overview with "Start exploring" grid + Ask panel,
  semantic diagram renderer (hierarchical for system-landscape, left-to-right / swimlanes
  for flows), colour-and-shape legend (not colour-only), dashed inferred edges, entity
  list with confidence badges, and a shared one-click context tray with token estimate.

### Slice 1 status (DONE ✅ — gated)
Overview, Systems, Architecture, Flows, Messaging, and Data-and-Database render real
repository data through the contracts above. Covered by
`tests/unit/intelligence/GuidedIntelligenceOrchestration.test.ts` (13 tests):
relationship→interaction classification, entity→node-kind mapping, confidence
categorisation, system-landscape diagram construction, ordered-flow correctness with
orientation (left-to-right default, top-to-bottom for startup), messaging
producer→consumer classification, database read/write classification, evidence
propagation onto edges, unresolved→dashed handling, context-candidate selection, and the
service-level `overview()` / `run()` envelopes.

### Later slices (same contracts, no engine changes)
APIs/Routes, Dependencies, Code, Tests, Impact, Security, Performance, OKF, Explore, and
Ask submenus are added by extending `operationForView` + the orchestration mappers and
enabling their already-visible secondary-nav buttons — no new transport or contract work.

### Guarantees
Purely additive: no existing Intelligence capability, view builder, query operation,
schema/route/messaging extractor, CPG service, security/performance service, OKF path,
evidence/provenance/confidence, or context-package integration is modified, simplified,
duplicated or removed. Global navigation stays Home / Work / Intelligence / History. No
new runtime dependency; the semantic diagram renderer is dependency-free SVG and is
interchangeable with the existing `@xyflow/react` builders in a later slice.

### Correction log
- **2026-07-24 (first revision):** Original plan marked OKF (P1) and IMPACT (P2) as
  deliverables to build. A later revision wrongly marked both **DONE**. End-to-end trace
  shows: **IMPACT/blast radius, FLOW, and ARCHITECTURE are genuinely complete and tested**,
  but **OKF is a stub** (no concept enrichment, dead-code handler path, zero tests, no UI).
  Phase 5 added to finish OKF.
- **2026-07-24 revision:** Incremental freshness is delivered by Keystone-owned runtime
  services only — runtime file watching, repository revision detection, branch-state
  observation, startup reconciliation, manual refresh, change collection, scheduling, and
  incremental ingestion. Phases 4–6 renumbered to 3–5; all phase references in tables,
  suggested order, and reference-repo findings updated.
