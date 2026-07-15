# Keystone Code Property Graph Design

## Role of the CPG

The Code Property Graph is Keystone's deep executable-code analysis substrate. It is not the entire cognitive brain. The repository-wide engineering semantic graph remains the primary system-level model, while the CPG provides statement-level syntax, control-flow, and data-flow intelligence.

## Layered design

```text
Source code
  ↓
Language frontend
  ↓
Fine-grained CPG
  ↓ projection
Engineering semantic graph
  ↓ rendering
Detailed views and OKF
```

## Base CPG overlays

- Abstract syntax tree
- Type and reference information
- Call graph
- Evaluation order
- Control-flow graph
- Control dependence
- Local data flow
- Parameter, argument, and return flow

## Keystone overlays

- Framework routes and handlers
- Dependency injection
- Frontend components and state
- ORM mappings
- Message and event handlers
- Test and coverage mappings
- Security source and sink models
- Performance rules
- Architecture membership
- Git changes
- Specification and task traceability

## Progressive construction

Keystone should not eagerly build the deepest possible CPG for every file during initial ingestion.

### Whole repository

Build file, symbol, import, export, reference, call, type, route, test, data, and configuration intelligence.

### Persistent fine-grained CPG

Build for changed, public, central, high-risk, active-editor, and task-relevant code.

### On-demand analysis

Build and cache deeper control-flow, data-flow, and interprocedural slices when a query requires them.

### Explicit scans

Repository-wide security or quality analysis may request expanded CPG coverage.

## Initial language scope

The first deep provider targets TypeScript, JavaScript, TSX, and JSX using the TypeScript Compiler API and framework adapters. Other languages use structural adapters initially and can later receive native semantic or external CPG providers.

## Provider abstraction

The canonical graph must not depend on a provider-specific node schema.

```ts
interface CodeAnalysisProvider {
  capabilities(): LanguageCapability[];
  build(request: BuildAnalysisRequest): Promise<AnalysisArtifact>;
  update(request: UpdateAnalysisRequest): Promise<AnalysisDelta>;
  callers(symbolId: string): Promise<CallRelation[]>;
  callees(symbolId: string): Promise<CallRelation[]>;
  controlFlow(symbolId: string): Promise<ControlFlowResult>;
  dataFlow(query: DataFlowQuery): Promise<DataFlowResult>;
  slice(query: SliceQuery): Promise<ProgramSlice>;
  findings(query: FindingQuery): Promise<StaticFinding[]>;
}
```

## Sharding

CPG data is partitioned by file or executable unit and stored as compressed local shards. Each shard is keyed by source hash, parser version, CPG schema version, and analysis options. Unchanged shards are reused.

## Incremental invalidation

A method-body edit invalidates its local AST, CFG, data flow, direct calls, evidence ranges, and affected slices. A signature or export change also invalidates caller resolution, interface relationships, tests, flows, and impact indexes. Unrelated modules are not rebuilt.

## Query capabilities

- Callers and callees
- Control-flow visualization
- Forward and backward slicing
- Source-to-sink data flow
- All paths that update a field
- Branches not covered by tests
- Authentication domination checks
- Secret-to-log flow
- Untrusted input to SQL or filesystem sinks
- Value origin and propagation

## Limits and uncertainty

Dynamic dispatch, reflection, dependency injection, metaprogramming, generated code, runtime loading, and external systems create uncertainty. Results must distinguish exact, resolved, approximated, and unresolved paths. Runtime traces and test coverage may overlay static analysis but do not replace it.

## UI boundary

The UI must not render the entire fine-grained CPG. It renders bounded control-flow, data-flow, or slice views for selected entities, while general browsing uses the semantic graph.
