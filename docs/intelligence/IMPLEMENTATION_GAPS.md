# Current Keystone Intelligence Implementation Gaps

## Purpose

This document records the known gap categories that Codex must verify against the current repository before changing code. It is not proof of current behavior. Every item must be grounded in exact files and functions during the audit.

## Likely foundation gaps

- Repository indexing may scan files without persisting complete file records
- Extracted symbols may be temporary or inaccessible after restart
- Stable entity and edge IDs may be missing
- Relationship creation may include placeholders or guessed edges
- Evidence may be incomplete or not linked to entities and relationships
- Persistence may cover UI state but not canonical intelligence
- Query APIs may be missing or only partially implemented

## Classification and exclusion gaps

Verify that:

- Tests are never classified as generated
- CI configuration is included
- Build manifests, ORM schemas, migrations, OpenAPI, GraphQL, Docker, Kubernetes, and Terraform are included
- Dependency folders, build output, virtual environments, caches, binaries, archives, and minified assets are excluded
- CSS and static assets follow relationship-only or metadata-only policy rather than expensive deep analysis
- Secret values are never indexed
- Every exclusion has an explainable reason

## Continuous-ingestion gaps

Verify implementation of:

- Startup reconciliation
- File create, change, delete, and rename updates
- Change coalescing
- Persistent worker pools
- Stale-job cancellation
- Git branch and HEAD monitoring
- Pull, checkout, merge, rebase, and reset reconciliation
- Deleted-intelligence recovery
- Dependency-aware invalidation
- Atomic generation publication
- Query continuity during updates

## Semantic intelligence gaps

Verify support and correctness for:

- Files and symbols
- Imports and exports
- References and calls
- Classes, interfaces, inheritance, and implementation
- React components and hooks
- Routes and middleware
- Tests and test mappings
- Database and ORM relationships
- Configuration and build metadata
- Documentation concepts
- Git change intelligence

## CPG gaps

Verify whether any real AST, CFG, data-flow, call, slicing, or taint representation exists. Do not label a simple file or symbol graph as a Code Property Graph.

## Storage gaps

Verify:

- Local storage root
- Manifests and schema versions
- Atomic writes
- Compressed shards
- Reuse of unchanged shards
- Immutable generations
- Previous-generation retention
- Recovery from corrupt or missing files

## Query gaps

Verify availability of overview, search, entity, neighborhood, path, impact, flow, tests, architecture, changes, diagnostics, and OKF queries. Check pagination, cancellation, generation identity, and Webview payload limits.

## UI gaps

Verify whether the Intelligence section is still a placeholder and whether real data exists for overview, progress, search, explorer, entity inspection, graph, flow, impact, tests, OKF, and diagnostics.

## Quality and compile gaps

Codex must install dependencies and run:

- Type check
- Lint
- Unit tests
- Extension integration tests
- UI tests

Record exact failures before implementation. Check for mismatched callback signatures, contract drift, invalid imports, missing worker bundles, Webview CSP issues, and large synchronous extension-host operations.

## Audit output required

For every verified gap, record:

- Status: real, partial, placeholder, incorrect, or absent
- Exact file and symbol
- Evidence from code
- User impact
- Recommended correction
- Dependencies
- Test required
