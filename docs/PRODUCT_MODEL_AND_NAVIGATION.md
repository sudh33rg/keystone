# Product Model and Navigation

## Canonical product model

Keystone presents one product hierarchy:

`Repository → Intelligence → Workflow → Tasks`

- **Intent** is the initial problem or outcome requested by the user. Capturing it creates the workflow; it is not an independently created application object.
- **Specification** is the reviewable behavioral contract derived from that intent. Its revisions and approval remain attached to the workflow.
- **Task** is an executable unit generated from the approved specification. Keystone has no separate user-facing “SDLC task” type. Category and required capabilities distinguish implementation, test, investigation, review, security, performance, documentation, and manual work.
- **Workflow** is the durable SDLC container. `DevelopmentWorkflowSnapshot` owns the intent, specification history, task graph, and tasks. Execution, validation, review, delivery, and handoff state refer back to the workflow or its tasks.
- **Orchestration** coordinates transitions, approvals, findings, execution, and validation. The persisted `WorkflowInstance` name remains for compatibility, but it is a coordination projection keyed to the canonical workflow intent/specification/task plan. It is not independently created or listed as a second workflow in the consolidated UI.

New optional `workType` and `repositoryScope` intent fields preserve old workflow records: absence means the workflow predates the consolidated start flow. Existing services and schemas for delivery, validation, orchestration, assignments, and handoff remain intact.

## Navigation

Primary navigation is limited to:

| Destination | Route | Purpose |
| --- | --- | --- |
| Home | `/` | Repository and current-work projection; start/resume/query/import actions |
| SDLC Workbench | `/workbench/new` | Start work or continue one workflow through its lifecycle |
| Intelligence | `/intelligence` | Browse and query canonical repository intelligence |
| History | `/history` | Review and resume persisted workflows |

The Workbench stages are:

| Stage | Route | Existing capability projected there |
| --- | --- | --- |
| Define | `/workbench/:workflowId/define` | Intent clarification and specification review/approval |
| Plan | `/workbench/:workflowId/plan` | Task graph, readiness, and agent selection |
| Build | `/workbench/:workflowId/build` | Context construction and controlled delegation |
| Validate | `/workbench/:workflowId/validate` | Execution observation, validation, and QA |
| Review | `/workbench/:workflowId/review` | Coordination findings; change/PR review placeholders remain capability-driven |
| Complete | `/workbench/:workflowId/complete` | Optional delivery actions and eligible task handoff |

Diagnostics and Settings are secondary header destinations at `/support/diagnostics` and `/settings`. Handoff import is available from Home. Handoff preparation is an action on an eligible accepted/active task. Delivery is optional and appears only in Complete.

## Start-new-work contract

“Start new work” chooses a work type, records the intent, selects repository scope, and sends one `workflow/capture` request. That operation atomically creates a durable workflow draft with its intent and draft specification, then the UI navigates directly to Define. The user never creates an intent and a separate active workflow.

## Migration and compatibility

Persisted navigation now stores a typed `activeRoute` alongside the compatibility `activeSection`. On load, records without `activeRoute` are migrated in place and their revision is incremented. Workflow data is not deleted or rewritten.

Legacy section mappings are deterministic:

| Legacy destination | Consolidated destination |
| --- | --- |
| Intent / Specifications | Workbench Define, or `/workbench/new` when no workflow is known |
| Tasks | Workbench Plan, or `/workbench/new` |
| Active Workflow / Context / Orchestration | Workbench Build, or `/workbench/new` |
| Validation & QA | Workbench Validate, or `/workbench/new` |
| Delivery | Workbench Complete, or `/workbench/new` |
| Task Handoff | Home import or the relevant task’s Hand off action |
| Diagnostics | `/support/diagnostics` |
| Settings | `/settings` |

The route constants also preserve redirects for `/intent`, `/specifications`, `/tasks`, `/active-workflow`, `/validation`, `/delivery`, `/handoff`, and `/diagnostics`. When a workflow ID is unavailable, Workbench routes safely land on the new-work chooser instead of inventing or selecting a workflow.
