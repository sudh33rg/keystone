import { createHash } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";

const root = process.cwd();
const pkg = JSON.parse(fs.readFileSync(path.join(root, "package.json"), "utf8"));
const manifestName = "COMPLETE_PROJECT_FILE_MANIFEST.txt";
const checksumsName = "REPOSITORY_SHA256SUMS.txt";
const archiveName = `Keystone-${pkg.version}-complete.zip`;
const archivePath = path.join(root, "dist", archiveName);

if (!fs.existsSync(path.join(root, "dist", `keystone-${pkg.version}.vsix`))) {
  throw new Error("VSIX is missing. Run npm run verify or npm run package first.");
}

const baseFiles = collectDeliverableFiles().filter(
  (file) => ![manifestName, checksumsName].includes(file)
);
const manifest = [
  "# Keystone complete standalone project manifest",
  `# Version: ${pkg.version}`,
  "# Paths are relative to the Keystone project root.",
  ...baseFiles.map(
    (file) => `${String(fs.statSync(path.join(root, file)).size).padStart(12, " ")}  ${file}`
  ),
  ""
].join("\n");
fs.writeFileSync(path.join(root, manifestName), manifest);

const checksumFiles = [...baseFiles, manifestName].sort();
const checksums =
  checksumFiles.map((file) => `${sha256(path.join(root, file))}  ${file}`).join("\n") + "\n";
fs.writeFileSync(path.join(root, checksumsName), checksums);

const stage = fs.mkdtempSync(path.join(os.tmpdir(), "keystone-project-"));
try {
  const destinationRoot = path.join(stage, "Keystone");
  for (const file of [...checksumFiles, checksumsName])
    copyFile(path.join(root, file), path.join(destinationRoot, file));
  fs.mkdirSync(path.dirname(archivePath), { recursive: true });
  fs.rmSync(archivePath, { force: true });
  const result = spawnSync("zip", ["-q", "-r", archivePath, "Keystone"], {
    cwd: stage,
    stdio: "inherit"
  });
  if (result.status !== 0)
    throw new Error("zip failed while creating the standalone project archive.");
  console.log(`Created ${archivePath} with ${checksumFiles.length + 1} files.`);
} finally {
  fs.rmSync(stage, { recursive: true, force: true });
}

function collectDeliverableFiles() {
  const excludedRoots = new Set([
    ".git",
    "node_modules",
    ".test-dist",
    ".runtime-check",
    ".keystone",
    "out"
  ]);
  const out = [];
  const pending = [""];
  while (pending.length) {
    const relativeDirectory = pending.pop();
    const absoluteDirectory = path.join(root, relativeDirectory);
    for (const entry of fs.readdirSync(absoluteDirectory, { withFileTypes: true })) {
      const relative = path.join(relativeDirectory, entry.name).split(path.sep).join("/");
      const first = relative.split("/")[0];
      if (excludedRoots.has(first)) continue;
      if (relative === `dist/${archiveName}` || relative.startsWith("dist/release/")) continue;
      if (entry.isDirectory()) pending.push(relative);
      else if (entry.isFile()) out.push(relative);
    }
  }
  return out.sort();
}

function copyFile(source, target) {
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.copyFileSync(source, target);
}
function sha256(file) {
  return createHash("sha256").update(fs.readFileSync(file)).digest("hex");
}
