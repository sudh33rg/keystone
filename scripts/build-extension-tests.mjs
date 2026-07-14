import { build } from "esbuild";

await build({
  entryPoints: ["tests/extension/index.ts"],
  bundle: true,
  outfile: "dist/extension-tests/index.js",
  platform: "node",
  format: "cjs",
  target: "node20",
  external: ["vscode"],
  sourcemap: false,
  logLevel: "info"
});
