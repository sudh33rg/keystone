# Keystone

Keystone is a local-first VS Code extension for understanding an unfamiliar repository before changing it. It indexes the workspace deterministically, keeps the resulting engineering knowledge on disk in the workspace, and uses that evidence to guide planning, review, validation, and optional GitHub Copilot delegation.

Keystone does not write to Git. It never stages, commits, pushes, pulls, checks out, creates branches, or mutates pull requests.

## What you can do

- Index a repository into an evidence-backed knowledge model (OKF), graph, CPG, and query surface.
- Explore files, symbols, APIs, persistence, framework signals, dependencies, calls, and flows.
- Start an engineering intent and produce repository R&D, a specification, user stories, and quality stories.
- Build a small, evidence-backed context package for a user-approved Copilot delegation.
- Run QA, security, performance, modernization, and read-only review workflows against the active intent.
- Resume work through an encrypted Task Handoff package.
- Open the same live Keystone state in a browser view.

## Install

Install the `.vsix` package from VS Code:

1. Open **Extensions**.
2. Select **…** → **Install from VSIX…**.
3. Choose `keystone-<version>.vsix`.
4. Reload VS Code if prompted.

For development, see [Developer documentation](docs/dev/README.md). The extension requires VS Code `^1.95.0` and Node.js 20+ only when building from source.

## Quick start

1. Open the repository you want to understand in VS Code.
2. Run **Keystone: Open Application** from the Command Palette.
3. Select **Index Repository** (or run **Keystone: Index Repository**).
4. Wait for the status to show **Ready**. If it shows **Needs attention**, inspect the ingestion warning before relying on results.
5. Explore the repository in **Intelligence**, or open **Work** and describe the change you want to make.

Keystone stores its local intelligence under `.keystone/` in the repository. This state is derived, can be regenerated, and is not source code.

## Intelligence guide

### Overview

Use **Overview** to check the snapshot freshness, indexed languages, evidence counts, background-worker state, warnings, and the current capability level. A completed index indicates that the pipeline finished; it does not mean every relationship has compiler-level certainty.

### Explorer

Use **Explorer** to search and filter indexed knowledge units. Results link to their source evidence. Large result sets load in snapshot-bound pages and render only the visible rows.

### Graph, CPG, and Flows

- **Graph** shows repository, architecture, dependency, call, test-impact, and flow relationships. Expand from selected nodes to keep investigation bounded.
- **CPG** shows per-artifact structural control/data/call information, with richer compiler evidence for TypeScript and JavaScript.
- **Flows** is useful for following the available API, call, persistence, and dependency evidence around a selected area.

These views are evidence navigation tools, not proof of runtime behavior or a security source-to-sink analysis.

### Query

Use **Query** for questions such as “where is this API implemented?”, “what uses this table?”, or “what tests may be affected?”. Use **Show in Graph** from a result to inspect its relationship path and source locations.

## Work and Copilot guide

1. In **Work**, enter a concrete engineering intent.
2. Review the repository R&D and approve it when it matches the requested scope.
3. Review the generated specification and stories.
4. Progress the SDLC stages, attaching decisions and validation evidence as you go.
5. When ready, explicitly approve a Copilot delegation. Keystone provides bounded context; GitHub Copilot produces code only when a user-authorized VS Code model is available.

Keystone never invents a Copilot response. If Copilot is unavailable, you can still use the R&D, specification, stories, query, review, and handoff features.

## Configuration

Open VS Code Settings and search for `Keystone`.

| Setting | Default | Purpose |
| --- | ---: | --- |
| `keystone.enabled` | `true` | Enables Keystone commands. |
| `keystone.intelligence.maxWorkers` | `5` | Maximum concurrent intelligence-stage workers (1–16). |
| `keystone.intelligence.maxFileSizeMb` | `3` | Largest file admitted to ingestion; larger files are skipped with a warning. |
| `keystone.intelligence.workerRetries` | `2` | Retry limit for failed background workers (0–5). |
| `keystone.valueEdge.*` | empty | Optional ValueEdge tenant and workspace configuration. The client secret is stored in VS Code SecretStorage. |

Use **Keystone: Reclaim Intelligence Cache** to prune retained cache entries, or **Keystone: Clear Intelligence Cache** to remove derived caches and re-index.

## Language and framework support

Keystone indexes 44 programming-language and artifact categories, plus unknown text-like files through a safe structural fallback. TypeScript and JavaScript receive compiler-backed semantic enrichment. Other non-artifact languages use deterministic structural analysis and can add evidence from the active VS Code language service when one is installed and available.

Common framework and ORM forms are recognized deterministically, including FastAPI, Flask, Spring, ASP.NET, Ktor, Actix, Prisma, TypeORM, Entity Framework, SQLAlchemy, Django, GORM, Eloquent, Active Record, Sequelize, Mongoose, Drizzle, Knex, SQLx, and JPA `EntityManager`.

See [Language support](docs/LANGUAGE_SUPPORT.md) for the capability tiers and exact limits.

## Browser View and Task Handoff

- Run **Keystone: Open Browser View** to open the same active Keystone state in a browser. The browser view uses authenticated, same-origin communication with the extension host.
- Use **Task Handoff** in an active task to create an encrypted, integrity-protected handoff package for another developer. The recipient opens and synchronizes their repository independently; Keystone does not change Git state.

## Troubleshooting

- **No workspace / command unavailable:** open a folder or workspace, then run **Keystone: Open Application**.
- **Needs attention:** open the ingestion activity or warning; the last validated snapshot may still be available, but it is not presented as current.
- **No Copilot response:** sign in and authorize a compatible GitHub Copilot model in VS Code. Keystone does not use an external fallback model.
- **Missing semantic detail for a language:** install/enable that language’s VS Code extension. Keystone will retain deterministic structural results when no provider responds.
- **Large generated/vendor files:** adjust `keystone.intelligence.maxFileSizeMb` only when the file is valuable to analysis; generated output is normally better excluded.

## Further documentation

- [Product specification](docs/KEYSTONE_PRODUCT_SPEC.md)
- [Architecture](docs/ARCHITECTURE.md)
- [Language support](docs/LANGUAGE_SUPPORT.md)
- [Browser View](docs/BROWSER_VIEW.md)
- [Task Handoff](docs/TASK_HANDOFF.md)
- [Developer documentation](docs/dev/README.md)
