# Keystone Intelligence Execution Plan

## Objective

Keystone is a single VS Code extension that builds deterministic repository intelligence, converts developer intent into approved specifications and task plans, constructs token-efficient context, delegates approved implementation tasks to GitHub Copilot, validates results, supports QA/security/performance checks, prepares Git and PR delivery, and enables Task Handoff.

## Working rules

- Each milestone must end in a working, testable state.
- Do not implement several incomplete subsystems simultaneously.
- Update this document after each completed milestone.
- Record discovered gaps instead of silently changing architecture.
- Mark tasks as complete only after validation.

## Audit baseline — 2026-07-15

The current implementation was audited against `AGENTS.md` and every document under `docs/intelligence`. Planning documents were not treated as implementation evidence.

### Verified execution path

The intended path is `activate()` → concrete workspace/Git/language adapters → `RepositoryIndexService.start()` → file enumeration → sequential file reads → VS Code document-symbol requests → relationship construction → in-memory `RepositoryIndex` → typed Webview router → React SPA.

That path is not runnable today:

- `src/extension/extension.ts` imports and constructs the `WorkspaceAdapter`, `GitAdapter`, `LanguageServiceAdapter`, and `IgnorePolicy` interfaces instead of their concrete implementations. The extension build stops on those four missing runtime exports.
- Indexing is not started on activation or view load. It is reachable only through `index/start` or the un-contributed `keystone.index.restart` command.
- `RepositoryIndexService` scans only workspace root zero, never creates a `FileRecord`, discards extracted symbol and relationship records, never uses its persistence dependency, and retains only an in-memory index summary.
- `buildRelationships()` invents a self-referential `calls` edge for every function or method without a target or call-site evidence.
- The Webview never requests intelligence. `App.tsx` renders Intelligence through `PlannedSection`, and its UI test explicitly asserts that the feature is unavailable.

### Verified quality baseline

- Dependencies are present locally. No lockfile is tracked.
- `npm run typecheck`: failed with 117 errors. Intelligence and its activation path account for verified errors in `RepositoryIndexService`, `GitAdapter`, `WorkspaceAdapter`, `extension.ts`, `WebviewMessageRouter`, shared contracts, and `HostBridge`; deferred feature files also contain pre-existing errors.
- `npm run lint`: failed with 263 errors across 19 source files.
- `npm test`: 4 test files passed and 3 failed; 12 tests passed and 3 failed. Two failing suites did not load (`vscode` runtime import and missing `beforeEach` import).
- `npm run build:webview`: passed.
- `npm run test:extension`: failed before tests because `build:extension` could not resolve the four interface-as-value imports.

### Capability classification

| Capability | Status | Grounded finding |
| --- | --- | --- |
| React SPA shell, navigation, VS Code theme styling | Real | `src/ui/App.tsx`, `src/ui/styles/global.css` |
| CSP and local Webview asset translation | Real | `KeystoneViewProvider.createHtml()` |
| Request IDs, runtime message validation, response correlation | Partial | Useful foundation, but host-event payload typing drifts and request results are `unknown` |
| Foundation UI-state persistence | Real but unrelated to intelligence | `WorkspaceStateStore` persists navigation/workflow count in Memento only |
| Workspace/language/Git adapter seams | Partial | Interfaces exist; activation constructs the wrong values and Git uses nonexistent public VS Code types |
| Repository scan | Incorrect/partial | One root, sequential full reads, broken URI-relative paths, no size/custom-exclusion enforcement, swallowed failures |
| File classification and exclusions | Incorrect | Tests are generated; CI is secret/dot-excluded; source is never returned; manifest precedence/case is broken; required exclusions are incomplete |
| Symbol declarations | Partial/incorrect | Raw provider call exists, but its return shape, symbol-kind mapping, IDs, container identity, export flag, evidence, and persistence are wrong |
| Semantic relationships | Placeholder/incorrect | Only fabricated self-`calls` edges exist |
| Canonical evidence | Absent | No evidence record type or store |
| Stable repository/file/symbol/edge/evidence IDs | Absent | Index, symbol, and edge IDs use random UUIDs per scan |
| Local intelligence persistence and atomic writes | Absent | The injected Memento store is unused; there is no intelligence file store |
| Restart reload and query continuity | Absent | All intelligence is process-local and discarded |
| Overview query | Absent | No query service or contract; `index/search` is accepted but never routed |
| Intelligence UI | Placeholder | `PlannedSection` only; bootstrap claims conflict with actual state |
| Continuous ingestion, workers, reconciliation, CPG, OKF | Absent | Correctly deferred from Milestone 1 |

### Code to retain

- `WorkspaceStateStore` for small Webview/navigation state only.
- `ConfigurationService` and its existing indexing settings after they are wired.
- Workspace and language adapter boundaries after converting VS Code values into canonical DTOs.
- Zod-backed message validation, correlation IDs, router response caching, and the `HostBridge` listener pattern after contract repair.
- `KeystoneViewProvider` CSP/resource handling.
- The React SPA shell, navigation, icon system, VS Code theme variables, and Vite/esbuild project layout.
- `KeystoneLogger`, `KeystoneError`, and redaction utilities.

### Code to replace or remove

- Replace `DefaultIgnorePolicy`'s boolean-only, incorrectly ordered rule implementation with an explainable classification decision.
- Replace the current intelligence records and schemas with stable string IDs, ontology identifiers, evidence links, hashes, derivation, parser/rule versions, branch/commit when known, and snapshot generation.
- Replace `RepositoryIndexService` internals, its shared cancel token, memory-only record flow, silent catches, and version calculation.
- Remove `buildRelationships()` and all invented call edges. Milestone 1 may emit only directly evidenced inventory/structural relationships such as file `DECLARES` symbol.
- Replace the VS Code-shaped document-symbol contract with a normalized extractor result that handles both `DocumentSymbol[]` and `SymbolInformation[]` honestly.
- Replace Git adapter use of nonexistent `vscode.GitAPI`/`SourceControlState` types with a minimal private contract; broader Git reconciliation remains deferred.
- Repair or remove dead/mismatched intelligence requests and hard-coded bootstrap capability claims.
- Replace the Intelligence `PlannedSection` with a live overview; remove production-reachable fake default service casts.

## Milestone 1 — Intelligence foundation repair and live overview

### Scope

Deliver one coherent, one-shot, restart-safe intelligence foundation plus the minimum overview UI that proves it. Do not implement filesystem/Git watchers, persistent worker pools, continuous reconciliation, TypeScript semantic resolution, generic search/traversal, CPG, OKF, Copilot, intent, specifications, task orchestration, or validation behavior.

### Approved architecture target

1. Canonical contracts are independent of VS Code and use stable, namespaced string identifiers.
2. The active intelligence snapshot contains a manifest plus repository, file, symbol, relationship, evidence, exclusion, and diagnostic records.
3. The store is extension-managed and file-backed. A complete snapshot is validated and atomically replaces the active snapshot through temp-write, flush/close, and rename. Pending or failed writes are never queryable.
4. The one-shot scanner produces immutable result data for one scan revision. It does not mutate the active snapshot while scanning, and a cancelled, failed, disposed, or superseded scan cannot publish.
5. File inventory is canonical. Supported language providers may contribute declaration facts only. Milestone 1 relationships are limited to facts directly supported by inventory or declaration evidence; no calls/imports/exports/references/inheritance/test mappings are inferred.
6. The overview query captures one active snapshot and returns a fixed, bounded, generation-tagged aggregate. It never reads repository files and never exposes an unbounded record array to the Webview.
7. Index start acknowledges promptly and reports status separately; overview requests do not wait on a repository scan.

### Dependency-ordered implementation slices

#### M1.0 — Build and contract containment

- [x] Instantiate concrete adapters correctly and supply required constructor arguments.
- [x] Restrict activation and production Webview routing to implemented foundation/intelligence services; do not advertise deferred features.
- [x] Repair the shared host-message payload typing and callback mismatches.
- [x] Resolve pre-existing project-wide type/lint failures needed for the completion gate using contract/mechanical corrections only; do not activate or expand deferred features.
- [x] Ensure every admitted intelligence request returns a success or typed error. Remove `index/search` from the admitted contract until its milestone rather than allow a timeout.

#### M1.1 — Canonical model, identity, and evidence

- [x] Define versioned repository, workspace-root, file, symbol, relationship, evidence, exclusion/diagnostic, snapshot-manifest, and overview contracts with Zod validation.
- [x] Use registered ontology strings rather than closed relationship/entity enums where extensibility requires it.
- [x] Define one coordinate convention for source ranges.
- [x] Add deterministic hashing and stable IDs from normalized repository identity, relative POSIX path, entity type, adapter/language identity, qualified name, and normalized signature where needed. Line number must never be the sole identity input.
- [x] Add deterministic evidence and relationship IDs and enforce evidence on every persisted entity and relationship.

#### M1.2 — Explainable classification and exclusions

- [x] Return an ordered decision containing category, analysis level, included/excluded status, generated/binary/sensitive flags, rule ID, and reason.
- [x] Treat tests as tests, never generated.
- [x] Include CI, build manifests, ORM/schema/migrations, OpenAPI/GraphQL, Docker/Kubernetes/Terraform, documentation, and source configuration.
- [x] Exclude dependency/vendor folders, build outputs, virtual environments, caches, temporary files, minified files, binaries, archives, media, and ordinary static assets from deep analysis.
- [x] Apply configured maximum file size, maximum files, user exclusions, and workspace trust before expensive work where possible.
- [x] Persist no secret values. Represent sensitive files as sanitized metadata/exclusion evidence only in Milestone 1.

#### M1.3 — Atomic local intelligence store

- [x] Root canonical intelligence under `ExtensionContext.storageUri`; never write it into the repository.
- [x] Add an atomic writer with injectable filesystem operations and atomic-failure coverage.
- [x] Persist and validate one coherent active snapshot containing repository, file, symbol, relationship, and evidence records.
- [x] Load the last valid snapshot on service initialization and preserve it if a new scan fails or is cancelled.
- [x] Define explicit unavailable behavior when workspace storage is absent or non-file-backed; do not silently choose repository storage.
- [x] Keep the storage interface compatible with later sharding and immutable-generation promotion without implementing retention, shard reuse, or continuous reconstruction now.

#### M1.4 — One-shot evidence-backed repository scan

- [x] Enumerate all workspace roots with normalized workspace-relative paths.
- [x] Create stable repository/root/file records with stat, size, category, analysis level, content hash when allowed, and explainable decisions.
- [x] Invoke declaration extraction only for supported source/test files within limits.
- [x] Normalize hierarchical `DocumentSymbol[]` and flat `SymbolInformation[]`, map symbol kinds explicitly, build qualified names only from evidence, and report unavailable/failed providers as diagnostics.
- [x] Persist real symbol declarations and their evidence. Export status remains absent unless proved; a display container name is never a canonical container ID.
- [x] Emit only directly evidenced structural relationships (`CONTAINS` and `DECLARES`), each with subject-matched evidence. No semantic edge family is emitted.
- [x] Use per-scan revision/cancellation state, supersede overlapping scans, batch/yield orchestration, and prevent stale publication.
- [x] Surface unreadable, unsupported, oversized, excluded, and parser-failed files through decisions and diagnostics instead of swallowing them.

#### M1.5 — Typed bounded overview query and host lifecycle

- [x] Add an asynchronous, yielding `IntelligenceQueryService.overview()` over one captured active snapshot.
- [x] Return explicit `not-indexed`, `scanning`, `ready`, `partial`, `failed`, and `storage-unavailable` states without fabricating branch/freshness.
- [x] Include repository identity/roots, snapshot generation/status/timestamps/pending flag, real file/symbol/relationship/evidence counts, bounded language/category/type breakdowns, and bounded diagnostics with total/truncated metadata.
- [x] Add a dedicated typed `intelligence/overview` request/result mapping and correctly shaped progress/update/error events.
- [x] Make request results type-safe in `HostBridge`; add request-scoped abort, timeout cleanup, and cancellation notification.
- [x] Load persisted intelligence independently of Webview construction. Register scan cancellation/disposal with extension lifecycle.

#### M1.6 — Minimum live Intelligence overview UI

- [x] Route Intelligence to a dedicated overview component.
- [x] Render loading, no-workspace/storage-unavailable, not-indexed, scanning, ready/partial, and failed states.
- [x] Show only real repository/root/Git-when-known, generation/update, file/category/language, symbol, relationship, evidence, exclusion, and diagnostic summaries.
- [x] Provide only the supported start/retry/cancel controls and refresh overview on status events.
- [x] Preserve navigation across Webview reload and keep overview state derived from the host; do not add Explorer, graph, flow, impact, tests, OKF, or worker UI.

#### M1.7 — Validation and architecture review

- [x] Run typecheck, lint, unit tests, Webview tests, production builds, and extension integration tests.
- [x] Verify repeat scans and restart reload retain canonical IDs and overview values.
- [x] Verify an interrupted/failed atomic write leaves the prior active snapshot readable.
- [x] Verify cancellation, supersession, and disposal guards prevent stale publication.
- [x] Verify scan, symbol normalization, serialization, validation, and overview aggregation yield in bounded batches; file/size limits are enforced before deep work.
- [x] Review the final diff for invented relationships, secret values, absolute-path leakage to the Webview, extension-host CPU loops, unbounded messages, external storage, and accidental deferred-feature work.
- [x] Update this plan with completed work, deviations, known limitations, and remaining tasks.

### Exact expected implementation files

Modify:

- `PLANS.md`
- `src/shared/contracts/domain.ts`
- `src/shared/contracts/messages.ts`
- `src/core/intelligence/IgnorePolicy.ts`
- `src/core/intelligence/RepositoryIndexService.ts`
- `src/extension/adapters/WorkspaceAdapter.ts`
- `src/extension/adapters/LanguageServiceAdapter.ts`
- `src/extension/adapters/GitAdapter.ts`
- `src/extension/extension.ts`
- `src/extension/webview/KeystoneViewProvider.ts`
- `src/extension/webview/WebviewMessageRouter.ts`
- `src/ui/App.tsx`
- `src/ui/services/HostBridge.ts`
- `src/ui/styles/global.css`
- `tests/unit/contracts.test.ts`
- `tests/ui/App.test.tsx`
- `tests/extension/index.ts`
- `scripts/run-extension-tests.mjs`

Add:

- `src/shared/contracts/intelligence.ts`
- `src/core/intelligence/StableId.ts`
- `src/core/intelligence/IntelligenceQueryService.ts`
- `src/core/persistence/AtomicFileWriter.ts`
- `src/core/persistence/IntelligenceStore.ts`
- `src/ui/components/intelligence/IntelligenceOverview.tsx`
- `tests/unit/intelligence/IgnorePolicy.test.ts`
- `tests/unit/intelligence/StableId.test.ts`
- `tests/unit/intelligence/IntelligenceStore.test.ts`
- `tests/unit/intelligence/RepositoryIndexService.test.ts`
- `tests/unit/intelligence/IntelligenceQueryService.test.ts`
- `tests/unit/webview/WebviewMessageRouter.test.ts`
- `tests/ui/HostBridge.test.ts`
- `tests/helpers/TemporaryRepository.ts`
- `tests/fixtures/intelligence/` fixture repository files

Conditionally modify only if the tests prove necessary: `package.json`, `tsconfig.json`, `vitest.config.ts`, and a test-only VS Code mock. Do not weaken or exclude code from TypeScript, ESLint, or test discovery to make the gates pass. Any additional file must be recorded as a plan deviation before completion.

The exact dormant/deferred files currently blocking project-wide gates are `src/core/context/ContextEngine.ts`, `src/core/context/ContextCompressionEngine.ts`, `src/core/context/ContextPreview.ts`, `src/core/copilot/AgentRegistry.ts`, `src/core/copilot/CopilotAdapter.ts`, `src/core/copilot/DelegationService.ts`, `src/core/intent/IntentEngine.ts`, `src/core/specifications/SpecificationService.ts`, `src/core/tasks/ExternalChangeDetector.ts`, `src/core/tasks/TaskGraphService.ts`, `src/core/validation/ValidationEngine.ts`, `src/core/workflows/WorkflowOrchestrator.ts`, `tests/unit/context/ContextEngine.test.ts`, `tests/unit/tasks/TaskGraphService.test.ts`, and `tests/unit/validation/ValidationEngine.test.ts`. They may receive only minimal type, lint, import, or test-fixture corrections necessary for the repository-wide gate; their product behavior must not be expanded or wired into the Milestone 1 UI.

### Required test matrix

- Classification table: every required inclusion/exclusion; tests never generated; case/path normalization; rule ID/reason; max files/size/custom exclusions; no secret values.
- Stable identity: repeat scans/restarts, line shifts, slash normalization, case policy, overloads/duplicates, and distinct repository/path/type/signature identities.
- Symbol normalization: hierarchical and flat providers, exhaustive kind mapping/fallback, qualified names, unsupported/empty/error results, range convention, and honest unknown export/container state.
- Relationship/evidence: every stored symbol/edge has evidence; only approved structural edge types exist; explicit zero results for calls/imports/exports/references/inheritance/implements/tests.
- Storage: complete round trip for all record families; schema rejection; atomic failure preserves prior snapshot; corrupt/missing/pending data is never exposed; repository separation; restart consistency.
- Scanner: multi-root, limits, unreadable/provider failure diagnostics, cancellation, overlap/supersession, disposal, failed-scan preservation, deterministic progress, and event-loop yielding proxy.
- Overview: exact counts from one snapshot, bounded/truncated breakdowns, all states, generation propagation, deterministic ordering, empty repository, and no sensitive/absolute-path leakage.
- Messaging: request/result type correlation, runtime validation, every admitted route responds, correct event payloads, duplicate request behavior, abort/timeout/disposal cleanup.
- UI: overview loading/not-indexed/scanning/ready/partial/error/storage-unavailable, real count rendering, controls, event refresh, accessibility, and navigation reload.
- Extension: activation/build/CSP smoke, activation remains under the existing 500 ms budget excluding scan, persisted overview reload, scan runs outside the activation critical path, and Webview remains queryable while scanning.

### Exit criteria

- The extension builds and activates with a truthful Intelligence state.
- A one-shot scan produces stable repository, file, symbol, relationship, and evidence records without guessed semantic edges.
- The complete canonical snapshot is atomically persisted under extension-managed storage and reloads after restart.
- Cancellation/failure does not replace the last valid snapshot.
- The typed overview is bounded, generation-tagged, and computed from one active snapshot.
- The Intelligence overview displays only live, real data and supported controls.
- Project-wide typecheck, lint, unit/UI tests, production builds, and extension integration tests pass.
- `PLANS.md` records actual completion, deviations, limitations, and remaining Milestone 2 work.

### Risks and decisions requiring approval

1. **Repository identity:** Recommended M1 policy is a hash of normalized sorted workspace-root identities, with a hashed canonical Git remote added only when reliably available. Moving a non-Git workspace may create a new repository identity; Git/worktree reconciliation remains M2.
2. **Storage shape:** Recommended M1 format is one schema-versioned atomic snapshot file plus small health metadata. It provides coherent restart persistence without claiming M2 sharding, retention, or immutable-generation publication.
3. **Sensitive files:** Recommended M1 behavior is metadata-only with a sanitization/exclusion decision and no content-derived variable names. Safe environment-name extraction can be added by a later dedicated adapter.
4. **Structural edges:** Recommended M1 relationships are repository/root `CONTAINS` file and file `DECLARES` symbol only where their exact sources are represented by evidence. All semantic edges remain absent.
5. **Symbol identity limits:** Provider-reported qualified name/signature can keep IDs stable across restart and line shifts, but moves, renames, missing overload detail, anonymous declarations, and declaration merging require honest collision diagnostics until the TypeScript semantic provider exists.
6. **Workspace storage:** If `storageUri` is missing or not a local file URI, report storage unavailable and keep no canonical persistent intelligence; never fall back into the repository silently.
7. **Responsiveness before workers:** M1 will use bounded async I/O, batch yields, cancellation, and no synchronous semantic graph construction. Persistent background workers and hard performance guarantees remain M2.
8. **Existing unrelated compiler debt:** The repository-wide completion gate cannot pass while deferred feature files retain their current errors. Approval of this plan includes minimal mechanical contract/type corrections where required, but no new intent/spec/task/Copilot/validation behavior.

## Milestone 1 completion record — 2026-07-15

Status: **Complete.** The extension now exposes a usable, one-shot, evidence-backed repository intelligence foundation and a live bounded overview. Milestone 2 work has not started.

### Implemented architecture

- Canonical Zod contracts use stable namespaced IDs, zero-based source ranges, subject-matched evidence, generation metadata, and open ontology strings for entity and relationship types.
- `RepositoryIndexService` is now a VS Code-independent orchestrator over DTO adapters. It inventories every workspace root, applies explainable classification before content access, hashes allowed content asynchronously, accepts declaration facts from the VS Code language provider, and emits only `keystone.core.CONTAINS` and `keystone.core.DECLARES` relationships.
- Each scan builds isolated immutable result arrays. Scan revisions, cancellation/disposal checks, and a final pre-rename guard prevent a superseded result from publishing.
- `IntelligenceStore` owns one schema-versioned `active-snapshot.json` under the local file-backed `ExtensionContext.storageUri`. Publication streams JSON in bounded yielding chunks to a synced temporary file and atomically renames it; parsing runs in a worker and validation yields by record batch.
- `IntelligenceQueryService` captures one active snapshot, aggregates in yielding batches, and returns only fixed counts, at-most-20 breakdown rows, and at-most-20 diagnostics with total/truncated metadata.
- The admitted host/Webview protocol is restricted to foundation and Intelligence overview/scan routes. Results are type-mapped, runtime-validated in the Webview, abort-aware, and every admitted route produces a success or structured error.
- The React Intelligence route now renders live unavailable, not-indexed, scanning, ready, partial, and failed states with real counts, diagnostics, and only supported one-shot scan controls.

### Validation results

- `npm run typecheck`: passed.
- `npm run lint`: passed.
- `npm test`: passed, 14 files and 38 tests.
- `npm run build`: passed for the esbuild extension bundle and Vite production Webview bundle.
- `npm run test:extension`: passed on VS Code 1.95.0, including activation under the existing 500 ms budget, command registration, and a live typed overview command.
- `git diff --check`: passed after whitespace cleanup.

### Verified coverage

- Tests are indexed as `test` and never marked generated; required engineering artifacts are included; dependency/output/binary files are excluded from deep work; sensitive files are metadata-only and are never read by the scanner.
- Repeat scans preserve repository/file/symbol/relationship IDs. Complete snapshots reload from disk with all record families and evidence links intact.
- A failed/stale atomic publication leaves the previous snapshot readable. An overlapping scan cannot publish after a newer scan completes.
- Persisted relationships are restricted to observed containment and provider-reported declarations, with evidence whose `subjectId` matches the relationship. Relationship endpoints are validated against persisted entities.
- Overview and message payloads contain no workspace URI or absolute path and expose no unbounded record collection.

### Deviations from the expected file/test list

- No dependency install or package/configuration change was required; the existing installed dependencies and build setup were sufficient.
- `scripts/run-extension-tests.mjs` did not require modification. The existing runner was reused and `tests/extension/index.ts` was extended instead.
- The planned disk-backed fixture repository and `tests/helpers/TemporaryRepository.ts` were unnecessary for this slice. Deterministic DTO adapter fixtures plus real temporary extension-storage directories provide the required scanner and persistence coverage; the shared fixture builder lives at `tests/unit/intelligence/fixtures.ts`.
- Serialization uses an incremental async JSON stream with bounded event-loop yields rather than transferring the complete snapshot through a worker. This avoids the synchronous structured-clone cost of passing a large object to `workerData`; persistent serialization workers and sharded generations remain Milestone 2.
- The runtime state name is `scanning`, not a separate `loading` value. Initial UI loading remains component-local; canonical host state is explicit and non-overlapping.
- Mechanical completion-gate corrections touched the dormant files listed above. `ValidationEngine` command execution was changed from synchronous `spawnSync` to asynchronous `spawn` so dormant code cannot block the extension host if invoked. None of these services are activated, routed, or surfaced in the UI.

### Known limitations and remaining risks

- Milestone 1 is deliberately one-shot. There are no filesystem/Git watchers, startup repair scan, automatic reconstruction after deletion, branch reconciliation, persistent worker pool, immutable generation directories, shard reuse, or retention policy.
- The active format is one atomic JSON snapshot. Loading parses off-host, but returning a very large parsed object from the worker still has structured-clone overhead; sharding and worker-owned indexes are Milestone 2 work.
- Declaration quality is limited to installed VS Code document-symbol providers. Missing providers are diagnosed; imports, exports, references, calls, inheritance, tests-to-code links, and all other semantic edges remain absent.
- Stable symbol identity depends on provider identity, qualified name, type, normalized signature, file identity, and duplicate ordinal. Moves, renames, anonymous declarations, provider reordering of indistinguishable duplicates, and declaration merging require the future TypeScript semantic extractor.
- Repository identity includes normalized workspace-root identities and a hashed remote when available. Moving a non-Git workspace changes identity. Multi-root Git metadata currently reflects the first root only.
- File inventory is capped by configured `maxFiles`; deep reads are capped by `maxFileSizeKb`. Milestone 2 must add scalable shards, incremental repair, priority queues, and fuller coverage/limit diagnostics.

### Next single milestone

Milestone 2 — Continuous ingestion. Implement startup reconciliation and persistent background workers first, while retaining the Milestone 1 snapshot as the queryable last-complete generation. Do not begin CPG, semantic edge extraction, OKF, Copilot, intent, specifications, or task orchestration.

## Milestone 2 — Continuous ingestion

- [x] Implement startup reconciliation.
- [x] Implement persistent worker pools.
- [x] Add prioritized ingestion jobs.
- [x] Add file-change coalescing.
- [x] Add Git HEAD and branch monitoring.
- [x] Use Git diffs for branch and pull reconciliation.
- [x] Add stale-job cancellation.
- [x] Add deleted-file cleanup.
- [x] Add recovery after intelligence deletion.
- [x] Add immutable generations and atomic promotion.
- [x] Expose worker and progress events to the UI.

### Exit criteria

- Ingestion never blocks the Webview or extension host.
- Saves update affected intelligence.
- Pulls and checkouts reconcile incrementally.
- Deleted intelligence rebuilds automatically.
- Previous intelligence remains queryable during updates.

## Milestone 2 completion record — 2026-07-15

Status: **Complete.** A post-implementation audit found that the earlier completion record overstated startup, storage, worker, health, and end-to-end coverage. Those gaps are now repaired. Keystone continuously maintains the Milestone 1 repository/file/declaration graph, retains the last complete generation during repair, and exposes truthful bounded runtime state. No TypeScript semantic graph, CPG, OKF, generic query engine, Copilot, intent, specification, or task-orchestration work was started.

### Implemented architecture

- `StartupReconciler` independently validates storage health, repository inventory, and Git branch, HEAD, and dirty-state fingerprints. It selects no-op, incremental reconciliation, complete rebuild, or storage recovery without delaying extension activation. Missing or damaged storage is recoverable; uncertain Git deltas deliberately trigger a safe complete repair.
- `IntelligenceRuntime` owns lifecycle state, startup action, file/Git/workspace/storage events, coalescing, scheduling, cancellation, stale-result retry, pause/resume, and recovery. It is created independently of Webview creation after commands and the provider are registered, and automatic activation is declared through `onStartupFinished`.
- `VsCodeRepositoryMonitor` converts allowed create/change/save/rename/delete events into normalized changes, excludes Keystone's own storage and all deep-ingestion exclusions, and combines committed, staged, working-tree, untracked, and rename-aware Git changes. Revision guards discard obsolete asynchronous Git observations.
- `ChangeCollector` coalesces a 200 ms burst per workspace-root/path and preserves the semantic sequences added, modified, deleted, and replaced. `IngestionScheduler` orders manual, active-editor, Git, file, workspace, and startup jobs; preempts lower-priority work; requeues cancelled work; supports pause/resume; and permits only one generation publication at a time.
- `WorkerPoolManager` maintains persistent fast-operation and storage-operation `worker_threads`. Configurable bounded concurrency leaves fast-worker capacity for foreground work; hashing, JSON parsing/stringification, compression, and decompression execute off-host. Cancellation can terminate and replace an active worker, crashes are isolated and restarted, and shutdown rejects queued work and terminates every worker.
- `FileIngestionJob` carries normalized path, input content hash, job revision, base generation, and cancellation. `DependencyInvalidator` removes the changed or deleted file and its dependent symbols, relationships, evidence, and diagnostics; `DeltaMerger` then merges only newly observed records. A final source re-read and hash check rejects stale extraction before publication.
- `IntelligenceStore` persists immutable schema-validated generations with a small manifest/repository shard and compressed record-family shards. Serialization and gzip work run in the storage worker pool, unchanged record-family shards are reused by hard link, every file is temp-written/flushed/renamed, and `current.json` is atomically promoted only after complete validation. Configurable retention keeps at least the active and previous generations.
- Startup removes abandoned pending generations and recovers the newest valid complete generation when the active pointer or shard is missing/corrupt. `IntelligenceHealthService` detects subsequent directory, pointer, or active-shard loss/damage while the in-memory last-complete generation remains queryable and triggers reconstruction without an infinite retry loop. No canonical intelligence is stored in VS Code `workspaceState` or `globalState`.
- Typed host/Webview contracts expose bounded phase, health, queue, worker capacity, completed/failed jobs, stale-result and restart counts, throughput, current files, trigger, and progress. The React overview renders only real repository/runtime values and provides typed pause, resume, cancel, and manual repair controls.

### Files implemented for Milestone 2

Added:

- `src/core/intelligence/runtime/ChangeCollector.ts`
- `src/core/intelligence/runtime/IngestionDelta.ts`
- `src/core/intelligence/runtime/IngestionScheduler.ts`
- `src/core/intelligence/runtime/IntelligenceHealthService.ts`
- `src/core/intelligence/runtime/IntelligenceRuntime.ts`
- `src/core/intelligence/runtime/StartupReconciler.ts`
- `src/core/intelligence/runtime/WorkerPoolManager.ts`
- `src/extension/intelligence/VsCodeRepositoryMonitor.ts`
- `tests/unit/intelligence/runtime/ChangeCollector.test.ts`
- `tests/unit/intelligence/runtime/IngestionScheduler.test.ts`
- `tests/unit/intelligence/runtime/IntelligenceRuntime.test.ts`
- `tests/unit/intelligence/runtime/StartupReconciler.test.ts`
- `tests/unit/intelligence/runtime/WorkerPoolManager.test.ts`

Modified for the vertical slice:

- `PLANS.md`
- `package.json`
- `scripts/run-extension-tests.mjs`
- `src/core/configuration/ConfigurationService.ts`
- `src/core/intelligence/IgnorePolicy.ts`
- `src/core/intelligence/IntelligenceQueryService.ts`
- `src/core/intelligence/RepositoryIndexService.ts`
- `src/core/persistence/AtomicFileWriter.ts`
- `src/core/persistence/IntelligenceStore.ts`
- `src/extension/adapters/GitAdapter.ts`
- `src/extension/adapters/WorkspaceAdapter.ts`
- `src/extension/extension.ts`
- `src/extension/webview/KeystoneViewProvider.ts`
- `src/extension/webview/WebviewMessageRouter.ts`
- `src/shared/contracts/intelligence.ts`
- `src/shared/contracts/messages.ts`
- `src/ui/App.tsx`
- `src/ui/components/intelligence/IntelligenceOverview.tsx`
- `src/ui/styles/global.css`
- `tests/extension/index.ts`
- `tests/ui/App.test.tsx`
- `tests/unit/intelligence/IgnorePolicy.test.ts`
- `tests/unit/intelligence/IntelligenceQueryService.test.ts`
- `tests/unit/intelligence/IntelligenceStore.test.ts`
- `tests/unit/intelligence/RepositoryIndexService.test.ts`
- `tests/unit/webview/WebviewMessageRouter.test.ts`

No file was removed, and no package, external service, database, graph server, vector store, HTTP backend, or cloud dependency was added.

### Validation results

- Dependency installation was not required; the installed dependency tree was sufficient and no dependency was added.
- `npm run verify`: passed. This includes TypeScript type checking, ESLint, 19 unit/UI test files with 56 tests, and both production builds.
- `npm run test:extension`: passed on VS Code 1.95.0 against a temporary real Git repository.
- `git diff --check`: passed.
- Static diff review found only evidence-backed `keystone.core.CONTAINS` and `keystone.core.DECLARES` relationships, retained test inclusion/classification assertions, extension-managed local storage, bounded overview payloads, no external storage/backend, and no synchronous heavy intelligence operation on the extension-host event loop.

### Verified coverage

- Coalescing handles repeated saves, create/change, delete/create replacement, rename, and delete deterministically while preserving priority.
- Higher-priority work cancels and supersedes lower-priority execution without losing the interrupted job; stale source hashes are rejected and requeued.
- Workers cover deterministic SHA-256, serialization, compression, cancellation, crash replacement, responsiveness, and clean shutdown.
- Startup tests cover valid reuse, inventory reconciliation, missing storage, damaged storage, Git change selection, and rename preservation.
- Persistence tests cover restart reload, partial-write preservation, abandoned-pending cleanup, atomic promotion, compressed shard corruption, missing-shard detection, hard-link reuse, retention, and recovery of prior complete generations.
- The extension integration suite verifies non-blocking activation, automatic first generation, test indexing, save coalescing, create, rename, delete, branch checkout, and same-branch HEAD advancement in a real temporary Git repository.

### Deviations and known limitations

- Reuse is currently at whole record-family shard granularity. A change to one file can rewrite the entire affected compressed family; per-file/content-addressed shards and compaction remain later storage-scaling work.
- Schema validation and delta assembly execute in yielding bounded batches on the extension host. Hashing and serialization/compression are off-host, but large-repository CPU, memory, and latency still need fixture-based profiling before claiming production-scale throughput.
- Startup reconciliation uses Git commit diffs when available and otherwise compares inventory path, size, and modification time. A non-Git edit that preserves both size and modification time can evade startup repair until another filesystem event or manual scan.
- Git metadata stored on the canonical repository still represents the first workspace root. Monitoring covers every open Git root, but a complete multi-root Git identity model remains unresolved.
- A branch transition with no usable commit diff, a Git API failure, workspace-root change, or uncertain Git state intentionally falls back to a complete background repair. It does not fabricate an incremental result.
- Worker count is configurable and pools reserve capacity by operation/priority; adaptive throttling for battery, memory pressure, and live CPU saturation is not implemented.
- VS Code document-symbol providers remain the only declaration source. No semantic parser, import/call/reference edge extraction, test mapping, CPG, or language-specific worker was introduced.
- Same-branch pull behavior is represented by a real HEAD advance in the extension fixture; remote transport itself is not exercised. Manual storage deletion is verified at the store/runtime boundary rather than by an OS deletion inside the VS Code integration process.
- One integration run exceeded the original 15-second polling deadline and an immediate rerun passed. The harness deadline is now 30 seconds and timeout failures include the last observed overview; the final hardened run passed. This was a test-harness reliability adjustment, not a runtime architecture deviation.

### Next single milestone

Milestone 3 — TypeScript and JavaScript semantic graph. Add an off-host TypeScript/JavaScript extractor and emit only evidence-backed imports, exports, references, calls, type relationships, React facts, routes, tests, package, and build metadata. Do not begin CPG, OKF, Copilot, intent, specifications, or task orchestration.

## Milestone 3 — TypeScript and JavaScript semantic graph

### Grounded entry audit — 2026-07-15

Milestone 2 was revalidated before semantic work: `npm run verify` passed with 19 test files and 56 tests, both production bundles passed, and `npm run test:extension` passed against the temporary Git repository. The existing runtime tests and integration fixture verify persistent multi-worker execution, last-generation query continuity, coalesced incremental file changes, Git reconciliation, source-hash stale rejection, deleted-file cleanup, automatic storage recovery, atomic generation promotion, and real runtime state in the Intelligence UI. No Milestone 2 repair is required before starting this milestone.

Verified Milestone 3 gaps:

- `RepositoryIndexService.indexFile()` still treats `LanguageServiceAdapter.extractSymbols()` as canonical for TypeScript and JavaScript and emits only declarations plus physical containment.
- The canonical contracts do not yet represent parser/file contribution metadata, semantic relationship properties and ownership, graph indexes, or bounded search/entity/neighborhood results.
- `IntelligenceStore` has immutable compressed generations but only coarse record-family shards; no semantic contribution or adjacency/name/type index shard exists.
- `WorkerPoolManager` performs hashing and storage work, but no persistent compiler-backed semantic worker exists.
- `IntelligenceQueryService` exposes overview only, and the React Intelligence page has no search, entity inspector, or scoped neighborhood.

The attached approved request pulls the first bounded search, entity-detail, neighborhood, and semantic-verification UI operations into Milestone 3. Path, impact, flow, advanced test queries, CPG, OKF, and the complete query/UI milestones remain deferred.

### Implementation slices

#### M3.1 — Canonical semantic contracts and ownership

- [x] Extend file, entity, relationship, evidence, diagnostic, manifest, contribution, and index contracts without invalidating complete Milestone 2 generations.
- [x] Add deterministic `IntelligenceIdFactory`, `EvidenceFactory`, file contribution ownership, parser/version/source-hash identity, and resolution diagnostics.
- [x] Add bounded typed overview, search, entity-detail, neighborhood, and open-source Webview contracts.

#### M3.2 — Persistent TypeScript/JavaScript compiler worker

- [x] Add `ParserRegistry`, a dedicated persistent `SemanticExtractionWorker`, and a `TypeScriptJavaScriptParser` backed by the TypeScript Compiler API.
- [x] Maintain reusable per-repository compiler state in the worker; send changed contents/removals for incremental runs and request a safe full rebuild if worker state is unavailable.
- [x] Keep parsing, type checking, semantic extraction, hashing, and graph construction off the extension-host event loop.

#### M3.3 — Evidence-backed semantic extraction

- [x] Implement declarations, import/export/CommonJS resolution, references, calls/constructors, inheritance/implementation/override, React components/hooks/usage, detected route patterns, tests/mappings, package metadata, TypeScript configuration, and configuration-name access.
- [x] Emit explicit external dependency entities and diagnostics for unresolved/ambiguous/dynamic/unsupported cases; never create a relationship without a defensible target and exact evidence.
- [x] Preserve derivation, confidence, resolution method, source range, source hash, parser version, branch, generation, and owning file on every semantic contribution.

#### M3.4 — Semantic delta, persistence, and indexes

- [x] Add `SemanticGraphBuilder` and `SemanticDeltaBuilder` so changed/deleted files replace owned contributions and signature/export changes invalidate dependent cross-file edges.
- [x] Persist contribution manifests and rebuildable name, qualified-name, path, type, adjacency, route-handler, test-target, package-membership, and configuration indexes in immutable compressed generations.
- [x] Reuse unchanged semantic contributions and keep the previous generation queryable until atomic promotion.

#### M3.5 — Bounded semantic queries and Intelligence UI

- [x] Extend the real overview with package, test, route, dependency, parse-failure, unresolved-reference, confidence, relationship-type, and freshness data.
- [x] Implement paginated search, bounded entity details, and bounded filtered neighborhoods with generation identity and cancellation-ready contracts.
- [x] Add Intelligence search, semantic result browsing, entity evidence/diagnostics, source opening, and a lightweight scoped neighborhood view without a full-graph dependency.

#### M3.6 — Fixtures and completion gate

- [x] Add small TypeScript/JavaScript/TSX/JSX fixture projects covering the required imports, exports, calls, types, React, routes, tests, packages, configuration, unresolved cases, exclusions, deletion, and signature invalidation.
- [x] Add stable-ID, restart, semantic correctness, no-fabrication, incremental contribution, query pagination/bounds, host contract, and UI tests.
- [x] Run typecheck, lint, all unit/UI tests, extension integration tests, both production builds, semantic fixture verification, and final scope/performance/storage review.

- [x] Parse TypeScript, JavaScript, TSX, and JSX.
- [x] Extract imports and exports.
- [x] Resolve declarations and references.
- [x] Resolve calls where evidence is available.
- [x] Extract classes, interfaces, inheritance, and implementation.
- [x] Extract React components and hooks.
- [x] Extract routes and middleware.
- [x] Extract tests and test relationships.
- [x] Extract package and build metadata.
- [x] Add evidence and confidence to every relationship.

## Milestone 3 completion record — 2026-07-15

Status: **Complete for the approved TypeScript/JavaScript semantic foundation.** No CPG, path/impact/flow query, OKF, Copilot, intent, specification, context-compression, validation, or task-orchestration capability was started.

### Implemented architecture

- A bundled, persistent `worker_threads` semantic worker owns the TypeScript Compiler API, a reusable virtual repository file cache, and reusable `Program` state. Full jobs send all supported contents; incremental jobs send changed contents and removals. Cancellation terminates stale compiler work, source hashes and job revisions are rechecked before publication, and a lost compiler context requests a safe complete rebuild.
- The extractor pipeline is explicit: `ParserRegistry`, `TypeScriptJavaScriptParser`, `SymbolExtractor`, `ImportExportExtractor`, `ReferenceResolver`, `CallResolver`, `TypeRelationshipResolver`, `ReactExtractor`, `RouteExtractor`, `TestExtractor`, `PackageMetadataExtractor`, and `ConfigurationReferenceExtractor`. Canonical TypeScript/JavaScript facts no longer come from VS Code document symbols; that adapter remains only for other supported languages.
- Stable entity IDs hash repository, owning file, entity kind, qualified declaration identity, and signature where disambiguation requires it. Relationship IDs hash exact endpoints, type, owner, and source-site discriminator. IDs never use ingestion order. Renames and signature changes deliberately create new IDs when no reliable rename evidence exists.
- Every semantic entity, relationship, and diagnostic has an owning file. Every relationship has evidence with source range, content hash, parser ID/version, branch/commit when available, generation, derivation, resolution method, and confidence. Unresolved calls/imports/symbols and unsupported framework patterns become diagnostics; no placeholder target or file-to-self call is emitted.
- `SemanticDeltaBuilder` removes replaced/deleted file contributions and invalidates dependent cross-file contributions. Merge, contribution reconstruction, and graph-index construction run in cancellable yielding batches; parsing, type checking, semantic extraction, hashing, compression, and serialization remain in persistent background workers. Unchanged per-file partitions are hard-linked into the next immutable generation.
- Immutable generations now contain compressed contribution manifests and rebuildable name, qualified-name, path, type, language, incoming/outgoing adjacency, route-handler, test-target, package-membership, and configuration indexes plus per-file entity, relationship, evidence, and diagnostic partitions. `IntelligenceStore.readContributionPartition()` supports targeted partition reads; coarse family shards remain for restart recovery and Milestone 2 delta continuity.
- Typed host/Webview operations provide a real semantic overview, bounded/paginated search (maximum 50), bounded entity evidence/relationships/diagnostics (maximum 50 each), and a filtered neighborhood (depth 3, 100 nodes, 300 relationships). Search supports name, qualified name, path, entity type, language, package, and module filters. Query loops yield and honor Webview cancellation.
- The React Intelligence page displays real semantic counts, filters, paginated results, confidence/generation, an entity inspector, source navigation, evidence, diagnostics, parent identity, and a bounded scoped-neighborhood list. It never transfers or renders the complete graph.

### Supported extraction

- TypeScript, JavaScript, TSX, and JSX declarations: namespaces, modules, classes, interfaces, aliases, enums, functions, methods, constructors, properties, variables/constants, parameters, accessors, React components, hooks, contexts, test suites/cases/hooks/fixtures, routes, middleware, packages, commands, configuration keys, and external dependencies.
- Compiler-resolved default/named/namespace/type-only/side-effect imports, export lists, default exports, re-exports, statically resolvable dynamic imports, CommonJS `require` and exports, references, calls, constructors, inheritance, implementation, deterministic overrides, parameter/return/property/type references, and callback registrations.
- React JSX component rendering, hook use, props types, event handlers, and recognizable context provider/consumer patterns.
- Evidence-backed Express-style routes/middleware and VS Code command registrations, including inline handlers; unresolved handlers are diagnosed.
- Vitest/Jest/Mocha/Node/Playwright/Cypress-compatible `describe`/`suite`/`it`/`test` shapes, lifecycle hooks, fixtures, module mocks/spies, exact call mapping, exact imported-symbol-use mapping, and explicitly low-confidence naming candidates.
- `package.json` dependencies and dev/peer/optional kinds, build/test/lint/general scripts, tsconfig/jsconfig path-alias and project-reference facts, `process.env`, `import.meta.env`, and VS Code configuration names. Environment values are never persisted.

### Files implemented for Milestone 3

Added:

- `src/core/intelligence/semantic/EvidenceFactory.ts`
- `src/core/intelligence/semantic/IntelligenceIdFactory.ts`
- `src/core/intelligence/semantic/ParserRegistry.ts`
- `src/core/intelligence/semantic/ResolutionDiagnostics.ts`
- `src/core/intelligence/semantic/SemanticDeltaBuilder.ts`
- `src/core/intelligence/semantic/SemanticExtractionWorker.ts`
- `src/core/intelligence/semantic/SemanticExtractors.ts`
- `src/core/intelligence/semantic/SemanticGraphBuilder.ts`
- `src/core/intelligence/semantic/SemanticModel.ts`
- `src/core/intelligence/semantic/SemanticVersion.ts`
- `src/core/intelligence/semantic/TypeScriptJavaScriptParser.ts`
- `src/core/intelligence/semantic/workerEntry.ts`
- `src/ui/components/intelligence/SemanticBrowser.tsx`
- `tests/ui/SemanticBrowser.test.tsx`
- `tests/unit/intelligence/SemanticPersistence.test.ts`
- `tests/unit/intelligence/SemanticQueryService.test.ts`
- `tests/unit/intelligence/semantic/SemanticDeltaBuilder.test.ts`
- `tests/unit/intelligence/semantic/TypeScriptJavaScriptParser.test.ts`

Modified:

- `PLANS.md`
- `scripts/build-extension.mjs`
- `src/core/intelligence/IntelligenceQueryService.ts`
- `src/core/intelligence/RepositoryIndexService.ts`
- `src/core/intelligence/runtime/StartupReconciler.ts`
- `src/core/intelligence/runtime/WorkerPoolManager.ts`
- `src/core/persistence/IntelligenceStore.ts`
- `src/extension/extension.ts`
- `src/extension/webview/WebviewMessageRouter.ts`
- `src/shared/contracts/intelligence.ts`
- `src/shared/contracts/messages.ts`
- `src/ui/App.tsx`
- `src/ui/components/intelligence/IntelligenceOverview.tsx`
- `src/ui/services/HostBridge.ts`
- `src/ui/styles/global.css`
- `tests/extension/index.ts`
- `tests/ui/HostBridge.test.ts`
- `tests/unit/intelligence/runtime/StartupReconciler.test.ts`
- `tests/unit/webview/WebviewMessageRouter.test.ts`

No file was removed. No database, graph server, vector store, HTTP backend, cloud persistence, LLM ingestion, or new graph/UI dependency was introduced.

### Validation results

- Entry gate before implementation: `npm run verify` passed with 19 test files and 56 tests; `npm run test:extension` passed against the real temporary Git fixture.
- `npm run typecheck`: passed.
- `npm run lint`: passed.
- `npm test`: passed with 24 test files and 66 tests.
- Targeted semantic/UI/host suite: passed with 6 files and 12 tests.
- `npm run build:extension`: passed; the packaged worker bundle includes the TypeScript compiler rather than depending on excluded `node_modules`.
- `npm run build:webview`: passed.
- `npm run test:extension`: passed on VS Code 1.95.0, including compiler-backed search and entity evidence plus the existing save/create/coalesce/rename/delete/branch/HEAD reconciliation fixture.
- Final `npm run verify`: passed with 24 test files and 66 tests plus both production builds.
- Final `npm run test:extension`: passed on VS Code 1.95.0 with exit code 0.
- `npx vsce ls`: passed and confirmed `dist/extension/extension.js`, the self-contained `dist/extension/semantic-worker.js`, and bounded Webview assets are included in the package.
- `git diff --check`: passed. Final static review found no placeholder/self-call relationship, excluded test fixture, external storage/backend, unbounded Webview result, partial generation promotion, or unrelated future-milestone activation. The worktree's pre-existing `LICENSE` deletion and earlier milestone changes were not modified or reverted as part of Milestone 3.

### Deviations, limitations, and risks

- The worker keeps changed-file contents and reuses the previous `Program`, but TypeScript may still rebuild substantial project state after structural/export changes. Compiler options currently use Keystone's safe ES2022/ESNext/Node defaults; tsconfig path aliases/project references are indexed but are not yet applied as compiler project boundaries. Relative repository imports are exact; an unresolved bare specifier is represented as an external dependency.
- Express-style routes and VS Code commands are implemented because they are present in the fixture/product. NestJS, Fastify, Next.js conventions, decorators beyond declaration metadata, and universal framework adapters are not claimed. Unsupported handlers are diagnostics.
- Exact compiler calls/references are persisted. Polymorphic candidate expansion and dynamic property targets are intentionally omitted rather than guessed. External declaration-file calls remain diagnostics/explicit external dependencies rather than canonical repository symbol edges.
- Package lockfiles and arbitrary JSON/framework configuration are not deeply parsed in this slice. Package manifests, tsconfig/jsconfig, package scripts, environment-name access, and VS Code configuration access are covered.
- Per-file partitions and persisted indexes allow targeted storage reads and unchanged-shard reuse, but the active generation is still eagerly loaded into memory at restart because Milestone 2 incremental reconciliation requires a complete base snapshot. Search currently evaluates the in-memory active generation in yielding batches. A fully lazy, worker-owned disk query engine remains Milestone 6 scaling work.
- The semantic worker computes a fresh project graph from its cached compiler context and the supervisor derives the canonical file/dependent delta; it does not write storage or indexes directly. This keeps publication authority single and stale-safe, at the cost of transferring the worker's bounded-to-supported-files graph for each semantic job.
- Per-file partition loss is recoverable from the coarse canonical family shards, but health monitoring currently validates the active canonical shards rather than every derived partition on every one-second health pass. Derived partition verification/repair can be added without changing canonical facts.
- Relationship IDs include source location to distinguish repeated evidence-backed call/reference sites. Stable entity IDs do not depend on location/order, but moving a call site can change that relationship's ID.

### Next single milestone

Milestone 4 — Progressive CPG. Add provider-independent method-level AST overlays and local CFG/data-flow shards on top of the semantic graph. Do not begin OKF, Copilot, intent, specification, context-compression, validation, or task-orchestration work.

## Milestone 4 — Progressive CPG

### Grounded entry audit — 2026-07-15

Milestone 3 was revalidated before CPG work. `npm run verify` passed with 24 test files and 66 tests, both production bundles passed, and `npm run test:extension` passed on VS Code 1.95.0. Code and fixture review confirmed that TypeScript, JavaScript, TSX, and JSX produce persisted compiler-backed semantic entities; imports, exports, references, exact calls, inheritance, React constructs, routes, tests, packages, and configuration-name references carry subject-matched evidence; unresolved or dynamic calls produce diagnostics rather than fabricated local targets; entity and relationship IDs are deterministic; changed/deleted file contributions are replaced or removed; immutable semantic partitions reload; and overview, search, entity, bounded neighborhood, source navigation, and the live Intelligence UI are exercised. No semantic prerequisite repair is required.

The CPG remains an internal executable-code layer. The semantic graph stays the repository-browsing model. CPG construction and deltas run in the existing persistent compiler worker; the extension host owns validation and atomic generation publication.

### Implementation slices

#### M4.1 — Provider-independent contracts and provider registry

- [x] Add versioned CPG node, edge, evidence-link, diagnostic, scope-shard, manifest, delta, query, control-flow, data-flow, call, condition, and slice contracts.
- [x] Add `CodeAnalysisProvider`, `CpgProviderRegistry`, and the TypeScript/JavaScript provider without exposing TypeScript `SyntaxKind` values as public node kinds.
- [x] Define stable scope/node/edge IDs, analysis levels, exact/approximate confidence, generation compatibility, and hard traversal/time limits.

#### M4.2 — TypeScript/JavaScript scope construction

- [x] Add `TypeScriptCpgProvider`, `CpgBuilder`, `CpgNodeFactory`, `CpgEdgeFactory`, and `AstOverlayBuilder` for functions, methods, constructors, accessors, arrows, callbacks, and module executable scopes.
- [x] Add deterministic evaluation order, local CFG, entry/exit, branches, loops, switch, return/throw, break/continue, and basic try/catch/finally flow.
- [x] Add local definitions, uses, reaching definitions, value flow, calls/receivers/arguments/parameters, returns, awaits, exact local bindings, and explicit external/unresolved call nodes.

#### M4.3 — Progressive reuse, persistence, and projection

- [x] Cache scope artifacts in the persistent compiler worker by source hash, structural scope hash, provider version, schema version, and analysis level; reuse unchanged scopes and reject stale results through the existing job revision/source-hash checks.
- [x] Add `CpgShardStore` support to immutable generations with compressed per-scope shards, atomic publication, manifest validation, unchanged hard-link reuse, deletion cleanup, interrupted-write safety, and generation compatibility.
- [x] Add `CpgProjectionService` and `CpgDiagnosticsService` for bounded calculated scope summaries linked back to CPG evidence; do not copy the low-level graph into the semantic graph.

#### M4.4 — Bounded queries and program slicing

- [x] Add `DefUseAnalyzer`, `CallBindingAnalyzer`, `ProgramSliceService`, and `CpgQueryService` for scope CPG, CFG, local data flow, calls, guarding conditions, backward slice, and forward slice.
- [x] Enforce maximum nodes, depth, paths, source fragments, and time budget; return truncation and unsupported boundaries explicitly; cache generation-specific slice results.
- [x] Permit only exact bounded cross-method argument/parameter and return/call links; defer broad interprocedural propagation, heap identity, pointer analysis, and taint analysis.

#### M4.5 — Typed host contracts and focused Intelligence UI

- [x] Add cancellable typed CPG summary, graph, slice, and source-navigation routes.
- [x] Add a Code Analysis inspector for executable semantic entities with scope summary, parameters, returns, calls, branches, reads/writes, locals, diagnostics, deterministic CFG layout, data-flow selection, and ordered slice fragments.
- [x] Keep every Webview payload bounded and generation-tagged; never send a repository-wide or unbounded CPG shard.

#### M4.6 — Fixtures and completion gate

- [x] Add compact TS/JS/TSX/JSX fixtures and automated coverage for AST, evaluation order, CFG constructs, def-use/data flow, calls/bindings, returns, slicing/truncation, unresolved/external behavior, persistence/reload/reuse/replacement/deletion/stale rejection, query limits, UI contracts/source navigation, worker execution, and no fabricated dispatch.
- [x] Run typecheck, lint, all unit/UI tests, extension integration tests, extension production build, Webview production build, package-content check, diff check, and static architecture review.
- [x] Record exact versus approximate behavior, unsupported constructs, measured build/query observations, every changed file, and the next milestone without starting it.

### Assumptions and deferred decisions

- Basic Level 1 CPG is persisted for every supported executable scope. Level 2 currently means exact local/cross-scope bindings available from the active compiler program; interactive enrichment uses the same provider contract. Level 3 deep interprocedural path exploration remains on-demand and bounded.
- Local property/element flow uses conservative textual access paths. It does not claim heap-object identity or general alias precision; such edges are marked approximate and diagnosed.
- Only explicit `throw` participates in exception CFG. Possible runtime exceptions from ordinary JavaScript operations are not invented.
- Control dependence is exposed only where a deterministic lexical/CFG guard can be established. Full post-dominator control dependence is deferred.
- CPG scope descriptors may be kept in the active generation manifest, but node/edge bodies remain compressed per-scope shards and are loaded only for bounded queries.

## Milestone 4 completion record — 2026-07-15

Status: **Complete for the bounded TypeScript/JavaScript Progressive CPG milestone.** The semantic graph remains the canonical repository-browsing model. No taint-rule pack, unrestricted repository-wide interprocedural analysis, pointer analysis, OKF, Copilot, intent, specification, context-compression, validation, or task-orchestration capability was started.

### Provider and schema architecture

- Provider-independent Zod contracts define normalized CPG node and edge kinds, evidence links, diagnostics, scope descriptors/artifacts, immutable manifests, deltas, bounded graph queries, and bounded slice results. Public contracts never expose TypeScript `SyntaxKind` numbers or compiler objects.
- `CodeAnalysisProvider` and `CpgProviderRegistry` isolate Keystone contracts from `TypeScriptCpgProvider`. `CpgBuilder`, `CpgNodeFactory`, and `CpgEdgeFactory` generate stable IDs from repository/file/symbol/scope identity, normalized AST position, node kind, and exact edge endpoints. IDs are deterministic across repeated indexing; line numbers are not the sole scope identity.
- The existing persistent semantic compiler worker now produces semantic facts and a CPG delta in one compatible compiler generation. The extension host rechecks job revision and every changed source hash, merges semantic contributions first, and rejects a CPG delta whose semantic generation differs. CPG provider version changes participate in startup reconciliation.
- Calculated branch/call/read/write/unresolved summaries are projected onto executable semantic entities with scope ID, structural hash, provider/version, calculation method, confidence, and evidence links. Low-level CPG nodes are not copied into the semantic graph.

### AST, evaluation, CFG, and data flow

- Level 1 persistent scopes cover functions, methods, constructors, getters, setters, arrows, compiler-evidenced callbacks, and relevant module executable blocks in TypeScript, JavaScript, TSX, and JSX. Normalized nodes retain bounded redacted code text, exact zero-based ranges, type text, evaluation index, semantic references, evidence, parser version, and generation.
- AST child/parent overlays preserve executable syntax while excluding parser trivia and nested-scope internals. String and template literal contents are redacted before CPG artifacts leave the worker; the security fixture proves a source fallback secret is absent from the complete semantic/CPG result.
- Evaluation order is deterministic post-order over executable expressions and statements. It covers nested arguments, member/element access, objects/arrays, assignments, conditionals, short-circuit/nullish expressions, awaits, templates, and optional access. Nullish branch labels are explicitly conservative.
- Local CFGs contain entry, exit, structural return, normal transitions, true/false branches, switch cases, loop back/exit, break/continue, return, explicit throw, catch entry, and finally basics. Explicit throws inside a try target the catch/finally boundary; possible runtime exceptions are never fabricated.
- Def-use analysis covers parameters, locals, reassignment, recursive destructuring names, default expressions, reads/writes, reaching definitions, expression-to-assignment/argument/await/return propagation, and conservative textual property/element access paths. Property/element flows use confidence 0.7 and an `approximate-data-flow` diagnostic because heap identity and general aliasing are not implemented.
- Call binding uses the exact semantic call-site evidence range. Exact same-file and cross-file calls link call sites, receivers, arguments, parameters, structural returns, and call results. Imported binding resolution was hardened so an unresolved compiler alias cannot map calls to an unrelated shared unknown symbol. External built-ins use explicit `EXTERNAL_CALL`; dynamic or unsupported calls use `UNRESOLVED_TARGET` and never fabricate a local target.

### Persistence, incremental reuse, queries, and UI

- `CpgShardStore` writes compressed per-scope shards plus a generation-compatible CPG manifest and rebuildable scope-by-symbol, call, read, write, and data-flow indexes inside the pending immutable semantic generation. Publication remains atomic; failed publication preserves both the prior semantic generation and prior CPG manifest.
- Worker cache keys include stable scope ID, structural hash, provider version, schema version, and analysis level. Unchanged scopes are generation-rebased and their compressed files hard-linked; changed scopes are rebuilt; deleted scopes and indexes disappear with the next generation. Health checks cover the CPG manifest, indexes, and every referenced scope shard.
- `CpgQueryService` loads only the selected shard. Scope results cap at 500 nodes/2,000 edges; slices cap at 300 nodes, depth 20, 50 paths, 300 source fragments, 100 diagnostics/boundaries, and a 5-second hard budget. Webview defaults are smaller. Requests are cancellable and generation-tagged; truncation and unsupported boundaries are explicit. Slice cache keys include generation, structural hash, and all query parameters.
- The entity inspector now adds a Code Analysis section with scope metrics, parameters/returns/calls/branches/reads/writes/locals/unresolved counts, a deterministic source-ordered CFG list, selectable value nodes, forward/backward tracing, ordered source fragments, conditions, evidence-linked diagnostics, and exact source navigation. It never receives a repository-wide CPG.
- The overview exposes real CPG scope/build/reuse/time/shard-size/failure/approximation metrics from the active manifest. Bootstrap capability text now reflects the implemented semantic and CPG milestones rather than the stale Milestone 2 state.

### Validation results

- Prerequisite entry gate: `npm run verify` passed with 24 files/66 tests and both production bundles; `npm run test:extension` passed.
- Final `npm run typecheck`: passed.
- Final `npm run lint`: passed.
- Final `npm test`: passed with 26 test files and 112 tests. The dedicated CPG builder matrix contains 45 named cases; additional persistence/query/UI/semantic tests cover reload, hard-link reuse, atomic failure, cache hits, source navigation, TS/JS/TSX/JSX production, cross-file exact binding, and no fabricated unknown-symbol target.
- Final `npm run build:extension`: passed. Extension bundle: 795.0 KiB; self-contained compiler/CPG worker: 10.2 MiB.
- Final `npm run build:webview`: passed. JavaScript: 327.02 KiB (95.37 KiB gzip); CSS: 20.67 KiB (4.52 KiB gzip).
- Final `npm run test:extension`: passed on VS Code 1.95.0, including activation under the existing 500 ms assertion, automatic generation, semantic search/evidence, a persisted bounded CPG query with entry/exit and a true CFG branch, and the existing save/coalesce/create/rename/delete/branch/HEAD reconciliation flow.
- `npx vsce ls`: passed and includes the extension bundle, self-contained semantic/CPG worker, and bounded Webview assets. `git diff --check`: passed.
- Static review found no external database/server/vector store, LLM analysis, raw compiler serialization, repository-wide Webview payload, invented dynamic-dispatch edge, synchronous CPG construction on the extension-host event loop, or persisted string/template literal value.

### Exact, approximate, and unsupported behavior

- Exact: normalized AST structure/ranges; evaluation order for represented syntax; local statement CFG for tested constructs; local scalar definitions/uses; exact imported/local call targets; positional argument/parameter links; structural return/call links; explicit throw/catch edges; immutable shard identity; bounded traversal.
- Approximate: textual property and element access paths; nullish-coalescing branch labels; lexical guarding conditions returned by slices; calculated semantic scope summaries. Confidence and diagnostics distinguish these from exact results.
- Unsupported/deferred: implicit JavaScript runtime exceptions, complete switch fallthrough semantics, return-through-finally on every abrupt path, post-dominator control dependence, general heap/closure aliasing, prototype mutation, reflective/dynamic dispatch, dependency-injection speculation, asynchronous scheduler ordering, generator state-machine semantics, unrestricted cross-method propagation, path-complete exploration, repository-wide taint, and security/performance rule packs.
- The interactive Code Analysis UI is covered by component tests and its host/source routes by unit and VS Code integration tests. No separate human-operated visual session was recorded; deterministic layout and payload behavior were verified automatically.

### Files implemented for Milestone 4

Added:

- `src/shared/contracts/cpg.ts`
- `src/core/intelligence/cpg/CodeAnalysisProvider.ts`
- `src/core/intelligence/cpg/CpgFactories.ts`
- `src/core/intelligence/cpg/CpgBuilder.ts`
- `src/core/intelligence/cpg/TypeScriptCpgProvider.ts`
- `src/core/intelligence/cpg/ProgramSliceService.ts`
- `src/core/intelligence/cpg/CpgQueryService.ts`
- `src/core/persistence/CpgShardStore.ts`
- `src/ui/components/intelligence/CodeAnalysis.tsx`
- `tests/unit/intelligence/cpg/CpgBuilder.test.ts`
- `tests/unit/intelligence/cpg/CpgPersistenceQuery.test.ts`

Modified:

- `PLANS.md`
- `scripts/run-extension-tests.mjs`
- `src/shared/contracts/intelligence.ts`
- `src/shared/contracts/messages.ts`
- `src/core/intelligence/RepositoryIndexService.ts`
- `src/core/intelligence/IntelligenceQueryService.ts`
- `src/core/intelligence/semantic/SemanticModel.ts`
- `src/core/intelligence/semantic/TypeScriptJavaScriptParser.ts`
- `src/core/persistence/IntelligenceStore.ts`
- `src/extension/extension.ts`
- `src/extension/webview/WebviewMessageRouter.ts`
- `src/ui/services/HostBridge.ts`
- `src/ui/components/intelligence/IntelligenceOverview.tsx`
- `src/ui/components/intelligence/SemanticBrowser.tsx`
- `src/ui/styles/global.css`
- `tests/extension/index.ts`
- `tests/ui/SemanticBrowser.test.tsx`
- `tests/unit/intelligence/semantic/TypeScriptJavaScriptParser.test.ts`
- `tests/unit/webview/WebviewMessageRouter.test.ts`

No file was deleted for Milestone 4. The worktree's pre-existing `LICENSE` deletion and earlier milestone changes were preserved.

### Next single milestone

Milestone 5 — Universal repository intelligence. Add evidence-backed structural/semantic adapters for documentation, SQL/migrations, ORM, OpenAPI/GraphQL, build/CI/infrastructure, and fallback languages. Do not begin OKF, broad CPG taint/security packs, Copilot, intent, specification, context-compression, validation, or task orchestration.

## Milestone 5 — Universal repository intelligence

### Grounded entry audit — 2026-07-15

Milestones 3 and 4 were revalidated before universal-adapter work. `npm run verify` passed with 26 test files and 112 tests, including type checking, linting, unit/UI tests, and both production bundles. `npm run test:extension` passed on VS Code 1.95.0. Code and fixture review confirmed persisted evidence-backed TypeScript/JavaScript/TSX/JSX contributions; method/module CPG scopes with CFG, local data flow, and bounded forward/backward slices; immutable contribution and scope reuse; job-revision/source-hash stale-result rejection; explicit external/unresolved call representation without invented dynamic-dispatch targets; extension-managed file storage only; and live semantic/CPG inspection in the React Webview. No prerequisite repair is required.

Universal analysis will extend the existing persistent semantic worker and canonical graph. Adapters return normalized deltas and never write storage. The extension host retains sole validation and atomic-publication authority. Broad-language support in this milestone is structural and syntax-evidenced; only the existing TypeScript compiler adapter is semantic. Metadata-only inventory is never presented as structural or semantic understanding.

### Implementation slices

#### M5.1 — Adapter contracts, registry, detection, and evidence

- [x] Add versioned `IntelligenceAdapter`, `AdapterRegistry`, capability/detection/context/input/output/diagnostic/evidence contracts and typed adapter-family interfaces.
- [x] Require ID/version, indicators, tier/level, produced ontology types, derivation, incremental/thread-safety/size declarations, and limitations on every adapter.
- [x] Detect technologies only from extensions, manifests, dependencies, imports, syntax, and recognized file formats; persist evidence, conflicts, unsupported features, registry versions, and capability-specific coverage.

#### M5.2 — Worker-owned deterministic extraction

- [x] Extend the persistent worker input to all eligible deep/structural files while preserving sensitive, generated, dependency, output, binary, and static-asset policies.
- [x] Add structural language providers for Java, Python, C#, Go, Rust, C/C++, Ruby, PHP, Kotlin, Swift, Shell, and SQL with exact ranges and explicit syntactic/unresolved resolution diagnostics.
- [x] Add a universal fallback that retains inventory and reliable structural declarations without claiming semantic resolution; keep CSS/static assets metadata-only.

#### M5.3 — Knowledge, contract, data, test, and delivery adapters

- [x] Add documentation extraction for Markdown/MDX, AsciiDoc, reStructuredText, text, ADRs, headings, links, fenced code, explicit requirements, and referenced repository paths.
- [x] Add OpenAPI/Swagger, GraphQL, JSON Schema, Protobuf, and practical Avro contract extraction.
- [x] Add SQL DDL/migration extraction and explicit Prisma plus one additional ORM mapping; diagnose unsupported dialect/ORM constructs.
- [x] Add deterministic test-framework classification/extraction, build/package manifests, GitHub Actions plus additional CI providers, Docker/Compose, Kubernetes, Terraform/OpenTofu, and sanitized configuration-name extraction.

#### M5.4 — Cross-technology resolution and incremental persistence

- [x] Add exact/evidence-paired cross-link rules for OpenAPI routes, ORM tables, build scripts/CI steps, configuration references, migrations, and explicit contract implementations.
- [x] Mark convention links lower-confidence, emit ambiguity diagnostics, and never join by similar names alone.
- [x] Persist adapter registry state, detections, coverage, diagnostics, exclusions, metrics, and cross-links in immutable compressed generations; invalidate live worker artifacts by source hash, manifest activation, schema dependency, and adapter version while reusing unaffected adapter outputs.
- [x] Restore adapter-owned extraction artifacts into a new worker after extension restart so a single adapter-version upgrade reuses exact version/source-hash matches while invalidating the changed adapter. Seeds are reconstructed only from canonical evidence and persisted adapter state; cross-technology links are recomputed.

#### M5.5 — Bounded queries and focused Intelligence UI

- [x] Add bounded technology, capability coverage, domain explorer, adapter diagnostic, and cross-technology-link query contracts with generation identity and pagination.
- [x] Extend entity details/neighborhood support for contract, data, ORM, test, build, delivery, infrastructure, documentation, and configuration entities.
- [x] Add a technology coverage panel and explorer groups without transferring complete technology graphs or beginning the final UI redesign.

#### M5.6 — Fixtures and completion gate

- [x] Add the requested 45-case fixture/test matrix covering extraction, detection, cross-linking, activation/deactivation, version invalidation, incremental schema updates, secrecy, exclusions, queries, UI contracts, and architecture boundaries.
- [x] Run typecheck, lint, all unit/UI tests, extension integration tests, production extension/Webview builds, package-content inspection, diff checks, and representative mixed-repository validation.
- [x] Record exact support levels, partial/unsupported behavior, secret/exclusion handling, cross-link rules, performance observations, fixture coverage, commands, and every created/modified/deleted file.

### Assumptions and deferred decisions

- Tree-sitter/native language-service binaries are not currently dependencies. This slice will use deterministic structural providers with conservative grammar-specific recognizers and exact ranges; it will not call regex extraction semantic. A later adapter version may replace an implementation without changing canonical contracts.
- YAML is parsed only for adapter-owned, bounded recognized shapes. Arbitrary YAML semantics, anchors/merge expansion, Helm templating evaluation, and cloud-provider schema validation remain unsupported and diagnosed where relevant.
- SQL support targets common ANSI/PostgreSQL/MySQL/SQLite DDL shapes. Stored-procedure bodies and vendor-specific procedural languages are metadata/diagnostic territory unless a deterministic rule covers them.
- Cross-technology linking requires normalized exact keys and evidence on both endpoints. Convention-only ORM mappings are lower-confidence; ambiguous candidates are omitted and diagnosed.
- Full OKF rendering, advanced path/impact, repository-wide taint, runtime traces, coverage-file ingestion, and the final Intelligence UI redesign remain later milestones.

## Milestone 5 completion record — 2026-07-15

Status: **Complete for the bounded Universal Repository Intelligence Adapter foundation, with one explicitly uncompleted restart-cache optimization recorded above.** No OKF renderer, advanced path/impact engine, taint analysis, Copilot/LLM ingestion, intent/specification workflow, context compression, autonomous workflow, or final Intelligence UI redesign was started.

### Adapter architecture and worker integration

- Provider-independent Zod contracts define capability tiers/levels, adapter families, detection evidence, context/input/output deltas, diagnostics, coverage, registry state, metrics, and bounded coverage/diagnostic queries. `IntelligenceAdapter`, `AdapterRegistry`, all requested typed adapter-family abstractions, `AdapterEvidenceFactory`, and the universal fallback are present. Canonical records never expose parser-internal nodes.
- Every adapter declares ID/version, technology set, tier/level, output kind, ontology types/relationships, incremental/thread-safety/size characteristics, and limitations. Detection uses extensions, recognized formats, manifests, explicit imports/dependencies, annotations, and syntax markers. Folder names alone do not create semantic/framework facts.
- All eligible deep/structural content now enters the existing persistent semantic worker. TypeScript/JavaScript/TSX/JSX remain compiler-semantic; the new language adapters are independently versioned Tier 1 structural providers. Adapter deltas return to the extension host, which rechecks job revision and source hashes and remains the only storage/publication authority.
- Per-adapter caches are keyed by adapter version plus the selected file IDs/content hashes. Unchanged documentation, language, contract, data, build, CI, infrastructure, and configuration outputs are generation-rebased and reused while affected adapters rerun. Each broad language has a distinct adapter/cache key. Cross-links are recomputed from the active normalized facts after adapter output changes.
- A slower mixed-repository extension fixture exposed a real pre-existing publication race between overlapping startup/Git generation writes. `IntelligenceStore.save()` now serializes immutable publication at the storage boundary. A regression test starts generations 1 and 2 concurrently and verifies two valid directories with generation 2 active.

### Supported technologies and capability levels

- **Semantic:** TypeScript, JavaScript, TSX, and JSX through the existing TypeScript compiler provider, including the already completed semantic graph and Progressive CPG.
- **Structural languages:** Java, Python, C#, Go, Rust, C, C++, Ruby, PHP, Kotlin, Swift, and Shell. Providers extract modules/packages/namespaces, classes/interfaces/structs/traits/enums, functions/methods, imports, explicit language tests, exact ranges, and recognized documentation blocks. Imports are syntactic/unresolved external dependencies; calls, overloads, runtime dispatch, macros, classpaths, build tags, and native type resolution are not claimed.
- **Framework detection:** React, Express, NestJS, Fastify, Next.js, Spring, Django, Flask, Rails, and Laravel from explicit imports/markers. This is structural detection. Only facts already emitted by a deterministic language/framework rule are canonical; lifecycle and dependency-injection graphs are not inferred.
- **Documentation:** Markdown, MDX, AsciiDoc, reStructuredText, plain text inventory, ADRs, headings/sections, fenced code, links, explicit `REQ-*`/`Requirement:` statements, and JavaDoc/C# XML/Rust/Python-style documentation blocks. Informal business meaning is not inferred.
- **Contracts:** OpenAPI/Swagger paths/operations and schema declarations, GraphQL types/inputs/enums/fields, JSON Schema definitions/properties, Protobuf messages/enums/services/RPCs, and practical Avro record/field extraction. Remote references, YAML anchors/templates, complete request/response/security modeling, GraphQL resolver binding, and advanced Avro logical types remain partial/unsupported and are not described as semantic resolution.
- **Data/ORM:** Common ANSI/PostgreSQL/MySQL/SQLite-shaped table/column/index/foreign-key/view/query/migration DDL; explicit create/alter/read/write relationships; Prisma models/fields/relations/maps; and explicit JPA, Entity Framework, Django ORM, SQLAlchemy, TypeORM, and GORM detection/mapping shapes. Vendor procedural SQL and runtime ORM mutation are unsupported. Explicit table maps are confidence 1; documented naming conventions are confidence 0.65.
- **Tests:** JUnit/TestNG, pytest/unittest, xUnit/NUnit/MSTest, Go testing, Rust test, RSpec, PHPUnit, Playwright, Cypress, Vitest, Jest, and Mocha detection with suites/cases/hooks, parameterized/skipped metadata where explicit. Existing TypeScript exact call/import test mappings remain authoritative; naming-only production mappings are not upgraded to exact coverage.
- **Build/package/delivery:** package.json/npm/pnpm/Yarn indicators, Maven, Gradle, MSBuild/.NET projects, Python/Poetry/pip metadata, Go modules, Cargo, Make, and CMake; GitHub Actions, GitLab CI, Azure Pipelines, Jenkins, CircleCI, Travis CI, and Bitbucket Pipelines. Commands are classified and reduced to safe signatures; they are never executed and complete conditional build semantics are not claimed.
- **Infrastructure/configuration:** Dockerfile, Docker Compose, Kubernetes, Helm detection, Terraform/OpenTofu, and Serverless detection; JSON/YAML/TOML/XML/INI/properties/environment-template key names. Docker images, services, ports, dependencies, resource declarations, and configuration/secret references are structural. Helm/provider/template evaluation and cloud schema validation are unsupported.
- **Metadata-only:** unknown files and static assets retain canonical inventory/classification plus missing-adapter diagnostics. Generated/output/dependency/binary/archive/media paths remain excluded from deep parsing while their file inventory and exclusion reason remain available.

### Cross-technology linking and security

- Exact route-to-contract links require normalized HTTP method and path evidence. Exact package-script-to-CI-step links require the same explicit script key. Configuration links require one exact key declaration. Explicit ORM/table and migration/table mappings use both source records. Each cross-file link has relationship-owned evidence from both sides and records its rule/classification.
- ORM naming conventions are explicitly `convention` resolution at confidence 0.65. Any exact key with multiple targets is omitted and produces `ambiguous-cross-link`; similar names alone never create a relationship.
- Sensitive files remain unread metadata. Configuration, CI, Docker, Kubernetes, and Terraform adapters persist key/reference names and default-value presence only. Commands are reduced to command kind/script name; secret references are name-only. The complete mixed adapter result is asserted not to contain fixture password, token, or Docker environment values.

### Persistence, queries, UI, and performance observations

- Immutable generations now include `adapters.json.gz` with registry capabilities, detections, coverage, versions, freshness, and execution/cache metrics. Adapter diagnostics and cross-links live in canonical contribution/evidence shards. Reload and health coverage prove the adapter shard is compressed and queryable after restart.
- `intelligence/technologies` and `intelligence/adapter-diagnostics` are generation-tagged, cancellable, cursor-paginated, and capped at 100 records. Existing bounded search/entity/neighborhood queries cover all new ontology types; the Webview receives coverage rows and selected domain entities, never a complete technology graph.
- The Intelligence UI adds capability-specific technology coverage, failures/unsupported counts, freshness, adapter diagnostics, and bounded explorer groups for APIs/contracts, data, tests, build, delivery, infrastructure, documentation, and configuration.
- The 52-test universal-adapter matrix executes in roughly 32 ms in the final targeted Vitest run. The complete 27-file/169-test suite completes in 2.48 seconds. Extension bundle increased from 795.0 KiB to 808.8 KiB; the self-contained compiler/CPG/adapter worker increased from 10.2 MiB to 10.3 MiB. Webview JavaScript is 334.43 KiB (97.00 KiB gzip) and CSS is 21.97 KiB (4.76 KiB gzip). The VS Code fixture still meets the existing sub-500 ms activation assertion and completes mixed repository ingestion without blocking the extension host.
- Real metrics persisted per adapter include execution time, considered/parsed/failed files, cache reuse, extracted entities, resolved relationships/cross-links, unsupported files, and memory-warning state. No repository content is transmitted.

### Fixture and validation coverage

- The required 45 numbered cases are present, plus required-language Tier 1 cases, adapter persistence, mixed semantic invariant, concurrent publication, host-route, UI, and real VS Code integration coverage. Fixtures cover documentation/ADR, OpenAPI/GraphQL/JSON Schema/Protobuf/Avro, SQL/migrations, Prisma/JPA, all required languages, tests, package/build systems, two CI providers, Docker/Compose, Kubernetes, Terraform, configuration secrecy, exclusions, detection, activation/deactivation, version records, incremental reuse, cross-links/ambiguity, queries, UI, no external storage, and no LLM usage.
- Final `npm run verify`: passed typecheck, lint, 27 test files/169 tests, and both production builds.
- Final `npm run test:extension`: passed on VS Code 1.95.0. The real Git fixture verifies non-blocking activation, persisted OpenAPI/SQL technology coverage, semantic search/evidence, CPG, file changes/coalescing/rename/delete, branch checkout, and same-branch HEAD reconciliation.
- `npx vsce ls` includes the extension bundle, self-contained semantic/CPG/adapter worker, and bounded Webview assets. `git diff --check` passed. Static review found no LLM call, external database/server/vector store, secret value persistence, deep dependency/output ingestion, unbounded Webview technology payload, or fabricated name-similarity link.

### Files implemented for Milestone 5

Added:

- `src/shared/contracts/adapters.ts`
- `src/core/intelligence/adapters/IntelligenceAdapter.ts`
- `src/core/intelligence/adapters/AdapterRegistry.ts`
- `src/core/intelligence/adapters/AdapterVersions.ts`
- `src/core/intelligence/adapters/AdapterEvidenceFactory.ts`
- `src/core/intelligence/adapters/BaseAdapter.ts`
- `src/core/intelligence/adapters/UniversalAdapters.ts`
- `src/core/intelligence/adapters/DataDeliveryAdapters.ts`
- `src/core/intelligence/adapters/BuildInfrastructureAdapters.ts`
- `src/core/intelligence/adapters/CrossTechnologyLinker.ts`
- `src/core/intelligence/adapters/UniversalAdapterEngine.ts`
- `src/ui/components/intelligence/TechnologyCoverage.tsx`
- `tests/unit/intelligence/adapters/UniversalAdapterEngine.test.ts`

Modified:

- `PLANS.md`
- `scripts/run-extension-tests.mjs`
- `src/shared/contracts/intelligence.ts`
- `src/shared/contracts/messages.ts`
- `src/core/intelligence/RepositoryIndexService.ts`
- `src/core/intelligence/IntelligenceQueryService.ts`
- `src/core/intelligence/semantic/SemanticModel.ts`
- `src/core/intelligence/semantic/TypeScriptJavaScriptParser.ts`
- `src/core/persistence/IntelligenceStore.ts`
- `src/extension/extension.ts`
- `src/extension/webview/WebviewMessageRouter.ts`
- `src/ui/components/intelligence/SemanticBrowser.tsx`
- `src/ui/styles/global.css`
- `tests/extension/index.ts`
- `tests/ui/SemanticBrowser.test.tsx`
- `tests/unit/intelligence/IntelligenceStore.test.ts`
- `tests/unit/intelligence/SemanticPersistence.test.ts`
- `tests/unit/intelligence/semantic/TypeScriptJavaScriptParser.test.ts`
- `tests/unit/webview/WebviewMessageRouter.test.ts`

No file was deleted for Milestone 5. No dependency was added. The worktree's pre-existing `LICENSE` deletion and earlier milestone changes were preserved.

### Recommended next single milestone

Milestone 6 — Complete the deterministic query engine operations. Before broad path/impact work, hydrate unchanged adapter-owned artifacts into a fresh worker so a post-restart single-adapter version upgrade avoids the current safe full semantic-context rebuild. Then add bounded packages/contracts/data/tests/build/delivery/documentation queries atop the canonical IDs already produced here. Do not begin OKF, repository-wide taint, final UI redesign, Copilot, intent, specification, context-compression, validation, or autonomous workflow work.

## Milestone 6 — Query engine

### Grounded entry audit — 2026-07-15

The continuous runtime, TypeScript/JavaScript semantic graph, Progressive CPG, and Universal Repository Intelligence Adapter milestones were re-audited against `AGENTS.md`, the complete `docs/intelligence` set, their persisted contracts, the real extension activation path, fixtures, and the current dirty worktree. `npm run verify` passed with 27 test files and 169 tests, including type checking, linting, unit/UI tests, and both production bundles. `npm run test:extension` passed on VS Code 1.95.0 against the real temporary Git fixture.

Canonical snapshot validation requires subject-matched evidence for every repository/root/file/entity/relationship and rejects unresolved relationship endpoints. TypeScript/JavaScript CPG scope, CFG, local data-flow, forward/backward slices, conditions, bounded limits, persistence, and UI routes are implemented and tested. Universal adapter capability tiers, limitations, detections, evidence-backed cross-technology links, sanitization, incremental generation publication, branch/HEAD reconciliation, storage recovery, and bounded multi-domain browsing remain truthful and green. Static dependency/runtime review found no LLM query or ingestion path, external database, graph server, vector store, HTTP backend, or cloud persistence.

One recorded prerequisite optimization is still genuinely incomplete: a fresh semantic worker cannot seed its per-adapter cache from the last valid generation. Canonical correctness and restart recovery are unaffected, but an adapter-version-only repair re-extracts unrelated adapter outputs. M6.0 repairs only that verified defect before query-engine implementation begins.

### Implementation slices

#### M6.0 — Prerequisite repair: persisted adapter-cache hydration

- [x] Reconstruct version-matched adapter outputs from the active canonical generation and persisted adapter state without rereading secret values or trusting noncanonical worker state.
- [x] Seed a fresh worker per project before full/reset analysis, reuse only exact adapter version and source-hash matches, and recompute cross-technology links from current facts.
- [x] Test restart hydration, selective version invalidation, stale hash rejection, and unchanged canonical output; then mark the M5.4 optimization complete.

#### M6.1 — Unified generation-aware query contracts and orchestration

- [x] Add the complete typed operation, selector, filter, traversal, include, ranking, limit, repository-state, result, diagnostic, explanation, capability-boundary, continuation, and cache-state contracts.
- [x] Add `QueryContext`, `QueryParser`, `QueryCompiler`, `QueryPlanner`, `QueryExecutor`, `QueryDiagnosticsService`, and orchestration through the existing `IntelligenceQueryService`; preserve current overview/search/entity/neighborhood compatibility routes.
- [x] Require generation/branch compatibility, cancellation, time budgets, stable query IDs, bounded evidence, typed diagnostics, truncation, and pagination on every unified query.

#### M6.2 — Deterministic parsing, entity resolution, search, ranking, and evidence

- [x] Add controlled grammar rules, ontology/relationship aliases, synonyms, autocomplete, supported templates, compiled-query preview, and structured unsupported-query diagnostics with no LLM fallback.
- [x] Add `EntityResolver` and `SearchService` using stable ID, exact qualified/name/path/route/configuration/database/package/alias matches, normalized camel/snake/path tokens, and contextual filters; never silently resolve low-confidence ambiguity.
- [x] Add centrally configured `ResultRanker`, `EvidenceAssembler`, and `QueryExplanationService` with testable ranking reasons, index use, confidence, capability level, current context, and exact/inferred/candidate classification.

#### M6.3 — Indexed traversal, path, dependency, and architecture analysis

- [x] Add `GraphTraversalService` over persisted incoming/outgoing adjacency indexes with direction/type/confidence/stop filters, depth/node/edge caps, cancellation, time budgets, and explicit truncation.
- [x] Add `PathQueryService` for shortest, typed, bounded-all, highest-confidence, lowest-risk, cross-technology, and semantic paths without fabricated hops or hidden low-confidence boundaries. CPG detail remains an explicit facade query instead of manufacturing repository-level hops.
- [x] Add `DependencyQueryService` and `ArchitectureQueryService` for evidence-backed dependency families, cycles, declared-layer violations, fan-in/out centrality, orphan modules, and explicitly labeled dead-code candidates. More specific architecture policy is reported only when repository facts declare it.

#### M6.4 — Impact, flow, tests, change, and CPG facade

- [x] Add `ImpactQueryService` with direct/transitive/behavioral/contract/data/test/architecture classifications and an explained deterministic risk-factor score.
- [x] Add `FlowQueryService` for bounded HTTP, UI-to-API, command, event/queue, job, build, persistence, and configuration relationship families that preserve exact/structural/convention/unresolved segments.
- [x] Add `TestQueryService` for evidence-tiered tests-for and impacted-test mappings, suites/cases, untested public-symbol candidates, and CPG branch candidates. Mocks, fixtures, skips, and coverage gaps appear only when their canonical entities/relationships exist.
- [x] Add `ChangeQueryService` over retained immutable generations for added/modified/deleted entities and signature, route, and schema changes; requested unavailable branches/generations produce limitations, and rename continuity is never guessed.
- [x] Add `CpgQueryFacade` for scope, CFG, local data flow/read-write data, backward/forward slices, and conditions while retaining the semantic graph as the repository-level layer.

#### M6.5 — Bounded generation-specific cache and performance safety

- [x] Add a bounded LRU `QueryCache` keyed by normalized query, resolved seeds, generation, branch, filters, limits, extractor/adapter versions, and CPG structural identity; invalidate conservatively on generation or provider identity change.
- [x] Prevent stale results after promotion, record real latency/cache/truncation metrics, cooperatively yield bounded graph loops, return bounded evidence summaries, and keep all Webview responses under contract caps.
- [x] Exercise cancellation, time-budget enforcement, stale generation rejection, generation invalidation, cache hit/miss state, and extension-host responsiveness.

#### M6.6 — Typed host routes and focused Query Workspace UI

- [x] Add the requested unified/direct query requests and query lifecycle events with typed bounded payloads, plus bounded local recent-query history appropriate for the current SPA.
- [x] Add a focused Query Workspace to the existing Intelligence UI with global input, deterministic suggestions/templates, compiled preview, cancellation, and bounded search/entity/neighborhood/path/impact/flow/architecture/dependency/test/change/CPG views.
- [x] Add an explanation panel showing parsing, resolved/ambiguous seeds, indexes, traversed families, ranking reasons, evidence, limits, capability boundaries, cache state, and truncation without beginning the final UI redesign.

#### M6.7 — Mixed-technology fixtures and completion gate

- [x] Add exact/ambiguous resolution, search/pagination, traversal/path, impact/risk, flow, dependency/architecture, tests, temporal, CPG, grammar/explanation, cancellation/budget/cache, Webview-bound, no-fabricated-hop, and capability-limitation tests over a mixed-technology fixture.
- [x] Run typecheck, lint, all unit/UI tests, extension integration tests, extension/Webview production builds, package-content inspection, diff checks, static no-LLM/external-storage inspection, and representative fixture queries.
- [x] Record exact algorithms, ranking weights, cache invalidation, limits, latency observations, unsupported query forms, every created/modified/deleted file, and only tested completion claims.

### Assumptions and bounded behavior

- Retained immutable generations are the authoritative temporal source. Branch/commit comparisons return capability diagnostics when the requested state is not retained locally; no Git checkout or repository mutation is performed by a query.
- Architecture layers and bounded contexts are exact only when repository evidence declares them. Keystone defaults may produce deterministic classifications/candidates with their rule and confidence, never curated architectural certainty.
- Broad structural adapters do not gain semantic call/data-flow precision through querying. Cross-technology paths expose capability transitions and convention confidence rather than smoothing over them.
- Query algorithms operate on persisted indexes and selected CPG shards with hard caps and cooperative yielding. Repository-wide taint, OKF projection, final UI redesign, Copilot/LLM interpretation, context compression, and autonomous workflow behavior remain out of scope.

### Completion record — 2026-07-15

The query layer is a typed pipeline: `IntelligenceQueryService` compiles or accepts a structured query, `QueryPlanner` validates seed/expense requirements, `EntityResolver` returns ranked candidates, `QueryExecutor` dispatches to the focused analysis service, `EvidenceAssembler` gathers bounded canonical evidence, and `QueryExplanationService` records deterministic decisions. All results are pinned to one active generation and repository state. Existing overview/search/entity/neighborhood routes remain compatible.

The controlled parser contains 21 explicit templates. It normalizes whitespace and terminal question marks, then compiles matched grammar into the same typed query contract used by direct API requests. Stable IDs, qualified names, symbol names, domain keys, paths, camel/snake tokens, package/module/current-file filters, confidence, centrality, and pinned context are deterministic resolution/ranking signals. Similar low-scoring candidates remain ambiguous and expensive analysis requires an explicit selection. Unsupported phrasing returns templates and a structured diagnostic; there is no LLM fallback.

Traversal reads persisted incoming/outgoing adjacency lists and applies direction, relationship, entity, language, confidence, stop-type, depth, node, and edge bounds. Path search uses a bounded queue: FIFO for shortest/typed/all-bounded, maximum-confidence ordering for highest-confidence, and accumulated explicit relationship risk for lowest-risk. Every returned hop is a canonical relationship with its evidence IDs, confidence, resolution classification, capability transition, and unresolved boundary state. Impact uses bounded incoming traversal, separates distance-one and transitive results, classifies semantic families, and scores risk from individually exposed public-API, fan-in/out, contract/data, CPG-branch, test-gap, and low-confidence factors.

Ranking weights are centralized in `RANKING_WEIGHTS`: stable ID 1200, qualified name 1000, exact path 950, exact domain key 925, exact name 900, prefix 650, normalized token 120, same module 90, same package 80, current file 75, pinned context 70, evidence confidence up to 100, and bounded graph degree 5 per edge. Graph-distance, test-mapping, confidence, and risk operations add service-specific reasons; the explanation returns the rules used rather than an opaque score.

`QueryCache` is a bounded in-memory LRU. Its identity includes the normalized structured query, resolved seeds, generation, branch, limits/filters, extractor and adapter versions, and CPG structural hashes. Generation promotion and any provider/shard identity change conservatively invalidate affected cached state; an unavailable requested generation is rejected rather than served stale. Cache state and real execution latency are returned. Hard maxima are 100 result rows, 500 nodes, 1,500 relationships, 20 paths, depth 20, 100 evidence summaries, and 5 seconds; individual CPG slice caps remain stricter where applicable. Graph loops yield cooperatively, and the focused UI can cancel outstanding requests.

Unsupported or conditional behavior remains explicit: free-form language outside the 21 templates; `OKF_CONCEPT`; repository-wide interprocedural taint; semantic continuity across renames without reliable Git evidence; branch/commit comparison when that immutable state is not locally retained; architecture policy not declared or deterministically classifiable; coverage/co-change/churn rankings without canonical input facts; and slices without an explicit `<semantic-entity-id>#<cpg-node-id>`. CPG is used only for supported TypeScript/JavaScript scopes and is not automatically substituted for missing repository relationships.

Validation outcomes:

- Baseline before M6 changes: `npm run verify` passed 27 files/169 tests, and `npm run test:extension` passed on VS Code 1.95.0.
- Targeted adapter repair: 58 adapter/runtime/persistence tests passed; typecheck and lint passed.
- Targeted query engine after final CPG routing correction: 58 tests passed in 174 ms; typecheck and lint passed.
- Final `npm run verify`: passed typecheck, lint, 29 unit/UI test files with 232 tests, and both production builds. Artifacts were 897.6 KB extension JavaScript, 10.3 MB semantic worker JavaScript, and 348.80 KB/100.28 KB gzip Webview JavaScript plus 24.38 KB/5.15 KB gzip CSS.
- Final `npm run test:extension`: passed the real VS Code 1.95.0 activation/fixture suite with exit code 0, including unified search and CPG scope queries. The isolated runner logged an unrelated failed remote chat-registry fetch after the assertions; it did not affect the extension test result.
- `npx vsce ls` listed 10 bounded package entries; `git diff --check` passed. Static query/intelligence inspection found no LLM/embedding invocation, external database/graph/vector dependency, HTTP backend, or cloud persistence.

Files added for M6:

- `src/shared/contracts/query.ts`
- `src/core/intelligence/query/QueryParser.ts`
- `src/core/intelligence/query/QueryCache.ts`
- `src/core/intelligence/query/QueryEngine.ts`
- `src/ui/components/intelligence/QueryWorkspace.tsx`
- `tests/unit/intelligence/query/QueryEngine.test.ts`
- `tests/ui/QueryWorkspace.test.tsx`

Files modified for M6:

- `PLANS.md`
- `src/shared/contracts/messages.ts`
- `src/core/intelligence/RepositoryIndexService.ts`
- `src/core/intelligence/IntelligenceQueryService.ts`
- `src/core/intelligence/semantic/SemanticModel.ts`
- `src/core/intelligence/adapters/UniversalAdapterEngine.ts`
- `src/core/persistence/IntelligenceStore.ts`
- `src/extension/extension.ts`
- `src/extension/webview/WebviewMessageRouter.ts`
- `src/ui/services/HostBridge.ts`
- `src/ui/components/intelligence/SemanticBrowser.tsx`
- `src/ui/styles/global.css`
- `tests/extension/index.ts`
- `tests/unit/intelligence/adapters/UniversalAdapterEngine.test.ts`
- `tests/unit/webview/WebviewMessageRouter.test.ts`

No file was deleted for M6 and no dependency was added. The worktree's pre-existing `LICENSE` deletion and earlier milestone changes were preserved.

### Recommended next single milestone

Milestone 7 — implement deterministic OKF projection from the now-queryable canonical graph. Do not begin the final Intelligence UI redesign, Copilot delegation, intent/specification workflows, context compression, repository-wide security taint, or autonomous SDLC behavior as part of that slice.

## Milestone 7 — OKF

- [ ] Define Keystone OKF profile.
- [ ] Project canonical entities into OKF.
- [ ] Generate indexes and backlinks.
- [ ] Regenerate only affected concepts.
- [ ] Validate links and freshness.
- [ ] Add OKF browser and export.

## Milestone 8 — Complete Intelligence UI

- [ ] Intelligence overview
- [ ] Technology and coverage dashboard
- [ ] Worker activity panel
- [ ] Search and query bar
- [ ] Explorer
- [ ] Entity inspector
- [ ] Scoped graph canvas
- [ ] Flow viewer
- [ ] Impact view
- [ ] Test intelligence
- [ ] OKF browser
- [ ] Diagnostics and exclusions

## Milestone 9 — Intent Capture and Spec-Driven Development prerequisite repair

### Entry audit — 2026-07-16

The requested Copilot delegation milestone cannot safely begin on the existing workflow scaffolding. The unchanged repository initially failed type checking in three tracked, unfinished OKF files; only the mechanical type/lint defects were repaired, without wiring or expanding OKF. After that repair, `npm run verify` passed type checking, linting, 29 test files/232 tests, and both production bundles.

The intent/specification prerequisite itself is not implemented or stable. `IntentEngine` performs regex-only area extraction and fabricates hard-coded Copilot agent IDs. `SpecificationService`, `TaskGraphService`, and `WorkflowOrchestrator` keep authoritative aggregates only in memory. Generated specifications leave material sections empty, task graphs do not enforce approval or meaningful dependency/traceability rules, repository-generation staleness is not connected, and production activation/Webview routing/UI do not expose the workflow. The React pages explicitly label Intent, Specifications, Tasks, and Context as future phases. `VsCodeCopilotAdapter` also calls undocumented hard-coded commands, fabricates a default agent when discovery fails, and may report an assisted delegation as successful without execution. These are verified blockers for controlled delegation.

### M9.1 — Restart-safe workflow contracts and repository-aware intent

- [x] Add bounded, versioned workflow snapshots and atomic local persistence for intents, specification revisions, task graphs, and staleness state.
- [x] Preserve original intent and implement quick, guided, and spec-driven modes with deterministic category/risk/constraints/decisions and Keystone Intelligence entity resolution.
- [x] Remove every hard-coded or fabricated Copilot agent recommendation from intent processing.

### M9.2 — Complete specification lifecycle and task graph

- [x] Generate scope, requirements, constraints, acceptance criteria, test strategy, risks, decisions, repository evidence, and validation obligations deterministically.
- [x] Enforce review/approval/material revision/reapproval with immutable revision snapshots and impacted-task stale reasons. Cancellation is represented at workflow/task level; a separate rejection status is not exposed.
- [x] Generate dependency-ordered, cycle-validated tasks traceable to requirements and acceptance criteria; require acceptance criteria and validation steps before readiness.
- [x] Mark affected tasks/specifications stale on relevant generation, branch, task-definition, or repository evidence changes and restore authoritative state after restart.

### M9.3 — Focused prerequisite host/UI integration and gate

- [x] Add typed validated workflow requests/events and focused Intent, Specification, and Task views sufficient to exercise modes, approval, revisions, traceability, readiness, and staleness.
- [x] Prove no Copilot invocation occurs in the prerequisite workflow.
- [x] Run typecheck, lint, unit/UI/integration/extension tests and both builds before enabling delegation.

## Milestone 10 — Copilot Agent Discovery, Context Construction, and Controlled Delegation

### M10.1 — Capability-driven adapter and truthful agent registry

- [x] Isolate all VS Code/Copilot extension inspection and allowlisted command use behind `CopilotAdapter` and `CopilotCapabilityDetector`; treat unknown as unavailable and make refresh/version evidence explicit.
- [x] Merge only evidence-backed discovered agents, inert repository/workspace profiles, Keystone profiles, and user aliases into `CopilotAgentRegistry` with availability, restrictions, provenance, confidence, and capability evidence.
- [x] Implement manual, recommended, explicit rule-based, fixed-workflow, and per-task selection without enabling automatic delegation by default.
- [x] Add centrally weighted deterministic recommendations with matching/missing capabilities, restrictions, availability, and explanations.

### M10.2 — Eligibility, bounded context collection, ranking, and compression

- [x] Implement `TaskEligibilityService` for approved/current spec, dependency readiness, decisions, branch/generation freshness, criteria/validation, overlap, agent selection, and reviewed prompt/context blockers.
- [x] Collect bounded candidates through canonical Intelligence queries and exact/current-editor source ranges, with provenance, evidence, confidence, freshness, size, tier, reason, and pin state.
- [x] Rank centrally and compress structurally using selected ranges, signatures/interfaces, targeted tests, bounded graph summaries, deduplication, and required/supporting/optional budget policy; never use an LLM.
- [x] Enforce configurable estimated-token/character/file/fragment/path/test caps, secret/exclusion rules, required-item protection, deterministic fingerprints, cache identity, cancellation, and stale-build discard.

### M10.3 — Preview, deterministic prompt, and controlled delegation

- [x] Provide context add/remove/pin/restore/budget/regenerate/validate operations and an exact bounded preview with exclusions, diagnostics, fingerprints, and required-item override warning.
- [x] Build a deterministic delegation prompt containing approved objective, requirements, criteria, constraints, repository context, tests, validation, prohibited changes, blocker protocol, and completion-report format.
- [x] Persist reviewed context/prompt fingerprints, agent snapshot, specification revision, generation, user edits, sessions, baselines, changes, and diagnostics without credentials, secrets, conversation history, or duplicate large source.
- [x] Require explicit approval; use direct mode only with proven invocation and a real handle, otherwise assisted prompt insertion/open-UI or explicit clipboard fallback without fabricated execution/completion.

### M10.4 — Repository tracking, host/UI workflow, and completion gate

- [x] Capture branch/HEAD/dirty/staged/untracked baseline, classify expected/related/unexpected/pre-existing/ambiguous changes, detect overlapping active sessions, and invalidate material pre-delegation changes.
- [x] Track only truthful delegation states through cancellation, external-start confirmation, repository-change review, and reload; never mark a task completed in this milestone.
- [x] Add all requested typed, bounded, cancellable, generation-aware Webview requests/events and a focused agent/readiness/context/prompt/status UI without beginning validation automation.
- [x] Cover capability/fallback, discovery/profile, selection/recommendation, eligibility, context/security/budget/fingerprint, prompt, delegation, overlap/change, persistence/reload, validation-boundary, and bounded-payload behavior; run the full repository/extension/package/security gate.

### Assumptions and explicit boundaries

- VS Code 1.95 and installed GitHub extensions do not imply a supported agent-discovery or direct-invocation API. Production capabilities remain unavailable unless runtime evidence and an allowlisted adapter method prove otherwise.
- Repository agent/profile files are parsed as inert bounded configuration; they never execute code or authorize arbitrary commands.
- Context token counts are conservative estimates based on characters unless a supported tokenizer is explicitly available. Keystone does not claim Copilot billing/token usage or savings.
- The milestone may prepare and initiate delegation and observe repository changes. It does not interpret Copilot responses, execute validation commands, claim task completion, retry automatically, create PRs, hand work off, or begin autonomous SDLC behavior.

### Milestones 9–10 completion record — 2026-07-16

Intent, specification, tasks, context, and controlled delegation are now production-wired. Versioned atomic local state restores workflows, agent evidence, selections, reviewed context/prompt fingerprints, sessions, and repository baselines. Intent terms resolve through the deterministic Intelligence query service. Specification approval and material revisions govern a cycle-checked task graph. Copilot capabilities default to unavailable, configured profiles remain `unknown`, aliases inherit only an explicit target, direct invocation requires both a supported runtime contract and a real handle, and fallback modes never claim progress or completion.

Context ranking weights, budgets, exclusions, token estimates, evidence, current editor/selection proximity, exact source ranges, deterministic fingerprints, and approval invalidation live in the core service rather than UI code. Generation/branch changes reconcile workflow staleness and invalidate reviewed context and prompt approval. Direct completion/result events remain unavailable in the production VS Code 1.95 adapter because no supported integration method is exposed; the UI therefore uses assisted or explicit clipboard behavior and user confirmation.

Prerequisite validation before Milestone 11: `npm run verify` passed 34 files/266 tests plus extension and Webview production builds; `npm run test:extension` passed VS Code 1.95.0 with exit code 0. The isolated VS Code runner again logged an unrelated remote chat-registry fetch failure after assertions. No dependency was added.

## Milestone 11 — Task Execution Tracking, Result Capture, Validation, Retry, and Completion

### M11.1 — Persisted execution lifecycle and repository attribution

- [x] Add a separate versioned, atomic, restart-safe `TaskExecutionSession` store with an explicit tested transition table and immutable delegation baseline linkage.
- [x] Require a current approved task/delegation, matching branch/revision, persisted baseline, and explicit external-start confirmation; opening Copilot never starts execution.
- [x] Observe bounded Git reconciliation changes and classify expected, related, unexpected, pre-existing, ambiguous, excluded, and generated-output paths with confidence, reasons, evidence, and auditable user attribution overrides.
- [x] Capture direct results only behind a supported result event, otherwise assisted claims or repository-only evidence; agent claims remain lower-reliability untrusted input.

### M11.2 — Safe deterministic validation

- [x] Build generation/fingerprint-aware plans from approved criteria, attributed changes, repository scripts, current canonical diagnostics/entities, specification scope, and optional architecture/security/performance capability checks.
- [x] Replace the prior unsafe `shell: true` scaffold with typed executable/argument descriptors, allowlisted binaries, explicit working directories, sanitized environments, timeouts, cancellation/process-group termination, bounded tails, output truncation, control-character cleanup, and secret redaction.
- [x] Run repository-discovered type-check, lint, test, build, integration, and end-to-end scripts through managed child processes; potentially mutating descriptors require explicit approval and prohibited commands cannot run.
- [x] Map every required criterion to validation steps and return passed, failed, not-run, not-verifiable, manual-review, or overridden outcomes with evidence and blocking findings. Repository changes during/after validation stale the results.

### M11.3 — Retry, completion, and dependency unlock

- [x] Preserve failed attempts and create reduced repair context from incomplete criteria, retry-relevant findings, commands/evidence, and attributed changes for same-agent, different-agent, manual, or partial repair plans.
- [x] Create a separate retry execution session and fresh repository baseline only after explicit retry start; retain the parent attempt and never auto-run or auto-delegate a dependent task.
- [x] Block completion on missing/stale validation, failed or unverified required criteria, required step failure, blocking findings, unexpected changes, branch/specification drift, or stale repository fingerprints.
- [x] Record explicit criterion/finding/manual overrides and explicit task completion; unlock only non-stale dependents whose dependencies are complete and generate a bounded local workflow report only when all tasks complete.

### M11.4 — Typed host/UI integration and verification

- [x] Add all requested typed/versioned/bounded execution, validation, retry, and completion request/event names. Core routes return validated persisted models; unsupported direct result capture fails rather than fabricating data.
- [x] Add a focused execution/validation workspace for start/stop confirmation, attributed changes, result capture, planned safe commands, live bounded progress, criteria/findings, readiness, and explicit completion.
- [x] Add real-process and deterministic tests for transitions, attribution families, result-capture honesty, command allowlisting/approval/bounds/redaction/cancellation, criterion outcomes, validation orchestration, retry preservation/fresh baselines, explicit completion, and dependency unlock.
- [x] Run typecheck, lint, all unit/UI tests, extension integration tests, both production builds, package-content inspection, diff checks, and static shell/LLM/external-storage inspection.

### Execution, validation, and completion design

`TaskExecutionService` creates an execution record from a persisted delegation session and uses `ExecutionStateMachine` to reject invalid jumps. Change attribution combines baseline membership, exact approved files, repository-area proximity, canonical classification, Git change kind, and explicit user override; timing is never sufficient evidence. Direct Copilot result capture is rejected in production because result events are unavailable. Assisted text is sanitized and stored as an agent claim, while repository-only capture explicitly records the missing agent report.

`ValidationPlanner` discovers only bounded known repository scripts and emits typed `CommandDescriptor` values. `CommandExecutionService` calls `spawn(executable, args)` with `shell: false`, a small environment allowlist, explicit cwd, timeout/cancellation, process-tree termination, and 20,000-character sanitized tails. Plans also perform exact diff/scope checks, current-generation changed-entity/diagnostic checks, and honest optional capability checks. Required criterion status is derived only from mapped step evidence; optional skipped security/architecture checks never imply assurance.

Retries keep the original session, validation runs, baseline, context/prompt identities, findings, and reason. Repair context excludes unrelated successful material. A retry creates a child session with a fresh baseline and remains `awaiting-start`; it does not automatically contact Copilot. `CompletionDecisionService` distinguishes overridable findings/criteria from non-overridable missing validation, specification drift, and repository staleness. Completion requires an explicit user action. Dependency unlock changes eligible pending tasks to ready but never builds context or delegates them automatically.

Persisted command data is limited to typed descriptors, summarized evidence, and bounded sanitized output tails. No credentials, complete environment, unbounded logs, Copilot chat history, external database, remote service, push, deployment, or PR action exists.

Unsupported or conditional validation remains explicit: no direct Copilot completion/result event on the production adapter; no semantic equivalence proof; no baseline command-failure comparison unless a prior validation run exists; no coverage claim without coverage evidence; no arbitrary Webview command text; no production migration/deployment/push; no repository-wide security taint guarantee; security and architecture steps are skipped when precise changed-scope CPG/framework/rule evidence is absent; performance findings are structural candidates unless a configured measurement command runs; impacted-test selection is evidence-ready in Intelligence but command-specific per-test invocation is not synthesized for unknown frameworks; manual/runtime criteria require explicit evidence or override.

Validation outcomes on 2026-07-16:

- Controlled-delegation prerequisite `npm run verify`: passed 34 test files/266 tests and both builds after the final attribution and UI-race repairs.
- Final `npm run verify`: passed typecheck, lint, 34 test files/268 tests, 1.1 MB extension bundle, 10.3 MB semantic worker, and Webview 399.70 KB/110.35 KB gzip JavaScript plus 27.73 KB/5.70 KB gzip CSS.
- `npm run test:extension`: passed VS Code 1.95.0 with exit code 0.
- `npx vsce ls`: 6 bounded package entries. `git diff --check` passed. Static review found one managed `spawn` using `shell: false`, no unsafe shell executor, LLM/embedding path, external database/vector/graph store, backend server, credential access, push, or deployment command.
- Real command tests ran allowlisted `npm --version`, bounded repository scripts, and an abort-driven long-running process; cancellation terminated the managed process tree in under five seconds and output tails stayed at or below 20,000 characters.

Files created for Milestones 9–11:

- `src/shared/contracts/delegation.ts`
- `src/shared/contracts/execution.ts`
- `src/core/persistence/DelegationPersistenceStore.ts`
- `src/core/persistence/ExecutionPersistenceStore.ts`
- `src/core/workflows/DevelopmentWorkflowService.ts`
- `src/core/context/TaskContextService.ts`
- `src/core/execution/TaskExecutionService.ts`
- `src/core/execution/CompletionService.ts`
- `src/core/validation/TaskValidationService.ts`
- `src/extension/copilot/VsCodeCopilotEnvironment.ts`
- `src/extension/copilot/ConfiguredAgentLoader.ts`
- `src/ui/components/delegation/DevelopmentWorkspace.tsx`
- `src/ui/components/execution/ExecutionValidationWorkspace.tsx`
- `tests/unit/copilot/ControlledDelegation.test.ts`
- `tests/unit/workflows/DevelopmentWorkflowService.test.ts`
- `tests/unit/execution/ExecutionValidation.test.ts`
- `tests/ui/DevelopmentWorkspace.test.tsx`
- `tests/ui/ExecutionValidationWorkspace.test.tsx`

Files modified for Milestones 9–11:

- `PLANS.md`, `package.json`
- `src/shared/contracts/messages.ts`
- `src/core/configuration/ConfigurationService.ts`
- `src/core/context/ContextCompressionEngine.ts`, `ContextEngine.ts`, `ContextPreview.ts`
- `src/core/copilot/AgentRegistry.ts`, `CopilotAdapter.ts`, `DelegationService.ts`
- `src/core/intent/IntentEngine.ts`
- `src/core/validation/ValidationEngine.ts`
- `src/extension/extension.ts`, `src/extension/webview/WebviewMessageRouter.ts`
- `src/ui/App.tsx`, `src/ui/services/HostBridge.ts`, `src/ui/styles/global.css`
- `tests/unit/context/ContextEngine.test.ts`, `tests/unit/webview/WebviewMessageRouter.test.ts`
- Mechanical prerequisite-only type/lint repairs in `src/core/intelligence/okf/OkfConcept.ts`, `OkfConceptIdFactory.ts`, and `OkfConceptMapper.ts`; OKF was not wired or advanced.

No file was deleted and no dependency was added.

### M11 hardening re-audit — 2026-07-16

The completion claim above was re-audited against the full milestone text. The earlier vertical slice passed its tests but omitted several required facts and controls. This hardening pass repaired only verified defects: execution-start fingerprint/dependency/overlap revalidation; repository identity, generation, file-hash, diagnostic, and known-validation baselines; retained-generation changed-entity analysis; explicit test-impact ranking and selection; real changed-scope static/CPG providers; scoped validation fingerprints, cache reuse, and stale invalidation; restart recovery; exact step reruns; separate partial-repair tasks; audited overrides; and expanded workflow reports/metrics. It also corrected a prerequisite ingestion defect where an external Git CLI commit could advance same-branch `HEAD` without a VS Code Git event. `VsCodeRepositoryMonitor` now polls metadata once per second and schedules reconciliation only when branch, HEAD, or dirty fingerprint changes.

Execution start now rechecks the approved delegation's persisted context and prompt fingerprints, task dependency readiness, overlapping active work, approved specification revision, branch, and current baseline. Active execution/validation is never restored as running after restart: interrupted sessions become blocked, running runs become cancelled, incomplete results become stale, and the workflow requires explicit reconciliation. State transitions remain explicit (`awaiting-start → executing → repository-changed → awaiting-result-capture → result-captured → planning-validation → validating → validation-passed|validation-failed|awaiting-user-review|stale`) with separate cancelled, blocked, retry-planned/retrying, accepted-with-override, and completed paths. Opening Copilot, observing a diff, receiving a claim, or finishing a validation command cannot itself complete a task.

Change attribution retains path classification, confidence, reasons, evidence IDs, and user corrections. `ChangedEntityResolver` compares the retained baseline generation with the active canonical generation and reports file, symbol, signature, route, contract, schema, configuration, test, build, infrastructure, dependency, and architecture changes. Missing retained identity produces an `unresolved-mapping` limitation and never asserts rename continuity. Static diagnostics use the same SHA-256 fingerprint algorithm at baseline and validation, so existing findings are not relabeled as introduced.

Validation plans discover allowlisted repository commands and run them as `spawn(executable, args)` with `shell: false`, workspace-bounded cwd, a minimal environment, timeout/abort process-tree termination, cross-chunk secret redaction, control cleanup, and 20,000-character tails. Deployment, publishing, login, remote push, and production-migration commands are rejected. Impacted mode runs only evidence-selected tests; if none can be selected, it reports and runs the configured full unit suite as a conservative fallback. Affected-suite mode likewise reports when no framework-safe selector exists instead of claiming narrower execution. Coverage-confirmed, exact call, exact reference/import, and framework bindings rank deterministically; naming candidates remain unselected suggestions. The UI can exclude selected candidates before rebuilding the plan.

Acceptance-criterion outcomes are derived from required mapped steps and evidence. Manual evidence is permitted only for `requires-manual-review`, `not-verifiable`, `not-run`, or `partially-passed`; it cannot replace an automated failure. Overrides are separate persisted audit records with prior/resulting status, reason, user identity, risk acknowledgement, and timestamp. Missing validation, cancelled/stale runs, specification drift, repository/branch drift, and changed required-step fingerprints are non-overridable. Completion remains explicit, unlocks only non-stale dependents, and never runs, builds context for, or delegates the next task.

Retries preserve every prior session/run and reduce repair context to failed criteria, retry-relevant findings/evidence, exact failed commands, and attributed changes. Same-agent and explicitly selected different-agent retries create a child session with a fresh baseline and remain `awaiting-start`. A partial repair creates a separate unassigned task covering only failed criteria under the unchanged approved specification; it must be reviewed and delegated separately. Manual repair changes are re-observed and revalidated rather than treated as successful by declaration.

Unsupported or conditional validation remains explicit: production Copilot exposes no supported direct result/completion event; arbitrary Webview command text is rejected; framework-specific affected-suite selection falls back to the configured full unit suite when no safe selector exists; naming-only test mappings do not imply coverage; coverage percentages, flaky-test status, or performance regressions are not claimed without canonical measurements; contract/schema/architecture checks depend on current canonical entities/diagnostics; security analysis is bounded intraprocedural changed-scope CPG source-to-sink detection, not repository-wide taint assurance; and semantic equivalence is not proven.

Final validation outcomes:

- Initial hardening baseline: `npm run verify` passed typecheck, lint, 34 test files/268 tests, and both production builds.
- Focused execution/workflow/UI suites passed 39 tests after baseline/change/provider/recovery/partial-repair additions; the final focused execution/UI suite passed 34 tests after manual-evidence and test-mode corrections.
- Final `npm run verify` passed typecheck, lint, 35 test files/284 tests, the 1.2 MB extension bundle, the 10.3 MB semantic worker, and the Webview bundle at 410.10 KB/112.52 KB gzip JavaScript and 27.73 KB/5.70 KB gzip CSS. Unit/UI tests completed in 3.05 seconds; the real timeout test terminated in the bounded five-second assertion window.
- The first extension-host run exposed the missed external-CLI same-branch HEAD reconciliation and failed its 30-second wait. After the monitor repair, two `npm run test:extension` runs passed VS Code 1.95.0 with exit code 0, covering activation responsiveness, continuous file create/modify/rename/delete, branch reconciliation, same-branch HEAD advance, semantic/CPG queries, and both production builds. The isolated runner's failed remote chat-registry fetch is unrelated to Keystone and did not affect assertions.
- `git diff --check` passed. `npx vsce ls` returned ten bounded package entries. Static inspection found one managed child-process spawn with `shell: false`; no LLM/embedding invocation, backend/server, external database/graph/vector store, cloud persistence, credential store, push/deploy action, or new dependency. Runtime dependencies remain only React, React DOM, and Zod.

Additional files created by the hardening pass:

- `src/core/execution/ExecutionAnalysisServices.ts`
- `src/core/validation/ValidationProviders.ts`
- `tests/unit/execution/AdvancedExecutionValidation.test.ts`

Additional files modified by the hardening pass:

- `PLANS.md`
- `src/shared/contracts/delegation.ts`
- `src/shared/contracts/execution.ts`
- `src/shared/contracts/messages.ts`
- `src/core/persistence/ExecutionPersistenceStore.ts`
- `src/core/copilot/DelegationService.ts`
- `src/core/execution/TaskExecutionService.ts`
- `src/core/execution/CompletionService.ts`
- `src/core/validation/TaskValidationService.ts`
- `src/core/workflows/DevelopmentWorkflowService.ts`
- `src/extension/extension.ts`
- `src/extension/intelligence/VsCodeRepositoryMonitor.ts`
- `src/extension/webview/WebviewMessageRouter.ts`
- `src/ui/components/execution/ExecutionValidationWorkspace.tsx`
- `tests/unit/execution/ExecutionValidation.test.ts`
- `tests/unit/workflows/DevelopmentWorkflowService.test.ts`

No file was deleted and no dependency was added by the hardening pass.

### Recommended next single milestone

Milestone 12 — Git workflow, deterministic review/commit planning, and explicitly user-approved PR delivery. This approved milestone supersedes the earlier conservative no-mutation recommendation while retaining the prohibitions on deployment, task handoff, multi-user management, and autonomous sequential execution.

## Milestone 12 — Git Workflow, Commit Planning, and Pull-Request Delivery

### Entry gate — 2026-07-16

- [x] Re-read the approved product/architecture/data/validation/decision documents and Intelligence architecture, ontology, ingestion, storage, query, UI, gap, and delivery documents.
- [x] Run the prerequisite gate: `npm run verify` passed typecheck, lint, 35 test files/284 tests, extension production build, semantic-worker build, and React Webview build.
- [x] Confirm completed execution sessions, evidence-backed validation, explicit completion, retry preservation, non-automatic dependency unlock, workflow reports, and claim/evidence separation remain implemented and tested.
- [x] Audit existing Git integration. `VsCodeGitAdapter` exposes read-only metadata/change observation only; no commit-plan, staging, mutation, PR provider, or delivery persistence service exists to reuse.

### M12.1 — Typed delivery state, capability adapters, and persistence

- [x] Add bounded versioned Git capability, repository state, diff, change-set, commit-plan, mutation approval/result, PR capability/draft/result, and delivery-report contracts.
- [x] Extend the stable internal Git adapter with supported VS Code Git API operations and an isolated controlled Git-executable fallback; sanitize remotes and fail closed on unsupported capabilities.
- [x] Add atomic local delivery persistence without credentials, tokens, unbounded diffs, or credential-bearing remote URLs.

### M12.2 — Readiness, review, and deterministic commit planning

- [x] Build source-control readiness from completed workflow/task/validation state, branch/repository state, conflicts, attribution, sensitive/generated/binary policy, dependencies, schema/migration, tests, and documentation evidence.
- [x] Construct fingerprinted reviewed change sets with expected-by-default inclusion and ambiguous, unrelated, sensitive, generated, and binary exclusions/diagnostics.
- [x] Add deterministic task/dependency/category-aware commit grouping, editable conventional/plain/repository-detected messages, and merge/split/reorder/move/single-commit operations.

### M12.3 — Explicit Git mutations and failure recovery

- [x] Require a separate persisted explicit approval for stage, unstage, branch creation, each commit, push, and PR creation; revalidate fingerprints and repository state immediately before execution.
- [x] Verify staged content and actual commit files/hashes, preserve remaining changes and plans, classify post-mutation verification failures as uncertain, and prohibit force push, hard reset, clean, amend, rebase, ref updates, destructive checkout, and branch/remote deletion.
- [x] Add branch and push readiness, behind/non-fast-forward/conflict/detached/wrong-branch blocking, safe feature-branch naming, optional upstream setup, and result verification without pull/rebase/merge automation.

### M12.4 — PR providers, focused UI, and completion gate

- [x] Add capability-driven provider registry with supported GitHub integration only when proven, deterministic template-preserving PR drafts, validation/risk/review guidance, direct/assisted/clipboard modes, duplicate prevention, and bounded tracking.
- [x] Add typed cancellable host requests/events and a focused Delivery workspace for readiness, grouped review, lazy bounded diffs, commit planning, explicit approvals/actions, PR drafting, results, and recovery.
- [x] Add domain, adapter, mutation-safety, persistence/reload, Webview/UI, no-automation/no-secret/no-destructive-action tests and run the full verification/extension/package/static audit.

### Milestone 12 completion record — 2026-07-16

Keystone now has a local deterministic delivery layer from completed workflow evidence through reviewed change selection, commit planning, Git mutations, and PR preparation. `DeliveryCoordinator` composes capability, repository-state, readiness, change-set, commit-plan, approval, mutation, PR-provider, draft, validation, tracking, diagnostics, and report services. Versioned state is written atomically to `workflow/delivery-state.json`; corrupt data is quarantined, credentials and complete diffs are not persisted, and every mutation approval is bounded, fingerprinted, single-use, and retained with its sanitized result.

The production adapter prefers documented built-in VS Code Git API methods when the active repository and exact operation are present. Read/state, unstage, bounded diff, history, and any unavailable mutation use an isolated `execFile("git", args)` fallback with `shell: false`, fixed argument construction, repository-bound paths, a minimal environment, timeouts, output bounds, secret/control-character redaction, and post-operation verification. No interface exposes force push, reset, clean, amend, rebase, arbitrary ref updates, destructive checkout, or deletion of branches/remotes.

Readiness is derived from approved/current specification state, completed tasks, retained validation runs and criteria, blocking findings, branch/operation/conflict state, attribution, sensitive-file policy, remote availability, upstream divergence, and schema/migration test warnings. A change set combines Git base-to-HEAD and working/index state with execution attribution and canonical sensitive/generated classification. Only expected/related, non-sensitive, non-generated, non-binary files are included by default; explicit review changes the fingerprint and invalidates earlier approval identity. Staging rejects every path outside the included reviewed set.

Commit plans group schema/migrations before implementation/tests, then documentation and build configuration. Repository commit subjects are sampled at a hard limit of 50 to select conventional/repository or plain formatting deterministically; the confidence/evidence count is exposed in plan diagnostics. Every proposal retains task, requirement, criterion, validation, risk, and file traceability. Users can edit messages, merge, split, reorder, move files, or collapse to one commit. A commit runs only when its exact proposal is approved and its exact files—and no extra files—are staged. HEAD hash and actual committed files are verified and recorded; remaining proposals stay available. A command that may have succeeded but cannot be verified is `uncertain`, never silently failed/retried.

PR capability detection is fail-closed. The GitHub provider reports direct creation only when an injected supported provider method exists; the current production VS Code adapter proves assisted `pr.create` only when that command is actually registered. Otherwise the reviewed title/body is copied through VS Code's clipboard API and remains `awaiting-external-creation`. Repository PR templates are discovered locally and preserved ahead of the deterministic summary, scope, validation, API/schema, risk, review guidance, and traceability sections. Duplicate direct/assisted creation is suppressed by draft/result identity. No provider authentication token is read or stored, and Keystone does not report a direct PR as created without a provider result (or an explicit external confirmation record).

The Delivery Webview exposes Git capability/state, readiness blockers/warnings, expected-vs-observed files, per-file lazy 50,000-byte diffs with truncation, inclusion decisions, editable commit plans, per-proposal staging/commit actions, branch creation, push, PR draft review/approval, provider result, and limitation text. Read-only diffs are cancellable. Mutating operations intentionally are not interrupted midway; each requires a dedicated user action ending in an ellipsis and a typed payload with `confirm: true`.

Final validation commands and outcomes:

- Prerequisite `npm run verify`: passed typecheck, lint, 35 test files/284 tests, extension/semantic-worker production builds, and React production build.
- Final `npm run verify`: passed typecheck, lint, 38 test files/313 tests, the 1.3 MB extension and 10.3 MB semantic-worker production builds, and the React production build (433.05 KB/116.91 KB gzip JavaScript; 29.69 KB/6.01 KB gzip CSS).
- `npm run test:extension`: passed on VS Code 1.95.0 outside the filesystem sandbox; the runner logged only the known unavailable remote chat-registry fetch.
- `npx vsce ls`: reported the expected nine bounded package entries. `git diff --check` passed.
- Static delivery-scope review found no `shell: true`, LLM/embedding path, external database/vector/graph store, backend server, force/reset/clean/amend/ref-update/deletion command, deployment command, or persisted credential/token.

Created for Milestone 12:

- `src/shared/contracts/delivery.ts`
- `src/core/persistence/DeliveryPersistenceStore.ts`
- `src/core/delivery/GitDeliveryService.ts`
- `src/extension/git/GitDeliveryAdapter.ts`
- `src/extension/git/VsCodeGitDeliveryAdapter.ts`
- `src/ui/components/delivery/DeliveryWorkspace.tsx`
- `tests/unit/delivery/GitDeliveryService.test.ts`
- `tests/integration/GitDeliveryAdapter.test.ts`
- `tests/ui/DeliveryWorkspace.test.tsx`

Modified for Milestone 12:

- `PLANS.md`
- `src/shared/contracts/domain.ts`
- `src/shared/contracts/messages.ts`
- `src/extension/extension.ts`
- `src/extension/webview/WebviewMessageRouter.ts`
- `src/ui/App.tsx`
- `src/ui/services/HostBridge.ts`
- `src/ui/styles/global.css`

No file was deleted and no dependency was added for Milestone 12.

Explicit limitations: production direct PR creation, authentication state, reviewer/label mutation, and remote status tracking remain unavailable because VS Code 1.95 exposes no proven supported authenticated provider API in this environment. GitHub assisted creation depends on the installed provider registering `pr.create`; clipboard mode never claims remote creation. Unstage uses the controlled Git executable because a supported built-in Git API for index-only restore is not proven. Hunk staging, multi-root delivery (the first workspace root is selected), fetch/pull/merge/rebase, remote-branch enumeration, automatic non-fast-forward repair, submodule mutation, signing-policy management, provider comments/checks, and automatic rollback are unsupported. Binary, symlink, and submodule changes are explicitly classified and excluded by default; binary diff bodies are not rendered. Readiness uses deterministic structural schema/migration/test evidence; it does not prove semantic compatibility or production deploy safety.

### Recommended next single milestone

Milestone 13 — deterministic OKF projection from the canonical evidence-backed graph and completed query/delivery facts. Do not begin final Intelligence UI redesign, repository-wide taint analysis, autonomous multi-task execution, deployment, or multi-user workflow management.

## Milestone 13 — Task Handoff and Team Workflow

The product owner explicitly authorized this milestone after Milestone 12, superseding the earlier recommendation to begin OKF next. Repository branding and existing service names remain Keystone; portable artifacts use the requested `.buildwise-handoff.json` convention for interoperability.

### Entry gate — 2026-07-16

- [x] Re-read `AGENTS.md`, the current plan, the product, architecture, data, Intelligence/context, Copilot, implementation, validation, decision, and handoff requirements.
- [x] Run `npm run verify`: typecheck, lint, 38 test files/313 tests, extension/semantic-worker production builds, and React production build passed.
- [x] Reconfirm reviewed change sets/commit plans, explicit stage/commit/push/PR confirmation, sensitive/unrelated exclusion, atomic delivery persistence, honest provider capabilities, redaction, and non-fabricated results.
- [x] Inspect existing scaffolding. No participant, assignment, ownership, handoff-package, reconciliation, portable exchange, progress, audit, or Team UI implementation exists to reuse; existing workflow/context/execution/validation/delivery stores remain authoritative inputs.

### M13.1 — Team, assignment, ownership, audit, and persistence

- [x] Add strict versioned bounded participants, capabilities, assignments, ownership, audit, progress, handoff package, import/export, reconciliation, attachment-reference, and persistence contracts.
- [x] Add atomic restart-safe team persistence with corrupt-state quarantine, bounded histories, recovery markers, and no credentials, tokens, hidden authentication, or chat transcript storage.
- [x] Implement participant configuration, capability guidance, assignment eligibility/lifecycle, explicit acceptance/rejection/clarification, single-primary-owner enforcement, reassignment, audit, and durable stage/count progress.

### M13.2 — Handoff package, validation, privacy, and exchange

- [x] Build deterministic bounded packages from immutable intent/workflow/spec/task snapshots plus referenced context, execution, validation, delivery, repository, Intelligence, blocker, question, and changed-file evidence.
- [x] Fingerprint canonical package content and validate schema/version, identity, duplicates, traversal/URI/executable/secret/size rules, state transitions, and required references before export/import/acceptance. Attachment references fail closed because attachment-body exchange is not yet enabled.
- [x] Add explicit JSON and deterministic single-entry ZIP export/import, reduced-fidelity clipboard summary, and opt-in `.buildwise/handoffs/` repository artifact without automatic commit, patch application, or repository mutation.

### M13.3 — Reconciliation and continuity

- [x] Classify exact, compatible, ahead, behind, diverged, wrong-branch, wrong-repository, missing-commits, and unknown repository compatibility without automatic Git synchronization.
- [x] Reconcile specification revision, Intelligence generation, canonical entities, changed files, context fingerprints/pins, execution history, validation reuse/provider assumptions, delivery references, and unavailable local changes with explicit diagnostics.
- [x] Require receiver review/acceptance, create/import the bounded local continuation task instead of reusing hidden Copilot state, preserve sender history, stale invalid evidence, and support read-only/rejected/QA/reviewer/developer transfers.

### M13.4 — Typed host/UI integration and completion gate

- [x] Add every requested typed bounded request/event, cancellation boundaries for import analysis, safe file-dialog adapters, and a focused Team workspace for participants, assignments, handoff preparation/privacy/preview/import/comparison/acceptance, progress, blockers, and audit.
- [x] Add domain, lifecycle, tamper/security/size, exact/ahead/behind/diverged/wrong-repository, continuity, persistence/restart, exchange, Webview/UI, no-credential/no-Git-mutation/no-fabrication tests. Attachment bodies remain a documented fail-closed limitation rather than a fabricated test claim.
- [x] Run full verification, VS Code extension tests, production builds, package inspection, diff/static security audit, record performance/limits/files/unsupported synchronization, and recommend but do not start the next milestone.

### Milestone 13 completion record — 2026-07-16

Keystone now provides a complete local assignment-to-continuation path. `TeamWorkflowService` composes participant, eligibility, assignment, ownership, package, validation, import/export, reconciliation, acceptance, reassignment, progress, and audit services. Participant identity is always `self-asserted-local`; capabilities are deterministic guidance, not authenticated authorization. A task has one active primary owner, assignment starts at `awaiting-acceptance`, and only the intended participant can accept, reject, or request clarification. Active reassignment requires a matching handoff package. Canonical workflow/repository/Intelligence drift makes active ownership stale and clears it rather than silently continuing.

The handoff package is strict, bounded, versioned, and SHA-256 fingerprinted over stable-key canonical JSON. It contains full immutable intent/specification/task snapshots, the assignment and current repository reference, progress/blockers/questions, bounded context references, and available execution, validation, delivery, changed-file, and changed-entity summaries. It does not duplicate source trees, embed executable patches, transfer Copilot hidden state, or assume local uncommitted files exist elsewhere. Package construction and export both revalidate schema, fingerprint, size, safe paths, expiry, and secret-like patterns.

JSON and deterministic uncompressed ZIP exchange are supported. ZIP import permits exactly one root `handoff.json`, verifies CRC and central-directory entry count, and rejects compression, encryption, traversal, truncation, and multiple entries. Import persists a `validating` recovery record, marks failure/cancellation explicitly, rejects duplicate live imports, imports the intended receiver as clearly sourced local metadata when needed, and never changes repository content. Clipboard export is explicitly reduced fidelity. Repository artifact export is disabled by default, enabled only by `keystone.team.repositoryArtifactsEnabled`, and confined to `.buildwise/handoffs/`; Keystone never stages or commits it.

Reconciliation checks repository identity, branch, exact fingerprint, HEAD, relevant-file fingerprints, specification identity/revision, receiver task presence, Intelligence generation, canonical entity resolution, and provider versions. The controlled read-only Git comparison uses local commit objects to classify `ahead`, `behind`, `diverged`, or `missing-commits`; it performs no fetch, pull, checkout, merge, rebase, reset, or patch application. Results retain differences, stale/reusable contexts, reusable/invalid validation runs, unresolved entities, required actions, limitations, and measured duration. Active acceptance is limited to exact/compatible/non-conflicting-ahead states. Read-only and rejected decisions remain available for unsafe states.

Receiver acceptance imports a missing bounded workflow/task snapshot, creates a new local accepted assignment, records `continuationSessionRequired: true`, and rebuilds current canonical context when possible. That context remains unreviewed, and no delegation or execution starts automatically. Sender package/history remains immutable. Progress derives local task/assignment counts, blockers, stale/unassigned/due items, handoffs, and freshness; audit records every lifecycle decision with its local identity assurance, reason, evidence references, and timestamp.

Final commands and outcomes:

- Entry `npm run verify`: passed typecheck, lint, 38 test files/313 tests, extension/semantic-worker production builds, and React production build.
- Focused team/security/exchange/Git/UI/contract suites: passed 30 tests before the final stale-ownership addition; the final full suite includes all additions.
- Final `npm run verify`: passed typecheck, lint, 40 test files/327 tests, the 1.4 MB extension bundle, 10.3 MB semantic worker, and React build (458.12 KB/122.15 KB gzip JavaScript; 29.69 KB/6.01 KB gzip CSS).
- `npm run test:extension` initially terminated with `SIGABRT` when Electron was confined by the filesystem sandbox. The approved out-of-sandbox rerun and final post-hardening run both passed on VS Code 1.95.0 with exit code 0. The runner logged only the known unavailable remote chat-registry fetch and an Electron utility-process shutdown message after the successful exit.
- `npx vsce ls` listed the expected bounded package entries. `git diff --check` passed. Static team-scope review found no shell execution, LLM/embedding path, backend/server, external database/vector/graph store, credential/token persistence, automatic Git mutation, or repository synchronization path.

Package limits are 1,000,000 JSON bytes, 50 attachment references, and 5,000,000 declared attachment bytes; actual attachment bodies currently fail closed. Histories are bounded to 200 packages, 500 imports/exports/reconciliations/acceptances/reassignments/progress snapshots, 2,000 assignments, 500 participants, and 2,000 audit entries by default. Fixture package generation and reconciliation are instrumented with `performance.now()` and tested below 500 ms each; final local unit/UI integration completed in 4.90 seconds. These are development-fixture observations, not repository-wide performance guarantees.

Created for Milestone 13:

- `docs/09-team-workflow.md`
- `src/shared/contracts/team.ts`
- `src/core/persistence/TeamWorkflowPersistenceStore.ts`
- `src/core/team/HandoffSecurity.ts`
- `src/core/team/TeamWorkflowService.ts`
- `src/extension/team/VsCodeTeamArtifactAdapter.ts`
- `src/ui/components/team/TeamWorkflowWorkspace.tsx`
- `tests/unit/team/TeamWorkflowService.test.ts`
- `tests/ui/TeamWorkflowWorkspace.test.tsx`

Modified for Milestone 13:

- `PLANS.md`
- `package.json`
- `src/shared/contracts/domain.ts`
- `src/shared/contracts/messages.ts`
- `src/core/workflows/DevelopmentWorkflowService.ts`
- `src/extension/extension.ts`
- `src/extension/git/GitDeliveryAdapter.ts`
- `src/extension/git/VsCodeGitDeliveryAdapter.ts`
- `src/extension/webview/WebviewMessageRouter.ts`
- `src/ui/App.tsx`
- `src/ui/services/HostBridge.ts`
- `tests/integration/GitDeliveryAdapter.test.ts`
- `tests/unit/contracts.test.ts`

No file was deleted and no dependency was added for Milestone 13.

Unsupported synchronization remains explicit: enterprise authentication/authorization, organization administration, cloud sync, real-time presence, chat, automatic task assignment, remote Git discovery without local objects, fetch/pull/merge/rebase/reset/checkout, automatic Git or patch synchronization, automatic delegation/execution, deployment, and production monitoring. Optional attachment bodies and hashes are not exchanged yet; attachment metadata is rejected until independently verified bodies are supported. Exact remote freshness and human identity assurance are never fabricated.

### Recommended next single milestone

Milestone 14 — deterministic OKF projection from canonical Intelligence and completed query/workflow evidence. Do not begin final Intelligence UI redesign, autonomous multi-task execution, cloud collaboration, or deployment.

## Superseded experiments removed by scope correction

A local Business Unit Hub experiment and an incomplete local-model/LoRA experiment were removed on 2026-07-16. They are not active or completed milestones, and no runtime, worker, process adapter, contract, route, persistence store, setting, navigation item, UI, build artifact, test requirement, dependency, estimate, or release criterion remains for either capability.

The pre-deletion inventory and removal evidence are retained in the scope-correction audit below. Only concise conceptual notes remain in the future roadmap; implementation details would require a separately approved milestone.
## Scope-correction audit — 2026-07-16

This audit was completed before deleting future-only runtime code. The product owner has removed the Business Unit Intelligence Hub and local-model/LoRA capabilities from the active implementation and release progression. Their concepts remain future-roadmap notes only.

### Reference inventory and classification

**A — Remove completely: Hub-only runtime and UI**

- `docs/10-business-unit-hub.md`
- `src/shared/contracts/hub.ts`
- `src/core/hub/HubService.ts`
- `src/core/hub/HubPublicationProjection.ts`
- `src/core/hub/workerEntry.ts`
- `src/core/persistence/HubPersistenceStore.ts`
- `src/extension/hub/HubCoordinator.ts`
- `src/extension/hub/HubWorkerHost.ts`
- `src/ui/components/hub/HubWorkspace.tsx`
- `tests/unit/hub/HubService.test.ts`
- `tests/ui/HubWorkspace.test.tsx`

Hub-only references must also be removed from `package.json`, `scripts/build-extension.mjs`, `src/extension/extension.ts`, `src/extension/webview/WebviewMessageRouter.ts`, `src/shared/contracts/domain.ts`, `src/shared/contracts/messages.ts`, `src/ui/App.tsx`, `src/ui/services/HostBridge.ts`, `src/ui/styles/global.css`, `tests/unit/contracts.test.ts`, and `tests/unit/webview/WebviewMessageRouter.test.ts`.

**A — Remove completely: local-model/LoRA runtime and UI**

- `src/shared/contracts/localModels.ts`
- `src/core/localModels/LocalModelService.ts`
- `src/core/persistence/LocalModelPersistenceStore.ts`
- `src/extension/localModels/LocalModelProcessAdapter.ts`
- `src/ui/components/models/LocalModelsWorkspace.tsx`
- `tests/unit/localModels/LocalModelService.test.ts`

Local-model-only references must also be removed from `src/extension/extension.ts`, `src/extension/webview/WebviewMessageRouter.ts`, `src/shared/contracts/domain.ts`, `src/shared/contracts/messages.ts`, `src/ui/App.tsx`, and `src/ui/services/HostBridge.ts`. No package dependency was added for Hub or model work; MLX-LM and Ollama were discovered host executables, not package dependencies.

**B — Preserve and rename/simplify**

- Current Copilot agent capability matching, provider registry, deterministic context selection, validation providers, and delivery provider registry are valid generic abstractions. They remain, but no fallback or field may reference a Hub, local model, adapter, dataset, checkpoint, or hybrid route.
- Add a small current-scope execution-routing contract/service with only `deterministic`, `github-copilot`, `manual`, and `unsupported` outcomes. It must not depend on future provider abstractions.
- Optional handoff attachment/reference metadata remains generic and local; it is not a Hub dependency.

**C — Preserve unchanged**

- Repository Intelligence, continuous ingestion, semantic graph, CPG, repository adapters, query/analysis, OKF projection, local generation storage, React Intelligence UI, intent/specification/task/context workflows, Copilot discovery/delegation, execution/validation/completion, Git/PR delivery, and Task Handoff.
- Shared atomic writing, worker management, evidence/provenance, policy validation, capability detection, context compression, and team-workflow persistence are independently required by current features.

**D — Move to future roadmap/documentation only**

- Business Unit Intelligence Hub, cross-product reusable intelligence/publication/search, centralized pattern/integration discovery, local inference, LoRA datasets/training/evaluation/adapters, organization-specific adaptation, and hybrid local-model/Copilot routing.

### Active dependencies, optional dependencies, and placeholders

- Active Hub dependencies: activation/DI registration, Hub worker build, typed Webview routes/events/results, React navigation/page, `keystone.hub.enabled`, Hub persistence/cache, and Hub tests.
- Active local-model dependencies: activation/DI registration, child-process runtime discovery, hardware profiling, model/dataset/training/evaluation/routing schemas and routes, React navigation/page, extension-global persistence, and local-model tests.
- Optional dependency to remove: none in `package.json`; no Hub server/database/search package and no model/training package is installed.
- Placeholder-only references: none should remain in active navigation, settings, contracts, or release criteria.
- Documentation-only references after cleanup: the concise future-roadmap section and explicit migration/cleanup history only.

### Removal risks and cleanup order

1. Record this audit and capture baseline bundle/test state.
2. Remove Hub/model activation, DI, worker build, configuration, message contracts, routes, HostBridge validation, navigation, UI, styles, and exclusive tests.
3. Delete exclusive runtime/contracts/persistence/UI/test files; retain all shared current-scope services.
4. Add deterministic current-scope routing and migration cleanup that archives obsolete global-storage directories without touching workflow/intelligence state.
5. Correct the 16-milestone active progression, documentation diagrams/status/counts, README/product summary, and future roadmap.
6. Run contract/routing/migration/current-feature tests, full verification, extension tests, package/bundle inspection, dependency audit, and forbidden-reference searches.

Primary risks are stale discriminated-union members, router exhaustiveness failures, dead worker build output, obsolete navigation state (`hub`/`models`), and existing development-profile global-storage records. Navigation migration falls back safely to Intelligence; obsolete Hub/model directories are archived best-effort and never block activation; unrelated workspace workflow and Intelligence stores are not migrated or rewritten.

## Corrected active implementation progression

This table is the sole active milestone numbering and status authority. Earlier numbered sections are detailed execution/completion records for the corresponding capability; the two explicitly superseded experiment sections above are history only.

| # | Active milestone | Status | Release dependency |
|---:|---|---|---|
| 1 | Repository Intelligence foundation | Complete | — |
| 2 | Continuous ingestion | Complete | 1 |
| 3 | Semantic graph | Complete | 2 |
| 4 | Progressive CPG | Complete | 3 |
| 5 | Repository adapters | Complete | 4 |
| 6 | Query and analysis engine | Complete | 5 |
| 7 | OKF projection | Partial; not complete | 6 |
| 8 | Complete Intelligence UI and hardening | Partial; not complete | 7 |
| 9 | Intent capture and specification workflow | Complete | 8 release gate remains open |
| 10 | Copilot agent discovery, context construction, and controlled delegation | Complete | 9 |
| 11 | Execution tracking, validation, retry, and completion | Complete | 10 |
| 12 | Git and PR delivery | Complete | 11 |
| 13 | Task Handoff and team workflow | Complete | 12 |
| 14 | AI-driven SDLC orchestration | Complete for controlled, approval-gated coordination | 7–13 |
| 15 | Product integration and end-to-end hardening | Not started | 14 |
| 16 | Release readiness and pilot validation | Not started | 15 |

Four active milestones remain incomplete: 7, 8, 15, and 16. Existing work in milestones 9–14 remains preserved and tested, but release readiness cannot close until the earlier OKF/UI gates and later integration/hardening gates are complete.

```mermaid
flowchart LR
  M1["1 Repository Intelligence foundation"] --> M2["2 Continuous ingestion"] --> M3["3 Semantic graph"] --> M4["4 Progressive CPG"] --> M5["5 Repository adapters"] --> M6["6 Query and analysis engine"] --> M7["7 OKF projection"] --> M8["8 Complete Intelligence UI and hardening"] --> M9["9 Intent and specification"] --> M10["10 Copilot context and controlled delegation"] --> M11["11 Execution and validation"] --> M12["12 Git and PR delivery"] --> M13["13 Task Handoff"] --> M14["14 AI-driven SDLC orchestration"] --> M15["15 Product integration and hardening"] --> M16["16 Release readiness and pilot"]
```

Production Observability and Incident Intelligence is optional post-pilot work and is not on the critical path.

### Next active milestone

Milestone 15 — product integration and end-to-end hardening across the implemented Intelligence and workflow surfaces. Milestones 7–8 remain explicit open release gates and must be closed within that integration progression before pilot readiness.

## Future Roadmap — Not Part of Current Implementation

### Business Unit Intelligence Hub

A future optional capability for publishing approved reusable intelligence across products and teams.

### Local Model and LoRA Adaptation

A future optional capability for approved local inference, organization-specific adapters, and hybrid routing.

These capabilities are intentionally excluded from the current implementation, release scope, dependencies, acceptance criteria, estimates, runtime contracts, persistence, UI, settings, and release-readiness criteria.

## Scope-correction completion record — 2026-07-16

The active product now contains no Hub or local-model/LoRA execution path. Activation, dependency injection, workers and child processes, typed messages, routes, settings, navigation, UI, persistence, build entries, and exclusive tests were removed. Shared Intelligence, workflow, Copilot, validation, delivery, and Task Handoff capabilities were preserved.

Current-scope operation routing is deterministic and centrally typed: canonical Intelligence operations use `deterministic`; approved implementation delegation can use `github-copilot` when available; Git delivery remains `manual`; everything else is `unsupported`. No local-model, dataset, checkpoint, training, evaluation, or hybrid fallback participates in routing.

Persistence cleanup is bounded and non-destructive. Existing workspace state whose active section is `hub` or `models` migrates to `intelligence` while preserving workflow count and advancing its revision. Obsolete extension-global `hub` and `local-models` directories are renamed best-effort to timestamped `retired-roadmap-*` archives. Missing directories are a no-op, migration diagnostics do not block activation, and workflow/Intelligence generations are never rewritten.

### Validation and audit outcomes

- `npm run verify`: passed type checking, linting, 43 test files/341 tests, extension and semantic-worker production builds, and React production build.
- `npm run test:extension`: the sandboxed Electron launch reproduced `SIGABRT`; the approved out-of-sandbox run passed on VS Code 1.95.0 with exit code 0.
- `npm ls --all --depth=0`: passed; no Hub/model dependency existed, so none was removed and no lockfile regeneration is required.
- `npm audit --omit=dev --offline`: could not execute because the repository intentionally has no lockfile (`ENOLOCK`). This is an explicit audit limitation, not a reported clean vulnerability scan.
- `npx vsce ls`: passed; the package contains the extension bundle, semantic worker, Webview, manifest/docs, and icon only. There is no Hub/model worker or asset.
- `git diff --check`: passed.
- Final active-source and built-bundle searches found no Hub/model service, API, publication, artifact, runtime, training, evaluation, dataset, MLX, Ollama, llama.cpp, LoRA, or hybrid-routing implementation. The only literal obsolete navigation/storage names in runtime output belong to the bounded migration described above.

### Bundle impact

- Hub worker: 642.3 KB baseline to absent, a 642.3 KB reduction.
- Webview JavaScript: 484.73 KB/127.65 KB gzip baseline to 458.77 KB/122.32 KB gzip, reductions of 25.96 KB raw and 5.33 KB gzip.
- Webview CSS: 33.18 KB/6.50 KB gzip baseline to 29.69 KB/6.01 KB gzip, reductions of 3.49 KB raw and 0.49 KB gzip.
- Extension bundle remains approximately 1.4 MB; semantic worker remains approximately 10.3 MB.

### Scope-correction files

Created:

- `docs/10-future-roadmap.md`
- `src/shared/contracts/routing.ts`
- `src/core/workflows/ExecutionRoutingService.ts`
- `src/core/persistence/ScopeCorrectionMigration.ts`
- `tests/unit/workflows/ExecutionRoutingService.test.ts`
- `tests/unit/persistence/ScopeCorrectionMigration.test.ts`
- `tests/unit/scopeCorrection.test.ts`

Modified:

- `PLANS.md`
- `README.md`
- `docs/01-product-requirements.md`
- `docs/02-architecture.md`
- `docs/06-implementation-plan.md`
- `docs/07-validation-and-traceability.md`
- `docs/08-decision-log.md`
- `docs/README.md`
- `docs/intelligence/DELIVERY_PLAN.md`
- `package.json`
- `src/shared/contracts/domain.ts`
- `src/shared/contracts/messages.ts`
- `src/core/persistence/WorkspaceStateStore.ts`
- `src/extension/extension.ts`
- `src/extension/webview/WebviewMessageRouter.ts`
- `src/ui/App.tsx`
- `src/ui/services/HostBridge.ts`
- `src/ui/styles/global.css`
- `tests/unit/contracts.test.ts`
- `tests/unit/persistence.test.ts`
- `tests/unit/webview/WebviewMessageRouter.test.ts`

Deleted:

- `docs/10-business-unit-hub.md`
- `src/shared/contracts/hub.ts`
- `src/core/hub/HubService.ts`
- `src/core/hub/HubPublicationProjection.ts`
- `src/core/hub/workerEntry.ts`
- `src/core/persistence/HubPersistenceStore.ts`
- `src/extension/hub/HubCoordinator.ts`
- `src/extension/hub/HubWorkerHost.ts`
- `src/ui/components/hub/HubWorkspace.tsx`
- `tests/unit/hub/HubService.test.ts`
- `tests/ui/HubWorkspace.test.tsx`
- `src/shared/contracts/localModels.ts`
- `src/core/localModels/LocalModelService.ts`
- `src/core/persistence/LocalModelPersistenceStore.ts`
- `src/extension/localModels/LocalModelProcessAdapter.ts`
- `src/ui/components/models/LocalModelsWorkspace.tsx`
- `tests/unit/localModels/LocalModelService.test.ts`

No dependency was added, removed, or changed for this correction. Remaining Hub/model references are limited to this audit/removal history, the bounded migration literals, and the concise future roadmap. The next active work remains Milestone 7; it has not been started by this correction.

## Milestone 14 — AI-Driven SDLC Orchestration

### Entry audit — 2026-07-16

This milestone is explicitly authorized by the product owner after the scope correction. It does not complete or relabel the still-partial Milestones 7–8. The orchestration layer coordinates the already implemented Intelligence, intent/specification/task, context, Copilot delegation, execution/validation/completion, delivery, and Task Handoff boundaries; it must not duplicate their canonical behavior.

- [x] Re-read `AGENTS.md`, the latest plan, and all current Keystone documentation.
- [x] Run `npm run verify`: type checking, linting, 43 test files/341 tests, extension/semantic-worker builds, and the React production build passed.
- [x] Confirm active source, settings, routes, scripts, and dependencies contain no Hub service/publication/artifact or local-model/LoRA/training/dataset/evaluation/hybrid-model runtime.
- [x] Confirm obsolete navigation/storage migration, corrected 16-milestone progression, Task Handoff, deterministic canonical Intelligence, and capability-proven GitHub Copilot-only implementation delegation remain implemented and tested.
- [x] Audit the old `WorkflowOrchestrator`: it is an in-memory scaffold with an invalid pause model, arbitrary completion, no durable orchestration instance, no stage/gate/readiness/scheduling/recovery/audit model, and no production wiring. It will not be extended as authoritative orchestration state.

### M14.1 — Durable orchestration domain and policy

- [x] Add versioned bounded workflow instances, definitions, policy profiles, stages, task state, approval gates, findings, review plans, scheduling decisions, progress, metrics, audit, and diagnostics.
- [x] Add an explicit state machine with source/prerequisite validation, atomic persistence, audit, and typed events; arbitrary Webview status assignment is prohibited.
- [x] Provide quick-fix, feature, bug-fix, refactoring, modernization, and security-remediation definitions plus manual, guided, and approval-gated policy profiles. No autonomous mode.

### M14.2 — Planning, readiness, scheduling, reviews, and recovery

- [x] Build executable plans from approved specifications/task graphs and expose stages, dependencies, routes, capabilities, validation, retry rules, gates, optional-stage reasons, and delivery boundary.
- [x] Add structured readiness and conflict analysis, dependency/risk/priority scheduling, parallel read-only work, serialized writes, and fail-closed unknown conflicts.
- [x] Coordinate context/delegation/execution/validation state through persisted references; add QA, conditional security/performance, documentation, retry/repair, pause/resume/cancel/recovery, delivery readiness, progress, audit, diagnostics, and bounded metrics.

### M14.3 — Typed host and focused React workspace

- [x] Add bounded validated orchestration requests/events without accepting shell text, credentials, arbitrary transitions, Git mutations, or hidden provider routes.
- [x] Add a focused Orchestration workspace covering overview, plan/task graph, active work, QA/security/performance/validation, findings, approvals, delivery, history, diagnostics, and policy; include an accessible task list.

### M14.4 — Completion gate

- [x] Add state-machine, definition/policy, readiness/dependency/staleness, routing, conflict/scheduling, approval, review-trigger, retry-limit, pause/resume/cancel/recovery, persistence/migration, audit/metrics, bounded-contract, and UI tests.
- [x] Run full verification, extension-host tests, package/bundle inspection, forbidden-reference searches, diff review, and document only implemented behavior and explicit limitations.

### Milestone 14 completion record — 2026-07-16

Status: **Complete for controlled, approval-gated orchestration in one VS Code workspace and working tree.** Milestones 7–8 remain incomplete release gates. No autonomous mode, hosted service, Hub, local model, training, deployment, or automatic Git delivery was introduced.

`OrchestrationService` persists a bounded workflow projection and coordinates authoritative development workflow and routing facts. `WorkflowStateMachine` owns the explicit transition table; only service actions can transition state. Every persisted mutation is schema-validated, atomically written, audited, and reflected through typed host events. Six definitions and manual/guided/approval-gated profiles expose their stages, optional-stage reasons, gates, retry limits, concurrency rules, and delivery boundary before start.

Planning requires an approved current specification and ready cycle-free task graph. The scheduler orders by dependencies, priority, and risk. Read-only work may overlap; code-writing work is serialized. Shared file/entity and unknown overlap fail closed. Readiness rechecks approval, dependency completion, staleness, repository/branch/Intelligence compatibility, criteria, validation steps, route, Copilot agent, and gates. Routes remain deterministic, GitHub Copilot, manual, or unsupported only.

QA, security, performance, documentation, and validation plans are deterministic relevance projections. They never claim that Copilot output is evidence, that a passing test proves intended behavior, that security is complete, or that performance improved without measurement. Task completion requires validation references and no open blocking finding. Retries retain failure/validation references, enforce the policy limit, create no automatic delegation, and invalidate context when the agent changes. Dependency unlock only changes readiness; it never runs the next task.

Pause preserves tasks, selections, fingerprints, baselines, validations, findings, gates, and audit. Restart changes interrupted running/cancelling/recovering instances to paused and explicitly does not infer completion. Resume/recovery compares repository, branch, HEAD, and Intelligence generation; drift becomes stale. Cancellation preserves evidence and user changes and leaves Git untouched. Delivery readiness is an evidence decision only; staging, commit, push, and PR creation remain independent existing delivery approvals and cannot be overridden by orchestration.

The React workspace provides overview, plan/stages, an accessible task list, active controls, review categories, findings, approvals, delivery boundary, history/diagnostics, definitions, and policy visibility. Webview requests are bounded and validated; no arbitrary status, shell text, credential, provider, or Git mutation is accepted.

Validation outcomes:

- Entry `npm run verify`: passed typecheck, lint, 43 test files/341 tests, extension/semantic-worker builds, and React build.
- Final `npm run verify`: passed typecheck, lint, 45 test files/354 tests, extension 1.4 MB, semantic worker 10.3 MB, Webview JavaScript 477.03 KB/125.61 KB gzip, and CSS 31.10 KB/6.24 KB gzip.
- `npm run test:extension`: sandbox launch reproduced `SIGABRT`; the first approved run exposed a pre-existing timing-sensitive ingestion observation despite a healthy ready generation, and the immediate approved rerun passed VS Code 1.95.0 with exit code 0.
- `npx vsce ls` passed with the bounded extension, semantic worker, Webview, manifest/docs, and icon only. `git diff --check` passed after whitespace repair.
- Final active-source/bundle search found no Hub service/artifact/publication, local model, LoRA, training job, dataset manifest, model evaluation, or hybrid-model route. Orchestration contains no child process, shell executor, HTTP server, external database, credential access, automatic Git mutation, push, PR creation, merge, or deployment path.

Performance observations are development-fixture measurements: the 354-test suite completed in 5.63 seconds; bounded orchestration tests complete in roughly one second; planning yields before bounded graph work; Webview JavaScript grew 18.26 KB raw/3.29 KB gzip and CSS grew 1.41 KB raw/0.23 KB gzip from the post-scope-correction baseline. These are not production-scale p50/p95 claims.

Created:

- `docs/11-sdlc-orchestration.md`
- `src/shared/contracts/orchestration.ts`
- `src/core/persistence/OrchestrationPersistenceStore.ts`
- `src/core/orchestration/OrchestrationService.ts`
- `src/ui/components/orchestration/OrchestrationWorkspace.tsx`
- `tests/unit/orchestration/OrchestrationService.test.ts`
- `tests/ui/OrchestrationWorkspace.test.tsx`

Modified:

- `PLANS.md`
- `docs/README.md`
- `docs/06-implementation-plan.md`
- `src/shared/contracts/domain.ts`
- `src/shared/contracts/messages.ts`
- `src/extension/extension.ts`
- `src/extension/webview/WebviewMessageRouter.ts`
- `src/ui/App.tsx`
- `src/ui/services/HostBridge.ts`
- `src/ui/styles/global.css`

No file was moved or deleted and no dependency was added. Unsupported behavior remains unrestricted autonomy, concurrent writes in one worktree, automatic delegation, automatic test healing, silent specification revision, automatic finding acceptance, infinite retry, automatic Git mutation/push/PR/merge, deployment, incident remediation, centralized services, Hub execution, local-model execution, and full repository-wide security or performance assurance.

### Recommended next single milestone

Milestone 15 — product integration and end-to-end hardening. Close the remaining Milestones 7–8 OKF/UI release gates while exercising the complete intent-to-delivery workflow across representative repositories. Do not begin pilot/release readiness until those gates and integrated recovery/performance/security validation are complete.

## Milestone 15 — Product Integration and End-to-End Hardening

### Integration audit — 2026-07-16

The audit reviewed activation/DI, events, state ownership, every persistence store/schema, migrations, workers, Webview contracts, React routes/navigation, settings/contributions, Copilot/Git/validation/handoff adapters, orchestration, errors, cancellation, logging, metrics, tests, builds, and package contents. Findings below are reproduced from code, contracts, tests, or production bundles; planning text was not treated as implementation evidence.

#### Completed and correctly integrated

- Repository Intelligence owns canonical repository facts, immutable generations, semantic graph/CPG/adapters/querying, worker execution, source evidence, generation promotion, last-valid reads, incremental/Git reconciliation, cancellation, and bounded UI payloads.
- Intent/specification/task, context/Copilot delegation, execution/validation/completion, delivery, Task Handoff, and controlled orchestration are production-registered behind typed host routes and atomic feature-owned stores.
- Copilot discovery fails closed, Git mutations have separate approvals, validation commands use `spawn` with `shell: false`, Handoff import is bounded and non-executable, and the Webview has strict nonce CSP plus no command URIs or direct repository access.
- Package contributions are intentionally small: one view container/view, Open Control Center and Show Logs commands, current settings, no backend/server/Hub/model worker, and no authentication-dependent normal tests.

#### Verified blockers and integration defects

- **P1 — OKF/UI release gates:** OKF has three dormant mapper/model files only. There is no canonical projection store/service, incremental planner, validator, export, browser, query result, host route, or test. `OKF_CONCEPT` explicitly returns unsupported. The current-product capability list therefore exceeds implementation; Milestones 7–8 remain real release blockers and must be completed as integration repair.
- **P1 — conflicting workflow/task state:** `OrchestrationService` persists writable task status, agent, context, execution, validation, findings, and progress copies independently of the authoritative development/delegation/execution/validation/delivery/team stores. No event/projection reconciler keeps them aligned. This can show false readiness/completion after another feature mutates canonical state.
- **P1 — incompatible repository/staleness models:** delegation, execution, delivery, handoff, and orchestration define different repository snapshots/fingerprints and generic stale states. There is no shared `RepositoryStateRef` or structured staleness reason, so branch/HEAD/generation drift can be classified inconsistently.
- **P0 security boundary — Restricted Mode:** Intelligence correctly blocks deep indexing, but validation/Git mutation/Handoff repository-artifact routes do not have one central workspace-trust gate. A typed Webview request could reach executable or mutating service code in an untrusted workspace. Repair is mandatory before further workflow testing.
- **P1 — activation readiness:** activation awaits workflow, execution, delivery, team, and orchestration persistence before registering the Webview provider. Corrupt or slow optional feature state can delay the entire UI. Startup has no typed progressive stage model and no degraded ready state.
- **P1 — missing integrated workflow harness:** unit/UI/service tests are extensive and extension tests cover Intelligence, but no deterministic fixture drives intent → specification/task → orchestration → context/delegation → execution/validation → completion → delivery/handoff/restart as one state-linked workflow. Cross-store dangling references and false transitions are not currently caught.

#### P2/P3 hardening findings

- **P2 — duplicate obsolete service:** the old in-memory `WorkflowOrchestrator` and its separate domain workflow state machine remain dormant beside the production `OrchestrationService`; this is misleading duplicate ownership.
- **P2 — persistence duplication:** stores share atomic writing but duplicate load/quarantine/update logic and expose no common schema-version registry or integrity report. Optional-record corruption quarantines an entire feature file in several stores.
- **P2 — old product path:** repository Handoff export still requires `.buildwise/handoffs` in contracts, settings, adapter code, filenames, tests, and docs. It must migrate to `.keystone/handoffs` while accepting old persisted settings only for migration.
- **P2 — fragmented navigation:** Intent, Specifications, Tasks, Context, Validation, Delivery, Team, and Orchestration are separate top-level items. Context is task detail, orchestration is Active Workflow, and Team is Task Handoff; current labels expose subsystem structure rather than one workflow.
- **P2 — diagnostics/error experience:** diagnostics are feature-local; there is no consolidated health/recovery/migration/capability view or sanitized report. Error envelopes are structured, but most UI error banners discard correlation ID, preservation, retry safety, and recovery detail.
- **P2 — event consistency:** host events are typed and bounded but do not share a common correlation/repository/workflow/task metadata envelope. Several feature states are refreshed ad hoc, and duplicate-event/idempotency coverage is route-specific.
- **P2 — settings:** `workspaceSpecifications` is configured but has no repository-write implementation; validation/context/workflow settings are read yet not consistently passed into their service policies. Settings without runtime ownership should be removed or wired.
- **P2 — accessibility/performance:** scoped graphs have list alternatives and reduced-motion support, but orchestration's tab strip is non-interactive text, focus restoration/status announcements are incomplete, large workflow/task/approval lists are bounded but not virtualized, and routes are eagerly bundled rather than lazy-loaded.
- **P3 — preview inconsistency:** the development-only HostBridge preview still advertises phase 12 and OKF as next, contradicting production bootstrap phase 14/15.

#### Ownership map

| Concern | Canonical owner |
|---|---|
| Repository facts and generation | `IntelligenceStore` / `IntelligenceRuntime` |
| Intent, specification, task graph | `DevelopmentWorkflowService` |
| Task readiness and workflow projection | `OrchestrationService`, derived from authoritative stores |
| Context package | `TaskContextService` / `DelegationPersistenceStore` |
| Copilot capability and agents | `CopilotAdapter` / `CopilotAgentRegistry` |
| Delegation session | `DelegationService` |
| Execution session | `TaskExecutionService` / `ExecutionPersistenceStore` |
| Validation result and findings | `ValidationOrchestrator` / `ExecutionPersistenceStore` |
| Task completion | `CompletionDecisionService` and authoritative development task state |
| Git repository and delivery state | `DeliveryCoordinator` / `DeliveryPersistenceStore` |
| Handoff state | `TeamWorkflowService` / `TeamWorkflowPersistenceStore` |
| Workflow status, stages, gates, scheduling | `OrchestrationService` as a projection over IDs/revisions |
| UI state | Feature view models plus small `WorkspaceStateStore` navigation state |

#### Release-blocker disposition

- No reproduced data loss, secret leakage, repository corruption, false validation success, credential exposure, or destructive approved-workspace action bypass exists.
- The Restricted Mode mutation gap is classified P0 by policy and will be repaired first.
- OKF/UI completion, canonical staleness/repository state, orchestration projection reconciliation, activation readiness, and integrated workflow coverage are P1 and block Milestone 15 completion.
- P2/P3 items will be resolved where bounded and measurable; any residual item will remain explicit for release-readiness review.

### Integration hardening checkpoint — 2026-07-16

Status: **In progress; not release-complete.** The P0 Restricted Mode defect and several P1/P2 integration defects are repaired and verified. Deterministic OKF projection/browser completion and the full mixed-technology intent-to-delivery harness remain P1 release blockers, so Milestone 15 is intentionally not marked complete.

- [x] Centralize the workspace-trust boundary in `WebviewMessageRouter` for delegation/external-start, execution, validation commands, Git mutations, orchestration execution, PR actions, and repository-artifact Handoff export. Read-only browsing remains available in Restricted Mode and the blocked response is structured/recoverable.
- [x] Add versioned shared `RepositoryStateRef`, structured staleness records/reasons, operation correlation context, startup stages/diagnostics, and a schema-version registry. Context, delegation, execution, and orchestration now carry the common repository reference.
- [x] Prevent orchestration from independently projecting task completion. The authoritative development task overrides completed/stale/cancelled state; missing canonical tasks fail stale, and false completion exposes an explicit blocker.
- [x] Delete the unused in-memory `WorkflowOrchestrator`; `OrchestrationService` is the sole workflow-stage/gate/scheduling owner.
- [x] Migrate the opt-in repository artifact boundary and product-facing Handoff filenames/labels to `.keystone/handoffs` / `keystone-handoff`, while accepting `.buildwise/handoffs` only during one-way persisted-state migration.
- [x] Add progressive typed startup state and record final activation readiness; optional state still initializes before provider registration, so true UI-first activation remains an open P1.
- [x] Consolidate top-level navigation around Intelligence, Intent & Specs, Tasks, Active Workflow, Validation & QA, Delivery, Task Handoff, Diagnostics, and Settings. Intent/Specification and Task/Context retain focused sub-navigation. Add a bounded local health view and correct development/production milestone bootstrap metadata.
- [x] Add regression tests for repository identity/staleness reasons, correlation, startup degradation, legacy Handoff migration, Restricted Mode execution blocking, and authoritative completion projection.
- [ ] Complete and wire deterministic OKF projection, validation, incremental regeneration, export, browsing, query integration, and focused UI tests.
- [ ] Replace remaining orchestration execution/validation/finding copies with a complete read projection over authoritative stores and common correlated events.
- [ ] Register the Webview before optional feature-store restoration and expose progressive/degraded startup state to it.
- [ ] Add realistic TypeScript, JVM, and multi-project fixture repositories plus the complete cross-feature restart/staleness/delivery/Handoff E2E scenario matrix.
- [ ] Finish settings ownership, richer sanitized diagnostic export, focus/status accessibility, lazy route loading, and large-list rendering measurements.

Validation at this checkpoint:

- `npm run verify`: passed type checking, linting, 46 test files/360 tests, extension build, semantic worker build, and React production build.
- Focused integration regression run: 3 files/27 tests passed after the Handoff and projection corrections.
- `npm run test:extension`: sandbox Electron launch reproduced the known `SIGABRT`; the approved out-of-sandbox VS Code 1.95.0 run passed with Extension Host exit code 0.
- `npx vsce ls`: passed and listed only manifest/docs/icon plus extension, semantic worker, and bounded Webview production assets.
- `git diff --check`: passed. Active product code contains no legacy `WorkflowOrchestrator`; `.buildwise/handoffs` remains only in the explicit persisted-state migration and its regression test/documentation.
- Bundle observations: extension 1.4 MB; semantic worker 10.3 MB; Webview JavaScript 481.41 KB / 126.54 KB gzip; CSS 31.10 KB / 6.24 KB gzip. The 360-test suite completed in 5.37 seconds. These are development measurements, not production p50/p95 claims.

Files changed by this checkpoint (in addition to the pre-existing milestone work in the dirty tree):

Created:

- `src/shared/contracts/integration.ts`
- `src/core/integration/ProductIntegrationService.ts`
- `tests/unit/integration/ProductIntegrationService.test.ts`

Modified:

- `PLANS.md`
- `package.json`
- `docs/02-architecture.md`
- `docs/09-team-workflow.md`
- `src/shared/contracts/domain.ts`
- `src/shared/contracts/delegation.ts`
- `src/shared/contracts/execution.ts`
- `src/shared/contracts/orchestration.ts`
- `src/core/context/TaskContextService.ts`
- `src/core/copilot/DelegationService.ts`
- `src/core/execution/TaskExecutionService.ts`
- `src/core/orchestration/OrchestrationService.ts`
- `src/core/persistence/TeamWorkflowPersistenceStore.ts`
- `src/core/team/TeamWorkflowService.ts`
- `src/extension/extension.ts`
- `src/extension/team/VsCodeTeamArtifactAdapter.ts`
- `src/extension/webview/WebviewMessageRouter.ts`
- `src/ui/App.tsx`
- `src/ui/services/HostBridge.ts`
- `tests/unit/orchestration/OrchestrationService.test.ts`
- `tests/unit/webview/WebviewMessageRouter.test.ts`

Deleted:

- `src/core/workflows/WorkflowOrchestrator.ts`

### Actual-user-experience hardening checkpoint — 2026-07-17

Status: **Complete for the reported ingestion, repository-local persistence, editor-hosted UI, and interaction defects. Milestone 15 remains in progress.** This checkpoint supersedes the historical Milestone 1 storage decision: canonical Intelligence and extension workflow state now live under the opened repository's ignored `.keystone/` directory. `.keystone/` is excluded from ingestion, Git by the supplied `.gitignore`, and VSIX packaging by `.vscodeignore`.

The extension was launched repeatedly as an actual Extension Development Host against the Keystone repository rather than validated only through component tests. The last clean observed host loaded the retained generation immediately, ran for approximately fourteen minutes while source changes triggered incremental generations, and remained responsive while serving Intelligence and workflow operations. It ended at `READY`, `Healthy`, `Idle`, with 0 queued jobs, 0 pending files, 0 failed jobs, and 0 active workers out of the bounded capacity of 3. The active canonical generation contained 213 files and contained no path under `node_modules`, `dist`, `out`, `build`, `.keystone`, or `.vscode-test`; no file had a pending status.

Implemented and verified repairs:

- The Control Center is an editor-hosted Webview panel opened by `Keystone: Open Control Center`; the obsolete Activity Bar view/container contribution is gone.
- Canonical generations and Intelligence/workflow feature stores use repository-local `.keystone/`. Restart recovery restored the approved specification, task plan, and orchestration state without external storage.
- Directory pruning excludes dependency folders, nested package managers, outputs, caches, virtual environments, `.keystone`, `.vscode-test`, and other required hard exclusions before file enumeration. Tests remain ingestible.
- Runtime phase, health, queue, pending-file, progress, throughput, and worker values are derived from real scheduler state. Pause/cancel controls render only during active work; an idle ready generation offers only rescan/refresh.
- Worker capacity is bounded at 3, enumeration concurrency at 1, and expensive overview recomputation is coalesced. File-watch updates no longer trigger a redundant full dirty-worktree Git reconciliation. Semantic cancellation ignores a late worker result without destroying reusable compiler state.
- CPG persistence reuses structurally identical prior scopes through hard links and batches shard validation. Large global shards avoid a costly read/hash comparison when generation-owned records necessarily changed. A clean full repository generation completed in about 29 seconds in the development host; later incremental generations completed in seconds.
- Technology detection now requires language-compatible static import or manifest evidence. The live repository reported seven supported, evidence-backed technologies instead of false framework detections. TypeScript coverage reports canonical semantic counts; adapter limitations remain explicit.
- Route extraction is restricted to route-like receivers and valid path arguments. Standard/external/built-in collection calls are treated as non-repository boundaries rather than thousands of false unresolved repository calls. Live unresolved diagnostics fell from 13,290 to 1,207; remaining diagnostics are preserved as honest unresolved/compiler capability boundaries.
- Query templates select and focus placeholders and cannot run while placeholders remain. Ambiguous entity resolution exposes ranked candidate buttons; selection replaces the textual seed with a stable entity ID. Stable-ID search returns only that entity, CamelCase tokens are split correctly, and no ambiguous development workflow entity is silently chosen.
- Dependency-cycle paths now contain their exact relationship IDs/types, confidence, risk, and evidence rather than unlabeled hops. Cycle entities are deduplicated. Bounded query results, cache state, compiled structure, ranking reasons, limitations, and explanation remain visible.
- All 107 admitted request types have a typed contract, HostBridge result validator, and router handler. A static React interaction audit found no rendered button without an event handler. Missing handoff/export routes now fail explicitly instead of timing out.
- The query/workflow event storm was removed: lightweight runtime events are throttled and full overview refresh is trailing-debounced. This fixed the observed false workflow timeout where state had persisted but the response was delayed behind repeated full-graph overview work.
- The old repository at `/Users/sudheer/workspace/refs/Keystone_old` was inspected. Its broader safe exclusion names informed the current pruning list. Its Intelligence counts, infrastructure/database facts, and many controls were hard-coded or handlerless, so none of those misleading behaviors were ported and the current SPA/service ownership was preserved.

Actual Extension Development Host checks completed:

- Opened the Control Center in the main editor, confirmed retained Intelligence was immediately browsable, and observed background reconciliation settle to an idle healthy generation with no pause/cancel controls.
- Ran `find IntelligenceRuntime`, inspected the compiled structured query, selected an ambiguous candidate by stable ID, reran it, and observed deterministic ranking/cache metadata.
- Searched the semantic browser, opened the `IntelligenceRuntime` class, loaded its bounded incoming/outgoing neighborhood and evidence, and opened `src/core/intelligence/runtime/IntelligenceRuntime.ts` at the source location.
- Ran `show dependency cycles` as a bounded architecture query.
- Ran persisted CPG backward and forward slices for `IntelligenceRuntime.getState`; the backward slice returned 3 nodes/2 edges and the forward slice 11 nodes/19 edges with an explicit truncation marker.
- Restored the approved intent/specification and two-task plan after restart, created a local orchestration instance, generated its deterministic plan, and exercised approval/readiness. With all other extensions disabled, Copilot capability was honestly unavailable and both implementation tasks remained `unsupported`; no delegation, execution, Git mutation, or false completion occurred.
- Checked Validation & QA (correctly requires an approved delegation/execution tracker), Delivery (Git refresh and two evidence-based blockers), Task Handoff (unassigned/stale/blocker facts and no fabricated participants), Diagnostics, and Settings. `Open VS Code settings` opened the VS Code editor filtered to `@ext:keystone-dev.keystone` with 22 settings.

Final automated validation:

- `npm run verify`: passed type checking, linting, 49 test files/377 tests, extension/semantic-worker production builds, and the React production build.
- `npm run test:extension`: passed on VS Code 1.95.0 with Extension Host exit code 0.
- Focused runtime/query/persistence/UI regressions passed throughout, including 60 complete-query-engine tests and the explicit ambiguous-candidate UI test.
- `git diff --check`: passed after whitespace repair.
- `npx vsce ls`: passed with 10 package entries; `.keystone/`, source maps, tests, source, local generations, and workflow state are excluded.
- `npm ls --depth=0`: passed. Static source/dependency review found no external database, graph server, vector store, HTTP backend, cloud persistence, or Intelligence LLM invocation.

Files changed by this hardening checkpoint:

- Root/package: `.gitignore`, `.vscodeignore`, `package.json`, `PLANS.md`.
- Intelligence/runtime: `src/core/intelligence/IgnorePolicy.ts`, `src/core/intelligence/IntelligenceQueryService.ts`, `src/core/intelligence/RepositoryIndexService.ts`, `src/core/intelligence/adapters/BaseAdapter.ts`, `src/core/intelligence/adapters/DataDeliveryAdapters.ts`, `src/core/intelligence/adapters/UniversalAdapterEngine.ts`, `src/core/intelligence/adapters/UniversalAdapters.ts`, `src/core/intelligence/cpg/CpgBuilder.ts`, `src/core/intelligence/cpg/TypeScriptCpgProvider.ts`, `src/core/intelligence/query/QueryEngine.ts`, `src/core/intelligence/runtime/IngestionScheduler.ts`, `src/core/intelligence/runtime/IntelligenceRuntime.ts`, `src/core/intelligence/runtime/WorkerPoolManager.ts`, `src/core/intelligence/semantic/SemanticDeltaBuilder.ts`, `src/core/intelligence/semantic/SemanticExtractionWorker.ts`, `src/core/intelligence/semantic/SemanticGraphBuilder.ts`, and `src/core/intelligence/semantic/TypeScriptJavaScriptParser.ts`.
- Persistence/host/UI: `src/core/persistence/CpgShardStore.ts`, `src/core/persistence/IntelligenceStore.ts`, `src/core/persistence/WorkspaceStateStore.ts`, `src/core/workflows/DevelopmentWorkflowService.ts`, `src/extension/adapters/WorkspaceAdapter.ts`, `src/extension/extension.ts`, `src/extension/intelligence/VsCodeRepositoryMonitor.ts`, `src/extension/webview/KeystoneViewProvider.ts`, `src/extension/webview/WebviewMessageRouter.ts`, `src/shared/contracts/intelligence.ts`, `src/shared/contracts/messages.ts`, `src/ui/App.tsx`, `src/ui/components/intelligence/IntelligenceOverview.tsx`, `src/ui/components/intelligence/QueryWorkspace.tsx`, `src/ui/services/HostBridge.ts`, and `src/ui/styles/global.css`.
- Tests: `tests/ui/HostBridge.test.ts`, `tests/ui/QueryWorkspace.test.tsx`, `tests/unit/contracts.test.ts`, `tests/unit/intelligence/IgnorePolicy.test.ts`, `tests/unit/intelligence/RepositoryIndexService.test.ts`, `tests/unit/intelligence/adapters/UniversalAdapterEngine.test.ts`, `tests/unit/intelligence/query/QueryEngine.test.ts`, `tests/unit/intelligence/runtime/IngestionScheduler.test.ts`, `tests/unit/intelligence/semantic/SemanticDeltaBuilder.test.ts`, `tests/unit/intelligence/semantic/SemanticGraphBuilder.test.ts`, `tests/unit/intelligence/semantic/TypeScriptJavaScriptParser.test.ts`, `tests/unit/persistence.test.ts`, `tests/unit/persistence/CpgShardStore.test.ts`, `tests/unit/uiInteractionContracts.test.ts`, `tests/unit/webview/WebviewMessageRouter.test.ts`, and `tests/unit/workflows/DevelopmentWorkflowService.test.ts`.

No file was deleted specifically by this checkpoint. The pre-existing Milestone 15 deletion of `src/core/workflows/WorkflowOrchestrator.ts` remains recorded above.

Known limitations retained honestly:

- A partial generation can be healthy and queryable when structural adapters report unsupported files; this is distinct from pending or failed ingestion. The live React adapter reported 12 unsupported files because canonical TS/TSX semantic analysis already owns those files, not because files were pending.
- The remaining 1,207 compiler diagnostics are bounded and inspectable; dynamic dispatch and external declaration boundaries are not fabricated into repository relationships.
- GitHub Copilot delegation could not be executed in the isolated host because non-development extensions were intentionally disabled. The unavailable capability and resulting task blockers were verified instead.
- Deterministic OKF projection and the complete final Intelligence UI remain the explicit Milestones 7–8/Milestone 15 release gates. This checkpoint did not claim or begin them.

### Intelligence detail and remediation checkpoint — 2026-07-17

Status: **Complete for the reported label-only Intelligence surfaces.** Counts, breakdown rows, query results, technology coverage, CPG summary metrics, and diagnostics now disclose their meaning and evidence boundary and expose bounded actions. This does not mark the final Intelligence UI redesign complete.

Implemented and verified:

- Intelligence count cards and every breakdown row are keyboard-accessible controls. The detail panel explains what the value means, how it is calculated, and the appropriate next action. Files, symbols, packages, tests, routes, dependencies, language buckets, symbol types, and CPG scopes can launch bounded semantic browsing; exclusion/configuration findings link to settings/rescan instead of implying missing ingestion.
- A bounded cross-component browse command connects overview insights to the existing semantic browser without duplicating search services. The live Files detail opened exactly 214 current-generation file entities and retained pagination.
- Query result cards, grouped result sections, and path steps are inspectable. Canonical results load source location, signature, incoming/outgoing counts, evidence statements, extractor versions/confidence, and source/follow-up actions. Calculated projections explicitly disclose when no canonical entity exists. Ambiguous results still require explicit stable-ID selection.
- Technology coverage cards expand to capability semantics, exact adapter/version/freshness, parsed/failed/metadata-only counts, unresolved/unsupported counts, conflicts, and clickable detection evidence. Structural capability is not presented as semantic support.
- Diagnostics expand to deterministic classification, meaning, recommended action, location/range, severity, producer, technology, and entity ID. Capability limitations are explicitly not repository defects. Repository findings can prepare a reviewed quick workflow; source is never edited and a diagnostic is never suppressed by this action. The live check prepared workflow `1c1bdeaf-6122-4539-9173-c5af67a19f36` for an unresolved-call investigation.
- Added typed `intelligence/diagnostics` request/result contracts, router/bridge validation, cancellation, filters, a 100-item hard maximum, and cursor pagination. The live Diagnostics view loaded 50 of 1,228 generation-32 diagnostics and offered continuation rather than rendering an unbounded list.
- The rebuilt real repository generation reached `READY`, `Healthy`, and `Idle` with 0 pending files, 0 queued jobs, 0 failed jobs, 3-worker capacity, 214 files, 0 parse failures, 0 CPG failures, and 1,228 honest unresolved/capability diagnostics. The prior false route diagnostics such as `GET enabled` and `GET onWorkspaceOpen` were absent after the route-receiver/path repair was promoted.

Actual Extension Development Host checks:

- Clicked Files, inspected its definition/calculation, launched bounded matching Intelligence, and observed 214 file records with source path and generation.
- Ran `find IntelligenceQueryService`, observed explicit ambiguity and 20 ranked candidates, selected the exact class by stable ID, reran the query, and opened the new canonical inspector with 50+ incoming relationships, 18+ outgoing relationships, 50+ evidence records, source location, extractor/version, confidence, and follow-up actions.
- Expanded a real `unresolved-call` diagnostic, verified its unproven-link explanation and exact `src/core/context/TaskContextService.ts:39:7` location, opened the prepared remediation text, and exercised the bounded all-diagnostics page.
- Observed generation 32 technology coverage for seven evidence-backed technologies and expandable structural/semantic capability details. CPG showed 4,312 scopes, 446 built/3,866 reused, 83 explicitly approximate results, and 0 analysis failures.

Validation:

- `npm run verify`: passed type checking, linting, 49 test files/379 tests, extension and semantic-worker builds, and React Webview production build.
- Focused diagnostics contract/service/router/bridge tests: 3 files/15 tests passed.
- `npm run test:extension`: sandboxed Electron reproduced `SIGABRT`; the required approved out-of-sandbox VS Code 1.95.0 run passed with Extension Host exit code 0.
- Production output: extension 1.5 MB, semantic worker 10.3 MB, Webview JavaScript 503.00 KB/131.80 KB gzip, CSS 35.80 KB/6.89 KB gzip. Vite retains its existing >500 KB uncompressed chunk warning.
- `npm run build:all` does not exist; `npm run verify` and `npm run test:extension` both invoke the repository's authoritative extension and Webview production build scripts.

Files created by this checkpoint:

- `src/ui/components/intelligence/DiagnosticDetails.tsx`

Files modified by this checkpoint:

- `PLANS.md`
- `src/core/intelligence/IntelligenceQueryService.ts`
- `src/extension/webview/WebviewMessageRouter.ts`
- `src/shared/contracts/intelligence.ts`
- `src/shared/contracts/messages.ts`
- `src/ui/components/intelligence/IntelligenceOverview.tsx`
- `src/ui/components/intelligence/QueryWorkspace.tsx`
- `src/ui/components/intelligence/SemanticBrowser.tsx`
- `src/ui/components/intelligence/TechnologyCoverage.tsx`
- `src/ui/services/HostBridge.ts`
- `src/ui/styles/global.css`
- `tests/ui/SemanticBrowser.test.tsx`
- `tests/unit/intelligence/IntelligenceQueryService.test.ts`
- `tests/unit/webview/WebviewMessageRouter.test.ts`

No file was deleted by this checkpoint.

### Intelligence audit — 2026-07-17

This audit was completed after the detail/remediation checkpoint but before the final UI redesign. The current milestone 15 work has repaired the major ingestion, persistence, editor-hosted UI, and interaction defects observed during actual Extension Development Host usage. The OKF projection (Milestone 7) and complete Intelligence UI (Milestone 8) remain incomplete release gates.

#### What the audit verified

- The Control Center is an editor-hosted Webview panel; the old Activity Bar view is gone.
- Canonical generations and feature stores live under `.keystone/` in the opened repository, excluded from ingestion, Git, and VSIX packaging.
- Directory pruning excludes dependency folders, outputs, caches, and virtual environments before file enumeration.
- Runtime phase, health, queue, worker, and progress values are derived from real scheduler state.
- Worker capacity is bounded at 3, enumeration concurrency at 1, and expensive overview recomputation is coalesced.
- CPG persistence reuses prior scopes through hard links and validates shards by batch.
- Technology detection requires language-compatible static import or manifest evidence.
- Route extraction is restricted to route-like receivers and valid path arguments.
- Query templates select and focus placeholders and cannot run while placeholders remain.
- Ambiguous entity resolution exposes ranked candidate buttons.
- Dependency-cycle paths contain exact relationship IDs/types/confidence/risk/evidence.
- All 107 admitted request types have a typed contract, HostBridge result validator, and router handler.
- The query/workflow event storm was removed; lightweight events are throttled and full overview refresh is debounced.

#### What the audit confirmed remains incomplete

- OKF projection (Milestone 7): three dormant mapper/model files exist, but there is no canonical projection store/service, incremental planner, validator, export, or browser.
- Final Intelligence UI (Milestone 8): the current Intelligence Overview, Semantic Browser, Query Workspace, and Technology Coverage have been repaired for label-only surfaces, but the complete redesign with graph canvas, flow viewer, impact view, and test intelligence is not implemented.
- Deterministic OKF query integration: `OKF_CONCEPT` explicitly returns unsupported.
- The full mixed-technology intent-to-delivery E2E harness has not been exercised.

#### Current milestone status

Milestone 15 remains in progress. Milestones 7–8 are explicit open release gates. The next actionable step is to complete Milestone 7 (OKF projection) and Milestone 8 (final Intelligence UI) as part of the Milestone 15 integration progression, followed by the remaining E2E hardening items listed in the checkpoint above.

## Benchmark Evaluation Harness — Completion Audit — 2026-07-17

An evaluation harness for Keystone's Intelligence extraction quality has been built and validated. It provides capability-specific precision/recall metrics, false-positive protections, a CLI benchmark runner, and conservative baseline thresholds — all tested against four synthetic fixture repositories.

### What was implemented

**Capability-specific metrics** (`tests/fixtures/benchmarks/evaluate.ts`):
- Entity precision/recall/F1 — already existed, retained
- Import, call, reference, route-mapping, test-mapping, and data-mapping precision/recall — computed from canonical relationship types (`keystone.core.IMPORTS`, `keystone.core.CALLS`, `keystone.core.REFERENCES`, `keystone.core.ROUTE_HANDLER`, `keystone.core.COVERS`, `keystone.core.MAPS_TO`)
- Confidence classification accuracy — compares snapshot relationship `resolution` against ground truth confidence expectations
- `resolveRelationshipType()` — maps canonical types to simplified categories

**False-positive protections** (`validateFalsePositives()`):
1. Fabricated exact calls without evidence
2. Fabricated usages
3. Fabricated routes
4. Fabricated test relationships
5. Fabricated database mappings
6. Candidate labelled as exact
7. Dynamic calls resolved as exact

**CLI benchmark runner** (`tests/fixtures/benchmarks/run-benchmarks.ts`):
- Scans fixture directories for `ground-truth.ts`
- Loads synthetic snapshots from `snapshot.json`
- Produces terminal summary table
- Saves detailed JSON reports to `tests/fixtures/benchmarks/reports/`
- Returns non-zero exit code on threshold violations
- Supports `--report-dir` flag

**Threshold config** (`DEFAULT_THRESHOLDS`):
- Entity precision ≥ 0.90, recall ≥ 0.85
- Import precision ≥ 0.95, call precision ≥ 0.90, covers precision ≥ 0.95
- Confidence accuracy ≥ 0.80
- Zero tolerance for fabricated exact calls, unresolved-as-exact, stale generation, excluded-directory leakage
- Test files must be indexed; candidates must not be promoted to exact

**Four fixture repositories** with synthetic ground-truth manifests:
- `typescript-backend` — Express/TypeScript service with imports, calls, routes, test coverage
- `react-frontend` — React SPA with component hierarchy, event handlers, imports
- `fullstack` — Express + React + PostgreSQL with cross-repo flows
- `multi-package` — Monorepo with shared utilities, two services, and a shared package

**28 unit tests** (`tests/unit/benchmarks/evaluate.test.ts`):
- 4 `computeMetrics` edge-case tests
- 4 `evaluateEntities` tests (qualifiedName match, name+filePath fallback, missing entities, false positives)
- 2 `evaluateRelationships` tests
- 4 `evaluateCapabilityMetrics` tests (imports, calls, covers, empty)
- 2 `evaluateConfidenceClassification` tests (accuracy, missing resolution)
- 6 `validateFalsePositives` tests (fabricated calls, calls with evidence, candidate-as-exact, unresolved-as-exact, expected/unexpected test coverage)
- 3 `validateThresholds` tests (passes, fails on entity precision, fails on false positives)
- 2 `resolveRelationshipType` tests
- 1 `DEFAULT_THRESHOLDS` completeness test

### Validation results

- `npx tsc --noEmit`: passed with zero errors
- `npx vitest run`: 50 test files, 407 tests passed (including 28 new benchmark tests)
- Benchmark runner executed successfully against all 4 fixtures
- Reports saved to `tests/fixtures/benchmarks/reports/`

### Files created/modified

| File | Action |
|------|--------|
| `tests/fixtures/benchmarks/evaluate.ts` | Created — evaluation harness with capability metrics, false-positive validation, threshold config |
| `tests/fixtures/benchmarks/run-benchmarks.ts` | Created — CLI benchmark runner |
| `tests/fixtures/benchmarks/evaluate.test.ts` | Created — 28 tests |
| `tests/fixtures/benchmarks/typescript-backend/` | Created — fixture + ground-truth + snapshot |
| `tests/fixtures/benchmarks/react-frontend/` | Created — fixture + ground-truth + snapshot |
| `tests/fixtures/benchmarks/fullstack/` | Created — fixture + ground-truth + snapshot |
| `tests/fixtures/benchmarks/multi-package/` | Created — fixture + ground-truth + snapshot |
| `package.json` | Modified — added `test:intelligence-benchmark` script |
| `tsconfig.json` | Modified — excluded benchmark fixture directories |
| `vitest.config.ts` | Modified — excluded fixture test files from discovery |

### Known limitations

- Thresholds are conservative defaults, not yet validated against real Intelligence runs on production repositories.
- Synthetic fixture snapshots exercise the evaluation logic but do not represent actual extraction quality.
- The harness compares against ground truth manifests written by a human; it does not auto-generate ground truth.
- No benchmark-driven regression gates are wired into CI yet.
- `candidateNotExact` threshold is `true` but the current `validateFalsePositives` implementation flags any `resolution === "candidate"` relationship — the threshold governs pass/fail, not detection.

## Intelligence Effectiveness, Query Quality, Visualization, and Context Optimization — 2026-07-17

Status: **In progress. Product Integration must not begin from this checkpoint.** This milestone audits and improves the existing canonical Engineering Graph and deterministic query stack; it does not introduce a replacement architecture.

### Verified Intelligence Effectiveness Audit

The audit used the authoritative documents under `docs/intelligence`, the active contracts and implementation under `src/core/intelligence`, the query/UI tests, the four committed benchmark fixtures, and the committed benchmark reports. A capability is marked `exact` only where the implementation uses syntax/type-system or canonical persisted evidence; convention-derived facts are not promoted.

| Capability | Classification | Verified basis and limitation |
| --- | --- | --- |
| File inventory and exclusions | reliable | Continuous runtime, explainable classification, bounded enumeration, deletion handling, and exclusion tests exist. Representative real-repository counts were previously validated; cross-platform and very-large-repository recall remain unbenchmarked. |
| Symbol declarations | reliable | TypeScript/JavaScript compiler extraction and stable evidence-backed identities are implemented. Unsupported languages degrade to structural or metadata capability. |
| Import/export resolution | reliable for supported TS/JS; partial globally | Compiler-backed relationships exist for supported source. Re-exports and cross-technology aliases do not yet have a capability-specific real-extractor benchmark gate. |
| References and calls | partial | Compiler resolution, unresolved diagnostics, and evidence exist, but dynamic dispatch remains unresolved. Current benchmark reports use synthetic snapshots and therefore do not prove extractor precision/recall. |
| Inheritance and implementation | partial | Typed relationships are extracted for supported TypeScript constructs; override quality and framework-driven implementation have no real-extractor benchmark result. |
| React components and hooks | partial | TSX extraction exists, but the ground-truth harness does not currently run the extractor and does not measure `RENDERS` or `USES_HOOK` precision/recall. |
| Routes and handlers | partial | Framework rules and false-route regression coverage exist. Framework breadth and middleware ordering are incomplete. |
| Tests and test impact | partial | Test entities and evidence-tiered mappings exist. Coverage-confirmed selection is not generally available; naming candidates remain possible and must not enter default execution sets. |
| API contracts and flows | partial | OpenAPI/GraphQL structural adapters and bounded flow queries exist. Flow traversal currently uses a broad relationship allow-list rather than ordered template-specific transition rules. |
| Database and ORM | partial | Schema/ORM/query adapters emit canonical facts for supported forms. Column-level reads/writes and dynamic query builders are incomplete. |
| Configuration and build | partial | Deterministic structural adapters exist. Value provenance and all framework-specific configuration effects are not resolved. |
| CPG scope, CFG, and local data flow | partial | Persisted local scopes, slicing, and conditions queries exist. Interprocedural value flow and a measured precision-improvement/cost report are missing. |
| Query indexes and bounded traversal | reliable | Generation-specific incoming/outgoing indexes, limits, cancellation, time budgets, and cache invalidation are implemented and tested. |
| Entity resolution | reliable with explicit ambiguity | Deterministic ranking and stable-ID selection are implemented. Ambiguous expensive queries stop for user selection. Capability-specific precision/recall is not yet measured from actual extraction. |
| Usage query | incorrect before this slice | `where is <entity> used` compiled to generic `DEPENDENTS` and excluded calls, imports, renders, tests, implementations, and inheritance. It also traversed transitively, so it could not represent logical direct usages or deduplicate them correctly. |
| Generic paths | reliable within indexed evidence | Bounded shortest, typed, all-bounded, confidence, and risk modes return only stored edges. Direction handling and semantic path modes need broader corpus coverage. |
| Semantic flows | partial | Partial flows expose terminal gaps, but ordered HTTP/UI/event/build transition templates and alternate-flow scoring explanations are incomplete. |
| Impact | partial | Incoming bounded traversal, categories, risk reasons, and test sections exist. Relationship-family stopping rules and benchmark precision/recall are incomplete. |
| Changes | partial | Retained-generation and retained-branch comparisons exist. Public-API/stale-test classifications are not complete. |
| Query plan | partial before this slice | The planner exposed only operation, required seed count, and an `expensive` flag; it did not expose indexes, relationship families, traversal, thresholds, CPG requirement, limits, evidence, or time budget to the UI. |
| Deterministic answer composition | partial | Structured result sections and deterministic UI rendering exist, but concise operation-specific answer summaries are incomplete. |
| OKF | missing | Dormant model/mapper files exist; canonical projection storage, backlinks, lint, incremental regeneration, query integration, browser, and export remain absent. |
| Visual intelligence | missing/partial | List and path projections are bounded and accessible, but purpose-specific repository, dependency, neighborhood, flow, impact, data, test, and local CPG visualizations are not implemented. |
| Context compiler and quality metrics | partial outside this slice | Existing task context services predate this milestone. Required-context recall, irrelevant-context rate, structural compression attribution, and query-to-context actions have not been benchmarked end to end. |

### P0/P1 findings and implementation order

No verified fabricated canonical relationship was found in the inspected current tree. The following quality blockers remain:

1. **P1 — incorrect usage semantics:** replace generic transitive dependents with a dedicated direct usage query, typed categories, logical deduplication, evidence preservation, bounded pagination, exact/candidate distinction, and production/test grouping.
2. **P1 — synthetic benchmark self-validation:** the committed benchmark CLI reads hand-authored `snapshot.json` files instead of running Keystone ingestion. Keep these fixtures, but do not cite their perfect metrics as extractor quality. Add a real-extractor benchmark path before setting production thresholds.
3. **P1 — flow semantics:** replace the broad flow allow-list with ordered flow templates and visible gap/alternate scoring.
4. **P1 — absent OKF:** implement and validate the canonical projection before Product Integration.
5. **P1 — absent context-quality proof:** measure required-item recall and irrelevant-context rate, not reduction alone.
6. **P2 — query plan visibility:** expose the complete bounded plan in the typed result and advanced UI disclosure.
7. **P2 — purpose-specific visualization:** implement accessible deterministic views; never send or render the full repository graph.

### Current coherent vertical slice

- [x] Audit the current usage grammar, planner, traversal, evidence assembly, pagination, and UI projection.
- [x] Add a first-class `USAGES` operation while retaining `DEPENDENTS` for dependency analysis.
- [x] Classify direct incoming relationships as imported-by, called-by, instantiated-by, referenced-by, rendered-by, implemented-by, extended-by, overridden-by, tested-by, mocked-by, routed-to, read-by, written-by, configured-by, built-by, or deployed-by where canonical evidence exists.
- [x] Deduplicate repeated edges representing one source/category/target logical use, retaining the strongest classification and the union of bounded evidence IDs.
- [x] Add cursor pagination, exact/candidate metrics, category sections, production/test sections, source/open metadata, and evidence coverage.
- [x] Add a typed inspectable `QueryPlan` to every query result and render it in the advanced explanation UI.
- [x] Validate parser behavior, exact usage, grouping, deduplication, pagination, evidence, ambiguity, bounds, and plan explanation.

### Assumptions and unresolved decisions

- A usage is a **direct** evidenced incoming relationship. Transitive reach remains a dependency, path, flow, or impact question.
- Multiple canonical call sites inside one containing symbol are one logical usage for the initial usage list; their evidence IDs are merged. A future call-site mode may expose every physical occurrence without changing this default.
- Context excerpts are not fabricated or read from mutable workspace files by the generation query. The result returns canonical source/open metadata and evidence ranges; snapshot-backed excerpts require a future source-fragment store.
- The current slice does not claim completion of flows, OKF, visualizations, context compilation, or the full benchmark corpus.

### Usage and QueryPlan vertical-slice completion record

Implemented:

- `where is <entity> used` now compiles to `USAGES`; it no longer aliases dependency traversal. Configuration-key syntax remains routed to the dedicated configuration query.
- Usage evaluation reads only direct incoming canonical relationships, applies the query confidence/type filters, requires explicit stable-ID selection for ambiguity, groups production and tests, and never fills an unsupported use.
- Logical usage deduplication keys source entity, usage category, and target seed. It chooses the strongest exact/resolved/candidate classification for display and preserves the bounded union of physical relationship and evidence IDs.
- Results expose total logical usages, exact/resolved count, candidate/convention/unresolved count, physical relationship count, deterministic ordering, cursor continuation, source/open metadata, and category sections.
- Every query result now includes a typed `QueryPlan` with resolved seeds, ambiguous candidates, actual scan/adjacency indexes, relationship families, direction, depth, confidence and capability filters, CPG requirement, limits, evidence requirement, and time budget. The advanced Query Workspace renders this plan.
- Unavailable and unsupported query results also carry a bounded plan, so the typed host contract does not have a success-only hole.
- The benchmark CLI now runs without the uninstalled `tsx` dependency, uses the complete threshold validator, produces deterministic report timestamps from snapshot identity, and no longer misclassifies an honestly labelled candidate as a candidate promoted to exact.
- Benchmark fixture source trees are excluded from the product ESLint TypeScript project because they deliberately contain missing third-party frameworks and unsupported/dynamic cases; the benchmark harness and tests remain type-checked and linted.
- Package scripts now invoke their sub-scripts through `npm`, making the documented `npm run verify` and build gates runnable without a package-manager shim download. The repository remains a single package and retains its declared package-manager metadata.

Measured results:

| Fixture | Entity precision | Entity recall | Entity F1 | Threshold result |
| --- | ---: | ---: | ---: | --- |
| Full stack | 0.688 | 0.733 | 0.710 | fail |
| Multi-package | 0.875 | 0.636 | 0.737 | fail |
| React frontend | 1.000 | 0.700 | 0.824 | fail |
| TypeScript backend | 0.667 | 0.727 | 0.696 | fail |

These are synthetic-snapshot evaluator results, not real-ingestion measurements. They are useful as a red quality gate and ground-truth consistency check, but they do not establish actual extractor precision/recall. The new usage fixture queries completed in approximately 1 ms each during the focused unit run; no p50/p95 claim is made because small/medium/large real-repository sampling has not been performed.

Validation:

- `npm run typecheck`: passed.
- `npm run lint`: passed.
- Focused query/UI/benchmark tests: 3 files, 99 tests passed.
- `npm run verify`: passed type checking, linting, 50 test files/414 tests, extension/semantic-worker builds, and the React Webview production build.
- `npm run test:intelligence-benchmark`: executed correctly and failed the quality gate for all four fixtures with the metrics above. This failure is retained as milestone evidence, not suppressed.
- Extension integration: the sandboxed Electron process reproduced `SIGABRT`; the approved out-of-sandbox VS Code 1.95.0 run passed with Extension Host exit code 0.
- Production output: extension 1.5 MB, semantic worker 10.3 MB, Webview JavaScript 504.80 KB/132.23 KB gzip, CSS 35.80 KB/6.89 KB gzip. The existing Vite >500 KB warning remains.
- `git diff --check`: passed.

Files modified by this slice:

- Planning/configuration: `PLANS.md`, `package.json`, `eslint.config.mjs`.
- Query contracts and implementation: `src/shared/contracts/query.ts`, `src/core/intelligence/query/QueryParser.ts`, `src/core/intelligence/query/QueryEngine.ts`, `src/core/intelligence/IntelligenceQueryService.ts`.
- Intelligence UI: `src/ui/components/intelligence/QueryWorkspace.tsx`.
- Benchmark harness/reports: `tests/fixtures/benchmarks/evaluate.ts`, `tests/fixtures/benchmarks/run-benchmarks.ts`, and the four JSON reports under `tests/fixtures/benchmarks/reports/`.
- Tests: `tests/unit/intelligence/query/QueryEngine.test.ts`, `tests/unit/benchmarks/evaluate.test.ts`, `tests/ui/QueryWorkspace.test.tsx`.

No file was created, moved, or deleted by this slice.

Readiness decision: **Intelligence is not yet sufficiently effective for Product Integration or Pilot Validation.** The dedicated usage query and QueryPlan defect are closed, but the benchmark gate is red, real-extractor evaluation is absent, ordered semantic flow templates are incomplete, OKF is missing, purpose-specific visualizations are missing, and context-quality/token-reduction proof is absent. Do not begin Product Integration automatically.

### Ordered semantic-flow vertical slice — execution plan — 2026-07-18

Status: **Complete.** This slice repairs the verified broad-allow-list flow defect. It remains inside the deterministic Query Engine and required Intelligence UI; it does not begin OKF or Product Integration.

Assumptions and boundaries:

- A flow hop must be a persisted relationship with evidence. Templates constrain which evidenced hop may follow the current stage; they never synthesize a missing transition.
- HTTP/data-persistence, event, configuration-to-behavior, command/execution, and build/pipeline flows use distinct deterministic templates. Unsupported starts return diagnostics and visible gaps rather than falling back to an unconstrained graph walk.
- Repeated application `CALLS` hops are allowed only after the appropriate template boundary (for example, route-to-handler in HTTP flow). This prevents unrelated calls from being presented as a complete cross-technology flow.
- Reverse traversal is allowed only where the template semantics require it, initially configuration-key to evidenced readers/users. The relationship ID, direction, confidence, and evidence remain visible.
- Complete and partial flows, missing stages, alternate ranking, confidence, and terminal reason are typed result metadata and must remain bounded by the existing depth/path/time budgets.

Plan:

- [x] Add typed flow-template metadata and per-hop traversal direction to query paths.
- [x] Replace the broad flow traversal with ordered deterministic state machines and explicit gap reporting.
- [x] Add deterministic complete/partial and alternate-flow scoring with visible contributing signals.
- [x] Render purpose-specific left-to-right flow results in the Query Workspace without adding a full graph canvas.
- [x] Add HTTP, event, configuration, execution, build/pipeline, missing-hop, alternate-ranking, filtering, bounds, and no-fabrication tests.
- [x] Run typecheck, lint, focused/full tests, production builds, extension integration, and a real Extension Development Host flow check.
- [x] Record measured results, files, and remaining limitations before closing the slice.

Completion checkpoint — 2026-07-18:

- `FlowQueryService` now selects one of five deterministic templates (`http-persistence`, `event`, `configuration`, `command-execution`, `build-pipeline`) from the resolved canonical seed and persisted adjacency. Each template advances through explicit semantic stages. Cycles, confidence/type filters, depth, nodes, edges, alternate count, cancellation, and time budget are bounded; no missing relationship is synthesized.
- Flow paths now carry hop direction and typed metadata for complete/partial status, matched/missing stages, score and factors, terminal reason, alternate rank, and truncation. Ranking is deterministic: required-stage coverage, minimum evidenced confidence, completion bonus, relationship risk, and stable identity tie-breaking.
- The Query Workspace now renders a horizontally scrollable left-to-right flow surface. It shows relationship direction/type, exact/inferred classification, confidence, gaps, capability boundaries, ranking reasons, and an `Inspect boundary` action that opens canonical source and evidence details.
- Mixed-technology fixture repositories are excluded from the production TypeScript and ESLint project. Their deliberately incomplete imports remain ingestion inputs rather than production compilation dependencies.

Validation commands and outcomes:

- `npm run typecheck` — passed.
- `npm run lint` — passed.
- `npx vitest run tests/unit/intelligence/query/QueryEngine.test.ts tests/ui/QueryWorkspace.test.tsx` — passed, 2 files and 76 tests after the final build/pipeline case.
- `npm run verify` — passed after the final build/pipeline assertion, 50 files and 421 tests; production extension and Webview bundles passed. The existing Webview chunk-size advisory remains non-blocking.
- `npm run test:extension` — passed in VS Code 1.95.0 with exit code 0; extension discovery, activation, registered commands, build, and host integration succeeded.
- A fresh actual Extension Development Host was launched against `/Users/sudheer/workspace/keystone`. Generation 33 loaded as `READY`, `Healthy`, `Idle`, with 0 queued jobs, 0 pending files, 0 failed jobs, and 0 active workers out of 3. The canonical generation contained 287 files; a direct shard audit found 0 paths under `node_modules`, `dist`, `out`, `build`, `.keystone`, or `.vscode-test`, and 0 pending file records.
- In that live Webview, `show CompleteQueryEngine.query flow` deterministically compiled to `FLOW` and completed in 584.3 ms. Five bounded command/execution alternates rendered with ordered `CALLS`/`INSTANTIATES` hops, confidence and score. Expanding ranking reasons showed the exact factors, and `Inspect boundary` opened `QueryContext.check` with signature, source location, incoming/outgoing counts, and extractor evidence. No rendered query error was present.

Files modified by this slice:

- `PLANS.md`
- `docs/intelligence/INTELLIGENCE_UI.md`
- `docs/intelligence/QUERY_ENGINE.md`
- `eslint.config.mjs`
- `src/core/intelligence/query/QueryEngine.ts`
- `src/shared/contracts/query.ts`
- `src/ui/components/intelligence/QueryWorkspace.tsx`
- `src/ui/styles/global.css`
- `tests/ui/QueryWorkspace.test.tsx`
- `tests/unit/intelligence/query/QueryEngine.test.ts`
- `tsconfig.json`

No file was created, moved, or deleted by this slice. Existing unrelated changes in `README.md`, `GAP-ANALYSIS.md`, and `tests/fixtures/intelligence/` were preserved.

Remaining limitations: repository-level flows are template-bounded and do not yet expand branch conditions or data transformations inline; HTTP completeness depends on persisted `TARGETS` and `ROUTES_TO` evidence; event completeness depends on persisted `EMITS`/`PRODUCES` and `HANDLES`/`CONSUMES` evidence; CPG-assisted interprocedural joins are not added by this slice. The benchmark gate, real-extractor benchmark corpus, OKF projection, the remaining purpose-specific architecture/impact/CPG visualizations, and context-quality proof remain incomplete. Product Integration and Pilot Validation remain blocked.

### UI Architecture Task 1 — Domain and Navigation Consolidation — 2026-07-18

Status: **Complete.** The workflow-oriented product model, route migration, consolidated navigation, single draft-creation flow, Workbench lifecycle, real Home projection, secondary health/settings routes, and task-level Handoff action are implemented and validated. Existing workflow, orchestration, delivery, validation, assignment, and handoff services remain in place. Visual redesign and the full handoff modal were not started.

Canonical model and assumptions:

- `DevelopmentWorkflowSnapshot` remains the canonical durable SDLC aggregate for intent, specification history, task graph, and tasks. Execution, validation, review, delivery, and handoff records refer to its workflow or task identifiers rather than becoming user-facing workflows.
- `WorkflowInstance` remains persisted compatibility state for the coordinating orchestration service. It is projected as internal coordination state inside Review, never listed or created as a second user-facing workflow.
- Existing persisted workflow schemas remain readable. New work-type and repository-scope fields are optional migration-safe additions to the intent; old records require no destructive migration.
- Existing section persistence remains readable. A typed route is added and legacy sections map deterministically into Workbench or secondary routes.
- Delivery and handoff remain optional capabilities. This task relocates entry points and contracts without deleting services or forcing delivery.

Plan:

- [x] Add a typed product-route model, Workbench stages, compatibility redirects, and migration-safe persisted navigation.
- [x] Consolidate primary navigation to Home, SDLC Workbench, Intelligence, and History; move health/settings to header actions.
- [x] Add the unified Start new work draft flow with explicit work type and repository scope, then navigate to Define.
- [x] Project existing Define, Plan, Build, Validate, Review, and Complete capabilities through one Workbench shell.
- [x] Add Home projection from real workflow, orchestration, validation, intelligence, and Copilot state with start/resume/ask/import actions.
- [x] Add task handoff eligibility/action contracts and preserve the import-handoff compatibility entry point without implementing the modal.
- [x] Document the canonical domain model, route map, redirects, and persistence migration in `docs/PRODUCT_MODEL_AND_NAVIGATION.md`.
- [x] Add navigation, routing, workflow attachment, migration, service-preservation, and production-build tests.
- [x] Run typecheck, lint, full tests, extension tests, extension build, and Webview build; record exact outcomes and files.

Validation performed on 2026-07-18:

- `npm run typecheck` — passed.
- `npm run lint` — passed.
- `npm test` — passed: 53 files, 429 tests.
- `npm run build:extension` — passed; extension and semantic-worker bundles produced.
- `npm run build:webview` — passed; 123 modules transformed, app bundle 500.34 kB (132.38 kB gzip). Vite reported the non-blocking 500 kB chunk-size advisory.
- `npm run test:extension` — passed in VS Code 1.95.0 on the first complete run. A later repeat reported runner code 1 even though the Extension Host logged code 0 and no assertion/extension failure; immediate direct rerun with `node scripts/run-extension-tests.mjs` passed with Extension Host and runner code 0. This is recorded as a transient harness discrepancy, not hidden as a product pass.

Task-specific created files:

- `docs/PRODUCT_MODEL_AND_NAVIGATION.md`
- `src/shared/navigation.ts`
- `src/ui/components/history/HistoryWorkspace.tsx`
- `src/ui/components/home/HomeDashboard.tsx`
- `src/ui/components/workbench/SDLCWorkbench.tsx`
- `tests/ui/HomeDashboard.test.tsx`
- `tests/ui/SDLCWorkbench.test.tsx`
- `tests/unit/navigation.test.ts`

Task-specific modified files:

- `PLANS.md`
- `src/core/persistence/WorkspaceStateStore.ts`
- `src/core/workflows/DevelopmentWorkflowService.ts`
- `src/extension/webview/WebviewMessageRouter.ts`
- `src/shared/contracts/delegation.ts`
- `src/shared/contracts/domain.ts`
- `src/shared/contracts/messages.ts`
- `src/ui/App.tsx`
- `src/ui/components/delegation/DevelopmentWorkspace.tsx`
- `src/ui/services/HostBridge.ts`
- `src/ui/styles/global.css`
- `tests/ui/App.test.tsx`
- `tests/unit/contracts.test.ts`
- `tests/unit/persistence.test.ts`
- `tests/unit/workflows/DevelopmentWorkflowService.test.ts`

No file was deleted. Pre-existing and prior-slice changes outside this list were preserved.

Known limitations: current-editor repository scope is recorded explicitly but remains dependent on the host’s active-editor context during later intelligence resolution; PR review is an honest future capability placeholder; the full handoff preparation modal is intentionally deferred. The next recommended milestone is **UI Architecture Task 2 — Workbench Interaction and Detail Views**, focused on stage-specific view models, progressive disclosure, and responsive interaction without changing the canonical domain model. It has not been started.

### UI Architecture Task 2 — Workbench Shell and Workflow Start — 2026-07-18

Status: **Complete.** This task makes the Task 1 shell a recoverable, gated workflow from draft creation through an approved task plan. Full Copilot execution, validation, PR preparation, and Handoff UI remain outside scope.

Verified starting gaps and decisions:

- The compatibility `workflow/capture` path currently creates a specification immediately. Task 2 will preserve that API for older callers while adding an explicit Workbench draft-creation path that creates no specification or tasks.
- The existing specification revision and history model is reusable. Workflow-level clarification/decision records and repository baseline references will be added as optional/defaulted fields so version-1 persisted workflows remain readable without destructive migration.
- The existing task graph has a revision but no explicit reviewed approval. Task 2 will add migration-safe plan status/approval/history metadata and separate deterministic generation from explicit approval.
- Workbench stage state is a deterministic projection of canonical workflow, repository, Intelligence, task, orchestration, execution, and validation state. It will not be persisted as a second lifecycle model.
- Workspace trust, repository availability, active editor scope, Intelligence snapshot, Copilot capabilities, and repository source opening remain Extension Host facts exposed through typed bounded contracts.

Plan:

- [x] Add bounded Workbench contracts for create context, workflow lifecycle, Define/Plan state, clarifications, specification/task editing, stage projection, summary, and typed lifecycle events.
- [x] Extend the existing workflow aggregate and persistence parser with migration-safe intent history, clarifications, durable decisions, repository baseline, specification metadata, and task-plan approval/history.
- [x] Implement explicit workflow draft creation, intent/scope/constraint revision, deterministic clarification and repository-evidence projection, specification generation/edit/approval, task-plan generation/edit/validation/approval, and stage gating.
- [x] Route all Workbench operations through the existing workflow/orchestration services and persist route changes only after readiness validation.
- [x] Replace the initial Workbench projection with a persistent shell: workflow header, explained stage states, main content, context summary, accessible recovery states, and responsive behavior.
- [x] Add lifecycle, staleness, gating, persistence, contract, UI accessibility, and no-auto-delegation tests.
- [x] Run complete validation and exercise the durable draft → approved task plan → Build lifecycle plus reload/restart recovery through service, UI, and Extension Host tests.
- [x] Document the shell, lifecycle, gates, approvals, recovery, exact files, results, and remaining Task 3 boundary.

Completion checkpoint — 2026-07-18:

- `/workbench/new` now uses actual host repository, branch, workspace-trust, active-editor, Intelligence-generation, and Copilot-capability state. It rejects repository/generation races and persists one draft plus its repository baseline before routing to Define. Specification, tasks, assignments, and execution are not created implicitly.
- The durable aggregate now retains migration-safe intent, specification, and task-plan histories plus clarifications and decisions. Existing schema-version-1 records receive bounded defaults and existing ready task graphs remain readable as approved compatibility state.
- Define distinguishes exact evidence from candidates, keeps unsupported behavior explicitly unknown, supports answer/defer/not-applicable/reopen decisions, and separates specification generation from approval. Approval rechecks repository/Intelligence freshness, clarification and specification questions, decisions, criteria, and validation methods.
- Plan supports deterministic generation plus add/edit/remove/reorder, optional status, validation steps, execution routes, and dependencies. Every edit creates a revision and invalidates approval. Cycle, dependency, criterion coverage, validation, unsupported route, and triggered security/performance checks block approval with recovery actions. Approval enters Build with a dependency-ready task but no agent assignment or execution.
- The persistent shell renders a non-ID workflow header, six explained text statuses, keyboard stage navigation, gated host routing, main stage content, and a reusable context summary. Invalid recovered routes return to the latest valid stage without changing workflow data.
- Typed response validation was added in the Webview bridge for every Workbench request, in addition to request/response/event schemas and bounded host projections. The interaction-contract test confirms every UI host request has a contract, router case, and response validator and that visible buttons are not inert.

Validation commands and outcomes:

- `npm run typecheck` — passed.
- `npm run lint` — passed.
- `npm test -- --reporter=default` — passed: 53 files, 432 tests.
- `npm run build:extension` — passed; extension bundle 1.6 MB and semantic worker 10.3 MB.
- `npm run build:webview` — passed; 124 modules, JavaScript 537.31 kB/140.62 kB gzip and CSS 41.80 kB/7.84 kB gzip. The existing Vite >500 kB advisory remains non-blocking.
- `npm run test:extension` — passed in VS Code 1.95.0; the Extension Host loaded the development extension and exited with code 0.
- `git diff --check` — passed.

Task-specific created files:

- `docs/WORKBENCH_SHELL.md`
- `src/shared/contracts/workbench.ts`
- `src/ui/components/workbench/SDLCWorkbench.tsx` (created during Task 1 and completed as the functional shell in this task)
- `tests/ui/SDLCWorkbench.test.tsx` (created during Task 1 and expanded for actual host create context in this task)

Task-specific modified files:

- `PLANS.md`
- `src/core/workflows/DevelopmentWorkflowService.ts`
- `src/extension/webview/WebviewMessageRouter.ts`
- `src/shared/contracts/delegation.ts`
- `src/shared/contracts/messages.ts`
- `src/ui/services/HostBridge.ts`
- `src/ui/styles/global.css`
- `tests/ui/DevelopmentWorkspace.test.tsx`
- `tests/unit/execution/ExecutionValidation.test.ts`
- `tests/unit/workflows/DevelopmentWorkflowService.test.ts`

No file was deleted by Task 2. Existing unrelated and prior-slice changes, including `README.md`, `GAP-ANALYSIS.md`, Intelligence query files, fixture repositories, and the pre-existing `pnpm-lock.yaml` deletion, were preserved.

Known limitations and next boundary: current-file scope depends on the active editor at creation; repository evidence shown in Define is bounded and candidates require explicit scope choice; Build does not auto-start an agent; full execution controls, validation/review/PR detail, completion, and Handoff preparation remain intentionally deferred. The recommended next milestone is **UI Architecture Task 3 — Build and Execution Interaction**, using the approved task plan and existing execution services without changing the canonical workflow model. It has not been started.
