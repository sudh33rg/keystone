# Keystone Phased Implementation Plan

**Assessment date:** 2026-08-02
**Source of truth:** [PRODUCT_PLAN_CONFORMANCE.md](./PRODUCT_PLAN_CONFORMANCE.md) and [GAP_ANALYSIS.md](./GAP_ANALYSIS.md)

## Current delivery status

- **Phase 0:** Complete for the current assessment. The conformance matrix, gap analysis, architecture contract, and OKF profile are reconciled with source evidence.
- **Phase 1:** Task-analysis slice complete for Intent context, prompt enhancement, QA, security, performance, modernization, and the task R&D/SDLC evidence matrix. One bounded OKF selection is passed to the task agents after context construction.
- **Phase 1 remaining:** Consolidate the remaining explicitly unscoped/direct workflow APIs. The task-evidence fallback rescan is closed: missing worker artifacts now use canonical Captain-agent/snapshot evidence; standalone modernization rehydrates only the persisted structural snapshot; QA source and test discovery are scoped to the promoted OKF selection. Background workers wait for OKF promotion, consume the persisted snapshot plus bounded canonical scopes, and persist worker health metadata alongside the already-landed envelope restoration, task evidence, and UI display.
- **Phase 2:** Initial entity and semantic-binding slices landed. Deterministic ingestion records first-class persistence, flags, fixtures, delivery, infrastructure, component, event, build, and package-manager facts for OKF promotion; the project-aware TypeScript/JavaScript compiler worker now promotes cross-file call and type evidence into OKF before downstream stages.

## Phase 0 — Contract and evidence baseline

### Deliverables

- Keep the product-plan conformance matrix current.
- Define capability states: discovered, structural, semantic, validated, stale, and failed.
- Reconcile architecture, product, runtime-evidence, and gap documents.
- Ensure UI distinguishes pipeline completion from intelligence depth.

### Exit criteria

- Every product-plan capability has an owner, status, evidence path, and next phase.
- No documentation claims “complete” when only a counter or heuristic exists.

## Phase 1 — Canonical OKF-first boundary

### Deliverables

- Create a canonical OKF query/context service for task-time consumers.
- Route intent retrieval, context compression, QA, security, performance, modernization, R&D, and SDLC evidence through that service.
- Preserve raw `RepoIntelligence` only as an ingestion/interchange model.
- Add canonical selection metadata: OKF IDs, evidence IDs, source paths, confidence, freshness, and relationship paths.

### Exit criteria

- Explorer, Query, R&D, context, QA, and SDLC return consistent entity identity and evidence.
- A task result can explain why each selected file or relationship was included.

## Phase 2 — Engineering entity and analyzer depth

### Deliverables

- Add database, table, ORM entity, query, package manager, build system, feature flag, fixture, CI/CD, infrastructure, component, and event concepts.
- Add relationships for API → service → repository → database/table and configuration → component.
- Add framework capability providers and language-service enrichment.
- Replace filename/path-only persistence detection with parsed entity extraction.

### Current implementation evidence

- `src/core/intelligence/ingestion/engineeringEntityDetector.ts` extracts source-located facts while file text is already in the ingestion loop.
- `RepoIntelligence.engineeringEntities` preserves those facts through incremental structural persistence.
- `repoIntelligenceToOkf` promotes the facts and validates containment, mapping, read/write, and configuration relationships.
- `src/core/intelligence/pipeline/pipeline.ts` merges compiler-bound calls and type relationships into the structural model and atomically re-promotes the canonical OKF snapshot.
- Query and graph projections recognize data entities, delivery entities, infrastructure, components, events, and `maps-to` relationships.

### Exit criteria

- Representative repository queries return evidence-backed answers for APIs, tables, queries, components, configurations, tests, and flows.

## Phase 3 — Explorer, query, and graph scale

### Deliverables

- Snapshot-bound cursor pagination for Explorer results (landed: bounded 120-unit pages, matching counts, and append-only UI continuation).
- Virtualized Explorer results.
- Progressive graph neighborhoods with bounded expansion and active-frame branch collapse (landed); persisted focus state and virtualized graph segments remain.
- Repository, dependency, call, architecture, API flow, data flow, test impact, and CPG modes.
- Snapshot-aware in-memory and digest-keyed persistent query/graph-neighborhood reuse keyed by OKF snapshot digest (landed); retention metrics and persistent semantic/CPG projection policy remain.

### Exit criteria

- Large repositories remain navigable without loading all active units into one UI response.
- Every query result can open the exact graph traversal and source evidence.

## Phase 4 — Context engineering and Copilot feedback

### Deliverables

- Ordered continuation packet manifests with packet IDs, segment kinds, token estimates, and continuation tokens (landed).
- Adaptive segments: summary, selected intelligence, source excerpts, and follow-up evidence.
- Context cache keyed by intent, snapshot digest, source hashes, settings, and compression tier.
- Validation failures and delegation failures persist bounded OKF-grounded correction packets with prior Copilot output, Git diff hash, changed paths, OKF-affected paths, remediation guidance, selected source paths, and a user-copyable retry prompt; verified Task Handoff carries them forward; the UI refreshes affected paths through incremental canonical reconciliation and runs impacted validation. Review-required stories expose user-approved packet-bound Copilot retry, and captured results are attached to the SDLC delegation.

### Exit criteria

- The UI shows selected intelligence, omitted context, packet count, packet order, and validation feedback.
- Copilot is never instructed to rediscover the entire repository.

## Phase 5 — SDLC evidence closure

### Deliverables

- Bind all sixteen SDLC story types to canonical OKF evidence.
- Generate repository-specific user and QA stories from selected entities and relationships.
- Feed failed-test evidence into the next user-approved Copilot delegation.
- Keep security, performance, modernization, documentation, PR review, and handoff under the active Intent.

### Exit criteria

- An active Intent can be resumed from any stage with evidence, decisions, risks, and next action intact.

## Phase 6 — Large-repository hardening

### Deliverables

- Persistent hash/extraction and digest-keyed query/graph/context caches (initial slice landed).
- Age/count retention and removal metrics for extraction/query/graph caches (initial slice landed); persistent semantic-provider projection invalidation and richer provider-version policy remain. Snapshot locking, stale-run detection, and deletion recovery are implemented for the current ingestion/worker boundary.
- Clear worker thread/process semantics and richer cross-run worker health reporting. Last-promoted-snapshot fallback recovery after a failed refresh, matching in-flight retry-attempt resume across a host restart, worker run coalescing, cancellation/staleness, late-write protection, promoted-snapshot freshness reporting, and bounded per-role retries are implemented; the current slice reports worker identity, promoted snapshot identity, canonical scope size, attempt/max-attempts, retry timing, duration, and independent timeout/failure state.
- Freshness and degraded-state indicators across VS Code and Browser View.

### Exit criteria

- Re-indexing after deletion is reliable, failures are logged and non-blocking, and the UI never presents stale “ready” intelligence as current.

## Working rule

Implement phases in dependency order. Update the conformance, gap, architecture, and relevant feature documentation in the same change whenever behavior or status changes. Do not add tests unless the product direction explicitly changes.
