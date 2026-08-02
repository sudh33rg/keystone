# 13 — Conventions

What this codebase actually enforces, and what it merely prefers. Enforced rules
have a mechanism named next to them; everything else is a norm you should follow
to keep the code coherent.

---

## Hard rules (mechanically enforced)

### 1. No Git writes — ever
**Enforced by:** `scripts/lint.mjs` prohibited-pattern list.

```
/git\s+(add|commit|push|pull|checkout|merge|reset|rebase|tag)/
```

Keystone reads Git metadata (HEAD, branch, changed files) through
`core/platform/git/gitReadOnly.ts` and nothing else. This is a product promise,
not a preference — it is why the task-handoff feature exists at all
([`11-task-handoff.md`](11-task-handoff.md)) and why
`check-active-boundary.mjs` reports "Git remains read-only".

### 2. No process execution outside three files
**Enforced by:** `scripts/lint.mjs` — `execFile(`, `spawn(`, `spawnSync(`.

Allow-list (`lint.mjs:15-21`):
```
src/core/platform/git/gitReadOnly.ts
src/core/workflow/validation/validationRunner.ts
src/core/workflow/quality/testExecution.ts
```

Need a subprocess elsewhere? **Route through one of those three.** Adding a
fourth exception requires a deliberate decision, not a lint edit.

### 3. No type suppression
**Enforced by:** `scripts/lint.mjs` — `@ts-ignore` and `@ts-nocheck` are banned.

If the types don't work, fix the types. For missing VS Code APIs, extend the stub
at `src/types/vscode/index.d.ts` (see rule 7).

### 4. Every path alias must resolve
**Enforced by:** `scripts/lint.mjs:32-45`.

Every `@core/…`, `@vscode/…`, `@webview/…` specifier must resolve to a real
`.ts`/`.tsx`/`.js`/`.mjs`/`index.*`. This is the safety net for the build's
regex-based alias rewriting ([`02-build-system.md`](02-build-system.md)) — a
broken alias would otherwise only surface as a runtime "cannot find module".

### 5. Obsolete concepts must not reappear
**Enforced by:** `scripts/lint.mjs` prohibited patterns.

```
TeamSession   TEAM_SESSION   localSlm   localSLM   Ollama   /opt/nvm/
```

These are dead product directions (team sync, local LLM inference). If you find
yourself needing them, that is a product conversation, not a code change.

### 6. `core/` must never import `vscode`
**Enforced by:** convention + the fact that `verify-*.mjs` scripts would break.
Verified: 0 violations across all 132 files.

Only these 9 files may `import * as vscode`:
```
extension/core/extension.ts          extension/ui/vscodeProvider.ts
extension/core/qaService.ts          extension/ui/vscodeHtml.ts
extension/core/statusBar.ts          extension/commands/indexCommands.ts
extension/commands/cacheMaintenance.ts
extension/task-handoff/taskStateRestorer.ts
extension/intelligence/vscodeLanguageServiceEnricher.ts
```

Need a VS Code capability in `core`? Define an interface in `core`, implement it
in `extension`. Existing example: `SemanticEnrichmentProvider` ←
`VscodeLanguageServiceEnricher`.

### 7. `webview/` must never import `@core/*`, `@vscode/*`, or `node:*`
**Enforced by:** `tsconfig.webview.json` sets `types: []`, plus verification
(0 violations).

Consequence: shared types are **hand-mirrored** into `src/webview/model.ts`.
Yes, this is duplication. It is the price of the boundary. See
[KI-01](14-known-issues.md#ki-01).

### 8. No ingestion file caps
**Enforced by:** `scripts/check-active-boundary.mjs` ("no arbitrary ingestion caps")
and the literal type `discoveryMode: "unbounded-incremental"`.

"Unbounded knowledge, bounded prompt." Compression belongs in the context pack
builder, never in ingestion.

---

## Style (Prettier — actually installed and run)

`prettier.config.js`:

```js
{ printWidth: 100, semi: true, trailingComma: "none" }
```

```bash
npm run format         # write
npm run format:check   # verify
```

Run `npm run format` before finishing. It is the only formatter; there is no
ESLint (`eslint.config.js` is dead).

### What the dead ESLint config tells you about intent

`eslint.config.js` isn't executed, but it documents four rules the project cares
about. Follow them by hand:

| Rule | Meaning here |
|---|---|
| `no-console` | use the `LogOutputChannel`, not `console.log` |
| `consistent-type-imports` | `import type { X }` for type-only imports |
| `no-floating-promises` | `void promise` or `await` — never a bare dangling promise |
| `no-misused-promises` | don't pass an `async` function where a `void` callback is expected |

The `void` prefix idiom appears throughout the real code
(`void worker.terminate()`, `void run().then(...)`) — that is the codebase
honouring `no-floating-promises` manually.

---

## TypeScript idioms used consistently

### `readonly` on all data contracts
Every OKF type, CPG type, and contract interface uses `readonly` fields and
`readonly T[]` arrays. Data flowing through the pipeline is immutable by
convention.

```ts
export interface KeystoneKnowledgeUnit {
  readonly id: string;
  readonly properties: Readonly<Record<string, unknown>>;
  ...
}
```

### Literal types as invariants
```ts
format: "keystone-okf"                  // not string
formatVersion: 2                        // not number
validation: { valid: true, ... }        // an invalid snapshot is unrepresentable
discoveryMode: "unbounded-incremental"
```
Use this pattern when a value must never vary — it turns a runtime check into a
compile-time one.

### `as const` for enum-like unions
```ts
export const INTELLIGENCE_STAGES = ["structural", ...] as const;
export type IntelligenceStageId = (typeof INTELLIGENCE_STAGES)[number];
```
One array is the source of both the runtime list and the type. Add to the array
and `tsc` shows you every site that needs updating. **Prefer this over enums.**

### Assertion functions for validation
```ts
export function validateTaskStatePackage(value: unknown): asserts value is TaskStatePackage
```

### Typed error hierarchies
```ts
export class TaskHandoffError extends Error {
  constructor(message: string, readonly code: string, readonly status = 400) {
    super(message);
    this.name = new.target.name;      // correct subclass name in traces
  }
}
```

### Barrel files
`index.ts` re-exports exist for `cpg/`, `pipeline/`, `valueedge/`. Keep them thin
(2–23 LOC) — they are re-export only, never logic.

---

## Persistence conventions

### Always write atomically
```ts
const temporary = `${target}.${process.pid}.${Date.now()}.tmp`;
await fs.mkdir(path.dirname(target), { recursive: true });
await fs.writeFile(temporary, `${JSON.stringify(value, null, 2)}\n`, "utf8");
await fs.rename(temporary, target);
```
Note the details: PID + timestamp in the temp name (concurrent-safe), `mkdir
recursive`, 2-space JSON, **trailing newline**, `utf8`.

Clean up the temp file on failure:
```ts
catch { await fs.rm(temporary, { force: true }).catch(() => undefined); }
```

### Never leak absolute paths into persisted data
OKF validation actively rejects it:
```ts
if (value.startsWith("/") || /^[A-Za-z]:\\/.test(value))
  issues.push({ ..., message: "Must be workspace-relative." });
```
Use `okf/identity.ts` helpers for IDs.

### JSONL for bulk records, JSON for manifests
Units/relationships/observations/evidence are JSONL (streamable, line-diffable).
Manifests and reports are pretty-printed JSON.

---

## Concurrency conventions

### Generation counters to discard stale async work
```ts
private generation = 0;
start() {
  const generation = ++this.generation;
  // later, in a callback:
  if (generation !== this.generation) return;   // superseded — drop it
}
```
Used in `BackgroundWorkerCoordinator` and (as `indexGeneration` /
`analysisGeneration`) in `VscodeProvider`. **Use this pattern for any
restartable async operation.**

### `AbortSignal` for cancellation
The pipeline accepts `signal?: AbortSignal` and throws
`IntelligencePipelineCancelledError`. `quality/cancellation.ts` provides
`cancellationFromAbortSignal()` to bridge into the quality subsystem.

### Always set a timeout on a worker
`BackgroundWorkerCoordinator` uses 120,000 ms, terminates on expiry, persists a
failure record, and lets sibling workers continue. Track timeouts in a `Set` and
clear them in `dispose()`.

### Fail soft during ingestion
A stage failure records a warning and downgrades the snapshot to `"degraded"`.
Never abort the whole index because one analysis failed.

---

## Naming

| Thing | Convention | Example |
|---|---|---|
| Files | camelCase | `intentContextBuilder.ts` |
| React components | PascalCase | `App.tsx`, `GraphCanvas.tsx` |
| Types/interfaces/classes | PascalCase | `KeystoneKnowledgeUnit` |
| Functions/variables | camelCase | `buildIntentContextPack` |
| Constants | SCREAMING_SNAKE | `KEYSTONE_OKF_PROFILE`, `IGNORED_DIRECTORIES` |
| Message types | SCREAMING_SNAKE | `LOAD_INTELLIGENCE_GRAPH` |
| OKF kinds | kebab-case | `data-entity`, `architecture-boundary` |
| Stage IDs | kebab-case | `code-property-graph` |
| Verify scripts | `verify-<thing>.mjs` | `verify-call-resolution.mjs` |

---

## Comments

The codebase is **sparsely commented by design** — most files have none. Where
comments exist they explain *why*, at the top of a module:

```ts
/** Produces stable, workspace-scoped IDs without leaking absolute file paths. */
/** Authoritative local OKF profile used by every Keystone intelligence projection. */
/**
 * Snapshot-archive hygiene for the intelligence cache.
 */
```

Follow that: a one-line module docstring stating the module's contract or a
non-obvious constraint. Don't narrate the code.

---

## Pre-flight checklist

Before you call a change done:

- [ ] `npm run format`
- [ ] `npm run verify:source` (typecheck + lint + boundary)
- [ ] `npm run build`
- [ ] Ran the relevant tier from [`12-verification.md`](12-verification.md)
- [ ] If you touched the message protocol: manually exercised it in the
      Extension Development Host (it is **not** type-checked)
- [ ] If you added a persisted artifact: atomic write, workspace-relative paths,
      pruning story considered
- [ ] If you added an ignore rule: updated **both** `defaults.ts` and the
      watcher regex in `extension.ts`
- [ ] No new file over ~500 LOC without a reason (two files are already ~2,300
      and ~2,700 — don't add a third)

Next: [`14-known-issues.md`](14-known-issues.md).
