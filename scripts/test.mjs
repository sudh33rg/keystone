import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import ts from "typescript";

const root = process.cwd();
const outRoot = path.join(root, ".test-dist");
fs.rmSync(outRoot, { recursive: true, force: true });
const sourceRoots = ["src/core", "src/extension", "tests/unit", "tests/support"];
const files = sourceRoots
  .flatMap((relative) => walk(path.join(root, relative)))
  .filter((file) => /\.tsx?$/.test(file) && !file.endsWith(".d.ts"));
for (const file of files) {
  const relative = path.relative(root, file).replace(/\.tsx?$/, ".js");
  const out = path.join(outRoot, relative);
  let source = fs.readFileSync(file, "utf8");
  source = rewrite(source, file, out);
  const result = ts.transpileModule(source, {
    fileName: file,
    compilerOptions: {
      target: ts.ScriptTarget.ES2022,
      module: ts.ModuleKind.CommonJS,
      moduleResolution: ts.ModuleResolutionKind.Node10,
      esModuleInterop: true,
      jsx: ts.JsxEmit.React
    }
  });
  fs.mkdirSync(path.dirname(out), { recursive: true });
  fs.writeFileSync(out, result.outputText);
}
const tests = walk(path.join(outRoot, "tests/unit"))
  .filter((file) => /\.test\.js$/.test(file))
  .sort();
if (!tests.length) {
  console.error("No unit tests found under tests/unit.");
  process.exit(1);
}
const coverage = process.argv.includes("--coverage");
const run = spawnSync(
  process.execPath,
  [...(coverage ? ["--experimental-test-coverage"] : []), "--test", "--test-reporter=spec", ...tests],
  {
  cwd: root,
  stdio: "inherit",
  env: { ...process.env, NODE_ENV: "test" }
  }
);
process.exit(run.status ?? 1);

function walk(dir) {
  if (!fs.existsSync(dir)) return [];
  return fs
    .readdirSync(dir, { withFileTypes: true })
    .flatMap((entry) =>
      entry.isDirectory() ? walk(path.join(dir, entry.name)) : [path.join(dir, entry.name)]
    );
}
function rewrite(text, sourceFile, outFile) {
  const aliases = {
    "@core/": "src/core/",
    "@vscode/": "src/extension/",
    "@webview/": "src/webview/"
  };
  const replace = (specifier) => {
    for (const [prefix, target] of Object.entries(aliases))
      if (specifier.startsWith(prefix)) {
        const targetFile = path
          .join(outRoot, target, specifier.slice(prefix.length))
          .replace(/\.tsx?$/, ".js");
        let relative = path.relative(path.dirname(outFile), targetFile).replaceAll(path.sep, "/");
        if (!relative.startsWith(".")) relative = "./" + relative;
        return relative;
      }
    return specifier.replace(/\.tsx?$/, ".js");
  };
  return text.replace(
    /(from\s+|import\s*\(|require\s*\()(['"])([^'"]+)\2/g,
    (full, lead, quote, spec) => {
      if (spec.startsWith(".") || Object.keys(aliases).some((prefix) => spec.startsWith(prefix)))
        return `${lead}${quote}${replace(spec)}${quote}`;
      return full;
    }
  );
}
