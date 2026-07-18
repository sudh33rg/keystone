---
name: gap-analysis-report
description: Documentation of gaps identified between the Keystone repo and reference repositories in the check directory.
metadata:
  type: reference
---
# Gap Analysis Report

## Overview
This report documents the gaps between the current **Keystone** repository (`/Users/sudheer/workspace/keystone`) and the reference repositories located at `/Users/sudheer/workspace/refs/check/new`. The goal is to highlight missing files, documentation, tests, and features that could be fetched from the reference repos to improve the completeness and quality of the Keystone codebase.

## Reference Repositories
The reference directory contains the following top‑level projects:

- `codegraph-main`
- `graphify-8`
- `obsidian-second-brain-main`
- `okf-generator-main`
- `OpenKB-main`
- `openwiki-main`
- `Understand-Anything-main`

Each of these projects includes a rich set of documentation, tests, and implementation artifacts (e.g., CLI tools, MCP servers, knowledge‑graph pipelines) that are not fully present in the Keystone repo.

## Identified Gaps

### 1. Documentation Gaps
- **Missing High‑Level Architecture Docs**: The reference repos contain detailed architecture overviews (`docs/02-architecture.md`, `docs/INTELLIGENCE_ARCHITECTURE.md`) describing layered pipelines, graph traversal, and MCP server interactions. Keystone only has a limited set of docs (`docs/intelligence/*`, `docs/PRODUCT_MODEL_AND_NAVIGATION.md`). Adding comparable architecture documentation would improve onboarding and maintainability.
- **Knowledge‑Graph Concepts**: Reference repos provide extensive knowledge‑graph specifications (`KNOWLEDGE-GRAPH.md`, `docs/ONTOLOGY_AND_GRAPH.md`). Keystone currently lacks a consolidated knowledge‑graph reference, which would benefit developers working with the intelligence subsystem.
- **Orchestration and Multi‑Agent Guides**: The reference projects include orchestration guides (`ORCHESTRATION.md`, `RECURRING-TASKS.md`) and multi‑agent workflow documentation. Keystone has a brief `ORCHESTRATION.md` in memory but not a dedicated repo file. Adding a full orchestration guide would align Keystone with best practices.
- **Installation and CLI Usage**: Reference repos provide comprehensive CLI usage docs (`CLAUDE.md`, `install.sh`, `install.ps1`). Keystone’s README contains limited installation instructions. Incorporating a detailed CLI guide would assist users and developers.

### 2. Test Coverage Gaps
- **Missing End‑to‑End Integration Tests**: The reference repos have extensive integration test suites (`__tests__/installer-targets.test.ts`, `__tests__/evaluation/*`). Keystone currently includes unit tests for core modules but lacks integration tests for the full intelligence pipeline and MCP server interactions.
- **Platform‑Specific Tests**: Reference repositories contain platform‑specific test gating (Windows, Linux Docker) and cross‑platform validation scripts. Keystone’s test suite does not include such gating, which could lead to hidden platform bugs.

### 3. Feature Gaps
- **Multi‑Agent Orchestrator**: Reference projects implement a sophisticated multi‑agent orchestrator with routing strategies (`ORCHESTRATION.md`, `RECURRING-TASKS.md`). Keystone’s codebase only contains a rudimentary workflow service (`src/core/workflows/DevelopmentWorkflowService.ts`). Adding a full orchestrator would enable richer AI‑driven workflows.
- **Knowledge‑Graph Indexing and Query Engine**: The reference repos ship a complete `QueryEngine` and graph indexing pipeline (`src/core/intelligence/query/QueryEngine.ts` in Keystone exists but lacks the breadth of functionality found in `codegraph-main/src/query/*`). Enhancing the query engine to support dynamic‑dispatch coverage and synthesis would improve intelligence capabilities.
- **CLI Tools for Agent Installation**: Reference repos include installer targets and MCP server configuration (`src/installer/targets/*`). Keystone’s installer scripts are minimal. Implementing a comparable installer would streamline integration with external agents (Claude, Cursor, Opencode).
- **Dynamic‑Dispatch Synthesis**: The reference repos have extensive dynamic‑dispatch synthesis for frameworks (React, Django, Laravel) and callback edge generation. Keystone currently has limited support for dynamic dispatch in its intelligence subsystem.

### 4. Asset Gaps
- **Missing UI Assets and Styles**: Reference projects contain UI assets (`dist/webview/assets/*`, `src/ui/styles/*`). Keystone has some UI components but lacks a complete set of assets and styling guidelines.
- **Missing Example Configurations**: Reference repos provide example configuration files for MCP servers, permission hooks, and environment variables. Keystone’s configuration documentation is sparse.

## Recommendations
1. **Add Architecture Documentation**: Create `docs/architecture.md` summarizing the layered pipeline, knowledge‑graph schema, and MCP server flow.
2. **Integrate Knowledge‑Graph Reference**: Add a `docs/knowledge-graph.md` file detailing node and edge kinds, extraction pipelines, and synthesis mechanisms.
3. **Expand Orchestration Guide**: Develop `docs/orchestration.md` covering routing strategies, recurring tasks, and multi‑agent workflow orchestration.
4. **Improve Test Suite**: Add integration tests for the intelligence pipeline, MCP server, and multi‑agent orchestrator. Include platform‑specific gating.
5. **Implement Installer Scripts**: Provide CLI installer scripts similar to those in `codegraph-main` for agent target registration and MCP server setup.
6. **Enhance Query Engine**: Extend `src/core/intelligence/query/QueryEngine.ts` to support dynamic‑dispatch synthesis, multi‑agent query routing, and advanced graph traversal.
7. **Add UI Assets**: Populate `dist/webview/assets/` with necessary CSS/JS files and update UI component documentation.
8. **Provide Example Configurations**: Include sample `settings.json`, permission hooks, and environment variable files.

## Next Steps
- Prioritize documentation gaps (Architecture, Knowledge‑Graph, Orchestration) as they provide immediate developer value.
- Schedule test suite enhancements in the upcoming sprint.
- Assign implementation owners for installer scripts and query engine extensions.

*Generated with Claude Code*.

---

**Why:** This analysis surfaces concrete gaps that, when addressed, will align Keystone with the comprehensive feature set and documentation quality found in the reference repositories.

**How to apply:** Follow the recommendations, create the listed files, and update existing modules accordingly. Link related memories such as `[[orchestration]]` and `[[knowledge-graph]]` for future reference.
