# Keystone Execution Evidence

The source acceptance pipeline is:

```bash
npm ci --offline --ignore-scripts
npm run verify:source
npm run verify:cross-feature
npm run verify:production
```

Runtime acceptance is split deliberately: `verify:cross-feature` exercises the built cross-feature runtime, and `verify:production` performs a clean persisted self-index → authoritative query → intent-analysis acceptance run. Run them as independent commands on memory-constrained environments. Their generated build/runtime artifacts are intentionally excluded from the source-only delivery.

## Runtime acceptance scenarios

The runtime gate verifies that:

- the built production Cockpit service performs persisted indexing and promotes a valid authoritative OKF snapshot;
- authoritative OKF queries return traceable evidence and relationship traversal rather than a UI-only demo response;
- intent analysis retrieves OKF/graph/CPG evidence and attaches repository QA/security/performance/modernization findings;
- all 43 registered language/artifact categories plus an unknown future-language extension run through the intelligence pipeline;
- portable OKF output validates and preserves provenance/lifecycle information;
- unchanged intelligence is reused and deletions are represented correctly;
- the built production scanner discovers all 5,205 files in the uncapped scale fixture;
- repository evidence produces dynamic user and quality stories plus a deterministic draft QA test plan;
- all 16 SDLC stages enforce dependencies, approvals, explicit criteria, validation, evidence and review gates;
- ValueEdge import and approved-story publication use the integration boundary;
- Task Handoff encryption/decryption preserves SDLC state across an independent target workspace;
- Browser View authentication, replay prevention, same-origin commands, stale-state rejection, reconnect, and shared-state query synchronization are enforced;
- Git remains strictly read-only.

No screenshot, handcrafted application state, previous `dist`, previous `.keystone` data, or VSIX package is required to establish source completeness.

## Gap Analysis References

The following gaps identified in [GAP_ANALYSIS.md](./GAP_ANALYSIS.md) affect Execution Evidence and Runtime Acceptance:

| Gap       | Title                                                                                                              | Impact on Execution Evidence                                                                                                | Implementation Plan                                                                    |
| --------- | ------------------------------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------- |
| **Gap 1** | [Continuation Packets for Long-Running Tasks](./GAP_ANALYSIS.md#gap-1-continuation-packets-for-long-running-tasks) | Required for "built production scanner discovers all 5,205 files in the uncapped scale fixture" to complete without timeout | [Plan 1](./IMPLEMENTATION_PLANS.md#plan-1-continuation-packets-for-long-running-tasks) |
| **Gap 2** | [Context Compression Caching](./GAP_ANALYSIS.md#gap-2-context-compression-caching)                                 | Improves "intent analysis retrieves OKF/graph/CPG evidence" performance for repeated runs                                   | [Plan 2](./IMPLEMENTATION_PLANS.md#plan-2-context-compression-caching)                 |
| **Gap 3** | [Query Result Caching](./GAP_ANALYSIS.md#gap-3-query-result-caching)                                               | Accelerates "authoritative OKF queries return traceable evidence" for repeated queries                                      | [Plan 3](./IMPLEMENTATION_PLANS.md#plan-3-query-result-caching)                        |
| **Gap 4** | [Adaptive-Segments Delivery Mode](./GAP_ANALYSIS.md#gap-4-adaptive-segments-delivery-mode)                         | Enables progressive evidence delivery for large-scale acceptance runs                                                       | [Plan 4](./IMPLEMENTATION_PLANS.md#plan-4-adaptive-segments-delivery-mode)             |
| **Gap 5** | [File Hash Caching Persistence](./GAP_ANALYSIS.md#gap-5-file-hash-caching-persistence)                             | Supports "unchanged intelligence is reused" with persistent file identity                                                   | [Plan 5](./IMPLEMENTATION_PLANS.md#plan-5-file-hash-caching-persistence)               |
| **Gap 6** | [Extraction Result Caching Persistence](./GAP_ANALYSIS.md#gap-6-extraction-result-caching-persistence)             | Accelerates "all 43 registered language/artifact categories" pipeline by avoiding re-extraction                             | [Plan 6](./IMPLEMENTATION_PLANS.md#plan-6-extraction-result-caching-persistence)       |
| **Gap 7** | [Projection Caching Persistence](./GAP_ANALYSIS.md#gap-7-projection-caching-persistence)                           | Accelerates "authoritative OKF queries" by caching graph/search/CPG projections                                             | [Plan 7](./IMPLEMENTATION_PLANS.md#plan-7-projection-caching-persistence)              |
