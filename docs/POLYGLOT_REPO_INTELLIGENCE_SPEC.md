# Polyglot Repository Intelligence — Extraction, Technology Detection & Visualization

**Status:** Spec (pending implementation) · **Schema version:** 1 (`INTELLIGENCE_SCHEMA_VERSION`)
**Owner:** Keystone core · **Depends on:** existing `RepositoryIndexService`, `IntelligenceSnapshotSchema`, `IntelligenceQueryService`, `IntelligenceVisualizationService`, `StableId`, `EvidenceRecord`, `IgnorePolicy`.

---

## 0. Problem & Intent

Today Keystone's repository intelligence leans on the VS Code document-symbol provider, which is effectively TypeScript/JavaScript-only (`extractorVersions` shows `"keystone.typescript"` or `"vscode.document-symbol-provider"`). Non-TS files are inventoried but land as `parseStatus: "unsupported"`.

We need the intelligence graph to be the **single source of truth for Copilot context** and to be **queriable, graph-visualizable, and hierarchical**, while **covering every folder** of the repo and extracting **any programming language, any framework, any ORM, and any database**.

This is achieved by adding a **deterministic, static, in-process extraction engine** (no Python, no server, no LLM) on top of the existing snapshot/query/visualization layers. Reference implementations studied: `Understand-Anything` (`web-tree-sitter` + 14 language extractors + framework registry + non-code parsers), `okf-generator`/`okfgen` (manifest-driven technology detection + static-HTML graph), and `repomix` (bounded token packing).

---

## 1. Design Principles (non-negotiable)

1. **Deterministic & evidence-backed.** Every symbol, relationship, and diagnostic carries its own `EvidenceRecord` with a distinct `sourceKind`. No LLM, no speculation, no probability.
2. **No "make it green" shortcuts.** Phase outputs are validated against `IntelligenceSnapshotSchema` (zod `.strict()` + `superRefine`) at write time. A malformed record fails immediately, never silently.
3. **One schema is the contract.** All phases write the *same* record shapes (`IntelligenceSymbolRecord`, `IntelligenceRelationshipRecord`, `IntelligenceEvidenceRecord`, `IntelligenceDiagnostic`). Nothing outside the schema.
4. **Graceful degradation, never silent skip.** A language whose grammar fails to load, or an ORM we don't recognize, yields `parseStatus: "unsupported"` / `analysisLevel: "metadata-only"` — it is recorded, never dropped.
5. **Full coverage by assertion.** Every file under every workspace root is present in `snapshot.files` with a defined `analysisLevel`. Coverage is proven by a test, not assumed.
6. **Reuse prior-phase services.** Each phase extends `RepositoryIndexService` ingestion (`IngestionDelta` + `DeltaMerger` + `DependencyInvalidator`) and the existing query/visualization services. No parallel graph model.

---

## 2. Reference Architecture (how phases plug in)

```
                       WorkspaceAdapter.enumerateAll()  (already enumerates ALL files)
                                          │
                                          ▼
   ┌──────────────────────────── RepositoryIndexService.executeRun ───────────────────────────┐
   │                                                                                            │
   │  for each candidate file (concurrent, bounded):                                            │
   │    1. ClassificationDecision  (category / analysisLevel / included / excluded)  [EXISTING]  │
   │    2. Phase A: TreeSitterExtractionAdapter   → symbols (function/class/method) + calls/imp  │
   │    3. Phase B: TechnologyDetectionService    → framework/ORM/DB symbols from manifests       │
   │    4. Phase C: SchemaSurfaceExtractor        → table/column/FK/route/migration edges         │
   │       (each writes into the SAME IngestionDelta with stableId + EvidenceRecord)             │
   │                                                                                            │
   │  merge → IntelligenceSnapshot → validate(superRefine) → store → [EXISTING]                  │
   └────────────────────────────────────────────────────────────────────────────────────────────┘
                                          │
                  ┌───────────────────────┼────────────────────────┐
                  ▼                       ▼                        ▼
        IntelligenceQueryService   IntelligenceVisualizationService   Copilot context pack
        (search / usages / CPG)    (architecture / deps / calls /    (TaskContextService +
                                    flow / data / impact + React    ContextCompressionEngine)
                                    Flow graph + FileExplorer tree)
```

**Why no separate server:** extraction runs in the existing background worker (`GraphIndexerWorker`) using `web-tree-sitter` (WASM) loaded in-process. The okfgen Python tooling is **reference-only** — its *logic* (manifest scanning, OKF bundle) is reimplemented in TypeScript inside the extension. No Python runtime, no child process, no network service.

---

## 3. The Shared Contract (guarantees no inter-phase conflict)

These rules are defined **once**, here, and every phase obeys them.

### 3.1 Extractor registry & precedence
- Each language has **one authoritative extractor**. Tree-sitter (`web-tree-sitter`) is authoritative for every language with a loaded grammar.
- The VS Code document-symbol provider remains **fallback only** for languages with no grammar and no tree-sitter config.
- `FileRecord.parserId` records which path produced the symbols (e.g. `"keystone.tree-sitter.python@1"`, `"vscode.document-symbol-provider"`).

### 3.2 Stable-ID namespaces (per phase)
Deterministic IDs via `stableId(...)`. New namespaces introduced by this spec:

| Namespace | Example | Produced by |
|---|---|---|
| `ts-symbol` / `vs-symbol` | existing | existing |
| `tssym` (tree-sitter symbol) | `tssym:<fileId>:<lang>:<qualifiedName>` | Phase A |
| `framework` | `framework:<repoId>:<id>` | Phase B |
| `orm-entity` / `db-table` | `db-table:<repoId>:<schema>.<name>` | Phase B/C |
| `ext-service` | `ext-service:<repoId>:<name>` | Phase B |
| `route` | `route:<repoId>:<method>:<path>` | Phase C |

Two phases can never collide on the same file because the namespace prefix is distinct.

### 3.3 Evidence provenance (`sourceKind`)
Each phase uses distinct values from the existing `EvidenceRecord.sourceKind` enum:
- Phase A → `language-provider`
- Phase B → `manifest`, `framework-rule`, `database`, `infrastructure`
- Phase C → `schema`, `database`, `configuration`

Because facts from different sources carry different `sourceKind` + distinct IDs, there is nothing for phases to overwrite or conflict on.

### 3.4 Merge semantics
All phases accumulate into one `IngestionDelta`. On re-emit of the same stable id:
- **dedupe by id**, **merge `evidenceIds` arrays** (existing `DeltaMerger` behavior);
- `analysisLevel` resolves to the **highest-fidelity** value seen (`deep` > `structural` > `metadata-only` > `excluded`).

### 3.5 Coverage & graceful handling
- `ClassificationDecision.included` decides presence in `snapshot.files`. **All** enumerated files are present.
- `analysisLevel` is always set; `parseStatus` reflects extraction outcome (`parsed` / `partial` / `unsupported`).
- A missing grammar → `parseStatus: "unsupported"`, `analysisLevel: "metadata-only"`, file still indexed (name, size, language, category).

---

## 4. Phases

### Phase A — Multi-language Structural Extraction

**Goal:** Extract functions/classes/methods + call + import relationships for any language with a tree-sitter grammar, in-process via WASM.

**Deliverables:**
- `TreeSitterExtractionAdapter` (mirrors `Understand-Anything`'s `TreeSitterPlugin`):
  - lazy-loads `web-tree-sitter` + per-language `tree-sitter-<lang>.wasm`;
  - caches one parser per language; single-parse `analyzeFileFull` (structure + call graph) to halve parse work;
  - **graceful skip** when a grammar can't be resolved — never throws out of the indexing loop.
- `LanguageExtractor` per language: `python`, `javascript`, `typescript`, `go`, `rust`, `java`, `ruby`, `php`, `c`, `cpp`, `csharp`, `dart`, `kotlin`, `swift`, `scala` (reference extractor logic ported from `Understand-Anything`).
- Wired into `RepositoryIndexService.indexFile` alongside the existing path.
- Emits `IntelligenceSymbolRecord` (type `keystone.core.Function|Class|Method|Interface`) + `IntelligenceRelationshipRecord` (`calls`, `imports`, `contains`) with `EvidenceRecord(sourceKind: "language-provider")`.

**Acceptance Criteria (A.1–A.6):**
- A.1 `npm run typecheck` clean.
- A.2 `npm test` green including a new unit test that parses the reference `tests/fixtures/complex` polyglot files (`.py`, `.go`, `.rs`, `.java`, `.ts`) and asserts expected function/class symbols + `calls` edges are emitted with valid evidence.
- A.3 A missing grammar (e.g. intentionally unresolvable wasm) yields `parseStatus: "unsupported"` for that language and **does not** break indexing of other languages (test asserts the batch still completes).
- A.4 Every emitted symbol/relationship passes `IntelligenceSnapshotSchema.safeParse` on a synthetic snapshot (no `superRefine` violations).
- A.5 `FileRecord.parserId` is set to the tree-sitter extractor id; TS/JS uses tree-sitter precedence over document-symbol.
- A.6 `npm run build` succeeds (grammar WASM lazy-loaded, not bundled into the main chunk).

---

### Phase B — Technology Detection (Frameworks / ORMs / Databases)

**Goal:** Detect frameworks, ORMs, databases, and external services from manifests and config, and represent them as first-class symbols.

**Deliverables:**
- `TechnologyDetectionService` (ports `okf-generator` `manifest_scanner` + `Understand-Anything` `FrameworkRegistry`, generalized to ORMs + DBs):
  - reads manifest/config file contents (`package.json`, `requirements.txt`, `pyproject.toml`, `go.mod`, `Cargo.toml`, `pom.xml`/`build.gradle`, `Gemfile`, `mix.exs`, `composer.json`, `*.csproj`, `Package.swift`, `pubspec.yaml`, `docker-compose.yml`, `*.tf`);
  - matches `detectionKeywords` → framework/ORM; detects DB drivers → `keystone.core.Database`; infra manifests → `keystone.core.ExternalService`.
- Emits `Database`, `Table`/`Entity`, `ExternalService`, and framework "concept" symbols + `EvidenceRecord(sourceKind: "manifest"|"framework-rule"|"database"|"infrastructure")`.
- Reuses `FileRecord.category` (`manifest`/`migration`/`schema`/`infrastructure`).

**Acceptance Criteria (B.1–B.5):**
- B.1 `npm test` green incl. a fixture test: a `pyproject.toml` with `sqlalchemy`/`fastapi` + a `docker-compose.yml` with `postgres` + `redis` → asserts `Database` symbols for postgres/redis, a `framework` symbol for fastapi, and `ExternalService` symbols, each with valid evidence.
- B.2 No duplicate framework symbol when the same keyword appears in multiple manifests (dedupe by stable id).
- B.3 `IntelligenceSnapshotSchema.safeParse` clean for a snapshot containing B-phase symbols.
- B.4 Detection is keyword+manifest driven only (no network, no LLM) — test asserts zero external calls.
- B.5 Typecheck + build green.

---

### Phase C — Schema / ORM / Migration Surface

**Goal:** Extract relational schema (tables, columns, FKs), ORM model→table mapping, migrations, and HTTP routes; link them to detected databases.

**Deliverables:**
- `SchemaSurfaceExtractor`:
  - **SQL parser** (ports `Understand-Anything` `SQLParser`): `CREATE TABLE/VIEW/INDEX` + columns; emits `Table`/`keystone.core.Table` symbols with `properties.columns`.
  - **ORM model parsers**: SQLAlchemy/Django (py), TypeORM/Prisma (ts), Hibernate (java), Rails ActiveRecord (rb), Eloquent (php) → `Entity` symbols linked to their `Database` via `defines_schema` relationship.
  - **Migration parsers**: Rails `db/migrate`, Alembic, Django, Flyway/Liquibase, TypeORM → versioned schema-change evidence.
  - **Route parsers**: FastAPI/Flask/Django, Express/Fastify, Spring, Rails, Gin → `keystone.core.Route` symbols (`method` + `path`) linked via `routes`.
  - FK / `references` edges between `Table` symbols → enable impact analysis.

**Acceptance Criteria (C.1–C.5):**
- C.1 `npm test` green incl. fixture test: `migrations/001_init.sql` (`users` + `orders` with FK) + a Django `models.py` + a FastAPI `main.py` (`@app.get("/users")`) → asserts `Table` symbols with columns, a FK `references` edge, an `Entity` for the Django model, and a `Route` symbol; all with valid evidence.
- C.2 `defines_schema` edge connects each `Entity` to exactly one `Database` (or is flagged as unresolved diagnostic, never dangling).
- C.3 `IntelligenceSnapshotSchema.safeParse` clean (including FK edges resolving to existing table ids).
- C.4 Unknown ORM → `analysisLevel: "metadata-only"` on the model file, no crash.
- C.5 Typecheck + build green.

---

### Phase D — Query, Fuzzy Search & Visualization

**Goal:** Make the graph queriable, fuzzy-searchable, graph-visualizable (with hierarchical file tree), and serializable as a bounded Copilot context source.

**Deliverables:**
- Upgrade `IntelligenceVisualizationService.searchEntities` substring match → **Fuse.js fuzzy** (ports `Understand-Anything` `SearchEngine`): name/qualifiedName/tags/summary, type-filtered, bounded limit.
- Add view builders reusing `BaseViewBuilder`:
  - **Technology view**: frameworks/ORMs/DBs/external-services as a subgraph.
  - **Schema view**: databases → tables → columns + FK edges.
  - **Routes view**: services → routes.
- Webview React Flow graph (port `Understand-Anything` dashboard pattern: graph canvas + 360px sidebar + `FileExplorer` tree built from the structural graph) fed by the existing `IntelligenceVisualizationService` output (`IntelligenceVisualNode/Edge`).
- Optional okfgen-style **static-HTML export** (self-contained canvas force-graph, no CDN) for sharing/CI artifacts.
- Copilot context: extend `TaskContextService` to pull relevant `Database`/`Table`/`Route`/`ExternalService` symbols from the snapshot (repomix-style bounded selection) so delegated tasks receive schema/framework grounding.

**Acceptance Criteria (D.1–D.6):**
- D.1 `npm test` green incl. test that the polyglot conformance snapshot (Phases A–C) is **fully queryable**: search by framework name returns the framework node; find usages of a table returns its FK neighbors; a schema-view build returns the expected nodes/edges.
- D.2 React Flow webview renders the snapshot graph from `IntelligenceVisualizationService` output (UI test asserts nodes/edges present, no inert state).
- D.3 Fuzzy search returns typo-tolerant results (e.g. "pythn" → python file) within bounded time.
- D.4 Static-HTML export opens and renders the graph with correct node count (visual/headless assertion or snapshot of node count).
- D.5 Copilot context pack for a task touching `users` table includes the `users` `Table` symbol + its FKs (bounded token budget respected).
- D.6 Typecheck + lint + build green.

---

## 5. End-to-End Conformance Test (the "works like I expect" guarantee)

A single fixture repo is built from the **reference polyglot fixtures** (`tests/fixtures/complex` + `realworld/*` from `Understand-Anything`, plus a `docker-compose.yml`, an `init.sql`, a Django `models.py`, a FastAPI `main.py`). The conformance test runs **all phases A–D in one pipeline** and asserts:

1. `IntelligenceSnapshotSchema.safeParse(snapshot).success === true` with **zero** `superRefine` violations.
2. **Coverage:** every file enumerated from the fixture root is present in `snapshot.files` with a defined `analysisLevel` (none dropped).
3. **Multi-language:** symbols exist for ≥5 distinct languages; `parseStatus` distribution recorded.
4. **Technology:** expected `Database`/`framework`/`ExternalService` symbols detected from manifests/compose.
5. **Schema surface:** `Table` symbols with columns; ≥1 FK `references` edge; `Route` symbols present; `Entity`→`Database` `defines_schema` edges resolve.
6. **Queryable:** `IntelligenceQueryService` + fuzzy search resolve the above by id/name/qualifiedName/route/database.
7. **Visualizable:** `IntelligenceVisualizationService.build` succeeds for `architecture`, `dependencies`, `calls`, `data`, and the new `schema`/`technology` views.
8. **Conflict-free:** re-running the pipeline is idempotent — same stable ids, merged evidence, no duplicate symbols.

This test is the merge gate: a phase PR lands only when it passes **and** the conformance suite stays green.

---

## 6. Dependencies & Build Notes

| Dependency | Use | Note |
|---|---|---|
| `web-tree-sitter` | WASM parsing | **Required** (native `tree-sitter` fails on darwin/arm64 + Node 24 — confirmed by reference `CLAUDE.md`). |
| `tree-sitter-*` grammar packages | per-language wasm | Lazy-loaded by language; missing grammar → graceful skip. |
| `fuse.js` | fuzzy search | Browser + Node safe. |
| `reactflow` (or equivalent) | webview graph | Used by existing UI stack already. |

- Grammar WASM must **not** be bundled into the main extension chunk (lazy `import()`), to keep `build` lean and avoid native-binding failures.
- No new runtime process; everything runs in the existing `GraphIndexerWorker`.

---

## 7. Risks & Mitigations

| Risk | Likelihood | Impact | Mitigation |
|---|---|---|---|
| A grammar WASM fails to load on a platform | Medium | Low | Graceful `parseStatus: "unsupported"`; file still indexed at metadata level; test A.3. |
| Tree-sitter AST node types drift between grammar versions | Medium | Medium | Extractors bound to grammar package version in `extractorVersions`; tests pin fixture expectations; semantic fallback for unknown shapes. |
| Two phases over-emit on the same file | Low | Medium | §3 contract: distinct namespaces + `sourceKind`; merge dedupes by id; conformance test #8 proves idempotency. |
| LLM-like behavior creeps in (speculative edges) | Low | High | Deterministic-only rule; `EvidenceRecord` required for every fact; audit in conformance test. |
| Webview graph performance on large repos | Medium | Medium | Bounded query limits + virtualization + level-of-detail; reuse existing `IntelligenceVisualizationService` bounds. |

---

## 8. Verification Gate (per phase and final)

Every phase (and the final merge) must satisfy, in order, with **no** shortcut:

```
npm run typecheck   # tsc --noEmit
npm test            # vitest — includes the new phase unit tests + conformance suite
npm run build       # clean + build:extension + build:webview
```

A phase is "done" only when all three are green **and** the conformance test (§5) passes against the full polyglot fixture. `npm run verify` is the single command that proves it.
