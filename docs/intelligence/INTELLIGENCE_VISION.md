# Keystone Repository Intelligence Vision

## Purpose

Keystone Repository Intelligence is the cognitive foundation of the Keystone VS Code extension. It continuously transforms a workspace into a local, queryable, evidence-backed engineering knowledge system without using an LLM for ingestion, indexing, relationship extraction, querying, graph traversal, impact analysis, or OKF generation.

The intelligence layer must support developers, future Copilot agents, specifications, task planning, context construction, testing, validation, modernization, security, and performance workflows. It must be useful on its own before any agent workflow is added.

## Product position

Keystone is not only a code search engine, wiki generator, or graph visualizer. It maintains synchronized views of one canonical intelligence model:

- Repository inventory
- Engineering ontology
- Evidence-backed semantic graph
- Progressive Code Property Graph
- Detailed entity records
- API, data, test, build, documentation, and Git intelligence
- Query results and impact analysis
- Browsable React UI
- Portable OKF projection

The graph is the computational truth. Evidence is the trust layer. The ontology supplies meaning. OKF is the open, human-readable projection.

## Core principles

### Deterministic ingestion

Repository facts must come from parsers, language services, manifests, configuration, static analysis, Git, test coverage, and framework rules. Generated prose must never become canonical truth.

### Local-first

No external database, graph server, vector database, cloud backend, or hosted indexing service is required. Intelligence is stored in extension-managed local files, compressed shards, indexes, manifests, and immutable generations.

### Continuous intelligence

Ingestion is not a one-time operation. Keystone must react to workspace changes, saves, file creation, deletion, renames, branch changes, pulls, merges, rebases, resets, parser upgrades, ontology upgrades, and manual deletion of intelligence.

### Non-blocking execution

Heavy ingestion runs through persistent background workers. The extension host and React Webview must remain responsive. The last valid intelligence generation remains queryable while a new generation is built.

### Evidence and explainability

Every entity, relationship, derived fact, risk, or query result must explain where it came from, how it was derived, its confidence, its branch and generation, and whether it is current.

### Breadth with honest degradation

Keystone must inventory every relevant repository source and deeply analyze supported technologies. Unsupported constructs must be reported transparently instead of being guessed.

### One canonical model, many projections

Search, graph, detailed views, flow views, impact analysis, agent context, and OKF must all originate from the same canonical IDs and evidence.

## Intelligence scope

The complete intelligence layer covers:

1. Repository and workspace inventory
2. Source code structure and semantics
3. Packages, modules, layers, features, and boundaries
4. APIs, routes, middleware, commands, jobs, events, and queues
5. Database schemas, ORM mappings, queries, migrations, and data flow
6. Tests, fixtures, mocks, coverage, impacted tests, and test gaps
7. Configuration keys, feature flags, environment variable names, and build metadata
8. Documentation, ADRs, guides, requirements, and specifications
9. Git branches, commits, diffs, symbol changes, and co-change history
10. Progressive CPG overlays for control flow, data flow, slicing, and security
11. Querying, browsing, visualization, diagnostics, and OKF export

## Exclusions

Keystone must avoid deep ingestion of dependency folders, generated output, binaries, archives, caches, virtual environments, temporary files, minified assets, ordinary media, and framework build products. Tests, CI files, build files, schemas, migrations, documentation, and infrastructure definitions must not be excluded merely because they are not application source code.

Sensitive configuration is handled specially. Secret values are never indexed. Variable names and references may be indexed only under the configured policy.

## Success criteria

The intelligence milestone is successful when a user can open a repository and:

- See intelligence load or build automatically
- Continue using VS Code during ingestion
- Search and browse files, symbols, modules, APIs, data, tests, and documentation
- Inspect evidence for every result
- View scoped graphs and execution flows
- Ask deterministic queries such as callers, dependencies, paths, impact, tests, and configuration usage
- See Git and branch freshness
- Delete intelligence and observe automatic recovery
- Save, pull, or change branches and see incremental updates
- Browse the same knowledge through OKF
- Understand unsupported technologies and intelligence coverage gaps

## Non-goals for the current milestone

The current milestone does not implement autonomous development, Copilot delegation, intent planning, specification generation, task orchestration, or validation workflows beyond what is needed to prove repository intelligence. Those features will consume the intelligence layer later.
