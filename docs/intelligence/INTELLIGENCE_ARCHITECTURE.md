# Keystone Intelligence Architecture

## Runtime boundaries

Keystone has two runtime environments.

### VS Code extension host

Responsible for workspace integration, Git observation, lifecycle management, job scheduling, result publication, query routing, and communication with the Webview. It must not perform heavy parsing or graph construction synchronously.

### React SPA Webview

Responsible for presentation, navigation, query input, entity inspection, graph views, flow views, OKF browsing, progress, diagnostics, and user controls. It accesses intelligence only through typed extension-host messages.

## Main architecture

```text
Workspace and Git events
        ↓
Repository State Monitor
        ↓
Change Collector and Reconciler
        ↓
Priority Ingestion Scheduler
        ↓
Persistent Background Worker Pools
        ↓
File Intelligence Deltas
        ↓
Relationship Resolution and Dependency Invalidation
        ↓
Pending Immutable Generation
        ↓
Validation and Atomic Promotion
        ↓
Active Intelligence Generation
        ↓
Query API ── React SPA
        ↓
OKF Projection and Agent Context
```

## Core components

### IntelligenceRuntime

Owns activation, startup reconciliation, worker pools, monitors, storage, query services, health, recovery, and shutdown.

### StartupReconciler

Validates local intelligence against the workspace, branch, HEAD commit, parser versions, ontology version, and shard availability. It loads the last valid generation immediately and schedules only the necessary repair.

### RepositoryStateMonitor

Observes file creation, modification, deletion, rename, workspace folder changes, and intelligence deletion.

### GitStateMonitor

Observes branch and HEAD changes using the VS Code Git extension where available, lightweight ref checks, and Git diff reconciliation. It handles checkout, pull, merge, rebase, reset, staged, unstaged, and untracked changes.

### ChangeCollector

Coalesces bursts of events into a normalized change batch. It reduces repeated events per path and distinguishes active-editor changes from Git-wide changes.

### IngestionScheduler

Maintains prioritized, cancellable jobs with dependencies. Priority order is interactive query, active editor, Git reconciliation, normal repository updates, then idle analysis.

### WorkerPoolManager

Maintains persistent worker threads. Fast workers handle classification, hashing, parsing, symbols, direct relationships, and local CPG. Deep workers handle cross-file resolution, interprocedural analysis, graph metrics, test mapping, architecture analysis, and OKF aggregation.

### ParserRegistry and AdapterRegistry

Select language, framework, database, test, build, infrastructure, and documentation adapters. Adapters emit normalized entities, relationships, evidence, diagnostics, and coverage data.

### SemanticGraphBuilder

Builds the repository-wide engineering semantic graph from extracted facts. It never creates relationships without evidence.

### CpgProvider

Builds fine-grained code property graph shards for supported code. The provider is isolated behind a Keystone contract so the internal ontology is not coupled to a specific CPG implementation.

### DependencyInvalidator

Determines which relationships, indexes, CPG slices, flows, tests, OKF concepts, and caches must be updated after a source change.

### GenerationPublisher

Writes changed shards into a pending immutable generation, validates it, and atomically promotes it. Queries continue using the previous generation until promotion succeeds.

### IntelligenceQueryService

Provides overview, search, entity details, neighborhood, path, impact, flow, test, architecture, change, diagnostics, and OKF queries.

### IntelligenceHealthService

Reports freshness, coverage, parser failures, unresolved references, low-confidence relationships, broken OKF links, missing shards, queue status, and worker health.

## Data layers

### Physical inventory

Repositories, workspaces, packages, directories, files, manifests, artifacts, and classifications.

### Semantic engineering graph

Files, symbols, modules, endpoints, events, tables, tests, configuration, documentation, and their typed relationships.

### Fine-grained CPG

AST, control flow, data flow, calls, evaluation order, branches, parameters, returns, and slices.

### Evidence store

Source ranges, parser versions, derivation methods, hashes, branch, commit, generation, and confidence.

### Search and adjacency indexes

Name, qualified name, path, type, incoming relationships, outgoing relationships, test target, route handler, table access, configuration usage, and OKF text.

### OKF projection

Deterministically generated Markdown concepts and indexes based on canonical intelligence.

## Extension-host communication

All Webview requests and events are typed and versioned. Large results must be paginated, cancellable, bounded, and tagged with the intelligence generation used.

## Architectural constraints

- No monorepo requirement
- No separate server
- No external database
- No heavy work on the extension-host event loop
- No unbounded graph payloads to the Webview
- No guessed relationships
- No LLM dependency for ingestion or querying
- No partial generation visible to queries
- No direct repository access from the React SPA
