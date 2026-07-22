# Phase 5 TDD baseline

Recorded: 2026-07-22 (Asia/Kolkata)

Command:

```text
npx vitest run tests/unit/context/DevelopmentContextPackageService.test.ts tests/unit/context/TokenBudgetOptimizerTokenizer.test.ts
```

Result before production implementation: one test suite failed to load because `src/core/context/DevelopmentContextPackageService.ts` did not exist. The independent tokenizer-consistency regression test passed against the old optimizer only because it did not force the summary-fit branch; the Development lifecycle suite establishes the intentional red baseline for the new Phase 5 behavior.

The baseline tests require a bounded Development raw package, persisted measurable reduction, critical-fact completeness, revision-safe approval, immutable superseded revisions, impossible-budget blocking, and staleness.
