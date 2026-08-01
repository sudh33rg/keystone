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
