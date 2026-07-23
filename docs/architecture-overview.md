# Keystone Architecture Overview

> **Version:** 0.1.0 | **Date:** 2026-07-19 | **Author:** Sudheer G

## 1. System Philosophy

Keystone is a **deterministic, repository-aware control layer** for Copilot-assisted development. It sits between the developer's intent and Copilot's execution, enforcing a structured, spec-driven workflow that ensures every code change is:

- **Specified** — Intent is captured and formalized into specifications before any code is written.
- **Approved** — Changes pass through configurable approval gates (manual, guided, or approval-gated).
- **Validated** — Build, lint, test, and acceptance criteria are verified automatically.
- **Tracked** — Every change is attributed to a task, requirement, and criterion with full audit trails.
- **Delivered** — Git commits and PRs are planned, reviewed, and pushed with structured metadata.

> **Release Boundary.** Keystone is a local-first VS Code extension. The current release does not include centralized collaboration, manager assignment, organization dashboards, cloud synchronization, authentication infrastructure, deployment automation, automatic Git operations, remote pull-request integration, LoRA training, or model fine-tuning. Git operations, source synchronization, remote PR actions, and package transfer remain manual.

---

## 2. High-Level Architecture

```
┌─────────────────────────────────────────────────────────┐
│                    VS Code Extension                     │
│  ┌──────────────────────────────────────────────────┐   │
│  │                  extension.ts                     │   │
│  │         (Activation, DI Container, Init)          │   │
│  └──────┬──────────────┬──────────────┬─────────────┘   │
│         │              │              │                  │
│  ┌──────▼────┐  ┌──────▼────┐  ┌──────▼────┐           │
│  │   Core    │  │ Extension │  │    UI     │           │
│  │  Domain   │  │  Adapters │  │  (React/  │           │
│  │  Services │◄─┤ (VS Code  │  │   Vite)   │           │
│  │           │  │  Bridge)  │  │           │           │
│  └───────────┘  └───────────┘  └───────────┘           │
│         │              │              │                  │
│  ┌──────▼──────────────▼──────────────▼────┐            │
│  │           Shared Contracts              │            │
│  │     (Zod Schemas, Types, Errors)        │            │
│  └─────────────────────────────────────────┘            │
│         │                                               │
│  ┌──────▼────────────────────────────────────┐          │
│  │           Background Workers              │          │
│  │  (GraphIndexerWorker, GitHistoryParser)   │          │
│  └───────────────────────────────────────────┘          │
└─────────────────────────────────────────────────────────┘
```

### Layer Responsibilities

| Layer | Directory | Responsibility |
|-------|-----------|----------------|
| **Core Domain** | `src/core/` | Business logic, state machines, workflows, intelligence graph, validation, delivery |
| **Extension Adapters** | `src/extension/` | VS Code API integration, workspace/git adapters, webview message routing, dashboard providers |
| **UI** | `src/ui/` | React/Vite webview application, host bridge, component library |
| **Shared** | `src/shared/` | Zod contracts, type definitions, error classes, logging infrastructure |
| **Workers** | `src/workers/` | Background web workers for graph indexing and git history parsing |

---

## 3. Core Domain Architecture

### 3.1 Workflow Engine (`src/core/workflows/`)

The **DevelopmentWorkflowService** is the central orchestrator. It manages the complete SDLC lifecycle through a state machine:

```
Intent Capture → Specification → Approval → Task Plan → Execution → Validation → Review → Complete
```

**Key components:**
- **DevelopmentWorkflowService** — Lifecycle management, state transitions, task graph management, specification/task/execution/validation/review coordination
- **BuildWorkspaceService** — Task context construction, token-aware context packaging, Copilot delegation orchestration
- **TaskExecutionService** — 17-state execution state machine, execution session tracking, prompt/validation/change observation management
- **TaskValidationService** — Validation command execution with safety checks, validation planning with test impact analysis, timeout/abort/cancellation support
- **ExecutionRoutingService** — Routes tasks to execution providers (Copilot, manual, unsupported) with deterministic routing for non-implementation operations

### 3.2 Intelligence Layer (`src/core/intelligence/`)

Builds and maintains a **local semantic graph** of the repository:

- **RepositoryIndexService** — Orchestrates repository scanning, creates IntelligenceSnapshot with files, symbols, relationships, and evidence records
- **IntelligenceQueryService** — Read-only bounded queries: search, entity lookup, usages/callers/callees, neighborhood traversal, path finding, flow reconstruction, impact analysis
- **SemanticGraphBuilder** — Builds indexes (Bloom filters, inverted indices) for efficient querying
- **CpgQueryService** — Control/Program Graph queries
- **IntelligenceStore** — Persistent snapshot storage with automatic recovery from previous generations

### 3.3 Copilot Integration (`src/core/copilot/`)

Delegates implementation to GitHub Copilot under strict bounds:

- **CapabilityDrivenCopilotAdapter** — Drives Copilot via VS Code extension API with capability detection
- **AgentRegistry** — Agent discovery, merging, and evidence-backed availability
- **DelegationService** — Context package construction, prompt building (200K char limit), fallback mode detection (direct/assisted/clipboard), change tracking with 6-tier attribution
- **CopilotIntegrationService** — Tool registration (17 keystone_* tools), tool audit, tool execution
- **KeystoneChatAndLaunchService** — VS Code Chat Participant for repository-aware chat
- **CopilotCustomizationService** — Custom instructions management

### 3.4 Context Construction (`src/core/context/`)

Bounded, token-efficient context packages:

- **TaskContextService** — Assembles context from relevant files, tests, and entities
- **ContextCompressionEngine** — Lossless compression (caveman pattern) to reduce token usage
- **ContextEngine** — Orchestrates context retrieval and compression

### 3.5 Validation (`src/core/validation/`)

- **ValidationOrchestrator** — Runs build/lint/test commands, evaluates acceptance criteria
- **TaskValidationService** — Validation planning, test impact analysis, safety checks (prohibited commands, mutation approval, boundary enforcement)

### 3.6 Review (`src/core/review/`)

- **ReviewCompletionService** — 9 completion modes, review decisions, completion records, delivery state aggregation, markdown report generation

### 3.7 Delivery (`src/core/delivery/`)

- **GitDeliveryService** — Git operations, commit planning (merge/split/reorder), mutation approval with verification, PR provider registry, delivery reports
- **DeliveryCoordinator** — Git push and PR creation via provider registry (GitHub extension or clipboard fallback)

### 3.8 Orchestration (`src/core/orchestration/`)

- **OrchestrationService** — Multi-agent orchestration with 20+ state machine transitions, 6 workflow definitions (quick-fix/feature-development/bug-fix/refactoring/modernization/security-remediation), 3 policy profiles (manual/guided/approval-gated), review plan generation with regex-based trigger detection, delivery readiness evaluation, finding resolution with security/performance blocking constraints

### 3.9 Configuration (`src/core/configuration/`)

- **ConfigurationService** — Bounded configuration with `bounded()` and `enumValue()` helpers, typed settings access

---

## 4. Extension Layer (`src/extension/`)

### 4.1 Activation & DI

`extension.ts` activates on `startupFinished` and `keystone.open` command. It initializes a massive dependency injection graph of 50+ services across all layers.

### 4.2 Adapters

6-tier adapter system bridging VS Code APIs to core domain services:

| Adapter | Responsibility |
|---------|---------------|
| **WorkspaceAdapter** | File system, workspace folders, configuration access |
| **GitAdapter** | Git operations, branch management, diff computation |
| **LanguageServiceAdapter** | Language features, diagnostics, code actions |
| **CopilotEnvironmentAdapter** | Copilot API access, tool registration |
| **SharedArtifactAdapter** | Clipboard, file dialogs, system integration |

### 4.3 Webview

- **WebviewMessageRouter** — Bidirectional message routing between extension host and webview
- **Dashboard Providers** — Home, Development, Delivery, Execution/Validation, Orchestration, Query, Semantic Browser dashboards

---

## 5. UI Layer (`src/ui/`)

React/Vite single-page application with lazy-loaded routes:

- **App.tsx** — Root component with React Router, lazy route loading
- **HostBridge** — Communication bridge to extension host via VS Code API
- **Components** — DeliveryWorkspace, DevelopmentWorkspace, ExecutionValidationWorkspace, HomeDashboard, OrchestrationWorkspace, QueryWorkspace, SDLCWorkbench, SemanticBrowser, TaskHandoffWorkspace, UiState

---

## 6. Shared Contracts (`src/shared/contracts/`)

Zod-based schema definitions for all domain entities:

| Contract | Entities |
|----------|----------|
| `domain.ts` | Workflow, Specification, Task, TaskGraph, Gate, Review, Delivery, Team |
| `delegation.ts` | DelegationSession, DelegationResult, ChangeObservation, Attribution |
| `intelligence.ts` | IntelligenceSnapshot, Entity, Relationship, Evidence, Symbol |
| `execution.ts` | ExecutionSession, ValidationRun, PromptRecord |
| `delivery.ts` | ChangeSet, CommitPlan, PullRequest, DeliveryReport |
| `orchestration.ts` | OrchestrationInstance, GateDecision, ReviewPlan |
| `review.ts` | ReviewDecision, WorkflowCompletionRecord, Finding |
| `team.ts` | HandoffPackage, HandoffReconciliation, TaskAssignment |
| `copilotIntegration.ts` | ToolRegistration, ToolAuditEntry |
| `cpg.ts` | CpgNode, CpgEdge, CpgQuery |
| `workbench.ts` | WorkbenchState, WorkbenchView |
| `build.ts` | BuildConfiguration, BuildResult |
| `nativeShell.ts` | ShellCommand, ShellResult, 14 destination types |
| `routing.ts` | RoutingDecision, RoutingStrategy |
| `integration.ts` | IntegrationConfiguration, IntegrationResult |
| `adapters.ts` | AdapterConfiguration, AdapterCapability |

---

## 7. Persistence Layer

All extension state is persisted under `.keystone/` with sharded, gzip-compressed storage:

| Store | Shards | Purpose |
|-------|--------|---------|
| **IntelligenceStore** | 10 shards (manifest, repository, files, symbols, relationships, evidence, diagnostics, contributions, indexes, adapters) | Intelligence snapshots with recovery |
| **DelegationPersistenceStore** | — | Workflow state |
| **ExecutionPersistenceStore** | — | Execution sessions and validation runs |
| **DeliveryPersistenceStore** | — | Delivery change sets and PR results |
| **ReviewPersistenceStore** | — | Review state |
| **OrchestrationPersistenceStore** | — | Orchestration state |
| **NativeShellPersistenceStore** | — | Native shell state |
| **CopilotIntegrationPersistenceStore** | — | Copilot settings and tool audit |

---

## 8. Key Design Patterns

### 8.1 State Machines

Multiple services use formal state machines with Zod-validated transitions:

- **DevelopmentWorkflowService** — 10-stage startup state machine
- **TaskExecutionService** — 17-state execution state machine
- **OrchestrationService** — 20+ state machine transitions
- **Workflow lifecycle** — Intent → Spec → Approval → Tasks → Execution → Validation → Review → Complete

### 8.2 Eligibility/Blocker Pattern

Services consistently use a pattern of checking eligibility conditions and collecting blockers before proceeding. This is used in:
- Task execution readiness
- Delivery readiness
- Review completion
- Handoff acceptance
- Gate decisions

### 8.3 Fingerprint-Based Staleness Detection

State integrity is verified using SHA-256 fingerprints. Staleness is detected across 12 dimensions:
- Repository changes, intelligence drift, specification changes, task changes, execution changes, validation changes, review changes, delivery changes, team changes, configuration changes, branch changes, dependency changes

### 8.4 Capability-Driven Adapters

The Copilot adapter uses capability detection to determine available features, with graceful fallback (direct → assisted → clipboard).

### 8.5 Bounded Queries

All intelligence queries are read-only and bounded by configurable limits (time, depth, result counts) to ensure deterministic performance.

---

## 9. Data Flow: End-to-End Workflow

```
Developer Intent
       │
       ▼
┌──────────────────┐
│  Intent Capture   │  Natural language → structured intent
└──────┬───────────┘
       │
       ▼
┌──────────────────┐
│  Specification   │  Formal spec with requirements, criteria, scope
└──────┬───────────┘
       │
       ▼
┌──────────────────┐
│    Approval      │  Gate decision (auto/manual/approval-gated)
└──────┬───────────┘
       │
       ▼
┌──────────────────┐
│   Task Plan      │  Task graph with dependencies, routing
└──────┬───────────┘
       │
       ▼
┌──────────────────┐
│  Context Build   │  Token-aware context package
└──────┬───────────┘
       │
       ▼
┌──────────────────┐
│   Delegation     │  Copilot execution with tracking
└──────┬───────────┘
       │
       ▼
┌──────────────────┐
│   Validation     │  Build/lint/test + acceptance criteria
└──────┬───────────┘
       │
       ▼
┌──────────────────┐
│     Review       │  Findings, decisions, completion modes
└──────┬───────────┘
       │
       ▼
┌──────────────────┐
│    Delivery      │  Commit plan, PR creation, delivery report
└──────────────────┘
```

---

## 10. Testing Architecture

| Test Suite | Location | Runner | Count |
|------------|----------|--------|-------|
| Unit Tests | `tests/unit/` | Vitest | 414 passing |
| Extension Tests | `tests/extension/` | Custom | — |
| UI Tests | `tests/ui/` | Vitest + React Testing Library | — |
| Integration Tests | `tests/integration/` | Vitest | — |
| Intelligence Benchmarks | `tests/fixtures/benchmarks/` | Custom | — |

---

## 11. Technology Stack

| Component | Technology |
|-----------|------------|
| Extension Runtime | VS Code API (v1.95.0+) |
| Language | TypeScript (entire codebase) |
| UI Framework | React 18 + Vite |
| Schema Validation | Zod |
| Testing | Vitest, React Testing Library |
| Compression | gzip (zlib) |
| Hashing | SHA-256 (crypto) |
| Build | Custom Node.js scripts (esbuild) |
| Linting | ESLint flat config |