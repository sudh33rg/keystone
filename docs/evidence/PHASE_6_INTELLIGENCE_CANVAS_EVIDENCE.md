# Phase 6 — Intelligence Canvas evidence

## Scope and outcome

Phase 6 replaces the primary Intelligence interaction with one bounded, evidence-backed canvas. It adds repository entity search, five visualization modes, deterministic engineering-query parsing, node and edge inspection, incremental graph expansion, source navigation, and bounded Development scope/context actions. It does not add change impact analysis, QA execution, test generation or healing, security/performance review, PR review, or handoff features.

## Test-first record

The failing baseline is recorded in [PHASE_6_TDD_BASELINE.md](./PHASE_6_TDD_BASELINE.md). The first focused run failed because the graph-slice service, engineering-query service, and canvas component did not exist. Production implementation followed those failures.

Added coverage includes:

- graph roots, inbound/outbound traversal, relationship filters, depth/node/edge bounds, truncation, evidence IDs, stable IDs, duplicate relationship grouping, stale revisions, and unknown IDs/types;
- exact/partial entity search, ranking, ambiguity, bounded/no-match behavior, and no fabrication;
- all seven supported query intents, wording variations, ambiguity, missing subjects/targets, no path, unsupported questions, evidence-backed results, and bounds;
- canvas empty/search/selection/edge evidence/expand/collapse/filter/depth/query/truncation/source/scope/context behaviors;
- typed extension-host protocol routing and same-origin CSP support for lazy webview chunks;
- persisted bounded Intelligence selections and readable `call-flow` context regeneration.

Final automated results on 22 July 2026:

| Gate | Verified result |
|---|---|
| `npm ci` | Passed; 638 packages, zero reported vulnerabilities |
| `npm run typecheck` | Passed |
| `npm test` | Passed; 96 files, 712 tests, zero failures |
| `npm run build` | Passed |
| `npm run test:extension` | Passed in VS Code 1.95.0 Extension Development Host; exit code 0 |
| `npm run package` | Passed; 24-file, 2.38 MB VSIX |

Artifact: `keystone-0.1.0.vsix`  
SHA-256: `9bde034e1b8ad0c6f4ff45bbdb2a2bcd87050842668f5ca507105783cdf4346d`

## Existing services inspected and canonical path

The existing `IntelligenceVisualizationService`, `ArchitectureViewBuilder`, `DependencyViewBuilder`, `CallViewBuilder`, `FlowViewBuilder`, `ImpactViewBuilder`, `EngineeringQueryExecutor`, evidence records, and snapshot indexes were inspected. They read real snapshot data, but the previous `SemanticBrowser`/`QueryWorkspace` UI made compiled-query/debug output the main experience and did not provide the required bounded interactive workflow.

The new canonical transport path is `IntelligenceGraphSliceService` plus `IntelligenceEngineeringQueryService`. The architecture request reuses `ArchitectureViewBuilder`; the general modes traverse stored snapshot relationships directly so direction, requested relationship types, confidence, evidence, and hard bounds remain explicit. `BaseViewBuilder` was corrected to use the actual stored repository entity. The old components remain available for non-primary compatibility but are no longer mounted as the main Intelligence workspace. No impact builder is exposed by this phase.

## Graph library and transport boundary

`@xyflow/react` was selected because it supports React-controlled nodes/edges, pan, zoom, fit view, selection, incremental updates, custom presentation, and works without remote resources inside a VS Code webview. Host contracts remain library-neutral; conversion to React Flow node/edge types happens only in `IntelligenceCanvasWorkspace`.

The final lazy `IntelligenceOverview` chunk is 208.14 kB (65.40 kB gzip), with an 817.62 kB source map. The main app chunk remains separate at 481.42 kB (125.67 kB gzip). A clean library-only delta was not retained, so no isolated dependency-size claim is made. Lazy loading confines the graph implementation to the Intelligence destination. The packaged VSIX is 2.38 MB.

The layout is a deterministic grid and preserves existing nodes when slices merge. Per-request defaults are depth 1, 75 nodes, and 150 edges; hard validation caps are depth 4, 200 nodes, and 400 edges. Reaching a node or edge limit returns explicit truncation flags and expandable entity IDs. Focused expansion requests only a depth-one branch and merges by stable real IDs.

React Flow's visual canvas has limited native screen-reader semantics. Keystone therefore exposes keyboard-focusable node and edge indexes plus a relationship-list alternative. This is a complementary access path, not a claim that arbitrary canvas navigation is fully screen-reader equivalent.

## Supported model and queries

Presentation node kinds are repository, package, module, file, class, interface, function, method, route, test, database, external-system, and unknown. Stored entities are mapped to these bounded presentation types; IDs, source ranges, confidence, inferred status, and expansion availability are preserved.

Supported relationships are contains, imports, depends-on, calls, implements, extends, routes-to, tested-by, reads, writes, flows-to, and unknown. Duplicate source/type/target relationships are grouped while preserving the union of evidence IDs, the highest confidence, and inferred status.

The parser intentionally supports exactly these intents:

1. Show callers of X
2. Show callees of X
3. Show dependencies of X
4. Show dependents of X
5. Show tests for X
6. Show flow from X to Y
7. Explain relationship between X and Y

Case-insensitive tested variations include “Who calls X?”, “What does X call?”, “What depends on X?”, “Which tests cover X?”, and “How does X reach Y?”. Matching zero or multiple real entities returns a truthful selection state. Unsupported text returns the supported-intents message and does not invoke an LLM or fabricate a graph. Test results are described as static Intelligence mappings, never runtime coverage.

Flow and relationship queries use a bounded breadth-first path over stored relationships. Returned paths contain ordered entity IDs, edge IDs, and evidence IDs. The context representation is readable steps/evidence text rather than graph JSON and does not claim runtime ordering beyond stored evidence.

## Evidence, source, and Development integration

Selecting an edge resolves its stored evidence IDs and displays file path, source-derived excerpt, provider, evidence type, and confidence. Source-open requests send only an entity or evidence ID plus Intelligence revision. The extension host resolves and validates the workspace file/range before opening it; arbitrary webview paths are not accepted.

Node scope actions reuse the existing Phase 3 source-scope service and duplicate validation. Node/path context actions persist bounded Intelligence selections on the active Development work item, invalidate an existing context approval, and require regeneration. A path stores entity IDs, edge IDs, evidence IDs, a label, revision, and readable content. Context token metrics include retained `call-flow` items.

The canvas carries the Intelligence revision on slices and queries. A later repository revision leaves the existing graph visible, marks it stale, and offers `Refresh Result`.

## Three real fixture examples

These examples were executed in the real VS Code 1.95.0 Extension Development Host against `/tmp/keystone-phase6-fixture`, generation 1, commit `7fc7c27e9171`. The fixture was indexed by the installed development extension; values below came from the rendered webview and persisted Intelligence store.

### 1. Callees

- Entity searched/query executed: `postOrders` / `Show callees of postOrders`
- Resolved IDs: `entity:f902100faa9b1264d9648c9a2dbfe76b` → `entity:e2c3d9822d68f08ad685444d8a8d36c1`
- Nodes/edges returned: 2 nodes, 1 `calls` edge (`relationship:4b446ac3c8ddfeacb23d144057ed5ac0`)
- Evidence inspected: `evidence:61eca41558c60570438299d71b20d2db`, `src/orders.ts`, provider `keystone.typescript`, confidence 1.00
- Source opened: verified; VS Code opened `src/orders.ts` at the evidence location

### 2. Callers

- Entity searched/query executed: `OrderService.create` / `Show callers of OrderService.create`
- Resolved IDs: target `entity:e2c3d9822d68f08ad685444d8a8d36c1`; callers `entity:f902100faa9b1264d9648c9a2dbfe76b` and `entity:bdf472700d09abc149444be73acf6096`
- Nodes/edges returned: 3 nodes, 2 `calls` edges
- Evidence inspected in store: `evidence:61eca41558c60570438299d71b20d2db` and `evidence:400fbb6b02391d82ea61bc170c45f1c3`
- Source opened: the shared `src/orders.ts` source target was verified in example 1

### 3. Dependencies

- Entity searched/query executed: `module:src/orders.ts` / `Show dependencies of module:src/orders.ts`
- Resolved IDs: `entity:a30780301899aed7dfd9b9c0030eb11e` → `entity:dc20eefcd6b8131785ffaa13966d2cd2`
- Nodes/edges returned: 2 nodes, 1 `depends-on` edge (`relationship:243db1a0b0c803995d35d3ac2afc3926`)
- Evidence inspected in store: `evidence:23f92fba74c1ae351ea09a8899a80929`
- Source opened: module source resolution is covered by the same host-validated source route; this exact dependency source was not manually opened

## Manual Extension Development Host review

Verified manually/through CDP against the visible real Extension Development Host:

- Home and Intelligence load from a packaged-style production webview build.
- The fixture indexed 5 files, 33 symbols, 85 relationships, and 125 evidence records.
- Empty state, real search candidates, ambiguous same-name candidates, call graph, fit view, node inspector, edge evidence, unsupported-query message, and relationship-list alternative rendered.
- `postOrders → OrderService.create` displayed as a proven confidence-1.00 call and its `src/orders.ts` evidence opened in the VS Code editor.
- The initial host run exposed a real CSP failure for the lazy Intelligence chunk. The webview CSP now permits the extension's own `webview.cspSource` while retaining the nonce, and a regression test covers it.

Inspected screenshots:

- `docs/evidence/screenshots/phase6/host-initial.png`
- `docs/evidence/screenshots/phase6/intelligence-empty-dark-host.png`
- `docs/evidence/screenshots/phase6/intelligence-search-results-dark-host.png`
- `docs/evidence/screenshots/phase6/intelligence-full-editor-dark-host.png`
- `docs/evidence/screenshots/phase6/intelligence-node-inspector-dark-host.png`
- `docs/evidence/screenshots/phase6/intelligence-edge-evidence-dark-host.png`
- `docs/evidence/screenshots/phase6/intelligence-unsupported-query-dark-host.png`
- `docs/evidence/screenshots/phase6/intelligence-accessible-list-dark-host.png`

## Known limitations

- The deterministic grid is intentionally conservative; it is not an automatic hierarchical layout, and large slices rely on focused expansion, filtering, pan/zoom, and fit view.
- The full visual matrix was not falsely claimed: light/high-contrast themes, a forced truncation state, a live stale-revision transition, and live Add-to-Scope/Add-to-Context with an active Development item were not captured as real-host screenshots in this pass. Their contracts and state behavior are covered by automated tests.
- The relationship-list alternative exposes stored relationships as keyboard-focusable controls and text, but it does not yet reproduce every graph-inspector action inline in each list row.
- A clean pre-library bundle measurement was not retained, so the evidence reports final chunks rather than attributing an imprecise delta solely to React Flow.
- Architecture grouping is representative and bounded. Call/dependency/flow modes preserve exact stored entities and relationships; no runtime topology is inferred.
