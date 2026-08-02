# 02 — Build System

This is the most surprising part of the repo. Read it before you debug a build
problem, or you will waste an afternoon editing config files that nothing reads.

---

## The headline

**Keystone does not use a bundler.** It uses a ~130-line hand-written Node script
(`scripts/build.mjs`) that calls the TypeScript compiler's
`ts.transpileModule()` once per file.

Consequences, all of which matter:

| Consequence | Why |
|---|---|
| The build **cannot fail on type errors** | `transpileModule` is single-file, type-unaware |
| The build is **fast** and has no dependency graph | no bundling, no tree-shaking |
| `import` specifiers must be **rewritten manually** | done by a regex, see below |
| Emitted layout **mirrors `src/`** one-to-one | `dist/app/core/...`, `dist/app/extension/...` |
| `worker_threads` can load emitted files by path | this is why the layout is preserved |
| **Type safety is a separate, opt-in gate** | `npm run typecheck` |

---

## Dead configuration files ⚠️

These files exist in the repo root and are **never executed**. The tools they
configure are not in `node_modules`.

| File | Configures | Installed? | Status |
|---|---|---|---|
| `esbuild.config.mjs` | esbuild bundling to `dist/extension.js` | ❌ no esbuild | **dead** |
| `vite.config.ts` | Vite + `@vitejs/plugin-react` webview build | ❌ no vite | **dead** |
| `eslint.config.js` | ESLint flat config, `@typescript-eslint` | ❌ no eslint | **dead** |
| `tsconfig.eslint.json` | project for the dead ESLint config | — | **dead** |
| `tsconfig.extension-test.json` | compiles `tests/integration/**` | no `tests/` dir | **dead** |

Verified: `ls node_modules` returns 25 packages, none of which is eslint, vite,
esbuild, or vitest.

**They are worth keeping as a record of intent** — `esbuild.config.mjs` and
`vite.config.ts` describe the "normal" build this project would have if it
adopted bundling, and `eslint.config.js` lists the four rules the project cares
about (`no-console`, `consistent-type-imports`, `no-floating-promises`,
`no-misused-promises`). But do not edit them expecting an effect.

---

## What actually runs

### `npm run build`

```
npm run build
  → npm run clean            → node scripts/clean.mjs
  → node scripts/build.mjs
```

`scripts/clean.mjs` removes `dist`, `out`, `.runtime-check`, `.test-dist`.

`scripts/build.mjs` has two halves:

#### Half 1 — `buildApplication()` (`build.mjs:57-83`)

1. Walk `src/core/**` and `src/extension/**` for `.ts`, excluding `.d.ts`.
2. For each file, read the source and **rewrite path aliases to relative paths**
   (`rewriteAliases`, `build.mjs:50`). The regex is:

   ```js
   /(from\s+|import\s*\(|require\s*\()(['"])(@(?:core|vscode|webview)\/[^'"]+)\2/g
   ```

   Alias map (`build.mjs:30-34`):
   | Alias | Source dir |
   |---|---|
   | `@core/` | `src/core/` |
   | `@vscode/` | `src/extension/` |
   | `@webview/` | `src/webview/` |

3. Transpile with:
   ```js
   target: ES2022, module: CommonJS, moduleResolution: Node10,
   esModuleInterop: true, sourceMap: true, inlineSources: true
   ```
4. Write `dist/app/<same relative path>.js` plus `.js.map`.

**⚠️ TRAP:** the alias rewrite is a *regex on raw text*. It only matches aliases
in `from "..."`, `import("...")`, and `require("...")` forms with the alias at
the start of the specifier. A dynamic or computed import path with an alias will
silently survive into the output and fail at runtime. `scripts/lint.mjs`
independently validates that every alias resolves to a real file — that check is
your safety net.

#### Half 2 — `buildWebview()` (`build.mjs:84-129`)

1. Walk `src/webview/**` for `.ts`/`.tsx`.
2. Rewrite **relative** specifiers to append `.js`
   (`from "./App"` → `from "./App.js"`), because the output is native ESM
   loaded by a browser.
3. Transpile with `module: ES2022`, `moduleResolution: Bundler`, `jsx: React`,
   `strict: true`.
4. Write to `dist/media/<basename>.js`, with the special case
   `main.js → webview.js`.

   **⚠️ TRAP:** output is *flat by basename*. Two webview files with the same
   basename in different subdirectories would silently overwrite each other.
   Today `src/webview/` is flat, so it works.

5. Copy `src/webview/theme.css` → `dist/media/webview.css`.
6. Copy the two React UMD builds from `node_modules`.
7. Copy `src/webview/index.html` → `dist/media/index.html`, rewriting
   `/main.tsx` → `./webview.js`.

**⚠️ `jsx: React` (classic runtime), not `react-jsx`.** That is why `App.tsx`
uses the global `React` from the UMD script rather than importing it, and why
`src/webview/react-globals.d.ts` exists to declare those globals.

### `npm run watch`

```
node scripts/build.mjs --watch
```

This **does not watch**. It prints:

> Keystone local toolchain performs a full deterministic rebuild on each
> invocation; external file watching is intentionally not bundled.

…and then does a single normal build (`build.mjs:8-11`). Re-run `npm run build`
manually, or reload the Extension Development Host with **Ctrl/Cmd+R** after
building.

**⚠️ `.vscode/tasks.json` still defines a `npm: watch` task with a
`$tsc-watch` problem matcher.** That matcher will never fire.

---

## The three live TypeScript configs

| Config | Used by | `include` | Purpose |
|---|---|---|---|
| `tsconfig.json` | `npm run typecheck:extension` | `src/extension/**/*.ts`, `src/core/**/*.ts` | type-check the host/core |
| `tsconfig.webview.json` | `npm run typecheck:webview` | `src/webview/**/*` | type-check the UI |
| *(neither)* | `scripts/build.mjs` | — | build ignores both, uses inline options |

### `tsconfig.json` highlights

```jsonc
target: "ES2022", module: "CommonJS", moduleResolution: "Node",
lib: ["ES2022"],                       // no DOM — correct for the host
strict: true,
noImplicitOverride: true,
noImplicitReturns: true,
noFallthroughCasesInSwitch: true,
forceConsistentCasingInFileNames: true,
skipLibCheck: true,
noEmit: true,
types: ["node", "vscode"],
typeRoots: ["./node_modules/@types", "./src/types"]
paths: { "@core/*", "@vscode/*", "@webview/*" }
```

**⚠️ TRAP — `vscode` types are vendored, not installed.** There is no
`@types/vscode` package. `src/types/vscode/index.d.ts` (227 LOC) is a
**hand-written partial stub** of the VS Code API, picked up via `typeRoots`.

That means:
- If you use a VS Code API that is not in that stub, `npm run typecheck` fails
  with "property does not exist" even though the API is real.
- **The fix is to extend the stub**, not to install `@types/vscode` (which would
  change many inferred types at once).
- The stub is also why `skipLibCheck: true` is essential here.

### `tsconfig.webview.json` highlights

```jsonc
module: "ESNext", moduleResolution: "Bundler",
jsx: "react",       // classic runtime — matches build.mjs
strict: true,
types: []           // deliberately empty: no node, no vscode
```

`types: []` is why the webview cannot accidentally reference Node or VS Code
APIs. DOM types come from the default lib.

---

## Linting: a custom script, not ESLint

`npm run lint` → `node scripts/lint.mjs` (~50 lines). It walks `src/**` for
`.ts|.tsx|.js|.mjs` and enforces **two** things.

### 1. Prohibited patterns (`lint.mjs:6-12`)

| Pattern | Rejected because |
|---|---|
| `@ts-ignore` / `@ts-nocheck` | no type suppression allowed |
| `TeamSession`, `TEAM_SESSION`, `localSlm`, `localSLM`, `Ollama` | obsolete product concepts must not reappear |
| `execFile(`, `spawn(`, `spawnSync(` | **process execution is banned by default** |
| `git add\|commit\|push\|pull\|checkout\|merge\|reset\|rebase\|tag` | **Git writes are banned** |
| `/opt/nvm/` | no environment-specific absolute paths |

The process-execution ban has exactly **three allow-listed files**
(`lint.mjs:15-21`):

```
src/core/platform/git/gitReadOnly.ts
src/core/workflow/validation/validationRunner.ts
src/core/workflow/quality/testExecution.ts
```

If you need to run a subprocess anywhere else, the correct move is to route
through one of those three modules — not to add a fourth exception.

### 2. Alias resolution (`lint.mjs:32-45`)

Every `@core/…`, `@vscode/…`, `@webview/…` specifier must resolve to a real file
(`.ts`, `.tsx`, `.js`, `.mjs`, `/index.ts`, `/index.tsx`). This is what protects
you from the regex-rewrite trap described above.

Real output:

```
Linted 132 active source file(s).
```

---

## The boundary check

```bash
node scripts/check-active-boundary.mjs
```

Real output:

```
Active boundary verified: 129 reachable monolithic source files, npm lockfile
present, no legacy engines, no arbitrary ingestion caps, and Git remains read-only.
```

It is part of `npm run verify:source`. Note **129 reachable** vs **132 linted** —
the difference is unreachable/orphan files (see [`14-known-issues.md`](14-known-issues.md)).

---

## Formatting

```bash
npm run format         # prettier --write
npm run format:check   # prettier --check
```

`prettier.config.js`: `printWidth: 100`, `semi: true`, `trailingComma: "none"`.
Prettier **is** installed and this genuinely runs.

---

## Complete script reference

| Script | Command | Live? |
|---|---|---|
| `clean` | `node scripts/clean.mjs` | ✅ |
| `build` | `clean && node scripts/build.mjs` | ✅ |
| `build:extension` | `build.mjs --extension-only` | ✅ |
| `build:webview` | `build.mjs --webview-only` | ✅ |
| `compile` | alias for `build` (used by `launch.json`) | ✅ |
| `watch` | `build.mjs --watch` | ⚠️ no-op watch, does one build |
| `typecheck` | `typecheck:extension && typecheck:webview` | ✅ passes |
| `typecheck:extension` | `tsc -p tsconfig.json --noEmit` | ✅ |
| `typecheck:webview` | `tsc -p tsconfig.webview.json --noEmit` | ✅ |
| `lint` | `node scripts/lint.mjs` | ✅ custom |
| `format` / `format:check` | prettier | ✅ |
| `verify:source` | `clean && typecheck && lint && check-active-boundary` | ✅ |
| `verify:core` | `build && verify-core.mjs` | ✅ |
| `verify:okf` | `build && verify-call-resolution.mjs && verify-graph-stack.mjs` | ✅ |
| `verify:cross-feature` | `build && verify-final.mjs` | ✅ heavy |
| `verify:production` | `build && verify-production-acceptance.mjs` | ✅ very heavy |
| `evidence:browser` | `build && evidence-browser.mjs` | ✅ |
| `package:vsix` | `build && package-vsix.mjs` | ✅ |
| `verify:vsix` | `verify-vsix.mjs` | ✅ needs `unzip` |
| `package:project` | `package-project.mjs` | ✅ source archive |

---

## Debugging build problems — checklist

1. **"Cannot find module './x'" at runtime** → alias rewrite missed it. Run
   `npm run lint`; it validates alias resolution.
2. **Worker fails to start** → you did a partial build (`build:extension` only,
   or `build:webview` only). Workers are loaded from `dist/app/extension/workers/*.js`
   by path. Do a full `npm run build`.
3. **Webview blank** → check `dist/media/` has all 4 JS files + `webview.css`.
   Check the webview DevTools console (Command Palette → *Developer: Open Webview
   Developer Tools*). CSP violations show up here.
4. **Type error the build didn't catch** → expected. `npm run typecheck`.
5. **Type error about a VS Code API that definitely exists** → the vendored stub
   `src/types/vscode/index.d.ts` is incomplete. Extend it.

Next: [`03-architecture.md`](03-architecture.md).
