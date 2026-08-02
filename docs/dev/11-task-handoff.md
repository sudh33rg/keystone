# 11 — Task Handoff (encrypted task-state packages)

The handoff feature exports an in-flight task — its plan, progress, context,
decisions, and next action — as a **single encrypted string** another developer
can paste into their own Keystone to resume the work.

Sources:
- `src/core/workflow/handoff/contracts.ts` (197 LOC) — the schema and error types
- `src/core/workflow/handoff/taskStatePackage.ts` (334 LOC) — build/validate/verify/migrate
- `src/core/workflow/handoff/handoffSecurity.ts` (182 LOC) — crypto + redaction
- `src/extension/task-handoff/taskStateRestorer.ts` (86 LOC) — the restore side

---

## Why it exists

Keystone **never touches Git** (lint-enforced). So it cannot ship work by
pushing a branch. Handoff is the alternative: move the *understanding* of a task
between machines and let the humans move the code themselves.

That constraint is baked into the contract as a literal string
(`contracts.ts:150`):

```ts
export const MANUAL_SYNC_NOTICE =
  "Keystone does not synchronize Git repositories. Before restoring this task, " +
  "confirm that you have manually opened and synchronized the expected repository and branch.";

export const MANUAL_SYNC_CONFIRMATION =
  "I have manually synchronized the repository and selected the correct branch.";
```

`RESTORE_TASK_HANDOFF` carries `manualSyncConfirmed: boolean` and the restore is
refused without it.

---

## The package shape

`TaskStatePackage` (`contracts.ts:126`), schema version **`"2.0.0"`**:

```ts
{
  schemaVersion, packageId, handoffId, taskId,
  createdBy, createdAt, updatedAt,

  repositoryReference: {                     // where this work belongs
    repositoryName, expectedBranch?, expectedCommit?,
    remoteUrl?, workspaceFingerprint?
  },

  task:          TaskDefinition,             // the ask
  specification: FeatureSpecification,       // the agreed behaviour
  plan:          ImplementationPlan,         // phases + PlanItems
  sdlcPlan?:     SDLCPlan,
  progress:      ExecutionProgress,          // % + what's done + blockers
  context:       EngineeringContext,         // architecture summary etc.
  changes:       ChangeAwareness,
  quality:       QualityState,
  correctionPackets?: CorrectionPacket[],
  decisions:     DecisionState,
  continuation:  ContinuationState,          // ← the important one
  redactionReport: RedactionReport,
  checksum: string
}
```

### `TaskDefinition` — the ask, disambiguated

```ts
{ originalUserRequest, normalizedProblemStatement,
  businessGoal, technicalGoal,
  scope[], nonGoals[], constraints[], assumptions[], acceptanceCriteria[] }
```

Note `nonGoals` and `assumptions` are first-class. The format is designed so the
receiving developer inherits the *boundaries* of the task, not just its title.

### `ContinuationState` — resume instructions

```ts
{ exactNextRecommendedAction, suggestedFirstPrompt,
  expectedFilesToInspect[], expectedTestsToRun[],
  environmentRequirements[], setupReminders[],
  restoreWarnings[], manualRepositorySyncReminder,
  definitionOfCompletion[] }
```

`suggestedFirstPrompt` is a ready-to-paste Copilot prompt. This is the payoff of
the whole feature.

### `ImplementationPlan` / `PlanItem`

```ts
PlanItem.status: "PENDING" | "ACTIVE" | "COMPLETED" | "BLOCKED" | "DEFERRED"
ImplementationPlan { phases: [{ id, title, tasks: PlanItem[] }],
                     currentPhase?, currentTask?,
                     completedTasks[], pendingTasks[],
                     blockedTasks[], deferredTasks[] }
```

---

## Cryptography

`handoffSecurity.ts`. **scrypt KDF + AES-256-GCM authenticated encryption.**

### The envelope

```ts
interface EncryptedHandoffEnvelope {
  format:     "keystone-handoff-encrypted-v1";
  kdf:        "scrypt";
  cipher:     "aes-256-gcm";
  salt:       string;   // base64, 16 random bytes
  nonce:      string;   // base64, 12 random bytes
  ciphertext: string;   // base64
  authTag:    string;   // base64, from GCM
}
```

Serialized as JSON — that JSON string *is* the shareable artifact.

### `encryptHandoffPackage(plaintext, passphrase)` — line 30

```
passphrase.length < 12     → TaskStateValidationError
passphrase.length > 1024   → TaskStateValidationError
salt  = randomBytes(16)
nonce = randomBytes(12)
key   = scrypt(passphrase, salt, 32)        // 256-bit
cipher = createCipheriv("aes-256-gcm", key, nonce)
key.fill(0)                                  // ← zeroed after use
→ envelope JSON
any throw → EncryptionError (generic, leaks nothing)
```

### `decryptHandoffPackage(serialized, passphrase)` — line 59

```
empty passphrase           → TaskStateValidationError
passphrase > 1024          → TaskStateValidationError
serialized > 15 MB         → TaskStateValidationError   ← DoS guard
envelope field/format mismatch → EncryptionError
GCM authTag mismatch       → EncryptionError            ← tamper detection
key.fill(0) on success
```

### Details worth preserving if you touch this

| Property | Why it matters |
|---|---|
| Key zeroed (`key.fill(0)`) on both paths | limits key lifetime in memory |
| Random salt **per package** | no rainbow-table reuse across handoffs |
| Random 12-byte nonce | GCM nonce reuse would be catastrophic — never make it fixed |
| AuthTag verified by `decipher.final()` | tampering fails closed |
| **All** failures collapse to `EncryptionError` | no oracle distinguishing "bad passphrase" from "corrupt envelope" |
| 15 MB cap before parsing | bounded work on hostile input |

⚠️ `scrypt` is called with Node's **default cost parameters** (only `keylen: 32`
is specified). If you harden this, changing cost parameters is a **breaking
format change** — bump `format` to `…-v2` and handle both on decrypt.

---

## Secret redaction

Runs **before** encryption, so secrets never enter the package at all.

### `scanAndRedact(input)` — line 124

Recursively walks any object/array/string, tracking a dotted path
(`plan.phases[0].tasks[2].title`). Returns `{ value, report }` with matches
replaced by `[REDACTED:<CATEGORY>]`.

**Five HIGH-confidence patterns** (line 94):

| Category | Detects |
|---|---|
| `private-key` | `-----BEGIN [RSA\|EC\|OPENSSH] PRIVATE KEY----- … END …` |
| `github-token` | `ghp_/gho_/ghu_/ghs_/ghr_` + 30 chars, `github_pat_…` |
| `jwt` | `eyJ…​.…​.…` three base64url segments |
| `credential-assignment` | `api_key\|access_token\|refresh_token\|client_secret\|password` `=`/`:` + 8+ chars |
| `authorization-header` | `Authorization: Bearer …` / `Basic …` |

**Excluded-path rule** (line 121): if a field's *path* looks like a file field
(`/path|file/i`, or contains `Excerpts`) **and** its value matches

```
.env / .env.* / .ssh / credentials / credentials.json / id_rsa / id_ed25519
```

the value becomes `[REDACTED:EXCLUDED_PATH]`. This stops source excerpts from
dotfiles leaking even when they contain no recognisable token.

### `assertNoHighConfidenceSecrets(value)` — line 171

Re-scans and **throws `SecretDetectedError`** if any HIGH finding remains:

> "Sharing was blocked because a high-confidence secret remains. Remove it and
> scan again."

This is the hard gate. The `RedactionReport` (categories, redacted paths,
findings with confidence, `safeToShare`) travels inside the package so the
receiver can see what was stripped.

⚠️ `report.safeToShare` is hardcoded `true` at line 167. It is a field the
receiver sees, not a computed verdict — the real gate is
`assertNoHighConfidenceSecrets`. Don't treat `safeToShare` as a security signal.

---

## Integrity

`taskStatePackage.ts`:

| Function | Role |
|---|---|
| `canonicalJson(value)` | deterministic serialization (stable key order) |
| `packageChecksum(pkg)` | sha256 over the canonical JSON, **excluding** `checksum` |
| `validateTaskStatePackage(v)` | `asserts value is TaskStatePackage` — full structural validation |
| `TaskStatePackageBuilder` | assembles a package from live task state |
| `verifyTaskStatePackage(pkg)` | recompute + compare → `TaskStateIntegrityError` |
| `migrateTaskStatePackage(pkg)` | upgrade older schema versions |

Comparison uses `safeChecksumEqual()` (`handoffSecurity.ts:178`) —
`timingSafeEqual` over hex buffers with a length check first. Constant-time, so
checksum comparison isn't a side channel.

`canonicalJson` is what makes the checksum reproducible across machines; if you
add a field, it must round-trip through canonical serialization identically or
every package will fail integrity on the receiving end.

---

## Error taxonomy

All extend `TaskHandoffError` (`contracts.ts:155`), which carries a `code` and an
HTTP-ish `status`:

| Class | code | status |
|---|---|---|
| `TaskStateValidationError` | `TASK_STATE_VALIDATION` | 422 |
| `TaskStateIntegrityError` | `TASK_STATE_INTEGRITY` | 422 |
| `SecretDetectedError` | `SECRET_DETECTED` | 422 |
| `EncryptionError` | `ENCRYPTION` | 500 |
| `UnsupportedSchemaVersionError` | `UNSUPPORTED_SCHEMA_VERSION` | 422 |

`this.name = new.target.name` gives correct subclass names in stack traces.

---

## End-to-end flows

### Create

```
UI: CREATE_TASK_HANDOFF { passphrase }
  → vscodeProvider
      TaskStatePackageBuilder → TaskStatePackage
      scanAndRedact(pkg)                    → redactionReport
      assertNoHighConfidenceSecrets(pkg)    → throws if a HIGH secret survives
      packageChecksum(pkg)                  → pkg.checksum
      encryptHandoffPackage(json, passphrase)
      record → .keystone/state/handoffs/records.json
  ← TASK_HANDOFF_CREATED { redactionCategories[], checksum, encryptedPackage }
```

The story moves to status `handed-off`.

### Restore

```
UI: RESTORE_TASK_HANDOFF { packageText, passphrase, manualSyncConfirmed }
  → refuse unless manualSyncConfirmed
    decryptHandoffPackage()                 → EncryptionError on bad pass/tamper
    validateTaskStatePackage()              → asserts the shape
    migrateTaskStatePackage()               → if older schemaVersion
    verifyTaskStatePackage()                → TaskStateIntegrityError on mismatch
    compare repositoryReference vs actual   → warnings[]
    WorkspaceStateTaskStore.save()          → VS Code workspaceState
    continuationBriefing(pkg)               → human-readable resume brief
  ← TASK_HANDOFF_RESTORED { packageValue, warnings[], continuationBriefing, restoredNow }
```

`LOAD_RESTORED_TASK_HANDOFF` re-reads a previously restored package (the webview
sends it on startup, `App.tsx:131`).

### Where things land on disk

| Path | Content |
|---|---|
| `.keystone/state/handoffs/records.json` | handoff history (`vscodeProvider.ts:1881`) |
| `.keystone/handoffs/<name>` | exported package files (`taskWorkspaceManager.ts:335`) |
| `<otherRoot>/.keystone/handoffs/<name>` | export into a **different** repo (`:322`) |
| VS Code `workspaceState` | the restored package (not on disk in plaintext) |

`TASK_HANDOFFS_RESULT` returns sessions with `status: "Shared" | "Restored"`,
warnings, and an activity trail of `{ at, actor, action }`.

---

## Rules if you modify handoff

1. **Never log the plaintext package or the passphrase.** `no-console` is in the
   (dead) ESLint config but the norm holds; the output channel is user-visible.
2. **Never widen the error types.** Collapsing all crypto failures into
   `EncryptionError` is deliberate.
3. **Adding a field?** It must survive `canonicalJson` → `packageChecksum`
   round-trip, and it must be walked by `scanAndRedact` (it is, generically — but
   confirm your field is a plain object/array/string, not a `Map` or `Date`).
4. **Changing crypto params = new `format` value**, plus decrypt-side support for
   the old one, or every existing package becomes unreadable.
5. **Bumping `TASK_STATE_SCHEMA_VERSION`** requires a `migrateTaskStatePackage`
   branch.
6. Handoff is covered by `scripts/verify-final.mjs`, which exercises
   `TaskStatePackageBuilder`, `verifyTaskStatePackage`, `encryptHandoffPackage`,
   and `decryptHandoffPackage`. Run `npm run verify:cross-feature` after changes.

Next: [`12-verification.md`](12-verification.md).
