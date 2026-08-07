# Keystone Gap Analysis

**Assessment date:** 2026-08-07
**Reference:** attached Keystone product plan and current source tree
**Status:** Active phased work; this file records gaps that materially affect product conformance.

## Executive summary

Keystone has the intended product spine: deterministic local ingestion, OKF persistence, graph/CPG/query surfaces, intent-led SDLC, bounded Copilot delegation, validation, handoff, and Browser View. The remaining work is concentrated in the quality of the intelligence contract rather than the existence of screens.

The highest-risk issue is architectural: OKF is authoritative for several UI projections, but some task-time consumers still rebuild and consume parallel `RepoIntelligence` or `RepositoryModel` data. This can produce different answers in Explorer, Query, R&D, QA, and Copilot context.

## Priority gaps

### P0-1 — Canonical OKF-first task boundary

**Status:** Partial
**Evidence:** `src/core/intelligence/okf/canonicalContext.ts` provides the shared OKF query plus bounded graph-neighborhood selector and a canonical retrieval-shape adapter. When a promoted snapshot exists, Intent context and prompt enhancement rank paths only from the OKF query/graph; raw repository records are used for source-body excerpts. Task QA/security/performance/modernization, the task R&D/SDLC evidence matrix, and background workers carry the same bounded selection envelope. Background workers now wait for successful promotion, consume the persisted structural snapshot, scope source and test discovery to canonical paths, and persist worker/snapshot/timing metadata. Persisted envelopes are restored into shared application state, shown in Activity, and included in task engineering evidence. Missing worker artifacts no longer trigger repository-wide task-evidence rescans: task analysis uses the canonical Captain-agent result and snapshot findings, while standalone QA is scoped to the promoted OKF selection and modernization requires the persisted snapshot.

**Impact:** The same intent may receive different intelligence depending on which feature produced it. OKF becomes an export/projection for some paths rather than the common engineering knowledge contract.

**Closure:** Envelope validation, restoration, task evidence, and UI display are complete for the current slice. The task-evidence rescan fallback is closed; remove or consolidate the remaining standalone QA/test-discovery path and deepen provider semantics. Raw repository records may remain ingestion inputs and source-body lookup, but task-time retrieval must use OKF IDs, relationships, evidence, confidence, freshness, and source locations.

### P0-2 — Missing canonical engineering entities

**Status:** Partial
**Evidence:** `EngineeringEntityFact` and `engineeringEntityDetector.ts` now discover database, table, ORM entity, query, feature flag, fixture, CI/CD, infrastructure, component, event, build-system, and package-manager facts; OKF promotion maps them into typed units and validated relationships. Deterministic adapters cover direct FastAPI/Flask, Spring, ASP.NET, Ktor, and Actix routes, plus explicit Prisma, TypeORM, Entity Framework, SQLAlchemy, Django, GORM, Eloquent, Active Record, Sequelize, Mongoose, Drizzle, Knex, SQLx, and JPA `EntityManager` query forms. The project-aware TypeScript semantic worker merges compiler-resolved cross-file calls and `extends`/`implements` bindings into the structural model before a second atomic OKF promotion. Coverage remains provider-agnostic for languages/frameworks without semantic enrichment.

**Impact:** The canonical model can answer basic table/query/flag/build/infrastructure questions and compiler-backed TypeScript/JavaScript call/type questions, but cross-file ORM resolution, framework-specific database semantics, and API → service → repository → table chains remain incomplete.

**Closure:** Add semantic providers and framework adapters, then validate cross-file and cross-language entity relationships against CPG/data-flow evidence.

### P0-3 — Security and performance depth

**Status:** Partial
**Evidence:** Repository analysis and task agents use regex/pattern libraries for initial security and performance signals; when the affected file has available API, call, persistence, or dependency facts, findings attach that scoped structural evidence and its provenance. Explicit authorization guards/decorators and database operations inside loops are promoted to distinct review findings, each carrying an explicit limitation warning.

**Impact:** Findings can identify suspicious text and attach available structural context, but cannot yet reliably prove source-to-sink paths, authorization boundaries, hot calls, database access, or measured regressions.

**Closure:** Add proven CPG/control-data-flow, authorization-boundary, call-path, runtime, and benchmark evidence; current scoped structural context is supporting evidence rather than a source-to-sink conclusion.

### P0-4 — Large intelligence navigation

**Status:** Partial
**Evidence:** Explorer returns a bounded 120-unit page with a snapshot-bound opaque cursor, matching-unit count, UI continuation, and a viewport-windowed renderer that mounts only visible/overscanned rows. Graph and CPG views support bounded expansion, active-frame branch collapse, and priority-ordered progressive UI segments: seeds/selected nodes and high-connectivity nodes appear first and further bounded segments are user-requested. Persisted degraded ingestion state is restored into the shared Browser View/VS Code application state and is rendered as "Needs attention", never as ready.

**Impact:** Large repositories are indexed but not meaningfully explorable.

**Closure:** Cursor pagination, Explorer virtualization, progressive graph/CPG segments, active-frame graph collapse, explicit degraded-state indicators, and locally persisted graph focus are complete slices. Shared workspace-level view preferences remain deliberately separate from analysis-policy settings.

### P0-5 — Context continuation and adaptive segments

**Status:** Partial
**Evidence:** Context packs now contain ordered packet metadata with stable packet IDs, segment kinds, token estimates, and continuation tokens; task workspaces persist the manifest and payloads in `context.json` and `context-packets.json`. The shared UI can retrieve a full packet or adaptive summary/intelligence/source-excerpt segments, and retrieval rejects an outdated OKF snapshot.

**Impact:** Packet continuation and correction context are actionable; a user-approved retry can re-enter Copilot from `review-required`, captured output is attached to the same SDLC delegation, and passing post-correction validation completes an eligible story through its normal completion transition without fabricating acceptance criteria.

**Closure:** Packet retrieval, adaptive segments, freshness validation, changed-path correlation, affected-path refresh, packet-ID-bound retry delegation, captured result attachment, impacted retry validation, and guarded post-correction completion are complete slices. Preserve deeper semantic feedback.

### P1-1 — Persistent caching

**Status:** Partial
**Evidence:** Context reuse is persisted under `.keystone/context/cache` and includes the canonical OKF snapshot digest in its key. Deterministic language-analysis payloads persist under `.keystone/cache/extractions` by file path/content hash/extractor version; TypeScript/JavaScript compiler semantic results persist under `.keystone/cache/semantics` by source/config hash and provider version; query and graph results persist by normalized request and OKF snapshot digest. Extraction/query/graph/compiler-semantic entries are age/count-pruned by the cache-maintenance path, and removal metrics are surfaced to the user. VS Code language-service results are intentionally not persisted because their availability and cross-workspace state are host-dependent.

**Impact:** Re-indexing still performs full canonical reconciliation and semantic/CPG stages, while persistent cache growth and semantic projection policy need explicit operational controls.

**Closure:** The TypeScript/JavaScript compiler cache is content-addressed by eligible source hashes, ts/jsconfig hashes, and the TypeScript provider version; cache entries are retained with the normal cache-maintenance policy. Any future persistable provider must demonstrate a stable provider/configuration fingerprint before joining this cache.

### P1-2 — Polyglot semantic depth

**Status:** Partial
**Evidence:** TypeScript/JavaScript are compiler-backed. Other non-artifact languages have a VS Code language-service enrichment path for document symbols and available definition, reference, implementation, and call-hierarchy evidence, bounded to 96 queried symbols per document; absent or unavailable providers retain deterministic structural analysis.

**Impact:** Broad discovery works, but cross-language callers, implementations, references, and data flow are less precise.

**Closure:** The language-service adapter and capability reporting path are implemented. Verify installed providers against representative real workspaces, add provider-specific cross-file/data-flow bindings only when their returned evidence supports them, and retain deterministic fallback when no provider is available.

### P1-3 — Copilot result feedback

**Status:** Partial
**Evidence:** Captured Copilot results are persisted; failed validation or delegation now creates `correction-packets.json` with the prior response excerpt, failure/remediation evidence, current OKF snapshot digest, Git diff hash, changed paths, OKF-affected paths, selected OKF IDs/relationships/evidence, bounded source paths, and a copyable retry prompt. A review-required story can explicitly approve that packet for Copilot; the packet ID and captured artifact are attached to the SDLC delegation. The UI refreshes those paths through incremental canonical reconciliation and runs impacted validation.

**Closure:** Passing post-correction validation is recorded against the active Intent and completes an eligible story through the normal SDLC transition; deepen semantic test impact.

### P1-4 — Worker efficiency and isolation

**Status:** Partial
**Evidence:** The intelligence stage pool uses configurable default concurrency five. Four role-specific worker threads start only after a successful OKF promotion, or recover from the last validated promoted snapshot when a refresh fails, consume one persisted structural snapshot plus a bounded canonical scope, persist snapshot/timing/worker metadata, and fail or time out independently. Identical active snapshot runs are coalesced; superseded and cancelled runs persist explicit state; coordinator and worker-thread late writes cannot overwrite a newer snapshot/run; each role retries timeout/error failures independently up to the configured default of two retries; a matching non-exhausted failure record resumes at its persisted next attempt after host restart; exhausted errors are logged; and restored UI state marks older records stale. Task analysis now consumes canonical task-agent/snapshot evidence when a worker artifact is pending; standalone QA is also scoped to a promoted OKF selection. Stage contexts are still serialized per worker; process-health telemetry remains open.

**Closure:** Share promoted snapshot/projection inputs across all remaining workflow fallbacks, define thread/process semantics, and add richer process-health telemetry. Last-promoted-snapshot recovery after a failed refresh, matching retry-attempt resume across a host restart, run coalescing, cross-run freshness, explicit cancellation/staleness, late-write protection, bounded retry, and exhausted-failure diagnostics are now implemented.

### P2-1 — Documentation and evidence drift

**Status:** Addressed for the current slice
**Evidence:** The conformance, gap, architecture, OKF profile, storage, and implementation-plan documents now record the same partial capabilities, landed slices, remaining gaps, and verification policy. Runtime/schema evidence artifacts remain required before they are used as acceptance proof.

**Closure:** Keep the reconciled-document rule active after every material change and never mark a capability complete from counters alone.

## Dependency order

```text
Contract baseline
      ↓
Canonical OKF boundary
      ↓
Entity and analyzer depth
      ↓
Explorer / graph / query scale
      ↓
Context continuation and Copilot feedback
      ↓
SDLC evidence closure
      ↓
Caching and large-repository hardening
```

## Verification approach

Verification for this work uses focused automated regression tests, source inspection, type/build/lint/package checks, persisted snapshot inspection, runtime evidence, and visual UI checks. No single count or check is accepted as proof of semantic completeness.
