# Phase 11 — Task Handoff: TDD Baseline

Status: engine implemented, tests written to lock behavior. This document records the
test plan and the behaviors that the unit tests enforce. Initial run of the suite is
used as the baseline (see `npm test` output in the evidence doc).

## Test plan (per spec §3)

### Handoff eligibility
- active workflow can create a handoff
- completed / cancelled workflow cannot
- stale stage evidence is disclosed
- active external execution is disclosed
- duplicate active handoff draft is prevented
- Task Handoff action appears only inside an ongoing workflow

### Handoff-summary
- current stage derived from persisted state
- completed stages included
- next required action derived from real state
- no fabricated progress percentage
- user progress notes persisted

### Package-content
- intent/work type/specification/stage states included
- Development objective / source scope / execution-profile / instruction / skill refs included
- approved context-package summary included
- Development result included
- impact/QA/security/performance/PR-review state included
- findings + remediation links included
- unrelated workflows not included

### Secret-redaction
- raw credentials / tokens / env secrets / private keys / auth headers / cookies excluded
- absolute user-home paths normalized
- raw command/scanner/benchmark output excluded by default
- raw Copilot conversation / clipboard history not included
- redaction findings require review
- redacted values cannot be reconstructed

### Repository-identity
- identity deterministic and path-independent
- matching clone recognized
- unrelated repository rejected
- revision difference -> warning
- missing Git metadata does not block
- multi-root handled
- identity survives relocation

### Export
- valid package exports; contains schema version, content hash, creation time
- records sender display label without account identity
- export atomic; failure does not report success
- duplicate export -> new package ID
- export does not mutate workflow state
- exported package parses independently

### Import-validation
- supported schema imports; unsupported future rejected
- malformed / integrity-mismatch rejected
- unrelated repository rejected; matching accepted
- revision mismatch -> warning
- missing/changed referenced files reported
- missing instruction / changed instruction hash reported
- missing skill reported
- imported paths cannot escape workspace
- package cannot overwrite another workflow silently

### Acceptance & Resume
- imported handoff remains preview before acceptance
- user can reject / accept compatible handoff
- acceptance creates/updates one workflow, does not duplicate
- current stage restored; completed stages remain completed
- running executions restored as interrupted
- accepted handoff creates an audit record

## Engine modules
- shared/contracts/handoff.ts — transport schema, limits, error codes, canonical hash
- core/persistence/HandoffPersistenceStore.ts — history (drafts/exports/imports/acceptance)
- core/handoff/HandoffPrivacyService.ts — deterministic secret scan + redaction policy
- core/handoff/RepositoryIdentityService.ts — bounded, path-independent identity + compare
- core/handoff/TaskHandoffExportService.ts — assemble/hash/atomic write/block unsafe
- core/handoff/TaskHandoffImportService.ts — verify/integrity/compat/accept/reject
