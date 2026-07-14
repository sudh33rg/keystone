# Decision log

## 1. Approved baseline decisions

These decisions originate in the product brief and are treated as locked for revision 1 unless the reviewer explicitly changes them.

| ID | Decision | Rationale | Impact |
|---|---|---|---|
| ADR-001 | Build one VS Code extension repository and one extension package; do not use a monorepo. | Minimizes initial deployment and architectural complexity. | Internal folders are boundaries, not packages/services. |
| ADR-002 | Implement all interactive UI as a React SPA in a VS Code Webview. | Provides one coherent control center. | Vite build, typed bridge, strict CSP. |
| ADR-003 | Keep trusted operations in the Extension Host; the Webview has no direct workspace access. | Security, testability, and VS Code runtime correctness. | All operations cross validated messages. |
| ADR-004 | Keep repository intelligence and Keystone workflow state local by default. | Privacy and offline-first repository understanding. | No Keystone cloud or HTTP backend. |
| ADR-005 | Store internal state in extension-managed storage; repository-visible specification files are opt-in. | Keystone must not modify a repository for internal bookkeeping. | Persistence adapters and optional export/write path. |
| ADR-006 | Generate basic repository intelligence without an LLM. | Cost, predictability, speed, and privacy. | Language services/parsers/graph extraction are primary. |
| ADR-007 | Put all Copilot-specific behavior behind a capability-driven adapter. | Copilot APIs and agents vary by environment. | Direct and assisted implementations share one contract. |
| ADR-008 | Never fabricate Copilot agents, progress, completion, results, or change attribution. | Product trust and correctness. | Degraded workflows explicitly await user confirmation. |
| ADR-009 | Require approved specifications before spec-driven implementation. | Central product identity and scope control. | Lifecycle guard blocks task delegation. |
| ADR-010 | Prefer structured context compression over generic summarization. | Preserves correctness-critical interfaces and improves determinism. | Symbol/range/interface/test representations first. |
| ADR-011 | Validate against acceptance criteria as well as build quality. | Compilation does not prove intent alignment. | Criteria evidence and drift gates completion. |
| ADR-012 | Do not execute outside the active VS Code environment. | Explicit MVP non-goal and security boundary. | Reload recovery never implies background continuation. |

## 2. Proposed implementation decisions

These are recommended defaults encoded by the technical documents. Approval of revision 1 accepts them.

| ID | Decision | Alternatives considered | Rationale |
|---|---|---|---|
| ADR-013 | Use TypeScript for Extension Host, shared contracts, and React UI. | Mixed JS/TS | Shared types and VS Code ecosystem alignment. |
| ADR-014 | Use Vite for Webview assets and a separate extension-host bundling step inside the same project. | Webpack-only, unbundled TS | Fast UI workflow and clear runtime outputs without package separation. |
| ADR-015 | Use runtime schemas at every Webview boundary in addition to TypeScript types. | Compile-time types only | Webview messages are runtime/untrusted input. |
| ADR-016 | Persist versioned aggregate snapshots plus a bounded transition journal. | Snapshots only, event sourcing | Reliable recovery/audit without full event-sourcing complexity. |
| ADR-017 | Use VS Code language services first and parser adapters only for material gaps. | Bundle parsers for every language | Smaller MVP and better consistency with active workspace tooling. |
| ADR-018 | Use an explainable deterministic relevance score and content fingerprints for MVP context selection. | Vector database/embeddings | Local, predictable, testable, and avoids unnecessary LLM infrastructure. |
| ADR-019 | Allow Copilot-assisted intent/spec enrichment when a supported user-initiated capability exists, with a deterministic template fallback. | Require Copilot; custom hosted LLM; templates only | Maintains usefulness without making basic workflows capability-dependent. |
| ADR-020 | Treat `unknown` integration capabilities as unavailable for automation. | Optimistic invocation | Fails closed and prevents fabricated or brittle behavior. |
| ADR-021 | Treat post-reload direct executions as `awaiting-user`/`blocked` unless a live handle can be revalidated. | Restore `executing` blindly | Prevents false progress and state. |
| ADR-022 | Use user-initiated, allowlisted validation commands with confirmation for dangerous/unrecognized commands. | Execute all package scripts; never execute | Balances automation with repository safety. |
| ADR-023 | Make deterministic repository/context behavior testable through fixture repositories and fake adapters. | Depend only on full VS Code E2E | Fast domain coverage plus realistic integration confidence. |
| ADR-024 | Use VS Code theme variables and accessible native-like components rather than a general UI design system. | Large external component library | Smaller bundle and consistent editor experience. |

## 3. Assumptions

| ID | Assumption | Risk if false | Validation/response |
|---|---|---|---|
| ASM-001 | The minimum supported VS Code version exposes Webview views, workspace storage, file watchers, document symbols, and standard extension-test support. | Adapter or UX redesign. | Lock exact engine version in OD-001 before implementation. |
| ASM-002 | Direct Copilot invocation/agent discovery may be unavailable in common environments. | MVP could otherwise fail its delegation scenario. | Assisted delegation is a required first-class path. |
| ASM-003 | Token counts for the actual Copilot target are not always knowable. | Estimates may differ from actual consumption. | Label estimates and apply a configurable safety margin. |
| ASM-004 | Workspace storage can hold workflow records but large indexes require extension-managed sharded files. | Performance/storage limits. | Benchmark during T-104/T-203 and adjust sharding. |
| ASM-005 | VS Code language services provide useful symbols for the primary TypeScript/JavaScript baseline. | Lower repository intelligence quality. | Parser fallback remains adapter-based; confirm language scope in OD-002. |
| ASM-006 | Extension Host work can be batched/yielded sufficiently for initial repository sizes. | UI or editor responsiveness degradation. | T-703 measures and may justify worker threads for CPU-heavy parsers. |

## 4. Implementation-baseline decisions

The project owner authorized progressive implementation on 2026-07-14. The recommended choices below are therefore the revision 1 implementation baseline. They may be revised through the material-change process.

| ID | Decision | Revision 1 selection | Status | Affects |
|---|---|---|---|---|
| OD-001 | Minimum VS Code engine version | `^1.95.0`; verify integration compatibility at T-101/T-401 | Accepted | T-101, T-105, T-401, compatibility tests |
| OD-002 | MVP language intelligence baseline | First-class TypeScript/JavaScript/TSX/JSX; metadata and VS Code-symbol fallback for other languages | Accepted | T-204, T-205, test fixtures, package size |
| OD-003 | Specification enrichment behavior when Copilot is unavailable | Deterministic repository-aware template remains fully usable; display enrichment as unavailable | Accepted | T-303, UX copy |
| OD-004 | Default agent-selection mode | `recommended` with explicit confirmation | Accepted | T-402, settings/UI |
| OD-005 | Automatic approval | Disabled and hidden behind an explicit advanced setting for MVP | Accepted | T-304, T-502 |
| OD-006 | Context estimate safety margin | Reserve 15% of configured maximum for prompt framing and estimation variance | Accepted | T-404 |
| OD-007 | Default indexing cap | 25,000 files and 1 MiB per file; show partial status and configuration path beyond cap | Accepted | T-203, large-repo UX |
| OD-008 | Validation command execution implementation | Spawn commands without shell when representable; require confirmation for shell/unrecognized commands; stream redacted output | Accepted | T-601, cross-platform behavior |
| OD-009 | Supported release OS matrix | Windows, macOS, and Linux on the chosen VS Code engine | Accepted | T-701, T-703, T-704 |
| OD-010 | Extension publisher/name/branding | Temporary `keystone-dev` identity until a marketplace owner confirms publication branding | Accepted for development | package manifest, VSIX publication |

## 5. Rejected approaches

| ID | Approach | Reason rejected |
|---|---|---|
| REJ-001 | Separate local/remote HTTP backend | Explicit non-goal; creates lifecycle, security, and deployment complexity. |
| REJ-002 | Send the whole repository to Copilot | Violates context minimization, privacy, and token goals. |
| REJ-003 | Require an LLM for file/symbol indexing | Unnecessary cost, latency, nondeterminism, and privacy exposure. |
| REJ-004 | Call Copilot commands/APIs throughout feature code | Couples the product to unstable integration details and prevents controlled degradation. |
| REJ-005 | Treat clipboard/prompt insertion as completed delegation | Confuses preparation with execution and fabricates status. |
| REJ-006 | Persist internal state in the repository by default | Modifies user repositories and creates noise/merge/privacy concerns. |
| REJ-007 | Fully autonomous task execution and deployment | Conflicts with visible user control and MVP non-goals. |
| REJ-008 | Build future cloud/multi-repository abstractions now | Adds complexity that does not serve the initial product boundary. |
| REJ-009 | Use embeddings/vector infrastructure as the initial context engine | Adds model/storage complexity before deterministic graph relevance is validated. |
| REJ-010 | Restore `executing` after reload without a verifiable handle | Creates misleading progress and unsafe continuity. |

## 6. Revision history

| Revision | Date | Status | Summary | Impacted tasks |
|---|---|---|---|---|
| 1 | 2026-07-14 | `approved` | Initial implementation-ready documentation approved for progressive implementation with recommended defaults. | All |

## 7. Review resolution template

For each open decision, record:

```text
Decision ID:
Selected option:
Rationale:
Approved by:
Date:
Specification sections changed:
Tasks/criteria affected:
```

Any change to the accepted baseline follows the revision procedure and re-evaluates affected tasks and criteria.
