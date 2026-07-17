# Team Workflow and Portable Handoffs

## Status

Milestone 13 adds a local, deterministic handoff boundary to Keystone. It does not add authenticated multi-user collaboration. Participant identity is always labelled `self-asserted-local`; imported participants retain `source: imported`. Capabilities guide eligibility but are not identity-provider-backed authorization.

## Architecture

`TeamWorkflowService` composes bounded services for participants, eligibility, assignment lifecycle, ownership, package construction, validation, import/export, repository reconciliation, acceptance, reassignment, progress, and audit. Existing workflow, task-context, execution, validation, delivery, and repository-intelligence stores remain authoritative. Team state is an additional projection written atomically to `workflow/team-state.json`; invalid state is quarantined and interrupted imports recover as `interrupted`.

One task has at most one active primary assignment. Creation produces `awaiting-acceptance`; only the named participant can accept, reject, or request clarification. Active reassignment requires a handoff package. A receiver acceptance creates a new assignment and a new continuation boundary. It never reuses hidden Copilot state and always records `continuationSessionRequired: true`.

## Handoff package

The versioned package contains immutable sender-side snapshots and fingerprints rather than live object references. It records:

- repository, branch, HEAD, Intelligence generation, and relevant file fingerprints;
- approved specification revision, requirements, criteria, constraints, and decisions;
- task, assignment, progress, blockers, open questions, and sender notes;
- reviewed context package fingerprints, pins, canonical entity IDs, paths, graph/CPG references;
- bounded execution-session, validation-run, delivery, changed-file, and changed-entity summaries when present;
- capability and privacy diagnostics.

The package deliberately does not embed credentials, Copilot tokens, chat transcripts, hidden agent state, arbitrary source trees, or executable patches. Uncommitted changes are labelled `local-unavailable` unless a future evidence-backed availability mechanism proves otherwise.

The canonical fingerprint is SHA-256 over stable-key JSON excluding mutable diagnostics and metrics. Import validates strict schema/version, UTF-8, byte limits, safe relative paths, secret-like patterns, expiry, and the exact fingerprint. JSON and deterministic uncompressed single-entry ZIP (`handoff.json`) are supported; ZIP encryption, compression, multiple entries, traversal, and checksum mismatch are rejected. Clipboard export is explicitly reduced fidelity. Repository artifact export is disabled by default and, when enabled, is confined to `.keystone/handoffs/`; it is never committed automatically. The legacy `.buildwise/handoffs` setting is accepted only during one-way persisted-state migration.

## Reconciliation

Reconciliation is read-only and bounded. Repository identity and branch are checked first. Equal repository fingerprints are `exact`; equal HEAD with a different local fingerprint is `compatible`. For different local commits, Git ancestry classifies receiver `ahead`, `behind`, or `diverged`; missing objects are `missing-commits`. No fetch, pull, checkout, merge, rebase, reset, patch application, or other repository mutation occurs.

Relevant-file fingerprint differences invalidate affected context references. `exact`, `compatible`, and non-conflicting `ahead` states may be accepted after review. Other classes remain reviewable but block active acceptance. The result lists differences, stale/reusable context IDs, missing files, required actions, diagnostics, and measured duration. It never claims semantic rename continuity or remote freshness.

Validation and execution summaries are historical evidence only. A receiver must rebuild stale context/validation when reconciliation says so and explicitly approve any later delegation or execution session. Delivery references do not imply that commits or pull requests exist on the receiver.

## Privacy, audit, and limits

Default package size is 1,000,000 bytes; attachment metadata is bounded to 50 entries and 5,000,000 aggregate declared bytes. Actual attachment-body exchange is not yet enabled, so production packages currently contain no attachment bodies. Package histories are bounded to 200, imports/exports/reconciliations to 500, participants to 500, assignments to 2,000, and audit records to the configured maximum (2,000 by default).

Audit entries record action, related object, before/after state where applicable, reason, evidence references, timestamp, and the honest local identity assurance. Progress derives counts, unassigned/stale/due work, blockers, handoffs, and freshness from local snapshots. It is not real-time presence.

Unsupported behavior includes enterprise authentication/authorization, cloud synchronization, real-time presence, chat, organization administration, automatic assignment, automatic Git synchronization, remote commit discovery without local Git objects, automatic context regeneration, automatic execution/delegation continuation, deployment, and production monitoring.
