# Keystone Phase 5 Context Compression Evidence

Recorded on 2026-07-22 (Asia/Kolkata). This document covers only Context Package work inside the canonical Development stage. It distinguishes verified behavior from incomplete manual-host evidence.

## TDD sequence

The lifecycle and tokenizer tests were added before production implementation. The intentional red run and command are recorded in [PHASE_5_TDD_BASELINE.md](PHASE_5_TDD_BASELINE.md). The initial suite failed because `DevelopmentContextPackageService` did not exist. Final Phase 5 coverage is in:

- `tests/unit/context/DevelopmentContextPackageService.test.ts`
- `tests/unit/context/TokenBudgetOptimizerTokenizer.test.ts`
- `tests/unit/development/DevelopmentPromptService.test.ts`
- `tests/unit/development/DevelopmentService.test.ts`
- `tests/extension/developmentProtocol.test.ts`
- `tests/ui/DevelopmentStage.test.tsx`

The tests cover bounded raw inputs, real tokenizer use, arithmetic reduction, persistence, revision conflicts, immutable approved revisions, budget regeneration, impossible budgets, critical-fact blocking, staleness, required removal/restore, overlapping symbol ranges, approved-package prompt identity, excluded-content omission, strict messages, and the embedded UI gate.

## Canonical implementation and reused services

`DevelopmentContextPackageService` is a Development-stage adapter over the existing canonical compression primitives. It reuses `TokenCounterRegistry`, `ContextDeduplicator`, `ContextCompressionService`, `TokenBudgetOptimizer`, `ContextPersistenceStore`, `ContextPackageSchema`, and the existing item/disposition model. It does not add an LLM call or a second token-estimation algorithm.

The existing legacy delegation orchestration remains for old delegation records; it was not deleted because other shipped flows still reference it. New canonical Development prompts no longer reconstruct raw source, skill, instruction, or notes after approval. The optimizer's `summary-fit` path was corrected to use the selected `TokenCounter`, and required/pinned content now produces an explicit impossible-budget state when it cannot fit.

## Raw baseline and measurement

The bounded Development baseline includes only:

- persisted workflow intent and work type;
- persisted specification when present;
- persisted Development objective and revisions;
- actual contents of selected available workspace files;
- actual bounded lines for selected symbols when a range exists;
- the selected Development skill fragment and content hash;
- actual selected instruction contents, paths, and hashes;
- user notes when present.

It does not scan the entire repository, add workflow history, QA/security/performance material, or invent an agent. The extension host reads each selected file through the VS Code workspace filesystem adapter. Source paths, symbol IDs, and ranges remain attached to included or excluded dispositions.

The default counter is `keystone:gpt-approx`, persisted as `exact-local`. This means exact output of Keystone's deterministic local tokenizer; the persisted tokenizer note and UI explicitly say it is not an exact Copilot billing count. If registry resolution falls back, the package persists `estimated`, the fallback tokenizer ID, confidence, and warning. Raw and compressed counts receive the same counter instance.

Reduction is calculated as:

```text
removed = max(0, raw - compressed)
percentage = raw == 0 ? 0 : removed / raw * 100
```

## Compression, budget, and completeness

Verified deterministic operations are exact/structural/relationship duplicate removal, overlapping-symbol range merge, contract/signature extraction, structural summaries for eligible large items, required/pinned-first allocation, supporting allocation by score, optional user-note removal before required content, and same-tokenizer summary fitting. Every exclusion contains a reason, tokens removed, restorability, and the original source reference. Summaries retain their source reference and strategy.

Required facts are derived from actual persisted Development inputs: objective, selected source scope, selected skill, and selected repository instructions. Each fact records state, criticality, satisfying item IDs, and reason. A missing critical fact, explicit removal of required context, sensitive-filter block inherited by the canonical model, or impossible budget blocks approval. This validates retention of known required facts; it does not claim general semantic equivalence.

Packages persist under `.keystone/context/context-packages.json`. A regeneration creates a new package ID, supersedes but preserves the old revision, and updates the latest-by-work-item pointer. Pin, remove, restore, approve, and budget requests require package ID and expected revision; mismatches produce `package-revision-conflict`. Approved and superseded revisions are read-only.

## Prompt and staleness integration

Context Package appears between Execution Configuration and Prompt Preparation. The UI exposes raw/compressed/saved tokens, reduction percentage, measurement mode, tokenizer ID, package ID/revision, baseline sources, included/summarized items, excluded/restorable items, completeness facts, warnings, budget, pins, removal, restore, regeneration, and approval.

Prompt Preparation is disabled until the current package is approved. The generated prompt renders only persisted included/summarized package items and records package ID, revision, SHA-256 fingerprint, tokenizer ID, and measurement mode. Excluded content is not rendered. Prompt and handoff records persist the package identity and hash; the prompt also records the measurement mode.

Objective changes, scope additions/removals, and execution-profile changes immediately mark the package stale. Before prompt preparation, the host rereads source ranges and current instruction/skill contents and compares the complete persisted input fingerprint; a mismatch marks the approved package stale and blocks prompt creation. Stale, blocked, approved, and superseded states are visible and guarded in both host and UI.

## Measured example

This deterministic real-service example is emitted by the Phase 5 lifecycle test using actual strings, the production tokenizer, production compression pipeline, and in-memory production persistence store:

```text
Raw tokens:              68
Compressed tokens:       60
Removed tokens:           8
Reduction percentage:    11.76470588235294%
Critical facts covered:   4 / 4
Tokenizer:                keystone:gpt-approx
Measurement:              exact-local
Package hash:             5ab5e6870915d56c02c49da035353c3ab1f49d97a0ae39731f21e112a0516072
```

## Automated verification

Verified commands:

```text
npm ci
passed; 618 packages installed, 0 vulnerabilities

Phase 5 focused test run
6 test files passed
42 tests passed

npm run typecheck
passed

npm test
92 test files passed
674 tests passed

npm run build
passed; extension and webview production bundles built

npm run test:extension
passed; VS Code 1.95.0 Extension Development Host loaded the development extension and exited 0

Phase 5 targeted ESLint
0 errors; two existing threshold warnings (messages.ts line count and component complexity)

npx vsce package --allow-missing-repository --no-dependencies --baseContentUrl . --baseImagesUrl .
passed; keystone-0.1.0.vsix
SHA-256 0524cbed0ecd7f979268e32ef74d6e7b1b09a5e389f7cf9e724f82ef2ba52b6c
```

The completion gate stabilized after concurrent Tree-sitter work in the shared worktree finished: `npm ci`, repository-wide typecheck, all 674 tests, production build, real Extension Development Host activation test, and `npm run package` pass. Those unrelated Tree-sitter edits remain outside Phase 5 and were preserved.

## Extension Development Host and screenshots

The automated real VS Code 1.95.0 Extension Development Host activation test passed. A separate clean host was launched against `/tmp/keystone-phase5-host.8AUUVU` with two real TypeScript files and one real instruction file. macOS denied assistive-access automation before VS Code's first-run sign-in overlay could be dismissed, so the A–J interactive journey could not be truthfully completed and no Phase 5 screenshots are claimed. The unusable overlay capture was removed from the repository evidence set.

Consequently, the requested real-host screenshots (metrics, dispositions, completeness, pinning, over-budget, approval, stale state, prompt preview, narrow/editor layouts, and light/dark themes) remain outstanding. This phase must not be described as fully complete until those screenshots and scenarios are captured and the repository-wide typecheck passes.

## Known limitations

- The local tokenizer is deterministic and exact for Keystone's tokenizer, not for Copilot billing.
- Completeness validates explicit derived facts, not arbitrary semantic preservation.
- No external execution result is inferred by Context Package or prompt handoff.
- Interactive host scenarios and screenshots are blocked by host OS assistive-access permission in this run.
- The automated completion gate passes; interactive screenshot evidence remains blocked by host OS assistive-access permission in this run.

No Intelligence Canvas, engineering query, impact analysis, QA, test generation/healing, security, performance, PR review, cancellation, or Task Handoff feature was added.
