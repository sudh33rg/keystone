# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Keystone is a VS Code extension that serves as a deterministic, repository-aware control layer for Copilot-assisted development. It builds a local intelligence graph of the codebase, converts developer intent into approved specifications and task plans, constructs token-efficient context packages, delegates approved implementation tasks to GitHub Copilot, validates results, and manages Git/PR delivery.

The project is implemented as a single VS Code extension package with a React/Vite Webview UI. All source code lives under `src/` organized by domain layer.

## Repository Structure

```
src/
├── core/              # Domain services and business logic
│   ├── configuration/
│   ├── context/       # Task context construction and compression
│   ├── copilot/       # Copilot integration, agent registry, delegation
│   ├── delivery/      # Git and PR delivery services
│   ├── execution/     # Task execution tracking and validation
│   ├── hub/           # Team workflow handoff
│   ├── intelligence/  # Repository indexing, querying, semantic graph
│   ├── intent/        # Natural language intent parsing
│   ├── localModels/   # Local LLM integration (future roadmap only)
│   ├── orchestration/ # Multi-agent orchestration
│   ├── persistence/   # Extension-managed local persistence
│   ├── review/        # Review workflow completion
│   ├── specifications/# Specification generation and approval
│   ├── team/          # Team workflow handoff
│   ├── tasks/         # Task graph management
│   ├── validation/    # Validation orchestration
│   └── workflows/     # Development workflow lifecycle
├── extension/         # VS Code adapter implementations
│   ├── adapters/      # Workspace, Git, Language Service adapters
│   ├── copilot/       # Copilot environment and customization
│   ├── dashboard/     # Dashboard providers
│   ├── git/           # Git delivery adapters
│   ├── intelligence/  # Intelligence panel providers
│   └── webview/       # Webview message routing
├── shared/            # Shared contracts, types, logging, errors
├── ui/                # React/Vite Webview application
│   ├── components/    # Webview UI components
│   ├── services/      # Host bridge service
│   └── styles/        # CSS
└── workers/           # Background workers (GraphIndexerWorker, GitHistoryParser)
```

## Core Architecture

### Intelligence Layer (src/core/intelligence)

The Intelligence layer builds and maintains a local graph of the repository:
- **RepositoryIndexService** — Orchestrates repository scanning, creates an `IntelligenceSnapshot` persisted under `.keystone/`. The snapshot contains files, symbols, relationships, and evidence records.
- **IntelligenceQueryService** — Provides read-only, bounded queries over the graph (search, entity lookup, find usages/callers/callees, neighborhood traversal, path finding, flow reconstruction, impact analysis).
- **CpgQueryService** — Provides queries over the Control/Program Graph (CPG).
- **SemanticGraphBuilder** — Builds indexes (Bloom filters, inverted indices) for efficient querying.

### Workflows Layer (src/core/workflows)

Keystone's workflow engine drives the SDLC:
- **DevelopmentWorkflowService** — Manages workflow lifecycle: capture intent → generate specification → approve → generate task plan → execute → validate → review → complete.
- **ExecutionRoutingService** — Routes tasks to execution (GitHub Copilot, manual, or unsupported).
- **BuildWorkspaceService** — Prepares bounded task context packages (token-aware, includes tests, respects exclusions) and orchestrates Copilot delegation.
- **TaskExecutionService** — Tracks execution sessions, prompts, validation runs, and change observations.
- **ValidationOrchestrator** — Runs build/lint/test commands and evaluates acceptance criteria.
- **ReviewCompletionService** — Orchestrates review workflow completion.
- **DeliveryCoordinator** — Manages Git push and PR creation via provider registry (GitHub extension or clipboard fallback).
- **TeamWorkflowService** — Handles handoff export/import with security verification.
- **OrchestrationService** — Multi-agent orchestration with routing strategies.

### Copilot Integration (src/core/copilot)

Keystone delegates implementation to GitHub Copilot under strict bounds:
- **CapabilityDrivenCopilotAdapter** — Adapter that drives Copilot via the VS Code extension API.
- **AgentRegistry** — Registry of available agents with evidence-backed availability.
- **DelegationService** — Constructs context packages, builds prompts, and delegates tasks.
- **DelegationTrackingService** — Tracks which tasks were delegated and their outcomes.
- **CopilotIntegrationService** — Manages tool registration, tool audit, and tool execution.
- **KeystoneChatParticipantService** — VS Code Chat Participant for repository-aware chat.
- **CopilotToggleService** — Toggle for markdown generation to `.keystone/knowledge-graph.md` and `.keystone/intelligence-overview.md`.

### Context Construction (src/core/context)

Keystone constructs bounded context packages for each task:
- **TaskContextService** — Assembles context from relevant files, tests, and entities.
- **ContextCompressionEngine** — Applies lossless compression (caveman pattern) to reduce token usage.
- **ContextEngine** — Orchestrates context retrieval and compression.

### Persistence

All extension state is persisted under `.keystone/`:
- **IntelligenceStore** — Intelligent snapshot with automatic recovery from previous generations.
- **DelegationPersistenceStore** — Workflow state.
- **ExecutionPersistenceStore** — Execution sessions and validation runs.
- **DeliveryPersistenceStore** — Delivery change sets and PR results.
- **ReviewPersistenceStore** — Review state.
- **TeamWorkflowPersistenceStore** — Handoff artifacts.
- **OrchestrationPersistenceStore** — Orchestration state.
- **NativeShellPersistenceStore** — Native shell state.
- **CopilotIntegrationPersistenceStore** — Copilot settings and tool audit.

## Key Design Principles

1. **Determinism** — All intelligence, queries, and workflows are deterministic and evidence-backed. No speculative or probabilistic behavior.
2. **Token efficiency** — Context packages are built with bounded token budgets and compressed losslessly.
3. **Bounded queries** — All queries are read-only and bounded by configurable limits (time, depth, result counts).
4. **Separation of concerns** — Each domain layer is self-contained and does not depend on implementation details of other layers.
5. **Recoverability** — Persistent state includes recovery mechanisms (previous generations, scope correction migration).

## Testing

The repository includes comprehensive tests:
- Unit tests under `tests/unit/`
- UI end-to-end tests under `tests/ui/`
- Extension tests under `tests/extension/`
- Intelligence benchmarks under `tests/fixtures/benchmarks/`

Run `npm test` for unit tests, `npm run test:extension` for extension tests (requires building), and `npm run verify` to run the full verification suite (typecheck, lint, tests, build).

## Development Commands

```sh
npm install                         # Install dependencies
npm run build                       # Build extension + webview
npm run verify                      # Full verification (typecheck, lint, tests, build)
npm run test:extension              # Run extension tests
npm run test:intelligence-benchmark # Run intelligence benchmarks
```

Use the VS Code Extension Development Host to run the extension. The `Keystone: Open Control Center` command focuses the Activity Bar view.

## Important Files

- `README.md` — High-level project description and verification status
- `docs/` — Design documents and specifications
- `src/core/intelligence/runtime/IntelligenceRuntime.ts` — Intelligence lifecycle orchestration
- `src/core/workflows/DevelopmentWorkflowService.ts` — Workflow engine
- `src/extension/extension.ts` — Extension activation and initialization
