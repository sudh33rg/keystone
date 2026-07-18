# SDLC Workbench shell and workflow start

## Product boundary

The Workbench presents one durable `DevelopmentWorkflowSnapshot` through six stages: Define, Plan, Build, Validate, Review, and Complete. Intent, specification revisions, task-plan revisions, tasks, clarifications, and decisions belong to that workflow. Orchestration and execution records coordinate it internally; they are not additional user-facing workflows.

Task 2 intentionally stops after an approved plan enters Build. It does not add automatic Copilot execution, complete validation/review/PR preparation, or the final Handoff interface.

## Start and persistence

`/workbench/new` obtains repository, branch, trust, current editor, Intelligence generation, and Copilot capability from the Extension Host. Starting is disabled until a trusted repository and a complete Intelligence generation exist. The request includes the repository ID and generation the user reviewed; the host rejects it if either changed before persistence.

Creation atomically persists:

- one workflow and intent revision;
- explicit repository scope and optional constraints;
- branch, HEAD, Intelligence generation, and repository-state baseline;
- bounded deterministic clarifications and evidence references.

Creation does not generate a specification, task plan, assignment, or execution session. The active route is persisted only after creation succeeds.

## Define

Define exposes intent revision history, evidence-backed repository scope, exact versus candidate resolution, clarifications, durable decisions, and structured specification sections. Unknown current/error behavior remains labelled unknown. Clarifications can be answered, deferred, marked not applicable, or reopened.

Specification generation is explicit. Approval is blocked by open blocking clarifications, open specification questions, unresolved blocking decisions, missing acceptance criteria, stale repository state, or stale Intelligence. Editing an approved specification creates a new revision, preserves history, and invalidates dependent plan state.

## Plan

Task generation is explicit and only accepts the approved specification revision. The draft includes traceability to requirements and acceptance criteria, dependency order, execution route, validation steps, and security/performance tasks when deterministic triggers apply.

Users can add, edit, remove, reorder, and mark tasks optional, edit validation steps, and add or remove dependencies. Reordering cannot place a task before its dependency. Every edit creates a plan revision, preserves plan history, and removes approval.

Plan approval is blocked by cycles, missing dependencies, uncovered blocking criteria, missing validation, unsupported execution routes, or required security/performance coverage. Approval records its revision and makes the first dependency-ready task ready. It does not assign an agent or start execution.

## Stage projection and recovery

Stage status is derived from canonical workflow and current repository state; it is not independently persisted. Each stage is `complete`, `current`, `ready`, `blocked`, `optional`, or `unavailable`, with a reason and recovery action. Host navigation revalidates the target before saving the route.

On Webview or VS Code restart, persisted workflows and the last route are restored. If the stored route is no longer valid, the Webview asks the host for the current projection, returns to the latest valid stage, explains the recovery, and leaves workflow data unchanged. Repository, branch, HEAD, or Intelligence changes surface as stale diagnostics instead of silently approving derived state.

## Contracts and limits

All `workbench/*` requests and lifecycle events use versioned Zod contracts. Text, arrays, evidence, tasks, diagnostics, and histories are bounded. The Webview receives projections and summaries rather than unbounded repository graphs. Errors contain a stable UI diagnostic code and state that persisted work was preserved.

## Accessibility and responsiveness

The persistent shell retains the workflow header, stage navigation, stage content, and context summary. Stage state is communicated with text as well as styling. Keyboard arrows, Home, and End move between stage choices; blocked stages remain inspectable and explain why they cannot open. Narrow layouts collapse the context panel below the stage content and preserve horizontal stage navigation.
