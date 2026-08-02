# Keystone Graph Intelligence — Current State, Comparison vs `codebase-memory-mcp`, and Extraction Plan

> **For Hermes:** planning artifact only. No code was changed and no verify command was run to produce this.

**Goal:** Establish exactly what Keystone's graph intelligence is today (measured, not assumed), compare it honestly against `DeusData/codebase-memory-mcp` (CBM), and plan the specific, in-scope things worth extracting.

**Scope guard:** Keystone is a local-first **VS Code extension** (`docs/NON_GOALS.md`: no other IDE hosts, no cloud/headless runtime). CBM is a **static C binary MCP server**. Nothing in this plan proposes adopting CBM's runtime, daemon, binary distribution, or MCP surface. Only *techniques* are extractable.

---

## 1. Current Keystone graph intelligence — evidence-backed inventory

Total intelligence subsystem: **12,354 LOC** across `src/core/intelligence/` (54 files).

### 1.1 There are FOUR parallel graph models, not one

| # | Model | File | LOC | Status |
|---|-------|------|-----|--------|
| 1 | **OKF knowledge graph** (units / relationships / observations / evidence) | `src/core/intelligence/okf/types.ts` + `fromRepoIntelligence.ts` | 161 + 724 | **LIVE — the real one** |
| 2 | **CPG** (AST/EOG/CFG/DFG/CDG/call) | `src/core/intelligence/cpg/types.ts` + 4 builders | 54 + ~1,200 | **LIVE — persisted as gz shards** |
| 3 | **`RepositoryGraphAnalysis`** (file-level derived graph) | `src/core/intelligence/pipeline/derivedGraph.ts` | 315 | **LIVE — in-memory only** |
| 4 | **`KGNode`/`KGEdge` "Knowledge Graph"** | `src/core/intelligence/graph/types.ts` | 1,077 | **DEAD — zero producers** |
| 5 | **`KnowledgePlatformGraph`** | `src/core/intelligence/graph/platformModel.ts` | 171 | **DEAD — always `undefined`** |

### 1.2 The live path (OKF) — verified against real artifacts on disk

`.keystone/intelligence/okf/` from run `eebd8ad2…`, indexing 151 file units:

```
units.jsonl          23,811     relationships.jsonl  31,389
observations.jsonl   11,967     evidence.jsonl       55,396
projections/graph.json  16M     search.jsonl  10M     cpg-bindings.jsonl 572K
```

Relationship distribution (measured):

| count | kind | | count | kind |
|---|---|---|---|---|
| 20,473 | `defines` | | 292 | `may-impact` |
| 2,548 | `flows-to` | | 222 | `imports` |
| 2,475 | `reads` / 2,475 `writes` | | 31 | `extends` |
| **2,037** | **`calls`** | | 7 | `implements` |
| 491 | `contains` | | 1 | `exposes` |
| 309 | `depends-on` | | | |

Unit distribution: 13,657 `call-flow`, 4,337 `symbol`, 2,723 `data-entity`, 2,475 `data-flow`, 244 `risk-area`, 151 `file`, 120 `package`.

**Pipeline:** `repoIndexer.ts` (741 LOC) → `RepoIntelligence` → `repoIntelligenceToOkf()` → validate → write candidate → promote (`current.json`) → projections (`graph.json`, `search.jsonl`, `cpg-bindings.jsonl`). Consumed by `cockpitService.ts`, `intelligenceExplorer.ts`, `queryEngine.ts`, `intentContextBuilder.ts`.

### 1.3 Measured quality signal — the single most important number

```
call-flow units:                    13,657
resolved `calls` relationships:      2,037
keystone:unresolvedCallee obs:       6,987
→ call resolution rate ≈ 14.9%
```

**~85% of call sites do not resolve to a callee.** This is Keystone's #1 graph-quality gap, and it is exactly the gap CBM's Hybrid LSP layer exists to close. Every downstream feature (impact analysis, dead code, blast radius, `calls`/`impact`/`flows` explorer modes) inherits this ceiling.

Why: resolution in `fromRepoIntelligence.ts:433` is **bare-name matching** —
`symbolByName.get(call.callee.split(".").at(-1))` then `candidates[0]`. No receiver type, no import binding, no scope, no overload discrimination. First-match-wins.

Evidence methods are honest but coarse — only 3 buckets across 55,396 records: `deterministic-relationship` (25,067), `deterministic-extraction` (19,628), `deterministic-observation` (10,701).

### 1.4 Language coverage

`languageRegistry.ts` defines **35 languages**, but tiered:
- `typescript` / `javascript` → `deep`, semantic provider = TypeScript compiler
- **all 33 others** → `deterministic` structural adapter

The universal frontend is `structuralParser.ts` (362 LOC) — a **regex + brace/indent line classifier**, explicitly "intentionally not a compiler." It emits `declaration|control|call|assignment|import|…` per line. Real ASTs exist only for TS/JS via `typescriptSemantic.ts`.

### 1.5 Dead weight (confirmed by reference count)

`graph/types.ts` is 1,077 LOC of aspirational schema copied from other projects (comments name code-review-graph, codegraph, GitNexus, Graphiti, axoniq, Chisel, the-librarian, codebase-memory-mcp-main). **Zero external references** for every one of: `DEFAULT_COMMUNITY_EDGE_WEIGHTS`, `CouplingEdge`, `ExecutionFlow`, `RiskScore`, `TestCodeEdge`, `MemoryDocument`, `Episode`, `TemporalKGEdge`, `EvidenceTrace`, `RELATIONSHIP_TYPES`, `PIPELINE_PHASES`, `LSP_CONFIDENCE_FLOOR`, `ResolvedCall`, `SkipPattern`, `CompressConfig`, `KGSearchResult`, `TaskContext`, `Subgraph`, `TraversalOptions`.

The `Language` union has **~30 duplicated members** (`lua`, `luau`, `julia`, `fortran`, `nim`, `crystal`, `ada`, `ocaml`, `racket`, `scheme`, `solidity`, `verilog`, `rescript`, `notebook`, `sql`, `powershell`, `zig`, `perl`, `elixir`, `bash`, `jsx`, `vue`, `svelte`, `clojure`, `erlang`, `haskell`, `d`, `pascal` repeated). Harmless to TS, but a clear signal of copy-paste accretion.

Dead reachability chain: `RepoIndex` type has **no producer anywhere in `src/`** → `suggestImpactedTests()` is only called from `qaGapAnalysis.analyzeDeep(ctx, index)` → the sole caller `qaService.ts:129` passes **only `ctx`**, so `index` is always `undefined` → `findFileEvidence()` and 10 other `graphQuery.ts` functions are **unreachable at runtime**. Same for `KnowledgePlatformGraph`: `modernization-api.ts` accepts it in 6 signatures, and no call site ever supplies it.

### 1.6 Operational problem found while inspecting

`.keystone/intelligence/` is **1.3 GB for a 137-file repository**:
- `snapshots/` = **1.1 GB** — 10 archived runs × ~110 MB each, no retention policy
- `okf/` 112 MB + `okf-bundle/` 96 MB + `snapshot.json` 14 MB + `summary.json` 9.5 MB

Uncompressed JSONL, full copy archived per run. It is gitignored, so it is a disk/IO problem, not a repo problem — but it will not survive a real customer repo.

### 1.7 Other facts

- **0 test files** in `src/` (`*.test.ts` / `*.spec.ts` count = 0).
- Runtime deps: `typescript`, `react@16`, `react-dom@16`. No graph/DB library — everything hand-rolled over JSON/JSONL.
- Traversal is `Array.filter` over flat arrays (`graphQuery.ts`) — O(N) per hop, no adjacency index.
- Genuinely good: Tarjan SCC cycle detection, BFS flow tracing, connected-component communities, bounded impact analysis (`derivedGraph.ts`); evidence/provenance on every unit; validate-then-promote snapshot discipline; tombstones; `AbortSignal` cancellation.

---

## 2. Head-to-head comparison

| Dimension | Keystone | CBM | Verdict |
|---|---|---|---|
| Parsing | TS compiler for TS/JS; **regex line classifier** for 33 others | 158 vendored tree-sitter grammars, real ASTs | **CBM decisively** |
| Type/call resolution | Bare-name first-match → **~15%** resolved | Hybrid LSP (12 langs): param binding, return inference, generics, JSX dispatch, UFCS | **CBM decisively** |
| Storage | Uncompressed JSONL + JSON projections; 1.3 GB/137 files | SQLite + FTS5, LZ4/zstd, `VACUUM INTO`, index strip | **CBM decisively** |
| Query | Intent-classified NL over in-memory arrays, O(N) scans | openCypher read subset, <1 ms, planner + executor | **CBM** (but see note) |
| Search | Lexical scoring + RRF over `search.jsonl` | BM25/FTS5 + bundled Nomic embeddings, 11-signal scoring | **CBM decisively** |
| Scale | 137 files → 1.3 GB artifacts | Linux kernel 28M LOC → 4.81M nodes in 3 min | **CBM decisively** |
| Community detection | Connected components (`findCommunities`) | Louvain on weighted call edges | **CBM** |
| **Evidence/provenance** | Every unit+relationship carries `OkfEvidence` (extractor, version, run id, source location, digest, freshness) — 55,396 records | Confidence scores on some cross-service edges; no first-class evidence ledger | **Keystone** |
| **Snapshot lifecycle** | Candidate → validate → atomic promote; tombstones; parent run id; per-section digests | Single mutable DB + `.zst` artifact | **Keystone** |
| **Honest uncertainty** | `unresolvedCallee` recorded as an explicit observation rather than a guessed edge | Recent commits show they fight fabricated results (PR #1385 "never fabricate an OPTIONAL no-match") | **Keystone (by design)** |
| **IDE integration** | Native VS Code: webview cockpit, GraphCanvas, explorer, task handoff, Copilot delegation | MCP server; separate 3D UI at `localhost:9749` | **Keystone** |
| **SDLC/workflow coupling** | Graph feeds QA gaps, impact, readiness, delegation packets | Pure structural backend, no workflow | **Keystone** |
| Distribution | VSIX | Single static binary, 7 package managers, SLSA-3, cosign, VirusTotal | **CBM** (out of scope) |
| Tests | **0** | 6,768 badge-reported | **CBM decisively** |
| License | private | MIT (extraction is legally clean) | — |

### 2.1 Keystone's advantages — with reasons

1. **Evidence-first ontology.** Every node/edge is traceable to extractor + version + run + file:line + digest + freshness. CBM has confidence scores; it does not have an audit ledger. For an agent-delegation product where the user must trust a claim before shipping a change, this is the durable differentiator.
2. **Immutable, validated snapshots.** Candidate → validate → promote, tombstones, parent-run lineage, per-section digests. CBM mutates one DB. Keystone can answer "what did we believe at run X, and why."
3. **Honest empty/unknown states.** Unresolved callees become observations, not invented edges — architecturally what CBM has had to patch for repeatedly.
4. **In-IDE, workflow-coupled.** The graph is wired into QA gap analysis, impact, readiness gates, task handoff, and Copilot delegation. CBM stops at "here are the nodes."
5. **Zero-dependency TypeScript.** No native binary, no daemon, no cache-root conflicts, no VirusTotal problem. Ships in a VSIX.

### 2.2 Keystone's disadvantages — with reasons

1. **~15% call resolution.** Bare-name first-match. Everything graph-shaped downstream is built on a 15%-complete call graph.
2. **33 of 35 languages have no AST.** A regex line classifier cannot produce reliable declarations, calls, or scopes. `capabilities.calls/controlFlow/dataFlow` are structurally weak outside TS/JS.
3. **Storage is untenable at scale.** 1.3 GB for 137 files, no retention, no compression, no index. Linear extrapolation to a 10K-file repo is not survivable.
4. **O(N) traversal.** `graphQuery.ts` filters flat arrays per hop; no adjacency map, no persistent index.
5. **~1,250 LOC of dead schema and dead reachability.** Four graph models where one-and-a-half are live; `RepoIndex` has no producer, so `graphQuery.ts` is dead code with real maintenance cost and it misleads every future reader.
6. **No tests.** Zero. Against a subsystem whose whole value proposition is correctness.
7. **No semantic search.** Lexical + RRF only.

---

## 3. What is worth extracting from CBM (and what is not)

### Extract — high value, in scope

| # | Technique | Why | Effort |
|---|---|---|---|
| **E1** | **Multi-pass resolution with typed binding** (CBM: structure → definitions → calls → links). Resolve callees using import bindings + receiver type + scope, not bare names. Emit `confidence` + `strategy` per resolved call, keep unresolved as observations. | Directly attacks the 15% number. Biggest single quality win available. | High |
| **E2** | **Qualified-name scheme** (`<project>.<path_parts>.<name>`) as a stable canonical key + explicit collision rules (CBM hit and fixed the `__init__.py` / `index.ts` folder-vs-module collision). | Keystone's `canonicalKey` has no documented collision semantics; a wrong merge silently corrupts the graph. | Low |
| **E3** | **Adjacency + label/name indexes** built once per snapshot load; O(1) neighbor lookup instead of `Array.filter` per hop. | Fixes traversal cost without adopting SQLite. | Medium |
| **E4** | **Compressed + retained artifacts**: gzip the JSONL (Node `zlib`, already used for CPG shards), and cap `snapshots/` to N runs. | 1.1 GB → tens of MB. Pure win, no architecture change. | Low |
| **E5** | **Louvain (weighted) community detection** replacing connected components. Edge weights already drafted in the dead `DEFAULT_COMMUNITY_EDGE_WEIGHTS`. | Connected components on an import graph yields one giant blob; Louvain yields real modules. | Medium |
| **E6** | **`get_architecture`-style single-call overview** (languages, packages, entry points, routes, hotspots, boundaries, layers, clusters in one response). | Keystone has all the inputs; it lacks the one consolidated projection. Token-efficient for Copilot handoff. | Low |
| **E7** | **Dead-code via graph degree** (`WHERE NOT EXISTS { (f)<-[:CALLS]-() }`), plus CBM's own bug lesson: **a traversal budget must cap materialisation, never detection** (PR #1385). | Keystone's `analyzeDeadCode` requires `orphanSourceFiles` membership — file-level, so it misses dead symbols in live files. And Keystone's `slice(0, N)` limits in `queryEngine.ts`/`intelligenceExplorer.ts` risk exactly CBM's bug class. | Medium |
| **E8** | **Layered ignore semantics**: hardcoded → `.gitignore` hierarchy → `.keystoneignore`, with negation ordering and symlink skip. | `gitignore.ts` is 108 LOC and root-only today. | Low |
| **E9** | **Manifest-driven package resolution** (`package.json`, `go.mod`, `Cargo.toml`, `pyproject.toml`, …) so bare specifiers resolve to real targets. | `resolveLocalDependencies()` only extension-guesses relative paths; only 222 `imports` edges exist for 151 files. | Medium |
| **E10** | **Tree-sitter WASM for the top 5–8 non-TS languages** (`web-tree-sitter` + prebuilt `.wasm`). Replaces the regex classifier where it matters most. | The honest fix for §1.4. Adds a runtime dep and VSIX weight — needs an explicit decision. | High |

### Do not extract — out of scope or wrong for Keystone

- **MCP server / daemon / session coordination** — violates `NON_GOALS.md` (no headless runtime).
- **Single static C binary + 7 package managers + SLSA/cosign** — Keystone ships a VSIX.
- **158 vendored grammars** — VSIX size; take 5–8 via WASM instead.
- **Bundled Nomic embeddings (40K tokens, 768d)** — large binary payload; revisit only after E1–E4 land.
- **Full openCypher engine** — Keystone's NL intent classifier is a better fit for the Copilot-facing product; adopt the *indexes*, not the query language.
- **3D graph UI at localhost:9749** — Keystone has `GraphCanvas` in-webview, and a localhost HTTP server contradicts local-first-in-IDE.

---

## 4. Proposed plan

Sequenced so the cheap wins land first and the expensive one is decided with evidence.

### Phase A — Truth and hygiene (no new capability)

- **A1.** Delete or quarantine the dead `KGNode`/`KGEdge` model (`graph/types.ts`, 1,077 LOC) and `platformModel.ts` (171 LOC) — after confirming `RepoIndex` still has no producer.
  Touches: `src/core/intelligence/graph/*`, `src/core/platform/storage/types.ts`, `src/core/workflow/quality/impactedTests.ts`, `src/core/workflow/modernization/{model.ts,modernization-api.ts}`.
  *Decision required:* delete, or keep and actually wire `RepoIndex` from `repoIndexer`. Do not leave it in limbo.
- **A2.** Deduplicate the `Language` union (~30 repeated members) if `graph/types.ts` survives A1.
- **A3.** Document the four-model situation in `docs/ONTOLOGY_AND_GRAPH.md` — name OKF as canonical and CPG as the second live model.
- **A4.** **E4** — gzip OKF JSONL + retain last N snapshots. Files: `src/core/intelligence/okf/store.ts`, `bundle.ts`.
- **A5.** Stand up the first test harness (there are zero tests). Target `derivedGraph.ts` (Tarjan/BFS/impact are pure and trivially testable) and `fromRepoIntelligence.ts` resolution.

### Phase B — Resolution quality (the 15% problem)

- **B1.** **E2** — formalize qualified names + collision rules in `okf/identity.ts`; add the `index.ts` / folder-vs-module collision guard.
- **B2.** **E9** — manifest-driven package/module resolution in `repoIndexer.resolveLocalDependencies`.
- **B3.** **E1** — replace bare-name callee matching in `fromRepoIntelligence.ts:433` with a strategy ladder (`import-binding` → `receiver-type` → `module-scope` → `bare-name`), each emitting `strategy` + `confidence`; unresolved still becomes an observation.
- **B4.** Re-measure the resolution rate against the same repo. **Gate: publish before/after.** The current baseline is 14.9%.

### Phase C — Query and traversal

- **C1.** **E3** — build adjacency + name/label indexes on snapshot load; migrate `queryEngine.ts` and `intelligenceExplorer.ts` off `Array.filter` traversal.
- **C2.** **E7** — audit every `slice(0, N)` / `limit` in `queryEngine.ts` and `intelligenceExplorer.ts` for CBM's budget bug class (budget must cap output, not detection); then improve `analyzeDeadCode` to symbol-degree rather than file-orphan.
- **C3.** **E5** — Louvain over weighted edges, replacing `findCommunities`' connected components.
- **C4.** **E6** — one consolidated architecture projection for the cockpit and Copilot handoff.

### Phase D — Language reach (explicit decision gate)

- **D1.** **E8** — layered ignore semantics + `.keystoneignore`.
- **D2.** **E10** — spike `web-tree-sitter` with 2 grammars (Python, Go) behind the existing `LanguageDefinition` capability flags. Measure: VSIX size delta, index time delta, resolution-rate delta vs the regex classifier. **Then decide** whether to extend to 5–8 languages.

### Sequencing rationale

A is free cleanup that makes everything after it legible. B is where the actual product value is — a 15% call graph is the ceiling on every "impact / blast radius / dead code" claim Keystone makes to the user. C makes the improved graph usable at speed. D is the only item that changes the dependency footprint, so it goes last and behind a measured spike.

---

## 5. Files most likely to change

| Phase | Files |
|---|---|
| A | `src/core/intelligence/graph/types.ts`, `graph/platformModel.ts`, `graph/graphQuery.ts`, `src/core/platform/storage/types.ts`, `src/core/workflow/quality/impactedTests.ts`, `src/core/workflow/modernization/{model.ts,modernization-api.ts}`, `src/core/intelligence/okf/{store.ts,bundle.ts}`, `docs/ONTOLOGY_AND_GRAPH.md` |
| B | `src/core/intelligence/okf/{identity.ts,fromRepoIntelligence.ts}`, `src/core/intelligence/ingestion/repoIndexer.ts`, `src/core/intelligence/cpg/typescriptSemantic.ts` |
| C | `src/core/intelligence/okf/queryEngine.ts`, `src/core/intelligence/explorer/intelligenceExplorer.ts`, `src/core/intelligence/pipeline/{derivedGraph.ts,deadCode.ts}`, `src/core/integration/webview/cockpitService.ts` |
| D | `src/core/intelligence/ingestion/gitignore.ts`, `src/core/intelligence/languages/{languageRegistry.ts,structuralParser.ts,languageAnalysis.ts}`, `package.json`, `scripts/build.mjs` |

## 6. Validation

Per Sudheer's normal build-out rule (real verification, not description): `npm run typecheck` clean, `npm run build` passing, plus — new for this work — an actual test run once A5 lands.

Phase-specific metrics, each measured on this repo against the recorded baseline:

- **B:** call resolution rate — baseline **14.9%** (2,037 resolved / 13,657 call-flows, 6,987 unresolved observations).
- **A4:** `.keystone/intelligence` total size — baseline **1.3 GB** for 137 source files.
- **C1:** explorer/query latency on the promoted snapshot — baseline is O(N) `Array.filter` per hop over 23,811 units / 31,389 relationships.
- **C3:** community count and largest-community share — baseline is connected components.
- **D2:** VSIX size delta, index wall time delta, and resolution-rate delta for Python/Go.

## 7. Risks and open questions

1. **A1 is a delete of ~1,250 LOC.** Low runtime risk (zero producers confirmed), but needs the explicit call: delete vs. wire up. → **Needs Sudheer's decision.**
2. **B3 changes graph semantics.** More edges and different edges. Old snapshots stay valid via `extractionRunId` lineage, but the cockpit will show different numbers — that must be communicated, not silently shipped.
3. **D2 adds a runtime dependency and VSIX weight** to a project that currently has three deps. Explicit decision gate, not an assumption.
4. **No test safety net exists today.** A5 should land before B3 touches resolution logic.
5. **Open:** is `RepoIndex`/`graphQuery.ts` intentionally staged for a future phase, or genuinely abandoned?
6. **Open:** does the 1.3 GB artifact tree ever get cleaned in the product, or only by `.gitignore`?
7. **Licensing:** CBM is MIT. Extracting *techniques* (multi-pass resolution, QN scheme, Louvain, budget-caps-materialisation) is clean. Do not copy source verbatim without attribution.
