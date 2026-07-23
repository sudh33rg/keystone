# Privacy and Local Data

Keystone is a **local-first** VS Code extension. This document explains what it reads,
what it stores, what it transfers, and what it never does.

## Local-first operation

- All processing happens on your machine inside the VS Code extension host.
- All persistent state is written under the repository's `.keystone/` directory or the
  extension's workspace storage. There is no external server, no cloud account, and no
  telemetry by default.
- Keystone does not require network access to function.

## What repository content Keystone reads

- Files you open or that are part of the indexed workspace, to build Repository
  Intelligence (symbols, relationships, dependencies, evidence).
- Git metadata (status, diffs, branch, revision) for change detection and PR
  preparation.
- Configuration and instruction files referenced by your workflow.

Keystone reads only what is needed for the active workflow and respects workspace
exclusions you configure.

## What Keystone persists

- Workflow state, stages, work items, and results.
- Development scope, Execution Configuration, Context Packages, QA/security/performance
  findings, PR Review state, and Task Handoff history.
- A local Repository Intelligence snapshot (graph, entities, relationships, evidence),
  sharded and bounded.

None of the above leaves your machine unless you explicitly export it.

## Context Packages

A Context Package is a bounded, token-efficient selection of files, entities, and
evidence assembled for a task. It is stored locally and, if you choose, included in a
Task Handoff export. It does not contain credentials.

## Task Handoff packages

A Task Handoff package (`.keystone-handoff`) transfers an in-progress workflow to
another workstation. Before export, the **Handoff Privacy Service** scans the package
for secrets and personal data. Each candidate is either redacted, removed, replaced
with a summary, or marked a false positive. The package contains:

- Workflow metadata and progress.
- A bounded set of source references (not full file contents unless explicitly
  included).
- Redacted data only.

## What is excluded

Keystone does **not**:

- transfer credentials, tokens, or Copilot session state,
- perform cloud synchronization,
- send data to a remote server,
- train models or perform LoRA / fine-tuning,
- require an account or authentication.

## Secret redaction

A shared redaction service scans logs, diagnostics, command output, context packages,
Security findings, Task Handoff packages, and PR packages for known secret patterns
(tokens, API keys, passwords, connection strings). Matches are redacted before any
value is persisted or exported. Raw secret values are never written to disk or shipped
in a handoff.

## Manual prompt handoff

When delegating to GitHub Copilot, Keystone prepares a prompt and copies it to your
clipboard or the Copilot chat. No session, credential, or context is transferred
automatically beyond the prompt text you choose to send.

## Diagnostics are redacted

Local diagnostics (Keystone version, VS Code version, OS family, workspace type,
feature availability, schema versions, intelligence/worker/workflow state, last bounded
errors, command availability) contain no source contents, instruction contents,
context-package contents, prompts, test logs, credentials, tokens, environment-secret
values, absolute user-home paths, or personal identifiers.

## No telemetry

Keystone does not phone home. There is no usage telemetry and no remote reporting
unless you explicitly run a documented local diagnostics export.
