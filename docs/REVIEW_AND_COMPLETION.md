# Review and Optional Completion

## Purpose

Review and Complete are the final stages of Keystone's SDLC Workbench. They project existing canonical workflow, execution, validation, Git/PR, and Handoff records; they do not create a second workflow model or a standalone Delivery area.

Review answers whether the implementation matches the approved specification and whether retained evidence is sufficient. Complete records how the workflow ended. A local completion with no Git mutation is a first-class outcome.

## Canonical Review projection

`ReviewCompletionService` derives a bounded `WorkflowReviewState` from:

- the approved specification and current task graph;
- task-attributed file and entity changes;
- current validation runs, criterion results, evidence, and findings;
- repository ID, branch, HEAD, and Intelligence generation;
- persisted reviewer notes, finding dispositions, PR draft, and review decisions.

Requirement and acceptance-criterion status is evidence-backed. Copilot result text is never enough to mark an item satisfied. Required incomplete tasks, missing/failed/stale validation, unsatisfied criteria, unresolved blocking findings, unexpected or ambiguous changes, and unresolved blocking notes become explicit readiness blockers.

Changes are grouped by their retained attribution. Diffs are loaded only when requested, limited to 100 KB by contract, cancellable, and never persisted. Security, performance, and documentation sections appear from actual validation findings. Performance evidence is labelled static or measured; Keystone does not claim certification or measured improvement without evidence.

## Notes, dispositions, and change requests

Notes are durable, user-authored records linked to a workflow, requirement, task, file, symbol, validation result, finding, or PR section. Blocking notes prevent approval until explicitly resolved.

Finding dispositions preserve user, reason, scope, and timestamp. Security risk acceptance is never automatic. Requesting changes appends a `changes-requested` decision and can reopen a task or create a focused follow-up task; prior review history is retained.

## PR review package

The PR section deterministically builds an editable draft from the approved specification, reviewed change set, commit plan, validation evidence, change kinds, risks, and task/requirement links. A draft is not a pull request. Keystone records authoritative creation only from a supported provider result or explicit confirmation of an assisted flow.

## Approval and staleness

Review approval is a durable decision bound to specification revision and a repository evidence fingerprint. A different repository ID, branch, HEAD, Intelligence generation, or specification revision makes the decision stale. Complete mutations require the current approved fingerprint and fail closed after repository changes.

Review, risk acceptance, staging, commit, push, PR creation, patch export, partial closure, and workflow completion are separate approvals. No approval is implied by navigation and no Git action runs automatically.

## Completion modes

Available modes are capability-driven:

- **Complete locally** records completion while preserving working-tree changes and performing no Git or remote operation.
- **Local commit** uses a reviewed change set and editable logical commit plan. Staging and commit are separate, single-use approvals.
- **Pushed branch** refreshes state, blocks detached/conflicted/behind branches, and never force-pushes by default.
- **Prepared or created PR** separates draft preparation from provider mutation and confirmation.
- **Patch export** includes only reviewed, non-sensitive, non-binary, non-truncated diffs; it writes under `.keystone/exports` after a dedicated approval and never applies the patch.
- **Task Handoff** uses an accepted task assignment and canonical task-centered evidence.
- **Closed partial** and **cancelled with changes** retain completed/incomplete tasks and use distinct non-complete statuses.

Unsupported modes remain visible with an explanation of the missing capability, required approval, mutation boundary, and reversibility.

## Persistence and recovery

Review state is stored atomically at `.keystone/workflow/review-state.json`. It contains notes, dispositions, decisions, completion records, and archive state. Existing delivery persistence retains change sets, commit plans, mutation approvals/results, PR drafts/results, and diagnostics. Handoff persistence remains canonical for packages.

On restart Keystone restores these records, refreshes repository capabilities/state, compares the current evidence fingerprint with the approved Review, and marks mismatches stale. It never infers uncertain commit, push, or PR success. Diffs, credentials, secret values, unlimited output, and provider hidden state are not persisted.

## History

History displays completion status, mode, timestamp, commit or PR reference when present, warnings, and the deterministic completion report. The report records intent, specification revision, completed/incomplete tasks, changes, validation, QA/security/performance/documentation dispositions, Review decision, optional delivery references, and remaining limitations.

## Webview and safety boundaries

All Review and Complete requests and lifecycle events are versioned Zod contracts. Payloads are bounded and workflow-aware. Mutations require workspace trust. Paths originate from a canonical reviewed change set; arbitrary Git command text is never accepted. PR URLs are validated and output is sanitized by the existing delivery services.
