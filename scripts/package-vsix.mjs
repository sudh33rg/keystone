import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { spawnSync } from "node:child_process";

const root = process.cwd();
const pkg = JSON.parse(fs.readFileSync(path.join(root, "package.json"), "utf8"));
const extensionEntry = path.join(root, "dist", "app", "extension", "core", "extension.js");
if (!fs.existsSync(extensionEntry))
  throw new Error("Build output is missing. Run npm run build first.");
const stage = fs.mkdtempSync(path.join(os.tmpdir(), "keystone-vsix-"));
try {
  const ext = path.join(stage, "extension");
  fs.mkdirSync(ext, { recursive: true });
  for (const name of ["package.json", "README.md"])
    fs.copyFileSync(path.join(root, name), path.join(ext, name));
  fs.mkdirSync(path.join(ext, "media"), { recursive: true });
  for (const asset of ["keystone.png", "keystone.svg"])
    fs.copyFileSync(path.join(root, "media", asset), path.join(ext, "media", asset));
  copy(path.join(root, "dist", "app"), path.join(ext, "dist", "app"));
  copy(path.join(root, "dist", "media"), path.join(ext, "dist", "media"));
  copy(path.join(root, "node_modules", "typescript"), path.join(ext, "node_modules", "typescript"));
  copyRuntimeDependency("pptxgenjs", path.join(root, "node_modules"), path.join(ext, "node_modules"));
  fs.writeFileSync(
    path.join(stage, "[Content_Types].xml"),
    `<?xml version="1.0" encoding="utf-8"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="json" ContentType="application/json"/><Default Extension="js" ContentType="application/javascript"/><Default Extension="css" ContentType="text/css"/><Default Extension="html" ContentType="text/html"/><Default Extension="map" ContentType="application/json"/><Default Extension="md" ContentType="text/markdown"/><Default Extension="xml" ContentType="text/xml"/><Override PartName="/extension.vsixmanifest" ContentType="text/xml"/></Types>`
  );
  fs.writeFileSync(
    path.join(stage, "extension.vsixmanifest"),
    `<?xml version="1.0" encoding="utf-8"?><PackageManifest Version="2.0.0" xmlns="http://schemas.microsoft.com/developer/vsx-schema/2011"><Metadata><Identity Language="en-US" Id="${escapeXml(pkg.name)}" Version="${escapeXml(pkg.version)}" Publisher="${escapeXml(pkg.publisher)}"/><DisplayName>${escapeXml(pkg.displayName)}</DisplayName><Description xml:space="preserve">${escapeXml(pkg.description)}</Description><Tags>${escapeXml(pkg.keywords.join(","))}</Tags><Categories>Other</Categories><Properties><Property Id="Microsoft.VisualStudio.Code.Engine" Value="${escapeXml(pkg.engines.vscode)}"/></Properties></Metadata><Installation><InstallationTarget Id="Microsoft.VisualStudio.Code"/></Installation><Dependencies/><Assets><Asset Type="Microsoft.VisualStudio.Code.Manifest" Path="extension/package.json" Addressable="true"/></Assets></PackageManifest>`
  );
  fs.mkdirSync(path.join(root, "dist"), { recursive: true });
  const versioned = path.join(root, "dist", `keystone-${pkg.version}.vsix`);
  const current = path.join(root, "dist", "keystone.vsix");
  fs.rmSync(versioned, { force: true });
  fs.rmSync(current, { force: true });
  const result = spawnSync("zip", ["-q", "-r", versioned, "."], { cwd: stage, stdio: "inherit" });
  if (result.status !== 0) throw new Error("zip failed");
  fs.copyFileSync(versioned, current);
  console.log(`Created ${versioned} and ${current}`);
} finally {
  fs.rmSync(stage, { recursive: true, force: true });
}

function copy(src, dst) {
  const stat = fs.statSync(src);
  if (stat.isDirectory()) {
    fs.mkdirSync(dst, { recursive: true });
    for (const entry of fs.readdirSync(src)) copy(path.join(src, entry), path.join(dst, entry));
  } else {
    fs.mkdirSync(path.dirname(dst), { recursive: true });
    fs.copyFileSync(src, dst);
  }
}
function copyRuntimeDependency(name, sourceModules, destinationModules, copied = new Set()) {
  if (copied.has(name)) return;
  copied.add(name);
  const source = path.join(sourceModules, name);
  const manifest = path.join(source, "package.json");
  if (!fs.existsSync(manifest)) throw new Error(`Runtime dependency is missing: ${name}`);
  const pkg = JSON.parse(fs.readFileSync(manifest, "utf8"));
  copy(source, path.join(destinationModules, name));
  for (const dependency of Object.keys(pkg.dependencies ?? {}))
    copyRuntimeDependency(dependency, sourceModules, destinationModules, copied);
}
function escapeXml(value) {
  return String(value).replace(
    /[<>&"']/g,
    (char) => ({ "<": "&lt;", ">": "&gt;", "&": "&amp;", '"': "&quot;", "'": "&apos;" })[char]
  );
}
