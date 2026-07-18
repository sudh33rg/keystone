# Keystone

Keystone is a VS Code extension that builds deterministic repository intelligence, converts developer intent into approved specifications and task plans, constructs token-efficient context, delegates approved implementation tasks to GitHub Copilot, validates results, supports QA/security/performance checks, prepares Git and PR delivery, and enables Task Handoff.

The project is being implemented progressively from the approved specification in the `docs/` directory.

## Verification Status

**All gates passed — repository verified and ready for use.**

| Check | Result |
|-------|--------|
| Type checking | ✅ Passed |
| Linting | ✅ Passed |
| Unit tests | ✅ 414 tests passed |
| Extension tests | ✅ Passed on VS Code 1.95.0 |
| Build | ✅ Extension + semantic worker |

Run `npm run verify` to verify the current state.

## Current implementation

Keystone remains one VS Code extension package with a React/Vite Webview, extension-managed local persistence, deterministic repository Intelligence/semantic graph/CPG/query services, intent/specification/task workflows, bounded context construction, capability-driven Copilot delegation, execution and validation tracking, Git/PR delivery, and portable Task Handoff.

There is no backend, external database, centralized intelligence service, or active local-model/training runtime. Future ideas are separated in [the roadmap](docs/10-future-roadmap.md) and do not affect current builds or release gates.

## Release Notes

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
