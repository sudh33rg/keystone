# Keystone Product Specification

This document is the product-level source of truth used to judge the implementation. Keystone is a local-first VS Code engineering-intelligence and SDLC orchestration layer. It does not replace GitHub Copilot: Keystone deterministically understands the repository, turns that understanding into canonical knowledge, makes it visible and queryable, builds a minimal evidence-backed context packet, delegates explicitly approved generative work to Copilot, validates the work, and preserves task continuity.

## Product invariant

```text
Repository
  → deterministic intelligence
  → OKF + graph + CPG + flows
  → visible Explorer / Graph / CPG / Flows / Query
  → Intent
  → repository R&D
  → implementation specification
  → repository-backed user + quality stories
  → context engineering / compression
  → user-approved Copilot delegation
  → 16-stage evidence-gated SDLC
  → read-only code / PR review
  → completion or encrypted Task Handoff
```

Browser View is another surface over the same application state, not another Keystone instance. Git and remote merge-request access are strictly read-only. Repository ingestion is not capped to fit prompts; only delegated context is token-budgeted.

## Completion rule

A feature is **not complete** because a file, database record, graph projection, counter, or backend method exists. A Keystone product capability is complete only when all applicable links exist:

1. **Domain contract** — stable types/invariants define what the feature means.
2. **Production runtime** — the real extension path executes the feature.
3. **Persistence/evidence** — outputs have provenance and survive the operation where required.
4. **User surface** — the developer can see/control/use the capability in Keystone.
5. **Acceptance** — automated tests exercise the vertical slice and fail when one link is removed.

The machine-readable form of this contract is `docs/product-capabilities.json`; `npm run verify:product` enforces its required source/UI/test links.

## Intelligence UX

The Intelligence area contains **Overview, Explorer, Graph, CPG, Flows, and Query**. Graph and CPG are interactive bounded visual projections over uncapped persisted intelligence. A user can inspect a node, open its source, focus its neighborhood, filter relationship types, and move from a query result to its graph traversal. Query answers expose the deterministic plan, seed knowledge, traversed relationships, evidence, confidence, and source locations.

## Work UX

An Intent is the parent work object. Research precedes approval. Keystone presents a repository R&D document and a separate implementation specification before implementation. It then creates repository-specific user and quality stories. The active Work view contains context selection/compression, Copilot customizations and delegation, QA/security/performance/modernization evidence, SDLC findings and resolution actions, validation, read-only PR review, and Task Handoff.

## External boundary

A live Copilot model response requires an authorized VS Code/Copilot session. Keystone may test its Language Model API contract headlessly, but it must never manufacture a Copilot response to make an acceptance gate pass.

## Active Roadmap

This document follows the current [Gap Analysis](./GAP_ANALYSIS.md) and [Phased Implementation Plan](./IMPLEMENTATION_PLANS.md). Persistent context, extraction, TypeScript/JavaScript semantic, query, and bounded graph caches are implemented; Explorer virtualization and progressive Graph/CPG segments are implemented. Remaining acceptance depends on live installed language-service behavior, runtime/benchmark evidence, and a user-authorized Copilot session.
