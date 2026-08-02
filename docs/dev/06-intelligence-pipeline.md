# 06 — The Intelligence Pipeline

This is the heart of the product: turning a directory of files into an OKF
snapshot, deterministically and without an LLM.

Primary source: `src/core/intelligence/pipeline/pipeline.ts` (1,452 LOC) and
`src/core/intelligence/ingestion/repoIndexer.ts` (783 LOC).

---

## End-to-end flow

```
indexRepository(root, options)                      ingestion/repoIndexer.ts:55
  │
  ├─ 1. RevisionGuard.detectMismatch()              staleness gate
  │       Git HEAD/branch changed?  → discard the whole intelligence store
  │
  ├─ 2. loadGitignore(root)                         honour the repo's .gitignore
  │
  ├─ 3. scanFiles(root)                             ingestion/fileScanner.ts:110
  │       walk → skip IGNORED_DIRECTORIES → skip binaries → read text
  │       onDiscovery / onFile progress callbacks
  │
  ├─ 4. per-file analysis
  │       languageForPath() → languageRegistry
  │       analyzeLanguageFile()  → symbols, imports, exports
  │       ExtractionCache hit?   → reuse (reusedFiles++)
  │       else analyse           → (analyzedFiles++) and cache
  │
  ├─ 5. detectors
  │       testMapper, serviceMapper, engineeringEntityDetector,
  │       securityZoneDetector, performancePathDetector,
  │       modernizationCandidateDetector
  │
  ├─ 6. → RepoIntelligence (in-memory structural model)
  │
  ├─ 7. buildRepositoryIntelligence()               pipeline/pipeline.ts
  │       run the 21 stages (some in a worker pool)
  │       → RepositoryIntelligenceSnapshot
  │
  └─ 8. OKF build + promote                          onPersistence phases:
          "structural-store" → "okf-read" → "okf-build" → "okf-store" → "okf-complete"
          repoIntelligenceToOkf() → OkfSnapshotStore.promote()
          → projections + portable bundle
```

---

## The 21 stages

Defined in the `STAGES[]` table at `pipeline.ts:981`. IDs and order are frozen in
`INTELLIGENCE_STAGES` (`pipeline/types.ts:21`).

| # | Stage ID | Label | Family |
|--:|---|---|---|
| 1 | `structural` | Structural Intelligence | repository-structure |
| 2 | `language-framework` | Language & Framework Intelligence | repository-structure |
| 3 | `build-script` | Build & Script Intelligence | build-test-qa |
| 4 | `configuration` | Configuration Intelligence | repository-structure |
| 5 | `symbol` | Symbol Intelligence | code-graph |
| 6 | `dependency` | Dependency Intelligence | code-graph |
| 7 | `api-route` | API / Route Intelligence | code-graph |
| 8 | `data-persistence` | Data & Persistence Intelligence | architecture-sdlc |
| 9 | `test` | Test Intelligence | build-test-qa |
| 10 | `call-graph` | Call Graph Intelligence | code-graph |
| 11 | `code-property-graph` | Code Property Graph Intelligence | code-graph |
| 12 | `architecture` | Architecture Intelligence | architecture-sdlc |
| 13 | `git-change` | Git & Change Intelligence | repository-structure |
| 14 | `impact` | Impact Intelligence | architecture-sdlc |
| 15 | `context` | Context Intelligence | context-token |
| 16 | `sdlc-workflow` | SDLC Workflow Intelligence | architecture-sdlc |
| 17 | `risk` | Risk Intelligence | architecture-sdlc |
| 18 | `security` | Security Intelligence | architecture-sdlc |
| 19 | `performance` | Performance Intelligence | architecture-sdlc |
| 20 | `documentation` | Documentation Intelligence | context-token |
| 21 | `runtime-observability` | Runtime / Observability Intelligence | runtime-analysis |

Six families roll the stages up for the UI:
`repository-structure` (4), `code-graph` (4), `build-test-qa` (2),
`architecture-sdlc` (7), `context-token` (2), `runtime-analysis` (1).

### Anatomy of a stage

Each entry is built by the `stage(id, label, family, run)` helper. The `run`
function receives a shared context (`{ root, intelligence, graph, runtime,
semantic, evolution, deadCode, previous }`) and returns:

```ts
{ summary: string,                     // one-line human summary
  items: string[],                     // the things it found
  metrics: Record<string, number|string|boolean> }
```

The framework wraps that into an `IntelligenceStageResult` with `order`,
`status`, `startedAt`, `completedAt`, `durationMs`, `itemCount`, and
`cognitivelyEnriched`.

Two concrete examples, verbatim from the code:

```ts
// stage 1 — structural (pipeline.ts:982)
const roots = unique(intelligence.files.map((file) => file.path.split("/")[0]));
return {
  summary: `${intelligence.files.length} files across ${roots.length} repository roots.`,
  items: roots,
  metrics: { files: …, generated: files.filter(f => f.isGenerated).length, roots: … }
};

// stage 3 — build-script (pipeline.ts:1011) — one of the few async stages
const manifests = pathsMatching(intelligence,
  /(^|\/)(package\.json|pom\.xml|build\.gradle|Cargo\.toml|pyproject\.toml|Makefile)$/i);
const pkg = await readJsonFile(root, "package.json");
```

**To add a stage:** add the ID to `INTELLIGENCE_STAGES` in `types.ts` **and** a
`stage(...)` entry to `STAGES[]` in `pipeline.ts`. The ID union is derived from
the array, so TypeScript will point at every place that needs updating. Then
check `health.ts` and `findings.ts` if the stage should contribute to either.

### Stage status values

`"pending" | "running" | "complete" | "cancelled" | "failed"`

A failed stage records `error` and the pipeline **continues** — the snapshot ends
up `status: "degraded"` rather than absent. Fail-soft is deliberate: partial
intelligence beats none.

---

## The output snapshot

`RepositoryIntelligenceSnapshot` (`pipeline/types.ts:73`):

```ts
{ version: 1,
  status: "ready" | "degraded",
  workspaceRoot, runId, startedAt, completedAt,
  intelligence: RepoIntelligence,             // the structural model
  stages: IntelligenceStageResult[],          // all 21
  families: IntelligenceFamilySummary[],      // 6 rollups
  ingestion: IntelligenceIngestionSummary,
  health: IntelligenceHealthReport,
  incremental: IncrementalUpdatePlan,
  findings: readonly IntelligenceFinding[],
  runtime: RuntimeVerification,
  semantic: TypeScriptSemanticResult,
  evolution: RepositoryEvolution,
  deadCode: readonly DeadCodeCandidate[] }
```

### `IntelligenceIngestionSummary` — the honesty record

```ts
{ inputFingerprint: string,
  indexedFiles, indexedBytes,
  discoveryMode: "unbounded-incremental",     // literal type
  completedWithoutFileCap: boolean,           // ← proves no truncation
  cpgEligibleFiles, cpgIndexedFiles,
  warnings: string[],
  reusedFiles, analyzedFiles,                 // ← cache effectiveness
  cpgShardsWritten, cpgShardsReused, cpgShardsDeleted }
```

`discoveryMode` is typed as the literal `"unbounded-incremental"` and
`completedWithoutFileCap` is asserted by `scripts/check-active-boundary.mjs`
("no arbitrary ingestion caps"). **Keystone deliberately has no max-file limit
during ingestion** — the product principle is "unbounded knowledge, bounded
prompt". Compression happens only when building the Copilot context pack.

If you are tempted to add a file cap for performance, don't: fix the cache or the
worker pool instead, and note that this would break the boundary check.

---

## Pipeline options

```ts
interface IntelligencePipelineOptions {
  signal?: AbortSignal;                         // cancellation
  onProgress?: (event: IntelligenceProgressEvent) => void;
  onWarning?: (message: string) => void;
  persist?: boolean;
  cognitive?: boolean;                          // enable enrichment stages
  semanticEnricher?: SemanticEnrichmentProvider; // VS Code language services
  maxWorkers?: number;                          // default 5, 1..16
  affectedPaths?: readonly string[];            // incremental hint
}
```

### Cancellation

Via `AbortSignal`. The pipeline throws `IntelligencePipelineCancelledError`
(exported from `pipeline.ts`) and stages already running get status `"cancelled"`.
`VscodeProvider` uses generation counters (`indexGeneration`, `analysisGeneration`)
so a superseded run's results are discarded even if it finishes late.

### Progress reporting

```ts
IntelligenceProgressEvent {
  stage, order, total, progress, message,
  workerPool?: { maxWorkers, activeWorkers, completedStages,
                 totalStages, queuedStages, currentStages[] }
}
```

This is what drives the live stage list in the UI.

---

## Incremental behaviour and caching

Four independent mechanisms keep re-indexing cheap:

### 1. `ExtractionCache` — per-file structural results
`ingestion/extractionCache.ts` → `.keystone/cache/extractions/`
Keyed by file content; gated by `STRUCTURAL_EXTRACTION_CACHE_VERSION`. Bump that
constant whenever extraction output shape changes, or you will serve stale data.
Effect visible as `reusedFiles` vs `analyzedFiles`.

### 2. `CpgShardStore` — per-file CPG shards
`cpg/shardStore.ts` → `.keystone/intelligence/cpg/`, gzipped, manifest-tracked.
Effect visible as `cpgShardsWritten / cpgShardsReused / cpgShardsDeleted`.

### 3. `RevisionGuard` — the big hammer
`ingestion/revisionGuard.ts` → `.keystone/intelligence/revision.json`
Records `{ head, branch, capturedAt }`. On the next run, if Git HEAD or branch
has moved in a way that invalidates cached analysis, the store is discarded and a
clean rebuild happens.

Verified behaviour (`scripts/verify-core.mjs`):
```
PASS revisionGuard: sidecar round-trip, no forced rebuild when gitless
```
Note the gitless case: a workspace with no `.git` returns `undefined` from both
`current()` and `detectMismatch()` — it never forces a rebuild.

### 4. `planIncrementalUpdate()` — what to redo
`pipeline/incremental.ts`. Given `affectedPaths`, produces an
`IncrementalUpdatePlan`. **The full snapshot is still reconciled** — the comment
on `affectedPaths` says so explicitly. Incremental is an optimisation, not a
partial-truth mode.

### Cache reclamation

`ingestion/snapshotPrune.ts`:

| Function | Effect |
|---|---|
| `reclaimSnapshotArchives(root)` | keeps the **newest 1** snapshot archive, deletes the rest; also prunes `.keystone/cache` entries |
| `clearIntelligenceCache(root)` | removes `.keystone/intelligence` entirely → forces a full re-index |

Verified:
```
PASS snapshotPrune: kept 1, removed 4, freed 4.0 MB
PASS clearIntelligenceCache: removed 2.0 MB
```

Both are wired to commands (`keystone.reclaimCache`, `keystone.clearCache`) that
are **currently unreachable from the palette** — see [KI-04](14-known-issues.md).

---

## Concurrency

`pipeline/stageWorkerPool.ts` (`runStageInWorker`) dispatches eligible stages to
`worker_threads` running `pipeline/intelligenceStageWorker.ts`. Bounded by
`maxWorkers` (setting `keystone.intelligence.maxWorkers`, default 5, range 1–16).

Progress is surfaced through `IntelligenceWorkerPoolProgress` so the UI can show
"3 active / 5 max / 8 queued".

---

## Fail-soft and degradation

- Stage throws → status `failed`, `error` recorded, snapshot becomes `degraded`.
- Whole pipeline fails → `emptyRepoIntelligence(workspaceRoot)`
  (`repoIndexer.ts:457`) is used so downstream code always has a valid shape.
- Warnings accumulate in `ingestion.warnings[]` rather than aborting.
- `.keystone/intelligence/activity.json` keeps a rolling event log — **read this
  first when debugging a bad index**.
- `.keystone/intelligence/manifest.json` carries `status: indexing → ready|error`.

---

## Debugging an indexing problem

1. Output panel → **Keystone Intelligence** channel (live log).
2. `.keystone/intelligence/activity.json` (what happened, in order).
3. `.keystone/intelligence/summary.json` → `ingestion` block:
   - `indexedFiles` far lower than expected → an ignore rule is too broad
     (`IGNORED_DIRECTORIES` in `core/platform/config/defaults.ts`, or the
     repo's own `.gitignore`)
   - `reusedFiles` high after a real change → cache version needs bumping
   - `warnings[]` → the actual complaint
4. `.keystone/intelligence/stages/NN-<id>.json` → per-stage output and metrics.
5. Still stuck → `clearIntelligenceCache` and re-index to rule out stale state.

Next: [`07-cpg-and-languages.md`](07-cpg-and-languages.md).
