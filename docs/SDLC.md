# Intent-Led SDLC

Keystone uses one continuous workflow rather than separate Intent, Task, and Delivery products.

```text
Intent
  → intelligence-assisted research
  → presentable R&D document
  → specification approval
  → small user and quality backlog stories
  → design
  → development
  → existing-test analysis
  → test-impact analysis
  → new-test creation
  → failed-test investigation
  → flaky-test analysis
  → security review
  → performance review
  → modernization review
  → code review
  → read-only PR review
  → documentation
  → completion
```

## Durable story model

Each story stores objective, dependencies, status, acceptance criteria, satisfied criteria, evidence, blockers, decisions, context-pack reference, Copilot delegation, validation runs, findings, timestamps, and result state.

## State and gates

The domain state machine validates transitions. Specification approval is explicit. Delegation is prepared, displayed, approved, completed, and validated. Completion requires:

- all acceptance criteria satisfied
- evidence present
- dependencies complete
- no unresolved blockers
- no unresolved high/critical finding unless explicitly accepted
- a passing validation run for executable/review stories

## QA and review

Test impact uses explicit test mappings, coverage evidence, and reverse graph traversal. Failed tests produce classification and approval-gated remediation proposals; Keystone never silently weakens or heals tests. Security, performance, modernization, code review, and PR review are first-class stories. PR review reads diffs and prepares reviewer content but never mutates a remote PR/MR.

The acceptance suite verifies a repository-derived R&D document, dynamic small behavior and quality stories, and all 16 SDLC stages through the deterministic lifecycle and validation gates. The production Copilot integration is verified at its VS Code Language Model API/stream-capture boundary; an actual model answer is only accepted when returned by a user-authorized Copilot model and is never fabricated by the verifier. The number and scope of backlog stories are derived from affected APIs, services, data entities, repository slices, tests, and risks; they are not fixed templates. An intent may originate locally or from a read-only ValueEdge feature import; approved draft backlog publication remains an explicit user action.

---

## Gap Analysis References

The following gaps identified in [GAP_ANALYSIS.md](./GAP_ANALYSIS.md) relate to SDLC functionality:

- **Gap 1: Continuation Packets** - Large SDLC context packets (research documents, specifications, evidence) cannot be split into ordered packets for Copilot consumption. See [IMPLEMENTATION_PLANS.md#gap-1](./IMPLEMENTATION_PLANS.md#gap-1-continuation-packets-not-implemented).
- **Gap 2: Context Compression Caching** - SDLC context packets (research, specifications, evidence) are recomputed on every request without caching. See [IMPLEMENTATION_PLANS.md#gap-2](./IMPLEMENTATION_PLANS.md#gap-2-context-compression-caching-not-implemented).
- **Gap 4: adaptive-segments Delivery Mode** - SDLC context delivery doesn't support progressive segment loading for large artifacts. See [IMPLEMENTATION_PLANS.md#gap-4](./IMPLEMENTATION_PLANS.md#gap-4-adaptive-segments-delivery-mode-not-implemented).

All gaps are marked as **PLANNED** with detailed implementation plans in [IMPLEMENTATION_PLANS.md](./IMPLEMENTATION_PLANS.md).
