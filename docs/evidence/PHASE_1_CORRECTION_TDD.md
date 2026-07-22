# Phase 1 Correction TDD Record

## Initial failing run

Run before production changes on 2026-07-22:

```text
npx vitest run tests/ui/HomeDashboard.test.tsx tests/ui/StartWorkDraft.test.tsx tests/ui/ActiveWorkEmptyState.test.tsx tests/unit/home/HomeStateService.test.ts tests/unit/execution/CapabilityHonesty.test.ts tests/extension/homeProtocol.test.ts

Test Files  6 failed (6)
Tests       6 failed (6)
```

Observed failures matched the correction targets:

- `HomeStateService` and `StartWorkDraft` did not exist.
- `home/getState` was rejected by the Webview protocol.
- Home required the old bootstrap projection model and loaded multiple subsystems.
- Active Work rendered the workflow creation form instead of a truthful empty state.
- Direct and deterministic delegation returned fabricated completion.
- Instruction discovery emitted records for files that had not been read.

## Final run

```text
Test Files  6 passed (6)
Tests       9 passed (9)
```

The full repository test gate subsequently passed 68 test files and 567 tests.
