# Keystone Phase 2 Workflow Evidence

Date: 2026-07-22  
Scope: intent capture through persisted workflow creation, Active Work restoration, Home summary, and real History records only.

## Delivered scope

Phase 2 now provides one bounded journey:

1. Home opens `/workflow/new` from Start Work.
2. Define captures a required intent, one of the five canonical work types, and an optional specification.
3. Review shows the exact values and work-type-specific stage outline before any write.
4. `workflow.create` persists a canonical workflow in the Extension Host and returns a typed result.
5. Successful creation opens `/active-work`; failed creation remains on Review with the draft intact.
6. Active Work, Home, and History read the same canonical persisted store.
7. Webview reload and Extension Development Host restart restore the active workflow.

Only these user routes are involved: `/home` (represented by `/` in the route type), `/workflow/new`, `/active-work`, `/history`, and `/intelligence`.

## Tests written first

The six Phase 2 test files were created and run before production implementation. The recorded red baseline is in [PHASE_2_TDD_BASELINE.md](PHASE_2_TDD_BASELINE.md).

Initial result:

```text
Test Files  6 failed (6)
Tests       6 failed (6)
Errors      1 error
```

The failures proved that the canonical service and protocol did not exist and that Setup, Active Work, and History still used Phase 1 or legacy behavior.

Complete list of new Phase 2 tests:

- `tests/unit/workflow/WorkflowService.test.ts`
- `tests/unit/workflow/WorkflowPersistence.test.ts`
- `tests/extension/workflowProtocol.test.ts`
- `tests/ui/WorkflowSetup.test.tsx`
- `tests/ui/ActiveWorkflow.test.tsx`
- `tests/ui/WorkflowHistory.test.tsx`

Existing compatibility tests updated for the new bounded flow:

- `tests/ui/StartWorkDraft.test.tsx`
- `tests/ui/ActiveWorkEmptyState.test.tsx`
- `tests/unit/home/HomeStateService.test.ts`
- `tests/ui/HomeDashboard.test.tsx`

## Canonical model and service

`src/shared/contracts/canonicalWorkflow.ts` is the shared schema authority. The persisted workflow contains only:

- schema version and stable workflow ID
- intent text and canonical work type
- optional specification text and revision
- workflow status
- ordered stage summaries with stable IDs, type, display name, order, status, and required flag
- `currentStageId`
- created and updated timestamps

The supported work types are `feature`, `bug-fix`, `refactor`, `test-work`, and `investigation`. `canonicalStageOutline()` is the single source for their exact stage outlines.

`src/core/workflow/WorkflowService.ts` owns creation and lookup. It validates all input, assigns host-side IDs and timestamps, permits only one active workflow, makes correlation IDs idempotent across concurrent and repeated requests, writes before mutating in-memory state, and never returns success after a failed write. Malformed stored state is rejected with a diagnostic and no invented workflow.

## Persistence mechanism

For a repository-backed session, canonical state is stored at:

```text
<repository>/.keystone/workflows/phase-2.json
```

`FileWorkflowPersistence` uses the existing `AtomicFileWriter`. The document is strict schema version 1 and contains the workflow collection, active workflow ID, correlation-to-workflow map, revision, and update time. A successful write atomically replaces the prior document. A failed write leaves both the in-memory service and persisted workflow collection unchanged.

Observed feature fixture after creation:

```text
workflow id: 816f61cb-e323-412d-ba2f-fa6cac34aafe
revision: 1
workflow count: 1
work type: feature
stages: Understand, Plan, Development, Impact Analysis, QA, PR Review
```

Observed bug-fix fixture after two immediate Create clicks:

```text
workflow id: 627ba442-a471-4055-ab74-43103e1ab326
workflow count: 1
work type: bug-fix
stages: Understand, Impact Analysis, Development, QA, PR Review
```

## Webview protocol

The request is a strict, correlated request envelope whose payload is:

```json
{
  "type": "workflow.create",
  "payload": {
    "correlationId": "<stable draft correlation id>",
    "intent": "Add guarded refunds to settled orders",
    "workType": "feature",
    "specification": "Allow support engineers to issue a full refund only after confirmation."
  }
}
```

The successful response data is:

```json
{
  "type": "workflow.created",
  "correlationId": "<same correlation id>",
  "workflow": "<strict canonical workflow>"
}
```

The failure response data is:

```json
{
  "type": "workflow.creationFailed",
  "correlationId": "<same correlation id>",
  "error": {
    "code": "WORKFLOW_PERSISTENCE_FAILED",
    "message": "Keystone could not persist the workflow. Check repository write access, then try again.",
    "recoverable": true
  }
}
```

Related strict requests load the active workflow, list canonical workflows, get one workflow, and select an active canonical workflow. `HostBridge` validates canonical responses rather than casting them.

## Production files changed for Phase 2

- `package.json`
- `src/shared/contracts/canonicalWorkflow.ts`
- `src/shared/contracts/home.ts`
- `src/shared/contracts/messages.ts`
- `src/core/workflow/WorkflowService.ts`
- `src/core/home/HomeStateService.ts`
- `src/extension/extension.ts`
- `src/extension/webview/WebviewMessageRouter.ts`
- `src/core/integration/NativeShellServices.ts`
- `src/ui/services/HostBridge.ts`
- `src/ui/components/workflow/StartWorkDraft.tsx`
- `src/ui/components/workbench/ActiveWork.tsx`
- `src/ui/components/history/HistoryWorkspace.tsx`
- `src/ui/components/home/HomeDashboard.tsx`
- `src/ui/styles/global.css`

## Actual Extension Development Host scenarios

The extension was built and run in VS Code 1.95.0 Extension Development Hosts against isolated repositories and profiles. The screenshots are full Extension Development Host captures, not browser-only renders.

- **A — Feature:** created “Add guarded refunds to settled orders” with a specification; Review and Active Work showed the same values and the six feature stages.
- **B — Bug fix:** used a clean repository/profile; created “Prevent duplicate webhook delivery” without a specification; Active Work showed the five bug-fix stages and no feature-only Plan stage.
- **C — Validation:** blank intent kept Continue disabled; a 10,001-character intent showed “Intent must be 10,000 characters or fewer”; a valid intent enabled Continue.
- **D — Duplicate prevention:** the Extension Host was paused after dispatch to hold the real pending UI, Create was invoked twice, the button became disabled as “Creating…”, and the persisted fixture contained exactly one workflow.
- **E — Reload:** ran **Developer: Reload Webviews** after creating the bug-fix workflow; the same intent, work type, timestamps, no-spec state, stages, and current stage were restored.
- **F — Extension restart:** allowed the first host to stop, relaunched the same repository/profile, and confirmed Home and Active Work restored feature workflow ID `816f61cb-e323-412d-ba2f-fa6cac34aafe` and its original values from disk.
- **G — History:** History listed the persisted feature intent, work type, status, and timestamps; opening the record used the non-mutating Active Work renderer. Completed/cancelled records are covered by UI fixtures because Phase 2 intentionally has no completion controls.
- **H — Failure:** used a controlled fixture that blocked the atomic target path. Review showed the recoverable persistence error, did not navigate, and created no partial workflow. After moving the blocker aside, retry succeeded and exactly one workflow was present.

## Visual review and screenshots

The live review covered spacing, hierarchy, border density, form clarity, stage readability, button priority, error placement, responsive layout, and VS Code light/dark variables. It found and corrected a missing over-limit message, a misleading low-level persistence message, and redundant/unformatted Home summary text.

Requested screenshot map:

- Define step: [define-step-dark-full.png](screenshots/phase2/define-step-dark-full.png)
- Review step: [review-step-dark-full.png](screenshots/phase2/review-step-dark-full.png)
- Validation error: [validation-error-dark-full.png](screenshots/phase2/validation-error-dark-full.png)
- Creation pending: [creation-pending-dark-full.png](screenshots/phase2/creation-pending-dark-full.png)
- Active workflow with specification: [active-workflow-with-spec-dark-full.png](screenshots/phase2/active-workflow-with-spec-dark-full.png)
- Workflow without specification: [active-bug-fix-no-spec-dark-full.png](screenshots/phase2/active-bug-fix-no-spec-dark-full.png)
- Home active-work summary: [home-active-summary-dark-full.png](screenshots/phase2/home-active-summary-dark-full.png)
- History: [history-dark-full.png](screenshots/phase2/history-dark-full.png)
- Light theme: [restart-active-workflow-light-full.png](screenshots/phase2/restart-active-workflow-light-full.png)
- Dark theme: [active-workflow-with-spec-dark-full.png](screenshots/phase2/active-workflow-with-spec-dark-full.png)
- Narrow side-panel layout: [active-workflow-light-narrow.png](screenshots/phase2/active-workflow-light-narrow.png)
- Full editor layout: [restart-active-workflow-light-full.png](screenshots/phase2/restart-active-workflow-light-full.png)

Additional evidence:

- Empty Home: [home-empty-dark-full.png](screenshots/phase2/home-empty-dark-full.png)
- Restart restoration on Home: [restart-home-active-light-full.png](screenshots/phase2/restart-home-active-light-full.png)
- Webview reload restoration: [webview-reload-restored-dark-full.png](screenshots/phase2/webview-reload-restored-dark-full.png)
- Bug-fix review: [bug-fix-review-no-spec-dark-full.png](screenshots/phase2/bug-fix-review-no-spec-dark-full.png)
- Persistence failure: [persistence-failure-dark-full.png](screenshots/phase2/persistence-failure-dark-full.png)
- Successful retry: [persistence-retry-success-dark-full.png](screenshots/phase2/persistence-retry-success-dark-full.png)

## Automated verification

Final clean-install and verification results:

```text
npm ci
added 603 packages; audited 604 packages; 0 vulnerabilities

npm run typecheck
passed

npm test
Test Files 74 passed (74)
Tests      587 passed (587)

npm run build
passed (extension, semantic worker, and webview)

npm run test:extension
VS Code 1.95.0 Extension Development Host exited 0

npm run package
passed
Packaged: keystone-0.1.0.vsix (23 files, 2.24 MB)
```

Packaging reports the repository's existing missing-license warning; it does not fail the package. The package uses publisher `keystone-dev` and the repository-provided `package` script.

## Actual limitations and deliberate exclusions

- Phase 2 supports one active workflow. A second workflow is blocked until a later phase adds a real completion/cancellation transition.
- Stages are persisted read-only summaries. Only the first is `ready`; current-stage execution is explicitly deferred.
- Workflow IDs are persisted and used by protocol/routing, but the current UI emphasizes intent rather than displaying the UUID.
- Legacy backend workflow code remains in the repository for compatibility, but Phase 2 Home, Setup, Active Work, and History do not use it as their workflow authority.
- There is no Development execution, context compression, Copilot handoff, instruction/skill/agent system, test planning/execution/generation, security/performance workflow, PR review execution, or Task Handoff in this phase.
- QA and PR Review are stage names only; they do not claim implemented QA or review functionality.

