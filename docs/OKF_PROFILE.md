# Keystone OKF Profile

OKF is the authoritative knowledge contract inside the Keystone Intelligence Layer. Extractors produce canonical repository facts; Keystone validates and promotes an OKF snapshot; graph, search, CPG, impact, compression, and UI views derive from that snapshot.

## Identity

- Profile ID: `https://keystone.local/okf/profiles/repository-intelligence/v2`
- Profile version: `2.0.0`
- Format: `keystone-okf`
- Format version: `2`
- Source of truth: `src/core/intelligence/okf/`

The profile digest is generated from the executable profile definition and stored in every manifest.

## Portable Open Knowledge Format bundle

Keystone also exports the promoted machine snapshot as an interoperable **OKF v0.2** bundle under `.keystone/intelligence/okf-bundle/`. The bundle is separate from the internal JSONL profile and follows the current public OKF conventions:

- one UTF-8 Markdown concept per active knowledge unit;
- YAML frontmatter with required `type`;
- bundle-root `index.md` declaring `okf_version: "0.2"`;
- `generated` and machine `verified` actor records;
- `status` lifecycle metadata;
- `sources` entries with stable IDs, resources, authors, and modification dates;
- claim-level Markdown footnotes keyed to `sources[].id`;
- standard Markdown links between concepts;
- date-grouped `log.md`;
- deterministic bundle digest and validation before atomic promotion.

The public OKF bundle is the portable exchange surface. Keystone's internal `keystone-okf` JSONL snapshot remains the richer authoritative local machine index from which graph, search, CPG, impact, context, and UI projections are derived.

## Schema Documentation

The OKF profile defines a structured data format for representing repository intelligence. The schema consists of four main components:

### 1. Knowledge Units

Knowledge units represent the fundamental entities in the repository. Each unit has a unique ID and represents a single concept from the codebase.

```json
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
```

**Knowledge Unit Fields**:

- `id`: Unique identifier for the knowledge unit (required)
- `type`: Type of knowledge unit (file, module, package, service, symbol, api, data-entity, configuration, test, documentation, call-flow, data-flow, architecture-boundary, risk-area, change-impact) (required)
- `name`: Name of the unit (required for most types)
- `path`: File system path to the unit (required for file types)
- `language`: Programming language of the unit (optional)
- `contentHash`: SHA-256 hash of the file content (required for files)
- `structuralHash`: SHA-256 hash of the structural representation (required for files)
- `size`: File size in bytes (required for files)
- `lines`: Number of lines in the file (required for files)
- `created`: Creation timestamp (optional)
- `modified`: Last modification timestamp (required)
- `firstSeenAt`: First time this unit was discovered (required)
- `lastSeenAt`: Last time this unit was observed (required)
- `status`: Lifecycle status (active, deprecated, deleted) (required)
- `extractor`: Name of the extractor that produced this unit (required)
- `extractorVersion`: Version of the extractor (required)
- `runId`: ID of the extraction run that produced this unit (required)
- `evidence`: Array of evidence IDs that support this unit (optional)
- `metadata`: Additional metadata about the unit (optional)

### 2. Typed Directional Relationships

Relationships represent connections between knowledge units. Each relationship has a source, target, and type.

```json
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
```

**Relationship Fields**:

- `id`: Unique identifier for the relationship (required)
- `type`: Type of relationship (contains, defines, imports, depends-on, calls, reads, writes, exposes, implements, extends, tests, covers, configured-by, documented-by, flows-to, may-impact) (required)
- `source`: ID of the source knowledge unit (required)
- `target`: ID of the target knowledge unit (required)
- `confidence`: Confidence score (0.0-1.0) (required)
- `level`: Confidence level (low, medium, high, critical) (required)
- `extractor`: Name of the extractor that produced this relationship (required)
- `extractorVersion`: Version of the extractor (required)
- `runId`: ID of the extraction run that produced this relationship (required)
- `evidence`: Array of evidence IDs that support this relationship (optional)
- `metadata`: Additional metadata about the relationship (optional)

### 3. Namespaced Observations

Observations represent facts about knowledge units or relationships that are not direct relationships between units.

```json
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
```

**Observation Fields**:

- `id`: Unique identifier for the observation (required)
- `type`: Type of observation (security-risk, performance-issue, modernization-opportunity, code-smell, test-coverage, documentation-missing, etc.) (required)
- `subject`: ID of the subject unit or relationship (required)
- `value`: The observation value (required)
- `confidence`: Confidence score (0.0-1.0) (required)
- `level`: Confidence level (low, medium, high, critical) (required)
- `extractor`: Name of the extractor that produced this observation (required)
- `extractorVersion`: Version of the extractor (required)
- `runId`: ID of the extraction run that produced this observation (required)
- `evidence`: Array of evidence IDs that support this observation (optional)
- `metadata`: Additional metadata about the observation (optional)

### 4. Source Evidence

Source evidence represents the original source data that was used to generate knowledge units, relationships, and observations.

```json
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
```

**Evidence Fields**:

- `id`: Unique identifier for the evidence (required)
- `type`: Type of evidence (source-code, comment, documentation, test, configuration, etc.) (required)
- `source`: Source path (required)
- `range`: Source code range (optional)
- `content`: The evidence content (required for source code)
- `hash`: SHA-256 hash of the evidence content (required)
- `extractor`: Name of the extractor that produced this evidence (required)
- `extractorVersion`: Version of the extractor (required)
- `runId`: ID of the extraction run that produced this evidence (required)
- `metadata`: Additional metadata about the evidence (optional)

### 5. Extraction and Snapshot Manifest

The manifest contains metadata about the extraction run and the OKF snapshot.

```json
{
  "version": "2",
  "profileId": "https://keystone.local/okf/profiles/repository-intelligence/v2",
  "profileVersion": "2.0.0",
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
- `status`: Status of the snapshot (candidate, promoted, deprecated) (required)

## Knowledge Kinds

- `repository`: Represents the entire repository
- `workspace`: Represents the workspace context
- `file`: Represents a source code or configuration file
- `module`: Represents a module or package
- `package`: Represents a package or library
- `service`: Represents a service or component
- `symbol`: Represents a programming symbol (class, function, variable, etc.)
- `api`: Represents an API endpoint or interface
- `data-entity`: Represents a data entity or model
- `configuration`: Represents a configuration file or setting
- `test`: Represents a test case or test suite
- `documentation`: Represents documentation
- `call-flow`: Represents a call flow or execution path
- `data-flow`: Represents a data flow or data dependency
- `architecture-boundary`: Represents an architectural boundary or layer
- `risk-area`: Represents a potential risk area
- `change-impact`: Represents the impact of a change
- `dependency`: Represents a dependency relationship

## Relationship Kinds

- `contains`: Indicates containment relationship (e.g., file contained in module)
- `defines`: Indicates definition relationship (e.g., symbol defined in file)
- `imports`: Indicates import relationship (e.g., module imports another)
- `depends-on`: Indicates dependency relationship (e.g., module depends on library)
- `calls`: Indicates call relationship (e.g., function calls another)
- `reads`: Indicates read relationship (e.g., function reads variable)
- `writes`: Indicates write relationship (e.g., function writes variable)
- `exposes`: Indicates exposure relationship (e.g., module exposes API)
- `implements`: Indicates implementation relationship (e.g., class implements interface)
- `extends`: Indicates inheritance relationship (e.g., class extends another)
- `tests`: Indicates test relationship (e.g., test tests function)
- `covers`: Indicates coverage relationship (e.g., test covers function)
- `configured-by`: Indicates configuration relationship (e.g., service configured by file)
- `documented-by`: Indicates documentation relationship (e.g., API documented by file)
- `flows-to`: Indicates flow relationship (e.g., data flows to function)
- `may-impact`: Indicates potential impact relationship (e.g., change may impact function)

## Required Semantics

- Stable workspace-scoped canonical IDs
- Canonical-key uniqueness
- Source/target constraints for typed relationships
- Confidence score and level
- Extraction run, extractor, version, repository revision, and evidence IDs
- Source path, range, digest, method, rule, observed time, and freshness
- `firstSeenAt`, `lastSeenAt`, and lifecycle (`active`, `deprecated`, `deleted`)
- Parent extraction run and archived prior snapshot
- Record digests and manifest counts
- Candidate validation before atomic promotion

## Validation

The validator checks profile/version identity, mandatory fields, canonical-key uniqueness, ID uniqueness, timestamp and confidence validity, evidence/provenance integrity, observation predicates/value types, relationship endpoint existence, semantic source/target constraints, workspace/extraction consistency, manifest counts, and record digests.

All 17 knowledge kinds and all 16 relationship kinds are produced by the executable OKF acceptance fixture. Observations and evidence are non-empty, and deletion creates stable-ID tombstones with stale historical evidence.

## Validation Process

The OKF validation process is a multi-stage process that ensures the integrity and correctness of the knowledge snapshot:

1. **Format Validation**: Validates the JSON structure and required fields
2. **Identity Validation**: Validates profile ID and version
3. **ID Uniqueness Validation**: Ensures all IDs are unique within the snapshot
4. **Canonical-key Validation**: Ensures canonical keys are unique and properly formatted
5. **Relationship Validation**: Validates source and target IDs exist and are valid types
6. **Evidence Validation**: Validates that all evidence references exist
7. **Confidence Validation**: Validates confidence scores are between 0.0 and 1.0
8. **Lifcycle Validation**: Validates status values are valid
9. **Manifest Validation**: Validates manifest fields and counts
10. **Digest Validation**: Validates that the snapshot digest matches the content
11. **Consistency Validation**: Validates relationships and observations are consistent with knowledge units
12. **Completeness Validation**: Ensures all required knowledge kinds and relationships are present

Validation failures result in the snapshot being rejected and the system falling back to the previous known-good snapshot. Validation is performed before any atomic promotion of the snapshot.

## Promotional Process

The OKF snapshot promotion process ensures data integrity:

1. **Candidate Generation**: Extractors produce candidate knowledge units, relationships, and observations
2. **Validation**: The candidate snapshot is validated
3. **Atomic Promotion**: If validation passes, the candidate snapshot is atomically promoted
4. **Projection Generation**: Graph, search, and CPG projections are regenerated from the promoted snapshot
5. **UI Update**: UI surfaces are updated with the new intelligence
6. **Previous Snapshot Archiving**: The previous snapshot is archived for reference

This process ensures that:

- The system always has a valid, consistent state
- No partial or invalid snapshots can be promoted
- All projections are generated from a consistent snapshot
- Previous snapshots are preserved for audit and rollback

## OKF Bundle Generation

The OKF v0.2 bundle is generated from the promoted OKF snapshot:

1. **Knowledge Unit Conversion**: Each knowledge unit is converted to a Markdown file with YAML frontmatter
2. **Relationship Conversion**: Each relationship is converted to a link between Markdown files
3. **Observation Conversion**: Each observation is converted to a comment in the relevant Markdown file
4. **Evidence Conversion**: Each evidence item is converted to a footnote in the relevant Markdown file
5. **Index Generation**: An index.md file is generated with all knowledge units and relationships
6. **Log Generation**: A log.md file is generated with date-ordered entries of changes
7. **Bundle Validation**: The bundle is validated against the OKF v0.2 specification
8. **Digest Generation**: A digest of the bundle is generated

The bundle is stored in `.keystone/intelligence/okf-bundle/` and contains:

- index.md: Main index file with all knowledge units
- log.md: Date-ordered log of changes
- <knowledge-kind>/*.md: Individual knowledge unit files
- .keystone-bundle.json: Bundle metadata

The bundle is designed to be human-readable and portable, allowing the repository intelligence to be shared and reviewed outside of Keystone.
