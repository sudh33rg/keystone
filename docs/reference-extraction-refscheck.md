# refs/check Extraction Matrix & Plan

This document records additive reuse candidates from `/Users/sudheer/workspace/refs/check`
without importing runtime dependencies or changing existing TS types.

## 1. Inventory & Signal Summary

| Repo | Top-level domain | Reusable granularity | Overall signal |
| --- | --- | --- | --- |
| `QA-Automation/tdad-ts-main` | test-impact analysis | Small utilities + algorithm patterns | **High** |
| `Code-Intelligence/code-review-graph-main` | review graph + RAG | Graph traversal, context-saving patterns, scoring | **High** |
| `Code-Intelligence/codegraph-main` | semantic code graph | TS graph queries/traversals | **Medium** |
| `Memory-Handoff/the-librarian-main` | memory + handoff | Markdown memory primer + verb surface | **Medium** |
| `Token-Compression/headroom-main` | context compression | Policy/mask/safety patterns | **Medium** |
| `Governance-Security/open-code-review-main` | policy review | Finding/review schema concepts | **Medium** |
| `Code-Understanding/codebase-memory-mcp-main` | memory RAG | Merge/disambiguation logic | **Low–Medium** |
| `Code-Intelligence/RepoGraph-main` | repo graph | Token-aware ranking concept | **Low** |
| `Memory-Handoff/8mem-main` | agent memory | Memory template taxonomy | **Low** |
| `Code-Understanding/Understand-Anything-main` | knowledge graph | Merge heuristics + planning docs | **Low** |

**Repos skipped from deep analysis:**
- `AI-Agent-Frameworks/*`, `AI-Gateway-Routing/*`, `Miscellaneous/*`
  - Pure agent runtimes, gateway routers, or demo apps; not additive to Keystone’s Copilot-first, deterministic surface.

## 2. High-Value Pattern Candidates

### 2.1 `tdad-ts-main`: pure-TS impact utilities
Files: `src/test-detect.ts`, `src/impact.ts`, `src/test-linker.ts`, `src/graph.ts`
Reuse value: **High**

| Pattern | Why it fits Keystone | Estimated effort |
| --- | --- | --- |
| `isTestPath` + `testStem` | Zero-dep heuristic for TS/JS test files across layouts | Trivial |
| Weighted score fusion `scoreOf(config)` | Portable aggregator for multi-signal scoring (churn, lint noise, test health) | Trivial |
| Test→source linker tiers | Robust pairing for impact scoping and pre-commit filters | Medium |
| Typed bi-directional graph with dedup keys | Deterministic graph primitive if Keystone adds file/import/call edges | Medium |
| Dual-frontier BFS | Narrow change-impact reachability using `IMPORTS` then `CALLS` | Medium–High |

Constraints:
- Additive only: new utility modules, no schema breakage.
- No new runtime dependencies.

### 2.2 `code-review-graph-main`: context savings + impact scoring
Files: `code_review_graph/context_savings.py`, `impact_accuracy.py`, `graph.py`, `search.py`
Reuse value: **High**

| Pattern | Why it fits Keystone | Estimated effort |
| --- | --- | --- |
| Token-aware context selection | Mirrors Keystone’s bounded context construction; borrow rules, not Python runtime | Medium |
| Review-finding relevance scoring | Adds a portable scoring template for review/impact triage | Medium |
| Incremental graph diffing | Improves efficiency of `RepositoryIndexService.reconcile()` if graph grows | Medium–High |

Constraints:
- Any extracted rules must be expressed in TS without new external packages.

### 2.3 `codegraph-main`: TS graph primitives
Files: `src/graph/index.ts`, `src/graph/queries.ts`, `src/graph/traversal.ts`
Reuse value: **Medium**

| Pattern | Why it fits Keystone | Estimated effort |
| --- | --- | --- |
| Traversal helpers | Complementary to `IntelligenceQueryService` if graph queries grow | Medium |
| Query compilation | Could inform query caching layers | Medium |

Constraints:
- Avoid duplicating existing `FuseSearchService` / `QueryEngine` behavior.

### 2.4 `the-librarian-main`: memory + handoff primer
Files: `packages/core/src/primer.ts`, `integrations/*/commands/handoff.md`
Reuse value: **Medium**

| Pattern | Why it fits Keystone | Estimated effort |
| --- | --- | --- |
| Markdown primer template | Agent-usable instruction format for knowledge/handoff surfaces | Low |
| Memory + handoff verb taxonomy | Naming reference for `HandoffPersistenceStore` extensions | Low |

Constraints:
- Keep primer inert-default; do not wire into core flow unless explicitly requested.

### 2.5 `headroom-main`: compression policy + safety rails
Files: `headroom/compression_policy.py`, `masks.py`, `transforms/*`
Reuse value: **Medium**

| Pattern | Why it fits Keystone | Estimated effort |
| --- | --- | --- |
| Compression policy metadata | Deterministic configuration shape for `ContextCompressionEngine` | Medium |
| Safety rail masks | Hard-block patterns for sensitive content during compression | Medium |

Constraints:
- Must remain additive to existing ContextCompressionEngine.

### 2.6 `open-code-review-main`: review/policy findings
Files: `internal/model/review.go`, `cmd/opencodereview/*review*.go`
Reuse value: **Medium**

| Pattern | Why it fits Keystone | Estimated effort |
| --- | --- | --- |
| Finding → policy → remediation chain | Structural reference for `ReviewCompletionService` | Medium |
| Severity + confidence tuple | Lightweight annotation for existing review findings | Low |

Constraints:
- Implementation must stay in TS contracts and services.

## 3. Recommended Phased Extraction Plan

### Phase A — Low-risk utilities from `tdad-ts`
Target files: none yet; add new files only.
- Add `src/core/shared/pathUtils.ts` for test-file detection heuristics
- Add `src/core/shared/scoring.ts` for weighted score fusion
- Wire scoring into `ValidationOutputReducer.ts` as an optional helper
- Gate: `npx tsc --noEmit` and targeted `npm test` must stay green

### Phase B — Graph query improvements
Candidates:
- `tdad-ts` bidirectional graph primitive, if `IntelligenceQueryService` needs file/import/call edges
- `codegraph-main` traversal helpers, if needed

Gate: do not duplicate `QueryEngine` or `FuseSearchService`.

### Phase C — Review/impact scoring enrichment
Candidates:
- `tdad-ts` impact tier model → `TaskValidationService`
- `code-review-graph-main` relevance scoring → review workspace UI hints

Gate: additive fields only on existing schemas (`ValidationPlan`, `ReviewFinding`).

### Phase D — Memory/handoff primer + compression policy metadata
Candidates:
- `the-librarian-main` primer format → docs
- `headroom-main` policy structure → `ContextCompressionEngine` configuration schema

Gate: inert by default, behind existing config flags.

## 4. Skipped / Low-Value Extractions

Pattern | Reason to skip
---|---
Full orchestration or agent runtimes | Duplicates existing `OrchestrationService` and re-introduces non-deterministic routing
Local-model / LM provider wrappers | Out of scope; Keystone is Copilot-centric
Whole webview screens or legacy message routers | Existing webview contract system is stronger and typed
`RepoGraph` Python graph builder | Requires `networkx`, `tree-sitter-languages`, `grep-ast`; heavier than needed

## 5. Next Decision Point

Confirm whether to:
1. Start **Phase A** (`tdad-ts` utilities) now, or
2. Re-prioritize to **Phase B/C** because review/impact scoring is the current priority.
