# 07 — CPG and Language Support

Two related subsystems: the **Code Property Graph** (fine-grained per-file graph)
and the **language registry** (what Keystone can parse, and how well).

---

## Part 1 — The language registry

`src/core/intelligence/languages/languageRegistry.ts` — **43 language
definitions** (`LANGUAGE_DEFINITIONS`, line 120), plus a
`UNIVERSAL_TEXT_DEFINITION` fallback with `id: "unknown"`.

### Three capability tiers

Every language is assigned one of three capability profiles (`languageRegistry.ts:20-70`):

| Tier | parsing | symbols | imports | calls | controlFlow | dataFlow | cpg | tests |
|---|---|---|---|---|---|---|---|---|
| **`deep`** | deep | deep | deep | deep | **semantic** | **semantic** | deep | semantic |
| **`deterministic`** | structural | structural | structural | structural | structural | universal | structural | structural |
| **`structural`** | structural | structural | structural | structural | structural | universal | structural | structural |

`deterministic` and `structural` currently have **identical capability values**;
they differ in `parser` (`"deterministic-adapter"` vs `"artifact"`), which is what
actually changes behaviour downstream.

### Derived attributes

For each definition, three fields are computed rather than declared:

```ts
conformance = parser === "typescript"            ? "compiler-backed"
            : parser === "deterministic-adapter" ? "deterministic-grammar"
            :                                      "structural-artifact"

baseline    = parser === "typescript"            ? "compiler"
            : parser === "deterministic-adapter" ? "deterministic-structural"
            :                                      "structural-artifact"

semanticEnrichment = parser === "typescript" ? "built-in" : "vscode-language-service"
```

That last one matters: **non-TypeScript languages get their semantic depth from
VS Code's own language services**, via the `SemanticEnrichmentProvider` seam
(implemented by `extension/intelligence/vscodeLanguageServiceEnricher.ts`). If
the user has no extension installed for a language, that language stays at its
structural baseline. This is a deliberate trade: no bundled parsers, no native
binaries, no `tree-sitter`.

### Grammar frontends

`frontendFor()` (`languageRegistry.ts:103`) picks a parsing strategy:

| Frontend | Languages |
|---|---|
| `typescript-compiler` | typescript, javascript |
| `indent-grammar` | python, ruby, r, julia, lua |
| `functional-grammar` | elixir, erlang, haskell |
| `shell-grammar` | shell, powershell, perl |
| `schema-grammar` | sql, graphql, protobuf |
| `markup-grammar` | html, xml, markdown, css |
| `data-grammar` | json, yaml, toml (+ any `artifact` parser) |
| `infrastructure-grammar` | terraform, dockerfile, make, cmake, maven, gradle, kubernetes |
| `brace-grammar` | everything else (java, go, rust, c, cpp, …) |

All non-TypeScript frontends are implemented by
`languages/structuralParser.ts` (362 LOC) — one deterministic parser
parameterised by grammar family.

### The full language table

**Tier `deep` (2)** — TypeScript compiler, full semantics:
`typescript` (.ts .tsx) · `javascript` (.js .jsx .mjs .cjs)

**Tier `deterministic` (27)** — structural parse + optional VS Code enrichment:

| | | |
|---|---|---|
| python `.py .pyi` | java `.java` | csharp `.cs` |
| go `.go` | rust `.rs` | kotlin `.kt .kts` |
| c `.c .h` | cpp `.cc .cpp .cxx .hpp .hh` | php `.php` |
| ruby `.rb` | swift `.swift` | scala `.scala` |
| dart `.dart` | objective-c `.m .mm` | lua `.lua` |
| groovy `.groovy` | elixir `.ex .exs` | erlang `.erl .hrl` |
| haskell `.hs` | r `.r .R` | julia `.jl` |
| perl `.pl .pm` | shell `.sh .bash .zsh` | powershell `.ps1 .psm1` |
| sql `.sql` | graphql `.graphql .gql` | protobuf `.proto` |

**Tier `structural` (14)** — artifacts, indexed but not semantically analysed:

| | | |
|---|---|---|
| html `.html .htm` | css `.css .scss .sass .less` | json `.json` |
| yaml `.yaml .yml` | toml `.toml` | xml `.xml` |
| markdown `.md .mdx` | terraform `.tf .tfvars .hcl` | dockerfile *(by filename)* |
| make *(by filename)* | cmake *(by filename)* | maven *(by filename)* |
| gradle *(by filename)* | kubernetes *(by filename/content)* | |

**⚠️ The last six have empty `extensions` arrays** — they are matched by filename
or content, not by suffix. If you add a build-system language, follow that
pattern rather than inventing an extension.

### Adding a language

1. Add a `def(...)` entry to `LANGUAGE_DEFINITIONS` (`languageRegistry.ts:120`).
2. If it needs a new grammar family, extend `frontendFor()` **and**
   `structuralParser.ts`.
3. If it's binary-ish, check `BINARY_EXTENSIONS` in `fileScanner.ts:41`.
4. Re-index. Verify via the `language-framework` stage output in
   `.keystone/intelligence/stages/02-language-framework.json`.

---

## Part 2 — The Code Property Graph

A CPG unifies AST, control flow, and data flow into one graph per file. Keystone
builds one **per file**, stored as a compressed shard.

Types: `src/core/intelligence/cpg/types.ts`.

### Node and edge model

```ts
type CpgNodeKind = "file" | "syntax" | "declaration";
type CpgEdgeKind = "ast" | "eog" | "cfg" | "dfg" | "cdg" | "call";
```

| Edge kind | Meaning |
|---|---|
| `ast` | Abstract Syntax Tree parent→child |
| `eog` | Evaluation Order Graph |
| `cfg` | Control Flow Graph |
| `dfg` | Data Flow Graph |
| `cdg` | Control Dependence Graph |
| `call` | Call edge |

```ts
interface CpgNode {
  id, kind, language, syntaxKind, name?,
  location: CpgLocation,           // path + offsets + line/col start/end
  metadata: Record<string, unknown>,
  okfId?: string                   // ← canonical OKF unit, when resolvable
}

interface CpgEdge {
  id, sourceId, targetId, kind, metadata,
  okfSourceId?, okfTargetId?       // ← OKF-resolved endpoints
}
```

**The `okfId` / `okfSourceId` / `okfTargetId` fields are the important part.**
They bind CPG nodes back to canonical OKF units, which is what keeps CPG a
*secondary* model rather than a competing one. The binding is projected out to
`.keystone/intelligence/projections/cpg-bindings.jsonl`.

### Capabilities are declared per graph

```ts
interface CpgCapabilities {
  ast, eog, cfg, dfg, cdg, typeResolution: boolean
}

interface CodePropertyGraph {
  schemaVersion: 1,
  language, sourcePath, contentHash,
  capabilities: CpgCapabilities,
  nodes: readonly CpgNode[],
  edges: readonly CpgEdge[]
}
```

A consumer must check `capabilities` before trusting an edge kind's absence.
A Python CPG with `typeResolution: false` having no `dfg` edges means "not
computed", not "no data flow exists". **Never infer absence from an empty edge
list without checking the capability flag.**

`contentHash` is what makes shard reuse safe.

### Two builders

| Builder | File | Used for |
|---|---|---|
| `buildTypeScriptCpg()` | `typescriptCpgBuilder.ts` (275 LOC) | TS/JS — full capabilities |
| `buildUniversalCpg()` | `universalCpgBuilder.ts` (301 LOC) | everything else — deterministic, reduced capabilities |

### TypeScript semantic analysis

`cpg/typescriptSemantic.ts` (469 LOC) is the deepest analysis in the product. It
instantiates a real TypeScript `Program` and uses the **type checker** to resolve:

- call edges (including through variables and members)
- callback/higher-order invocations
- type relationships (implements / extends)

Two entry points:
- `analyzeTypeScriptProject()` — in-process
- `analyzeTypeScriptProjectIsolated()` — in a `worker_thread`
  (`typescriptSemanticWorker.ts`), because a TS Program on a large repo is
  memory-heavy and can otherwise destabilise the extension host

`typescript@5.8.3` is a **runtime** dependency (not devDependency) precisely
because of this, and `package-vsix.mjs` ships `node_modules/typescript` inside
the VSIX.

#### Call resolution correctness

This is verified explicitly. `scripts/verify-call-resolution.mjs`:

```
PASS call-resolution: base.method 'helper.doWork' resolved via import scope
     (no global fallback, no unresolvedCallee)
```

The property being protected: when resolving `helper.doWork()`, the resolver must
use the **import scope** to find the real declaration, and must not fall back to
a global name match (which would create false edges between unrelated same-named
methods). If you touch call resolution, this script is your regression gate.

### Shard storage

`cpg/shardStore.ts` → `.keystone/intelligence/cpg/`

- one gzipped shard per file
- tracked by a manifest
- reuse keyed on `contentHash`
- accounting surfaces as `cpgShardsWritten / cpgShardsReused / cpgShardsDeleted`
  in the ingestion summary

`IntelligenceIngestionSummary` also reports `cpgEligibleFiles` vs
`cpgIndexedFiles` — if those diverge sharply, CPG construction is skipping files
and the `warnings[]` array will say why.

---

## How the pieces relate

```
file  ──languageForPath()──►  LanguageDefinition
                                   │ parser
              ┌────────────────────┴────────────────────┐
              │ "typescript"                            │ else
              ▼                                         ▼
   analyzeTypeScriptProject()              parseStructuralSyntax()
   (real type checker, worker)             (deterministic grammar)
              │                                         │
              ▼                                         ▼
   buildTypeScriptCpg()                    buildUniversalCpg()
              └────────────────┬────────────────────────┘
                               ▼
                    CodePropertyGraph (per file)
                               │
                    CpgShardStore (gzip + manifest)
                               │
                    okfId bindings ──► projections/cpg-bindings.jsonl
                               │
                    stage 11 "code-property-graph"
```

Next: [`08-storage-layout.md`](08-storage-layout.md).
