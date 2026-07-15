# Keystone Intelligence Execution Plan

## Objective

Complete the repository intelligence runtime and Intelligence UI before expanding other Keystone features.

## Working rules

- Each milestone must end in a working, testable state.
- Do not implement several incomplete subsystems simultaneously.
- Update this document after each completed milestone.
- Record discovered gaps instead of silently changing architecture.
- Mark tasks as complete only after validation.

## Milestone 1 — Current-state audit and foundation repair

- [ ] Install dependencies and run the existing type check, lint, and tests.
- [ ] Map the current extension-host and Webview architecture.
- [ ] Identify compile failures and contract mismatches.
- [ ] Replace fake relationship generation.
- [ ] Repair file classification and ignore rules.
- [ ] Add stable repository, file, entity, edge, and evidence IDs.
- [ ] Persist file and symbol records locally.
- [ ] Implement atomic file writes.
- [ ] Add repository-overview query.
- [ ] Display live overview data in the React SPA.

### Exit criteria

- A repository can be scanned.
- File and symbol records survive VS Code restart.
- Tests are included.
- No invented calls or relationships exist.
- The Intelligence overview displays real data.

## Milestone 2 — Continuous ingestion

- [ ] Implement startup reconciliation.
- [ ] Implement persistent worker pools.
- [ ] Add prioritized ingestion jobs.
- [ ] Add file-change coalescing.
- [ ] Add Git HEAD and branch monitoring.
- [ ] Use Git diffs for branch and pull reconciliation.
- [ ] Add stale-job cancellation.
- [ ] Add deleted-file cleanup.
- [ ] Add recovery after intelligence deletion.
- [ ] Add immutable generations and atomic promotion.
- [ ] Expose worker and progress events to the UI.

### Exit criteria

- Ingestion never blocks the Webview or extension host.
- Saves update affected intelligence.
- Pulls and checkouts reconcile incrementally.
- Deleted intelligence rebuilds automatically.
- Previous intelligence remains queryable during updates.

## Milestone 3 — TypeScript and JavaScript semantic graph

- [ ] Parse TypeScript, JavaScript, TSX, and JSX.
- [ ] Extract imports and exports.
- [ ] Resolve declarations and references.
- [ ] Resolve calls where evidence is available.
- [ ] Extract classes, interfaces, inheritance, and implementation.
- [ ] Extract React components and hooks.
- [ ] Extract routes and middleware.
- [ ] Extract tests and test relationships.
- [ ] Extract package and build metadata.
- [ ] Add evidence and confidence to every relationship.

## Milestone 4 — Progressive CPG

- [ ] Define provider-independent CPG contracts.
- [ ] Generate method-level AST overlays.
- [ ] Generate local control-flow graphs.
- [ ] Generate local data-flow graphs.
- [ ] Support backward and forward slices.
- [ ] Cache CPG shards by source hash.
- [ ] Add CPG query APIs.
- [ ] Add selected CPG views to the UI.

## Milestone 5 — Universal repository intelligence

- [ ] Documentation adapters
- [ ] SQL and migration adapters
- [ ] ORM adapters
- [ ] OpenAPI and GraphQL adapters
- [ ] Build-system adapters
- [ ] CI and infrastructure adapters
- [ ] Fallback language adapters
- [ ] Technology coverage reporting

## Milestone 6 — Query engine

- [ ] Overview
- [ ] Search
- [ ] Entity details
- [ ] Neighborhood
- [ ] Path
- [ ] Impact
- [ ] Flow
- [ ] Tests for entity
- [ ] Architecture queries
- [ ] Change queries
- [ ] Deterministic natural-language query compiler

## Milestone 7 — OKF

- [ ] Define Keystone OKF profile.
- [ ] Project canonical entities into OKF.
- [ ] Generate indexes and backlinks.
- [ ] Regenerate only affected concepts.
- [ ] Validate links and freshness.
- [ ] Add OKF browser and export.

## Milestone 8 — Complete Intelligence UI

- [ ] Intelligence overview
- [ ] Technology and coverage dashboard
- [ ] Worker activity panel
- [ ] Search and query bar
- [ ] Explorer
- [ ] Entity inspector
- [ ] Scoped graph canvas
- [ ] Flow viewer
- [ ] Impact view
- [ ] Test intelligence
- [ ] OKF browser
- [ ] Diagnostics and exclusions