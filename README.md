# Keystone

Keystone is a VS Code extension that builds deterministic repository intelligence, converts developer intent into approved specifications and task plans, constructs token-efficient context, delegates approved implementation tasks to GitHub Copilot, validates results, supports QA/security/performance checks, prepares Git and PR delivery, and enables Task Handoff.

The project is being implemented progressively from the approved specification in the `docs/` directory.

## Verification Status

**All quality gates pass as of 2026-07-20** (typecheck, lint, unit tests, and build verified via `npm run verify`).

| Check | Result |
|-------|--------|
| Type checking | ✅ Passed |
| Linting | ✅ Passed |
| Unit tests | ✅ 458 tests passed |
| Build | ✅ Extension + webview |

Run `npm run verify` to verify the current state.

Run `npm run verify` to verify the current state.

## Current implementation

Keystone remains one VS Code extension package with a React/Vite Webview, extension-managed local persistence, deterministic repository Intelligence/semantic graph/CPG/query services, intent/specification/task workflows, bounded context construction, capability-driven Copilot delegation, execution and validation tracking, Git/PR delivery, and portable Task Handoff.

There is no backend, external database, centralized intelligence service, or active local-model/training runtime. Future ideas are separated in [the roadmap](docs/10-future-roadmap.md) and do not affect current builds or release gates.

## Release Notes

### v0.2.0 — (planned) Intelligence Services, UI, and Copilot Markdown

> **Note:** The package version is currently `0.1.0` (see `package.json`). The v0.2.0 release described below has not yet been cut.

**Major updates:**
- Added 10 core intelligence services for dependency analysis, cycle detection, node metrics, dead code, cyclomatic complexity, exported symbols, file dependencies, filtered subgraphs, module mapping, and wildcard search
- Implemented filtered subgraph extraction with configurable filters (relationship types, entity types, depth, direction)
- Added full context retrieval service (ancestors, children, imports, type edges)
- Built VS Code UI: single Intelligence Webview panel with tabs, side-bar explorer, toolbar actions, and status-bar indicator
- Implemented Copilot markdown generation: `.keystone/knowledge-graph.md` and `.keystone/intelligence-overview.md` on toggle enable
- Added background workers: `GraphIndexerWorker` for repository indexing and `GitHistoryParser` for Git history ingestion
- All commands prefixed with `keystone.` to avoid conflicts; all data stored under `.keystone/` with `.gitignore`

**Repository state (as of 2026-07-20 remediation):**
- 59 test files, 458 tests
- 10 new service files, 4 markdown generation services, 2 new webview providers, 2 new workers
- All quality gates pass (`npm run verify`: typecheck, lint, tests, build)

### v0.1.0 — Verified and Ready (2026-07-18)

**Major updates:**
- Scope correction: removed Business Unit Hub and local-model/LoRA capabilities (future roadmap only)
- Refactored monorepo structure into single `src/` directory
- Consolidated all intelligence capabilities into unified architecture

**Completed milestones:**
1. Repository Intelligence foundation
2. Continuous ingestion
3. Semantic graph (TypeScript/JavaScript)
4. Progressive CPG
5. Repository adapters
6. Query and analysis engine
7. Intent capture and specification workflow
8. Copilot agent discovery, context construction, and controlled delegation
9. Execution tracking, validation, retry, and completion
10. Git and PR delivery
11. Task Handoff and team workflow
12. AI-driven SDLC orchestration

**Repository state:**
- 46 test files, 360 tests
- Extension bundle: 1.5 MB
- Semantic worker: 10.3 MB
- Webview: 504.80 KB JavaScript, 35.80 KB CSS

See [GAP-ANALYSIS.md](GAP-ANALYSIS.md) for detailed comparison with Keystone_old.

## Development

```sh
npm install
npm run verify
```

Use the VS Code Extension Development Host to run the extension. The `Keystone: Open Control Center` command focuses the Activity Bar view.
