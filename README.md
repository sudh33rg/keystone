# Keystone

Keystone is a local-first VS Code extension that converts an unknown repository into deterministic, evidence-backed engineering intelligence and uses that intelligence to drive an intent-led SDLC. It combines unbounded incremental ingestion, an authoritative OKF knowledge contract, graph and CPG projections, adaptive context compression, user-approved GitHub Copilot delegation, QA/security/performance/review stories, a synchronized Browser View, and encrypted Task Handoff.

## Product flow

```text
Open repository
  → non-blocking incremental intelligence ingestion
  → validated OKF snapshot
  → graph, CPG, and search projections
  → Intelligence UI with evidence and provenance
  → local intent or imported ValueEdge feature
  → presentable repository R&D and research
  → approved specification, small user/quality stories, and 16-story SDLC plan
  → bounded Copilot delegation with approval
  → QA, security, performance, code/PR review, and documentation
  → optional publication of approved draft stories to ValueEdge
  → completion or encrypted Task Handoff
```

Git and merge-request access are strictly read-only. Keystone never stages, commits, pushes, creates branches, or creates/updates/approves/merges a remote merge request.

## Repository structure

```text
src/
├── core/
│   ├── application/     # authoritative shared state
│   ├── intelligence/    # ingestion, languages, OKF, graph, CPG, query pipeline
│   ├── context/         # retrieval, ranking, compression, delegation context
│   ├── workflow/        # SDLC, QA, validation, tasks, modernization, handoff
│   ├── platform/        # read-only Git, storage, events, metrics, configuration
│   ├── integration/     # application/UI contract
│   └── domain/
├── extension/           # VS Code activation, workers, browser server, UI bridge
├── webview/             # one application served in VS Code and the browser
└── types/
```

## Language support

Every probable text artifact is ingested through the universal deterministic frontend, including unknown future languages and custom extensions. Keystone also has explicit conformance coverage for 43 programming, schema, build, infrastructure, data, markup, and documentation categories. TypeScript/JavaScript use the TypeScript compiler frontend. Other languages receive deterministic structural extraction and CPG generation, enriched by installed VS Code language services for definitions, references, implementations, and call hierarchy when available.

## Install, verify, and package

The repository includes an npm lockfile and local offline toolchain packages.

```bash
npm ci --offline
npm run verify
```

`npm run verify` runs the active-boundary check, strict type checking, lint, unit/integration tests, runtime acceptance scenarios, production build, VSIX packaging, and VSIX integrity verification.

Generated extension package:

```text
dist/keystone.vsix
```

## Documentation

Start with [`docs/README.md`](docs/README.md). Runtime acceptance results and screenshots are documented in [`docs/EXECUTION_EVIDENCE.md`](docs/EXECUTION_EVIDENCE.md).
