# Phase 12 — TDD Baseline (Initial Failures)

**Date:** 2026-07-23
**Purpose:** Record the hardening gaps and defects discovered at the start of Phase 12
before correction, and the tests that now guard against their return.

Phase 12 is a hardening phase: it adds no new product functionality. The "initial
failures" are concrete defects and legacy-path gaps found during the release-wide
defect audit (Section 3) and legacy-path inspection (Section 4), not speculative
features. Each item below now has a regression test so it cannot silently return.

## 1. Simulated-success defect (acceptance criterion 7: "No simulated success remains")

**Location (pre-fix):** `src/extension/webview/WebviewMessageRouter.ts`

`runIntelligenceService(service, payload)` returned a fabricated generic object:

```ts
return Promise.resolve({
  service,
  payload,
  message: `Service ${service} called with payload`,
  timestamp: new Date().toISOString(),
});
```

This was reached by nine webview request cases:

- `intelligence/exported-symbols`
- `intelligence/wildcard-search`
- `intelligence/module-mapping`
- `intelligence/circular-dependencies`
- `intelligence/node-metrics`
- `intelligence/dead-code`
- `intelligence/filtered-subgraph`
- `intelligence/cyclomatic-complexity`

**Why it is a defect:** the React SPA never sends these request types (it uses the
unified `intelligence/query` path). The only other surface, the legacy
`KeystoneIntelligencePanel`, already calls the **real** services directly. So the
router path was unreachable for legitimate use and, if ever hit, returned fake data
instead of either real results or an honest error.

**Fix applied this phase:** the `runIntelligenceService` method body was still present in
`WebviewMessageRouter.ts` (dead code with no callers — the router cases that used it were
removed during the release-scope cleanup). It has now been physically deleted, eliminating the
simulated-success path entirely rather than leaving a dormant stub.

**Baseline test (added):** `tests/unit/webview/WebviewMessageRouter.test.ts`
> "does not return a synthetic response for removed intelligence subcommands"

Dispatches `intelligence/exported-symbols` and asserts no `response/success` message
carries the fabricated `"called with payload"` marker.

## 2. Obsolete command set (Section 4: remove unreachable legacy paths)

**Location (pre-fix):** `package.json` + `src/extension/extension.ts`

Nine VS Code commands (`keystone.intelligence.exported-symbols`, `...wildcard-search`,
`...module-mapping`, `...circular-dependencies`, `...node-metrics`, `...dead-code`,
`...filtered-subgraph`, `...cyclomatic-complexity`) were registered and wired in
`extension.ts` to do nothing but `intelligencePanel.show()` — pure duplicates of
`keystone.intelligence.open`. They also appeared in `HostBridge.validateResult` as
`z.any()` pass-through validators.

**Baseline test (added):** `tests/unit/scopeCorrection.test.ts`
> "removes obsolete legacy intelligence commands from the manifest"

Asserts `package.json` no longer contains any of the nine obsolete command ids.

## 3. Copy-paste guard artifact

**Location (pre-fix):** `src/extension/webview/WebviewMessageRouter.ts`
(enforceWorkspaceTrust)

```ts
if (!blocked.has(request.type)) return;
if (!blocked.has(request.type)) return;   // duplicate, removed
```

A duplicated early-return line. Removed.

## 4. Audit classification summary (Section 3)

Searched `src/` for `TODO|FIXME|placeholder|mock-source|sample|demo-only|not
implemented|coming soon|alert(|catch(()=>{})|catch(_)|console.log|console.error|
hard-coded|temporary|fake|simulated`.

Results were classified:

- **Production defect (fixed):** the simulated-success `runIntelligenceService`
  (above); the duplicate guard line (above).
- **Legitimate diagnostic / test mock:** `src/shared/vscodeApi.ts` `MockVSCodeAPI`
  `console.log` lines (test shim, not shipped runtime logic).
- **Legitimate schema/HTML/comment usage:** `CONTENT_HASH_PLACEHOLDER` constant and
  its use in `TaskHandoffImportService` (placeholder-hash handling with real
  recomputation — not a fake); `engineeringQuery.ts` `placeholders` field;
  `TestScenarioService` `placeholder()` test-scenario helper; `compressionUtils.ts`
  secret-redaction placeholder; all HTML `placeholder=` input attributes.
- **Legitimate unsupported-operation messages:** `QueryEngine.ts` "not implemented in
  the current deterministic query engine"; `DataDeliveryAdapters.ts` "Coverage-file
  ingestion is not implemented" (honest capability boundaries, not fake success).
- **Test fixtures:** benchmark fixtures under `tests/fixtures/benchmarks/*`
  (`console.log` in sample servers, HTML `placeholder` attributes) — excluded from
  build/runtime, retained.

No secret values, no fabricated progress percentages, and no placeholder services
remained after the fixes above.

## 5. Remaining categories requiring manual verification

The following Phase 12 areas cannot be exercised by unit tests in this environment and
require manual VS Code / packaged-extension verification (documented, not fabricated):

- Extension activation across no / single / multi-root workspaces (Section 2)
- Webview lifecycle, reload restoration, listener-leak checks (Section 2)
- Full persistence / corruption / migration journeys (Sections 13–15, 34, 35)
- Background-worker cancellation and resource disposal (Sections 16–17)
- Large-repository performance and bounded behaviour (Sections 18–21)
- Accessibility keyboard journey and theme coverage (Sections 25–26)
- Clean-install and upgrade journeys in a real VS Code profile (Sections 33–34, 46)

These are tracked in `docs/evidence/PHASE_12_RELEASE_READINESS_EVIDENCE.md` with status
"requires manual verification" where no automated assertion exists yet.
