import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  root: "src/ui",
  base: "./",
  build: {
    outDir: "../../dist/webview",
    emptyOutDir: true,
    assetsDir: "assets",
    sourcemap: true,
    rollupOptions: {
      output: {
        entryFileNames: "assets/app.js",
        chunkFileNames: "assets/[name]-[hash].js",
        assetFileNames: (asset) => asset.names.some((name) => name.endsWith(".css")) ? "assets/app.css" : "assets/[name]-[hash][extname]"
      }
    }
  }
});
