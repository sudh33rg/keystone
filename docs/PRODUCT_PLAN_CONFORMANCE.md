# Keystone Product Plan Conformance

The current implementation and the agreed Keystone plan use the same product boundaries.

| Planned capability | Active implementation | Acceptance evidence |
|---|---|---|
| One monolithic VS Code extension | Single `src/` product tree; no apps/packages workspace | active-boundary check |
| Deterministic local Intelligence Layer first | background discovery, extraction, pipeline health, atomic persistence | pipeline and runtime tests |
| No arbitrary repository file cap | universal discovery continues until completion/cancellation | 5,205-file runtime scenario |
| Incremental ingestion | metadata/content reuse, changed-file analysis, deletion lifecycle | unchanged-file reuse test |
| All text-based languages | universal probable-text frontend for unknown/custom extensions | unknown-language tests |
| Explicit broad language coverage | 43 registered and conformance-tested categories | language conformance suite |
| OKF as authoritative knowledge | profile v2, validation, observations, evidence, lifecycle, digests | OKF integration suite |
| Graph/search/CPG linked to OKF | projections and CPG identity bindings use OKF IDs | projection and shard tests |
| Intelligence visible in UI | readiness, languages, query results, OKF counts/evidence/provenance | shared application state and UI wiring |
| Context compression and Copilot delegation | intent-ranked context, deduplication, compression, approval packet | context pipeline and SDLC delegation tests |
| Intent-led SDLC | presentable R&D → approved specification → dynamic evidence-backed user/quality stories → 16 executable SDLC stages | full SDLC graph test/runtime |
| ValueEdge feature integration | feature import, local research/plan, explicit approval, draft user/quality story publication | deterministic local HTTP integration fixture plus unit/runtime acceptance |
| QA and test impact | mapped tests, reverse graph impact, coverage, failure/flaky analysis | QA and coverage tests |
| Security/performance/modernization/review | first-class SDLC story types and evidence gates | full SDLC graph test |
| Read-only PR review | review evidence only; no remote mutation | active-boundary/read-only Git checks |
| Task Handoff on active work | encrypted versioned package preserving exact SDLC state | handoff round-trip tests |
| Same UI in browser | one app, one host store, authenticated loopback transport | Browser View tests/runtime |
| Offline reproducible project | `package-lock.json`, vendored npm toolchain, offline CI commands | clean `npm ci --offline` verification |
| Installable extension | production build and VSIX package | VSIX integrity verification |

`docs/FINAL_RUNTIME_RESULTS.json` contains the latest machine-readable execution results.
