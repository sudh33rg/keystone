# AGENTS.md

## Product

This repository contains Keystone, a VS Code extension with a React SPA Webview.

Keystone is an AI-driven engineering intelligence and development orchestration extension. The present milestone is restricted to:

1. The complete repository intelligence layer.
2. The Intelligence UI inside the VS Code extension.

Do not expand intent management, specification generation, Copilot delegation, task orchestration, or validation workflows unless required to support repository intelligence.

## Current architecture constraints

- Maintain a single VS Code extension repository.
- Do not convert the project into a monorepo.
- The UI must remain a React SPA rendered in a VS Code Webview.
- Do not introduce a standalone backend or HTTP server.
- Do not introduce an external database, graph server, vector database, Redis, Neo4j, PostgreSQL, or cloud persistence.
- Intelligence must be stored locally using extension-managed files, manifests, compressed shards, indexes, and immutable generations.
- Repository ingestion must not require an LLM.
- Querying, graph traversal, impact analysis, and OKF generation must not require an LLM.
- GitHub Copilot or an LLM may consume intelligence later, but must not create canonical repository facts.

## Intelligence principles

The canonical intelligence model consists of:

1. Repository inventory
2. Engineering ontology
3. Evidence-backed semantic graph
4. Progressive Code Property Graph
5. Test intelligence
6. API and flow intelligence
7. Database and ORM intelligence
8. Configuration, build, infrastructure, and documentation intelligence
9. Git and change intelligence
10. Deterministic OKF projection
11. Query and browsing services

The graph is computational truth.
Evidence is the trust layer.
The ontology supplies meaning.
OKF is the portable and human-readable projection.

## Ingestion requirements

- Ingestion is continuous, not one-time.
- Opening a repository must load the last valid generation immediately.
- Missing or stale intelligence must be repaired in the background.
- Manual deletion of intelligence must trigger automatic reconstruction.
- File create, modify, rename, and delete events must update affected intelligence.
- Branch checkout, pull, merge, rebase, and reset must trigger Git-diff-based reconciliation.
- Ingestion must use multiple persistent background workers.
- Heavy parsing must not execute on the VS Code extension-host event loop.
- The last complete intelligence generation must remain queryable while a newer generation is built.
- New generations must be promoted atomically.
- Stale worker results must be discarded using source hashes and job revisions.
- Active-editor and user-query jobs have higher priority than global background analysis.

## Exclusion rules

Do not deeply ingest:

- node_modules
- vendor dependencies
- dist
- build
- out
- bin
- obj
- target
- temporary directories
- virtual environments
- caches
- coverage output
- generated files
- minified files
- binaries
- archives
- JAR, WAR, DLL, EXE, CLASS, object files
- media and ordinary static assets

Tests must never be classified as generated.

CI configuration, build files, ORM schemas, database migrations, OpenAPI, GraphQL, Docker, Kubernetes, Terraform, documentation, and source configuration must be included.

Environment files are sensitive:
- Never store secret values.
- Extract names only when allowed.
- Record exclusion or sanitization evidence.

## Engineering rules

- Do not fabricate graph relationships.
- Every entity and relationship must include evidence.
- Preserve confidence, extraction method, parser version, source location, content hash, branch, and generation.
- Unsupported or unresolved cases must be reported honestly.
- Prefer incremental repair over full rebuilding.
- Keep query contracts typed and paginated.
- Do not send unbounded graph data to the Webview.
- The graph UI must show scoped neighborhoods, flows, and impact views rather than rendering the entire repository at once.
- Preserve backward compatibility only where it does not perpetuate incorrect intelligence behavior.
- Remove misleading placeholder implementations rather than building on them.

## Verification

Before marking work complete:

- Run type checking.
- Run linting.
- Run relevant unit tests.
- Run extension integration tests where available.
- Verify that VS Code remains responsive during ingestion.
- Verify restart recovery.
- Verify file-change updates.
- Verify file deletion cleanup.
- Verify branch-change reconciliation.
- Verify manual intelligence deletion recovery.
- Review the final diff for invented relationships, main-thread work, unbounded Webview payloads, and external-storage dependencies.

## Required reading

Before implementing intelligence changes, read:

- `docs/intelligence/INTELLIGENCE_VISION.md`
- `docs/intelligence/INTELLIGENCE_ARCHITECTURE.md`
- `docs/intelligence/ONTOLOGY_AND_GRAPH.md`
- `docs/intelligence/CPG_DESIGN.md`
- `docs/intelligence/INGESTION_RUNTIME.md`
- `docs/intelligence/STORAGE_FORMAT.md`
- `docs/intelligence/QUERY_ENGINE.md`
- `docs/intelligence/OKF_PROFILE.md`
- `docs/intelligence/INTELLIGENCE_UI.md`
- `docs/intelligence/IMPLEMENTATION_GAPS.md`
- `docs/intelligence/DELIVERY_PLAN.md`

## Working approach

For substantial work:

1. Inspect the current implementation.
2. Compare it with the authoritative documents.
3. Produce or update an execution plan in `PLANS.md`.
4. Identify assumptions and unresolved decisions.
5. Implement one coherent vertical slice.
6. Run validation.
7. Update the plan and architecture documents only when implementation changes an approved decision.
8. Do not start unrelated future Keystone capabilities.