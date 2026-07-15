# Keystone OKF Engineering Intelligence Profile

## Purpose

OKF is Keystone's portable, human-readable, agent-readable knowledge projection. It is generated deterministically from canonical intelligence and is not the primary graph store.

## Core rules

- Every concept uses a stable Keystone entity ID
- Every page is grounded in canonical entities, relationships, and evidence
- Prose is rendered from deterministic templates
- Manual content is clearly separated and preserved
- Links use relative Markdown paths
- Index pages support progressive disclosure
- Only affected concepts are regenerated
- Broken links and stale concepts are reported

## Suggested hierarchy

```text
okf/
├── index.md
├── log.md
├── repository/
├── architecture/
│   ├── layers/
│   ├── modules/
│   ├── domains/
│   ├── flows/
│   └── decisions/
├── code/
│   ├── packages/
│   ├── files/
│   ├── classes/
│   ├── interfaces/
│   ├── functions/
│   └── components/
├── apis/
├── data/
├── tests/
├── configuration/
├── delivery/
├── documentation/
├── changes/
└── specifications/
```

## Keystone frontmatter

```yaml
---
type: CodeSymbol
title: OrderService.create
keystone_id: entity:typescript:src/orders/order-service.ts:OrderService.create
kind: method
language: typescript
qualified_name: OrderService.create
module: orders
visibility: public
source:
  path: src/orders/order-service.ts
  start_line: 42
  end_line: 86
repository:
  branch: main
  commit: a84d91e
derivation: extracted
confidence: 1.0
content_hash: sha256:...
generation: 42
tags:
  - orders
  - service
---
```

## Concept body sections

Depending on entity type, pages may include:

- Signature or declaration
- Responsibilities derived from relationships
- Belongs to
- Calls and called by
- Routes and flows
- Reads and writes
- Tests and coverage
- Configuration
- Changes
- Requirements and decisions
- Evidence
- Backlinks

## Manual knowledge

User-authored sections are delimited and preserved during regeneration. Manual assertions are stored as `user-asserted` knowledge with provenance and can be linked to canonical entities. Conflicts with extracted facts are shown rather than silently reconciled.

## Incremental generation

The store tracks source file to entity to relationship to OKF concept dependencies. A changed entity regenerates only its concept, affected index pages, backlinks, flow pages, and aggregate summaries.

## Validation

The OKF validator checks:

- Required frontmatter
- Unique stable IDs
- Valid relative links
- Existing target concepts
- Fresh generation identity
- Evidence presence
- Manual section preservation
- Duplicate concepts
- Orphan concepts

## Export

The user may export the OKF bundle to a selected repository path or external directory. Exported OKF is portable and reviewable but remains a projection of local canonical intelligence.
