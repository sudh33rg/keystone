# Keystone OKF Profile

OKF is the authoritative knowledge contract inside the Keystone Intelligence Layer. Extractors produce canonical repository facts; Keystone validates and promotes an OKF snapshot; graph, search, CPG bindings, impact, compression, and UI views derive from that snapshot.

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

## Record classes

1. Knowledge units
2. Typed directional relationships
3. Namespaced observations
4. Source evidence
5. Extraction and snapshot manifest

## Knowledge kinds

`repository`, `workspace`, `file`, `module`, `package`, `service`, `symbol`, `api`, `data-entity`, `configuration`, `test`, `documentation`, `call-flow`, `data-flow`, `architecture-boundary`, `risk-area`, `change-impact`.

## Relationship kinds

`contains`, `defines`, `imports`, `depends-on`, `calls`, `reads`, `writes`, `exposes`, `implements`, `extends`, `tests`, `covers`, `configured-by`, `documented-by`, `flows-to`, `may-impact`.

## Required semantics

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
