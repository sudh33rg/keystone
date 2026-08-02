# 15 — Recipes

Step-by-step for the change types you'll actually hit. Each recipe lists every
file you must touch — the codebase has several places where forgetting one leaves
a silent runtime failure.

---

## Recipe 1 — Add a new webview feature (end to end)

The most common change, and the one with the most steps. Example: a button that
shows "orphan modules".

**1. Core logic** — `src/core/integration/webview/cockpitService.ts`
```ts
async findOrphanModules(): Promise<OrphanModuleResult> {
  const snapshot = await this.okfStore.read();
  // …derive from OKF, never from a new store
}
```

**2. Protocol** — `src/core/integration/webview/messageRouter.ts`
```ts
// WebviewToExtensionMessage
| { type: "FIND_ORPHAN_MODULES" }

// ExtensionToWebviewMessage
| { type: "ORPHAN_MODULES_RESULT"; modules: OrphanModule[] }
```

**3. Host handler** — `src/extension/ui/vscodeProvider.ts`, in the
`handleMessage` chain (starts ~line 461; it is an `if/else if` chain, **not** a
`switch` — grep an existing message name to find the spot):
```ts
} else if (message.type === "FIND_ORPHAN_MODULES") {
  const service = this.serviceFor(root);
  const modules = await service.findOrphanModules();
  this.post({ type: "ORPHAN_MODULES_RESULT", modules });
}
```

**4. Mirror the view-model type** — `src/webview/model.ts`
```ts
export interface OrphanModule { id: string; path: string; }
```
⚠️ Required: `webview/` cannot import `@core/*`.

**5. UI** — `src/webview/App.tsx`: add state, a sender, a handler branch, a render
method.
```ts
// send
vscode.postMessage({ type: "FIND_ORPHAN_MODULES" });
// receive — add to the else-if chain around line 139+
} else if (message.type === "ORPHAN_MODULES_RESULT") {
  this.setState({ orphanModules: message.modules as OrphanModule[] });
}
```

**6. Verify**
```bash
npm run format && npm run verify:source && npm run build
```
Then **F5 and click it**. Steps 3↔5 are not type-checked
([KI-01](14-known-issues.md#ki-01)) — a typo compiles fine and does nothing.

---

## Recipe 2 — Add a pipeline stage

**1.** Add the ID to `src/core/intelligence/pipeline/types.ts`:
```ts
export const INTELLIGENCE_STAGES = [
  …,
  "runtime-observability",
  "license-compliance"        // ← new, at the end to keep existing order stable
] as const;
```
The `IntelligenceStageId` union derives from this array, so `tsc` will now point
at every place needing an update.

**2.** Add the implementation to `STAGES[]` in `pipeline.ts` (~line 981):
```ts
stage("license-compliance", "License Compliance Intelligence", "architecture-sdlc",
  ({ intelligence }) => {
    const licenses = unique(intelligence.files
      .filter((f) => /LICENSE|COPYING/i.test(f.path))
      .map((f) => f.path));
    return {
      summary: `${licenses.length} license artifacts detected.`,
      items: licenses,
      metrics: { licenses: licenses.length }
    };
  }
),
```
Return shape is always `{ summary, items, metrics }`. The stage may be `async`.
Pick a family from `INTELLIGENCE_FAMILIES` (6 options: `repository-structure`,
`code-graph`, `build-test-qa`, `architecture-sdlc`, `context-token`,
`runtime-analysis`).

**3.** Consider `pipeline/health.ts` and `pipeline/findings.ts` if the stage
should affect the health report or emit findings.

**4.** Verify
```bash
npm run verify:source && npm run build && npm run verify:okf
```
Then F5, index a repo, and check
`.keystone/intelligence/stages/22-license-compliance.json`.

**Fail-soft reminder:** if your stage throws, the pipeline continues and the
snapshot becomes `"degraded"`. Don't add try/catch that swallows silently — let
the framework record the error.

---

## Recipe 3 — Add an OKF unit kind or relationship kind

**⚠️ This is a breaking change.** `KEYSTONE_OKF_PROFILE_DIGEST` is a sha256 of
the frozen profile object. Changing the profile changes the digest, and
`validateOkfSnapshot()` rejects every previously persisted snapshot
(`validation.ts:59`). All users get a forced full re-index.

**1.** `src/core/intelligence/okf/types.ts` — add to `KeystoneKnowledgeKind` (or
`KeystoneRelationshipKind`).

**2.** `src/core/intelligence/okf/profile.ts` — add to the `kinds` array (line 26)
or `relationshipKinds` (line 63). For relationships, also add a
`relationshipConstraints` entry declaring legal source/target kinds.

**3.** `src/core/intelligence/okf/fromRepoIntelligence.ts` — emit the new units.
This is the only place OKF records are created.

**4.** Check consumers: `okf/projections.ts`, `okf/queryEngine.ts`,
`okf/bundle.ts` (it pluralises kinds for directory names — verify
`pluralize()` handles yours), `explorer/intelligenceExplorer.ts`.

**5.** Verify
```bash
npm run verify:okf && npm run verify:cross-feature
```
`verify-final.mjs` exercises `validateOkfSnapshot` and
`validatePortableOkfBundle`.

**6.** Users must re-index. Consider whether `RevisionGuard` should force it.

---

## Recipe 4 — Add a language

**1.** `src/core/intelligence/languages/languageRegistry.ts`, in
`LANGUAGE_DEFINITIONS` (line 120):
```ts
def("zig", "Zig", [".zig"], deterministic, "deterministic-adapter", ["source", "native"]),
```
Tiers: `deep` (TS compiler only), `deterministic` (structural + VS Code
enrichment), `structural` (artifact).

**2.** If it needs a new grammar family, extend `frontendFor()` (line 103) **and**
teach `structuralParser.ts` the family. Otherwise it falls back to
`brace-grammar`.

**3.** Filename-matched languages (no extension) follow the
dockerfile/make/cmake/maven/gradle/kubernetes pattern — empty `extensions: []`.

**4.** Check `BINARY_EXTENSIONS` in `ingestion/fileScanner.ts:41` doesn't exclude it.

**5.** Verify: `npm run build`, index a repo containing that language, check
`.keystone/intelligence/stages/02-language-framework.json`.

---

## Recipe 5 — Add a VS Code command

**Four places** — miss any one and it silently doesn't work.

**1.** `package.json` → `contributes.commands`:
```jsonc
{ "command": "keystone.exportBundle", "title": "Keystone: Export OKF Bundle" }
```
**2.** `package.json` → `activationEvents`:
```jsonc
"onCommand:keystone.exportBundle"
```
**3.** `src/extension/commands/indexCommands.ts`:
```ts
vscode.commands.registerCommand("keystone.exportBundle", () => provider.exportBundle()),
```
**4.** `src/extension/ui/vscodeProvider.ts` — implement `exportBundle()`.

Skipping 1–2 is exactly [KI-04](14-known-issues.md#ki-04): the command works in
code but is invisible to users.

---

## Recipe 6 — Persist a new artifact

**1.** Path constant in `src/core/platform/config/defaults.ts` if it's global.

**2.** Use the atomic write pattern — always:
```ts
const target = path.join(root, ".keystone", "myfeature", "data.json");
const temporary = `${target}.${process.pid}.${Date.now()}.tmp`;
try {
  await fs.mkdir(path.dirname(target), { recursive: true });
  await fs.writeFile(temporary, `${JSON.stringify(value, null, 2)}\n`, "utf8");
  await fs.rename(temporary, target);
} catch {
  await fs.rm(temporary, { force: true }).catch(() => undefined);
}
```

**3.** **Workspace-relative paths only.** OKF validation rejects absolute paths;
apply the same discipline everywhere. Use `okf/identity.ts` for IDs.

**4.** Decide the lifecycle — should `snapshotPrune.ts` clean it up?

**5.** **Is it OKF-derived?** If so make it a *projection*
(`okf/projections.ts`), not a new store. A parallel graph store was built once
and deleted ([`05-data-model-okf.md`](05-data-model-okf.md)).

**6.** Document it in [`08-storage-layout.md`](08-storage-layout.md).

---

## Recipe 7 — Add a verification script

```js
// scripts/verify-myfeature.mjs
import assert from "node:assert/strict";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const built = (...s) => path.join(process.cwd(), "dist", "app", ...s);
const { MyThing } = require(built("core", "myarea", "myThing.js"));

async function main() {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "keystone-verify-"));
  try {
    const result = await new MyThing(dir).run();
    assert.equal(result.status, "ok", "MyThing should succeed on an empty repo");
    console.log("PASS myfeature: empty repo handled");
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
  console.log("\nMYFEATURE VERIFICATION PASSED");
}

main().catch((error) => {
  console.error("VERIFICATION FAILED:", error);
  process.exit(1);
});
```

Then in `package.json`:
```jsonc
"verify:myfeature": "npm run build && node scripts/verify-myfeature.mjs"
```

**Always `require()` from `dist/app/`, never `src/`.** That is the convention and
it's why `core` must stay free of `vscode` imports.

---

## Recipe 8 — Use a VS Code API that doesn't typecheck

Symptom: `npm run typecheck` says a real VS Code API doesn't exist.

Cause: `src/types/vscode/index.d.ts` is a hand-written 227-LOC partial stub.

Fix — extend the stub:
```ts
// src/types/vscode/index.d.ts
export namespace window {
  export function showQuickPick(
    items: readonly string[],
    options?: { title?: string; placeHolder?: string }
  ): Thenable<string | undefined>;
}
```

Do **not** `npm install @types/vscode` reflexively — it would change many
inferred types simultaneously in a codebase with no test safety net
([KI-14](14-known-issues.md#ki-14)).

---

## Recipe 9 — Debug a bad index

```bash
# 1. the live log
#    Output panel → "Keystone Intelligence" channel

# 2. the event trail
cat <repo>/.keystone/intelligence/activity.json

# 3. the ingestion honesty record
cat <repo>/.keystone/intelligence/summary.json | jq .ingestion
```

Read the `ingestion` block:

| Symptom | Cause |
|---|---|
| `indexedFiles` far too low | an ignore rule is too broad — check `IGNORED_DIRECTORIES` and the repo's own `.gitignore` |
| `reusedFiles` high after a real change | bump `STRUCTURAL_EXTRACTION_CACHE_VERSION` in `extractionCache.ts` |
| `cpgEligibleFiles` ≫ `cpgIndexedFiles` | CPG construction skipping — see `warnings[]` |
| `completedWithoutFileCap: false` | should never happen; a cap was introduced |

```bash
# 4. per-stage detail
cat <repo>/.keystone/intelligence/stages/NN-<stage>.json

# 5. nuclear option — clear and re-index
rm -rf <repo>/.keystone/intelligence
```

**Leftover `okf.candidate-*` or `okf.previous`** means a promotion crashed. Safe
to delete.

---

## Recipe 10 — Debug a blank/broken webview

1. **Check the build output exists:**
   ```bash
   ls dist/media/
   # index.html webview.js App.js GraphCanvas.js model.js vscodeApi.js
   # webview.css react.production.min.js react-dom.production.min.js
   ```
   Missing files → you ran a partial build. Run full `npm run build`.

2. **Open webview DevTools:** Command Palette → *Developer: Open Webview
   Developer Tools*. CSP violations and JS errors appear here.

3. **CSP:** the VS Code webview uses a nonce (`extension/ui/vscodeHtml.ts`); the
   Browser View uses strict `'self'`. No inline scripts, no external CDNs.

4. **Message not arriving?** It is untyped
   ([KI-01](14-known-issues.md#ki-01)) — verify the string matches exactly in all
   three places: `messageRouter.ts`, `vscodeProvider.ts`, `App.tsx`.

5. **React 16 reminders:** no hooks, no `createRoot`, classic JSX runtime —
   `React` is a UMD global declared in `react-globals.d.ts`.

---

## Recipe 11 — Worker not starting

Workers are loaded by **built path** at runtime:
```ts
new Worker(path.join(__dirname, "../workers/backgroundAnalysisWorker.js"))
```

Checklist:
1. Did you run a **full** `npm run build`? A `build:extension`-only run can leave
   the emitted tree inconsistent.
2. Does `dist/app/extension/workers/backgroundAnalysisWorker.js` exist?
3. Did you move/rename a worker source file? The `dist/app/` layout must keep
   mirroring `src/`.
4. Background workers only start **after a new promoted OKF snapshot**
   (`extension.ts` `startWorkspace`). No new snapshot ⇒ no workers, by design.
5. 120-second timeout per worker — a slow analysis on a huge repo shows up as
   `workerStatus: "failed"` with a timeout message in
   `.keystone/background/<kind>.json`.

---

## Recipe 12 — Safely delete code

This repo has had a 1,712-LOC dead subsystem before. To confirm something is
truly dead:

```bash
# 1. any importers?
grep -rn "myModule" src --include=*.ts --include=*.tsx

# 2. referenced by a verify script or the build?
grep -rn "myModule" scripts/

# 3. reachable from an entrypoint?
#    entrypoints: extension/core/extension.ts, webview/main.tsx,
#    extension/workers/*, pipeline/intelligenceStageWorker.ts,
#    cpg/typescriptSemanticWorker.ts
```

**⚠️ TRAP:** worker entry files look orphaned — nothing imports them, they are
loaded by path string. Never delete a `*Worker.ts` on reachability grounds alone.

After deleting:
```bash
npm run verify:source   # boundary check will report the new reachable count
npm run build && npm run verify:core && npm run verify:okf
```

Next: [`16-glossary.md`](16-glossary.md).
