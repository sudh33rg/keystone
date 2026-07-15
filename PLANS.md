# Keystone Intelligence Execution Plan

## Objective

Complete the repository intelligence runtime and Intelligence UI before expanding other Keystone features.

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
