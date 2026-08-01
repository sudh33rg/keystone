# Keystone

Keystone is a local-first VS Code extension that converts an unknown repository into deterministic, evidence-backed engineering intelligence and uses that intelligence to drive an intent-led SDLC. It combines uncapped incremental ingestion, an authoritative OKF knowledge contract, graph and CPG projections, adaptive context compression, user-approved GitHub Copilot delegation, QA/security/performance/modernization/review workflows, ValueEdge integration, a synchronized Browser View, and encrypted Task Handoff.

## Product flow

```text
Open repository
  → non-blocking incremental intelligence ingestion
  → validated authoritative OKF snapshot
  → graph, CPG, search, flow, QA/security/performance projections
  → evidence-backed Intelligence UI and query engine
  → local intent or imported ValueEdge feature
  → repository R&D, specification and small user/quality stories
  → approved 16-stage SDLC plan
  → bounded, user-approved Copilot delegation
  → actual validation + QA/security/performance/modernization evidence
  → read-only code/PR review and documentation
  → optional publication of approved draft stories to ValueEdge
  → completion or encrypted Task Handoff
```

Git and merge-request access are strictly read-only. Keystone never stages, commits, pushes, pulls, checks out, creates branches, creates/updates/approves/merges a remote merge request, or performs any other Git mutation. All active Git access is routed through the central read-only policy boundary.

## Repository structure

```text
src/
├── core/
│   ├── application/     # authoritative shared state
│   ├── intelligence/    # ingestion, languages, OKF, graph, CPG, query pipeline
│   ├── context/         # retrieval, ranking, compression, delegation context
│   ├── workflow/        # SDLC, QA, validation, tasks, modernization, handoff
│   ├── platform/        # read-only Git, storage, events, metrics, configuration
│   ├── integration/     # application/UI contract and ValueEdge boundary
│   └── domain/
├── extension/           # VS Code activation, workers, browser server, UI bridge
├── webview/             # one React application served in VS Code and Browser View
└── types/
```

## Intelligence and language coverage

Every probable text artifact is ingested through the deterministic universal frontend, including unknown future languages and custom extensions. Keystone also has explicit conformance coverage for 43 programming, schema, build, infrastructure, data, markup, and documentation categories. TypeScript/JavaScript use compiler-semantic enrichment in an isolated worker. Other languages receive deterministic structural extraction and CPG generation and can be enriched by installed VS Code language services for definitions, references, implementations, and call hierarchy when available.

Repository intelligence remains uncapped by arbitrary file-count limits. Context sent to Copilot is deliberately bounded and compressed; repository knowledge is not discarded merely to fit a prompt.

## SDLC and validation

The active intent-led workflow contains 16 gated story types: research, specification, design, development, existing tests, test impact, new tests, failed tests, flaky tests, security, performance, modernization, code review, PR review, documentation, and completion. Test generation produces deterministic **draft** test scenarios/plans for review; it never writes or weakens tests autonomously.

Validation command discovery is additive for polyglot repositories. It recognizes repository-backed commands for Node, Python, Go, Rust, .NET, Gradle, Maven, PHP, Ruby, Swift, Scala, Dart, Elixir, Erlang, Haskell, Julia, Perl, R, CMake/Make, PowerShell/Pester, and Bats when corresponding project/test markers are present.

## Install and source verification

The repository includes an npm lockfile and vendored npm toolchain packages so the source can be installed offline.

```bash
npm ci --offline --ignore-scripts
npm run verify:source
npm run verify:cross-feature
npm run verify:production
```

`verify:source` is the clean source gate: structure, TypeScript, lint, and the complete automated test suite. Runtime acceptance is intentionally split into `npm run verify:cross-feature` and `npm run verify:production`; each builds from source and runs in its own process so large deterministic intelligence fixtures do not share compiler/OKF heap pressure. Generated build/runtime output is never part of the source distribution.

A live GitHub Copilot answer cannot be fabricated in a headless source verification environment: Keystone's production `vscode.lm` integration, approval flow, streaming capture, and no-fabrication contract are tested, while an actual model response is available only in a VS Code session where the user has authorized a Copilot model.

## Documentation

Start with [`docs/README.md`](docs/README.md). The current verification standard is documented in [`docs/FINAL_VERIFICATION.md`](docs/FINAL_VERIFICATION.md), and product-plan coverage is summarized in [`docs/PRODUCT_PLAN_CONFORMANCE.md`](docs/PRODUCT_PLAN_CONFORMANCE.md).
