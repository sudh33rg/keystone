# 08 — Storage Layout (`.keystone/`)

Everything Keystone persists goes into a `.keystone/` directory **inside the
repository the user has open** — not inside the Keystone repo.

Every path below was derived from the source that writes it. Grep command that
produces the authoritative list:

```bash
grep -rnoE '"\.keystone[^"]*"|\.keystone/[a-zA-Z0-9/_.-]*' src --include=*.ts | sed 's/.*://' | sort -u
```

---

## Full tree

```text
<target-repo>/.keystone/
│
├── intelligence/                     ← the knowledge store
│   ├── manifest.json                    status: indexing | ready | error
│   ├── activity.json                    rolling event log  ← debug here first
│   ├── summary.json                     the big snapshot summary (INTELLIGENCE_FILE)
│   ├── current.json                     pointer → promoted extractionRunId + path:"okf"
│   ├── revision.json                    RevisionGuard: { head, branch, capturedAt }
│   │
│   ├── stages/                          per-stage output (21 files)
│   │   ├── 01-structural.json
│   │   ├── 02-language-framework.json
│   │   └── … 21-runtime-observability.json
│   │
│   ├── okf/                          ★ THE CANONICAL SNAPSHOT (store.root)
│   │   ├── manifest.json
│   │   ├── profile.json                 { id, version, digest }
│   │   ├── validation.json
│   │   ├── knowledge/
│   │   │   ├── units.jsonl
│   │   │   ├── relationships.jsonl
│   │   │   ├── observations.jsonl
│   │   │   └── evidence.jsonl
│   │   └── projections/
│   │       ├── graph.json               → UI graph
│   │       ├── search.jsonl             → query index
│   │       └── cpg-bindings.jsonl       → OKF ↔ CPG links
│   │
│   ├── okf.candidate-<runId>/        transient — during promotion only (sibling of okf/)
│   ├── okf.previous/                 transient — during promotion only (sibling of okf/)
│   │
│   ├── okf-bundle/                      portable Markdown mirror (sibling of okf/)
│   │   ├── .keystone-bundle.json
│   │   ├── index.md                     (only file allowed frontmatter)
│   │   ├── log.md
│   │   ├── files/index.md  symbols/index.md  services/index.md  …
│   │   └── <kind-plural>/<unit>.md
│   │
│   ├── cpg/                             gzipped per-file CPG shards + manifest
│   │
│   └── snapshots/<extractionRunId>/     archived full copies of past runs
│                                        (reclaim keeps the newest 1)
│
├── background/                       ← the 4 analysis workers and retry health
│   ├── qa.json
│   ├── security.json
│   ├── performance.json
│   └── modernization.json
│
├── tasks/                            ← task workspaces
│   ├── NNNN_slug/                       13 files each, see below
│   └── completed.jsonl                  archive of finished tasks
│
├── state/
│   ├── sdlc/active-plan.json            the SDLC plan
│   ├── intents/                         per-intent records
│   └── handoffs/records.json            handoff history
│
├── handoffs/<name>                   ← exported task-state packages
│
├── context/
│   ├── cache/                           context-pack cache
│   ├── sessions/                        prompt-enhancement sessions
│   ├── evaluations.json
│   └── feedback.json
│
├── cache/
│   ├── extractions/                     ExtractionCache (per-file parse results)
│   ├── graph/
│   └── query/
│
├── copilot/results/                  ← delegation outcomes
├── modernization/
│   ├── proposal.json
│   └── plan.json
├── validation/latest.json
├── reviews/latest-read-only.diff
│
├── settings.json                        per-workspace settings
├── skills.json                          SKILLS_FILE
├── metrics.json                         METRICS_FILE
├── coverage_index.json                  CoverageIndexManager
├── flaky_tests.json                     quarantine store
└── telemetry-map.json                   INPUT — user-provided, read by runtime stage
```

---

## Which of these are inputs vs outputs

Almost everything is an output. **Two exceptions:**

| File                 | Direction    | Notes                                                                                                                                                                 |
| -------------------- | ------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `telemetry-map.json` | **input**    | Read by `pipeline/runtime.ts:78`. If absent, the runtime-observability stage degrades gracefully. A user hand-authors this to map code paths to production telemetry. |
| `settings.json`      | input/output | Written by `cockpitService.ts:833`, read on load                                                                                                                      |

---

## Size

`.keystone/` gets **large**. Rough shape, from the code that produces it:

- `snapshots/` keeps a **complete copy per run** until pruned — this dominates.
- `cpg/` holds one gzipped shard per eligible file.
- `okf-bundle/` writes one Markdown file per knowledge unit — file _count_ can be
  very high even when bytes are modest.

A repository in the low thousands of files can produce **multiple GB** if
snapshots are never reclaimed. `reclaimSnapshotArchives()` keeps only the newest
archive and is the main lever.

`.gitignore` in this repo excludes `.keystone/`, and `verify-vsix.mjs`
explicitly rejects any VSIX containing a `/.keystone/` path.

### Reclaiming

| Action         | Function                        | Effect                                          |
| -------------- | ------------------------------- | ----------------------------------------------- |
| Prune archives | `reclaimSnapshotArchives(root)` | keep newest 1 snapshot + prune `cache/`         |
| Nuke           | `clearIntelligenceCache(root)`  | delete `intelligence/` entirely → full re-index |

Both live in `core/intelligence/ingestion/snapshotPrune.ts` and are exposed as
commands `keystone.reclaimCache` / `keystone.clearCache` — **which are currently
not declared in `package.json` and therefore unreachable from the Command
Palette** ([KI-04](14-known-issues.md)). Until that's fixed, the practical
workaround is `rm -rf .keystone/intelligence/snapshots`.

---

## The atomic-write discipline

Two patterns, used consistently.

### Simple atomic file write

```ts
const temporary = `${target}.${process.pid}.${Date.now()}.tmp`;
await fs.mkdir(path.dirname(target), { recursive: true });
await fs.writeFile(temporary, JSON.stringify(value, null, 2) + "\n", "utf8");
await fs.rename(temporary, target); // atomic on POSIX
```

Seen at `backgroundAnalysisWorker.ts:23-29` and
`backgroundWorkerCoordinator.ts:128-156` (the latter also `rm`s the temp file on
failure).

**Follow this pattern for any new persisted artifact.** A half-written JSON file
in `.keystone/` will make the next load fail in a confusing way.

### OKF directory promotion

`okf/store.ts:118-176`:

```
candidate = "<root>/.keystone/intelligence/okf.candidate-<extractionRunId>"

1. rm -rf candidate
2. write manifest/profile/validation/knowledge/*.jsonl into candidate
3. mkdir candidate/projections
   write graph.json, search.jsonl, cpg-bindings.jsonl
4. copyDirectory(candidate → intelligence/snapshots/<runId>)     archive
5. rm -rf okf.previous
6. rename(okf → okf.previous)          (skipped if okf doesn't exist yet)
7. rename(candidate → okf)             ← the atomic swap
8. write intelligence/current.json     pointer to runId
9. rm -rf okf.previous
10. writePortableOkfBundle()           → okf-bundle/
```

Crash-safety: at every point, either `okf/` or `okf.previous/` is a complete,
valid snapshot.

**⚠️ If you find `okf.candidate-*` or `okf.previous` lying around**, a promotion
crashed. They are safe to delete; the next successful run cleans them anyway.

### Legacy cleanup

`store.ts:164` removes `.keystone/knowledge/` (a pre-v2 layout) if it exists.
Don't reintroduce that path.

---

## Task workspaces

`TaskWorkspaceManager` (`core/workflow/tasks/taskWorkspaceManager.ts:65`) creates
`.keystone/tasks/NNNN_slug/` with **13 files**:

| File                      | Content                           |
| ------------------------- | --------------------------------- |
| `task.json`               | task record                       |
| `research.md`             | research document                 |
| `research-status.json`    | research state                    |
| `specification.md`        | the spec                          |
| `plan.json`               | implementation plan               |
| `SKILL.md`                | a Copilot skill file for the task |
| `instructions.md`         | Copilot instructions              |
| `agents.json`             | agent assignments                 |
| `progress.json`           | progress tracking                 |
| `context.json`            | the context snapshot              |
| `context-packets.json`    | context packets                   |
| `correction-packets.json` | corrections fed back              |
| `delegation.md`           | the actual Copilot prompt         |
| `status.json`             | status + updatedAt                |

Completed tasks are appended to `.keystone/tasks/completed.jsonl`.

Handoff export writes to `<targetRoot>/.keystone/handoffs/<name>`
(`taskWorkspaceManager.ts:322`) — note it can write into a **different**
repository root, which is the whole point of handoff.

---

## The two ignore lists ⚠️

There are two, and they can drift apart.

### 1. Ingestion — `IGNORED_DIRECTORIES` (`core/platform/config/defaults.ts:7`)

~50 entries:

```
node_modules  bower_components  .pnpm-store  .yarn
dist  build  out  bin  obj  vendor
.git  .keystone  .sdlc-agent  temp-kg  .vscode-test
.venv  venv  env  .envdir  site-packages
.tox  .nox  __pycache__  .pytest_cache  .mypy_cache
.ruff_cache  .hypothesis  .ipynb_checkpoints
.next  .nuxt  .svelte-kit  .angular  .parcel-cache  …
```

Plus the target repo's own `.gitignore`, honoured via
`ingestion/gitignore.ts`.

### 2. File watcher — a regex in `extension/core/extension.ts:73-78`

~20 entries, a subset. Directories ignored by ingestion but **not** by the
watcher will cause pointless re-index cycles.

**When adding an ignore rule, update both.**

Other constants in `defaults.ts`: `SECURITY_KEYWORDS`, `PERFORMANCE_KEYWORDS`,
`MODERNIZATION_KEYWORDS`, `DEFAULT_QA_CHECKLIST`.

---

## Adding a new persisted artifact — checklist

1. Put the path constant in `core/platform/config/defaults.ts` if it's global.
2. Use the tmp + rename atomic pattern.
3. Create parent dirs with `{ recursive: true }`.
4. Decide the lifecycle: is it pruned by `snapshotPrune.ts`? Should it be?
5. Decide whether it's OKF-derived — if so, make it a **projection**, not a new
   store ([`05`](05-data-model-okf.md)).
6. Confirm `verify-vsix.mjs`'s forbidden-entry check still passes (nothing under
   `.keystone/` may ship in the VSIX).

Next: [`09-webview-and-protocol.md`](09-webview-and-protocol.md).
