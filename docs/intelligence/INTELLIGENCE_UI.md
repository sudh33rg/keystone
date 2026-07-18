# Keystone Intelligence UI Specification

## Product goal

The Intelligence area is a complete engineering workspace inside the React SPA Webview. It must make ingestion, coverage, repository structure, relationships, flows, impact, tests, OKF, and diagnostics understandable without blocking normal VS Code work.

## Main navigation

```text
Overview
Explorer
Search
Graph
Flows
Impact
Tests
OKF
Diagnostics
```

## Overview

Display:

- Repository name and workspace roots
- Current branch, HEAD, and dirty state
- Intelligence generation and freshness
- Last successful update and pending changes
- File coverage by analysis level
- Languages, frameworks, databases, ORMs, test frameworks, build systems, and infrastructure
- Entity and relationship counts
- APIs, tables, tests, documentation concepts, and unresolved references
- Parser failures, low-confidence edges, broken OKF links, and missing shards
- Active workers, queued jobs, current files, throughput, pause, resume, and cancel controls

## Explorer

A virtualized, paginated hierarchy:

- Repository
- Architecture
- Modules
- Code
- APIs
- Flows
- Data
- Tests
- Configuration
- Build and delivery
- Documentation
- Changes
- OKF
- Diagnostics

Selecting an item opens the entity inspector.

## Global query bar

Examples:

- `Find OrderService`
- `What calls createOrder?`
- `Tests for PaymentGateway.retry`
- `Path from POST /orders to orders.status`
- `Impact of changing Customer.email`
- `Show authentication flow`
- `Where is PAYMENT_TIMEOUT used?`

Show resolved entities, compiled query, filters, confidence threshold, result count, and generation.

## Entity inspector

Tabs:

### Overview

Type, qualified name, source, module, signature, visibility, confidence, freshness, and analysis coverage.

### Relationships

Incoming and outgoing relationships grouped by type with evidence.

### Source

Relevant source range with Open in Editor, Copy Reference, and Pin to Context.

### Graph

Bounded neighborhood with expansion controls.

### Tests

Mapped tests, confidence, coverage, impacted suites, and uncovered paths.

### Data

Reads, writes, ORM mappings, schema fields, queries, and migrations.

### Changes

Current diff, recent changes, co-change files, and symbol history.

### Evidence

Source range, extraction method, parser version, hash, branch, and generation.

### OKF

Rendered concept, backlinks, related concepts, and raw Markdown.

## Graph canvas

The UI must never render the entire repository at once. It shows scoped neighborhoods, module graphs, architecture graphs, API flows, data flows, test mappings, or impact graphs.

Controls:

- Depth
- Node and relationship types
- Minimum confidence
- Group by module, layer, or domain
- Expand or collapse
- Find path
- Run impact
- Open source
- Pin to context

A lightweight SVG implementation is preferred initially until query contracts stabilize.

## Flow viewer

Use a left-to-right execution flow:

```text
UI → API Client → Route → Middleware → Controller → Service → Repository → Database → Event
```

Allow expansion of validation, branches, data transformations, tests, and source evidence.

The current Query Workspace renders bounded flow results left-to-right with template name, complete/partial state, ordered relationship direction, matched and missing stages, alternate rank, confidence/risk factors, terminal reason, and an action to inspect the canonical entity at the boundary. This is the first purpose-specific flow surface; branch and transformation expansion remain future work.

## Impact view

Show direct impact, transitive impact, affected APIs, data objects, tests, configuration, public surfaces, risk factors, evidence, and stale or unresolved areas.

## Test intelligence

Show suites, source mappings, confidence, coverage, impacted tests, untested public symbols, uncovered CPG branches, framework configuration, and mapping failures.

## OKF browser

Provide concept hierarchy, search, backlinks, graph neighbors, source evidence, freshness, broken links, raw Markdown, and export.

## Diagnostics and exclusions

Users can inspect why a path was included, metadata-only, sensitive, generated, unsupported, or excluded. Show matched rule, parser errors, unresolved symbols, low-confidence edges, and suggested corrective actions.

## Webview design constraints

- All lists are virtualized or paginated
- All requests are cancellable
- Responses include generation identity
- Large graphs are bounded
- The UI survives Webview reload by restoring navigation and query state
- Progress is non-modal
- The user can continue editing while ingestion runs
- Visual styling follows VS Code theme variables with Keystone's steel-blue accent used sparingly
