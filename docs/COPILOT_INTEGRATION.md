# Copilot Customizations and Keystone Intelligence Tools

Keystone integrates with capability-proven VS Code and GitHub Copilot surfaces. It does not provide another agent runtime or model. Repository Intelligence, workflow state, context, and validation remain Keystone facts; Copilot remains the implementation assistant.

## Capability detection

Chat, customization discovery, Language Model Tools, the optional chat participant, direct invocation, assisted launch, and clipboard fallback are detected independently. An installed extension ID is not proof of an agent inventory or invocation API. Missing surfaces are reported as limitations and never upgraded by inference.

## Discovery, applicability, and trust

Discovery is restricted to `AGENTS.md`, `.github/copilot-instructions.md`, `.github/instructions/*.instructions.md`, `.github/agents/*.agent.md`, `.github/prompts/*.prompt.md`, and a single `SKILL.md` below an allowlisted repository skill directory. Keystone uses the workspace file API and its existing exclusions, never scans arbitrary user directories, and reads at most 64 KiB of inert metadata. It never executes customization commands or scripts.

Items retain a SHA-256 content fingerprint, modification time, repository source, path scope, trust state, applicability state, reason, and guidance disposition. Applicability uses expected task paths, declared globs, language extensions, task category, required capabilities, validation relevance, and explicit user choice. A fingerprint change, branch/task-scope change, or trust change requires review. Identical fingerprints are deduplicated; native Copilot instruction, prompt, agent, and skill files are referenced rather than copied into the prepared prompt.

Agent-definition files are declared definitions only. They are not runtime-verified agents. Runtime availability remains evidence from the existing capability-driven agent registry, and unavailable agents cannot be selected. Assisted mode never claims the intended agent was invoked.

## Read-only Intelligence tools

Keystone conditionally registers 17 stable tools for search, entity details, usages, callers, callees, implementations, tests, impacted tests, paths, flows, impact, task/specification/criteria/context, validation, and workflow state. Every request is schema-validated, active-repository scoped, workspace-trust checked, promoted-generation checked, cancellable, time-bounded, recursively result-bounded, secret-redacted, and audited. Results retain canonical identifiers, structured evidence/diagnostics, confidence/quality, generation, and truncation.

No tool executes a shell command, writes a file, mutates Git, stages, commits, pushes, creates a pull request, completes a task, or exports Handoff state. Full graph objects, complete files, credentials, prompts, and source excerpts are not written to the audit log. Audit retains only a bounded input fingerprint, scope identifiers, generation, counts, latency, outcome, truncation, and diagnostic ID under `.keystone/workflow/copilot-integration.json`.

## Optional `@keystone` participant

When the stable VS Code chat participant API exists and the setting is enabled, `@keystone` answers a controlled grammar for repository search/usages/flows/impacted tests and current workflow readiness/context. It calls the same deterministic tools and composes a bounded result summary. Unsupported requests show templates and an Ask Repository action. No LLM is used to invent or paraphrase repository facts.

## Assisted launch and recovery

Prompt preparation includes the approved task objective, scoped acceptance criteria, constraints, bounded context references, validation expectations, selected agent identity, deduplicated guidance references, and the availability—not presumed use—of Keystone tools. Opening Chat or copying the prompt records only that action. Observation begins only after explicit user submission confirmation. After reload, opened or copied but unconfirmed launches become `uncertain`; changed prompt inputs become `stale` and must be prepared again.

The store persists fingerprints, enable/disable choices, selected agents, the last capability snapshot, safe settings, bounded audit, prepared prompt fingerprint/state, and user confirmation. It does not persist credentials, authentication state, Copilot sessions, complete chat history, unlimited excerpts, or copied instruction bodies.

## Settings and limitations

The secondary `keystone.copilot` settings control tool registration, participant registration, candidate inclusion, result/excerpt caps, assisted fallback, allowlisted discovery additions, and audit retention. Registration changes require an extension reload because VS Code contribution and registration lifetimes are activation-scoped. VS Code 1.95 exposes the stable tool and participant APIs, but Copilot decides whether a registered tool is made available to a particular model request. Direct custom-agent inventory and invocation remain unavailable unless a supported runtime contract proves them.
