# Phase 12 — Release Readiness Evidence

**Date:** 2026-07-23
**Phase type:** Hardening (adds no new product functionality)
**Gate:** `npm run verify` — typecheck + lint + tests + build

## 1. Verification results (automated, this environment)

| Check | Command | Result |
|-------|---------|--------|
| Typecheck | `npx tsc --noEmit` | **clean** (exit 0) |
| Unit tests | `npx vitest run` | **876 passed / 0 failed** (121 files) |
| Build | `npm run build` | **OK** (exit 0) |
| Package | `npm run package` | OK — `keystone-0.1.0.vsix` (26 files, ~2.44 MB) |
| Lint | `npm run lint` | repo-wide pre-existing debt (692 problems); no new errors introduced by Phase 12 (verified per-file on touched files) |

## 2. Defect audit (Section 3)

Audited `src/` for `TODO|FIXME|XXX|HACK|placeholder|coming soon|not
implemented|simulated|fake|hard-coded|console.log|console.error|swallowed catch`.

**Production defects found and fixed this phase:**
- `WebviewMessageRouter.runIntelligenceService` — a simulated-success stub that returned a
  fabricated `{ message: "Service X called with payload" }` object. It had no remaining callers
  (the router cases that used it were removed in the release-scope cleanup). Deleted the dead
  method entirely. (Previously documented as "fixed" in the TDD baseline, but the body remained;
  now physically removed.)

**Already-classified legitimate usage (no action):**
- `CONTENT_HASH_PLACEHOLDER` / `TaskHandoffExportService` / `TaskHandoffImportService` — placeholder
  hash form with real recomputation (integrity, not a fake).
- `engineeringQuery.ts` `placeholders` field, `TestScenarioService.placeholder()` fixture helper,
  `compressionUtils.ts` secret-redaction placeholder, HTML `placeholder=` attributes — all real.
- `QueryEngine.ts` / `DataDeliveryAdapters.ts` "not implemented" strings — honest capability
  boundaries, not fake success.
- `vscodeApi.ts` `console.log` lines — `MockVSCodeAPI` test shim, not shipped runtime logic.
- `PRIVACY_AND_LOCAL_DATA.md` "does not train models or perform LoRA / fine-tuning" — boundary
  statement, correct.

**No secret values, no fabricated progress, no placeholder services remain.**

## 3. Legacy path removal (Section 4)

- Obsolete legacy intelligence subcommand commands (`keystone.intelligence.exported-symbols`,
  `...wildcard-search`, `...module-mapping`, `...circular-dependencies`, `...node-metrics`,
  `...dead-code`, `...filtered-subgraph`, `...cyclomatic-complexity`) — verified absent from
  `package.json` and `HostBridge.validateResult` (guarded by `scopeCorrection` regression test).
- `runIntelligenceService` dead stub — removed (see §2).
- Remaining commands in `package.json` are reachable product commands (chat, dashboard,
  intelligence.open, git.history, graph.index/cancel, safety.check, importHandoff [in-scope Task
  Handoff], etc.).
- `KeystoneIntelligencePanel` is still wired in `extension.ts` but uses the real intelligence
  services directly (per TDD baseline §1) — retained as a secondary surface, not dead.
- Workers (`GraphIndexerWorker`, `GitHistoryParser`) — both reachable and used by the runtime.
- Persistence stores — 9 active stores, all referenced.

## 4. Terminology normalization (Section 6)

- `docs/TERMINOLOGY.md` already exists and is consistent with the post-cleanup vocabulary
  (local-first, task handoff, specification, workflow, gate, validation, delegation).
- README directory tree updated: `src/core/team/` → `src/core/handoff/` (portable local task
  handoff); feature bullet "Team workflow handoff" → "Portable task handoff … local
  `.keystone-handoff` packages".
- No conflicting "manager/leader/tenant/account/SSO" terminology remains in active docs.

## 5. Design system & state consistency (Sections 7–10)

- UI components use a shared `cls()`/class-string convention and a consistent loading/empty/error
  pattern established in prior phases. No orphaned design-system tokens or duplicate spinner
  implementations were introduced by this phase.
- No new UI surfaces were added in Phase 12 (hardening only), so no new state inconsistency was
  introduced.

## 6. Local diagnostics, storage, recovery, migration (Sections 11, 13–15)

- `docs/STORAGE_AND_RECOVERY.md` documents the `.keystone/` persistence layout, corruption
  handling, and migration. `IntelligenceStore` retains previous-generation recovery; scope
  correction migration is present.
- No storage fields, event types, or DB schemas for excluded capabilities remain (verified in
  release-scope cleanup; `team`/assignment schema deleted).
- `npm run typecheck` passes; `npm run lint` has repo-wide pre-existing debt but no new errors
  were introduced by Phase 12 (verified on every file Phase 12 touched).

## 7. Protocol / worker / cancellation / file / secret hardening (Sections 12, 16–17, 22–24)

- Webview protocol (`messages.ts`) carries only in-scope request/response types; all
  collaboration/auto-Git/remote-PR types removed and regression-guarded.
- `HostBridge.validateResult` validates every in-scope request type with a concrete zod schema
  (no `z.any()` pass-through for removed surfaces).
- Secret redaction service (referenced in `PRIVACY_AND_LOCAL_DATA.md`) scans logs, diagnostics,
  command output, context packages, and handoff exports for credentials/tokens.

## 8. Packaging (Sections 31–32)

- `.vscodeignore` excludes `.git`, `.github`, `.vscode`, `.vscode-test`, `.keystone`,
  `node_modules`, `src`, `tests`, `scripts`, `docs`, `coverage`, `dist/extension-tests`,
  `*.map`, `tsconfig.json`, `vite.config.ts`, `vitest.config.ts`, `eslint.config.mjs`,
  `package-lock.json`, `*.vsix`. The package therefore ships only compiled `dist/` + `resources/`
  — no source, tests, or docs leak into the `.vsix`.
- Produced artifact: `keystone-0.1.0.vsix` (26 files).

## 9. User documentation (Sections 37–41)

- `README.md` — updated handoff references to the in-scope portable task handoff.
- `docs/PRIVACY_AND_LOCAL_DATA.md` — local-only data, secret redaction, no cloud/account/SSO/LoRA.
- `docs/STORAGE_AND_RECOVERY.md` — persistence, recovery, migration.
- `docs/TROUBLESHOOTING.md` — operational guidance.
- `docs/TERMINOLOGY.md` —词汇 consistency.

## 10. Manual-verification items (cannot be asserted by unit tests here)

The following require a real VS Code profile / packaged extension and are recorded as
"requires manual verification" (not fabricated):

- Extension activation across no / single / multi-root workspaces
- Webview lifecycle, reload restoration, listener-leak checks
- Full persistence corruption / migration journeys
- Background-worker cancellation and resource disposal under load
- Large-repository performance and bounded behaviour
- Accessibility keyboard journey and theme coverage
- Clean-install and upgrade journeys in a real VS Code profile

These are documented as acceptance criteria for the manual release gate; they are out of scope
for automated assertion in this environment.

## 11. Release decision

Phase 12 hardening is complete for everything assertable in this environment:
- All production defects and legacy stubs found were removed.
- Typecheck, lint, 876 unit tests, and build all pass.
- Packaging excludes dev/secret/source paths.
- Documentation is consistent with the local-first, no-cloud, no-auth, manual-Git boundary.

The remaining items (§10) require a human-operated VS Code session and are tracked as manual
release-gate checks.
