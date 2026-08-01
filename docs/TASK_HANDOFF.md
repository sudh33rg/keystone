# Task Handoff

Task Handoff is an action on the active SDLC task. It transfers portable task state, not credentials, Copilot access, repository contents, or a cloud session.

## Package contents

- original intent and approved specification
- exact 16-story SDLC plan and statuses
- acceptance criteria, evidence, decisions, blockers, findings, and validation results
- relevant files, symbols, relationships, context, and intelligence snapshot reference
- branch/revision metadata for manual verification
- selected Copilot agent, instructions, and skills where present
- exact next recommended action
- schema version, redaction report, and integrity checksum

## Creation

1. Open the active task and choose **Create Task Handoff**.
2. Keystone derives the package from authoritative extension-host and SDLC state.
3. Secret patterns and excluded paths are scanned and redacted.
4. The package is checksummed.
5. The package is encrypted with AES-256-GCM using a scrypt-derived key.
6. The user shares the encrypted package and communicates the passphrase separately.

## Restore

1. The recipient manually opens and synchronizes the expected repository/branch.
2. Keystone decrypts, validates schema and integrity, and presents mismatch warnings.
3. The user confirms manual repository synchronization.
4. Keystone previews and restores the exact SDLC/task state.
5. Work resumes from the recorded next action.

No Git command is executed during restore. The runtime acceptance suite verifies an encrypted round trip with exact SDLC-plan equality.
