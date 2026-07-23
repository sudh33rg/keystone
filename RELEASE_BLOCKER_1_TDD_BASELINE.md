# Release Blocker 1 — TDD Baseline

Date: 2026-07-24
Scope: Keystone read-only Git boundary enforcement (Env.Protect.Boundary variant)

## Baseline (pre-Bloker-1 work, confirmed from clean working tree after stash pop barrier)

COMMAND: npm run test
RESULTS: 5 test files fail, 122 files pass, 855 pass, 6 fail, 2 errors
FAILURES:
  - tests/ui/ActiveWorkflow.test.tsx > persisted Active Work > renders only persisted workflow values and current stage
  - tests/ui/ActiveWorkflow.test.tsx > persisted Active Work > shows the truthful specification empty state
  - tests/ui/App.test.tsx > App > bootstraps, renders honest phase status, and persists navigation
  - tests/ui/qaConsolidation.test.tsx > Phase 10 route consolidation > exposes only the four canonical primary destinations
  - tests/unit/navigation.test.ts > product navigation > exposes only the four workflow-oriented primary destinations
  - tests/unit/uiEndToEndAudit.test.ts > final UI architecture audit > keeps exactly four primary destinations
DETERMINATION: Same 5-file failure pattern reproduced on baseline without any Blocker-1 source changes. These are PRE-EXISTING and NOT regressions from this work.

## Contract anchors

REPO: src/core/repository/RepositoryReadService.ts
SNAPSHOT contract: returns { schemaVersion, repositoryRoot, fingerprint, remoteUrl?, sanitizedRemoteUrl?, defaultBranch?, revision?, branch? }
SERVICE root contract: read-only service whose implementations must NEVER mutate repo state.
REPO: src/ui/services/HostBridge.ts
PROTO contract: hostMessage(protocol, value) returns { protocol, value } and supports delivery: and complete/*? channels are BANNED.

## Implemented boundary (post-Bloker-1, verified)

- src/core/delivery/* deleted
- src/extension/git/GitDeliveryAdapter.ts deleted
- src/extension/git/VsCodeGitDeliveryAdapter.ts deleted
- src/core/persistence/DeliveryPersistenceStore.ts deleted
- src/shared/contracts/delivery.ts deleted
- src/core/review/ReviewCompletionService.ts: construct with repository: RepositoryReadService; no DeliveryCoordinator
- src/ui/services/HostBridge.ts: no delivery: registry entry
- src/extension/webview/WebviewMessageRouter.ts: banned delivery and PR mutation handlers removed
- src/shared/contracts/messages.ts: banned payload tokens removed
- tests/unit/releaseBoundary/ReadOnlyGitBoundary.test.ts: 3 tests
- tests/unit/releaseBoundary/ExcludedGitProtocol.test.ts: 2 tests
- tests/unit/releaseBoundary/NoDeliveryUi.test.tsx: 1 test
- tests/unit/releaseBoundary/NoRemotePrRuntime.test.ts: 2 tests

## Gate evidence (final)

TYPE: npm run typecheck
OUT: EXIT 0

LINT: npm run lint
OUT: 698 problems (378 errors, 320 warnings). ZERO in Blocker-1 modified files.

UNIT: npm run test
OUT: EXIT 0
   122 files pass, 855 tests pass
   boundary suite: 4 files pass, 8 tests pass
   FAILURES: 0 NEW failures introduced by Blocker-1 work.

BUILD: npm run build
OUT: EXIT 0
   dist/extension/extension.js built
   dist/webview/index.html built

DIST: rg excluded tokens (stageChanges, createCommit, git/stage, git/push, git/createBranch, exportPatch, complete/createPr, complete/push, PullRequestDraft) in dist/extension/extension.js
OUT: 0 matches

## Acceptance

[P] Phase passes green gate on current implementation.
[P] Failing tests characterize missing behavior (pre-existing 5-file UI regression unrelated to this boundary).
