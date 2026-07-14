# Keystone specification set

| Field | Value |
|---|---|
| Specification ID | `KEYSTONE-SPEC-001` |
| Title | Keystone MVP |
| Status | `in-progress` |
| Revision | 1 |
| Created | 2026-07-14 |
| Updated | 2026-07-14 |
| Repository | `keystone/` |
| Branch | Not yet initialized |
| Base commit | Not applicable |

This document set is the approved implementation authority for the Keystone MVP. The user authorized progressive implementation on 2026-07-14 using the recommended defaults in the decision log, and Foundation Phase 1 has passed its implementation gate. A material change after approval creates a new revision, identifies affected requirements and tasks, and returns the specification to `awaiting-review`.

## Document map

| Document | Purpose |
|---|---|
| [01-product-requirements.md](01-product-requirements.md) | Product boundary, actors, workflows, functional and non-functional requirements |
| [02-architecture.md](02-architecture.md) | Runtime boundaries, components, dependency rules, data flows, security, and performance design |
| [03-data-model.md](03-data-model.md) | Canonical entities, invariants, lifecycle states, persistence, and versioning |
| [04-intelligence-and-context.md](04-intelligence-and-context.md) | Local indexing, repository graph, relevance selection, compression, and context budgets |
| [05-copilot-integration.md](05-copilot-integration.md) | Agent discovery, capability model, delegation contract, and assisted fallback |
| [06-implementation-plan.md](06-implementation-plan.md) | Ordered task graph, dependencies, expected outputs, agents, and phase gates |
| [07-validation-and-traceability.md](07-validation-and-traceability.md) | Acceptance criteria, verification methods, task coverage, and release gates |
| [08-decision-log.md](08-decision-log.md) | Approved design decisions, assumptions, open decisions, and rejected approaches |

## Authority and precedence

When documents conflict, use this precedence:

1. An explicitly approved entry in the decision log.
2. Acceptance criteria and release gates.
3. Product requirements.
4. Architecture and subsystem designs.
5. Implementation plan.

The source product brief remains the product-intent baseline. This specification makes that intent testable and implementation-ready; it does not expand the product boundary.

## Approval checklist

Approval means the reviewer confirms all of the following:

- Product scope and non-goals match the intended MVP.
- Direct Copilot integration is capability-dependent and assisted delegation is an acceptable fallback.
- Repository intelligence and Keystone state remain local unless the user explicitly delegates context.
- Internal state uses VS Code extension-managed storage by default and does not modify the repository.
- The React Webview cannot directly read files, run commands, or invoke Copilot.
- Required acceptance criteria and release gates are sufficient.
- The open decisions in [08-decision-log.md](08-decision-log.md) are resolved or explicitly deferred.

Approval record:

| Role | Name | Decision | Date | Notes |
|---|---|---|---|---|
| Product owner | Project owner | Approved | 2026-07-14 | Authorized progressive implementation. |
| Technical baseline | Codex | Accepted | 2026-07-14 | Recommended defaults recorded as implementation decisions. |

## Specification lifecycle

```text
draft → awaiting-review → approved → in-progress → validation → completed
  ↑            │             │            │            │
  └────────────┘             ├→ blocked ──┘            └→ in-progress
                             ├→ superseded
                             └→ cancelled
```

Only `approved` may transition to `in-progress`. A required criterion that is failed or unverified prevents `completed` unless the user records an explicit override.

## Glossary

- **Agent**: a Copilot agent, repository-defined agent, Keystone profile, or user alias represented through capabilities.
- **Assisted delegation**: Keystone prepares and exposes a complete prompt/context package, opens the best supported Copilot surface, and relies on user confirmation or result import when direct invocation is unavailable.
- **Context package**: the inspectable, size-bounded task objective, requirements, repository excerpts, summaries, constraints, and validation commands sent during delegation.
- **Intent**: the user's raw request plus Keystone's normalized, repository-aware interpretation.
- **Repository intelligence**: local structural knowledge produced primarily without LLM calls.
- **Specification**: the approved, revisioned contract connecting intent, scope, behavior, tasks, and validation.
- **Task graph**: dependency-aware executable work derived from an approved intent or specification.
