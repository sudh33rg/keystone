import fs from "node:fs";
import fsp from "node:fs/promises";
import path from "node:path";

const root = process.cwd();
for (const name of ["apps", "packages", "archive"]) {
  if (fs.existsSync(path.join(root, name)))
    throw new Error(`Forbidden legacy root remains: ${name}`);
}
for (const required of [
  "package.json",
  "package-lock.json",
  "src/extension/core/extension.ts",
  "src/extension/browser-view/browserViewServer.ts",
  "src/webview/App.tsx",
  "src/core/application/applicationStore.ts",
  "src/core/intelligence/ingestion/repoIndexer.ts",
  "src/core/intelligence/okf/fromRepoIntelligence.ts",
  "src/core/intelligence/languages/languageRegistry.ts",
  "src/core/workflow/sdlc/engine.ts",
  "src/core/workflow/handoff/contracts.ts"
]) {
  await fsp.access(path.join(root, required));
}
const packageJson = JSON.parse(await fsp.readFile(path.join(root, "package.json"), "utf8"));
const lock = JSON.parse(await fsp.readFile(path.join(root, "package-lock.json"), "utf8"));
if (packageJson.workspaces) throw new Error("The Keystone monolith must not declare workspaces.");
if (!String(packageJson.packageManager ?? "").startsWith("npm@"))
  throw new Error("packageManager must use npm.");
if (Object.values(packageJson.scripts ?? {}).some((value) => /\bpnpm\b/.test(String(value))))
  throw new Error("pnpm remains in package scripts.");
if (packageJson.main !== "./dist/app/extension/core/extension.js")
  throw new Error(`Unexpected extension entrypoint: ${packageJson.main}`);
if (
  lock.name !== packageJson.name ||
  lock.version !== packageJson.version ||
  lock.lockfileVersion < 3
)
  throw new Error("package-lock.json does not match package.json or is not a modern npm lockfile.");

const sources = await walk(path.join(root, "src"), (file) => /\.tsx?$/.test(file));
const forbidden = [
  /CREATE_TEAM_SESSION|RESTORE_TEAM_SESSION|TEAM_SESSION_|\bTeamSession\b/,
  /preferLocalModel|localProvider|LOCAL_MODEL_ONLY|\bOllama\b|\blocal[- ]?SLM\b/i,
  /\bMultiRepo\b|enterprise-multi-repo|multi-repo-enterprise/,
  /\bselfHealing\b|\btestRepair\b/,
  /\.keystone\/knowledge/,
  /keystone\.(?:maxFiles|tokenBudget)|\bmaxFiles\b/,
  /Copilot delegation placeholder/i
];
const forbiddenHits = [];
for (const file of sources) {
  const content = await fsp.readFile(file, "utf8");
  for (const pattern of forbidden)
    if (pattern.test(content)) forbiddenHits.push(`${relative(file)}: ${pattern}`);
}
if (forbiddenHits.length)
  throw new Error(`Legacy or contradictory active concepts remain:\n${forbiddenHits.join("\n")}`);

const gitWrite =
  /\bgit\s+(?:add|commit|push|pull|merge|rebase|checkout|switch|reset|restore|clean|tag|cherry-pick|revert|init|clone)\b/i;
const gitProcess = /(?:execFile|exec|spawn)(?:Sync)?\s*\([^\n]{0,100}['"]git['"]/i;
const gitHits = [];
for (const file of sources) {
  const content = await fsp.readFile(file, "utf8");
  if (gitWrite.test(content)) gitHits.push(`${relative(file)}: write command text`);
  if (gitProcess.test(content) && !isReadOnlyGitInvocation(content))
    gitHits.push(`${relative(file)}: unverified Git process invocation`);
}
if (gitHits.length)
  throw new Error(`Git write or unverified Git process paths remain:\n${gitHits.join("\n")}`);

const unreachable = findUnreachable(sources);
if (unreachable.length)
  throw new Error(
    `Active source files are unreachable from product entrypoints:\n${unreachable.map(relative).join("\n")}`
  );

console.log(
  `Active boundary verified: ${sources.filter((file) => !file.endsWith(".d.ts")).length} reachable monolithic source files, npm lockfile present, no legacy engines, no arbitrary ingestion caps, and Git remains read-only.`
);

function isReadOnlyGitInvocation(content) {
  const writeVerb =
    /['"](?:add|commit|push|pull|merge|rebase|checkout|switch|reset|restore|clean|tag|cherry-pick|revert|init|clone)['"]/i;
  return !writeVerb.test(content);
}
function findUnreachable(files) {
  const fileSet = new Set(files.map((file) => path.resolve(file)));
  const graph = new Map();
  for (const file of files) {
    const content = fs.readFileSync(file, "utf8");
    const dependencies = [];
    for (const match of content.matchAll(
      /(?:from\s*|import\s*\(|require\s*\()\s*['"]([^'"]+)['"]/g
    )) {
      const resolved = resolveImport(file, match[1], fileSet);
      if (resolved) dependencies.push(resolved);
    }
    graph.set(path.resolve(file), dependencies);
  }
  const entries = [
    "src/extension/core/extension.ts",
    "src/extension/workers/backgroundAnalysisWorker.ts",
    "src/core/intelligence/pipeline/intelligenceStageWorker.ts",
    "src/core/intelligence/cpg/typescriptSemanticWorker.ts",
    "src/webview/main.tsx"
  ]
    .map((value) => path.resolve(root, value))
    .filter(fs.existsSync);
  const seen = new Set();
  const pending = [...entries];
  while (pending.length) {
    const file = pending.pop();
    if (!file || seen.has(file)) continue;
    seen.add(file);
    for (const dependency of graph.get(file) ?? []) pending.push(dependency);
  }
  return files.filter((file) => !file.endsWith(".d.ts") && !seen.has(path.resolve(file)));
}
function resolveImport(sourceFile, specifier, fileSet) {
  let base;
  if (specifier.startsWith("@core/"))
    base = path.join(root, "src/core", specifier.slice("@core/".length));
  else if (specifier.startsWith("@vscode/"))
    base = path.join(root, "src/extension", specifier.slice("@vscode/".length));
  else if (specifier.startsWith("@webview/"))
    base = path.join(root, "src/webview", specifier.slice("@webview/".length));
  else if (specifier.startsWith(".")) base = path.resolve(path.dirname(sourceFile), specifier);
  else return undefined;
  base = base.replace(/\.js$/, "");
  for (const candidate of [
    base,
    `${base}.ts`,
    `${base}.tsx`,
    path.join(base, "index.ts"),
    path.join(base, "index.tsx")
  ]) {
    const resolved = path.resolve(candidate);
    if (fileSet.has(resolved)) return resolved;
  }
  return undefined;
}
async function walk(directory, predicate) {
  const output = [];
  for (const entry of await fsp.readdir(directory, { withFileTypes: true })) {
    const target = path.join(directory, entry.name);
    if (entry.isDirectory()) output.push(...(await walk(target, predicate)));
    else if (predicate(target)) output.push(target);
  }
  return output;
}
function relative(file) {
  return path.relative(root, file).split(path.sep).join("/");
}
