# Phase 1 Home Evidence

## Scope

This correction covers only the Keystone shell, four-section Home screen, Start Work draft boundary, read-only Active Work summary, capability honesty, instruction discovery honesty, and their protocol/tests. It does not implement workflow stages, delegation execution, QA, security, performance, PR review, context compression, agent configuration, or Task Handoff.

## Test-first record

The six required correction suites were added before production changes. The initial run failed in all six test files with six reported test failures plus two missing-module suites. Full details are recorded in `PHASE_1_CORRECTION_TDD.md`.

## Routes and state

- Home route: `/`
- Bounded Home request: `home/getState`
- Start Work route: `/workflow/new`
- Active Work route: `/active-work`
- Home does not request orchestration, Copilot, integration, or workbench creation state.
- Start Work stores intent/work type in VS Code Webview session state and does not create a workflow.
- Active Work reads persisted workflow data and exposes no stage execution or result-capture controls.

## Automated results

- Correction suites: 6 files passed, 9 tests passed.
- Full test run: 68 files passed, 567 tests passed.
- `npm ci`: passed; 603 packages installed, 0 vulnerabilities.
- `npm run typecheck`: passed with no TypeScript errors.
- `npm test`: passed; 68 files and 567 tests.
- `npm run build`: passed; extension, semantic worker, and Webview bundles produced.
- `npm run test:extension`: passed against a real VS Code 1.95.0 Electron Extension Development Host after restoring the extension publisher identity.

## Files changed for this correction

- `src/shared/contracts/home.ts`
- `src/core/home/HomeStateService.ts`
- `src/shared/contracts/messages.ts`
- `src/shared/contracts/domain.ts`
- `src/shared/navigation.ts`
- `src/extension/webview/WebviewMessageRouter.ts`
- `src/ui/services/HostBridge.ts`
- `src/ui/App.tsx`
- `src/ui/components/home/HomeDashboard.tsx`
- `src/ui/components/workflow/StartWorkDraft.tsx`
- `src/ui/components/workbench/ActiveWork.tsx`
- `src/ui/components/intelligence/DiagnosticDetails.tsx`
- `src/core/execution/delegationService.ts`
- `src/core/execution/capabilityDiscoveryService.ts`
- `src/core/execution/instructionConflictDetector.ts`
- `package.json` (restored the `keystone-dev` publisher identity required for Extension Host discovery)
- Required new tests and existing tests updated to the corrected Phase 1 contract.

## Included test-file inventory

The required `find tests src ...` command was run. Its output includes:

```text
tests/extension/homeProtocol.test.ts
tests/ui/ActiveWorkEmptyState.test.tsx
tests/ui/HomeDashboard.test.tsx
tests/ui/StartWorkDraft.test.tsx
tests/unit/execution/CapabilityHonesty.test.ts
tests/unit/home/HomeStateService.test.ts
```

The complete command output also contains the repository's existing UI, unit, integration, fixture, and extension test files; the `tests` directory is present in the working deliverable.

### Complete output

```text
tests/extension/homeProtocol.test.ts
tests/fixtures/benchmarks/fullstack/server/tests/integration/checkout.test.ts
tests/fixtures/benchmarks/fullstack/ui/tests/unit/CheckoutPage.test.tsx
tests/fixtures/benchmarks/multi-package/tests/unit/app.test.tsx
tests/fixtures/benchmarks/multi-package/tests/unit/shared.test.ts
tests/fixtures/benchmarks/react-frontend/tests/unit/OrderConsumer.test.tsx
tests/fixtures/benchmarks/react-frontend/tests/unit/useCreateOrder.test.ts
tests/fixtures/benchmarks/typescript-backend/tests/integration/orders.test.ts
tests/fixtures/benchmarks/typescript-backend/tests/unit/order.service.test.ts
tests/integration/GitDeliveryAdapter.test.ts
tests/ui/ActiveWorkEmptyState.test.tsx
tests/ui/App.test.tsx
tests/ui/DeliveryWorkspace.test.tsx
tests/ui/DevelopmentWorkspace.test.tsx
tests/ui/ExecutionValidationWorkspace.test.tsx
tests/ui/HomeDashboard.test.tsx
tests/ui/HostBridge.test.ts
tests/ui/OrchestrationWorkspace.test.tsx
tests/ui/QueryWorkspace.test.tsx
tests/ui/SDLCWorkbench.test.tsx
tests/ui/SemanticBrowser.test.tsx
tests/ui/StartWorkDraft.test.tsx
tests/ui/TeamWorkflowWorkspace.test.tsx
tests/ui/UiState.test.tsx
tests/ui/phase10Consolidation.test.tsx
tests/unit/NativeShellServices.test.ts
tests/unit/benchmarks/evaluate.test.ts
tests/unit/context/ContextEngine.test.ts
tests/unit/context/ContextPipeline.test.ts
tests/unit/contracts.test.ts
tests/unit/copilot/ControlledDelegation.test.ts
tests/unit/copilot/CopilotCustomizationService.test.ts
tests/unit/copilot/CopilotIntegrationService.test.ts
tests/unit/delivery/GitDeliveryService.test.ts
tests/unit/execution/AdvancedExecutionValidation.test.ts
tests/unit/execution/CapabilityHonesty.test.ts
tests/unit/execution/ExecutionValidation.test.ts
tests/unit/home/HomeStateService.test.ts
tests/unit/integration/ProductIntegrationService.test.ts
tests/unit/intelligence/IgnorePolicy.test.ts
tests/unit/intelligence/IntelligenceQueryService.test.ts
tests/unit/intelligence/IntelligenceStore.test.ts
tests/unit/intelligence/RepositoryIndexService.test.ts
tests/unit/intelligence/SemanticPersistence.test.ts
tests/unit/intelligence/SemanticQueryService.test.ts
tests/unit/intelligence/StableId.test.ts
tests/unit/intelligence/adapters/UniversalAdapterEngine.test.ts
tests/unit/intelligence/cpg/CpgBuilder.test.ts
tests/unit/intelligence/cpg/CpgPersistenceQuery.test.ts
tests/unit/intelligence/qa/Phase7Remediation.test.ts
tests/unit/intelligence/query/QueryEngine.test.ts
tests/unit/intelligence/runtime/ChangeCollector.test.ts
tests/unit/intelligence/runtime/IngestionScheduler.test.ts
tests/unit/intelligence/runtime/IntelligenceRuntime.test.ts
tests/unit/intelligence/runtime/StartupReconciler.test.ts
tests/unit/intelligence/runtime/WorkerPoolManager.test.ts
tests/unit/intelligence/security/Phase8Intelligence.test.ts
tests/unit/intelligence/semantic/SemanticDeltaBuilder.test.ts
tests/unit/intelligence/semantic/SemanticGraphBuilder.test.ts
tests/unit/intelligence/semantic/TypeScriptJavaScriptParser.test.ts
tests/unit/navigation.test.ts
tests/unit/orchestration/OrchestrationService.test.ts
tests/unit/persistence.test.ts
tests/unit/persistence/CpgShardStore.test.ts
tests/unit/persistence/ScopeCorrectionMigration.test.ts
tests/unit/redaction.test.ts
tests/unit/review/ReviewContractsAndPersistence.test.ts
tests/unit/scopeCorrection.test.ts
tests/unit/tasks/TaskGraphService.test.ts
tests/unit/team/TeamWorkflowService.test.ts
tests/unit/uiEndToEndAudit.test.ts
tests/unit/uiInteractionContracts.test.ts
tests/unit/validation/ValidationEngine.test.ts
tests/unit/webview/WebviewMessageRouter.test.ts
tests/unit/workflows/DevelopmentWorkflowService.test.ts
tests/unit/workflows/ExecutionRoutingService.test.ts
```

## Extension Development Host scenarios and screenshots

The Electron Extension Development Host test harness launched the development extension, activated it, opened the Keystone panel twice, verified singleton reuse, and completed with exit code 0.

The requested interactive screenshot matrix could not be truthfully captured in this run. The macOS automation layer focused an existing VS Code window instead of the isolated Development Host window. Four resulting captures were inspected, rejected as invalid, and moved out of the repository to a recoverable temporary directory. No generated, mock, or mislabeled screenshots are included.

| Scenario | Expected result | Observed result | Screenshot path |
|---|---|---|---|
| No repository open | Home shows unavailable repository intelligence and no active workflow | Not interactively verified; host harness passed | Not captured |
| Repository, intelligence not initialized | Truthful not-initialized status | Not interactively verified; host harness passed | Not captured |
| Intelligence loading | Real progress shown | Not interactively verified | Not captured |
| Intelligence ready | Real generation/revision shown | Host intelligence lifecycle passed; UI not interactively captured | Not captured |
| No active workflow | Truthful empty state | Automated UI test passed; not interactively captured | Not captured |
| Existing active workflow summary | Persisted bounded summary and Resume Work | Automated UI/service tests passed; not interactively captured | Not captured |
| Start Work draft form | Intent, work type, Cancel, Continue | Automated UI test passed; not interactively captured | Not captured |
| Draft after Continue | Draft retained and Phase boundary notice shown | Automated UI test passed; not interactively captured | Not captured |
| Home after Webview reload | Home reloads from `home/getState` | Not interactively verified | Not captured |
| Home after Extension Host restart | Persisted Home data restored; session draft persistence not promised | Not interactively verified | Not captured |
| Light theme | Four-section Home remains readable | Not interactively verified | Not captured |
| Dark theme | Four-section Home remains readable | Not interactively verified | Not captured |

## Known limitations and intentionally unavailable capabilities

- A Start Work draft persists only for the current Webview session, not across Extension Host restart.
- Stage creation and execution begin in a later implementation phase.
- Direct execution has no registered production API and fails as unsupported.
- Deterministic execution succeeds only for explicitly registered operations; none are fabricated.
- Chat and clipboard paths represent handoff only, never completion.
- Missing or unreadable configured instruction files produce diagnostics and no instruction record.
- No Task Handoff, QA, security, performance, PR review, agent configuration, or context-compression surface is part of Phase 1.
