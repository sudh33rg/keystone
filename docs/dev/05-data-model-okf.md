# 05 — The OKF Data Model (canonical)

**OKF = Open Knowledge Format**, Keystone's local profile of it. This is the
single canonical persisted representation of everything Keystone knows about a
repository. Everything the UI shows and everything the context builder retrieves
is either OKF or derived from OKF.

Source of truth: `src/core/intelligence/okf/`.

---

## Identity constants

Defined in `okf/types.ts`:

| Constant | Value |
|---|---|
| `KEYSTONE_OKF_PROFILE_ID` | `"keystone.okf.repository-intelligence"` |
| `KEYSTONE_OKF_PROFILE_VERSION` | `"1.0.0"` |
| `manifest.format` | `"keystone-okf"` |
| `manifest.formatVersion` | `2` |
| `KEYSTONE_OKF_PROFILE_DIGEST` | sha256 of the frozen profile object, computed at module load (`profile.ts`) |

**⚠️ The profile digest is a hard gate.** `validateOkfSnapshot()` rejects any
snapshot whose `manifest.profileDigest` differs from the digest computed from the
current in-code profile (`validation.ts:59`). Serialization calls validation and
**throws** on failure (`serialization.ts:16`).

**Consequence:** if you add or remove a unit kind, a relationship kind, or a
required field in `profile.ts`, the digest changes and **every previously
persisted snapshot becomes unreadable/invalid**. That is intentional — it forces
a rebuild rather than silently mixing schema versions. Plan for it: any profile
change is a breaking change requiring a full re-index.

---

## The four record types

An OKF snapshot (`KeystoneOkfSnapshot`, `types.ts:168`) is:

```ts
{
  manifest:      KeystoneOkfManifest
  units:         KeystoneKnowledgeUnit[]           // the nouns
  relationships: KeystoneKnowledgeRelationship[]   // the verbs
  observations:  KeystoneKnowledgeObservation[]    // the adjectives (facts about nouns)
  evidence:      OkfEvidence[]                     // the citations
}
```

### 1. `KeystoneKnowledgeUnit` — a node

```ts
{
  id: string                      // stable, from identity.ts
  profile, profileVersion         // literal-typed to the constants
  kind: KeystoneKnowledgeKind     // one of 29 (below)
  name: string
  description?: string
  canonicalKey: string            // dedupe/merge key — must be unique
  properties: Record<string, unknown>
  confidence: OkfConfidence       // { score 0..1, level, rationale? }
  provenance: OkfProvenance       // workspaceId, extractionRunId, evidenceIds, …
  lifecycle: OkfLifecycle         // "active" | "deprecated" | "deleted"
  firstSeenAt, lastSeenAt, createdAt, updatedAt   // ISO-8601
}
```

**29 unit kinds** (`profile.ts:26-56`):

```
repository  workspace  file  module  package  service  symbol  api
data-entity  configuration  test  documentation  call-flow  data-flow
architecture-boundary  risk-area  change-impact  database  table
orm-entity  query  feature-flag  fixture  ci-cd  infrastructure
component  event  build-system  package-manager
```

### 2. `KeystoneKnowledgeRelationship` — an edge

Same envelope as a unit, plus `sourceId` / `targetId`, and `kind` from
**17 relationship kinds** (`profile.ts:63-81`):

```
contains  defines  imports  depends-on  calls  reads  writes  exposes
implements  extends  tests  covers  configured-by  documented-by
flows-to  may-impact  maps-to
```

`relationshipConstraints` in the profile restricts which source/target kinds are
legal per relationship kind. Validation enforces it.

### 3. `KeystoneKnowledgeObservation` — a typed fact

```ts
{ id, profile, profileVersion,
  subjectId,                 // must reference an existing unit
  predicate: string,         // e.g. "loc", "complexity", "isTest"
  value: unknown,
  valueType: "string"|"number"|"boolean"|"object"|"array"|"null",
  confidence, provenance, observedAt }
```

Observations exist so that attributes can carry **their own** confidence and
provenance, independent of the unit. That is what lets Keystone say "this file
has 400 LOC (observed, certain) and is a security-sensitive area (inferred,
0.6)".

### 4. `OkfEvidence` — the citation

Every claim points at evidence. Evidence records the extractor, its version, the
run, and an exact source location.

**Validation rules on evidence** (`validation.ts:68-84`):
- IDs must be unique.
- `source.workspaceRelativePath` is **required**.
- It must **not** be absolute — rejects leading `/` and `^[A-Za-z]:\\`.

**⚠️ This is a privacy/portability invariant, not a style rule.** OKF snapshots
are designed to be shareable; leaking `/Users/sudheer/...` would break that.
`okf/identity.ts` exists specifically to "produce stable, workspace-scoped IDs
without leaking absolute file paths".

---

## Confidence, provenance, lifecycle

### `OkfConfidence`

```ts
{ score: number,                              // 0..1, validated
  level: "observed" | "derived" | "inferred", // validated
  rationale?: string }
```

| Level | Meaning |
|---|---|
| `observed` | read directly from the source (a real import statement) |
| `derived` | computed deterministically from observations (a cycle in the import graph) |
| `inferred` | heuristic (keyword match suggests a security-sensitive area) |

### `OkfProvenance`

Validated against the snapshot (`validation.ts:29-46`) — **every** record's
provenance must have `workspaceId` equal to the manifest's, `extractionRunId`
equal to the manifest's, and a parseable ISO `observedAt`. Cross-run contamination
is impossible by construction.

### `OkfLifecycle`

`"active" | "deprecated" | "deleted"`. Records are **tombstoned, not removed** —
which is why the manifest counts both `active` and `deleted`. This is what makes
"what disappeared since last run?" answerable.

---

## The manifest

```ts
{ format: "keystone-okf", formatVersion: 2,
  profile, profileVersion, profileDigest,
  workspaceId, generatedAt,
  extractionRunId, parentExtractionRunId?,   // ← run lineage
  repositoryRevision?,                        // ← Git HEAD
  validation: { valid: true, validatorVersion, validatedAt },
  projections: { graphVersion, cpgBindingVersion, searchVersion },
  counts: { units, relationships, observations, evidence, active, deleted },
  digests: Record<string, string> }
```

Note `validation.valid` is typed as the literal `true` — **an invalid snapshot is
not representable**, it can only be thrown on.

`parentExtractionRunId` gives you the chain of runs; `digests` lets you detect
whether any individual file changed without re-reading it.

---

## On-disk serialization

`serializeOkfSnapshot()` (`serialization.ts:14`) produces exactly **7 files**:

```
manifest.json                     pretty JSON
profile.json                      { id, version, digest }
validation.json                   the full OkfValidationResult
knowledge/units.jsonl             one JSON object per line
knowledge/relationships.jsonl
knowledge/observations.jsonl
knowledge/evidence.jsonl
```

JSONL for the bulk records: append-friendly, streamable, and diff-friendly line
by line.

---

## Atomic promotion

`OkfSnapshotStore.promote()` (`store.ts`) — the sequence that keeps the store
crash-safe:

```
1. write everything          →  .keystone/intelligence/okf.candidate-<runId>/
2. copy candidate            →  .keystone/intelligence/snapshots/<runId>/   (archive)
3. rename okf                →  okf.previous
4. rename okf.candidate-…    →  okf                                        (atomic swap)
5. write                     →  .keystone/intelligence/current.json         (pointer)
6. rm -rf okf.previous
7. writePortableOkfBundle()  →  .keystone/intelligence/okf-bundle/
```

A crash at any point leaves either the complete old snapshot or the complete new
one. There is no torn state.

`store.ts:164` also does a legacy cleanup: it removes an old
`.keystone/knowledge/` directory if present — the pre-v2 layout.

---

## Projections (derived, cheap to regenerate)

`okf/projections.ts` produces three artifacts from the snapshot:

| Function | Output | Consumer |
|---|---|---|
| `projectOkfGraph()` | `projections/graph.json` | the UI graph |
| `projectOkfSearch()` | `projections/search.jsonl` | query/retrieval index |
| `projectCpgBindings()` | `projections/cpg-bindings.jsonl` | links OKF units ↔ CPG nodes |

Each has a version number in `manifest.projections`, so a consumer can tell
whether it needs to re-derive.

**⚠️ TRAP — do not persist new state alongside OKF.** If you need a new derived
view, add a projection. A parallel `KGNode`/`KGEdge` model previously lived in
`intelligence/graph/`; it was never wired up and was deleted (1,712 LOC). Do not
recreate it.

**⚠️ TRAP — the UI graph is live and OKF-derived.** `src/webview/GraphCanvas.tsx`
declares its own `VisualGraphNode`/`VisualGraphEdge` types. Those are *view
models*, not a competing store; they are populated from the OKF projection via
`explorer/intelligenceExplorer.ts`. `scripts/verify-graph-stack.mjs` exists
specifically to prove this path stays live:

```
PASS graph-stack: OKF emitted 1 calls edge(s); explorer projected 6 node(s), 5 edge(s)
PASS graph-stack: canonical graph is OKF-derived (intelligenceExplorer -> GraphCanvas),
     independent of deleted intelligence/graph/*
```

---

## The portable Markdown bundle

`okf/bundle.ts` (`writePortableOkfBundle`) mirrors the whole snapshot as
human-readable, cross-linked Markdown under
`.keystone/intelligence/okf-bundle/`:

```
okf-bundle/
├── .keystone-bundle.json        machine manifest
├── index.md                     root — MUST have a title and okf_version frontmatter
├── log.md
├── files/index.md               one index per unit kind (pluralised)
├── symbols/index.md
├── services/index.md
└── …/<unit>.md                  one page per unit
```

Rules enforced by `validatePortableOkfBundle()`:
- Root `index.md` is required and must contain a Markdown title.
- Root `index.md` must declare `okf_version: "<PORTABLE_OKF_VERSION>"`.
- **Only** the bundle-root `index.md` may contain frontmatter.
- Each unit page carries tags `["keystone", kind, confidence.level, lifecycle]`
  and relationship links rendered as `**kind** → [name](relative/path.md)`.

This is the "share your repo's knowledge without shipping the tool" format.

---

## Querying

`okf/queryEngine.ts` (674 LOC) — `queryOkfSnapshot()` classifies the query
intent, plans a traversal, executes it against units/relationships/observations,
and returns results **with the evidence IDs that justify them** plus the plan
itself. The plan being returned is deliberate: the UI shows *why* something was
retrieved.

`okf/canonicalContext.ts` wraps results into an
`OkfCanonicalEvidenceEnvelope` (`types.ts:177`):

```ts
{ snapshotDigest, extractionRunId,
  unitIds[], relationshipIds[], evidenceIds[], paths[],
  generatedAt }
```

This envelope is what gets attached to every downstream derived artifact — the
background analysis results, the context pack, the task handoff — so any
statement Keystone makes can be traced back to the exact snapshot and records it
came from. `backgroundAnalysisWorker.ts:51-57` (`withCanonicalEvidence`) stamps
it onto every worker result.

Next: [`06-intelligence-pipeline.md`](06-intelligence-pipeline.md).
