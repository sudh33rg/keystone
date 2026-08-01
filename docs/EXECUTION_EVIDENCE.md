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
