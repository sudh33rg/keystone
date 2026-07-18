# Task-centered Build workspace

## Canonical composition

The Build workspace is a projection over the existing workflow task, context package, prepared delegation, delegation session, execution session, validation plan/run, retry, completion decision, assignment, and handoff records. React does not own an execution state machine.

The task queue groups canonical tasks as ready, in progress, blocked, awaiting validation, awaiting review, or completed. Selection is persisted by workflow and revalidates the specification revision and Intelligence generation. Starting a code-writing task captures a repository baseline, persists it with the workflow state, and prevents another overlapping code-writing task from becoming active by default. Starting never delegates automatically.

The queue can be filtered by category, canonical status, execution route, owner, and blocking state. Arrow-key navigation selects the preceding or following visible task. Readiness is displayed as structured pass/block checks with recovery actions. Blocking requires an explicit category, reason, and suggested action; an optional required decision is retained with the blocker.

## Copilot customization discovery

`CopilotCustomizationService` inventories only supported inert repository formats:

- `AGENTS.md` and `.github/copilot-instructions.md`;
- `.github/instructions/*.instructions.md`;
- `.github/agents/*.agent.md`;
- `.github/prompts/*.prompt.md`;
- `.github/skills/*/SKILL.md` and `.agents/skills/*/SKILL.md`.

Files are read as bounded text metadata and are never imported or executed. Path instructions are matched deterministically against expected task files. Applicability, trust, availability, and the reason are visible. Selections are persisted; changing them invalidates a previously built context package.

Discovered agents retain evidence, restrictions, availability, and capability metadata. When discovery cannot identify the intended agent, the user may save an intended label. That label is explicitly low-confidence and unverified; Keystone permits only supported assisted or clipboard handling and does not claim direct invocation.

## Context and delegation

Context construction remains deterministic and bounded through `TaskContextService`. Required task, requirement, criterion, constraint, decision, expected-file/entity, test, graph, flow, CPG, and validation items are ranked and compressed under the configured budget. Each item shows provenance, inclusion reason, confidence, estimated size, tier, pin state, and required status. Removing required context remains blocked without the existing explicit override contract.

The exact context fingerprint must be reviewed before prompt preparation. The exact bounded prompt and its fingerprint remain visible before explicit approval. Direct, assisted, and clipboard behavior continues to come only from detected Copilot capabilities; assisted and clipboard execution require user confirmation and never fabricate progress or completion.

The Build screen exposes included and excluded context, required/optional tier, confidence, provenance, token estimate, pin/unpin, optional exclusion, restoration, source opening, and a bounded configurable token budget. Selected customization files appear in the visible prompt as references with their applicability reasons; their contents remain bounded and inert.

## Changes, validation, retry, and handoff

Repository changes remain relative to the captured baseline and preserve expected, related, unexpected, pre-existing, concurrent, ambiguous, excluded, and generated-output classifications. The Build screen does not stage, discard, commit, push, or create pull requests.

Each observed file shows deterministic reasons and confidence. User changes to expected, pre-existing, or excluded attribution are auditable overrides. Diffs are loaded on demand with a 50 kB bound and an explicit truncation indicator; files can be opened without mutating Git state.

Validation plans and runs use repository-discovered, typed command descriptors; arbitrary Webview command text is not executed. Outputs and evidence remain bounded and redacted. Criterion results require validation or manual evidence rather than Copilot claims alone. Existing retry attempts remain immutable and task-level handoff continues to use existing assignments and immutable handoff packages; standalone Team Workflow, Delivery, Review, and Complete navigation is not reintroduced.

Validation can be planned for impacted tests, run, cancelled, and rerun at a failed step. Manual evidence is labelled user verification. Retry supports same-agent or explicitly selected different-agent repair, focused repair context, a fresh baseline, and a child attempt that remains awaiting explicit start. Task Handoff is available only for accepted or active assignments and supports receiver selection, package preview, validation, local export, and cancellation; it excludes credentials, tokens, hidden sessions, and completion claims.

## Persistence and recovery

Selected task, customization selections, panel choice, context, prompt approval, delegation/execution sessions, repository baseline, change attribution, validation, retry attempts, completion decisions, and handoff records live in extension-managed `.keystone` persistence. Restart recovery reconciles interrupted execution and validation using the existing execution service. It never infers that interrupted Copilot work completed.

Every Build request is schema-validated and bounded. Executable delegation, validation, retry, and repository-artifact export actions are blocked in Restricted Mode. Heavy context, Git, validation, and persistence work remains outside React and does not introduce an HTTP server, external database, or cloud persistence.
