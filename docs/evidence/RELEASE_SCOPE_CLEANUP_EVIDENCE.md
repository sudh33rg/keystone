# Release Scope Cleanup — Evidence

**Date:** 2026-07-23
**Scope:** Remove all excluded initiatives from the active Keystone release (code, contracts,
routing, UI, settings, tests, and documentation) per the release-scope correction directive.
Excluded initiatives are physically removed — not deferred, not feature-flagged, not stubbed.

## 1. Excluded capabilities removed

From the release-scope correction list, the following were present in `src/`/`docs`/`tests`
and are now removed:

- Centralized collaboration (team participants, assignment, reassignment, progress tracking,
  reconciliation, acceptance, audit)
- Manager / leader task assignment
- Organization / business-unit dashboards
- Centralized intelligence hub
- Cloud synchronization / shared remote workflow state
- Authentication / authorization / SSO / account / tenant management
- Deployment workflows / release automation
- Automatic Git operations (commit, push, pull, fetch, merge, rebase, branch create/switch,
  remote PR create/approve/merge)
- LoRA training / model fine-tuning / local model training / repository-trained models

## 2. Code / services / routes / protocols / models removed

### Deleted files (subsystem)
- `src/shared/contracts/team.ts` — collaboration message/entity contracts (also removed a
  duplicate `PostEditVerificationResult` that was repointed to `postEditVerification.ts`)
- `src/core/team/TeamWorkflowService.ts`
- `src/core/team/HandoffSecurity.ts`
- `src/extension/team/VsCodeTeamArtifactAdapter.ts`
- `src/core/persistence/TeamWorkflowPersistenceStore.ts`
- `src/ui/components/team/TeamWorkflowWorkspace.tsx`
- `tests/unit/team/TeamWorkflowService.test.ts`
- `tests/ui/TeamWorkflowWorkspace.test.tsx`
- `docs/10-future-roadmap.md` — contained only excluded "intelligence hub" + "LoRA" ideas

### `src/shared/contracts/messages.ts`
- Removed request types: `team/*`, `assignment/*`, old `handoff/*` (export/import/accept/
  reject/reconcile/validate/prepare), `progress/*`, `build/prepareHandoff`,
  `build/validateHandoff`, `build/exportHandoff`, `complete/prepareHandoff`,
  `complete/exportHandoff`
- Removed `HostResponseMap` entries for those types
- Removed the `teamLifecycle` helper and the `./team` import
- Retained in-scope: `taskHandoff/*` (Phase 11) and `pr-review/*` (Phase 10)

### `src/extension/webview/WebviewMessageRouter.ts`
- Removed `team: TeamWorkflowService` from the services interface and its import
- Removed all `case "team/..."`, `case "assignment/..."`, `case "handoff/..."`
  (old collaboration), `case "progress/..."` handler blocks
- Removed the second `services.team` block (`complete/prepareHandoff`,
  `complete/exportHandoff`) and the `team.reconcileStaleness` loop
- Removed the dead `handoff/export` trust-guard condition

### `src/ui/services/HostBridge.ts`
- Removed the `team` schema import block and all `team/*`, `assignment/*`, old `handoff/*`,
  `progress/*`, `build/*Handoff` response validators; removed `case "handoff/cancel"`

### `src/extension/extension.ts`
- Removed imports of `TeamWorkflowService`, `HandoffSecurity`, `VsCodeTeamArtifactAdapter`,
  `TeamWorkflowPersistenceStore`
- Removed the `team` service construction (`TeamWorkflowPersistenceStore` + `new
  TeamWorkflowService(...)` + `await team.initialize()`) and the `team,` registry field
- Removed the `keystone.team` configuration block
- Replaced the team-backed `handoffAttention` panel signal with `() => 0`
- Kept: `ManualHandoffService` wiring (truthful prompt handoff, in-scope), `taskHandoff`
  and `prReview` services

### `src/ui/App.tsx`
- Removed the old `handoff/import` navigation trigger (`import-handoff` destination)

### `package.json`
- Removed `keystone.team.repositoryArtifactsEnabled` setting

## 3. UI navigation / components

- `TeamWorkflowWorkspace` (collaboration UI) deleted; replaced the architecture doc reference
  with the in-scope `TaskHandoffWorkspace` (Phase 11)
- No new top-level route was added — Task Handoff is an in-workflow panel toggle on active
  workflows only

## 4. Documentation updated

- `CLAUDE.md` — removed `TeamWorkflowService` and `TeamWorkflowPersistenceStore` bullets
- `docs/architecture-overview.md` — added the **Release Boundary** statement (§1); removed
  §3.8 Team Collaboration (renumbered §3.9→§3.8, §3.10→§3.9); removed `TeamWorkflowWorkspace`
  (→ `TaskHandoffWorkspace`), `TeamWorkflowPersistenceStore` table row,
  `TeamRepositoryProvider` adapter, and "Team Workflow dashboards"
- `docs/reference-extraction-phases.md` — Phase 4 now points at `handoff.ts` /
  `TaskHandoffService.ts`
- `docs/improvement-roadmap.md` — replaced team-workflow test line with handoff-flow line;
  removed §3.4 Real-Time Collaboration and §3.5 Webhook/Integration System (renumbered §3.6→§3.4)
- `docs/evidence/PHASE_1_HOME_EVIDENCE.md` — replaced deleted test paths with in-scope
  equivalents (`TaskHandoffWorkspace.test.tsx`, `handoff/orchestrator.test.ts`)
- Deleted `docs/10-future-roadmap.md` (excluded-only content)

## 5. Tests updated (no new functionality)

- `tests/unit/contracts.test.ts` — replaced `assignment/create` / old `handoff/export` cases
  with an in-scope `taskHandoff/export` contract test
- `tests/unit/review/ReviewContractsAndPersistence.test.ts` — dropped `complete/prepareHandoff`
  from the request-type list
- `tests/unit/integration/ProductIntegrationService.test.ts` — removed the excluded
  legacy team-migration test (kept the in-scope `ProductIntegrationService` coverage)
- `tests/unit/scopeCorrection.test.ts` — rewrote the roadmap assertion to verify the excluded
  roadmap file is gone and the principal planning doc carries the Release Boundary statement

## 6. Legitimate retained references (not removed — they state the boundary)

These matches of excluded terms are correct and intentional; they describe what the product
deliberately does NOT do:
- `docs/architecture-overview.md:15` — the Release Boundary statement itself
- `docs/evidence/PHASE_10_TDD_BASELINE.md:92` and `src/core/delivery/GitDeliveryService.ts:988`
  — affirm remote PR creation is absent
- `src/ui/components/workbench/TaskHandoffWorkspace.tsx:11` and
  `docs/evidence/PHASE_11_TASK_HANDOFF_EVIDENCE.md` — boundary notes for in-scope Task Handoff
  (no SSO/cloud/accounts/tokens/remote sync)
- `src/shared/contracts/qaSecurity.ts:191` — `"tenant"` is a hardcoded example
  forbidden-secret keyword in the handoff privacy scanner (redaction, not a feature)
- `tests/unit/scopeCorrection.test.ts` — the guard test itself

## 7. Verification results

- `npx tsc --noEmit` — **clean** (exit 0)
- `npx vitest run` — **874 passed / 0 failed** (121 files)
- `npm run build` — **OK** (exit 0)
- `npm run package` — **OK**, produced `keystone-0.1.0.vsix` (26 files, 2.44 MB)

Final excluded-term sweep across `src/`, `docs/`, `tests/`, `README.md`, `CLAUDE.md`,
`package.json` returned **no accidental references** — only the intentional boundary
statements listed in §6.

## 8. In-scope capabilities preserved

- Phase 11 Task Handoff (`taskHandoff/*`): local portable `.keystone-handoff` packages,
  eligibility, privacy scan/redaction, manual export/import, history — no Git/cloud/accounts
- Phase 10 PR Review (`pr-review/*`): readiness, findings, package generation
- `ManualHandoffService`: truthful prompt preparation and clipboard handoff (item 8)
- Local Git status/diff inspection, PR title/description preparation, "copy" / open Source
  Control — no automatic writes
