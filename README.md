# Keystone

Keystone is a local-first VS Code engineering intelligence and SDLC orchestration extension. It deterministically understands the active repository, persists that knowledge in an OKF-compatible model, exposes graph/CPG/flow exploration and evidence-backed querying, turns an engineering intent into reviewable repository R&D and an implementation specification, compresses the relevant context for user-approved GitHub Copilot delegation, validates the SDLC, and preserves task continuity through encrypted Task Handoff.

Keystone is not another coding model. **Keystone understands, plans, retrieves, compresses, coordinates, and validates. GitHub Copilot generates.**

## Product flow

```text
Repository
  → deterministic incremental intelligence
  → OKF + Graph + CPG + control/data/call flows
  → Intelligence Explorer / Graph / CPG / Flows / Query
  → Intent
  → repository R&D
  → user approval
  → implementation specification + user/quality stories
  → 16-stage SDLC
  → bounded context compression
  → user-approved Copilot delegation
  → QA / security / performance / modernization / review evidence
  → read-only PR review
  → completion or encrypted Task Handoff
```

Git access is strictly read-only. Keystone never stages, commits, pushes, pulls, checks out, creates branches, creates/updates/approves/merges a remote merge request, or performs any other Git mutation.

## Run Keystone from source

Requirements: VS Code 1.92+ and Node.js 20+.

```bash
npm install --offline --ignore-scripts
npm run build
```

Then open this folder in VS Code and press **F5**. The included `.vscode/launch.json` starts an Extension Development Host with Keystone loaded from the current source tree.

In the Extension Development Host:

1. Open a repository.
2. Run **Keystone: Open Application**.
3. Choose **Index Repository** or run **Keystone: Index Repository**.
4. Use **Intelligence** to inspect Overview, Explorer, Graph, CPG, Flows, and Query.
5. Use **Work** to enter an intent, review/approve repository R&D, create the specification/stories, and progress the SDLC.
6. Use **Open Browser View** when you want the same active application state in the browser surface.
7. Use **Task Handoff** on the active task when continuity needs to move to another developer.

The npm toolchain required to build the extension is vendored under `vendor/`, so the source can be installed in an offline environment.

## Source structure

```text
src/
├── core/
│   ├── application/     # shared application state
│   ├── intelligence/    # ingestion, languages, OKF, graph, CPG, query, flows
│   ├── context/         # retrieval, ranking, compression, prompt context
│   ├── workflow/        # intent/SDLC, QA, validation, modernization, handoff
│   ├── platform/        # storage, read-only Git, configuration, metrics
│   ├── integration/     # UI contract and ValueEdge boundary
│   └── domain/
├── extension/           # VS Code activation, workers, Browser View, UI bridge
├── webview/             # shared React UI used by VS Code and Browser View
└── types/
```

## Intelligence

Repository ingestion does not require an LLM. Keystone discovers repository artifacts, language/framework/build/test characteristics, semantic symbols, relationships, architecture boundaries, tests, APIs, persistence, configuration and engineering flows. The canonical persisted knowledge is represented through the Keystone OKF profile and projected into Graph, CPG, search/query and task-context views.

TypeScript/JavaScript receive compiler-semantic enrichment. Other registered languages receive deterministic structural analysis and universal CPG representation, with optional enrichment from installed VS Code language services where available. Unknown probable-text languages are still indexed through the deterministic universal frontend rather than silently ignored.

Repository knowledge is not capped merely to fit an AI prompt. **Only the Copilot context pack is bounded and compressed.**

## Context and Copilot

For an active story, Keystone selects only relevant files, symbols, graph/CPG/flow evidence, tests, constraints, prior decisions and validation requirements. Repository Copilot agents, skills and instructions are discovered separately and remain user-selectable. Delegation requires explicit user approval. Keystone never fabricates a Copilot result when an authorized VS Code Copilot model is unavailable.

## Documentation

Start with [`docs/KEYSTONE_PRODUCT_SPEC.md`](docs/KEYSTONE_PRODUCT_SPEC.md), then see [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md), [`docs/ONTOLOGY_AND_GRAPH.md`](docs/ONTOLOGY_AND_GRAPH.md), [`docs/SDLC.md`](docs/SDLC.md), [`docs/TASK_HANDOFF.md`](docs/TASK_HANDOFF.md), and [`docs/BROWSER_VIEW.md`](docs/BROWSER_VIEW.md).
