# Product requirements

## 1. Product definition

Keystone is a VS Code extension that converts developer intent into visible, repository-aware, spec-driven work delegated to GitHub Copilot. Keystone prepares, controls, enriches, and tracks work; it does not replace Copilot or claim capabilities the installed Copilot surface does not expose.

The current product also carries results through deterministic validation, QA/security/performance review, Git/PR preparation, and Task Handoff. It does not provide a centralized intelligence service, cross-product publication, local inference/training, or hybrid model routing; those concepts are future-roadmap items only.

The MVP is one repository, one extension package, and one React single-page application rendered in a VS Code Webview. There is no HTTP backend or hosted Keystone service.

## 2. Product outcome

A developer can move from an ambiguous feature intent to an approved specification, dependency-ordered tasks, inspectable context packages, deliberate agent assignments, delegated work, and evidence-based validation without losing the workflow across VS Code reloads.

## 3. Actors

| Actor | Responsibilities |
|---|---|
| Developer | Provides intent, reviews interpretation, resolves decisions, approves scope, selects agents, initiates delegation and validation, handles overrides |
| Keystone Extension Host | Indexes locally, selects context, persists state, orchestrates tasks, validates messages, invokes supported integrations and commands |
| Keystone Webview | Presents state and captures decisions; it has no direct repository or terminal access |
| Copilot integration | Performs delegated planning, implementation, testing, or review through capabilities available in the current VS Code environment |
| Repository tools | Git, language services, build, lint, test, and type-check workflows used as evidence |

## 4. Development modes

### Quick task

For focused, low-scope work. Keystone creates a lightweight brief containing objective, relevant files, constraints, acceptance criteria, recommended agent, and validation. Formal specification approval is not required unless configured.

### Guided development

For work that needs clarification or decomposition. Keystone produces an editable problem statement, solution, assumptions, technical approach, task breakdown, acceptance criteria, test expectations, and risks. The user approves the plan before delegation when configured.

### Spec-driven development

For features, major changes, modernization, architecture, or multi-step work. The required order is:

1. Capture intent.
2. Analyze repository impact.
3. Create a structured specification.
4. Resolve or record missing decisions.
5. Obtain approval.
6. Generate implementation tasks.
7. Assign an agent to every task.
8. Preview context before each delegation.
9. Execute in dependency order.
10. Validate implementation against the specification.
11. Produce a completion report.

No implementation task is delegable before approval unless the user explicitly enables automatic approval.

## 5. Functional requirements

### 5.1 Extension foundation

| ID | Requirement | Priority |
|---|---|---|
| FR-FND-001 | Keystone shall install and activate lazily as a VS Code extension. | Required |
| FR-FND-002 | Keystone shall expose an Activity Bar container and a React SPA control center in a Webview. | Required |
| FR-FND-003 | The Webview shall communicate with the Extension Host only through schema-versioned typed request, response, and event envelopes. | Required |
| FR-FND-004 | Every request shall include a unique request ID and timestamp and receive success or structured failure. | Required |
| FR-FND-005 | Keystone shall persist workflows across Webview disposal and VS Code reload. | Required |
| FR-FND-006 | Keystone shall expose common structured errors with correlation IDs, recoverability, recommended actions, and retry capability. | Required |
| FR-FND-007 | Long-running operations shall be observable and cancellable where the underlying operation permits cancellation. | Required |

### 5.2 Repository intelligence

| ID | Requirement | Priority |
|---|---|---|
| FR-INT-001 | Keystone shall build repository intelligence primarily without LLM calls. | Required |
| FR-INT-002 | The index shall capture files, language, symbols, imports/exports, detectable relationships, tests, configuration, dependencies, commands, frameworks, entry points, and repository metadata where supported. | Required |
| FR-INT-003 | Indexing shall be incremental, cancellable, non-blocking, branch-aware, observable, and tolerant of unsupported file types. | Required |
| FR-INT-004 | Indexing shall respect `.gitignore`, VS Code exclusions, Keystone exclusions, secret patterns, binaries, generated code, and heavy-folder defaults. | Required |
| FR-INT-005 | Keystone shall avoid reprocessing unchanged files using content or metadata fingerprints. | Required |
| FR-INT-006 | File-system events shall be debounced and converted to incremental index updates. | Required |
| FR-INT-007 | The UI shall show repository summary, indexing progress, language/framework signals, symbol search, dependency/test mappings, errors, and re-index controls. | Required |
| FR-INT-008 | Unsupported or partially parsed files shall remain discoverable structurally without failing the whole index. | Required |

### 5.3 Intent and specification

| ID | Requirement | Priority |
|---|---|---|
| FR-SPC-001 | Keystone shall preserve the original intent and produce a normalized `IntentRecord`. | Required |
| FR-SPC-002 | Intent analysis shall use available repository intelligence before asking for information present in the repository. | Required |
| FR-SPC-003 | The user shall select quick, guided, or spec-driven mode. | Required |
| FR-SPC-004 | A specification shall include identity, intent, scope, existing behavior, proposed behavior, constraints, criteria, test strategy, task plan, and decision log. | Required |
| FR-SPC-005 | Each acceptance criterion shall be testable, required or optional, traceable to tasks, and associated with a validation method. | Required |
| FR-SPC-006 | Keystone shall enforce the specification lifecycle and prevent an unapproved spec from entering `in-progress`. | Required |
| FR-SPC-007 | A material change to an approved specification shall create a revision, highlight changed sections and affected tasks, and require reapproval. | Required |
| FR-SPC-008 | The user shall be able to edit, approve, reject, and compare specification revisions. | Required |
| FR-SPC-009 | Repository-visible specification files shall be opt-in; extension-managed storage is the default. | Required |

### 5.4 Agents and Copilot boundary

| ID | Requirement | Priority |
|---|---|---|
| FR-AGT-001 | All Copilot-specific behavior shall be isolated behind a `CopilotAdapter`. | Required |
| FR-AGT-002 | Keystone shall represent agents by ID, source, availability, task categories, tools/actions, strengths, restrictions, and default context policy. | Required |
| FR-AGT-003 | Keystone shall discover capabilities at runtime and shall not assume uniform agents or invocation APIs. | Required |
| FR-AGT-004 | Keystone shall support manual, recommended, rule-based automatic, and fixed-workflow selection modes. | Required |
| FR-AGT-005 | A specification may assign a different agent to each task, and the user may change an assignment before delegation or retry. | Required |
| FR-AGT-006 | When direct delegation is unavailable, Keystone shall provide the controlled assisted-delegation workflow. | Required |
| FR-AGT-007 | Keystone shall never fabricate agent availability, completion, repository changes, or captured output. | Required |

### 5.5 Context

| ID | Requirement | Priority |
|---|---|---|
| FR-CTX-001 | Keystone shall construct a separate, inspectable context package for each task. | Required |
| FR-CTX-002 | Context selection shall use mentioned files/symbols, graph relationships, tests, Git changes, dependencies, spec scope, editor state, and user pins where available. | Required |
| FR-CTX-003 | Context shall be constrained by an estimated-token budget and must not default to the whole repository. | Required |
| FR-CTX-004 | Compression shall prefer symbol extraction, signatures, interfaces, targeted ranges, test mappings, and cached structured summaries over generic prose summarization. | Required |
| FR-CTX-005 | The preview shall show included and excluded items, selection reasons, estimated size, pinned items, and user removal/addition controls. | Required |
| FR-CTX-006 | Excluded, secret-like, binary, or oversized files shall not enter a context package without an explicit supported override. | Required |
| FR-CTX-007 | Context sent to Copilot shall match the last user-reviewed package or visibly identify subsequent changes. | Required |

### 5.6 Tasks and execution

| ID | Requirement | Priority |
|---|---|---|
| FR-TSK-001 | Keystone shall derive a dependency-aware `TaskGraph` from an approved intent or specification. | Required |
| FR-TSK-002 | Each task shall record objective, status, dependencies, agent, required context, expected files/output, criteria, validation, retry history, and execution notes. | Required |
| FR-TSK-003 | Only tasks with satisfied dependencies may become ready or delegable. | Required |
| FR-TSK-004 | Concurrent tasks shall not modify overlapping expected files unless the user explicitly permits it. | Required |
| FR-TSK-005 | Keystone shall detect external repository changes and mark affected task context stale when material. | Required |
| FR-TSK-006 | The user shall be able to approve, reject, edit, retry, pause, resume, skip, cancel, reorder eligible work, change agent, and change context. | Required |
| FR-TSK-007 | Retry shall retain history and permit updated context or a different agent. | Required |
| FR-TSK-008 | Keystone shall persist active execution state and restore it after reload without falsely resuming unsupported background execution. | Required |

### 5.7 Validation

| ID | Requirement | Priority |
|---|---|---|
| FR-VAL-001 | Validation shall evaluate the implementation against specification criteria, not only compilation. | Required |
| FR-VAL-002 | Validation shall report expected/unexpected changed files, build, type-check, lint, impacted tests, new-test expectations, unresolved TODOs, and specification drift. | Required |
| FR-VAL-003 | Security and performance checks shall run when the specification or task risk requires them. | Required |
| FR-VAL-004 | Results shall be `passed`, `warning`, `failed`, `not-executed`, or `requires-user-review`, with supporting evidence. | Required |
| FR-VAL-005 | Required failed or unverified criteria shall prevent completion unless the user records an explicit override and rationale. | Required |
| FR-VAL-006 | Keystone shall produce a completion report mapping criteria to evidence, tasks, files, and commands. | Required |
| FR-VAL-007 | Terminal validation commands shall be user-initiated; dangerous or unrecognized commands require confirmation. | Required |

### 5.8 User interface

| ID | Requirement | Priority |
|---|---|---|
| FR-UI-001 | Primary sections shall be Home, Intent, Specifications, Tasks, Intelligence, Context, Validation, and Settings. | Required |
| FR-UI-002 | A persistent, non-blocking activity panel shall show operation, task, agent, progress, decisions, errors, cancellation, and logs. | Required |
| FR-UI-003 | The UI shall always expose interpreted intent, active spec, selected agent, delegated task, context, expected/actual files, validation, errors, and measurable estimates. | Required |
| FR-UI-004 | The Webview shall reconnect to authoritative Extension Host state after becoming hidden, disposed, or reloaded. | Required |
| FR-UI-005 | All interactive controls shall be keyboard accessible and use VS Code theme variables. | Required |

## 6. Non-functional requirements

| ID | Requirement | Target |
|---|---|---|
| NFR-PERF-001 | Lazy extension activation | Under 500 ms excluding optional indexing |
| NFR-PERF-002 | Control center availability | Under 2 seconds after opening |
| NFR-PERF-003 | Ordinary incremental update visibility | Under 2 seconds |
| NFR-PERF-004 | UI thread blocking | No operation longer than 100 ms |
| NFR-PERF-005 | Memory | Bounded caches; never retain all large file contents |
| NFR-SEC-001 | Local intelligence | Index and summaries remain local |
| NFR-SEC-002 | Explicit transmission | Context leaves Keystone only after user-initiated delegation |
| NFR-SEC-003 | Webview security | Strict CSP, nonce-based scripts, sanitized rendering, message validation |
| NFR-SEC-004 | Credentials | Never collect, transmit, or store GitHub/Copilot credentials or tokens |
| NFR-SEC-005 | Least privilege | Request only permissions required by VS Code extension operations |
| NFR-REL-001 | Recovery | Persist after each material state transition and recover without state fabrication |
| NFR-COMP-001 | Compatibility | Capability degradation must be visible and usable through fallback paths |
| NFR-OBS-001 | Observability | Correlated structured logs and user-facing progress for long operations |

## 7. Non-goals

The MVP does not include IntelliJ, browsers, standalone or hosted web applications, monorepos, cloud authentication, cloud-hosted Keystone services, credential sharing, an HTTP backend, organization-wide or multi-repository intelligence, incident automation, deployment, a hosted LLM, Copilot replacement, or execution outside the active VS Code environment.

These exclusions are architectural constraints. Components shall not introduce abstractions solely for these future possibilities.

## 8. MVP success scenario

The MVP succeeds when one clean install can demonstrate this uninterrupted scenario:

1. Open Keystone in an ordinary repository and complete a cancellable local index.
2. Enter a feature request and choose spec-driven mode.
3. Review repository-aware intent, create a full specification, resolve decisions, and approve it.
4. Generate tasks, inspect dependencies, discover/configure available agents, and assign an agent per task.
5. Inspect a bounded context package and initiate supported or assisted Copilot delegation.
6. Track task state and repository changes without inventing completion signals.
7. Run detected validation workflows and trace evidence to every required criterion.
8. Close and reopen VS Code and recover the workflow.
