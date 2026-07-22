# Phase 2 TDD Baseline

The Phase 2 tests were added before production implementation and run on 2026-07-22.

```text
npx vitest run tests/unit/workflow/WorkflowService.test.ts tests/unit/workflow/WorkflowPersistence.test.ts tests/extension/workflowProtocol.test.ts tests/ui/WorkflowSetup.test.tsx tests/ui/ActiveWorkflow.test.tsx tests/ui/WorkflowHistory.test.tsx

Test Files  6 failed (6)
Tests       6 failed (6)
Errors      1 error
```

Initial failures demonstrated the missing Phase 2 behavior:

- `WorkflowService` and its persistence contract did not exist.
- The typed canonical workflow requests were rejected by the protocol.
- Start Work still stopped at the Phase 1 boundary instead of rendering Review/Create.
- Active Work still requested the legacy workflow list.
- History still expected legacy completion/task data.

The full raw output included missing-module errors, protocol validation failures, absent Review/Create controls, the legacy Active Work collection mismatch, and the legacy History completion-record crash.
