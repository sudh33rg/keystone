# Phase 1 — One Canonical Active Work and Real Development Slice

## Current State

The repository currently has:
- Two separate workbench implementations: `ActiveWork.tsx` and `SDLCWorkbench.tsx`
- The `SDLCWorkbench` handles the full SDLC workflow (define, plan, build, validate, review, complete)
- The `ActiveWork` component exists but is not the canonical implementation
- There are separate routes for `/active-work` and `/workbench/*`

## Goal

Replace the fragmented workbench with one canonical Active Work experience that implements:
- One hierarchy: Workflow → Intent → Specification → Configured stages → Current stage → Work items
- Only the Development stage (QA, security, performance, PR review excluded)
- Manual or clipboard handoff for execution
- Real source scope selection and persistence
- Manual result capture
- Real cancellation for controlled activities

## Implementation Steps

### 1. Contract Updates

The existing `DevelopmentWorkflowSnapshotSchema` in `delegation.ts` needs to be adapted to support the new model. The schema currently has:
- `tasks` array (the old task model)
- No explicit stage model in the workflow

We need to add:
- `currentStageId` field (already exists)
- Proper mapping of tasks to stages via `stageId` on each task

The existing schema already supports task-to-stage mapping through `task.stageId`. The `snapshotToWorkflow` function in `ActiveWork.tsx` already handles this by defaulting to the first stage if no `stageId` is provided.

### 2. Route Consolidation

Currently:
- `/active-work` → `ActiveWork` (with `workflowId` prop)
- `/workbench/*` → `SDLCWorkbench` (with `route` prop)

We need to:
- Rename `SDLCWorkbench` to `WorkbenchShell` (keep for backward compatibility during migration)
- Update `App.tsx` routing to use `ActiveWork` as the canonical implementation
- Redirect `/workbench/*` routes to `/active-work/*` or handle in `ActiveWork`

### 3. Active Work Component Updates

The `ActiveWork.tsx` component needs to be transformed from a simple workflow viewer to a full workflow editor with Development stage support.

Key changes:
- Add workflow creation form (intent, work type, specification, initial scope)
- Implement stage rail with Development stage
- Implement work item lifecycle (not-ready → ready → preparing-context → awaiting-approval → handed-off → running → awaiting-result-review → completed/failed/cancelled)
- Implement source scope selection (files, symbols, current editor)
- Implement manual result capture (prepare prompt, copy prompt, record result, detect changed files)
- Implement cancellation for controlled activities (prepared delegation before handoff)

### 4. Development Stage Implementation

The Development stage needs:
- Stage inputs (intent, specification, acceptance criteria)
- Source scope display
- Context preparation UI (raw tokens, compression metrics)
- Execution configuration (agent selection, invocation mode, skill selection)
- Manual result capture form
- Stage completion review

### 5. Persistence Updates

The existing persistence uses `DevelopmentWorkflowSnapshotSchema`. We need to ensure:
- Workflows are persisted with tasks mapped to stages
- Stage configuration is saved
- Source scope is saved
- Delegation preparation state is saved
- Handoff state is saved
- User-recorded results are saved
- Changed file references are saved
- Stage completion decision is saved

### 6. Tests

Add integration tests covering:
- Workflow creation from intent
- Development stage configuration
- Source scope selection
- Context preparation
- Manual result capture
- Stage completion
- State persistence across reload

## Acceptance Criteria

1. A user creates a workflow from an intent
2. The workflow is persisted
3. Active Work renders the persisted workflow
4. Development is a real stage, not placeholder content
5. Source scope can be selected and persisted
6. The stage can prepare for delegation
7. Manual or clipboard handoff is accurately represented
8. The user can capture a result
9. Changed files can be linked to the result
10. Stage completion requires explicit review
11. State survives restart
12. Duplicate workspaces are removed from active runtime architecture
13. No QA, security, performance, or review placeholder screens are added
14. Typecheck, tests, and build pass
15. A webview integration test covers workflow creation through Development completion

## Migration Path

1. Implement `ActiveWork` as the canonical workflow editor
2. Keep `SDLCWorkbench` but redirect its routes to `ActiveWork`
3. Gradually deprecate `SDLCWorkbench` in subsequent phases
4. Remove duplicate models and services after verification

## Deliverables

- Canonical Active Work component
- Development stage implementation
- Updated contracts (if needed)
- Integration tests
- Documentation of the new workflow model
