# Keystone Intelligence Delivery Plan

## Delivery strategy

Build one working vertical slice at a time. Each milestone must leave Keystone in a runnable, testable state. Do not expand intent, specification, task, or Copilot workflows until intelligence and its UI are stable.

## Milestone 1 — Audit and foundation repair

Deliver:

- Grounded current-state audit
- Correct file classification and exclusion policy
- Stable repository, file, entity, edge, and evidence IDs
- Local manifest and atomic storage primitives
- Persistent file, symbol, relationship, and evidence records
- Removal of fake relationships
- Repository overview query
- Live Intelligence overview UI

Exit criteria:

- Intelligence survives restart
- Tests are included
- No invented relationships exist
- Overview displays real repository data
- Type check, lint, and relevant tests pass

## Milestone 2 — Continuous ingestion runtime

Deliver:

- Startup reconciliation
- File and Git monitors
- Change coalescing
- Persistent worker pools
- Priority jobs and cancellation
- Stale-result protection
- Incremental shard updates
- Deleted-file cleanup
- Deleted-intelligence recovery
- Immutable generations and atomic promotion
- Live progress and worker status UI

Exit criteria:

- Saves, deletes, pulls, and branch changes update intelligence
- VS Code remains responsive
- Previous intelligence stays queryable during updates
- Recovery works without reload

## Milestone 3 — TypeScript and JavaScript semantic graph

Deliver:

- TypeScript Compiler API adapter
- Imports, exports, declarations, references, calls, types, inheritance, and implementation
- React components and hooks
- Route and middleware adapters
- Test extraction and mapping
- Package, configuration, and build metadata
- Evidence and confidence on every relationship

Exit criteria:

- Real code navigation and impact queries work for supported repositories
- Relationship evidence opens exact source ranges

## Milestone 4 — Query engine and core UI

Deliver:

- Search
- Entity details
- Neighborhood
- Path
- Impact
- Tests-for
- Architecture basics
- Explorer and entity inspector
- Scoped graph canvas

Exit criteria:

- Users can browse and query intelligence without raw files or manual graph inspection

## Milestone 5 — Progressive CPG

Deliver:

- Provider abstraction
- Method-level AST
- Local CFG and data flow
- Forward and backward slices
- Cached CPG shards
- Selected CPG query and UI views

Exit criteria:

- Keystone can explain value origin, propagation, control branches, and path-level test gaps for supported code

## Milestone 6 — Universal repository adapters

Deliver structural and semantic adapters for documentation, SQL, migrations, ORM, OpenAPI, GraphQL, build systems, CI, containers, infrastructure, and additional languages.

Exit criteria:

- Coverage report honestly distinguishes deep, partial, metadata-only, and unsupported technologies

## Milestone 7 — OKF projection

Deliver Keystone OKF profile, concept generation, indexes, backlinks, incremental regeneration, validation, browser, and export.

Exit criteria:

- OKF and graph views resolve to the same canonical IDs and evidence

## Milestone 8 — Complete Intelligence UI

Deliver final overview, technology and coverage dashboards, search, explorer, entity inspector, graph, flow, impact, tests, OKF, diagnostics, exclusions, and worker controls.

Exit criteria:

- All required intelligence capabilities are usable inside the extension
- Large repositories remain responsive through pagination and scoped views

## Cross-cutting requirements

Every milestone must include:

- Typed contracts
- Unit tests
- Integration tests where applicable
- Cancellation and error handling
- Evidence and freshness
- Performance checks
- Documentation updates
- Diff review for external-storage dependencies, guessed relationships, main-thread work, and unbounded Webview payloads

## Completion gate

The intelligence milestone is complete only when automatic ingestion, continuous updates, local storage, semantic graph, progressive CPG, queries, OKF, and UI operate together as one evidence-backed system.
