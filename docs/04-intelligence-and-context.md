# Repository intelligence and context engine

## 1. Purpose

Repository Intelligence builds a local, branch-aware structural model without requiring an LLM. The Context Engine consumes that model and an approved task to assemble the smallest useful, inspectable delegation package.

The two subsystems share evidence but have distinct responsibilities:

- Intelligence answers: “What exists, how is it related, and what changed?”
- Context answers: “Which approved evidence does this task need, in what form, within what budget?”

## 2. Index pipeline

```mermaid
flowchart LR
  META["1. Repository metadata"] --> TREE["2. Source structure"]
  TREE --> SYMBOLS["3. Symbols"]
  SYMBOLS --> REL["4. Relationships"]
  REL --> TESTS["5. Test mappings"]
  TESTS --> FRAME["6. Framework intelligence"]
  FRAME --> COMMIT["Versioned index commit"]
```

Each stage commits partial, queryable progress and can be cancelled. A stage failure produces a `partial` index when prior stages remain valid.

### 2.1 Repository metadata

Capture workspace roots, Git root, remote identity hash, current branch/HEAD, ignore sources, settings, manifests, lockfiles, and detected project roots. No file content beyond small known metadata files is needed.

### 2.2 Source structure

Walk included files with VS Code workspace APIs. Record normalized path, file type, language, category, size, modification time, fingerprint, and policy flags. Apply priority so open/mentioned files and manifests are available first.

### 2.3 Symbols

Use VS Code document symbols/language services first. Add language-specific parsers only behind a parser adapter and only when they materially improve unsupported languages. Record parser provenance and confidence.

### 2.4 Relationships

Extract imports, exports, references, inheritance/implementation, calls, routes/endpoints, configuration relationships, and dependencies where detectable. A relationship without reliable extraction is omitted rather than invented.

### 2.5 Test mappings

Combine:

- import/reference edges between tests and source;
- repository naming conventions (`*.test.*`, `*.spec.*`, `__tests__`, language-specific patterns);
- co-location and mirrored directory structures;
- test configuration and project definitions;
- optional coverage artifacts, read locally when present and not excluded.

Mappings include confidence and evidence.

### 2.6 Framework intelligence

Framework adapters derive routes, entry points, build/test/lint/type-check commands, generated folders, and framework conventions from manifests/configuration. Detection must cite the file and signal that produced it.

## 3. Ignore and safety policy

Ignore evaluation order is deny-first:

1. Keystone hard safety exclusions: binary content, credential stores, private keys, known secret files.
2. User Keystone exclusions.
3. VS Code file/search exclusions.
4. `.gitignore` and nested ignore rules.
5. Default heavy/generated folders.
6. Explicit user pin, only if policy permits an override.

Default heavy/generated exclusions include `.git`, `node_modules`, `dist`, `build`, `out`, `bin`, `obj`, `coverage`, framework caches, vendor directories, generated sources, source maps, minified files, and large artifacts.

Likely-secret rules cover names such as `.env*`, credential/config stores, private keys/certificates, token files, and content signatures. Content scanning uses bounded prefixes and redacted classifiers; secret values are never logged. False positives are visible. A user can allow an ordinary ignored source file, but cannot transmit a detected credential value through Keystone.

## 4. Incremental indexing

### 4.1 Fingerprints

- Fast fingerprint: size, modification time, and file identity for change triage.
- Content fingerprint: cryptographic or stable hash computed only when needed.
- Symbol/relationship records carry their source content fingerprint.
- Branch key combines repository identity, branch, and base commit/fallback tree fingerprint.

### 4.2 Change processing

1. Receive create/change/delete/rename events.
2. Debounce and coalesce by canonical URI.
3. Reapply ignore/secret policy.
4. Compare fingerprint; skip unchanged files.
5. Remove old graph contributions for changed/deleted files.
6. Reparse affected files.
7. Re-resolve inbound/outbound relationships and test mappings within a bounded neighborhood.
8. Commit a new index version and emit an update summary.
9. Mark context packages/tasks stale when their source fingerprints changed materially.

Branch change invalidates branch-specific graph data but may reuse identical content-addressed file/symbol shards.

## 5. Scale and resource limits

- Maximum indexed file size defaults to 1 MiB and is configurable.
- File enumeration and parsers use cancellation tokens and bounded concurrency.
- File contents are streamed or read only for the active parser and then released.
- Symbol lists, errors, UI queries, and caches are paginated/bounded.
- Repository-wide search returns top results plus continuation, not full arrays in Webview messages.
- Index writes are sharded; a single large repository does not create one giant JSON record.
- Memory pressure triggers LRU eviction of content/summary caches, never deletion of canonical workflow state.

## 6. Intelligence queries

Initial query interface:

| Query | Inputs | Outputs |
|---|---|---|
| Repository overview | repository/branch | counts, languages, frameworks, commands, index health |
| File search | text, category, language, page | ranked file summaries |
| Symbol search | text, kind, scope, page | symbol references and signatures |
| Neighborhood | file/symbol, edge types, depth ≤ 2 | bounded dependency graph |
| Related tests | source references | ranked tests and evidence |
| Impact candidates | intent terms, explicit mentions | ranked modules/files/symbols with reasons |
| Change impact | Git diff/base | affected symbols, dependents, tests, active task overlap |

Queries return evidence and confidence; consumers must not convert guesses into facts.

## 7. Context selection inputs

For an active task, selection seeds are evaluated in this order:

1. Explicit user-pinned files/symbols.
2. Task objective, required criteria, constraints, expected files/output.
3. Explicit mentions from original intent/specification.
4. Directly affected files and symbols.
5. One-hop imports/references/calls/inheritance/routes.
6. Related tests and relevant project configuration.
7. Outputs from completed dependencies.
8. Current editor selection/open files when relevant.
9. Current Git changes that overlap the task.

No source gains inclusion solely because it is open or recently changed; relevance to the task is required unless the user pins it.

## 8. Ranking model

The deterministic initial score is explainable:

```text
score =
  100 × explicit pin
  + 60 × exact path/symbol mention
  + 40 × expected-file match
  + 30 × acceptance-criterion term match
  + 24 × direct dependency edge confidence
  + 20 × related-test confidence
  + 16 × completed-task-output relevance
  + 12 × overlapping Git change
  + 8 × current-editor relevance
  − size penalty
  − graph-distance penalty
  − stale/low-confidence penalty
```

Weights are versioned configuration, not user-facing promises. The preview explains actual reasons (“expected output”, “imports selected symbol”, “regression test for selected file”) rather than exposing only a numeric score.

## 9. Compression forms

The engine selects the cheapest adequate representation:

| Source | Preferred representation |
|---|---|
| Task/spec | Relevant sections and task-linked criteria only |
| Direct implementation target | Targeted ranges or full small file when justified |
| Large source file | Relevant declarations with bounded surrounding context |
| Dependency module | Exported interfaces, signatures, types, and relevant documentation |
| Call relationship | Caller/callee signatures plus evidence locations |
| Test | Relevant cases/fixtures and setup, not the whole suite |
| Configuration | Relevant keys with path and hierarchy |
| Generated/vendor source | Excluded; include locally derived interface metadata only when safe |
| Completed task | Structured output summary, changed files, decisions, evidence |

Generic LLM summarization is not required for MVP context compression. If later added, summaries are clearly labeled, fingerprinted, cached, and never replace exact interfaces required for correctness.

## 10. Budget algorithm

1. Reserve budget for task objective, required constraints, validation steps, and task-linked criteria.
2. Include mandatory pinned items; if they exceed the total, stop and ask the user to raise the limit or remove pins.
3. Rank remaining candidates.
4. Choose a compression form and estimate tokens conservatively.
5. Add candidates while under the budget, preserving a safety margin for prompt framing.
6. Attempt a cheaper valid representation before excluding an over-budget item.
7. Record every excluded candidate and reason (`low-relevance`, `over-budget`, `ignored`, `secret`, `binary`, `stale`, `duplicate`).
8. Compute a package fingerprint from task/spec/index versions and item source fingerprints.

Default maximum: 12,000 estimated tokens. Estimated size is explicitly labeled an estimate because the Copilot model/tokenizer may be unknown.

## 11. Context review contract

The review displays:

- active task and specification revision;
- selected agent and its context restrictions;
- included items grouped by kind;
- reason, source, compression form, and estimated size per item;
- excluded candidates and reasons;
- total estimate and budget;
- secret/ignore warnings;
- user pin, remove, add, regenerate, and reset controls;
- context fingerprint and stale state.

The user review status is `unreviewed`, `reviewed`, or `stale`. Any item change, task/spec revision, agent context-policy change, or source fingerprint change returns it to `unreviewed`/`stale` before delegation.

## 12. Acceptance conditions for this subsystem

- A fixture repository can be fully and incrementally indexed without an LLM.
- Cancelling each stage leaves coherent prior data and no false `ready` state.
- Ignore, secret, binary, generated, and size policies are covered by negative tests.
- Changing one file updates that file, its direct relationships/test mappings, and index version without a full rescan.
- Context selection is deterministic for the same versioned inputs.
- Every included/excluded item has an inspectable reason.
- Packages remain within budget except when mandatory user pins exceed it, which blocks delegation visibly.
- A changed source fingerprint makes a reviewed package stale before delegation.

