import { build } from "esbuild";

await build({
  entryPoints: ["src/extension/extension.ts"],
  bundle: true,
  outfile: "dist/extension/extension.js",
  platform: "node",
  format: "cjs",
  target: "node20",
  external: ["vscode"],
  sourcemap: true,
  sourcesContent: false,
  logLevel: "info"
});

await build({
  entryPoints: ["src/core/intelligence/semantic/workerEntry.ts"],
  bundle: true,
  outfile: "dist/extension/semantic-worker.js",
  platform: "node",
  format: "cjs",
  target: "node20",
  sourcemap: true,
  sourcesContent: false,
  logLevel: "info"
});
