# Keystone Engineering Ontology and Graph

## Purpose

The ontology defines what Keystone knows, how concepts are classified, which relationships are valid, and how evidence and uncertainty are represented. The semantic graph uses this ontology as the common model across languages, frameworks, databases, tests, documentation, Git, specifications, and CPG projections.

## Entity families

### Physical

Repository, Workspace, Project, Package, Module, Directory, File, SourceFile, TestFile, DocumentationFile, ConfigurationFile, SchemaFile, MigrationFile, InfrastructureFile, GeneratedFile, BinaryArtifact.

### Programming

Namespace, Class, Interface, Trait, Struct, Record, Enum, TypeAlias, Function, Method, Constructor, Property, Field, Variable, Constant, Parameter, Decorator, Annotation, Component, Hook, Template, Macro.

### Behavior

EntryPoint, UseCase, ExecutionFlow, Route, Endpoint, Middleware, Validator, Serializer, Command, Job, Scheduler, Event, EventHandler, Message, Queue, Producer, Consumer.

### Data

Database, Schema, Table, View, Column, Index, Constraint, ForeignKey, Entity, Model, RepositoryPattern, Query, StoredProcedure, Migration, Cache, RequestModel, ResponseModel, DataTransferObject.

### Quality

TestSuite, TestCase, Fixture, Mock, Stub, Assertion, CoverageRegion, QualityGate, LintRule, SecurityFinding, PerformanceFinding, CodeSmell, TechnicalDebtItem.

### Architecture

ArchitectureLayer, Subsystem, BoundedContext, Domain, Feature, Capability, Service, Library, Adapter, Port, Plugin, ExtensionPoint, PublicAPI, InternalAPI, ExternalSystem.

### Delivery and operations

BuildTarget, BuildCommand, TestCommand, Pipeline, Workflow, DeploymentUnit, Container, InfrastructureResource, EnvironmentVariable, ConfigurationKey, FeatureFlag, TelemetrySignal, Metric, LogEvent, TraceSpan.

### Knowledge and change

Requirement, Specification, AcceptanceCriterion, ArchitectureDecision, DesignConstraint, Convention, Rationale, Assumption, Risk, KnownLimitation, Runbook, Guide, Example, Branch, Commit, PullRequest, ChangeSet, FileChange, SymbolChange, SchemaChange, BreakingChange, Release, Version.

## Relationship families

### Structural

CONTAINS, DECLARES, BELONGS_TO, PART_OF, HAS_MEMBER, HAS_PARAMETER, HAS_FIELD, HAS_MODULE, HAS_LAYER.

### Code

IMPORTS, EXPORTS, REFERENCES, CALLS, INSTANTIATES, EXTENDS, IMPLEMENTS, OVERRIDES, DECORATES, RETURNS, ACCEPTS, THROWS, CATCHES.

### Behavior

ROUTES_TO, HANDLES, EMITS, CONSUMES, PRODUCES, VALIDATES_WITH, SERIALIZES_WITH, DESERIALIZES_WITH, TRIGGERS, PRECEDES, FOLLOWS, FLOWS_TO.

### Data

READS_FROM, WRITES_TO, QUERIES, MAPS_TO, PERSISTS, REFERENCES_COLUMN, HAS_FOREIGN_KEY, MIGRATES, CACHES, INVALIDATES.

### Quality

TESTS, COVERS, MOCKS, ASSERTS, VALIDATES, MAY_IMPACT, VIOLATES, COMPLIES_WITH, INTRODUCES_RISK, MITIGATES.

### Knowledge and change

DOCUMENTS, EXPLAINS, JUSTIFIES, CONSTRAINS, IMPLEMENTS_REQUIREMENT, SATISFIES_CRITERION, CONTRADICTS, SUPERSEDES, DERIVED_FROM, CITES, ADDED_IN, MODIFIED_IN, REMOVED_IN, RENAMED_TO, MOVED_TO, CHANGED_WITH, INVALIDATED_BY.

## Extensibility

Entity and relationship types use registered string identifiers rather than one closed TypeScript union. Core identifiers use the `keystone.core.*` namespace. Adapters may register namespaced types such as `keystone.framework.spring.Bean` or `keystone.orm.prisma.Model` while mapping them to core supertypes.

## Stable identity

Entity IDs must remain stable across restarts and unchanged edits. IDs should be derived from repository identity, entity type, normalized path, qualified name, signature where necessary, and language adapter identity. Line numbers must never be the sole identity component.

Example:

```text
entity:typescript:src/orders/order-service.ts:OrderService.create(string)
```

## Evidence model

Every entity and relationship has one or more evidence records containing:

- Source kind
- Path and source range
- Parser or rule ID and version
- Derivation: extracted, resolved, calculated, framework-rule, runtime-observed, or user-asserted
- Content hash
- Branch and commit
- Intelligence generation
- Confidence
- Human-readable statement

Extracted syntax and type facts usually have confidence 1.0. Naming-based or convention-based mappings must have lower confidence and explicit evidence.

## Knowledge levels

1. Raw extracted facts
2. Deterministically resolved relationships
3. Calculated intelligence such as centrality, cycles, impact, risk, and test relevance
4. Curated knowledge such as user annotations and approved architectural constraints

These levels must remain distinguishable in storage and UI.

## Graph projections

The canonical semantic graph supports multiple projections:

- Physical repository hierarchy
- Module and architecture graph
- Code dependency graph
- API and execution-flow graph
- Data and ORM graph
- Test coverage and impact graph
- Configuration and build graph
- Git change graph
- Specification traceability graph
- OKF concept graph

## Validation rules

The ontology registry validates:

- Allowed source and target entity families
- Required evidence
- Confidence range
- Branch and generation identity
- Duplicate edge handling
- Adapter namespace conflicts
- Invalid self-relationships
- Orphaned entities

The system must omit uncertain relationships rather than inventing them. Unresolved references are stored as diagnostics or unresolved entities with clear status.
