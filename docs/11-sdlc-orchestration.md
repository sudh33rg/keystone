# Controlled SDLC Orchestration

Milestone 14 coordinates Keystone's existing local services. It does not replace canonical Intelligence, specification/task planning, context construction, Copilot delegation, execution tracking, validation, delivery, or Task Handoff.

## Runtime model

`OrchestrationService` owns a versioned `WorkflowInstance` projection and calls the existing authoritative workflow and routing services. `WorkflowStateMachine` validates every status transition. `WorkflowDefinitionRegistry` supplies quick-fix, feature, bug-fix, refactoring, modernization, and security-remediation stage/gate definitions. `WorkflowPolicyService` supplies manual, guided, and approval-gated profiles; there is no autonomous profile.

Planning is bounded to 500 tasks and yields before graph work. `TaskReadinessService` rechecks specification/task-plan approval, dependencies, staleness, branch, Intelligence generation, criteria, validation, route, agent, and approval gates. `WorkflowScheduler` orders by dependencies, priority, and risk. Read-only tasks may overlap; writes are serialized, and shared or unknown files/entities fail closed.

## Trust and approvals

Routes remain `deterministic`, `github-copilot`, `manual`, or `unsupported`. Copilot is only an implementation provider and its output is untrusted until existing validation produces evidence. Plan, context, delegation, retry, completion, delivery, and other configured gates record an explicit decision and audit entry. Git staging, commit, push, and pull-request creation remain separate delivery-service approvals and cannot be overridden by orchestration.

QA, security, performance, documentation, and validation plans use deterministic relevance triggers. Security review is changed-scope analysis, not full assurance. Performance improvement is never claimed without measurement. Required tasks cannot be skipped merely to obtain a green workflow.

## Persistence and recovery

Instances are atomically persisted under extension-managed workspace storage in `workflow/orchestration-state.json`. State is bounded to 100 instances, 500 tasks per instance, 1,000 gates/findings, and 2,000 retained audit entries under current profiles. Restart never restores an interrupted operation as running: `running`, `cancelling`, or `recovering` becomes `paused` with a recovery diagnostic. Resume/recovery rechecks repository identity, branch, HEAD, and Intelligence generation and marks drift stale.

Cancellation preserves completed evidence and user changes and never mutates Git. A failed task retains validation references; retries are bounded, audited, create no automatic delegation, and may invalidate context when the agent changes. Task completion requires validation references and no open blocking finding. Delivery readiness is a deterministic evidence decision only; actual Git actions retain independent approvals.

## UI and contracts

The React Orchestration workspace provides overview, plan/stages, an accessible task-graph list, active state, review categories, findings, approvals, delivery boundary, history, diagnostics, and policies. All host requests are Zod-validated, bounded, and use typed events. The Webview cannot assign an arbitrary workflow status or send shell commands.

Unsupported behavior includes unrestricted autonomy, concurrent writes in one working tree, worktree creation, automatic delegation, infinite retry, arbitrary test healing, silent specification revision, automatic finding acceptance, automatic Git mutation, push, PR creation, merge, deployment, incident remediation, hosted services, Hub execution, and local-model execution.
