> Historical document. It does not represent the current verified implementation status.

# Implementation Evidence — Phase 10 + Core Type-Error Remediation

## Final gate status (verified by real `npm` runs)
- `npm ci` → exit 0
- `npm run typecheck` → **0 errors** (clean baseline had **125**; Phase 10 start had 117)
- `npm run build` → exit 0
- `npm test` → **553 passed / 6 failed**

The 6 remaining test failures are **pre-existing and unrelated** to this work:
- `tests/unit/persistence.test.ts` (5 failures)
- `tests/unit/intelligence/adapters/UniversalAdapterEngine.test.ts` (1 failure)

Verified by `git stash` of ALL changes: the same 6 failures occur on the pure clean baseline. They are not regressions introduced here.

## Phase 10 scope (route consolidation + UX)
- `AppRouteSchema` (`src/shared/contracts/domain.ts`): removed `/settings` and `/support/diagnostics`; kept `/`, `/active-work`, `/intelligence`, `/history`, `/workbench/new`, and the `/workbench/{id}/{stage}` regex.
- `src/shared/navigation.ts` `sectionForRoute`: trimmed obsolete branches.
- `src/ui/App.tsx`: removed Settings/Diagnostics routes + components; passes `recovery` to `ActiveWorkRoute`.
- `src/core/integration/NativeShellServices.ts`: remapped `diagnostics`→`/history`, `settings`→`/` destinations.
- Deleted dead files: `src/ui/Home.tsx`, `src/ui/components/workbench/ActiveWork.tsx.backup`.
- Removed `keystone.openSettings` / `keystone.openDiagnostics` command registrations (`KeystoneDashboard.ts`) + `package.json` `contributes.commands`.
- Added contextual UX: `ContextualBlocker.tsx`, `RecoveryNotice` in `UiState.tsx`, `warning` icon; wired blockers/empty-state into `ActiveWork.tsx`.
- Created `tests/ui/phase10Consolidation.test.tsx`; fixed `SDLCWorkbench.test.tsx`, `App.test.tsx`, `navigation.test.ts`, `uiEndToEndAudit.test.ts`, `tests/extension/index.ts`.

## Core type-error remediation (117 → 0)
Mechanical schema-drift fixes, all behavior-preserving:
- `WorkflowRerunPlanner.ts`: `import * as crypto`; `stage.actions.length`→`stage.stages.length`; shuffle null-guard; hash `.reduce` on string→`Array.from`.
- `ResourceLimitService.ts` + `KeystoneError.ts`: added `"RESOURCE"` to `ErrorCategory` union (legitimate new category).
- `domain.ts`: `PersistedFoundationStateSchema` gained `activityRecords`/`approvalRecords`/`blockerRecords`/`freshnessRecords` (aliased `ActivityRecordSchema` import to avoid clash with the local operation-style `Activity`).
- `WorkspaceStateStore.ts`: added public `update(key, value)` method + `createDefaultState` includes the 4 arrays.
- `ActivityService`/`ApprovalService`/`BlockerService`: fixed schema-vs-value type misuse (`ActivityStatusSchema`→`ActivityStatus`, etc.); `emitUpdate` callback types `void | Promise<void>`; store-record creation `Omit` drops `createdAt`/`startedAt`; service `update` methods delegate to store `updateX`; Blocker field renames (`workflowId`→`affectedWorkflowId`, `stageId`→`affectedStageId`); `resolve` drops nonexistent `status`/`reason` fields; `cancellationRequested: false` added.
- `messages.ts`: `SerializedKeystoneErrorSchema.category` enum now includes `RESOURCE`.
- `HostBridge.ts` + `tests/ui/App.test.tsx`: literals include the 4 new arrays.

## Dead-code pruning (resolves final 42 errors)
`PersistenceConsistencyService.ts` and `SupportBundleService.ts` were **orphaned legacy services**: imported in `extension.ts` (lines 57-58) but never instantiated (`new ...`) or called (no `.run()`/`.build()`), and referenced by no tests. They were written against an obsolete contract surface (renamed/removed APIs: `getStageState`→`getStageStates`, `getExecutionProfile` removed, `context.getAllPackages`→`context.list`, `snapshot.intelligence()`/`freshnessRecords` removed, `DelegationPersistentState.approvals` removed, `session.contextPackageId` removed, `package` reserved word, `workflowId`→`packageId` on findings/rerunAttempts/handoff imports, `specificationId`→`specification`).

Decision: per the Global Implementation Contract's "remove dead code" principle and to avoid fabricating semantics (explicitly forbidden), the two files and their unused `extension.ts` imports were **removed**. Zero behavioral impact — nothing constructs or calls them.

## Caveat
`PHASE10-AUDIT.md` still contains a false "green" claim and stale references; it should be corrected separately (out of scope for the typecheck gate). The 6 pre-existing test failures should be triaged in their own remediation pass.
