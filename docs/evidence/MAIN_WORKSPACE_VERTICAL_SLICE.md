# Main Workspace Vertical Slice — Evidence and Verification

> Scope: contract repair for the Understand / Investigation / Plan stage-state
> shapes, authoritative `workItemId` ownership in the extension host, and real
> execution-configuration controls in the Understand workspace.
> No Intelligence / OKF / query-engine behavior was changed — those layers were
> preserved intact.

## Summary

This slice repairs broken stage-state contracts and wires real execution
configuration into the Understand workspace UI. It does **not** implement
Investigation delegation, Plan task cards, Security/Performance/PR-Review
surfaces, packaging cleanup, Git mutation, or remote PR integration.

### Changes

1. **`src/shared/contracts/stageWorkspace.ts`**
   - `UnderstandStateSchema` / `InvestigationStateSchema`: restored `completion`
     and `completedAt` (they had been incorrectly dropped). Removed `executedAt`
     (no consistent implemented meaning across schema/service/persistence/UI).
   - `StageCopilotConfigurationSchema`: added real, aggregate-backed options —
     `agentOptions` (discovered + manual agents), `skillOptions`, and
     `conflicts`. These are read from `ExecutionConfigurationService` and never
     invented in the UI.

2. **`src/shared/contracts/messages.ts`**
   - `stage.understand.setConfiguration` request payload: `workItemId` is no
     longer sent by the webview. The extension host owns the authoritative
     `workItemId` from persisted state.

3. **`src/core/workflows/StageWorkspaceService.ts`**
   - `initialize()` migrates persisted Understand/Investigation/Plan records that
     lack a `workItemId`, assigning one UUID and persisting it once.
   - `loadUnderstand()` / `loadPlan()` / `buildInvestigationSeed()` reuse a single
     `workItemId` per stage instance for state, execution config, context,
     prompt, and delegation records.
   - `setConfiguration()` validates any caller-supplied `workItemId` against the
     persisted state and throws `WORK_ITEM_ID_MISMATCH` on divergence.
   - `buildConfiguration()` now surfaces `agentOptions`, `skillOptions`, and
     `conflicts` from the `ExecutionConfigurationService` aggregate, and honors an
     explicit `agentId` selection passed from the UI (falling back to
     single-ambiguous auto-selection only when none is supplied).

4. **`src/extension/webview/WebviewMessageRouter.ts`**
   - `stage.understand.setConfiguration` handler resolves the authoritative
     `workItemId` from persisted state and validates against a supplied value.

5. **`src/ui/components/workbench/UnderstandStage.tsx`**
   - Added real execution-configuration controls: agent `<select>` (discovered or
     manual), skill `<select>`, instruction-conflict banner, and a **Save
     execution configuration** button wired to `stage.understand.setConfiguration`
     with `agentId` + `skill`. Draft selection syncs from server state.

6. **`src/ui/components/intelligence/QueryWorkspace.tsx`**
   - `OkfConceptCard` verified intact (renders real OKF concept detail). No change
     required — an earlier in-session edit had corrupted the file; it was restored
     from git.

7. **Tests**
   - `tests/ui/ActiveWorkflow.test.tsx` and `tests/unit/StageWorkspacePlanFlow.test.ts`
     fixtures updated for the new required config fields (`agentOptions`,
     `skillOptions`, `conflicts`).

## Verification (run from repo root)

| Gate | Command | Result |
|------|---------|--------|
| Typecheck | `npm run typecheck` (`tsc --noEmit`) | exit 0 |
| Lint | `npm run lint` (`eslint . --quiet`) | 0 errors (remaining items are pre-existing `max-lines`/`max-params` warnings on test files) |
| Tests | `npm test` (`vitest run`) | 881/881 passing |
| Build | `npm run build` | success |

## Notes / non-goals

- Investigation delegation UI, Plan task cards, Security/Performance/PR-Review,
  Task Handoff, packaging cleanup, Git mutation, and remote-PR integration are out
  of scope for this slice.
- No `workItemId` is sent from the webview; the extension host is the authority.
- UI journeys requiring the VS Code Extension Development Host (EDH) are not
  automatable in a headless environment and were not visually verified.
