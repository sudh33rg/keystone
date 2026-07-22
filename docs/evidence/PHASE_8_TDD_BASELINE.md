# Phase 8 TDD baseline

Recorded: 2026-07-23

Command:

```text
npx vitest run tests/unit/impactQa/phase8TestIntelligence.test.ts tests/unit/impactQa/phase8Protocol.test.ts
```

Result: **14 passed (2 files)** — `phase8TestIntelligence.test.ts` (10 tests) and `phase8Protocol.test.ts` (4 tests).

These tests were authored against the contract-first schemas in `src/shared/contracts/phase8TestIntelligence.ts` and the deterministic service layer under `src/core/impactQa/`, then kept green while the production implementation was completed. They establish the intentional behavioral baseline for Phase 8 (Test Generation, Failure Classification, Flaky-Test Analysis, Safe Healing).

## What the baseline enforces

`phase8TestIntelligence.test.ts` (service-level, deterministic):

- **Failure-signature stability** — `TestFailureClassifier` produces a stable signature that excludes timestamps and UUIDs (two runs differing only by `<TIME>`/`<ID>` collapse to the same signature).
- **Flaky candidate detection** — a `signatureVariesAcrossRuns: true` evidence yields category `flaky-candidate`.
- **Flaky confirmation discipline** — `FlakyClassificationService` never flags a single pass/fail pair as confirmed flaky (`state === "flaky-candidate"`, confidence ≤ 0.6); three identical failures yield `stable-fail`.
- **Policy guardrails** — `TestChangePolicyService` blocks deletes, skips, arbitrary `sleep`, unbounded `retry`, timeout increases, and production/config changes, emitting the exact `policy-*` finding rules.
- **Scenario evidence discipline** — `TestScenarioService.derive` throws when there is no acceptance criteria, changed behaviour, or existing test.
- **Orchestration** — `TestIntelligenceService` creates a generation request from an accepted coverage gap (mapping `recommendedTestLayer: "e2e"` → `"end-to-end"`), refuses a request for a missing gap, routes production defects to Development and blocks remediation healing (`recommendedAction: return-to-development`, no test healing), and persists policy assessments inside the aggregate.

`phase8Protocol.test.ts` (contract-level):

- Exactly **21** `testIntelligence.*` request types are defined and each validates against its own zod schema.
- `.strict()` rejects an unknown extra field on a request.
- The orchestrator's aggregate round-trips through `QaTestIntelligenceAggregateSchema`.

## Scope

These tests are independent of VS Code APIs and run under vitest with four-level relative imports, consistent with the repo's unit-test convention. They do not require a live extension host.
