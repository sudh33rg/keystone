# Keystone Local Intelligence Storage Format

## Principles

- Entirely local and file-backed
- No external database or graph server
- Rebuildable from repository sources
- Compressed and sharded
- Incrementally reusable
- Crash-safe through atomic writes
- Immutable generation publication
- Versioned schemas

## Default location

The default implementation uses extension-managed workspace storage. An optional user setting may export a shareable projection under `.keystone`, but generated intelligence must not be forced into source control.

Logical layout:

```text
intelligence/
├── current
├── generations/
│   └── 000042/
│       ├── manifest.json
│       ├── repository.json
│       ├── files/
│       ├── entities/
│       ├── edges/
│       ├── evidence/
│       ├── cpg/
│       ├── indexes/
│       ├── diagnostics/
│       └── okf/
└── recovery/
```

## Manifest

The generation manifest contains:

- Schema version
- Repository identity
- Workspace roots
- Branch and HEAD
- Dirty state fingerprint
- Generation number
- Status
- Creation and publication timestamps
- Ontology version
- Parser and adapter versions
- Included shard references
- Coverage and health summary

## File records

Each file record includes stable ID, relative path, language, category, analysis level, size, modification time, content hash, structural hash, generated and sensitive status, exclusion decision, adapter IDs, shard references, and last indexed generation.

## Entity and edge shards

Entities and relationships are partitioned by source file or logical module. Each shard is compressed JSON or another versioned local binary representation selected by implementation benchmarks.

Every entity contains:

- Stable ID
- Type and optional subtype
- Name and qualified name
- Source reference
- Properties
- Evidence IDs
- Confidence
- Branch and generation

Every relationship contains:

- Stable edge ID
- Source and target IDs
- Ontology relationship type
- Properties
- Derivation
- Evidence IDs
- Confidence
- Branch and generation

## Evidence shards

Evidence records contain source kind, path, line and column ranges, parser or rule identity, parser version, content hash, derivation, confidence, and statement.

## CPG shards

Fine-grained CPG shards are keyed by source hash, provider version, CPG schema version, and analysis profile. They may contain AST, CFG, data-flow, call, and slice cache data.

## Indexes

Indexes are generated local files for:

- Symbol name
- Qualified name
- Path
- Entity type
- Incoming edges
- Outgoing edges
- Route handler
- Test target
- Table access
- Configuration usage
- Documentation text
- OKF content

Indexes must be rebuildable from canonical shards.

## Atomic writing

Every file is written to a temporary path, flushed, validated, and renamed atomically. A pending generation is never exposed through `current` until all required files pass validation.

## Retention

Retain the active generation and a configurable number of previous valid generations. Old pending or failed generations are cleaned in the background. Recovery records preserve diagnostics without retaining unnecessary repository content.

## Security

Secret values are never stored. Sensitive files can be represented by sanitized metadata, variable names, and references according to policy. Absolute paths should be avoided in portable exports.

## Shareable export

OKF and optional compact semantic graph exports can be written into a user-selected directory. Exports are projections and do not replace the canonical local intelligence store.
