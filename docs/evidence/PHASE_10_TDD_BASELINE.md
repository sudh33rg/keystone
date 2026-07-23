# Phase 10 — TDD Baseline (tests written first)

Per Phase 10 spec §3, these tests were written before production implementation and
confirmed to fail for the expected reasons (missing modules/exports). After implementation
they must pass.

## Review change-set tests
- loads current accepted change set from `ReviewCompletionService.getState`
- distinguishes committed/staged/unstaged/untracked when a `GitRepositoryState` is supplied
- preserves staged/unstaged split
- represents added/modified/deleted/renamed
- requires a reason for excluded files
- marks a partial review scope clearly
- becomes stale after workspace changes (fingerprint differs)
- does not perform Git writes

## Changed-symbol review tests
- changed ranges map to real intelligence entities when available
- added/removed/signature-changed symbols are identified
- public symbols and entry points are marked
- unresolved symbols fall back to file-level review
- no symbol is fabricated

## Requirement-traceability tests
- workflow intent maps to relevant changes
- acceptance criteria map to implementation evidence
- test evidence supports an acceptance criterion
- requirement with no implementation is reported (state `no-implementation-found`)
- implementation with no requirement relationship is reported (`unlinked`)
- file name alone is insufficient evidence
- contradicted requirement evidence is reported

## Scope-review tests
- expected areas derived from workflow scope
- actual changes compared with expected scope
- unrelated module change becomes a candidate
- generated files grouped but disclosed
- repository-wide formatting detected
- dependency changes without reason identified
- scope findings carry evidence and confidence

## Contract-review tests
- exported function signature changes detected
- route/request/response/event/config/db schema changes detected
- removed contract detected
- behavioural compatibility unresolved when evidence insufficient

## Test-adequacy tests
- required impacted tests included
- required tests have current execution evidence
- passing tests alone do not imply adequate coverage
- skipped/flaky evidence affects review
- unsafe test-healing policy violation blocks readiness
- generated tests require validation evidence
- stale QA decision cannot be reused

## Security/Performance evidence tests
- current Security/Performance decisions loaded
- stale decisions rejected
- open blocking Security findings included
- accepted risks visible
- confirmed regressions vs static candidates distinguished

## Review-finding tests
- findings carry category/severity/confidence/source
- duplicate findings consolidated
- finding resolution requires evidence
- high-severity deferral requires justification
- resolved findings preserved

## Readiness tests
- all required acceptance criteria satisfied
- open critical findings block readiness
- stale QA/Security/Performance evidence blocks readiness
- unresolved breaking contract blocks readiness
- accepted risks disclosed
- ready-with-warnings distinct from ready
- user approval required for final readiness

## PR-package tests
- title generated from intent + outcome
- summary uses current review evidence
- validation section distinguishes passed/skipped/not-run
- package does not claim "all tests passed" when only targeted tests ran
- user edits persisted; regeneration does not silently overwrite

## Webview tests
- PR Review stage renders real change data, traceability, unlinked changes,
  contract changes, test assessment, Security/Performance summaries, findings,
  remediation creation, readiness gates, PR package editor
- no Task Handoff control appears
- no remote PR submission control appears

## Initial baseline (pre-implementation)
`npx vitest run tests/unit/review/prReview* 2>&1` →
`Cannot find module '../../../src/core/review/PrReviewService'` (expected: modules not yet written).
