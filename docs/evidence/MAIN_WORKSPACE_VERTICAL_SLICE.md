# Main Workspace Vertical Slice — Evidence and Verification

> Scope: contract repair for the Understand / Investigation / Plan stage-state
> shapes, authoritative `workItemId` ownership in the extension host, the full
> Understand execution-configuration foundation (real profile persistence,
> agent/skill/instruction/conflict selection UI), and the final no-Git-hooks
> Intelligence enhancement plan — plus an integration correction that makes the
> execution-profile identity, freshness, conflict resolution, and agent
> auto-selection actually effective end-to-end.
> No Intelligence / OKF / query-engine behavior was changed — those layers were
> preserved intact.

## Summary

This slice repairs broken stage-state contracts, completes the Understand
execution-configuration foundation on top of the existing
`ExecutionConfigurationService`, eradicates every Git-hook reference from the
plan, and corrects the execution-profile identity used by Understand context
generation and delegation. It does **not** implement Investigation
delegation, Plan task cards, Security/Performance/PR-Review surfaces, Git
mutation, or remote PR integration.

### Key integration-correction behaviors (this pass)

- **Real profile identity in context.** `DevelopmentContextBuildInput.executionProfileId`
  receives the actual persisted `UnderstandState.executionProfileId`, never the
  stage `workItemId`.
- **Structured failures.** `generateContext` / `generatePlanContext` throw
  `EXECUTION_PROFILE_REQUIRED` (no saved profile, replaced profile, or id
  mismatch) and `EXECUTION_PROFILE_STALE` (profile contentHash or revision
  changed) after reloading the profile by persisted workflow id + work-item UUID.
- **Profile reload + match before generate and delegate.** Both paths verify the
  saved profile still matches (id + contentHash + profile-specific revision).
  An unrelated workflow's profile change does NOT invalidate this stage.
- **Profile-specific freshness.** Staleness uses the profile's own
  `contentHash` + `updatedAt`-derived `revision`, not the global
  `ExecutionConfigurationService.revision`, so unrelated profile edits are
  ignored.
- **Conflict resolutions are effective.** `ExecutionConfigurationService.saveProfile`
  applies caller `conflictResolutions` centrally (`exclude` removes an
  instruction; `win` removes the losing party; `acknowledge` is non-blocking but
  never bypasses an error-severity conflict). `conflictsResolved` is truthful.
- **Agent auto-selection from one combined list.** Discovered agents and manual
  profiles are merged; auto-select only when exactly one valid option exists;
  `AGENT_REQUIRED` when a non-manual mode has no valid agent.
- **Delegation records the exact profile.** Context package, prompt, and
  delegation records all carry `executionProfileId` / `executionProfileRevision`
  / `executionProfileContentHash`.

### Changes

1. **`src/shared/contracts/stageWorkspace.ts`**
   - `UnderstandStateSchema` / `InvestigationStateSchema`: restored `completion`
     and `completedAt`; removed `executedAt`.
   - `StageCopilotConfigurationSchema`: aggregate-backed options — `agentOptions`
     (discovered), `manualAgentOptions` (manual profiles), `skillOptions`,
     `instructionOptions`, and `conflicts`, all from `ExecutionConfigurationService`.
   - Added `executionProfileId` / `executionProfileRevision` /
     `executionProfileContentHash` to `StageContextPackageSchema`,
     `StagePromptSchema`, and `StageDelegationRecordSchema`; added
     `executionProfileContentHash` to `UnderstandStateSchema` and `PlanStateSchema`.

2. **`src/shared/contracts/executionConfiguration.ts`**
   - Added `ConflictResolutionChoiceSchema`, `ProfileConflictResolutionSchema`,
     and persisted `selectedInstructionIds` / `conflictResolutions` / `revision`
     on `DevelopmentExecutionProfileSchema`; exported the new types.

3. **`src/shared/contracts/messages.ts`**
   - `stage.understand.setConfiguration` request: webview sends `mode`, `skill`,
     `agentId`, `instructionIds`, and `conflictResolutions` — never a
     `workItemId`. New `stage.understand.previewInstruction` route.

4. **`src/core/development/ExecutionConfigurationService.ts`**
   - `saveProfile` applies caller `conflictResolutions` via `applyConflictResolutions`
     (exclude removes an instruction; win removes the losing party; `acknowledge`
     never bypasses an error-severity conflict). Persists `selectedInstructionIds`
     + `conflictResolutions` + profile-specific `revision` + `contentHash`.
   - Validation stays centralized; `conflictsResolved` is truthful.

5. **`src/core/workflows/StageWorkspaceService.ts`**
   - `initialize()` migrates persisted records lacking a `workItemId` once; the
     UUID is reused forever across stage, profile, context, prompt, and delegation.
     No synthetic `${stageKind}:${stageId}` identifiers remain.
   - `setConfiguration()` saves the profile through `executionConfiguration.saveProfile`,
     records the real profile id + profile-specific revision + contentHash (never
     the global service revision), invalidates context/prompt for this work item,
     and applies the combined agent auto-selection + `AGENT_REQUIRED` gate.
   - `resolveSkillDefinition()` never falls back; `buildConfiguration` validates
     the skill against `DevelopmentSkillService` and preserves (never wipes) a
     selection when no skill source is available.
   - `generateContext` / `generatePlanContext` use the real `executionProfileId`,
     throw `EXECUTION_PROFILE_REQUIRED` / `EXECUTION_PROFILE_STALE` after reloading
     and matching the profile.
   - `verifyExecutionProfile` blocks `delegate` / `delegatePlan` when the saved
     profile changed; delegation records carry the exact profile id + contentHash.
   - Context package, prompt, and delegation records carry profile identity fields.

6. **`src/extension/webview/WebviewMessageRouter.ts`** / **`src/ui/services/HostBridge.ts`**
   - `setConfiguration` forwards the full selection; `previewInstruction` route
     with `InstructionPreviewSchema` validation.

7. **`src/ui/components/workbench/UnderstandStage.tsx`**
   - Full execution-configuration panel: discovered Copilot agents and manual
     profiles in separate selects (truthful availability), skill select,
     instruction checklist with bounded preview, per-conflict resolution controls
     (blocking conflicts disable save), delegation-mode radios, save → generate →
     reload restores exact selection. Not redesigned.

8. **`docs/plans/intelligence_enhancement.md`**
   - Every reference to `post-commit`, `post-merge`, `post-checkout`, `.git/hooks`,
     hook installation/markers, and hook-triggered reconciliation was deleted.
     Freshness is stated as the approved incremental mechanisms: runtime file
     watching, repository revision detection, branch-state observation, startup
     reconciliation, manual refresh, change collection, scheduling, and
     incremental ingestion through Keystone-owned services. Remaining phases were
     renumbered and preserved.

9. **Tests**
   - `tests/unit/UnderstandExecutionConfiguration.test.ts` (new, 6 focused groups
     against a real `ExecutionConfigurationService`): UUID reuse; selection
     persistence; config-change staleness with unchanged UUID; conflict-resolution
     effectiveness (exclusion/winner/acknowledge-never-bypasses); combined agent
     auto-selection + `AGENT_REQUIRED`; unrelated profile change does not stale,
     current profile change stales context and blocks generate + delegate.
   - `tests/unit/StageWorkspacePlanFlow.test.ts`, `tests/ui/ActiveWorkflow.test.tsx`:
     fixtures updated for new required fields / real `keystone-development` skill.

## Verification (run from repo root)

| Gate | Command | Result |
|------|---------|--------|
| Typecheck | `npm run typecheck` (`tsc --noEmit`) | exit 0 |
| Lint | `npm run lint` (`eslint . --quiet`) | 0 errors |
| Tests | `npx vitest run` | 889/889 passing (127 files) |
| Build | `npm run build` | success |
| Extension tests | `npm run test:extension` | exit 0 |
| Package | `vsce package` | `keystone-0.1.0.vsix` (27 files, 2.46 MB) |
| Synthetic-ID grep | `grep -rn '${stageKind}:${stageId}' src/` | no matches |
| Profile-identity grep | `grep -c EXECUTION_PROFILE_STALE` in packaged `extension.js` | 2 (present) |

The packaged `extension/dist/extension/extension.js` was inspected inside the
VSIX and contains the new `EXECUTION_PROFILE_STALE` error and `verifyExecutionProfile`
logic, confirming the integration fixes are in the shipped artifact.

## Notes / non-goals

- Investigation delegation UI, Plan task cards, Security/Performance/PR-Review,
  Task Handoff, Git mutation, and remote-PR integration are out of scope.
- No `workItemId` is sent from the webview; the extension host is the authority.
- No Git hooks are installed, and no Git state is read or written by this slice.
- UI journeys requiring the VS Code Extension Development Host (EDH) are not
  automatable in a headless environment and were not visually verified.
