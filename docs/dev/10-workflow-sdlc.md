# 10 — SDLC Workflow

The workflow layer is what turns "I want to add rate limiting" into an
evidence-backed, human-approved prompt for Copilot — and then checks the result.

Primary source: `src/core/workflow/sdlc/engine.ts` (1,461 LOC).

---

## The lifecycle

```
user types an intent
   │
   ▼
IntentClassifier.classifyIntent()          core/context/IntentClassifier.ts
   │  (rule-based, no LLM)
   ▼
routeIntent()                               core/context/routing/intentRouter.ts
   │
   ▼
SDLCEngine.createPlan(intent)               → SDLCPlan with a story backlog
   │
   ├─► research story    → SDLCResearchDocument   (evidence-backed)
   │       │
   │       └─ APPROVE_INTENT_RESEARCH  ◄── human gate #1
   │
   ├─► specification story → SDLCSpecificationDocument
   │       │
   │       └─ approveSpecification() / rejectSpecification()  ◄── human gate #2
   │
   ├─► implementation stories …
   │       │
   │       ├─ prepareDelegation()   builds the Copilot prompt + context pack
   │       │
   │       └─ approveDelegation()   ◄── human gate #3  (nothing leaves without this)
   │              │
   │              ▼
   │       ┌──────────────┐
   │       │   COPILOT    │  ← the only place code is generated
   │       └──────────────┘
   │              │
   │       completeDelegation()
   │              │
   │              ▼
   │       recordValidation()   ← runs real test/lint/build commands
   │              │
   │       recordFinding() / resolveFinding()
   │
   └─► completion story → isComplete()
```

Three explicit human approval gates. This is a product principle, not an
accident: Keystone never delegates without a person saying yes.

---

## Story types (16)

`SDLCStoryType` (`sdlc/engine.ts`):

| Group | Types |
|---|---|
| Discovery | `research`, `specification`, `design` |
| Build | `development` |
| Test | `existing-test-analysis`, `new-test-creation`, `test-impact-analysis`, `failed-test-investigation`, `flaky-test-analysis` |
| Review | `security-review`, `performance-review`, `modernization-review`, `code-review`, `pr-review` |
| Close | `documentation`, `completion` |

## Story statuses (13)

`SDLCStoryStatus`:

```
draft → ready → in-progress → awaiting-delegation-approval → delegated
      → awaiting-validation → review-required → completed
```

Off-ramps: `blocked`, `paused`, `cancelled`, `superseded`, `handed-off`.

`handed-off` is the terminal state when a task is exported as an encrypted
task-state package ([`11-task-handoff.md`](11-task-handoff.md)).

## `SDLCEngine` public API

| Method | Purpose |
|---|---|
| `createPlan(intent)` | build the plan + story backlog |
| `approveSpecification()` / `rejectSpecification()` | human gate #2 |
| `transition(storyId, status, …)` | move a story; validates legality |
| `recordEvidence(...)` | attach evidence to a story |
| `prepareDelegation(...)` | assemble prompt + context pack + skills + instructions |
| `approveDelegation(...)` | human gate #3 |
| `completeDelegation(...)` | record the outcome |
| `recordValidation(...)` | attach a validation run |
| `recordFinding(...)` / `resolveFinding(...)` | findings lifecycle |
| `isComplete()` | plan-level completion check |

Supporting exports: `SDLCDelegation`, `SDLCValidationRun`, `SDLCFinding`,
`SDLCStoryUpdate`, `SDLCStory`, `SDLCResearchEvidence`, `SDLCResearchDocument`,
`SDLCSpecificationDocument`, `SDLCBacklogStory`, `SDLCPlanningContext`,
`SDLCPlan`, plus `createResearchDocument()` and `restoreSpecificationDocument()`.

### Persistence

`sdlc/store.ts`:
```
.keystone/state/sdlc/active-plan.json     the plan
.keystone/state/intents/                  per-intent records
```

The transition to `SDLC_TRANSITION` from the UI carries `evidence[]`,
`satisfiedCriteria[]`, and `blockers[]` — the engine records *why* a status
changed, not just that it did.

---

## Context assembly

`core/context/intentContextBuilder.ts` (919 LOC) — `buildIntentContextPack()`.

This is where "unbounded knowledge, bounded prompt" is implemented. It ranks and
selects OKF material relevant to the intent and compresses to a budget.

```ts
compressionTier: "off" | "standard" | "aggressive"     // default "standard"
```

Set per workspace in settings; threaded through
`cockpitService.ts:506/558/1992` and stored on the run
(`run.contextPack.compressionTier`).

Token accounting uses `core/context/tokenEstimator.ts` — a **3-line heuristic
divide**, not a real tokenizer. Treat its numbers as indicative.

**⚠️ `core/context/compression/` is an empty directory.** Its `types.ts` was
deleted; compression logic now lives inside `intentContextBuilder.ts`. The empty
dir is cruft ([KI-06](14-known-issues.md)).

### Copilot customisation discovery

`core/context/copilotCustomizations.ts` — `discoverCopilotCustomizations()`
finds agents/skills/instruction files already present in the target repo so the
delegation prompt can reference them rather than duplicating them.

### Prompt enhancement sessions

`core/context/promptEnhancer.ts` — `enhanceIntent()` supports multi-turn
refinement before a plan is created. Sessions persist to
`.keystone/context/sessions/`, exposed via `ENHANCE_INTENT`,
`LOAD_ENHANCEMENT_SESSIONS`, `DELETE_ENHANCEMENT_SESSION`.

### Context packets and correction packets

- **Context packet** — the material handed to Copilot. Segment kinds:
  `"summary" | "selected-intelligence" | "source-excerpts"`. Retrieved by the UI
  via `LOAD_CONTEXT_PACKET`, which reports `stale`, `snapshotDigest`, and
  `currentSnapshotDigest` so the user can see when a packet predates the current
  index.
- **Correction packet** — feedback after a bad generation, produced by
  `REQUEST_CORRECTION_PACKET` and stored per task in
  `.keystone/tasks/NNNN_slug/correction-packets.json`.

Feedback ratings (`RECORD_CONTEXT_FEEDBACK`):
`"useful" | "irrelevant" | "helpful" | "unhelpful"` → `.keystone/context/feedback.json`.

---

## Validation

Three modules, and this is one of the few places Keystone runs processes.

| File | Role |
|---|---|
| `workflow/validation/validationCommands.ts` | `detectValidationCommands()` — infer test/lint/build commands from the repo |
| `workflow/validation/validationRunner.ts` | `runValidationCommand()` — **process-spawn allow-listed** |
| `workflow/validation/validationParser.ts` | `parseValidationOutput()` — structured results from raw output |

Triggered by `RUN_VALIDATION` with `scope: "impacted" | "all"`. Results persist to
`.keystone/validation/latest.json` and return as `VALIDATION_RESULT`.

`REINDEX_AFFECTED_AND_VALIDATE` is the combined "re-index what changed, then
validate" action.

---

## Quality subsystem

`core/workflow/quality/` — 3,700+ LOC, the largest cluster after intelligence.

| File | LOC | Role |
|---|---:|---|
| `qaGapAnalysis.ts` | 1,025 | `GapAnalyzer` — coverage gaps, module scoring, recommendations. `analyzeQuick({ changedPaths })` is what the QA background worker calls |
| `testDiscovery.ts` | 523 | `discoverTests()` — find tests and their framework |
| `testExecution.ts` | 393 | `executeTests()`, `executeTestsParallel()` — **process-spawn allow-listed** |
| `coverageMapping.ts` | 360 | `CoverageIndexManager` + `VitestAdapter` + `JestAdapter` → `.keystone/coverage_index.json` |
| `flakyDetection.ts` | 380 | `detectFlakyTests()`, `classifyFailure()` |
| `riskScoring.ts` | 295 | `computeRiskScores()` |
| `generation.ts` | 219 | `generateTests()` — scenario scaffolds |
| `quarantine.ts` | 154 | `.keystone/flaky_tests.json` |
| `impactedTests.ts` | 143 | `suggestImpactedTests()` |
| `failureRemediation.ts` | 106 | `planFailureRemediation()` |
| `cancellation.ts` | 12 | `cancellationFromAbortSignal()` |
| `test-runtime/TestRunnerDetection.ts` | 317 | detect commands from package.json / pom.xml / build.gradle / pyproject.toml / go.mod |

---

## Agents

`core/workflow/agents/` — **not LLM agents.** These are deterministic analysis
roles that produce structured findings.

| Agent | LOC | Produces |
|---|---:|---|
| `PerformanceAgent` | 218 | performance findings |
| `SecurityAgent` | 194 | security findings |
| `CaptainAgent` | 124 | coordination / sequencing |
| `QaAgent` | 122 | QA findings |
| `PrEvidenceAgent` | 71 | read-only PR evidence |
| `ModernizationAgent` | 47 | modernization findings |

`agents/canonicalTaskEvidence.ts` provides `canonicalGraphDigest()` and
`canonicalRiskAreas()` so agent output is tied to a specific OKF snapshot.

---

## Background analysis workers

Four `worker_threads`, spawned by
`extension/core/backgroundWorkerCoordinator.ts` after a **new promoted OKF
snapshot**:

| Kind | Runs |
|---|---|
| `qa` | `createGapAnalyzer(...).analyzeQuick({ changedPaths })` |
| `security` | `analyzeRepositorySecurity(root, { scopePaths })` |
| `performance` | `analyzeRepositoryPerformance(root, { scopePaths })` |
| `modernization` | `RepositoryModelBuilder` → `ModernizationPlatformApi().propose()` |

Contract details that matter:

- Input carries `canonicalEvidence: Record<kind, OkfCanonicalEvidenceEnvelope>`;
  each worker is **scoped to `evidence.paths`**, not the whole repo.
- Every result is stamped with `withCanonicalEvidence()`
  (`backgroundAnalysisWorker.ts:51`) so it is traceable to the snapshot.
- **120,000 ms hard timeout per worker.** On timeout the coordinator terminates
  it, writes a `workerStatus: "failed"` record, and explicitly notes "other
  workers continue".
- A `generation` counter discards events from superseded runs.
- Results land in `.keystone/background/<kind>.json`, written atomically.
- Status reaches the UI as `QA_BACKGROUND_STATUS` (qa) and
  `BACKGROUND_ANALYSIS_STATUS` (the other three).

🔴 The QA/security/performance/modernization worker contract was recently
reworked (both files are heavily modified vs `HEAD`); the current shape
typechecks cleanly. See [KI-00](14-known-issues.md#ki-00) about the uncommitted
state.

---

## Modernization

`core/workflow/modernization/modernization-api.ts` (1,499 LOC) —
`ModernizationPlatformApi` with propose / decide / plan / govern.

- `MODERNIZATION_PATTERNS` in `pattern-library.ts` (78 LOC) is the catalogue.
- `ANALYZE_MODERNIZATION` → `MODERNIZATION_PROPOSAL`, persisted to
  `.keystone/modernization/proposal.json`.
- `ACCEPT_MODERNIZATION` (with a `ModernizationDecisionInput`) → `MODERNIZATION_PLAN`
  → `.keystone/modernization/plan.json`.
- Accepting a plan creates a task workspace via
  `TaskWorkspaceManager.createFromModernizationPlan(...)`.

---

## ValueEdge integration (optional)

`core/integration/valueedge/client.ts` (182 LOC) — the **only outbound network
client in the entire product**.

- Config: `keystone.valueEdge.baseUrl / sharedSpaceId / workspaceId / clientId`.
- The client **secret** goes into VS Code `SecretStorage`, never into settings or
  `.keystone/`.
- `FetchLike` is an injected dependency (`valueedge/types.ts`) — that is the seam
  used to test the client without a network.
- Commands: `keystone.configureValueEdge`, `keystone.importValueEdgeFeature`,
  `keystone.publishValueEdgeStories`.

If ValueEdge is unconfigured, everything else works — it is genuinely optional.

Next: [`11-task-handoff.md`](11-task-handoff.md).
