# Keystone Developer Documentation

> **Audience:** a developer who has never seen this codebase and needs to become
> productive without reading all 37,700 lines first.
>
> **Status of this folder:** every statement here was verified against the source
> tree and against real tool output on `main` (commit `107e103`). Where the code
> disagrees with the older marketing-flavoured docs in `docs/*.md`, **this folder
> wins** and the discrepancy is called out explicitly.

---

## Read these in order

| # | Document | What it answers |
|---|----------|-----------------|
| 00 | [`00-orientation.md`](00-orientation.md) | What is this product, what does it actually do, what are the 6 things I must know before touching anything |
| 01 | [`01-getting-started.md`](01-getting-started.md) | How do I install, build, launch, and see it working in 10 minutes |
| 02 | [`02-build-system.md`](02-build-system.md) | How the (unusual, hand-rolled) build works, why `tsc` and `npm run build` disagree, which config files are dead |
| 03 | [`03-architecture.md`](03-architecture.md) | Layers, boundaries, dependency rules, process model, threading |
| 04 | [`04-code-map.md`](04-code-map.md) | Directory-by-directory, file-by-file map with LOC and purpose — "where is X?" |
| 05 | [`05-data-model-okf.md`](05-data-model-okf.md) | OKF: the canonical knowledge model. Units, relationships, observations, evidence, projections |
| 06 | [`06-intelligence-pipeline.md`](06-intelligence-pipeline.md) | The 21-stage ingestion pipeline, incremental reuse, caching, cancellation |
| 07 | [`07-cpg-and-languages.md`](07-cpg-and-languages.md) | Code Property Graph, TypeScript compiler-semantic path, 40+ language registry |
| 08 | [`08-storage-layout.md`](08-storage-layout.md) | Everything Keystone writes to `.keystone/`, file by file, with sizes and lifecycles |
| 09 | [`09-webview-and-protocol.md`](09-webview-and-protocol.md) | The React UI, the two host surfaces, the full message protocol |
| 10 | [`10-workflow-sdlc.md`](10-workflow-sdlc.md) | Intent → research → specification → stories → delegation → validation |
| 11 | [`11-task-handoff.md`](11-task-handoff.md) | Encrypted task-state packages, crypto details, redaction, restore |
| 12 | [`12-verification.md`](12-verification.md) | Every verification harness, what it proves, how to run it, current results |
| 13 | [`13-conventions.md`](13-conventions.md) | Coding rules the repo actually enforces, including the custom lint gate |
| 14 | [`14-known-issues.md`](14-known-issues.md) | **Honest debt register.** Broken things, dead code, traps, with file:line |
| 15 | [`15-recipes.md`](15-recipes.md) | "I want to add a…" — step-by-step for the common change types |
| 16 | [`16-glossary.md`](16-glossary.md) | Every acronym and product term used in the code |

---

## The 60-second version

Keystone is a **local-first VS Code extension** that reads a repository, builds a
deterministic knowledge graph of it (no LLM involved in ingestion), persists that
graph to `.keystone/` inside the target repo, and then uses it to assemble a
compressed, evidence-backed context pack that a human can hand to GitHub Copilot.

```
repository files
   ↓  scan + parse (deterministic, no LLM)
RepoIntelligence            ← in-memory structural model
   ↓  21 analysis stages
RepositoryIntelligenceSnapshot
   ↓  projection
OKF snapshot                ← THE canonical persisted model
   ↓  projections
graph.json / search.jsonl / cpg-bindings.jsonl / portable markdown bundle
   ↓  query + retrieval
Context pack  →  human approves  →  Copilot
```

Two things it deliberately does **not** do: it never calls an LLM during
ingestion, and it never performs a Git write (see [`13-conventions.md`](13-conventions.md)
— both are enforced by a lint gate, not by convention alone).

---

## Six facts that will save you hours

1. **`npm run build` does not typecheck.** The build transpiles file-by-file with
   `ts.transpileModule` and cannot fail on type errors. Type safety is a
   *separate* gate: `npm run typecheck`. See [`02-build-system.md`](02-build-system.md).
2. **The working tree is green, but it is not committed.** `build`, `typecheck`,
   `lint`, and `verify:source` all pass — against ~74 uncommitted modified files.
   The last three commits are `gdfg`, `sdfgsdf`, `fdsfdsf`. See
   [`14-known-issues.md`](14-known-issues.md#ki-00).
3. **`eslint.config.js`, `vite.config.ts`, and `esbuild.config.mjs` are dead
   files.** None of those tools are installed. Linting is a ~50-line custom script.
4. **There is no test framework.** No `tests/` directory, no vitest, no jest.
   Verification is done by standalone Node scripts under `scripts/verify-*.mjs`.
5. **`.keystone/` gets very large.** A 1,081-file repository produced ~2.4 GB of
   state. Budget for it; see [`08-storage-layout.md`](08-storage-layout.md).
6. **OKF is the only canonical model.** An older `intelligence/graph/` model was
   deleted. If you find a type that looks like a graph node, check whether it is
   an OKF projection before assuming it is live.

---

## Where the older docs stand

`docs/*.md` (outside this folder) are **product/specification** documents. They
describe intent and are useful for understanding *why*. They are not maintained
against the code and contain claims that are currently false (e.g. `README.md`
references a `vendor/` directory that does not exist).

| Older doc | Use it for | Do not trust it for |
|-----------|-----------|---------------------|
| `KEYSTONE_PRODUCT_SPEC.md` | product intent | current behaviour |
| `ARCHITECTURE.md` | conceptual layering | file paths, module names |
| `OKF_PROFILE.md` | OKF concept design | exact counts/versions |
| `STORAGE_FORMAT.md` | storage intent | actual on-disk layout |
| `NON_GOALS.md` | scope boundaries | — (still broadly accurate) |
| `TASK_HANDOFF.md` | handoff design | — (largely accurate) |
| `FINAL_VERIFICATION.md`, `EXECUTION_EVIDENCE.md` | historical run records | current state |

---

## Conventions used in this folder

- Code references are given as `path/to/file.ts:123` so you can jump straight there.
- Anything marked **⚠️ TRAP** is a place where the obvious assumption is wrong.
- Anything marked **🔴 BROKEN** is currently failing and has an entry in
  [`14-known-issues.md`](14-known-issues.md).
- Commands shown were actually executed; where output is quoted it is real output.
