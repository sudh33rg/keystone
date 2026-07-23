# Release Recovery — TDD Baseline

This document records the test-first baseline for the Keystone local-first release-recovery
pass. Every correction area adds a failing test before implementation, runs it to record the
expected failure, then implements the correction and re-runs focused + full gates.

## Correction areas and planned test files

| Area | Test file | What it asserts (failing first) |
|------|-----------|----------------------------------|
| Excluded Git/PR runtime removed | `tests/unit/releaseBoundary.test.ts` | No `DeliveryCoordinator`, `GitHubPullRequestProvider`, `PullRequestProviderRegistry`, `ClipboardPullRequestProvider`, `GitExecutableDeliveryAdapter`, `VsCodeGitDeliveryAdapter` symbols resolve; no `git/commit`, `git/push`, `complete/createPr`, `commitPlan/*`, `delivery/*`, `pr.create` protocol entries; no Delivery/commit/push commands in `package.json`. |
| Read-only Git service | `tests/unit/integration/RepositoryReadService.test.ts` | `RepositoryReadService` exposes `getStatus`, `getCurrentBranch`, `getCurrentRevision`, `getChangedFiles`, `getDiff`, `getHistory`; the interface type has no mutation method (`stage/commit/push/pull/fetch/checkout/merge/rebase/reset/stash/createPr/approvePr/mergePr`). |
| Protocol cleanup | `tests/unit/contracts.test.ts` | `messages.ts` request registry contains `repository/*` and `review/*` operations; excluded `git/commit`, `git/push`, `delivery/*`, `commitPlan/*`, `complete/createPr` are absent. |
| Workflow stages | `tests/unit/workflows/stageModel.test.ts` | Canonical `WorkflowStageType` includes `Security`, `Performance`, `PR Review`; `DevelopmentWorkflowService`/`CanonicalWorkflowService` construct them per documented policy; persisted records contain stage IDs/type/order/status; migration of older records lacking Security/Performance yields a valid augmented record without rewriting completed histories. |
| Security stage | `tests/unit/workbench/securityStage.test.ts` | Security workspace renders real persisted scope/attack-surface/authz/sensitive-data/findings/validation/decision; candidate vs confirmed certainty states; command execution requires explicit approval; decision persists; stale analysis detectable. |
| Performance stage | `tests/unit/workbench/performanceStage.test.ts` | Performance workspace renders real scope/critical-paths/static-candidates/runtime/baseline/findings/decision; explicit baseline selection; comparison math (abs + pct diff); decision persists; stale detectable. |
| PR Review + local acceptance | `tests/unit/review/localReviewAcceptance.test.ts` | PR Review scope/traceability/findings/readiness/package; `LocalReviewDecision` persisted with rules (stale blocks, critical blocks, required evidence current); no remote action. |
| Task Handoff continuity | `tests/unit/handoff/taskHandoffContinuity.test.ts` | Export loads real Development/context/impact/QA/Security/Performance/PR evidence; native Save dialog returns actual URI; native Open dialog returns preview; repository compatibility states; local capability rediscovery; no Git sync. |
| Packaging | `tests/unit/releasePackage.test.ts` | Built VSIX excludes `.claude`, `.hermes`, `PHASE*.md`, `IMPLEMENTATION_EVIDENCE.md`, `PHASE10-AUDIT.md`, `docs/evidence`, source/tests/scripts; contains `dist/extension`, `dist/webview`, `package.json`; no absolute local paths or secret strings. |

## Commands run

```bash
npx vitest run tests/unit/releaseBoundary.test.ts        # initial failure
npx vitest run tests/unit/integration/RepositoryReadService.test.ts
npx vitest run tests/unit/contracts.test.ts
npx vitest run tests/unit/workflows/stageModel.test.ts
npx vitest run tests/unit/workbench/securityStage.test.ts
npx vitest run tests/unit/workbench/performanceStage.test.ts
npx vitest run tests/unit/review/localReviewAcceptance.test.ts
npx vitest run tests/unit/handoff/taskHandoffContinuity.test.ts
npx vitest run tests/unit/releasePackage.test.ts
npm run verify            # typecheck && npm test && npm run build
npm run lint              # must pass with zero errors
npm run test:extension    # real Extension Development Host
npm run package           # VSIX inspect
```

## Initial failures (recorded as work proceeds)

Each row is filled when the area's failing test is first executed.

| Area | Initial failure reason |
|------|------------------------|
| Excluded Git/PR runtime | Symbols/protocol/commands still present in active code. |
| Read-only Git service | `RepositoryReadService` does not exist yet. |
| Protocol cleanup | Excluded request types still registered. |
| Workflow stages | Stage model omits Security/Performance in canonical construction. |
| Security stage | No real Security stage workspace wired in Active Work. |
| Performance stage | No real Performance stage workspace wired in Active Work. |
| PR Review + local acceptance | No persisted `LocalReviewDecision` model / acceptance rules. |
| Task Handoff continuity | Continuity adapters return empty/undefined records. |
| Packaging | VSIX includes dev/planning artifacts. |

Tests are never edited merely to preserve broken production behaviour; they encode the required
post-recovery contract.
