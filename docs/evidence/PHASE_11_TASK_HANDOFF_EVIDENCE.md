# Phase 11 — Task Handoff: Evidence

Status: **VERIFIED**. Acceptance criteria from the Phase 11 spec are satisfied by a
deterministic, host-side engine and a UI action nested inside an active workflow.
No Git writes, no accounts/SSO/cloud/tokens/remote sync occur. All file I/O is
performed by the host; the webview never writes or reads packages itself.

## Files

| Layer | File | Role |
|---|---|---|
| Contract | `src/shared/contracts/handoff.ts` | Explicit transport schema, `HandoffError` codes, canonical stable serialization, limits |
| Persistence | `src/core/persistence/HandoffPersistenceStore.ts` | Draft/export/import/acceptance history, survives restart |
| Privacy | `src/core/handoff/HandoffPrivacyService.ts` | Deterministic secret scan + redaction policy |
| Identity | `src/core/handoff/RepositoryIdentityService.ts` | Bounded, path-independent repository identity + `compare()` |
| Export | `src/core/handoff/TaskHandoffExportService.ts` | Assemble, normalize paths, gate on privacy, hash, atomic write |
| Import | `src/core/handoff/TaskHandoffImportService.ts` | `verify`/`analyzeCompatibility`/`preview`/`accept`/`reject` |
| Orchestrator | `src/core/handoff/TaskHandoffService.ts` | Eligibility, draft lifecycle, glue to real persisted state |
| Protocol | `src/shared/contracts/messages.ts` (`taskHandoff/*`) | Typed request + response maps |
| Router | `src/extension/webview/WebviewMessageRouter.ts` | `taskHandoff/*` cases + `requireTaskHandoff()` |
| Extension | `src/extension/extension.ts` | Constructs `handoffStore` + `handoffService`; registers `taskHandoff` |
| UI | `src/ui/components/workbench/TaskHandoffWorkspace.tsx` | Self-contained handoff panel |
| UI entry | `src/ui/components/workbench/ActiveWork.tsx` | "Task Handoff" button (active workflows only) — NOT a top-level destination |

## Verified behaviors (unit tests, `tests/unit/handoff/` — 35 passing)

1. **Privacy scan** detects tokens, connection strings, auth headers, cookies,
   passwords, absolute paths, emails, and path traversal; masks previews; flags
   high-confidence critical findings as blocking.
2. **Repository identity** is path-independent (normalized remote URL hash, bounded
   manifest hashes, root count). Relocation to a different folder does not change
   identity. Zero manifest overlap with no Git metadata → `incompatible`.
3. **Export** produces a schema-valid `TaskHandoffPackage` with `schemaVersion`,
   `package.contentHash` (`sha256:`), and RFC-3339 `createdAt`. Blocks when the
   workflow is not `active`, when no progress summary / next action is present,
   and when a high-confidence secret is open. Does not mutate workflow state.
4. **Integrity**: the recorded `contentHash` excludes the hash field itself; a
   tampered package is rejected on `verify()` (`package-integrity-failed`).
5. **Import compatibility**: same repository → `exact-match`; probable/ambiguous
   matches require explicit confirmation; `incompatible` repositories cannot be
   accepted (`import-blocked`). ZIP-slip / absolute-escape paths are rejected.
6. **History**: one non-superseded active outgoing draft per workflow
   (`hasActiveDraft`); history survives a simulated restart.
7. **Orchestrator**: end-to-end draft → update → export → import → accept flow;
   non-active workflows are rejected for drafting (`handoff-not-eligible`).

## Representative exported package (canonical excerpt)

```jsonc
{
  "schemaVersion": 1,
  "package": {
    "id": "0e1f…uuid",
    "createdAt": "2026-07-23T00:00:00.000Z",
    "contentHash": "sha256:9f2c…64hex",
    "keystoneVersion": "1.0.0"
  },
  "repository": {
    "repositoryName": "keystone",
    "identityHash": "sha256:3ab1…64hex",
    "roots": [{ "logicalName": "root:1", "relativeMarkerHash": "sha256:…" }],
    "git": { "remoteIdentityHash": "sha256:normalized-remote" },
    "manifestHashes": []
  },
  "workflow": {
    "workflowId": "00000000-0000-4000-8000-000000000001",
    "intentText": "Add retry with backoff",
    "workType": "feature",
    "specificationText": "Implement a resilient client",
    "specificationRevision": 1,
    "status": "active",
    "stages": [
      { "id": "1111…", "type": "development", "displayName": "Development", "order": 1, "status": "completed" },
      { "id": "2222…", "type": "qa", "displayName": "QA", "order": 2, "status": "in-progress" }
    ],
    "currentStageId": "2222…",
    "revision": 3
  },
  "progress": {
    "progressSummary": "Implemented backoff; QA in progress.",
    "completedWork": ["Development"],
    "unresolvedWork": [],
    "blockers": [],
    "assumptions": [],
    "nextAction": {
      "title": "Review failing test",
      "description": "Fix the auth contract mismatch in QA.",
      "stageId": "2222…"
    }
  },
  "evidence": { "evidenceIncluded": false, "findingsAndRemediation": [], "contextPackages": [] },
  "references": { "files": [], "symbols": [], "instructions": [], "skills": [], "intelligenceRevision": "gen-0" },
  "continuity": { "sourceScope": [], "instructionReferences": [], "unresolvedIssues": [], "changedFileAssociations": [] }
}
```

The package is written as pretty-printed JSON with a `.keystone-handoff` extension.
All paths are workspace-relative or null; no absolute user paths, credentials, or
tokens are ever serialized (the privacy gate blocks export otherwise).

## UI flow (no top-level navigation)

1. Open an active Keystone workflow → `ActiveWork` shows a **Task Handoff** button
   (only when `status === "active"`).
2. Click → inline `TaskHandoffWorkspace` panel:
   - **Eligibility** check; "Create Handoff Draft" only when eligible.
   - Edit **progress summary** + **next action**; Save runs a **privacy scan**.
   - Open findings show a masked preview and a **Mark Redacted** action.
   - **Export** is disabled until `scanPassed`.
   - **Import** panel: paste a package, **Preview**, see repository compatibility
     (`exact-match` / `probable-match` / `ambiguous` / `incompatible` / `unverifiable`)
     and blocking issues; **Accept** (blocked when incompatible) or **Reject**.
   - **Handoff history** lists prior drafts/exports/imports/acceptances.

## Out of scope (by spec, intentionally not implemented)

Accounts, authentication, SSO, cloud storage, centralized dashboards, manager
assignment, token sharing, Copilot-session sharing, Git automation (commit/push/
branch/PR), and remote synchronization. The handoff works only through a portable
local file.

## Verification

- `npx tsc --noEmit` — clean for all `handoff`, `messages`, `WebviewMessageRouter`,
  `extension`, and UI files.
- `npx vitest run tests/unit/handoff tests/ui/TaskHandoffWorkspace.test.tsx` — all
  passing (35 unit + 2 UI).
- `npm run build` — extension + webview bundle (esbuild).
