# Keystone Phase 8 Test Intelligence Evidence

Recorded on 2026-07-23. This document covers the Test Intelligence layer inside the canonical QA stage: Test Generation, Failure Classification, Flaky-Test Analysis, and Safe Healing. It distinguishes verified deterministic behavior from UI/host wiring that requires the extension host to exercise end-to-end.

## TDD sequence

The service-level and protocol tests were authored against the contract-first schemas, then kept green while the production implementation was completed. The intentional baseline and command are recorded in [PHASE_8_TDD_BASELINE.md](PHASE_8_TDD_BASELINE.md).

Final Phase 8 coverage:

- `tests/unit/impactQa/phase8TestIntelligence.test.ts` — deterministic service behavior (classifier, flaky, policy, scenario, orchestration).
- `tests/unit/impactQa/phase8Protocol.test.ts` — contract surface (21 request types, `.strict()` rejection, aggregate round-trip).

The repo-wide unit suite is **671 passed (80 files)** and `npm run verify` (typecheck && test && build) is green. A `keystone-0.1.0.vsix` package is produced by `npm run package`.

## Reused services and contracts

Phase 8 deliberately reuses existing infrastructure instead of duplicating it:

- **Phase 7 QA flow** — `TestIntelligenceService` consumes `ImpactQaAggregate` (coverage gaps, capabilities, decision) and persists a separate `QaTestIntelligenceAggregate` keyed by `workflowId`. It reads coverage gaps through the existing `ImpactQaService.load`, never re-deriving impact analysis.
- **Phase 5 context system** — `TestGenerationContextService` and `TestHealingContextService` build bounded `ContextPackage` objects via the existing `ContextEngine`/`TokenCounterRegistry`, with `satisfiesRequiredFacts: []` so existing required-fact completeness checks are not broken. The `RequiredFactCategory` enum was extended with `"validation-evidence"` and `"specification"` (legitimate Phase 8 healing facts).
- **Phase 4 execution profiles** — the Test Generation skill is seeded as a `SkillDefinition` through `DevelopmentSkillService.builtInTestGenerationSkill()` and registered in `ExecutionConfigurationService`, reusing the existing skill/profile machinery.
- **Skill profile** — a single Test Generation skill is surfaced with `applicableStageTypes: ["qa"]`; `DevelopmentSkillService.list` now also accepts `qa` stage items (intentional Phase 8 behavior).

## Service surface (src/core/impactQa)

- **TestFailureSignature** — deterministic, normalized signature that strips timestamps and UUIDs so two occurrences of the same failure collapse to one signature.
- **TestFailureClassifier** — classifies a `FailureClassificationEvidence` into one of the `FailureCategory` values (`production-defect`, `regression`, `flaky-candidate`, `environment`, `healing-candidate`, `unknown`). Production-defect detection keys off `changedProductionFiles` + production stack frames.
- **FlakyClassificationService** — classifies a run sequence into `flaky-candidate` / `flaky-confirmed` / `stable-fail` / `insufficient-evidence`, with a confidence that is deliberately capped below confirmation threshold for a single pass/fail pair.
- **TestChangePolicyService** — blocks unsafe healing changes: test deletion, skip/disable markers, arbitrary `sleep`, unbounded `retry`, timeout increases, and production/configuration edits. Each blocking rule emits a typed `PolicyFinding` with a stable `rule` id.
- **TestScenarioService** — derives test scenarios only when there is acceptance criteria, changed behaviour, or an existing test; otherwise throws `ScenarioEvidenceInsufficientError` (no evidence → no scenario).
- **SafeWorkspaceEditService** — applies unified diffs with best-effort line merge and revert support; all writes go through controlled command execution.
- **TestIntelligenceService** (orchestrator) — owns the `QaTestIntelligenceAggregate` lifecycle: generation requests, scenario derivation/approval, generation context, proposals, policy assessment, failure analysis + classification acceptance, flaky history, remediation proposals + policy, safe application with revert, and a bounded validation sequence. Production defects are routed to Development (`recommendedAction: return-to-development`) and no test healing is performed for them.

## Contract surface (src/shared/contracts/phase8TestIntelligence.ts)

- Exactly **21** `testIntelligence.*` request schemas, each `.strict()`.
- Corresponding result/event schemas and `QaTestIntelligenceAggregateSchema`.
- `TEST_INTELLIGENCE_REQUESTS` registry used by the webview router and the protocol test.

## Host wiring (three touchpoints, per repo convention)

Every new host request is wired consistently in all three places:

1. `src/shared/contracts/messages.ts` — `WebviewRequestSchema` discriminated union gains the 21 entries.
2. `src/extension/webview/WebviewMessageRouter.ts` — a single `routeTestIntelligence` dispatch (21 cases) plus one `validateResult` case, with `testIntelligence.createFailureAnalysis` assembling a complete `FailureClassificationEvidence` from the request payload (the UI sends only `testFailureId` + optional fields).
3. `src/ui/services/HostBridge.ts` — 21 `case "testIntelligence.*"` results parsed through `QaTestIntelligenceAggregateSchema`.

The service is instantiated and registered in `src/extension/extension.ts`.

## UI (src/ui/components/workbench/QaStage.tsx)

Two new Phase 8 sections are rendered after the existing QA content, both calling typed `testIntelligence.*` host requests with loading/error/empty states:

- **Coverage / Test Generation** — per coverage gap: generate → derive scenarios → select/approve → build generation context → approve.
- **Failure Analysis / Remediation** — list `failureAnalyses` (category, confidence, recommended action), accept a classification via a category `<select>`, "Analyze failure" (collects test id/path/message), flaky-classification list + "Request 3 repeated runs", and a policy-assessments list showing blocking findings.

A `testIntelligence.load` + `testIntelligence.updated` subscription re-renders the Phase 8 aggregate in place.

## Healed/blocked behavior (verified)

- Production defects: classifier returns `production-defect`; orchestrator calls `development.createDefectWorkItem` and returns `recommendedAction: return-to-development`; `createRemediationProposal` for a production defect rejects with a production-scoped error (no healing).
- Unsafe healing: any proposal containing delete/skip/sleep/retry/timeout/config change is blocked at `validateProposalPolicy` / `validateRemediationPolicy` with a `status: "blocked"` and the specific `policy-*` rules.

## Out of scope / not invented

No LLM-based flake prediction, no auto-edit of production code, no test disabling, no timeout/sleep/retry injection, no configuration mutation. All healing is opt-in, policy-gated, and revertable.

## Known pre-existing repo state (not Phase 8)

`npm run lint` reports 216 errors across the repository (down from 239 after enabling the intended `argsIgnorePattern: "^_"` / `varsIgnorePattern: "^_"` in `eslint.config.mjs`, which the maintainers had left commented). These are pre-existing and outside Phase 8; they do not block `npm run verify` (which omits lint). Phase 8's own files report **0** lint errors and **0** typecheck errors.
