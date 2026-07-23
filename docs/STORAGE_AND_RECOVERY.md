# Keystone Storage, Recovery, and Migration

This document describes the local storage layout used by Keystone and the guarantees
it provides. Keystone is **local-first**: all state lives under the repository's
`.keystone/` directory (or the extension's workspace storage when no repository is
open). There is no external database and no remote synchronization.

## 1. Storage layout

All per-repository state is written under:

```
<repository-root>/.keystone/
  state/            bounded JSON records, one file per domain
    workspace.json
    workflow.json
    development.json
    context.json
    execution.json
    execution-profile.json
    delegation.json
    review.json
    pr-review.json
    handoff.json
    delivery.json
    orchestration.json
    copilot-integration.json
    intelligence/     graph, entities, relationships, evidence (sharded)
      snapshot.json
      entities/
      relationships/
      cpg-shards/     CpgShardStore — bounded graph shards
  retired-roadmap-*/ archived obsolete state (created by ScopeCorrectionMigration)
```

Each domain record is a **bounded, independently versioned JSON file**. Keystone does
**not** store all state in one unbounded JSON file.

## 2. Schema and record versioning

- Every persisted record carries a `schemaVersion` literal (e.g.
  `CANONICAL_WORKFLOW_SCHEMA_VERSION`, `HANDOFF_SCHEMA_VERSION`,
  `BUILD_SCHEMA_VERSION`).
- `IntelligenceStore` and `HandoffPersistenceStore` validate `schemaVersion` on read.
- Unknown or newer schema versions are reported as diagnostics and, where safe, opened
  read-only — they are never silently discarded.

## 3. Atomic writes

`AtomicFileWriter` guarantees recoverable writes:

1. Serialize to a temporary file `<path>.<uuid>.pending` (mode `0o600`).
2. `fsync` the temp file.
3. `rename` the temp file over the target (atomic on POSIX/Windows).
4. `fsync` the directory.
5. On any failure, remove the temp file and surface a structured
   `INTELLIGENCE_ATOMIC_WRITE_FAILED` error (recoverable, retryable) — the original
   file is never partially overwritten.

## 4. Write queue and interruption

- Writes are single-threaded per store; a crashed or interrupted write leaves only the
  `.pending` temp file, which is removed on the next attempt.
- Extension deactivation flushes valid pending persistence and does **not** start new
  writes. Interrupted operations do not auto-restart.

## 5. Corruption isolation and recovery

When a record is malformed on read:

- The affected record is isolated; unaffected records load normally.
- A useful diagnostic is shown (file, schema version, validation code).
- The user may export a redacted recovery report and reset the affected bounded area.
- Data is never silently deleted and the whole extension is never reset unless the
  user explicitly chooses it.

Examples handled: corrupted workflow record, corrupted context package, corrupted
handoff record, corrupted intelligence index metadata, corrupted activity record.

## 6. Migration registry

Migrations are explicit and deterministic:

- `WorkflowMigration` — maps the legacy `DevelopmentWorkflowSnapshot` model to the
  current canonical `Workflow` model, generating stable stage ids per work type.
  Includes validation and a deterministic mapping table.
- `ScopeCorrectionMigration` — archives obsolete state directories
  (`hub`, `local-models`) into `retired-roadmap-*` without touching workflow or
  Intelligence data; reports archived paths and diagnostics.

Each migration:

- declares source and destination versions,
- applies a pure, deterministic transform,
- validates the result against the target schema,
- preserves the original data until the new record is successfully committed,
- surfaces diagnostics on failure and never silently drops unsupported records.

When a future (newer) schema version is detected, Keystone reports:

> This data was created by a newer Keystone version and cannot be modified safely.

and allows read-only inspection where the record shape permits it.

## 7. Backup and cleanup

- `ScopeCorrectionMigration` preserves original obsolete directories by renaming (not
  deleting) them.
- Temporary `.pending` files are cleaned on write failure and on startup.
- Size is bounded by domain: graph data is sharded (`CpgShardStore`); intelligence
  evidence is paginated; activity history is capped.

## 8. Retention and limits

- No automatic upload or expiry of local records.
- Large inputs (e.g. oversized context packages, very large repositories) are rejected
  with a clear error rather than unbounded growth.
- File contents are not permanently cached without limits; graph slices are released
  after use.

## 9. What is NOT stored

No source-code contents, instruction contents, context-package contents, prompts, test
logs, credentials, tokens, environment-secret values, absolute user-home paths, or
personal identifiers are written to diagnostics or recovery reports.
