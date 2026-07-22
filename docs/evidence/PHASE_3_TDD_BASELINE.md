# Phase 3 TDD Baseline

The Phase 3 tests were added before production implementation and run on 2026-07-22.

```text
npx vitest run tests/unit/development/DevelopmentService.test.ts tests/unit/development/SourceScopeService.test.ts tests/unit/development/DevelopmentPromptService.test.ts tests/unit/development/ManualHandoffService.test.ts tests/unit/development/WorkspaceChangeService.test.ts tests/ui/DevelopmentStage.test.tsx tests/extension/developmentProtocol.test.ts

Test Files  7 failed (7)
Tests       6 failed | 1 passed (7)
```

Initial failures demonstrated the missing Phase 3 behavior:

- canonical Development work-item, source-scope, prompt, handoff, and workspace-change services did not exist;
- the bounded Development webview component did not exist;
- all six tested typed Development requests were rejected by the shared protocol;
- only the negative protocol boundary test passed because uncorrelated Development input was already rejected as unknown.

The raw output contained six missing-module failures and six protocol validation failures.
