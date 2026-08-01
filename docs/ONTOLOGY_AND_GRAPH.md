# Ontology, Graph, Search, and CPG

## Canonical flow

```text
Deterministic extraction
  → canonical repository facts
  → validated OKF snapshot
  → graph projection
  → search projection
  → CPG identity bindings and per-artifact CPG shards
  → query, impact, compression, and SDLC evidence
```

## Knowledge graph

Each graph node and edge retains its authoritative OKF ID. Graph traversal supports architecture communities, hubs, cycles, entry-point flows, reverse dependency impact, test impact, and evidence resolution.

## Search projection

Every active knowledge unit produces a search document containing its OKF ID, kind, normalized text, source path, and evidence IDs. Query results can therefore resolve back to provenance rather than returning ungrounded text.

## Code Property Graph

Every indexed text artifact receives a CPG shard:

- TypeScript/JavaScript: compiler-backed AST and project semantic enrichment.
- Other registered and unknown text languages: deterministic structural AST/evaluation/control/data-dependence projection.

CPG nodes may bind to the most specific symbol OKF ID and otherwise bind to the artifact-level OKF ID. CPG edges carry corresponding OKF source/target IDs when available. Documentation and configuration artifacts are included in the identity resolver, not left as parallel unlinked graphs.

## Lifecycle

Renames, changes, and deletions are reconciled across snapshots. Removed units and relationships become tombstones, source evidence becomes stale, and the next snapshot records its parent extraction run. Projections are regenerated from the promoted snapshot only.
