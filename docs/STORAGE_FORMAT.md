# Keystone Local Storage Format

Keystone stores local state beneath `.keystone/`. Candidate writes use temporary locations, validation, and atomic rename/pointer promotion.

The running extension keeps the authoritative OKF snapshot and bounded hot query/graph results in memory, invalidated by the manifest snapshot digest. Deterministic per-file language extraction is also persisted under `.keystone/cache/extractions`, keyed by normalized workspace path, content hash, and extractor version. Persisted query and graph results live under `.keystone/cache/query` and `.keystone/cache/graph`, keyed by normalized request and OKF snapshot digest. Complete context results are cached under `.keystone/context/cache`, while each materialized task persists its ordered packet manifest and payloads in `.keystone/tasks/<task>/context.json` and `context-packets.json`. Failed validation persists bounded OKF-grounded retry prompts in the task’s `correction-packets.json`. Packet retrieval and correction generation validate the task’s stored OKF snapshot digest before returning or using content. The cache-maintenance path retains recent extraction/query/graph JSON entries for 30 days and within per-family entry limits, and reports scanned/retained/removed entries.

Verified Task Handoff packages carry the active task’s bounded `correctionPackets` when present. Each packet may include `changedPaths`, `affectedPaths`, a `diffHash`, and resolution metadata; restoring a package writes those packets into the recipient task workspace so validation failures and user-approved Copilot retry context remain available without copying the repository or allowing repository-wide search. A passing impacted validation marks the latest packet resolved while retaining the historical packet for handoff/audit.

```text
.keystone/
├── state/
│   └── sdlc/
├── tasks/
├── handoffs/
├── context/
├── validation/
├── background/
├── cache/                      # Persistent extraction/query/graph caches
│   ├── extractions/            # Versioned language frontend extraction cache
│   ├── query/                  # Digest-keyed query result cache
│   └── graph/                  # Digest-keyed graph result cache
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

Background worker records are stored as `.keystone/background/<worker>.json`. A
completed, failed, cancelled, or stale record includes the worker status, worker
ID, promoted OKF snapshot digest, extraction run ID, canonical scope paths,
start/completion timestamps, duration, and (when successful) the worker result
plus its `OkfCanonicalEvidenceEnvelope`. Workers never promote intelligence or
replace the authoritative snapshot. Superseded runs are marked stale, explicit
disposal is marked cancelled, and a late old run cannot overwrite a newer
record with a different snapshot digest or newer start time. Both the coordinator
and worker-thread writers apply this guard, so a late completion or failure cannot
overwrite a newer record. A timeout or analysis error is persisted for that worker
and does not stop the other workers.

The internal OKF snapshot is the authoritative local machine knowledge store. The sibling `okf-bundle/` directory is its validated portable OKF v0.2 projection. There is no second `.keystone/knowledge` database. Graph, search, and CPG are derived projections and shards linked through OKF identity.

Task and handoff state use versioned schemas and integrity checks. Handoff exports are redacted, checksummed, and encrypted; credentials and repository archives are excluded.

## Storage Schema

### 1. Summary File

The `summary.json` file provides a high-level overview of the intelligence state.

```json
{
  "version": "2",
  "profileId": "https://keystone.local/okf/profiles/repository-intelligence/v2",
  "profileVersion": "2.1.0",
  "lastRunId": "run-123",
  "lastRunTimestamp": "2026-08-01T12:34:56Z",
  "repository": {
    "url": "https://github.com/user/repo",
    "branch": "main",
    "commit": "abc123...",
    "root": "/path/to/repo"
  },
  "knowledgeUnits": 1234,
  "relationships": 567,
  "observations": 89,
  "evidence": 234,
  "languages": 7,
  "filesIndexed": 5205,
  "status": "active",
  "lastUpdated": "2026-08-01T12:34:56Z"
}
```

**Summary Fields**:

- `version`: OKF format version (required)
- `profileId`: ID of the OKF profile (required)
- `profileVersion`: Version of the OKF profile (required)
- `lastRunId`: ID of the last extraction run (required)
- `lastRunTimestamp`: Timestamp of the last extraction run (required)
- `repository`: Repository metadata (required)
  - `url`: Repository URL
  - `branch`: Current branch
  - `commit`: Current commit hash
  - `root`: Repository root path
- `knowledgeUnits`: Number of knowledge units (required)
- `relationships`: Number of relationships (required)
- `observations`: Number of observations (required)
- `evidence`: Number of evidence items (required)
- `languages`: Number of languages processed (required)
- `filesIndexed`: Total number of files indexed (required)
- `status`: Current status (active, inactive, error) (required)
- `lastUpdated`: Last time the summary was updated (required)

### 2. Snapshot File

The `snapshot.json` file contains the latest promoted OKF snapshot.

```json
{
  "version": "2",
  "profileId": "https://keystone.local/okf/profiles/repository-intelligence/v2",
  "profileVersion": "2.1.0",
  "runId": "run-123",
  "timestamp": "2026-08-01T12:34:56Z",
  "repository": {
    "url": "https://github.com/user/repo",
    "branch": "main",
    "commit": "abc123...",
    "root": "/path/to/repo"
  },
  "extractors": [
    {
      "name": "typescript-compiler",
      "version": "4.9.5",
      "capabilities": [
        "parsing",
        "symbols",
        "imports",
        "calls",
        "controlFlow",
        "dataFlow",
        "cpg",
        "tests"
      ]
    }
  ],
  "knowledgeUnits": 1234,
  "relationships": 567,
  "observations": 89,
  "evidence": 234,
  "digest": "sha256:jkl012...",
  "parentRunId": "run-122",
  "status": "promoted",
  "units": [
    {
      "id": "repo:file:src/core/intelligence/okf/profile.ts:123",
      "type": "file",
      "name": "profile.ts",
      "path": "src/core/intelligence/okf/profile.ts",
      "language": "typescript",
      "contentHash": "sha256:abc123...",
      "structuralHash": "sha256:def456...",
      "size": 1234,
      "lines": 45,
      "created": "2026-08-01T12:34:56Z",
      "modified": "2026-08-01T12:34:56Z",
      "firstSeenAt": "2026-08-01T12:34:56Z",
      "lastSeenAt": "2026-08-01T12:34:56Z",
      "status": "active",
      "extractor": "typescript-compiler",
      "extractorVersion": "4.9.5",
      "runId": "run-123",
      "evidence": ["evidence:123", "evidence:456"],
      "metadata": {
        "importedFrom": "github.com/user/repo",
        "author": "John Doe",
        "tags": ["core", "intelligence"]
      }
    }
  ],
  "relationships": [
    {
      "id": "relationship:123",
      "type": "contains",
      "source": "repo:file:src/core/intelligence/okf/profile.ts:123",
      "target": "repo:module:src/core/intelligence/okf",
      "confidence": 0.98,
      "level": "high",
      "extractor": "typescript-compiler",
      "extractorVersion": "4.9.5",
      "runId": "run-123",
      "evidence": ["evidence:789"],
      "metadata": {
        "line": 42,
        "column": 15,
        "source": "import { Profile } from './profile.ts';"
      }
    }
  ],
  "observations": [
    {
      "id": "observation:123",
      "type": "security-risk",
      "subject": "repo:file:src/core/intelligence/okf/profile.ts:123",
      "value": "uses deprecated API",
      "confidence": 0.95,
      "level": "high",
      "extractor": "security-analyzer",
      "extractorVersion": "1.2.0",
      "runId": "run-123",
      "evidence": ["evidence:101"],
      "metadata": {
        "issue": "DEP001",
        "recommendation": "Use new API",
        "link": "https://example.com/deprecation"
      }
    }
  ],
  "evidence": [
    {
      "id": "evidence:123",
      "type": "source-code",
      "source": "file:src/core/intelligence/okf/profile.ts",
      "range": {
        "start": {
          "line": 42,
          "column": 15
        },
        "end": {
          "line": 43,
          "column": 20
        }
      },
      "content": "import { Profile } from './profile.ts';",
      "hash": "sha256:ghi789...",
      "extractor": "typescript-compiler",
      "extractorVersion": "4.9.5",
      "runId": "run-123",
      "metadata": {
        "comment": "This import is used for the OKF profile",
        "author": "John Doe",
        "timestamp": "2026-08-01T12:34:56Z"
      }
    }
  ]
}
```

**Snapshot Fields**:

- `version`: OKF format version (required)
- `profileId`: ID of the OKF profile (required)
- `profileVersion`: Version of the OKF profile (required)
- `runId`: ID of the extraction run (required)
- `timestamp`: Timestamp of the extraction run (required)
- `repository`: Repository metadata (required)
  - `url`: Repository URL
  - `branch`: Current branch
  - `commit`: Current commit hash
  - `root`: Repository root path
- `extractors`: Array of extractors used (required)
  - `name`: Extractor name (required)
  - `version`: Extractor version (required)
  - `capabilities`: Array of capabilities (required)
- `knowledgeUnits`: Number of knowledge units (required)
- `relationships`: Number of relationships (required)
- `observations`: Number of observations (required)
- `evidence`: Number of evidence items (required)
- `digest`: SHA-256 digest of the snapshot (required)
- `parentRunId`: ID of the previous extraction run (optional)
- `status`: Status of the snapshot (promoted, candidate, deprecated) (required)
- `units`: Array of knowledge units (required)
- `relationships`: Array of relationships (required)
- `observations`: Array of observations (required)
- `evidence`: Array of evidence items (required)

### 3. Manifest File

The `manifest.json` file contains metadata about the OKF snapshot.

```json
{
  "version": "2",
  "profileId": "https://keystone.local/okf/profiles/repository-intelligence/v2",
  "profileVersion": "2.1.0",
  "runId": "run-123",
  "timestamp": "2026-08-01T12:34:56Z",
  "repository": {
    "url": "https://github.com/user/repo",
    "branch": "main",
    "commit": "abc123...",
    "root": "/path/to/repo"
  },
  "extractors": [
    {
      "name": "typescript-compiler",
      "version": "4.9.5",
      "capabilities": [
        "parsing",
        "symbols",
        "imports",
        "calls",
        "controlFlow",
        "dataFlow",
        "cpg",
        "tests"
      ]
    }
  ],
  "knowledgeUnits": 1234,
  "relationships": 567,
  "observations": 89,
  "evidence": 234,
  "digest": "sha256:jkl012...",
  "parentRunId": "run-122",
  "status": "promoted"
}
```

**Manifest Fields**:

- `version`: OKF format version (required)
- `profileId`: ID of the OKF profile (required)
- `profileVersion`: Version of the OKF profile (required)
- `runId`: ID of the extraction run (required)
- `timestamp`: Timestamp of the extraction run (required)
- `repository`: Repository metadata (required)
  - `url`: Repository URL
  - `branch`: Current branch
  - `commit`: Current commit hash
  - `root`: Repository root path
- `extractors`: Array of extractors used (required)
  - `name`: Extractor name (required)
  - `version`: Extractor version (required)
  - `capabilities`: Array of capabilities (required)
- `knowledgeUnits`: Number of knowledge units (required)
- `relationships`: Number of relationships (required)
- `observations`: Number of observations (required)
- `evidence`: Number of evidence items (required)
- `digest`: SHA-256 digest of the OKF snapshot (required)
- `parentRunId`: ID of the previous extraction run (optional)
- `status`: Status of the snapshot (promoted, candidate, deprecated) (required)

### 4. Activity File

The `activity.json` file logs all extraction activities.

```json
[
  {
    "id": "activity:123",
    "type": "extraction",
    "timestamp": "2026-08-01T12:34:56Z",
    "runId": "run-123",
    "status": "started",
    "repository": {
      "url": "https://github.com/user/repo",
      "branch": "main",
      "commit": "abc123...",
      "root": "/path/to/repo"
    },
    "details": {
      "filesDiscovered": 5205,
      "languages": 7,
      "extractors": ["typescript-compiler", "java-compiler"]
    }
  },
  {
    "id": "activity:124",
    "type": "extraction",
    "timestamp": "2026-08-01T12:45:30Z",
    "runId": "run-123",
    "status": "completed",
    "repository": {
      "url": "https://github.com/user/repo",
      "branch": "main",
      "commit": "abc123...",
      "root": "/path/to/repo"
    },
    "details": {
      "filesIndexed": 5205,
      "knowledgeUnits": 1234,
      "relationships": 567,
      "observations": 89,
      "evidence": 234,
      "duration": 123456
    }
  },
  {
    "id": "activity:125",
    "type": "snapshot",
    "timestamp": "2026-08-01T12:46:10Z",
    "runId": "run-123",
    "status": "promoted",
    "repository": {
      "url": "https://github.com/user/repo",
      "branch": "main",
      "commit": "abc123...",
      "root": "/path/to/repo"
    },
    "details": {
      "previousRunId": "run-122",
      "digest": "sha256:jkl012..."
    }
  }
]
```

**Activity Fields**:

- `id`: Unique identifier for the activity (required)
- `type`: Type of activity (extraction, snapshot, validation, etc.) (required)
- `timestamp`: Timestamp of the activity (required)
- `runId`: ID of the extraction run (required)
- `status`: Status of the activity (started, completed, failed, promoted, etc.) (required)
- `repository`: Repository metadata (required)
  - `url`: Repository URL
  - `branch`: Current branch
  - `commit`: Current commit hash
  - `root`: Repository root path
- `details`: Activity-specific details (required)

### 5. Current File

The `current.json` file points to the currently promoted snapshot.

```json
{
  "runId": "run-123",
  "timestamp": "2026-08-01T12:34:56Z",
  "digest": "sha256:jkl012...",
  "status": "promoted"
}
```

**Current Fields**:

- `runId`: ID of the currently promoted snapshot (required)
- `timestamp`: Timestamp of the currently promoted snapshot (required)
- `digest`: SHA-256 digest of the currently promoted snapshot (required)
- `status`: Status of the currently promoted snapshot (required)

### 6. Snapshots Directory

The `snapshots/` directory contains all past snapshots.

```text
snapshots/
├── run-122/
│   ├── snapshot.json
│   ├── manifest.json
│   ├── activity.json
│   ├── summary.json
│   └── okf/
│       ├── manifest.json
│       ├── knowledge/
│       │   ├── units.jsonl
│       │   ├── relationships.jsonl
│       │   ├── observations.jsonl
│       │   └── evidence.jsonl
│       └── projections/
│           ├── graph.json
│           ├── search.jsonl
│           └── cpg-bindings.jsonl
├── run-123/
│   ├── snapshot.json
│   ├── manifest.json
│   ├── activity.json
│   ├── summary.json
│   └── okf/
│       ├── manifest.json
│       ├── knowledge/
│       │   ├── units.jsonl
│       │   ├── relationships.jsonl
│       │   ├── observations.jsonl
│       │   └── evidence.jsonl
│       └── projections/
│           ├── graph.json
│           ├── search.jsonl
│           └── cpg-bindings.jsonl
└── run-124/
    ├── snapshot.json
    ├── manifest.json
    ├── activity.json
    ├── summary.json
    └── okf/
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

**Snapshot Directory Structure**:

- `snapshot.json`: The complete OKF snapshot
- `manifest.json`: Metadata about the snapshot
- `activity.json`: Activity log for the snapshot
- `summary.json`: Summary of the snapshot
- `okf/`: The OKF data (see below)
- `projections/`: The projections (see below)

### 7. OKF Directory

The `okf/` directory contains the authoritative local machine snapshot in JSONL format.

```text
okf/
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

**OKF Directory Structure**:

- `manifest.json`: Metadata about the OKF snapshot
- `knowledge/`: Knowledge units, relationships, observations, and evidence
  - `units.jsonl`: Knowledge units (JSONL format)
  - `relationships.jsonl`: Relationships (JSONL format)
  - `observations.jsonl`: Observations (JSONL format)
  - `evidence.jsonl`: Evidence (JSONL format)
- `projections/`: Graph, search, and CPG projections
  - `graph.json`: Knowledge graph
  - `search.jsonl`: Search index (JSONL format)
  - `cpg-bindings.jsonl`: CPG bindings (JSONL format)

### 8. CPG Directory

The `cpg/` directory contains the Code Property Graph shards.

```text
cpg/
├── manifest.json
└── <shard>.json.gz
```

**CPG Directory Structure**:

- `manifest.json`: Metadata about the CPG shards
- `<shard>.json.gz`: Compressed CPG shards (one per artifact)

### 9. CPG Shard Format

Each CPG shard is a compressed JSON file containing the CPG for a single artifact.

```json
{
  "artifactId": "repo:file:src/core/intelligence/okf/profile.ts:123",
  "nodes": [
    {
      "id": "node:123",
      "type": "identifier",
      "location": {
        "path": "src/core/intelligence/okf/profile.ts",
        "line": 1,
        "column": 1
      },
      "content": "export interface Profile",
      "okfId": "repo:file:src/core/intelligence/okf/profile.ts:123",
      "attributes": {
        "name": "Profile",
        "type": "interface"
      }
    }
  ],
  "edges": [
    {
      "id": "edge:456",
      "type": "ast",
      "source": "node:123",
      "target": "node:789",
      "location": {
        "path": "src/core/intelligence/okf/profile.ts",
        "line": 1,
        "column": 1
      },
      "attributes": {}
    }
  ]
}
```

**CPG Shard Fields**:

- `artifactId`: ID of the artifact this shard represents (required)
- `nodes`: Array of CPG nodes (required)
  - `id`: Unique identifier for the node (required)
  - `type`: Type of node (identifier, expression, statement, declaration, type, literal) (required)
  - `location`: Location of the node in the source code (required)
    - `path`: File path (required)
    - `line`: Line number (required)
    - `column`: Column number (required)
  - `content`: The source code content of the node (required)
  - `okfId`: ID of the corresponding OKF knowledge unit (required)
  - `attributes`: Additional attributes about the node (optional)
- `edges`: Array of CPG edges (required)
  - `id`: Unique identifier for the edge (required)
  - `type`: Type of edge (AST, data-flow, control-flow, call, dependency) (required)
  - `source`: ID of the source node (required)
  - `target`: ID of the target node (required)
  - `location`: Location of the edge in the source code (required)
    - `path`: File path (required)
    - `line`: Line number (required)
    - `column`: Column number (required)
  - `attributes`: Additional attributes about the edge (optional)

### 10. OKF Bundle

The `okf-bundle/` directory contains the portable OKF v0.2 Markdown/YAML bundle.

```text
okf-bundle/
├── index.md
├── log.md
├── .keystone-bundle.json
└── <knowledge-kind>/*.md
```

**OKF Bundle Structure**:

- `index.md`: Main index file with all knowledge units and relationships
- `log.md`: Date-ordered log of changes
- `.keystone-bundle.json`: Bundle metadata
- `<knowledge-kind>/*.md`: Individual knowledge unit files

### 11. Atomic Promotion Mechanism

Keystone employs an atomic promotion mechanism to ensure data integrity:

1. **Candidate Generation**: Extractors produce candidate knowledge units, relationships, and observations
2. **Temporary Storage**: Candidate data is written to temporary files in `.keystone/intelligence/candidate/`
3. **Validation**: The candidate data is validated against the OKF schema
4. **Consistency Check**: The system checks for consistency between knowledge units, relationships, and observations
5. **Digest Generation**: A SHA-256 digest of the candidate data is generated
6. **Atomic Promotion**: If validation passes:
   - The candidate data is atomically renamed to replace the current data
   - The manifest and summary files are updated
   - The current pointer is updated
   - The previous snapshot is archived
7. **Projection Regeneration**: Graph, search, and CPG projections are regenerated from the promoted snapshot
8. **UI Update**: UI surfaces are updated with the new intelligence

This process ensures that:

- The system always has a valid, consistent state
- No partial or invalid snapshots can be promoted
- All projections are generated from a consistent snapshot
- Previous snapshots are preserved for audit and rollback

### 12. CPG Shard Generation

CPG shards are generated from the OKF snapshot:

1. **Artifact Identification**: Identify all artifacts that need CPG shards
2. **Language Detection**: Determine the language of each artifact
3. **Parsing**: Parse the artifact using the appropriate language parser
4. **AST Generation**: Generate an abstract syntax tree
5. **Semantic Analysis**: Perform semantic analysis to identify relationships
6. **Node Creation**: Create CPG nodes for each AST node
7. **Edge Creation**: Create CPG edges based on AST structure and semantic analysis
8. **OKF Binding**: Bind CPG nodes to OKF knowledge units
9. **Shard Generation**: Create a shard for each artifact
10. **Compression**: Compress the shard using gzip
11. **Indexing**: Index the shard for fast querying

### 13. OKF Bundle Generation

The OKF v0.2 bundle is generated from the promoted OKF snapshot:

1. **Knowledge Unit Conversion**: Each knowledge unit is converted to a Markdown file with YAML frontmatter
2. **Relationship Conversion**: Each relationship is converted to a link between Markdown files
3. **Observation Conversion**: Each observation is converted to a comment in the relevant Markdown file
4. **Evidence Conversion**: Each evidence item is converted to a footnote in the relevant Markdown file
5. **Index Generation**: An index.md file is generated with all knowledge units and relationships
6. **Log Generation**: A log.md file is generated with date-ordered entries of changes
7. **Bundle Validation**: The bundle is validated against the OKF v0.2 specification
8. **Digest Generation**: A digest of the bundle is generated

The bundle is designed to be human-readable and portable, allowing the repository intelligence to be shared and reviewed outside of Keystone.

### 14. Integrity and Validation

Keystone employs a comprehensive integrity and validation system:

1. **File Integrity**: SHA-256 digests are calculated for all files
2. **Data Integrity**: All data is validated against the OKF schema
3. **Consistency Validation**: Relationships and observations are validated against knowledge units
4. **Snapshot Validation**: Snapshots are validated before promotion
5. **Bundle Validation**: OKF bundles are validated before export
6. **Projections Validation**: Projections are validated against the OKF snapshot

Validation failures result in:

- Rejection of the candidate snapshot
- Retention of the previous known-good snapshot
- Logging of the validation errors
- Notification to the user

### 15. Storage Optimization

Keystone employs several optimization techniques:

1. **Compression**: CPG shards are compressed using gzip
2. **Indexing**: Projections are indexed for fast querying
3. **Caching**: Frequently accessed data is cached in memory
4. **Incremental Updates**: Only changed data is processed
5. **Batch Processing**: Operations are batched for efficiency
6. **Memory Management**: Memory usage is monitored and optimized

These optimizations ensure that Keystone can handle large repositories efficiently while maintaining fast response times.

### 16. Backup and Recovery

Keystone provides backup and recovery capabilities:

1. **Automatic Backups**: Snapshots are automatically backed up
2. **Manual Backups**: Users can create manual backups
3. **Restore**: Previous snapshots can be restored
4. **Recovery**: The system can recover from corruption

Backup and recovery ensure that:

- Data is not lost
- Previous states can be recovered
- The system is resilient to failures

### 17. Performance Monitoring

Keystone monitors storage performance:

1. **Disk Usage**: Monitors disk space usage
2. **I/O Performance**: Monitors read/write performance
3. **Query Performance**: Monitors query response times
4. **Memory Usage**: Monitors memory usage

Performance monitoring ensures that:

- The system remains responsive
- Bottlenecks are identified
- Optimization opportunities are identified

The storage format is designed to be:

- **Robust**: Resilient to failures and corruption
- **Scalable**: Can handle repositories of any size
- **Efficient**: Minimizes storage and processing requirements
- **Extensible**: Can be extended with new data types and formats
- **Transparent**: All data is documented and accessible
- **Portable**: Data can be shared and reviewed outside of Keystone

This comprehensive storage format ensures that Keystone's intelligence is persistent, consistent, and available for all UI surfaces.
