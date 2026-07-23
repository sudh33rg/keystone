# Blocker 1 — Read-Only Git Boundary: Evidence

Date: 2026-07-24
Area: `src/core/delivery`, `src/extension/git`, `src/shared/contracts/delivery`, `src/core/persistence/DeliveryPersistenceStore.ts`
Delete these modules plus every consumer reference; keep `RepositoryReadService` and `VsCodeGitAdapter` (read-only) intact.

## Outcome (verified)
- `typecheck`: 0 errors
- `build`: success
- `dist` protocol surface: excluded strings absent

## What was removed
- `src/core/delivery/` and `src/core/persistence/DeliveryPersistenceStore.ts`
- `src/shared/contracts/delivery.ts`
- `src/extension/git/GitDeliveryAdapter.ts`
- `src/extension/git/VsCodeGitDeliveryAdapter.ts`
- `createDeliveryCheck` from `src/core/health/HealthCheckService.ts`
- Empty dead `import {} from "../../shared/contracts/delivery"` from `src/ui/services/HostBridge.ts`

## Read-only git access path
- All read-only git reads now go through `RepositoryReadService` at `src/core/repository/RepositoryReadService.ts`.
- `RepositoryReadService` allow list (`status`, `branch`, `diff`, `log`, `rev-parse`, `rev-list`, `show`, `remote`, `config`, `ls-files`, `cat-file`, and `repository` identity calls).
- No path from the runtime, protocol, or UI surfaces executes `git add`, `git commit`, `git push`, branch checkout, create-branch, or PR creation APIs.

## Delivered
- `tests/unit/review/ReviewContractsAndPersistence.test.ts` updated: `DeliveryPersistenceStore` removed; completion assertion now proves no `prUrl` / no push artifact.
- `tests/unit/releaseBoundary/ReadOnlyGitBoundary.test.ts`
- `tests/unit/releaseBoundary/ExcludedGitProtocol.test.ts`
- `tests/unit/releaseBoundary/NoRemotePrRuntime.test.ts`
- `tests/unit/releaseBoundary/NoDeliveryUi.test.tsx`
- `docs/RELEASE_BLOCKER_1_READ_ONLY_GIT_EVIDENCE.md`
- `docs/RELEASE_BLOCKER_1_TDD_BASELINE.md`

## Dist verification
Excluded tokens (`stageChanges`, `createCommit`, `git/stage`, `git/push`, `git/createBranch`, `exportPatch`, `pullRequest/create`, `complete/createPr`, `complete/push`) are absent from built output. The only remaining `"delivery"` strings are the `"delivery"` workflow-stage literals used by the orchestration layer (`delivery-readiness` gate kind), which is unrelated to the deleted runtime.
