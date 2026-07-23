# Reference Extraction — Phased Implementation Plan

> Non-breaking, additive changes only. No new external dependencies.
> Each phase adds internal services/fields; it does not replace existing types.

## Phase 0 — Audit & Index
Status: completed

- Mapped `src/` to `/Users/sudheer/workspace/refs/check` reference repos.
- Identified that many reference features are already present in Keystone.
- Primary gaps: metadata telemetry, context savings estimator, output reducers,
  execution budget/loop guards, handoff schema enrichment, approval expiry.

## Phase 1 — Minimal Additive Contracts & Policy
Status: completed
Target areas:
- `src/core/approval/ApprovalService.ts`
- `src/shared/contracts/execution.ts`

Additions:
- Approval expiry auto-reject path (`expiryMinutes` -> `expiry` + `autoRejectExpired`)
- Execution budget metadata fields (`totalExecutionBudgetMs`, `executionAttemptCount`)
- Context savings metadata shape (`baselineTokens`, `estimatedTokensSaved`)

Verification:
- targeted unit tests under `tests/unit/validation`, `tests/unit/execution`
- full `npm test` suite green: **850/850 passed**

## Phase 2 — Output Reduction & Context Dedupe
Status: completed
Target areas:
- `src/core/validation/ValidationOutputReducer.ts`
- `src/core/impactQa/ControlledCommandRunner.ts`

Additions:
- CLI/test/lint output reducer rules inspired by `rtk`
- Tee-on-failure semantics for validation output tails

Verification:
- full `npm test` suite green: **850/850 passed**

## Phase 3 — Intelligence Enrichment
Status: completed
Target areas:
- `src/core/intelligence/services/ArchitecturalHotspotService.ts`
- `src/core/review/ReviewPrPackageService.ts`

Additions:
- Architecture hotspot scoring (hub/bridge/surprise) as additive query helpers
- Review-context token-budget wrapper using `context_savings` metadata

Verification:
- new service compiles and tests pass
- targeted unit tests green: **17/17 passed**
- full `npm test` suite green: **850/850 passed**

## Phase 4 — Handoff & Progressive Disclosure
Status: completed
Target areas:
- `src/shared/contracts/handoff.ts` — `TaskHandoffPackage` / `TaskHandoff` transport schema
- `src/core/handoff/TaskHandoffService.ts` — portable local Task Handoff orchestrator

Additions:
- Local portable handoff package with bounded source references and manual export/import
- Keystones retention of existing `openQuestions` and diagnostics

Verification:
- targeted unit tests green: **17/17 passed**
- full `npm test` suite green: **850/850 passed**

## Verification Map
| Phase | Typecheck | Unit Tests | Status |
|-------|-----------|------------|--------|
| 1 | required | target subset | passed |
| 2 | required | validation/context | passed |
| 3 | required | intelligence + review | passed |
| 4 | required | team + review | passed |

## References
- `/Users/sudheer/workspace/refs/check` — repo index and category READMEs
- `docs/reference-extraction-phases.md` — overarching roadmap
- `rtk-develop` — output filter heuristics
- `untilgreen-main` — deterministic gate/budget model
- `code-review-graph-main` — blast radius + context savings metadata
- `the-librarian-main` — handoff schema
- `headroom-main` — failure-mining pattern
- `aneirin-main` — stale-context dedupe
