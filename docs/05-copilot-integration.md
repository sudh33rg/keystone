# Copilot integration boundary

## 1. Principle

Copilot integration is capability-driven. Keystone never assumes that a VS Code version, Copilot installation, agent, command, proposed API, completion signal, or result-capture mechanism exists. The rest of Keystone depends only on a stable internal adapter contract.

## 2. Adapter contract

```ts
interface CopilotAdapter {
  discoverCapabilities(signal: AbortSignal): Promise<CopilotCapabilities>;
  listAgents(signal: AbortSignal): Promise<AgentProfile[]>;
  prepare(request: DelegationRequest, signal: AbortSignal): Promise<PreparedDelegation>;
  delegate(prepared: PreparedDelegation, signal: AbortSignal): Promise<DelegationHandle>;
  getStatus(handle: DelegationHandle, signal: AbortSignal): Promise<DelegationStatus>;
  cancel?(handle: DelegationHandle, signal: AbortSignal): Promise<CancelResult>;
  importResult?(input: ImportResultRequest, signal: AbortSignal): Promise<ImportedResult>;
}
```

The adapter may implement only the operations reported by `CopilotCapabilities`. Calling unsupported operations returns a typed `COPILOT_CAPABILITY_UNAVAILABLE` result; it does not silently emulate success.

## 3. Capability model

`CopilotCapabilities` records:

- installed extension identity and version if visible;
- chat surface availability;
- agent discovery support;
- agent selection support;
- programmatic invocation support;
- prompt insertion support;
- file/context attachment support;
- cancellation support;
- completion/status signal support;
- result capture/import support;
- supported payload limits when known;
- discovery time and capability fingerprint.

Every capability is `supported`, `unsupported`, or `unknown`, with evidence/provenance. `unknown` is treated as unavailable for automatic behavior.

## 4. Agent representation

Sources:

- agents discoverable from the active Copilot environment;
- repository-defined custom agents;
- workspace-configured agents;
- Keystone agent profiles;
- user-configured aliases.

Profiles and aliases describe selection/recommendation intent; they do not prove direct invocation. Each UI agent row distinguishes:

- **Available now**: discovered and selectable/invokable through supported means.
- **Configured**: has a Keystone mapping but current invocation may use assisted delegation.
- **Unavailable**: known but not usable in the current environment.
- **Unknown**: discovery cannot determine current availability.

## 5. Selection modes

### Manual

The user chooses before every task. No recommendation is preconfirmed.

### Recommended

Keystone ranks compatible agents by task category, required tools, restrictions, and availability. The user confirms the selection.

### Rule-based automatic

User/workspace rules map task attributes to agents. Keystone shows the resolved rule and agent before delegation. If the target is unavailable, the task blocks or falls back according to an explicit configured rule; Keystone does not silently substitute.

### Fixed workflow

One chosen agent is assigned to all compatible tasks. Incompatible tasks surface a decision rather than ignoring restrictions.

## 6. Recommendation algorithm

Eligibility is evaluated before ranking:

1. Agent is not unavailable.
2. Task category is supported or the agent is explicitly general-purpose.
3. Required actions/tools do not conflict with restrictions.
4. Repository access expectations match the delegation mode.
5. Context package can satisfy the agent's context policy.

Ranking then considers exact task-category match, demonstrated availability, source preference, user/workspace rules, strengths, prior successful retries within the workspace, and context fit. Recommendations always include human-readable reasons.

## 7. Delegation request

`DelegationRequest` is immutable and includes:

- request/attempt/task/workflow IDs;
- approved specification ID and revision;
- assigned agent ID and capability fingerprint;
- task objective and description;
- task-linked acceptance criteria;
- expected files and outputs;
- reviewed context package and fingerprint;
- constraints and prohibited changes;
- validation commands/checks;
- required completion report fields;
- delegation preference (`direct-if-supported`, `assisted-only`);
- created time and schema version.

The prepared prompt requires the agent to report files changed, commands run, evidence per criterion, unresolved decisions, and deviations. It explicitly forbids unapproved scope expansion.

## 8. Direct delegation

Direct mode is permitted only when runtime discovery confirms all required operations. The sequence is:

1. Validate current spec, task readiness, agent availability, and context fingerprint.
2. Persist a task attempt as `delegating`.
3. Invoke the adapter with the immutable request.
4. Require a real handle or typed completion result.
5. Persist the handle and actual reported status.
6. Subscribe/poll only through supported APIs.
7. Record authoritative results and observed repository changes.
8. Enter validation on a supported completion signal.

Timeout is not completion. Repository changes alone are not proof that the selected agent completed the task.

## 9. Assisted delegation fallback

When direct mode is incomplete or unavailable, Keystone:

1. Builds and fingerprints the complete approved prompt/context package.
2. Shows the exact payload and selected/configured agent.
3. Opens the best supported Copilot chat/agent surface.
4. Selects the desired agent only if a supported mechanism exists.
5. Inserts the prompt if supported; otherwise copies it to the clipboard after explicit delegation.
6. Marks the task `awaiting-user` with an “externally executing” activity, not `executing` with fabricated progress.
7. Observes repository changes as possible outputs without attributing them as confirmed.
8. Requests user confirmation or supported result import.
9. Records what was and was not verifiable.
10. Proceeds to validation only after completion is confirmed/imported.

The UI must state each manual step still required.

## 10. Result and change attribution

Before delegation, Keystone records:

- Git HEAD/status and changed-file fingerprints;
- expected files;
- task base context/specification fingerprints.

After completion, it computes a delta. Files that were already dirty remain distinguished from newly changed files. A result record classifies changes as expected, unexpected, pre-existing, or uncertain. Assisted mode labels agent attribution as user-confirmed unless an API provides authoritative provenance.

## 11. Retry and agent change

Every retry creates a new `TaskAttempt`; it never mutates the previous attempt. The retry review shows prior failure, changed repository/spec/index state, refreshed context, selected agent, and any modified validation steps.

Changing agents invalidates context review when the new agent has a different context policy or restrictions. It does not change the approved specification.

## 12. Failure behavior

| Condition | Keystone behavior |
|---|---|
| Copilot extension absent | Mark Copilot agents unavailable; allow planning/context preparation; explain install/configuration requirement |
| Discovery API absent | Show configured profiles and assisted capability only |
| Agent disappears | Block new delegation, preserve task/context, offer compatible reassignment |
| Direct invocation fails before handle | Mark attempt failed/retryable; do not mark executing |
| Status becomes unknown | Preserve last authoritative state and move to `awaiting-user` after bounded retries |
| Prompt insertion unsupported | Copy only after explicit user action and give paste instructions |
| Cancellation unsupported | Stop Keystone observation, label external work potentially continuing, require user confirmation |
| Result capture unsupported | Require confirmation/import and report reduced attribution confidence |

## 13. Privacy and security

- No GitHub/Copilot token access, storage, or forwarding.
- No context transmission during discovery, recommendation, or preview.
- Clipboard use occurs only after explicit delegation and is disclosed.
- Context is revalidated against ignore/secret policy immediately before transfer.
- Adapter logs contain IDs, capability/state transitions, and sizes—not prompt/file contents by default.
- Commands are allowlisted by identifier and scoped to expected Copilot extensions when possible.
- Proposed or unstable APIs, if used, live in a separately testable adapter and fail closed.

## 14. Adapter acceptance tests

Contract fixtures must cover:

1. Full direct capability with handle, progress, completion, and cancellation.
2. Chat open plus prompt insertion, without agent selection or completion signal.
3. Chat open only, requiring clipboard/manual confirmation.
4. Copilot missing.
5. Capability change during an active workflow.
6. Direct invocation error before and after handle creation.
7. Unsupported cancellation.
8. Result import with valid, stale, and malformed data.
9. No fabricated completion/progress under every degraded path.

