# Keystone Local Storage Format

Keystone stores local state beneath `.keystone/`. Candidate writes use temporary locations, validation, and atomic rename/pointer promotion.

```text
.keystone/
├── state/
│   └── sdlc/
├── tasks/
├── handoffs/
├── context/
├── validation/
├── background/
└── intelligence/
    ├── summary.json
    ├── snapshot.json
    ├── manifest.json
    ├── activity.json
    ├── current.json
    ├── snapshots/<extraction-run-id>/
    ├── cpg/
    │   ├── manifest.json
    │   └── <shard>.json.gz
    ├── okf-bundle/              # Portable OKF v0.2 Markdown/YAML bundle
    │   ├── index.md
    │   ├── log.md
    │   ├── .keystone-bundle.json
    │   └── <knowledge-kind>/*.md
    └── okf/                     # Authoritative local machine snapshot
        ├── manifest.json
        ├── knowledge/
        │   ├── units.jsonl
        │   ├── relationships.jsonl
        │   ├── observations.jsonl
        │   └── evidence.jsonl
        └── projections/
            ├── graph.json
            ├── search.jsonl
            └── cpg-bindings.jsonl
```

The internal OKF snapshot is the authoritative local machine knowledge store. The sibling `okf-bundle/` directory is its validated portable OKF v0.2 projection. There is no second `.keystone/knowledge` database. Graph, search, and CPG are derived projections and shards linked through OKF identity.

Task and handoff state use versioned schemas and integrity checks. Handoff exports are redacted, checksummed, and encrypted; credentials and repository archives are excluded.
