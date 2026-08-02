# 04 — Code Map

Every source file in the repo, what it does, and how big it is. Use this as
"where is X?".

**Totals:** 132 TypeScript files, **37,731 LOC** across `src/`.

Repo root layout:

```
keystone/
├── src/                    ← all source (132 files)
├── scripts/                ← build + verification (16 .mjs files)
├── docs/                   ← product specs (older) + docs/dev/ (this folder)
├── dist/                   ← build output (gitignored)
├── .vscode/                ← launch.json, tasks.json
├── package.json            tsconfig*.json (4)  prettier.config.js
├── esbuild.config.mjs      vite.config.ts   eslint.config.js   ← all DEAD
└── README.md  SOURCE_DELIVERY.md
```

---

## `src/core/` — domain and application logic (no `vscode` import, ever)

### `core/domain/` — the shared vocabulary

| File | LOC | Purpose |
|---|---:|---|
| `types.ts` | 613 | **The most-imported file in the repo (36 importers).** ~55 exported types: `RepoIntelligence`, `RepoFile`, `CodeSymbol`, `DependencyEdge`, `TestMapping`, `ApiEndpoint`, `ServiceNode`, `SemanticCall`, `ControlFlowFact`, `DataFlowFact`, `TypeRelationshipFact`, `EngineeringEntityFact`, `ContextPack`, `ContextPacket`, `CorrectionPacket`, `QaAnalysis`, `SecurityAnalysis`, `PerformanceAnalysis`, `ModernizationAssessment`, `PrEvidence`, `KeystoneMetrics`, `IntentAnalysis`, `RouteDecision`, … |

Start here when you don't recognise a type name.

### `core/platform/` — infrastructure primitives

| File | LOC | Purpose |
|---|---:|---|
| `config/defaults.ts` | 106 | `KEYSTONE_DIR`, file path constants, `IGNORED_DIRECTORIES` (~50 dirs), `SECURITY_KEYWORDS`, `PERFORMANCE_KEYWORDS`, `MODERNIZATION_KEYWORDS`, `DEFAULT_QA_CHECKLIST` |
| `config/qualityConfig.ts` | 64 | `QAConfig` + `DEFAULT_QA_CONFIG`, `loadConfig()` |
| `storage/jsonStorage.ts` | 38 | `JsonStorage` class, `ensureKeystoneDirectory()` |
| `git/gitReadOnly.ts` | 46 | **Only Git surface.** Read-only. One of 3 files allowed to spawn processes |
| `events/EventBus.ts` | 422 | Canonical event bus: subscriptions, filters, dead-letter, replay, metrics |
| `contracts/domain-model.ts` | 380 | Canonical entity contracts: `CanonicalEntity`, `EngineeringAsset`, `EngineeringRelationship`, `Recommendation`, `Risk`, `Workflow`… |
| `contracts/event-model.ts` | 135 | `CanonicalEvent`, subscription filters, delivery/dead-letter records |
| `metrics/metricsStore.ts` | 62 | Writes `.keystone/metrics.json` |

**⚠️ `contracts/` and `events/EventBus.ts` are lightly wired.** They look like the
foundation of an event-driven architecture that was only partially adopted. Check
importers before assuming they are on a hot path.

### `core/intelligence/ingestion/` — file discovery and structural extraction

| File | LOC | Purpose |
|---|---:|---|
| `repoIndexer.ts` | 783 | **Entry point.** `indexRepository(root, options)` → `RepoIntelligence`. Drives scan → analyse → detectors → OKF build/promote. Emits `onDiscovery`/`onFile`/`onPersistence` progress. `emptyRepoIntelligence()` is the degraded fallback |
| `fileScanner.ts` | 233 | `scanFiles()` recursive walk; binary detection by extension **and** by byte sampling (`bytesRead`, <8% suspicious bytes ⇒ text); `isIgnoredFile()`, `languageForPath()` |
| `gitignore.ts` | 108 | `GitignoreMatcher`, `loadGitignore()` — honours the repo's own `.gitignore` |
| `extractionCache.ts` | 78 | `ExtractionCache` in `.keystone/cache/extractions`; `STRUCTURAL_EXTRACTION_CACHE_VERSION` gates reuse |
| `revisionGuard.ts` | 85 | **Staleness guard.** Records Git HEAD/branch to `.keystone/intelligence/revision.json`. On mismatch (branch switch/checkout) the whole intelligence store is discarded to force a clean rebuild |
| `snapshotPrune.ts` | 178 | `reclaimSnapshotArchives()` (keep newest 1), `clearIntelligenceCache()` — backs the two cache commands |
| `intelligenceStore.ts` | 28 | Thin persistence wrapper |
| `testMapper.ts` | 35 | `isTestPath()`, `mapTests()` — test↔source pairing |
| `serviceMapper.ts` | 30 | `mapService()` — service boundary inference |
| `engineeringEntityDetector.ts` | 317 | Detects DB/table/ORM/query/feature-flag/fixture/CI/infra/component/event entities |
| `securityZoneDetector.ts` | 15 | `detectSecuritySensitiveArea()` via `SECURITY_KEYWORDS` |
| `performancePathDetector.ts` | 9 | `detectPerformanceSensitivePath()` |
| `modernizationCandidateDetector.ts` | 22 | TODO/FIXME/HACK/legacy/deprecated markers |

### `core/intelligence/pipeline/` — the 21-stage analysis pipeline

| File | LOC | Purpose |
|---|---:|---|
| `pipeline.ts` | 1,452 | **The core of the product.** `buildRepositoryIntelligence()` orchestrates all stages; `runIntelligenceStage()` runs one; `STAGES[]` table at line 975; `IntelligencePipelineCancelledError` |
| `types.ts` | 137 | `INTELLIGENCE_STAGES` (21 ids), `INTELLIGENCE_FAMILIES` (6), `RepositoryIntelligenceSnapshot`, `IntelligencePipelineOptions`, progress event types |
| `derivedGraph.ts` | 315 | `analyzeRepositoryGraph()` → hubs, cycles, communities, entry points, flows, orphans; `createGraphImpactAnalyzer()` |
| `findings.ts` | 249 | `buildIntelligenceFindings()` → categorised, severity-ranked findings |
| `health.ts` | 118 | `evaluateIntelligenceHealth()` → coverage/quality report |
| `incremental.ts` | 98 | `planIncrementalUpdate()` → what to re-analyse given file changes |
| `retrieval.ts` | 199 | `retrieveRepositoryIntelligence()` — ranked retrieval over the snapshot |
| `runtime.ts` | 116 | `buildRuntimeVerification()`, `evaluateRemediationGate()`; reads `.keystone/telemetry-map.json` |
| `evolution.ts` | 90 | `buildRepositoryEvolution()` — change history shape |
| `deadCode.ts` | 58 | `analyzeDeadCode()` → unreferenced-symbol candidates |
| `stageWorkerPool.ts` | 41 | `runStageInWorker()` — bounded worker pool |
| `intelligenceStageWorker.ts` | 21 | worker_thread entry (orphan by design) |
| `index.ts` | 10 | barrel re-export of the above |

The 21 stage IDs, in order (`types.ts:21-43`):

```
structural, language-framework, build-script, configuration, symbol,
dependency, api-route, data-persistence, test, call-graph,
code-property-graph, architecture, git-change, impact, context,
sdlc-workflow, risk, security, performance, documentation,
runtime-observability
```

Six families: `repository-structure`, `code-graph`, `build-test-qa`,
`architecture-sdlc`, `context-token`, `runtime-analysis`.

### `core/intelligence/okf/` — the canonical knowledge model ★

| File | LOC | Purpose |
|---|---:|---|
| `types.ts` | 185 | `KeystoneOkfSnapshot`, `KeystoneKnowledgeUnit/Relationship/Observation`, `OkfEvidence`, `OkfProvenance`, 28 unit kinds, 17 relationship kinds, `OkfCanonicalEvidenceEnvelope` |
| `profile.ts` | 306 | `KEYSTONE_OKF_PROFILE` — the schema: allowed kinds, relationship constraints, `KEYSTONE_OKF_PROFILE_DIGEST` |
| `fromRepoIntelligence.ts` | 893 | **The projection.** `repoIntelligenceToOkf()` converts `RepoIntelligence` → OKF snapshot; `workspaceIdForRoot()` |
| `store.ts` | 186 | `OkfSnapshotStore` — read/write/**atomic promotion**, projections, archive, `current.json` |
| `serialization.ts` | 29 | `serializeOkfSnapshot()` → the 7 files; **validates and throws on invalid** |
| `validation.ts` | 204 | `validateOkfSnapshot()` → profile conformance, referential integrity |
| `projections.ts` | 109 | `projectOkfGraph()`, `projectOkfSearch()`, `projectCpgBindings()` |
| `queryEngine.ts` | 674 | `queryOkfSnapshot()` — intent-classified graph traversal with plan + evidence |
| `bundle.ts` | 544 | `writePortableOkfBundle()` — full Markdown mirror with frontmatter, indexes, cross-links; `validatePortableOkfBundle()` |
| `canonicalContext.ts` | 138 | `selectCanonicalContext()`, `canonicalEvidenceEnvelope()`, `canonicalRetrievalResult()` — provenance for derived artifacts |
| `identity.ts` | 18 | `createOkfId()`, `canonicalRelationshipKey()` — stable IDs that never leak absolute paths |

### `core/intelligence/cpg/` — Code Property Graph

| File | LOC | Purpose |
|---|---:|---|
| `typescriptSemantic.ts` | 469 | `analyzeTypeScriptProject()` and `…Isolated()` — real TS compiler type-checker; resolves call edges, callbacks, type relationships |
| `universalCpgBuilder.ts` | 301 | `buildUniversalCpg()` — deterministic CPG for non-TS languages |
| `typescriptCpgBuilder.ts` | 275 | `buildTypeScriptCpg()` — TS-specific CPG |
| `shardStore.ts` | 131 | `CpgShardStore` — per-file gzipped shards in `.keystone/intelligence/cpg/`, manifest-tracked |
| `types.ts` | 54 | `CpgNode`, `CpgEdge`, `CpgNodeKind`, `CpgEdgeKind`, `CodePropertyGraph` |
| `typescriptSemanticWorker.ts` | 22 | worker_thread entry (orphan by design) |
| `index.ts` | 23 | barrel |

### `core/intelligence/languages/` — multi-language support

| File | LOC | Purpose |
|---|---:|---|
| `languageRegistry.ts` | 271 | `LANGUAGE_DEFINITIONS` — **40+ languages** with extensions, capability level, parser, frontend grammar family; `LanguageCapabilityRegistry`; `UNIVERSAL_TEXT_DEFINITION` fallback |
| `languageAnalysis.ts` | 422 | `analyzeLanguageFile()` — dispatch to the right frontend |
| `structuralParser.ts` | 362 | `parseStructuralSyntax()` — deterministic brace/indent/markup grammar parser |
| `semanticEnrichment.ts` | 68 | `SemanticEnrichmentProvider` **interface** — the seam VS Code language services plug into |

### `core/intelligence/` — the rest

| File | LOC | Purpose |
|---|---:|---|
| `explorer/intelligenceExplorer.ts` | 746 | `exploreOkfSnapshot()`, `buildOkfGraphView()`, `buildCpgExplorerResult()` — **feeds the UI graph directly off the OKF projection** |
| `analysis/analyzer.ts` | 367 | `analyzeRepositorySecurity()`, `analyzeRepositoryPerformance()` — used by background workers |
| `analysis/model.ts` | 33 | `RepositoryInsight`, `RepositoryInsightReport` |
| `repository/model-builder.ts` | 488 | `RepositoryModelBuilder.buildFromIntelligence()` → richer `RepositoryModel` |
| `repository/model.ts` | 212 | `RepositoryModel` and ~24 supporting interfaces |

### `core/context/` — intent understanding and context assembly

| File | LOC | Purpose |
|---|---:|---|
| `intentContextBuilder.ts` | 919 | **`buildIntentContextPack()`** — ranks/selects/compresses context. Honours `compressionTier: off \| standard \| aggressive` |
| `IntentClassifier.ts` | 364 | `classifyIntent()` — rule-based, produces confidence signals |
| `promptEnhancer.ts` | 228 | `enhanceIntent()` — multi-turn intent refinement sessions |
| `copilotCustomizations.ts` | 117 | `discoverCopilotCustomizations()` — finds repo Copilot agents/skills/instructions |
| `routing/intentRouter.ts` | 103 | `routeIntent()` |
| `routing/routingPolicy.ts` | 23 | `routeForIntent()` |
| `tokenEstimator.ts` | 3 | `estimateTokens()` — a heuristic divide |
| `compression/` | — | **EMPTY DIRECTORY.** `types.ts` was deleted; the dir remains |

### `core/workflow/` — SDLC, agents, quality, handoff

| File | LOC | Purpose |
|---|---:|---|
| `sdlc/engine.ts` | 1,461 | `SDLCEngine` — 16 story types, 13 statuses, research/spec documents, delegation, validation, findings |
| `sdlc/store.ts` | 67 | `SDLCPlanStore` → `.keystone/state/sdlc/active-plan.json`, `.keystone/state/intents/` |
| `tasks/taskWorkspaceManager.ts` | 711 | `TaskWorkspaceManager` — creates `.keystone/tasks/NNNN_slug/` with 13 files each |
| `handoff/contracts.ts` | 197 | `TaskStatePackage` schema v2.0.0, 6 typed error classes, `MANUAL_SYNC_CONFIRMATION` |
| `handoff/taskStatePackage.ts` | 334 | `TaskStatePackageBuilder`, `canonicalJson()`, `packageChecksum()`, `verify…`, `migrate…` |
| `handoff/handoffSecurity.ts` | 182 | **scrypt + AES-256-GCM**, `scanAndRedact()`, `assertNoHighConfidenceSecrets()`, `safeChecksumEqual()` |
| `quality/qaGapAnalysis.ts` | 1,025 | `GapAnalyzer` — coverage gap detection, module scoring, recommendations |
| `quality/testDiscovery.ts` | 523 | `discoverTests()` — framework detection |
| `quality/testExecution.ts` | 393 | `executeTests()`, `executeTestsParallel()` — **process-spawn allow-listed** |
| `quality/coverageMapping.ts` | 360 | `CoverageIndexManager`, `VitestAdapter`, `JestAdapter` |
| `quality/flakyDetection.ts` | 380 | `detectFlakyTests()`, `classifyFailure()` |
| `quality/riskScoring.ts` | 295 | `computeRiskScores()`, tiering helpers |
| `quality/generation.ts` | 219 | `generateTests()` — scenario/strategy scaffolds |
| `quality/quarantine.ts` | 154 | `createQuarantineStore()` → `.keystone/flaky_tests.json` |
| `quality/impactedTests.ts` | 143 | `suggestImpactedTests()` |
| `quality/failureRemediation.ts` | 106 | `planFailureRemediation()` |
| `quality/cancellation.ts` | 12 | `cancellationFromAbortSignal()` |
| `quality/test-runtime/TestRunnerDetection.ts` | 317 | Detect commands from package.json/pom/gradle/pyproject/go.mod |
| `quality/test-runtime/types.ts` | 41 | test-command types |
| `agents/securityAgent.ts` | 194 | `SecurityAgent` |
| `agents/performanceAgent.ts` | 218 | `PerformanceAgent` |
| `agents/captainAgent.ts` | 124 | `CaptainAgent` — coordination |
| `agents/qaAgent.ts` | 122 | `QaAgent` |
| `agents/prEvidenceAgent.ts` | 71 | `PrEvidenceAgent` — read-only PR evidence |
| `agents/modernizationAgent.ts` | 47 | `ModernizationAgent` |
| `agents/canonicalTaskEvidence.ts` | 33 | `canonicalGraphDigest()`, `canonicalRiskAreas()` |
| `modernization/modernization-api.ts` | 1,499 | `ModernizationPlatformApi` — propose/decide/plan/govern |
| `modernization/model.ts` | 346 | ~35 modernization interfaces |
| `modernization/pattern-library.ts` | 78 | `MODERNIZATION_PATTERNS` |
| `validation/validationCommands.ts` | 289 | `detectValidationCommands()` |
| `validation/validationParser.ts` | 235 | `parseValidationOutput()` |
| `validation/validationRunner.ts` | 80 | `runValidationCommand()` — **process-spawn allow-listed** |
| `orchestration/workflow-api.ts` | 54 | `WorkflowApi` |
| `orchestration/model.ts` | 55 | workflow run/step types |

### `core/integration/` and `core/application/`

| File | LOC | Purpose |
|---|---:|---|
| `integration/webview/cockpitService.ts` | 2,900 | **God object #2.** Per-workspace façade over everything in core |
| `integration/webview/messageRouter.ts` | 530 | **The message protocol contract** + `KeystoneWebviewState`, `KeystoneTaskResult`, `WorkspaceSummary` |
| `integration/valueedge/client.ts` | 182 | `ValueEdgeClient` — the only outbound network client |
| `integration/valueedge/types.ts` | 37 | connection/feature/publish types, `FetchLike` injection seam |
| `integration/valueedge/index.ts` | 2 | barrel |
| `application/applicationStore.ts` | 108 | `ApplicationStore` — versioned shared UI state, subscribe/broadcast |

---

## `src/extension/` — VS Code host adapter

| File | LOC | Purpose |
|---|---:|---|
| `core/extension.ts` | 147 | **`activate()` / `deactivate()`** — the entry point |
| `core/qaService.ts` | 235 | `QaService` — background QA event source |
| `core/backgroundWorkerCoordinator.ts` | 143 | Spawns the 4 analysis workers, 120s timeout, generation guard |
| `core/statusBar.ts` | 14 | `createStatusBar()` |
| `ui/vscodeProvider.ts` | 2,366 | **God object #1.** Webview lifecycle + `handleMessage()` chain + orchestration |
| `ui/vscodeHtml.ts` | 43 | `getWebviewHtml()` — nonce-based CSP HTML |
| `commands/indexCommands.ts` | 39 | Registers 7 declared commands |
| `commands/cacheMaintenance.ts` | 48 | Registers `keystone.reclaimCache` / `keystone.clearCache` (**undeclared** — see KI-04) |
| `workers/backgroundAnalysisWorker.ts` | 133 | worker_thread body for qa/security/performance/modernization |
| `browser-view/browserViewServer.ts` | 408 | `node:http` server: bootstrap token → session cookie → SSE `/events` + `POST /command` |
| `intelligence/vscodeLanguageServiceEnricher.ts` | 212 | Implements `SemanticEnrichmentProvider` using VS Code language services |
| `task-handoff/taskStateRestorer.ts` | 86 | `TaskStateRestorer`, `WorkspaceStateTaskStore`, `continuationBriefing()` |
| `types/messageRouter.ts` | 6 | pure re-export of the core contract |

---

## `src/webview/` — the React UI

| File | LOC | Purpose |
|---|---:|---|
| `App.tsx` | 2,822 | **One React class component.** All navigation, all views, all handlers |
| `model.ts` | 567 | **Hand-mirrored copy** of the core protocol types (see KI-05) |
| `GraphCanvas.tsx` | 216 | `GraphCanvas` + `VisualGraphNode`/`VisualGraphEdge` — its own visual model, fed from the OKF projection |
| `vscodeApi.ts` | 76 | **The only surface-aware file.** `postMessage` vs `fetch`+SSE, state-version concurrency |
| `main.tsx` | 5 | `ReactDOM.render(<App/>, #root)` |
| `react-globals.d.ts` | 47 | Declares global `React`/`ReactDOM` (classic JSX runtime + UMD) |
| `index.html` | — | Browser View shell (strict CSP, `'self'` only) |
| `theme.css` | — | copied to `dist/media/webview.css` |

## `src/types/` — vendored ambient types

| File | LOC | Purpose |
|---|---:|---|
| `vscode/index.d.ts` | 227 | **Hand-written partial VS Code API stub.** Extend this when you need a new API |
| `vscode-test-electron/index.d.ts` | 11 | stub for a test runner that isn't installed |

---

## `scripts/` — build and verification

| File | Purpose |
|---|---|
| `build.mjs` | The whole build (see [`02`](02-build-system.md)) |
| `clean.mjs` | rm dist/out/.runtime-check/.test-dist |
| `lint.mjs` | Custom lint gate (prohibited patterns + alias resolution) |
| `check-active-boundary.mjs` | Reachability, lockfile, no-caps, Git-read-only assertions |
| `verify-core.mjs` | revisionGuard + snapshotPrune + clearIntelligenceCache |
| `verify-call-resolution.mjs` | Call-graph resolution correctness |
| `verify-graph-stack.mjs` | OKF → explorer → GraphCanvas is the live path |
| `verify-final.mjs` | 40 KB cross-feature harness over ~15 built modules |
| `verify-production-acceptance.mjs` | Copies the repo to a temp dir, runs full acceptance |
| `verify-production-cockpit.mjs` | Child process used by the above |
| `verify-vsix.mjs` | VSIX contents assertions (needs `unzip`) |
| `package-vsix.mjs` | Stages and zips the VSIX |
| `package-project.mjs` | Source-only archive |
| `evidence-browser.mjs` | Browser View evidence capture |
| `test.mjs` | Present, but no test framework is installed |

---

## Finding things fast

| I want… | Go to |
|---|---|
| a type name I don't recognise | `core/domain/types.ts`, then `okf/types.ts` |
| where a webview message is handled | `grep -n '"MESSAGE_NAME"' src/extension/ui/vscodeProvider.ts` |
| what a feature actually does | its method on `core/integration/webview/cockpitService.ts` |
| how a stage computes its output | `core/intelligence/pipeline/pipeline.ts:975` (`STAGES[]`) |
| what gets written to disk | `grep -rn '"\.keystone"' src --include=*.ts` |
| where a language is configured | `core/intelligence/languages/languageRegistry.ts:120` |
| what the UI renders | `src/webview/App.tsx` (one component — use your editor's outline) |

Next: [`05-data-model-okf.md`](05-data-model-okf.md).
