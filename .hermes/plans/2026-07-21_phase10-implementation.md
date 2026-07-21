# Keystone Corrective Phase 10 — Integration, UX, Reliability, Hardening

> **Goal:** Make the complete product understandable, operable, recoverable, testable, and demonstrable. Focus on end-to-end workflow integration, obsolete-surface removal, persistence/recovery hardening, and verifiable acceptance. Do not add major new SDLC domains.

> **Boundary:** Execution is bounded by repo state observed under `src/`, `tests/`, `package.json`, and current route/ui contracts. Plan is written before mutating this repo.

---

## 1. Current context / assumptions
- Navigation already prefers Home / Active Work / Intelligence / History.
- Obsolete sections are mapped to compatibility routes, not removed yet.
- Obsolete/destination-like routes still exposed: `/support/diagnostics`, `/settings`, plus legacy Workbench/Build leftovers.
- Cross-capability services are partially wired: `ProductIntegrationService`, `StalenessService`, `StartupStateService`, `KeystoneDashboardViewModelService`.
- Acceptance contracts expect `typecheck`, `test`, and `build` to pass.

---

## 2. Proposed approach
1. Lock navigation to four primary destinations; remove or redirect obsolete top-level routes.
2. Wire unified Active Work as the single operating surface for workflow progress, stage rail, blockers, approvals, handoff, and history.
3. Add explicit error/blocker/empty-state UX components and plug them into canonical routes.
4. Harden lifecycle: activation-order flow, interrupted-operation recovery, persistence consistency checks, and support bundle redaction.
5. Add golden-scenario test coverage and acceptance verification.

This is shipped as concrete implementation tasks, not a stale roadmap doc.

---

## 3. Step-by-step plan

### Task 1: Add navigation and cleanup guardrails
**Objective:** Enforce four primary destinations and remove obsolete top-level routes. **Files:** Modify `src/shared/navigation.ts`, `src/ui/App.tsx`, `src/shared/contracts/domain.ts`, `src/extension/extension.ts` after inspection. **Step 1:** Extend `AppRouteSchema`/`NavigationSectionSchema` with an explicit allowlist. **Step 2:** Redirect banned top-level routes to `/` or `/workbench/new` with audit logging. **Step 3:** Remove `/support/diagnostics` as a first-class route from `App.tsx`; relocate its bounded content into Home advanced details. **Step 4:** Run `npx tsc --noEmit` and `npm test`. **Step 5:** Commit as `refactor(phase10): enforce primary navigation destinations`.

### Task 2: Unify Active Work surface
**Objective:** Make Active Work the only workflow operating surface. **Files:** `src/ui/components/workbench/ActiveWork.tsx`, `src/ui/components/workbench/SDLCWorkbench.tsx`, related tests. **Step 1:** Consolidate duplicated stage-shell UX into `ActiveWork`. **Step 2:** Add `WorkflowHeader`, `SdlcStageRail`, `ActiveStageWorkspace`, `ApprovalPanel`, `ContextualBlocker` placeholders wired to existing contracts. **Step 3:** Remove duplicate workbench-action copies from `SDLCWorkbench`. **Step 4:** Run UI tests: `npm test -- --run tests/ui/App.test.tsx tests/ui/SDLCWorkbench.test.tsx tests/ui/HomeDashboard.test.tsx`. **Step 5:** Commit as `feat(phase10): unify Active Work workflow surface`.

### Task 3: Add phase10 acceptance tests
**Objective:** Prove golden/end-to-end/failure scenarios and product honesty. **Files:** new `tests/integration/Phase10EndToEnd.test.ts`, extend `tests/unit/webview/WebviewMessageRouter.test.ts`, update `tests/ui/*.test.tsx`. **Step 1:** Add snapshot/golden smoke test for restricted navigation and recovery banner. **Step 2:** Add failure-injection tests for restarted router/host bridge validation. **Step 3:** Add redaction test for support-bundle/handoff preview using `src/core/integration/ProductIntegrationService`. **Step 4:** Run `npm test`. **Step 5:** Commit as `test(phase10): add acceptance and safety coverage`.

### Task 4: Harden persistence, migration, and recovery behavior
**Objective:** Bounded consistency checks and safe extension restart behavior. **Files:** `src/core/persistence/*`, `src/extension/extension.ts`. **Step 1:** Introduce or expose `PersistenceConsistencyService` with bounded cross-reference checks. **Step 2:** Add extension activation sequence: validate store → recover interrupted → refresh state → validate workflows → restore route. **Step 3:** Make support bundle redact tokens, secrets, prompts, and per spec. **Step 4:** Run `npm run typecheck && npm test`. **Step 5:** Commit as `feat(phase10): harden persistence, recovery, and redaction`.

### Task 5: Final acceptance gate
**Objective:** Verify repo meets final checklist. **Step 1:** Run `npm run typecheck && npm test && npm run build`. **Step 2:** Verify `npm run package` succeeds. **Step 3:** Surface any remaining obsolete routes and remove dead commands from `package.json`. **Step 4:** Commit any cleanup as `chore(phase10): acceptance cleanup and obsolete command removal`.

---

## 4. File targets with respect to existing repo
- `src/shared/navigation.ts`
- `src/ui/App.tsx`
- `src/ui/components/workbench/ActiveWork.tsx`
- `src/ui/components/workbench/SDLCWorkbench.tsx`
- `src/ui/components/home/HomeDashboard.tsx`
- `src/shared/contracts/domain.ts`
- `src/extension/webview/WebviewMessageRouter.ts`
- `src/extension/extension.ts`
- `src/core/integration/ProductIntegrationService.ts`
- `src/core/persistence/ScopeCorrectionMigration.ts`
- `tests/integration/Phase10EndToEnd.test.ts` (new)
- `tests/unit/webview/WebviewMessageRouter.test.ts`
- `tests/ui/App.test.tsx`
- `tests/ui/SDLCWorkbench.test.tsx`
- `tests/ui/HomeDashboard.test.tsx`

---

## 5. Tests / validation
- `npm run typecheck`
- `npm test`
- `npm run build`
- `npm run package`
- New focused tests in `tests/integration/` and targeted UI/unit coverage.
- Explicit assertion: no route remains exposed besides Home, Active Work, Intelligence, History plus allowed compatibility fallbacks.

---

## 6. Risks, tradeoffs, and open questions
- Some diagnostics content may be duplicated in Home advanced details; keep minimal to avoid scope creep.
- Removing obsolete too aggressively may hide useful internal debug panels; preserve an internal advanced status panel, not a top-level destination.
- Persistence consistency check must stay bounded; unbounded validation would break activation performance.
- Acceptance depends on existing stubs; if phase10 contracts are missing, tasks should add them instead of faking behavior.
