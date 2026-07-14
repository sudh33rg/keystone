# Validation and traceability

## 1. Validation policy

Keystone is complete only when required product behavior is demonstrated with evidence. Compilation alone is insufficient. Evidence may be an automated test, VS Code extension test, command output, performance measurement, security review, or explicitly identified manual scenario.

Statuses:

- `passed`: expected result has current evidence;
- `warning`: result is usable but deviates from a non-blocking target;
- `failed`: expected result was executed/reviewed and not met;
- `not-executed`: no current run exists;
- `requires-user-review`: automation cannot decide;
- `overridden`: a failed/unverified required item has an explicit user risk decision.

Evidence becomes stale when its source code, configuration, specification revision, base commit, or relevant task output changes.

## 2. Product acceptance criteria

| ID | Requirement | Required | Validation method | Covering tasks |
|---|---|---:|---|---|
| AC-001 | Keystone installs as one VS Code extension, activates lazily, and opens the Activity Bar React control center. | Yes | VS Code extension test and activation timing | T-101, T-105, T-107, T-701 |
| AC-002 | Webview/host communication is typed, runtime-validated, correlated, versioned, and protected by a strict CSP. | Yes | Unit, integration, CSP/security tests | T-102, T-106, T-702 |
| AC-003 | Workflow/spec/task/validation state survives Webview disposal and VS Code reload without fabricated execution state. | Yes | Persistence, recovery, extension reload tests | T-104, T-502, T-701 |
| AC-004 | A repository is indexed locally, incrementally, observably, and cancellably without an LLM dependency. | Yes | Fixture integration and large-repository tests | T-201–T-207, T-703 |
| AC-005 | Ignore, secret, binary, generated, vendor, and size policies prevent unsafe or wasteful indexing/context use. | Yes | Negative security fixtures and review | T-202, T-203, T-404, T-702 |
| AC-006 | Intent processing preserves original input and produces repository-aware mode, scope, constraints, ambiguity, risk, and agent recommendations. | Yes | Unit/integration intent fixtures | T-301 |
| AC-007 | Spec-driven mode creates every required specification section and prevents implementation before explicit approval. | Yes | Domain/integration/UI tests | T-302–T-304 |
| AC-008 | A material approved-spec change creates a revision/diff, identifies impacted tasks, marks them stale, and requires reapproval. | Yes | Lifecycle and end-to-end revision test | T-302, T-304, T-503 |
| AC-009 | Agents are capability-discovered and represented without conflating configured profiles with directly available agents. | Yes | Adapter contract and registry tests | T-401, T-402 |
| AC-010 | Manual, recommended, automatic-rule, fixed-workflow, and per-task assignment behave predictably and visibly. | Yes | Unit/UI/integration selection tests | T-402, T-504 |
| AC-011 | Every task gets an inspectable, explainable, policy-safe context package within budget; source changes invalidate review. | Yes | Ranking/budget/security/staleness tests | T-403–T-405, T-503 |
| AC-012 | Direct delegation is used only with proven support; all other cases use assisted delegation without fabricated progress or completion. | Yes | Nine adapter contract scenarios and E2E fallback | T-401, T-406, T-502, T-701 |
| AC-013 | Task dependencies, overlapping expected files, controls, retries, agent changes, and execution history are enforced and persisted. | Yes | Graph/state/concurrency/reload tests | T-501–T-504 |
| AC-014 | External changes are distinguished from task changes and materially changed task bases become stale. | Yes | Dirty-worktree, file change, and branch-switch tests | T-503 |
| AC-015 | Validation evaluates expected/unexpected files, criteria, build, types, lint, tests, TODOs, security/performance obligations, and drift. | Yes | Engine fixtures and canonical repository validation | T-601–T-604 |
| AC-016 | Required failed/unverified criteria prevent completion unless an explicit, visible override records rationale and risk. | Yes | Completion gate and override tests | T-603, T-604 |
| AC-017 | The entire canonical MVP scenario completes after closing/reopening VS Code and produces a traceable completion report. | Yes | Clean-profile E2E walkthrough | T-701, T-704 |
| AC-018 | Activation, control-center load, incremental updates, UI responsiveness, and bounded-memory targets are met or deviations approved. | Yes | Instrumented performance report | T-703 |
| AC-019 | UI controls and key workflows are keyboard accessible and render correctly under VS Code light, dark, and high-contrast themes. | Yes | Automated accessibility checks plus manual theme/keyboard review | T-107, T-207, T-304, T-405, T-504, T-604 |
| AC-020 | No GitHub/Copilot credentials are accessed/stored, and repository context is not transmitted before explicit delegation. | Yes | Code review, instrumentation, security test | T-401, T-406, T-702 |

## 3. Requirement coverage matrix

| Requirement group | Acceptance coverage | Implementation tasks | Primary test level |
|---|---|---|---|
| FR-FND-001–007 | AC-001, AC-002, AC-003 | T-101–T-107 | Unit, integration, extension, UI |
| FR-INT-001–008 | AC-004, AC-005 | T-201–T-207 | Unit, repository fixtures, scale |
| FR-SPC-001–009 | AC-006, AC-007, AC-008 | T-301–T-304, T-503 | Unit, integration, UI, E2E |
| FR-AGT-001–007 | AC-009, AC-010, AC-012, AC-020 | T-401, T-402, T-406 | Adapter contract, integration, E2E |
| FR-CTX-001–007 | AC-005, AC-011, AC-020 | T-403–T-405, T-503 | Deterministic fixtures, security, UI |
| FR-TSK-001–008 | AC-003, AC-013, AC-014 | T-501–T-504 | Unit state/graph, concurrency, reload |
| FR-VAL-001–007 | AC-015, AC-016, AC-017 | T-601–T-604, T-701, T-704 | Unit, command fixtures, extension E2E |
| FR-UI-001–005 | AC-001, AC-002, AC-019 | T-107, T-207, T-304, T-405, T-504, T-604 | UI, accessibility, extension |
| NFR-PERF-001–005 | AC-004, AC-018 | T-203, T-206, T-703 | Benchmarks and profiling |
| NFR-SEC-001–005 | AC-002, AC-005, AC-020 | T-106, T-202, T-406, T-601, T-702 | Security tests and review |
| NFR-REL-001 | AC-003, AC-017 | T-104, T-502, T-701 | Failure injection, reload E2E |
| NFR-COMP-001 | AC-009, AC-012 | T-401, T-406 | Adapter capability matrix |
| NFR-OBS-001 | AC-002, AC-004, AC-015 | T-103, T-106, T-207, T-602 | Integration and UI |

## 4. Test suites

### Unit

- intent normalization/classification/risk/ambiguity;
- specification lifecycle, material revisions, criteria invariants;
- task graph cycles/readiness/overlap/skip/retry;
- agent eligibility/ranking/rule resolution;
- ignore/secret/path policy;
- context rank, compression, estimate, budget, fingerprint/staleness;
- command classification and output redaction;
- validation-to-criteria mapping and completion gating;
- configuration precedence and runtime message schemas.

### Integration

- repository scan, symbols, relationship/test mapping, incremental events, branch changes;
- index shard persistence and migration;
- intent-to-spec-to-task generation;
- Webview message routing, duplicate requests, reconnect/bootstrap;
- Copilot adapter capability matrix and assisted fallback;
- task attempt and external change attribution;
- validation runner cancellation/timeouts/evidence.

### VS Code extension

- activation and contribution registration;
- Activity Bar/Webview load and strict resource roots;
- real workspace and language-service adapters;
- settings and commands;
- reload recovery and state reconciliation;
- Copilot absent/degraded scenarios through a fake adapter boundary.

### UI

- every primary route and empty/loading/partial/error state;
- intent modes and specification review/revision approval;
- agent assignments, task controls, context preview, validation groups;
- activity panel visibility and cancellation;
- keyboard/focus/labels/contrast/theme behavior;
- responsive narrow Activity Bar width and wider editor-panel width.

## 5. Security validation

Required adversarial cases:

- malformed, oversized, replayed, unknown, or unauthorized Webview messages;
- CSP bypass attempts and unsafe repository Markdown/HTML;
- path traversal, symlinks escaping workspace, case/normalization edge cases;
- `.env`, keys, tokens, credential stores, binary and generated content;
- command injection, shell metacharacters, elevation, destructive and publish commands;
- prompt/context change between review and delegation;
- accidental prompt/file/log/clipboard leakage;
- fake Copilot availability, result, progress, or completion signals;
- corrupt/malicious persisted state and migration input.

Release threshold: no unresolved critical/high security finding. Medium findings require a recorded owner, rationale, mitigation, and target.

## 6. Performance validation

Measure on documented reference hardware/repositories:

| Measure | Required target |
|---|---|
| Lazy activation | < 500 ms, excluding indexing |
| UI interactive | < 2 s after opening view |
| Ordinary incremental update visible | < 2 s |
| UI main-thread task | No task > 100 ms |
| Cancellation | User-visible acknowledgement < 250 ms; operation stops at next supported cancellation point |
| Memory | Bounded and stable after repeated index/context cycles; exact ceiling set after baseline measurement |
| Reconnection | Active workflow restored with no lost persisted transition |

The performance report records repository size/languages, hardware, VS Code/extension versions, cold/warm state, samples, p50/p95, and memory peak/steady state.

## 7. Release gates

### Gate R1 — build integrity

- clean dependency install;
- type-check, lint, unit/integration/UI/extension tests pass;
- production extension and Webview builds pass;
- reproducible VSIX generated;
- no untracked generated source required to build.

### Gate R2 — functional completeness

- AC-001 through AC-017 and AC-019 are passed;
- all required FR groups have evidence;
- no required workflow ends in a mocked production behavior.

### Gate R3 — security/privacy

- AC-020 passed;
- security suite/review passed;
- no high/critical findings;
- secret/ignore and transmission audit passed.

### Gate R4 — performance/reliability

- AC-018 passed or deviations explicitly approved;
- cancellation, failure injection, corrupt-state recovery, branch change, and reload pass;
- large repository run shows bounded behavior.

### Gate R5 — completion report

The report includes specification/revision, task attempts and agents, reviewed context fingerprints, expected/actual files, command evidence, criterion matrix, warnings, overrides, known limitations, and final decision.

## 8. MVP canonical walkthrough

1. Install VSIX into a clean VS Code profile.
2. Open a representative Git repository with source, tests, and scripts.
3. Open Keystone and confirm UI readiness before optional indexing completes.
4. Start indexing, inspect progress, cancel once, then resume to `ready`.
5. Enter a feature intent and select spec-driven development.
6. Verify repository-aware interpretation and create a specification.
7. Resolve decisions, edit a material section, inspect revision diff, and approve.
8. Generate a cycle-free task graph and assign compatible agents.
9. Preview context, exclude/pin an item, and approve the final fingerprint.
10. Exercise the available direct or assisted delegation path without fabricated status.
11. Make/observe representative changes including one unexpected file.
12. Close/reopen VS Code and recover workflow/task/attempt state.
13. Run build/lint/type/tests and review criteria/drift/changed files.
14. Demonstrate failed/unverified completion blocking, then provide valid evidence (not an override for the release run).
15. Complete and export/view the traceable completion report.

