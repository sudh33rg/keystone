import { fileURLToPath } from "node:url";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";
export default defineConfig({
  root: fileURLToPath(new URL("./src/webview", import.meta.url)),
  plugins: [react()],
  resolve: {
    alias: {
      "@core": fileURLToPath(new URL("./src/core", import.meta.url)),
      "@vscode": fileURLToPath(new URL("./src/extension", import.meta.url)),
      "@webview": fileURLToPath(new URL("./src/webview", import.meta.url))
    }
  },
  build: {
    outDir: fileURLToPath(new URL("./dist/media", import.meta.url)),
    emptyOutDir: true,
    rollupOptions: {
      output: {
        entryFileNames: "webview.js",
        chunkFileNames: "chunks/[name]-[hash].js",
        assetFileNames: "webview.[ext]"
      }
    }
  }
});
