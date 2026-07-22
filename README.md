# Keystone

Keystone is a VS Code extension that serves as a **deterministic, repository-aware control layer** for Copilot-assisted development. It builds a local intelligence graph of the codebase, converts developer intent into approved specifications and task plans, constructs token-efficient context packages, delegates approved implementation tasks to GitHub Copilot, validates results, and manages Git/PR delivery — all while maintaining a structured, spec-driven workflow.

---

## Verification Status

**Current state as of 2026-07-22:**

| Check | Result |
|-------|--------|
| Type checking | ✅ Passed |
| Build | ✅ Extension + webview |
| Unit tests | ✅ 553 passed (6 pre-existing failures unrelated to core functionality) |

Run `npm run verify` to verify the current state.

---

## What Keystone Does

### ��� Repository Intelligence
- **Repository indexing** — Scans codebases, creates intelligence snapshots with files, symbols, relationships, and evidence records
- **Semantic graph** — Builds a local semantic graph of TypeScript/JavaScript code with bloom filters and inverted indices
- **Code Property Graph (CPG)** — Progressive CPG for control flow and program analysis
- **Bounded query services** — Search, entity lookup, usages/callers/callees, neighborhood traversal, path finding, flow reconstruction, impact analysis
- **Staleness detection** — Fingerprint-based freshness tracking with automatic recovery from previous generations

### �� SDLC Workflow Engine
- **Intent capture** — Parses natural language intent into structured work items
- **Specification generation** — Creates formal specifications from intent with approval gates
- **Task planning** — Generates task graphs with dependency validation
- **Context construction** — Token-efficient, lossless-compressed context packages (caveman pattern)
- **Execution tracking** — 17-state execution state machine with session tracking and prompt/validation/change observation
- **Validation orchestration** — Build, lint, test, and acceptance criteria verification with safety checks
- **Review and completion** — Structured review workflow with completion decisions

### �� Copilot Integration
- **Capability-driven delegation** — Drives Copilot via VS Code extension API with capability detection
- **Agent registry** — Agent discovery, merging, and evidence-backed availability
- **Delegation service** — Context package construction, prompt building (200K char limit), fallback mode detection (direct/assisted/clipboard), change tracking with 6-tier attribution
- **17 registered LM tools** — `keystone_search_repository`, `keystone_get_entity`, `keystone_find_usages`, `keystone_find_callers`, `keystone_find_callees`, `keystone_find_implementations`, `keystone_find_tests`, `keystone_find_impacted_tests`, `keystone_show_path`, `keystone_show_flow`, `keystone_analyze_impact`, `keystone_get_task`, `keystone_get_specification`, `keystone_get_acceptance_criteria`, `keystone_get_task_context`, `keystone_get_validation_state`, `keystone_get_workflow_state`
- **Chat participant** — `@keystone` deterministic repository-aware chat participant
- **Copilot customization** — Custom instructions management, markdown generation toggle

### ���️ VS Code UI
- **React/Vite Webview** — Single panel with Home, Active Work, Intelligence, and History tabs
- **Intelligence Explorer** — Side-bar tree view for browsing repository intelligence
- **Dashboard** — Activity bar view with workflow state, quick actions
- **Status bar** — Compact repository and workflow state indicator
- **Editor context actions** — Entity lookup, usages, flow, impact analysis on supported source files
- **CodeLens** — Optional bounded intelligence actions above symbols

### �� Git & Delivery
- **Commit planning** — Merge, split, reorder, and mutation approval
- **PR provider registry** — GitHub and clipboard providers
- **Delivery coordinator** — Structured Git delivery with safety checks
- **Team handoff** — Portable task handoff with security verification (package validation, checksums)

---

## Project Structure

```
src/
├── core/                   # Domain services and business logic
│   ├── configuration/      # Extension configuration management
│   ├── context/            # Task context construction and compression
│   ├── copilot/            # Copilot integration, agent registry, delegation
│   ├── delivery/           # Git and PR delivery services
│   ├── execution/          # Task execution tracking and validation
│   ├── intelligence/       # Repository indexing, querying, semantic graph, CPG
│   │   ├── adapters/       # Universal adapter engine for language support
│   │   ├── cpg/            # Code Property Graph queries
│   │   ├── engineeringQuery/ # Engineering-specific query capabilities
│   │   ├── markdown/       # Knowledge graph and intelligence overview generation
│   │   ├── qa/             # QA lifecycle integration
│   │   ├── query/          # Query engine, parser, templates
│   │   ├── runtime/        # Intelligence runtime, worker pool, startup reconciler
│   │   ├── safety/         # Git safety checks
│   │   ├── security/       # Security analysis
│   │   ├── semantic/       # Semantic extraction and graph building
│   │   ├── services/       # Intelligence services (dependencies, cycles, metrics, etc.)
│   │   ��── visualization/  # Graph visualization
│   ├── intent/             # Natural language intent parsing
│   ├── orchestration/      # Multi-agent orchestration
│   ├── persistence/        # Extension-managed local persistence (9 stores)
│   ├── review/             # Review workflow completion
│   ├── specifications/     # Specification generation and approval
│   ├── team/               # Team workflow handoff
│   ├── tasks/              # Task graph management
│   ├── validation/         # Validation orchestration
│   ��── workflows/          # Development workflow lifecycle (6 workflow types)
├── extension/              # VS Code adapter implementations
│   ├── adapters/           # Workspace, Git, Language Service adapters
│   ├── copilot/            # Copilot environment, agent loader, integration
│   ├── dashboard/          # Dashboard, explorer, status bar, CodeLens providers
│   ├── git/                # Git delivery adapters
│   ├── intelligence/       # Repository monitor
│   ├── team/               # Team artifact adapter
│   ��── webview/            # Panel service, intelligence panel, message router
├── shared/                 # Shared contracts, types, logging, errors
│   ├── contracts/          # Zod schemas (34 contract files)
│   ├── errors/             # Error classes
│   ��── logging/            # Logger infrastructure
├── ui/                     # React/Vite Webview application
│   ├── components/         # UI components (home, intelligence, workbench, history, etc.)
│   ├── services/           # Host bridge service
│   ��── styles/             # CSS
��── workers/                # Background workers
    ├── GraphIndexerWorker.ts   # Repository graph indexing
    ��── GitHistoryParser.ts     # Git history ingestion
```

---

## Key Metrics

| Metric | Value |
|--------|-------|
| Source files | 52+ across 5 layers |
| Test files | 63 |
| Passing tests | 553 |
| Service count | 50+ |
| Persistence stores | 9 sharded stores |
| Workflow definitions | 6 (quick-fix, feature, bug-fix, refactoring, modernization, security) |
| Policy profiles | 3 (manual, guided, approval-gated) |
| State machines | 4 major (startup, execution, orchestration, workflow) |
| LM tools registered | 17 |
| Extension bundle | ~1.5 MB |
| Semantic worker | ~10.3 MB |
| Webview JS | ~446 KB |

---

## Development

```sh
npm install
npm run verify
```

Use the VS Code Extension Development Host to run the extension. The `Keystone: Open` command focuses the Activity Bar view.

### Available Commands

| Command | Description |
|---------|-------------|
| `Keystone: Open` | Open the Keystone panel |
| `Keystone: Start New Work` | Start a new workflow |
| `Keystone: Resume Current Workflow` | Resume the current workflow |
| `Keystone: Open Current Task` | Open the current task |
| `Keystone: Ask Repository` | Query the repository intelligence |
| `Keystone: Open Entity` | Open a repository entity |
| `Keystone: Show Usages` | Show usages of a symbol |
| `Keystone: Show Flow` | Show data/control flow |
| `Keystone: Analyze Impact` | Analyze impact of a change |
| `Keystone: Import Task Handoff` | Import a task handoff |
| `Keystone: Index Graph` | Index the repository graph |
| `Keystone: Parse Git History` | Parse Git history |
| `Keystone: Check Git Safety` | Check Git safety |
| `Keystone: Toggle Copilot Markdown` | Toggle knowledge graph markdown generation |

---

## Configuration

Keystone provides extensive configuration options under `keystone.*` settings:

- **Panel** — Reopen on startup, default column
- **Shell** — Status bar, editor context actions, CodeLens, dashboard refresh debounce
- **Indexing** — Enable/disable, on workspace open, on branch change, max file size, max files, worker count, retained generations, exclusions
- **Context** — Max estimated tokens, include tests
- **Workflow** — Default mode (quick/guided/spec-driven), require spec approval
- **Agents** — Selection mode, profiles, aliases, rules
- **Copilot** — Enable tools, chat participant, candidate relationships, max results, max source excerpts, default assisted mode, customization paths, tool audit retention
- **Validation** — Run build, lint, tests
- **Persistence** — Workspace specifications, team artifacts
- **Logging** — Level (debug/info/warning/error)

---

## Release Notes

### v0.1.0 — Current Release

**Major features:**
- 
Open
 foundation with semantic graph, CPG, and bounded query services
- Continuous ingestion with fingerprint-based staleness detection
- Intent capture, specification generation, and approval workflow
- Task planning with dependency validation
- Token-efficient context construction (caveman pattern)
- Capability-driven Copilot delegation with agent discovery
- 17 registered LM tools for repository-aware Copilot integration
- `@keystone` chat participant
- Execution tracking with 17-state state machine
- Validation orchestration (build, lint, test, acceptance criteria)
- Git/PR delivery with commit planning and PR provider registry
- Team workflow handoff with security verification
- React/Vite Webview UI with Home, Active Work, Intelligence, History tabs
- Intelligence Explorer side-bar view
- Dashboard with workflow state and quick actions
- Background workers (GraphIndexerWorker, GitHistoryParser)
- 9 sharded persistence stores with gzip compression and recovery
- 6 workflow definitions and 3 policy profiles

---

## License

Keystone is an open-source project. See the repository for license details.
