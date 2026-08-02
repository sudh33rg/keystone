# Keystone — Dead Graph Removal + Stale Intelligence Guard

> **For Hermes:** planning artifact only. No code changed, no verify command run to produce this.

**Goal:** (1) Delete the graph code that was planned but never implemented. (2) Guarantee intelligence is never stale after a repo change or branch switch. (3) Stop `.keystone/intelligence` from hoarding artifacts nothing reads.

**Hard constraint (user-enforced):** **Never touch or disturb OKF & CPG.** No changes to OKF/CPG schema, format, manifest fields, writers, readers, builders, or projections. Specifically off-limits:
`src/core/intelligence/okf/**`, `src/core/intelligence/cpg/**`, and the `repositoryRevision` manifest field.

**Decision taken:** staleness is handled by **a sidecar file outside the OKF directory** *and* **removal of the mtime fast-path** — belt and braces.

---

## 1. Correction to the previous plan (important)

The earlier plan implied the graph UI was dead. **It is not.** There are two independent stacks:

| Stack | Source | Status |
|---|---|---|
| `intelligenceExplorer.ts` → `IntelligenceGraphResult` → `GraphCanvas.tsx` | **OKF projection** | ✅ **LIVE — works** |
| `graph/types.ts` + `graph/graphQuery.ts` + `graph/platformModel.ts` | no producer | ❌ **dead** |

`GraphCanvas.tsx:1` declares its **own local** `VisualGraphNode`; it does not import `graph/types.ts`. Verified: the only cross-references into `src/core/intelligence/graph/` from outside that folder are

```
src/core/platform/storage/types.ts:1              import type { KnowledgeGraph }        (type-only)
src/core/workflow/quality/impactedTests.ts:3      import { findFileEvidence }           (VALUE import)
src/core/workflow/quality/impactedTests.ts:4      import type { GraphNode }             (type-only)
src/core/workflow/modernization/model.ts:2        import type { KnowledgePlatformGraph }(type-only)
src/core/workflow/modernization/modernization-api.ts:2  import type { KnowledgePlatformGraph, KnowledgeNode } (type-only)
```

**Consequence: no UI deletion is required.** The Graph and Flows tabs, all 7 graph modes, `GraphInspector`, and seed-focus all run off OKF and stay exactly as they are.

### Why the dead code is provably unreachable

- `RepoIndex` has **no producer** anywhere in `src/`.
- `findFileEvidence()` is called only from `suggestImpactedTests()` (`impactedTests.ts`).
- `suggestImpactedTests()` is called only from `qaGapAnalysis.ts:886`, inside `analyzeDeep(ctx?, index?)`.
- The sole caller of `analyzeDeep` is `qaService.ts:129`, which passes **only `ctx`** — `index` is always `undefined`.
- Therefore `graphQuery.ts` can never execute. Same for `KnowledgePlatformGraph`: `modernization-api.ts` accepts it in 6 signatures and **no call site ever supplies it** (`grep "knowledgeGraph"` outside those two files returns nothing).

Confirmed zero external references for every sampled export of `graph/types.ts`: `DEFAULT_COMMUNITY_EDGE_WEIGHTS`, `CouplingEdge`, `ExecutionFlow`, `RiskScore`, `TestCodeEdge`, `MemoryDocument`, `Episode`, `TemporalKGEdge`, `EvidenceTrace`, `RELATIONSHIP_TYPES`, `PIPELINE_PHASES`, `LSP_CONFIDENCE_FLOOR`, `ResolvedCall`, `SkipPattern`, `CompressConfig`, `KGSearchResult`, `TaskContext`, `Subgraph`, `TraversalOptions`.

---

## 2. The staleness defect (root cause, verified)

**What works.** `classifyFile()` (`incremental.ts:70`) compares `contentHash` first; on a real content change files classify `structural` and rebuild. Deletions become OKF tombstones (`fromRepoIntelligence.ts:624`). This logic is correct and is **not** being changed.

**What breaks it.** `repoIndexer.ts:107-118` short-circuits *before* any hashing:

```ts
const metadataReusable = Boolean(
  previousFile?.contentHash &&
  previousFile.structuralHash &&
  previousFile.sizeBytes === file.sizeBytes &&
  previousFile.modifiedTimeMs === file.modifiedTimeMs &&
  ...
);
const text = metadataReusable ? undefined : await fs.readFile(file.absolutePath, "utf8");
const contentHash = metadataReusable ? previousFile!.contentHash! : hash(text!);
```

If size **and** mtime match, the file is **never read** and the previous `contentHash` is copied forward. `classifyFile` then compares that stale hash against itself and returns `unchanged`. Git restores mtimes on checkout, and same-size content is routine across branches — so **a branch switch can silently retain stale intelligence**.

**No revision guard exists to catch it.** `repositoryRevision` is declared in the OKF manifest type but is **never populated** — `repoIndexer.ts:390` calls `repoIntelligenceToOkf(intelligence, { previousSnapshot, onWarning })` with no revision. Nothing on disk records which commit the snapshot describes, so no mismatch can be detected. (Fixing this *inside* the manifest is forbidden by the constraint — hence the sidecar.)

---

## 3. The 1.3 GB — measured, and worse than "no retention"

`.keystone/intelligence` for a **137-file** repo:

| Path | Size | Read by any code? |
|---|---|---|
| `snapshots/` (10 runs × ~110 MB) | **1.1 GB** | **NO — zero readers** |
| `okf/` | 112 MB | yes (canonical) |
| `okf-bundle/` | 96 MB | only `.keystone-bundle.json` |
| `snapshot.json` | 14 MB | yes |
| `summary.json` | 9.5 MB | yes |
| `cpg/` | 19 MB | yes |

`store.ts:136-138` writes `snapshots/<runId>` on every promotion; **`grep` finds no reader anywhere in `src/`**. It is write-only ballast — ~85% of the total footprint.

**This satisfies the user's rule directly:** it is not useful for intelligence, so it should be cleaned, not merely gitignored. `.keystone/` is already in `.gitignore` (line 10), so nothing here is a repo-hygiene problem — it is disk and IO.

**Constraint note:** the archive copy is written by `OkfSnapshotStore.write()`, which is inside the no-touch boundary. See §4 D1 for the two options that respect that.

---

## 4. Plan

### Phase A — Delete the dead graph subsystem (no UI change, no OKF/CPG change)

**A1. Remove the three dead core files**
- Delete `src/core/intelligence/graph/types.ts` (1,077 LOC)
- Delete `src/core/intelligence/graph/graphQuery.ts`
- Delete `src/core/intelligence/graph/platformModel.ts` (171 LOC)

**A2. Sever the five importers**
- `src/core/platform/storage/types.ts:1` — drop the `KnowledgeGraph` import and the field it types.
- `src/core/workflow/quality/impactedTests.ts:3-4` — drop `findFileEvidence` + `GraphNode`. This forces the honest decision below.
- `src/core/workflow/modernization/model.ts:2` — drop `KnowledgePlatformGraph` and the optional `knowledgeGraph` field.
- `src/core/workflow/modernization/modernization-api.ts:2` — drop the type import and the 6 always-`undefined` `graph?`/`knowledgeGraph?` parameters (lines ~52, 108, 139, 769, 951, 1034).

**A3. Resolve `impactedTests.ts` honestly**
`suggestImpactedTests()` can never run today. Two options — **needs a decision**:
- **(a) Delete it** plus the dead `index` branch at `qaGapAnalysis.ts:886` and the unused `index?: RepoIndex` parameter on `analyzeDeep`. Smallest, most honest.
- **(b) Reimplement it on OKF** — *read-only* consumption of the existing OKF projection via `intelligenceExplorer`/`queryEngine`, adding no OKF schema or writer changes. Preserves the QA feature.

**A4. Delete the `RepoIndex` type** once A2/A3 land (no producer, no consumer).

**A5. Document it** — one short section in `docs/ONTOLOGY_AND_GRAPH.md`: OKF is the canonical graph, CPG is the second live model, the `KGNode`/`KGEdge` design was never implemented and has been removed.

*Net: ~1,250+ LOC removed. Zero UI files touched. Zero OKF/CPG files touched.*

### Phase B — Kill the stale-read fast-path

**B1.** In `repoIndexer.ts:107-126`, remove `modifiedTimeMs`/`sizeBytes` from the reuse predicate. Always read the file and compute `contentHash`. Keep reuse of *derived* analysis keyed on the freshly computed hash — i.e. `reusable = previousFile?.contentHash === contentHash && previousFile.structuralHash`, which line 128 already expresses. Hashing stays the only correctness gate; expensive semantic re-analysis is still skipped when the hash matches.

**B2.** Keep `modifiedTimeMs` on `RepoFile` (it is persisted and displayed); just stop trusting it for invalidation.

*Cost: one file read per file per index run. Correctness is not negotiable against stale intelligence.*

### Phase C — Revision sidecar (outside OKF)

**C1.** New file `src/core/intelligence/ingestion/revisionGuard.ts` writing **`.keystone/intelligence/revision.json`** — a sibling of `okf/`, never inside it:

```jsonc
{
  "head": "<git rev-parse HEAD>",
  "branch": "<git rev-parse --abbrev-ref HEAD>",
  "dirty": true,
  "indexedAt": "<ISO>",
  "extractionRunId": "<uuid>"   // correlates to OKF without writing to it
}
```

`GitReadOnly` already permits `rev-parse` (`gitReadOnly.ts:4-12`) and `branch()` already exists — **no new git capability, still read-only.**

**C2.** On index start, compare current HEAD/branch to the sidecar. On mismatch → force a full rebuild (`IngestionUpdateAction: "full"`) and surface the reason. This is a decision made *before* `repoIntelligenceToOkf` is called, so OKF is unaffected.

**C3.** Surface staleness in the cockpit: when the sidecar's `head` ≠ current HEAD, show "intelligence is stale — reindexing" rather than presenting old numbers as current. Honest state, no fabricated counts.

**C4.** Exclude `.keystone/**` from the file watcher. `extension.ts:96` watches `**/*` and every write into `.keystone/intelligence` retriggers `queueIntelligenceRefresh` — a self-feeding loop. (Behavioural bug found during this investigation; independent of the rest.)

### Phase D — Reclaim the 1.1 GB

**D1.** `snapshots/` has zero readers. Two constraint-respecting options — **needs a decision**:
- **(a) Prune outside OKF:** a small maintenance routine (invoked by the extension after promotion, living in `src/extension/**`, not in `okf/`) that retains the newest N archives and removes the rest. **Does not modify `store.ts`.** Preferred.
- **(b) Stop writing archives:** the minimal, most honest fix — but it requires editing `OkfSnapshotStore.write()`, which is inside the no-touch boundary. **Only with explicit approval.**

**D2.** Keep `.keystone/` in `.gitignore` (already line 10). Nothing to change.

**D3.** Add a "Clear intelligence cache" command so a user can force-reset without hand-deleting directories.

---

## 5. Files likely to change

| Phase | Files | Boundary |
|---|---|---|
| A | `src/core/intelligence/graph/{types,graphQuery,platformModel}.ts` (delete), `src/core/platform/storage/types.ts`, `src/core/workflow/quality/{impactedTests,qaGapAnalysis}.ts`, `src/core/workflow/modernization/{model,modernization-api}.ts`, `src/extension/core/qaService.ts`, `docs/ONTOLOGY_AND_GRAPH.md` | ✅ outside OKF/CPG |
| B | `src/core/intelligence/ingestion/repoIndexer.ts` (lines 107-128 only) | ✅ ingestion, not OKF |
| C | `src/core/intelligence/ingestion/revisionGuard.ts` (new), `repoIndexer.ts`, `src/core/intelligence/pipeline/incremental.ts`, `src/core/integration/webview/cockpitService.ts`, `src/extension/core/extension.ts` | ✅ sidecar outside `okf/` |
| D | `src/extension/core/extension.ts` (+ small maintenance module), `package.json` (command) | ✅ D1(a) avoids `store.ts` |

**Never touched:** `src/core/intelligence/okf/**`, `src/core/intelligence/cpg/**`, `src/webview/**`.

## 6. Validation

Per normal build-out rule — real output, not description:
- `npm run typecheck` clean (this is the primary gate for A: deleting 1,250 LOC and 5 imports is a type-level change).
- `npm run build` passing.
- `npm run lint`.
- Manual: reindex, confirm Graph + Flows tabs still render (they read OKF, so they must be unaffected — this is the regression check that Phase A did not disturb the live stack).

Staleness acceptance (the point of B+C):
1. Index on `main`, note counts.
2. `git switch` to a branch differing by a **same-size** file → intelligence must rebuild, not report `unchanged`. This is the exact case that fails today.
3. Switch back → sidecar HEAD matches, incremental path still works.
4. Measure `.keystone/intelligence` size before/after D — baseline **1.3 GB / 137 files**.

## 7. Open questions

1. **A3:** delete `suggestImpactedTests` outright, or reimplement it read-only on OKF? *(Decides whether QA impacted-tests survives.)*
2. **D1:** prune `snapshots/` from outside (a), or stop writing archives in `store.ts` (b, needs boundary exception)?
3. Should the "stale → full rebuild" in C2 run automatically, or prompt first on large repos?
4. Is `okf-bundle/` (96 MB, only `.keystone-bundle.json` is read) intended for external consumption? If not, it is the next 96 MB — but shrinking it means touching `bundle.ts`, inside the boundary.
