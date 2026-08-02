# Keystone Architecture

Keystone is one local-first VS Code extension. The extension host owns the workspace runtime, application state, intelligence workers, SDLC engine, Task Handoff, and Copilot delegation boundary. The same web application is rendered inside VS Code and through **Open Keystone in Browser**.

```mermaid
flowchart TD
    FS[Repository and Workspace Events] --> W[Background Workers]
    W --> ING[Universal + Language-Aware Deterministic Ingestion]
    ING --> OKF[Validated Authoritative OKF Snapshot]
    OKF --> GRAPH[Knowledge Graph Projection]
    OKF --> CPG[Per-Artifact CPG Shards]
    OKF --> SEARCH[Search Projection]
    GRAPH --> QUERY[Evidence-Backed Query and Impact]
    CPG --> QUERY
    SEARCH --> QUERY
    QUERY --> CTX[Adaptive Context Compression]
    CTX --> SDLC[Intent Research + 16-Story SDLC]
    SDLC --> COPILOT[User-Approved Copilot Delegation]
    SDLC --> QA[QA / Security / Performance / Review]
    SDLC --> HANDOFF[Encrypted Task Handoff]
    STORE[Extension-Host Application Store] --> VSCODE[VS Code Webview]
    STORE --> BROWSER[Authenticated Loopback Browser View]
    VSCODE --> STORE
    BROWSER --> STORE
```

## Runtime ownership

- `src/extension/core/extension.ts` activates the extension.
- `src/extension/ui/vscodeProvider.ts` is the typed command bridge.
- `src/core/application/applicationStore.ts` owns synchronized UI state.
- `src/core/intelligence/` owns discovery, extraction, OKF, graph, CPG, query, impact, health, and persistence.
- `src/core/context/` owns intent-aware retrieval, ranking, deduplication, compression, and delegation packets.
- `src/core/workflow/sdlc/` owns the durable SDLC state machine.
- `src/core/workflow/handoff/` owns portable handoff contracts, redaction, integrity, and encryption.
- `src/extension/browser-view/` serves the same UI from a loopback-only authenticated session.

## State and command flow

The UI never owns authoritative product state. Both surfaces send typed commands to the extension host. The host validates commands, updates durable state, increments the state version, and broadcasts the same snapshot to all connected surfaces. Browser commands include the expected state version; stale commands are rejected.

## Background execution

Repository discovery and analysis are cancellable and yield to the event loop in batches. Unchanged files reuse persisted intelligence. Candidate snapshots are validated before atomic promotion, so cancellation or failure cannot replace the last known-good intelligence.

## Read-only Git boundary

All Git process execution is routed through read-only commands or read-only metadata stages. Remote merge-request creation and mutation are outside the runtime. Keystone prepares copyable review content; the user performs all writes.

## Data Flow and Event-Driven Architecture

Keystone follows an event-driven architecture with unidirectional data flow:

1. **Event Generation**: Repository and workspace events (file changes, additions, deletions) trigger ingestion
2. **Event Processing**: Background workers process events through a pipeline of deterministic extractors
3. **State Update**: Extracted knowledge is validated and promoted to the authoritative OKF snapshot
4. **Projection Generation**: The OKF snapshot is used to generate graph, CPG, and search projections
5. **Query Processing**: Queries are resolved using the projections, with adaptive context compression
6. **SDLC Execution**: Intent-led SDLC processes execute based on the processed intelligence
7. **UI Update**: UI surfaces (VS Code and Browser View) receive state updates and render them

This architecture ensures that:

- All state changes are deterministic and reproducible
- The system is resilient to interruptions (cancellation and failure don't corrupt state)
- Intelligence is never lost between sessions
- The same intelligence is available across all UI surfaces

## Context Compression

Context compression is a key component of Keystone's intelligence layer that enables efficient Copilot delegation:

1. **Intent Detection**: The system identifies the user's intent from the active story
2. **Evidence Gathering**: Relevant knowledge units from the OKF snapshot are collected
3. **Deduplication**: Redundant information is removed
4. **Ranking**: Evidence is ranked by relevance to the intent
5. **Structural Compression**: Information is compressed into a structured format
6. **Continuation Packets**: Large contexts are split into ordered packets for Copilot consumption

The compression algorithm preserves:

- All relevant evidence and provenance
- Semantic relationships between entities
- Contextual information about the repository
- The ability to trace results back to source code

This allows Keystone to handle repositories of any size while maintaining high-quality context for Copilot delegation.

## Intelligent Caching

Keystone employs a sophisticated caching system to optimize performance:

1. **File Hash Caching**: File content and structure hashes are cached to avoid reprocessing unchanged files
2. **Extraction Result Caching**: Results from language frontends are cached by file hash and extractor version
3. **Projection Caching**: Graph, CPG, and search projections are cached and only regenerated when OKF changes
4. **Query Result Caching**: Recent query results are cached with TTL-based invalidation
5. **Context Compression Caching**: Compressed context packets are cached by intent and file hash

The cache is stored in `.keystone/cache/` and is automatically invalidated when:

- File content changes
- Extractor versions update
- OKF snapshot is updated
- Configuration changes

This caching system enables near-instantaneous response times for subsequent operations on the same repository.

## Event-Driven Architecture

Keystone's event-driven architecture ensures that:

- All state changes are triggered by events
- Events are processed in a deterministic order
- Events can be replayed for debugging and testing
- The system can handle high volumes of events
- Events are logged for audit and debugging

The event system supports:

- Repository events (file changes, additions, deletions)
- User events (command execution, UI interactions)
- System events (state updates, validation results)
- External events (ValueEdge imports, Task Handoff restores)

Events are processed through a pipeline of handlers that:

1. Validate event structure and source
2. Transform event data into canonical format
3. Apply business logic and state updates
4. Generate new events as needed
5. Log events for audit and debugging

This architecture ensures that Keystone is highly responsive, scalable, and maintainable.
