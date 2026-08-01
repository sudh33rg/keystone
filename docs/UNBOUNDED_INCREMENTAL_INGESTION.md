# Unbounded, Non-Blocking, Incremental Ingestion

Keystone does not impose a repository file-count ceiling, source-file-size ceiling, or user-configured ingestion budget. Repository size is unknown in advance, so discovery continues until every eligible artifact is processed, the user cancels, the workspace closes, or the extension deactivates.

## Guarantees

- Probable text artifacts are discovered regardless of extension.
- Explicit generated, dependency, cache, binary, and VCS paths are excluded.
- Directory traversal and analysis yield to the event loop in batches.
- Work is cancellable through `AbortSignal`.
- Unchanged files reuse persisted hashes and extracted intelligence without semantic re-analysis.
- Changed and created files are reprocessed; deleted records become OKF tombstones.
- Candidate snapshots are never promoted until validation succeeds.
- Progress uses discovered/indexed counts without assuming a final total before discovery completes.
- Read or race failures are recorded and retried during later incremental runs.

## Context delivery

The full intelligence store is never truncated to fit a prompt. Context engineering ranks and deduplicates evidence for the active story, structurally compresses it, and creates ordered continuation packets when the selected Copilot surface cannot consume all relevant evidence at once.

The runtime acceptance scenario indexes 5,205 unknown-language files with no cap and confirms that every file is discovered and indexed.
