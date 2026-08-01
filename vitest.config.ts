import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    alias: {
      "@core": fileURLToPath(new URL("./src/core", import.meta.url)),
      "@vscode": fileURLToPath(new URL("./src/extension", import.meta.url)),
      "@webview": fileURLToPath(new URL("./src/webview", import.meta.url))
    }
  },
  test: {
    include: ["tests/unit/**/*.test.ts", "tests/unit/**/*.test.tsx"],
    pool: "forks",
    coverage: {
      provider: "v8",
      reporter: ["text", "lcov"]
    }
  }
});
