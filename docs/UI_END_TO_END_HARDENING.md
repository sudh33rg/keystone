# UI End-to-End Hardening

## Scope

This final UI architecture task validates the existing Keystone product from the native Activity Bar dashboard through the singleton React Webview. It adds no product capability and does not change the canonical workflow, Intelligence, Copilot, Handoff, review, completion, or persistence models.

## Final information architecture

Primary navigation is exactly Home, SDLC Workbench, Intelligence, and History.

- Define owns Intent, repository scope, clarification, Specification revisions, acceptance criteria, and explicit Specification approval.
- Plan owns deterministic Task generation, dependencies, criterion coverage, validation, and explicit task-plan approval.
- Build owns task readiness, GitHub Copilot guidance/capabilities, context, delegation approval, observed changes, task validation, retry, and Task Handoff.
- Validate is a workflow-scoped aggregate of existing task execution/validation sessions. It never selects a session from another workflow and returns to Build for task configuration or execution.
- Review owns traceability, changed files/symbols, QA/security/performance/documentation findings, change requests, the PR review package, and explicit review approval.
- Complete owns local completion and separately approved optional Git, commit, push, PR, patch, partial-close, and Handoff actions. Delivery is not a required stage or separate product.
- Diagnostics and Settings are secondary header destinations. VS Code Settings remains canonical for preferences.

## Native and Webview integration

The Task-6 native dashboard and panel architecture remains unchanged: one Activity Bar container, one dashboard view, and one window-scoped panel service. Native destinations compile to typed launch requests, validate repository and stable identifiers, reuse the open panel, complete the ready/initialize/navigation acknowledgement handshake, focus the Webview main region, and announce recovery when a target no longer exists. No domain record, source body, prompt, secret, or credential is stored in native tree items.

Compatibility sections are migrated through `compatibilityRoute`. Safe panel state retains only the validated route, stable IDs, bounded Intelligence query context, drawer state, and column. Reload, close/reopen, extension reload, and restart restore the last safe route. Branch/repository mismatch, deleted workflows, superseded tasks, and missing entities use the existing launch validator to choose the nearest valid parent and provide a recovery reason rather than rendering a blank page.

## Home and workflow integration

Home now combines current host facts rather than bootstrap-only labels:

- repository name and branch come from live Intelligence, the matching workflow instance, or the typed creation context;
- Intelligence status/generation updates while Home is open;
- active workflow and task are matched by canonical identifiers;
- pending approvals, blocking findings, and validation failures use orchestration progress;
- GitHub Copilot is presented as Ready, Limited, Available, or Unavailable from independently proved capabilities;
- repository, Intelligence, workflow, task, finding, and validation cards open a useful destination; unavailable workflow states explain the next valid action.

Every Workbench stage exposes Repository Intelligence through the workflow-actions menu. Back/stage navigation uses canonical host projections and does not duplicate the workflow model in React.

## Error, empty, and loading states

`UiState.tsx` defines the shared `KeystoneUiError` shape: ID, category, title, bounded message, preservation state, retryability, recovery actions, and whether technical details exist. The shared accessible renderer presents the main recovery message, never a stack trace, and labels retry/dismiss actions. App-level requests, Home loading/Handoff import, and History loading use this shape. Existing domain-specific stage diagnostics retain their stable diagnostic codes and recovery instructions.

History now has an actionable empty state. Workflow Validate has a scoped empty state and Return to Build action. Route chunks and initial bootstrap have announced loading states. Intelligence retains the last complete generation during background work and exposes measured progress/cancellation where supported.

## Accessibility, responsive layout, and theme

- Primary navigation, stage navigation, cards, error recovery, and workflow actions are real keyboard controls with accessible names.
- Route changes restore focus to `<main>`; loading and stage recovery use live regions; errors use `role=alert`.
- Stage tabs expose `aria-current=step`, descriptions, text status, and keyboard arrow/Home/End handling. Status never depends on color alone.
- At 360 px, Home, Start New Work, Define, and Intelligence had equal document/client widths with no page-level horizontal overflow. At 720 px and 1440 px, main content also remained bounded. Header labels collapse to labelled icons only at the narrow breakpoint.
- Build and Review columns collapse at their existing breakpoints; bounded diff, prompt, graph, table, and flow surfaces retain controlled local scrolling.
- Colors use VS Code theme variables. Success/warning tokens now use VS Code testing/notification variables. Forced-colors mode explicitly restores borders, focus, and loader contrast. Reduced-motion mode disables meaningful animation duration.
- The automated CSS audit covers narrow, high-contrast, reduced-motion, and theme-token contracts. A real screen-reader product pass remains a release QA activity; no primary-flow semantic blocker was found in component or browser checks.

## Performance and bounded state

Route-level lazy loading removed the Webview chunk warning:

| Artifact | Before | After |
| --- | ---: | ---: |
| Initial Webview JavaScript | 596.41 kB | 444.93 kB |
| SDLC Workbench route | part of initial chunk | 100.97 kB |
| Intelligence route | part of initial chunk | 54.53 kB |
| History route | part of initial chunk | 2.44 kB |

Focused measured test times were: native empty/missing dashboard projection 3 ms; Home 73 ms; workflow creation/Define navigation 90 ms; scoped Validate 48 ms; full App navigation/Intelligence interaction 413 ms. Browser interaction confirmed no page overflow at 360, 720, or 1440 px. Existing bounded contracts, pagination, cancelled Intelligence requests, lazy Review diff loading, lazy query evidence, and scoped graph rendering remain in effect. No complete graph or independent writable workflow is held in App state.

## Contracts and contributions

The interaction audit found every UI request in the versioned contract, Extension Host router/panel handler, and Webview response validator. Request IDs, cancellation, correlation, runtime validation, and bounded schemas remain intact. No duplicate production request type or obsolete primary-route message was introduced. Compatibility requests remain because persisted state and old callers still use them.

The manifest contains one Activity Bar container and one `keystone.dashboard` view. It contains no standalone Intent, Tasks, Delivery, Task Handoff, Diagnostics, Settings, Hub, local-model, training, or roadmap view. Editor actions remain bounded Intelligence deep links. The packaged extension contains the extension bundle, semantic worker, four Webview JavaScript chunks, CSS, HTML, and one icon.

## End-to-end scenario evidence

The scenarios are composed from real service/integration/component/Extension Host tests rather than a second fake workflow engine:

1. Feature lifecycle: workflow creation, Specification/task-plan approval, context/delegation/execution/validation, Review, local completion, and History are covered across `DevelopmentWorkflowService`, `ExecutionValidation`, Review, and Webview suites.
2. Bug/retry: failed validation, retry plan/start, corrected evidence, and reevaluation are covered by `ExecutionValidation.test.ts` and Build interaction tests.
3. Git/PR: disposable Git fixtures cover change set, staging/commit/push safety, PR preparation, and separate approval fingerprints; local completion remains independent.
4. Task Handoff: team integration tests cover reviewed export, secret exclusion, compatible import, acceptance, normal workflow continuation, and duplicate rejection.
5. Restart recovery: workflow, execution, review, Handoff, native-shell, and Intelligence persistence tests reload their file-backed stores; the Extension Host suite verifies activation and safe singleton reuse.
6. Stale state: repository/branch/generation fingerprints invalidate context, validation, Review, and mutation approvals; Git reconciliation runs in the Extension Host suite.
7. Copilot unavailable: Home and Build capability tests retain manual/assisted/clipboard limitations without blocking workflow state.
8. Multi-root: native target validation rejects repository mismatch with an explicit recovery; canonical Intelligence continues to bind the promoted repository until an explicit repository switch is available.

## Remaining P2/P3 items

- P2: old standalone `DeliveryWorkspace` and `OrchestrationWorkspace` React components remain unrouted because isolated compatibility tests still import them. They do not appear in production navigation or contributions. Removing those compatibility tests/components is cleanup, not a user-flow repair.
- P2: very large bounded task/result lists use controlled scrolling rather than virtualization. Current contracts cap their size and no measured primary-flow regression was reproduced; virtualization should be driven by a failing performance budget, not added speculatively.
- P2: multi-root deep links do not switch repositories automatically. They deliberately require recovery/explicit selection to avoid mutating the wrong workflow.
- P3: the local browser simulator supports Home, Start New Work, and the initial Define projection; later lifecycle stages require the real Extension Host and canonical stores.
- P3: VSIX packaging still warns that the repository has no LICENSE file. Packaging and isolated installation succeed; this is release metadata, not a UI defect.

No P0 or unresolved P1 UI defect remains from the verified audit. No future-roadmap functionality was introduced.
