# Keystone Phase 3 Development Evidence

Verified on 2026-07-22 in the real VS Code 1.95.0 Extension Development Host on macOS. This report covers only the persisted Development stage and source scope requested for Phase 3.

## Scope and active route

Active Work now owns one canonical Development workspace rendered by `DevelopmentStage` inside `ActiveWork`. It contains exactly six numbered sections: Objective, Source Scope, Prompt Preparation, Development Result, Changed Files, and Completion. The active application does not import or route to the legacy `DevelopmentWorkspace` or an old `/workbench/.../implement` path.

Selecting Development calls the typed `development.initialize` host request. The extension activates the persisted canonical Development stage, creates at most one work item for the workflow/stage pair, and restores that same item on later loads. Completing Development persists the work item as completed, persists the canonical stage as completed, and marks the next canonical stage ready.

## Tests written first

The initial Phase 3 suite was written and run before the corresponding production implementation:

- `tests/unit/development/DevelopmentService.test.ts`
- `tests/unit/development/SourceScopeService.test.ts`
- `tests/unit/development/DevelopmentPromptService.test.ts`
- `tests/unit/development/ManualHandoffService.test.ts`
- `tests/unit/development/WorkspaceChangeService.test.ts`
- `tests/ui/DevelopmentStage.test.tsx`
- `tests/extension/developmentProtocol.test.ts`

That first run failed with 7 failing test files, 6 failing tests, and 1 passing negative-boundary test. The missing modules and unknown Development protocol messages are recorded in [PHASE_3_TDD_BASELINE.md](PHASE_3_TDD_BASELINE.md).

Real-host review later exposed four additional defects. Each received a failing regression before its production fix:

- `tests/unit/development/VsCodeDevelopmentAdapter.test.ts`: the webview owning focus hid `activeTextEditor`; the adapter now uses the last visible file editor, and the picker excludes `.keystone` persistence files.
- `tests/unit/development/WorkspaceChangeService.test.ts`: Git changes included Keystone's own `.keystone` state; internal state is now excluded from user change review.
- `tests/ui/DevelopmentStage.test.tsx`: a completed item showed Completion as ready and retained an actionable-looking completion control; it now shows completed with a disabled `Development Completed` control.
- `tests/unit/development/DevelopmentService.test.ts`: explicitly manual work incorrectly required a prepared prompt; the manual route now completes without a prompt or agent handoff.

The focused final Phase 3 run passed 8 files and 40 tests.

## Canonical records and services

`src/shared/contracts/development.ts` defines and validates the persisted work item, scope item, prompt preparation, handoff, result, changed-file detection, aggregate, and persistence records. `src/shared/contracts/messages.ts` supplies strict, correlated request/result contracts for initialization, objective editing, scope operations, prompt/handoff operations, result capture, change association, review, and completion.

`src/core/development/DevelopmentService.ts` owns the state machine and writes `.keystone/workflows/phase-3-development.json`. It persists objective revisions, source-scope IDs, versioned prompt preparations, handoff records, manual origin, results, changed-file decisions, review, and completion. It rejects workflow/work-item mismatches and enforces completion gates. Malformed persistence produces a diagnostic instead of silently inventing state.

`src/core/development/SourceScopeService.ts` accepts only existing files inside the current workspace, normalizes workspace-relative paths, prevents duplicates, refreshes missing-file availability, and accepts a symbol only when a real Intelligence entity resolves it.

`src/core/development/DevelopmentPromptService.ts` creates a bounded prompt from the persisted intent, work type, objective, specification, selected files/symbols, repository name, and optional user notes. Preparations have stable SHA-256 content hashes. Objective or source-scope changes supersede the current preparation; unchanged content hashes remain stable.

`src/core/development/ManualHandoffService.ts` copies the exact prepared content through VS Code's clipboard API and records `prepared`. A distinct confirmation records `handed-off` and its timestamp. Clipboard failure is preserved as a structured failed handoff. No copy or confirmation records external execution as complete.

`src/core/development/WorkspaceChangeService.ts` consumes the real VS Code Git repository working tree when available, returns changes unassociated, deduplicates and sorts them, and excludes Keystone's `.keystone` runtime state. When Git is unavailable it returns the exact manual-selection fallback instead of fabricating changes.

`src/extension/development/VsCodeDevelopmentAdapter.ts`, `src/extension/webview/WebviewMessageRouter.ts`, `src/extension/extension.ts`, and `src/ui/services/HostBridge.ts` form the validated host boundary. Current files come from real visible VS Code editors, Add File uses a real multi-select Quick Pick, and Current Selection combines real VS Code symbol extraction with a matching persisted Intelligence entity.

`src/ui/components/workbench/DevelopmentStage.tsx`, `src/ui/components/workbench/ActiveWork.tsx`, `src/ui/components/home/HomeDashboard.tsx`, and `src/ui/styles/global.css` provide the bounded UI, stage rail, deterministic Home next action, responsive editor layout, structured errors, and read-only completed state.

## Production files changed for Phase 3

- `src/shared/contracts/development.ts`
- `src/shared/contracts/canonicalWorkflow.ts`
- `src/shared/contracts/messages.ts`
- `src/core/development/DevelopmentService.ts`
- `src/core/development/SourceScopeService.ts`
- `src/core/development/DevelopmentPromptService.ts`
- `src/core/development/ManualHandoffService.ts`
- `src/core/development/WorkspaceChangeService.ts`
- `src/core/workflow/WorkflowService.ts`
- `src/core/home/HomeStateService.ts`
- `src/shared/contracts/home.ts`
- `src/extension/development/VsCodeDevelopmentAdapter.ts`
- `src/extension/webview/WebviewMessageRouter.ts`
- `src/extension/extension.ts`
- `src/ui/services/HostBridge.ts`
- `src/ui/components/workbench/DevelopmentStage.tsx`
- `src/ui/components/workbench/ActiveWork.tsx`
- `src/ui/components/home/HomeDashboard.tsx`
- `src/ui/styles/global.css`

## Automated verification

Final clean verification:

```text
npm ci
added 603 packages; audited 604 packages; 0 vulnerabilities

npm run typecheck
passed

npm test
Test Files  82 passed (82)
Tests       627 passed (627)

npm run build
passed

npm run package
verification repeated successfully
Packaged: keystone-0.1.0.vsix (23 files, 2.25 MB)
```

Packaging emitted only the existing missing-LICENSE warning; it produced `/Users/sudheer/workspace/keystone/keystone-0.1.0.vsix` successfully.

## Manual Extension Development Host scenarios

Two real fixtures were used: a Git repository for the primary workflow and a separate non-Git workspace for manual fallback. No simulated direct execution was introduced.

| Scenario | Verified behaviour |
| --- | --- |
| A — initialization | Development became current, exactly one persisted work item was created from the intent, and the same ID/state returned after webview reload and repeated Extension Development Host restarts. |
| B — objective | Blank input disabled Save; a refined objective persisted across navigation and restart. |
| C — current file | Opening `src/refund.ts` and selecting Add Current File added the correct real URI/path. Repeating it raised a structured duplicate explanation and did not add another file item. |
| D — file picker | The real multi-select Quick Pick accepted two workspace files. Generated/vendor and `.keystone` folders are excluded. One selection was removed and stayed removed after restart. |
| E — selection | A selected TypeScript range resolved to a real Intelligence-backed symbol. A selected Markdown range produced `symbol-unresolved`; the scope stayed unchanged. |
| F — prompt | Preview contained the real intent, objective, specification, repository, notes, file, and symbol scope. Editing the objective removed the current preparation. Re-preparation changed SHA-256 from `22df505ad4fb8ca946f612731dc0fbf7b5c2a06163d5435df9a50dc13cd82c15` to `c77727d5639449ce17b58c3e14a9a2a202cbee2b8fc79b38b13bb0f20fc74d3b`. |
| G — handoff | `pbpaste` matched the 820-character persisted prompt exactly. Copy left the handoff prepared; explicit confirmation recorded handed-off and a persisted timestamp. External execution remained outside Keystone. |
| H — result | A real summary, decisions, assumptions, tests, and unresolved-issues value were entered and restored after restart. Blank summary validation was visible before entry. |
| I — changed files | Two fixture files were modified. After excluding `.keystone` runtime state, Git detected exactly `README.md` and `src/refund.ts`. `src/refund.ts` was associated; `README.md` was excluded with a required reason; both decisions appeared in Completion. |
| J — completion | Completion remained gated before accepted review. Request Changes returned the result to changes-requested; saving and accepting restored readiness. Completion marked Development completed, made Impact Analysis ready, and remained correct after host restart. |
| K — manual work | A second workflow recorded explicit manual origin, a user-entered result, and an explicitly associated file. It completed with no prompt and no agent handoff record. |
| L — Git unavailable | A real non-Git workspace showed `Source-control change detection is unavailable. Select changed files manually.` Adding `src/refund.ts` manually, reviewing, and completing Development succeeded. |

The VS Code `Developer: Reload Webviews` command was also run against the completed non-Git workflow. Bootstrap restored the persisted workflow and current next stage without losing the Development result.

## Screenshots and visual review

All images below were captured from the real Extension Development Host:

- [Empty Development work item](screenshots/phase3/empty-development-dark-editor.png)
- [Objective editing](screenshots/phase3/objective-editing-dark-editor.png)
- [Source-scope list](screenshots/phase3/source-scope-list-dark-editor.png)
- [Real file picker](screenshots/phase3/file-picker-dark-editor.png)
- [Resolved symbol](screenshots/phase3/resolved-symbol-dark-editor.png)
- [Unresolved symbol message](screenshots/phase3/unresolved-symbol-message-dark-editor.png)
- [Prompt preview](screenshots/phase3/prompt-preview-dark-editor.png)
- [Prepared handoff](screenshots/phase3/prepared-handoff-dark-editor.png)
- [Result form](screenshots/phase3/result-form-dark-editor.png)
- [Changed-file review](screenshots/phase3/changed-files-review-dark-editor.png)
- [Completion review](screenshots/phase3/completion-review-dark-editor.png)
- [Completed Development](screenshots/phase3/completed-development-stage-dark-editor.png)
- [Narrow panel](screenshots/phase3/narrow-panel-dark.png)
- [Editor-tab layout](screenshots/phase3/editor-tab-layout-dark.png)
- [Light theme](screenshots/phase3/light-theme-editor.png)
- [Dark theme](screenshots/phase3/dark-theme-editor.png)
- [Git-unavailable manual selection](screenshots/phase3/git-unavailable-manual-selection-dark.png)
- [Manual non-Git completion](screenshots/phase3/manual-nongit-completed-dark.png)

Visual review covered hierarchy, current/completed stage clarity, empty-state gates, prompt readability, form density, structured error placement, long paths, button priority, editor-tab layout, narrow responsive layout, and VS Code light/dark theme tokens. Live review drove the completed-state label/control correction described above.

## Known limitations and intentionally excluded capabilities

- Phase 3 provides truthful clipboard/manual handoff only. It does not claim or monitor external agent execution.
- Automatic changed-file detection requires VS Code's Git integration for the current repository. The manual path remains available and was verified in a real non-Git workspace.
- Current Selection requires a VS Code language symbol that also resolves to a current Keystone Intelligence entity. Unresolved selections are rejected rather than guessed.
- The unused legacy `src/ui/components/delegation/DevelopmentWorkspace.tsx` file remains in the repository because existing historical tests still import it; the canonical application has no active import or route to it.

Context compression, token counting, agent selection, instruction selection, intelligence visualization, impact-analysis UI, QA, test generation/healing, security, performance, PR review, cancellation, and Task Handoff were intentionally not added in this phase.
