# Keystone Improvement Roadmap

> **Version:** 0.1.0 | **Date:** 2026-07-20 | **Based on:** Gap Analysis of 52+ source files

## Overview

This document outlines a phased improvement plan for Keystone, organized into four phases over approximately 6-9 months. Each phase builds on the previous, prioritizing foundational infrastructure before feature work.

---

## Phase 0: Quick Wins (Weeks 1-2)

Low-effort, high-impact improvements that can be implemented immediately.

| # | Improvement | Effort | Impact | Details |
|---|-------------|--------|--------|---------|
| 0.1 | Pre-commit hooks | 1h | Medium | Add husky + lint-staged for auto-formatting and linting on commit |
| 0.2 | Code coverage thresholds | 30m | Medium | Configure Vitest coverage with minimum 70% threshold |
| 0.3 | CONTRIBUTING.md | 1h | High | Document setup, coding standards, PR workflow, testing requirements |
| 0.4 | Commit convention enforcement | 1h | Medium | Add commitlint with Conventional Commits |
| 0.5 | ESLint complexity rules | 30m | Low | Add cyclomatic complexity and max-lines rules |
| 0.6 | Dependency vulnerability scan | 30m | High | Add `npm audit` to CI or use Snyk/GitHub Dependabot |
| 0.7 | Loading states in UI | 2h | High | Add skeleton screens and loading indicators to all async views |
| 0.8 | Health check service | 3h | Medium | Create simple health check endpoint for service status |

**Total Phase 0: ~10 hours**

---

## Phase 1: Foundation (Weeks 3-8)

Address critical architectural gaps that block further progress.

### 1.1 Dependency Injection Container

**Priority:** 🔴 Critical
**Effort:** 2-3 weeks
**Description:** Replace manual service wiring in `extension.ts` with a proper DI container.

**Implementation Plan:**
1. Evaluate options: `tsyringe` (lightweight, decorator-based), `inversify` (full-featured), or custom container
2. Define service lifecycle annotations (singleton, transient, scoped)
3. Refactor all services to use constructor injection
4. Create container configuration module
5. Update `extension.ts` to bootstrap from container
6. Add service resolution validation at startup

**Benefits:**
- Testable services (mock dependencies via container)
- Reduced coupling in activation code
- Scoped lifetimes for proper resource management
- Easier to add new services

### 1.2 Event Bus / Pub-Sub System

**Priority:** 🟠 High
**Effort:** 1-2 weeks
**Description:** Implement a typed event bus for decoupled service communication.

**Implementation Plan:**
1. Define `EventBus` interface with typed events
2. Create `InMemoryEventBus` implementation
3. Define domain events: `WorkflowStarted`, `TaskCompleted`, `ValidationFailed`, `DeliveryPushed`, etc.
4. Integrate with DI container for automatic subscription
5. Add event logging and monitoring

**Benefits:**
- Decoupled service architecture
- Cross-cutting concerns (logging, metrics, audit) via event subscribers
- UI can subscribe to events for real-time updates
- Easier to add new features without modifying existing services

### 1.3 Metrics & Telemetry Infrastructure

**Priority:** 🔴 Critical
**Effort:** 2-3 weeks
**Description:** Build a metrics collection and reporting system.

**Implementation Plan:**
1. Define metrics types: counters, gauges, histograms, timers
2. Create `MetricsCollector` service
3. Instrument key operations:
   - Workflow lifecycle durations
   - Intelligence query latencies
   - Delegation success/failure rates
   - Validation pass/fail rates
   - Persistence read/write throughput
4. Add structured logging with correlation IDs
5. Create metrics dashboard in webview
6. Optional: Export to OpenTelemetry or VS Code telemetry

**Benefits:**
- Data-driven optimization decisions
- Performance regression detection
- Usage analytics for feature prioritization
- Better debugging and diagnostics

### 1.4 Comprehensive State Machine Testing

**Priority:** 🔴 Critical
**Effort:** 2-3 weeks
**Description:** Add comprehensive unit tests for all state machines.

**Implementation Plan:**
1. Create state machine test utilities (transition matrix, invariant checker)
2. Test all valid transitions for each state machine
3. Test all invalid transitions (error handling)
4. Test edge cases: timeouts, cancellations, concurrent operations
5. Add property-based tests for state machine invariants
6. Achieve >90% branch coverage on state machine code

**State Machines to Cover:**
- DevelopmentWorkflowService (10-stage startup)
- TaskExecutionService (17 states)
- OrchestrationService (20+ transitions)
- Workflow lifecycle (8 stages)

---

## Phase 2: Quality & Observability (Weeks 9-16)

Build on the foundation to improve testing, observability, and developer experience.

### 2.1 CI/CD Pipeline

**Priority:** 🟠 High
**Effort:** 1-2 weeks
**Description:** Set up GitHub Actions for automated build, test, and publish.

**Implementation Plan:**
1. Create GitHub Actions workflow for PR validation (lint → typecheck → test → build)
2. Add branch protection rules
3. Create release workflow (tag → build → publish to VS Code Marketplace)
4. Add code coverage reporting (Codecov or Coveralls)
5. Add automated changelog generation from Conventional Commits

### 2.2 Integration Tests for Core Workflows

**Priority:** 🟠 High
**Effort:** 2-3 weeks
**Description:** Add integration tests for the primary user workflows.

**Implementation Plan:**
1. Create test fixtures for repository scenarios
2. Test delegation flow: context → prompt → execution → change tracking → validation
3. Test delivery flow: commit plan → git operations → PR creation
4. Test handoff flow: draft → privacy scan → export → import → acceptance
5. Test intelligence: indexing → querying → staleness detection
6. Test persistence: save → load → recovery → migration

### 2.3 Persistence Migration System

**Priority:** 🟠 High
**Effort:** 1-2 weeks
**Description:** Add formal schema migration support to persistence stores.

**Implementation Plan:**
1. Create `MigrationRegistry` with versioned migrations
2. Add migration metadata to each store
3. Implement automatic migration on load (with rollback on failure)
4. Add migration testing utilities
5. Create migration for current schema to v1

### 2.4 Intelligence Query Caching

**Priority:** 🟠 High
**Effort:** 1-2 weeks
**Description:** Add caching layer for intelligence queries.

**Implementation Plan:**
1. Create `QueryCache` with configurable TTL and LRU eviction
2. Cache frequent query types: search, entity lookup, usages
3. Add cache invalidation on intelligence snapshot changes
4. Add cache hit/miss metrics
5. Add cache configuration options

### 2.5 Security Audit Trail

**Priority:** 🟠 High
**Effort:** 1 week
**Description:** Add comprehensive security audit logging.

**Implementation Plan:**
1. Define audit event types: config change, permission change, tool execution, sensitive data access
2. Create `AuditService` with append-only log storage
3. Add audit events to all security-relevant operations
4. Create audit log viewer in webview
5. Add audit log export functionality

### 2.6 Design System & Accessibility

**Priority:** 🟠 High
**Effort:** 2-3 weeks
**Description:** Create a shared design system with accessibility compliance.

**Implementation Plan:**
1. Define design tokens (colors, typography, spacing, shadows)
2. Create base component library (Button, Input, Modal, Table, Card, etc.)
3. Add keyboard navigation support
4. Add ARIA labels and roles
5. Test with screen readers
6. Add dark mode support

---

## Phase 3: Advanced Features (Weeks 17-28)

Add significant new capabilities that differentiate Keystone.

### 3.1 Plugin/Extension API

**Priority:** 🟠 High
**Effort:** 3-4 weeks
**Description:** Create a plugin API for third-party extensions.

**Implementation Plan:**
1. Define plugin interface: `KeystonePlugin` with lifecycle hooks
2. Create plugin registry and loader
3. Define extension points:
   - Custom validators
   - Custom delivery providers
   - Custom intelligence sources
   - Custom workflow stages
   - Custom UI panels
4. Create plugin SDK package
5. Document plugin development guide
6. Create example plugins

### 3.2 Feature Flag System

**Priority:** 🟠 Medium
**Effort:** 1-2 weeks
**Description:** Add feature flag infrastructure for gradual rollout.

**Implementation Plan:**
1. Create `FeatureFlagService` with flag definitions
2. Support flag sources: configuration, environment, user settings
3. Add A/B testing support
4. Create feature flag UI in webview
5. Add flag evaluation metrics

### 3.3 Offline Mode

**Priority:** 🟠 Medium
**Effort:** 2-3 weeks
**Description:** Support core workflows without Copilot API access.

**Implementation Plan:**
1. Define offline capabilities: specification editing, task planning, manual execution
2. Create offline queue for delegation requests
3. Add sync mechanism when connectivity is restored
4. Add offline indicator in UI
5. Add conflict resolution for offline changes

### 3.4 Streaming Copilot Responses

**Priority:** 🟡 Medium
**Effort:** 1-2 weeks
**Description:** Stream Copilot responses incrementally for faster feedback.

**Implementation Plan:**
1. Update Copilot adapter to support streaming
2. Add progressive UI updates during delegation
3. Add early cancellation based on streaming output
4. Add streaming metrics

---

## Phase 4: Polish & Scale (Weeks 29-36)

Focus on performance, reliability, and ecosystem.

### 4.1 Performance Optimization

**Priority:** 🟡 Medium
**Effort:** 3-4 weeks
**Description:** Systematic performance optimization based on metrics.

**Target Areas:**
- Intelligence query latency (target: <100ms for common queries)
- Context compression speed (target: <500ms for typical context)
- Persistence read/write (target: <50ms for common operations)
- Webview load time (target: <1s initial render)
- State machine transition (target: <10ms per transition)

### 4.2 Error Tracking Integration

**Priority:** 🟡 Medium
**Effort:** 1 week
**Description:** Integrate with error tracking service.

**Implementation Plan:**
1. Add Sentry or Bugsnag SDK
2. Create error boundary components in UI
3. Add source map upload to build pipeline
4. Create error reporting configuration UI
5. Add user feedback mechanism for errors

### 4.3 Localization / i18n

**Priority:** 🟡 Medium
**Effort:** 2-3 weeks
**Description:** Add internationalization support.

**Implementation Plan:**
1. Add i18n library (react-intl or i18next)
2. Extract all UI strings to translation files
3. Create language selection UI
4. Add initial translations (Japanese, Chinese, German, French, Spanish)
5. Add translation workflow documentation

### 4.4 API Documentation Generation

**Priority:** 🟠 High
**Effort:** 1-2 weeks
**Description:** Generate API documentation from Zod schemas.

**Implementation Plan:**
1. Create documentation generator from Zod schemas
2. Generate TypeScript type documentation
3. Generate JSON Schema from Zod schemas
4. Create documentation website or VS Code integration
5. Add schema annotations for documentation

### 4.5 Fuzz & Property-Based Testing

**Priority:** 🔵 Low
**Effort:** 1-2 weeks
**Description:** Add property-based testing for core invariants.

**Implementation Plan:**
1. Add fast-check library
2. Create property tests for:
   - Zod schema serialization/deserialization roundtrips
   - State machine invariants
   - Persistence save/load integrity
   - Context compression losslessness
3. Integrate with CI pipeline

---

## Timeline Summary

```
Week  1-2  │ Phase 0: Quick Wins
Week  3-8  │ Phase 1: Foundation (DI, Events, Metrics, Testing)
Week  9-16 │ Phase 2: Quality & Observability (CI/CD, Integration Tests, Caching, Security)
Week 17-28 │ Phase 3: Advanced Features (Plugins, Offline, Collaboration, Webhooks)
Week 29-36 │ Phase 4: Polish & Scale (Performance, i18n, Error Tracking, Fuzz Testing)
```

## Resource Estimates

| Phase | Duration | Effort (Person-Weeks) | Dependencies |
|-------|----------|----------------------|--------------|
| Phase 0 | 2 weeks | 1-2 | None |
| Phase 1 | 6 weeks | 8-12 | Phase 0 |
| Phase 2 | 8 weeks | 8-12 | Phase 1 |
| Phase 3 | 12 weeks | 12-18 | Phase 1 |
| Phase 4 | 8 weeks | 8-12 | Phase 1, Phase 2 |

**Total Estimated Effort: 37-56 person-weeks over ~9 months**

## Risk Assessment

| Risk | Likelihood | Impact | Mitigation |
|------|------------|--------|------------|
| DI container migration breaks existing services | Medium | High | Incremental migration with comprehensive tests |
| Plugin API design is wrong | Medium | High | Start with minimal API, iterate based on feedback |
| Real-time collaboration is complex | High | Medium | Start with async collaboration, add real-time later |
| Performance optimization is insufficient | Low | Medium | Establish performance budgets early, measure continuously |
| Feature flag system adds complexity | Low | Low | Keep flag system simple, avoid flag debt |

## Success Metrics

| Metric | Current | Target (Phase 4) |
|--------|---------|-------------------|
| Test count | 414 | >1000 |
| Code coverage | Unknown | >80% |
| State machine test coverage | Unknown | >90% branch coverage |
| Intelligence query latency | Unknown | <100ms (p95) |
| Context compression time | Unknown | <500ms |
| Webview load time | Unknown | <1s |
| Number of plugins | 0 | >5 community plugins |
| Accessibility score | Unknown | >90 (Lighthouse) |
| Localization languages | 1 (en) | >5 |