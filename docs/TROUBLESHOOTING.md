# Troubleshooting

Real recovery actions for common Keystone issues. Keystone never tells you to delete all
local state as the first step.

## Extension does not open

- Confirm the extension is enabled (`Keystone` in the Extensions view).
- Run the **Keystone: Open** command from the Command Palette.
- Check that a workspace/folder is open; some surfaces require an open repository.

## Intelligence initialization fails

- Ensure the folder is a supported repository and not excluded by your workspace
  settings.
- Check available disk space; the intelligence snapshot is written under `.keystone/`.
- Open the output channel for the bounded error and correlation id, then retry.

## Worker interrupted

- If ingestion was cancelled or VS Code closed mid-scan, Keystone resumes from the last
  safe state on next open. It does **not** auto-restart automatically.
- Re-run Initialize Repository Intelligence from the Intelligence view.

## Repository too large

- Keystone bounds graph slices, search results, and lists. If ingestion is still slow,
  narrow workspace exclusions or reduce the scanned scope.
- Oversized individual inputs are rejected with a clear error rather than unbounded
  processing.

## Symbol not resolved

- Re-index the repository; stale intelligence may predate a recent change.
- Confirm the file is inside the indexed workspace and not in an excluded directory.

## Exact tokenizer unavailable

- Token estimates use a deterministic approximation. If an exact tokenizer is
  unavailable, Keystone reports the approximation and continues; compression ratios are
  still measured against the local estimate.

## Test framework unsupported

- Add an Execution Configuration that maps your framework to a supported runner, or mark
  the task manually. Unsupported frameworks are reported, not silently skipped.

## Command unavailable

- Some commands require an open repository or a trusted workspace. The command palette
  hides or disables commands that do not apply.
- Restricted Mode blocks executable and repository-mutating actions; trust the workspace
  to enable them.

## Git unavailable

- Keystone can prepare PR titles/descriptions and copy them, but cannot create branches
  or push without a working Git integration. Use your normal Git workflow for those
  steps.

## Context package stale

- Re-run Context Package generation after changing scope. The UI marks stale packages
  and offers regeneration.

## Instruction changed

- If a referenced instruction file moved or changed, re-select it in Development. Stale
  references are flagged.

## Handoff package rejected

- A rejected import usually means a repository mismatch or an incompatible schema
  version. The import preview shows compatibility and blocking reasons. Re-export from
  the matching repository revision, or open read-only.

## Repository mismatch

- Task Handoff validates repository identity. Importing a handoff built against a
  different repository is blocked with a clear message.

## Storage migration failure

- Original data is preserved (the new record is only committed after validation). Check
  the diagnostics for the failing record and re-run migration. Individual bad records
  are isolated; others load.

## Corrupted record

- The affected bounded area can be reset without wiping the whole extension. Export a
  redacted recovery report first if you need support.

## Package installation problem

- Use the packaged `.vsix` from the documented build command. Install via
  **Install from VSIX** in the Extensions view. Confirm the publisher/version matches
  what you built.
