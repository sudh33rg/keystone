import fs from "node:fs";
import { spawnSync } from "node:child_process";
const pkg = JSON.parse(fs.readFileSync("package.json", "utf8"));
for (const file of [`dist/keystone-${pkg.version}.vsix`, "dist/keystone.vsix"]) {
  if (!fs.existsSync(file)) throw new Error(`VSIX is missing: ${file}`);
  const test = spawnSync("unzip", ["-t", file], { encoding: "utf8" });
  if (test.status !== 0) throw new Error(test.stdout + test.stderr);
  const list = spawnSync("unzip", ["-Z1", file], { encoding: "utf8" })
    .stdout.split(/\r?\n/)
    .filter(Boolean);
  for (const required of [
    "extension.vsixmanifest",
    "extension/package.json",
    "extension/dist/app/extension/core/extension.js",
    "extension/dist/media/index.html",
    "extension/dist/media/webview.js",
    "extension/dist/media/keystone.svg",
    "extension/dist/media/keystone.png",
    "extension/dist/media/react.production.min.js",
    "extension/dist/media/react-dom.production.min.js",
    "extension/media/keystone.png",
    "extension/media/keystone.svg",
    "extension/node_modules/typescript/lib/typescript.js",
    "extension/node_modules/pptxgenjs/dist/pptxgen.cjs.js"
  ])
    if (!list.includes(required)) throw new Error(`${file} missing ${required}`);
  const forbidden = list.filter(
    (item) =>
      item.endsWith(".vsix") || /\/src\/.+\.tsx?$/.test(item) || item.includes("/.keystone/")
  );
  if (forbidden.length)
    throw new Error(`${file} contains forbidden entries: ${forbidden.join(", ")}`);
  console.log(`Verified ${file} with ${list.length} entries.`);
}
