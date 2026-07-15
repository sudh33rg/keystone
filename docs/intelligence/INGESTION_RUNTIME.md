# Keystone Continuous Ingestion Runtime

## Objective

Ingestion continuously maintains repository intelligence without blocking the developer. It is automatically started for an open workspace and responds to source, Git, parser, ontology, and intelligence-storage changes.

## Lifecycle

```text
Workspace opens
  ↓
Load last valid generation
  ↓
Validate manifest and repository state
  ↓
Schedule missing or stale work
  ↓
Watch files, Git, and intelligence health
  ↓
Process incremental changes in workers
  ↓
Publish new generation atomically
```

## Startup reconciliation

Validate:

- Intelligence root and current pointer
- Repository identity
- Workspace folders
- Branch and HEAD
- Dirty worktree state
- Required shards
- Parser and ontology versions
- Interrupted pending generation
- Changed file hashes

Actions:

- Valid: load immediately
- Partially stale: load and repair in background
- Missing: create initial generation in background
- Corrupt: quarantine and rebuild
- Parser upgrade: rebuild affected adapters only
- Ontology upgrade: regenerate affected projections and indexes

## Event sources

- File create, change, delete, and rename
- Workspace folder changes
- Active editor saves
- Git branch and HEAD changes
- Pull, checkout, merge, rebase, reset
- Staged, unstaged, and untracked changes
- Manual deletion of intelligence files
- Extension restart
- Parser or ontology version changes

## Change coalescing

The collector opens a short event window, groups events by normalized path, and reduces repeated events:

- create then change => added
- repeated change => modified once
- change then delete => deleted
- delete then create => replaced or renamed after Git reconciliation

Git operations are reconciled as one stable batch using old and new HEAD diffs plus dirty worktree changes.

## Job scheduling

Job priorities:

1. Interactive query
2. Active editor
3. Current task context
4. Git reconciliation
5. Normal workspace changes
6. Background analysis

Jobs contain type, priority, path, source hash, target generation, dependencies, cancellation token, and revision.

## Persistent worker pools

### Fast pool

Classification, hashing, parsing, symbol extraction, direct relationships, local CPG, and source evidence.

### Deep pool

Cross-file resolution, test mapping, interprocedural analysis, architecture metrics, security, performance, co-change analysis, and aggregate OKF generation.

Worker count is configurable and derived from available processors while leaving capacity for VS Code and the operating system.

## Stale-result protection

Before a worker result is merged, the supervisor compares the result's input hash and revision with current repository state. Stale output is discarded and the latest job is scheduled.

## Incremental invalidation

Changes are classified as documentation-only, implementation, structural, schema, configuration, added, deleted, or replaced. Each classification invalidates the smallest safe set of entities, edges, indexes, flows, tests, CPG shards, and OKF concepts.

## Immutable generations

```text
.keystone/intelligence/
├── current
└── generations/
    ├── 000042/
    └── 000043.pending/
```

The pending generation reuses unchanged shards and writes only deltas. After validation it is renamed and the current pointer is atomically switched. Queries never observe a partial generation.

## Manual deletion recovery

The intelligence root is excluded from source ingestion but monitored separately. When deleted, Keystone keeps the in-memory generation if available, marks persistence unhealthy, starts reconstruction, and republishes intelligence without requiring a reload.

## Resource awareness

Deep work may yield or reduce concurrency when CPU or memory pressure is high, the machine is on battery according to policy, builds or tests are running, or the workspace is receiving rapid changes.

## Status and telemetry

The runtime publishes local status events only:

- Current generation
- Branch and HEAD
- Pending changes
- Queue depth
- Active workers and files
- Stage progress
- Throughput
- Errors and retries
- Freshness by entity or file

No repository content is transmitted externally.
