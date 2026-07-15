# Keystone Intelligence Query Engine

## Purpose

The query engine provides deterministic access to repository intelligence for developers, the React UI, and future Copilot agents. It does not require an LLM or embeddings.

## Query operations

### Overview

Repository identity, technology stack, coverage, graph counts, health, freshness, Git state, and worker status.

### Search

Find entities by exact name, qualified name, path, type, aliases, documentation text, tags, camel-case tokens, and fuzzy matching.

### Entity

Return detailed information for one canonical entity, including source, relationships, tests, data, changes, evidence, and OKF.

### Neighborhood

Return a bounded incoming, outgoing, or bidirectional graph around selected entities with type, confidence, depth, and result limits.

### Path

Find shortest or bounded typed paths between entities, such as endpoint to table, UI component to API, event to handler, or test to source.

### Impact

Calculate direct and transitive impact of changing an entity or diff, including callers, APIs, data, tests, configuration, public surfaces, and risk.

### Flow

Return execution or data flows using routes, calls, middleware, events, queues, reads, writes, serializers, and selected CPG paths.

### Tests

Return mapped tests, confidence, evidence, coverage, impacted tests, uncovered public symbols, and uncovered branches where CPG data exists.

### Architecture

Return modules, layers, boundaries, public APIs, dependency direction, cycles, violations, coupling, and centrality.

### Changes

Return file and symbol changes, branch differences, recent modifications, co-change history, and stale intelligence.

### OKF

Return rendered concepts, hierarchy, backlinks, related entities, freshness, and broken-link diagnostics.

## Typed query model

```ts
interface IntelligenceQuery {
  operation: string;
  seed?: EntitySelector[];
  filters?: {
    entityTypes?: string[];
    relationshipTypes?: string[];
    modules?: string[];
    languages?: string[];
    confidenceAtLeast?: number;
    derivations?: string[];
  };
  traversal?: {
    direction: "incoming" | "outgoing" | "both";
    maxDepth: number;
    maxNodes: number;
  };
  include?: {
    source?: boolean;
    evidence?: boolean;
    tests?: boolean;
    changes?: boolean;
    okf?: boolean;
    risk?: boolean;
  };
  page?: { limit: number; cursor?: string };
  generation?: number;
}
```

## Deterministic natural-language grammar

The UI may accept natural-looking templates without an LLM:

- `where is <entity> used`
- `what calls <entity>`
- `what does <entity> call`
- `tests for <entity>`
- `impact of <entity>`
- `path from <entity> to <entity>`
- `show <domain> flow`
- `where is <configuration> configured`
- `show dependency cycles`

Autocomplete resolves canonical entities. The UI shows the compiled query and asks for disambiguation when multiple entities match.

## Ranking

Ranking combines deterministic signals:

- Exact qualified-name match
- Exact symbol-name match
- Direct relationship
- Graph distance
- Same module or feature
- Test relationship
- Source proximity
- Current diff relevance
- Public API exposure
- Confidence
- User-pinned entities

## Explainability

Every result reports why it matched, path distance, relationship evidence, confidence, freshness, and limitations. Query results include the intelligence generation and pending-update status.

## Performance and safety

- All result sets are bounded and paginated
- Traversal has depth and node limits
- Requests are cancellable
- Expensive CPG queries run in background workers
- Query caches are generation-specific
- The Webview never receives the complete repository graph

## Future agent contract

A future `keystone_explore` operation will accept a question, token budget, detail level, task ID, and branch. It will return compact entities, graph paths, source fragments, constraints, tests, evidence, omitted-result counts, and estimated token size.
