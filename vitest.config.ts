import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    root: ".",
    include: ["tests/**/*.{test,spec}.{ts,tsx}"],
    exclude: [
      "**/fixtures/benchmarks/typescript-backend/**",
      "**/fixtures/benchmarks/react-frontend/**",
      "**/fixtures/benchmarks/fullstack/**",
      "**/fixtures/benchmarks/multi-package/**",
    ],
    coverage: {
      reporter: ["text", "html"]
    }
  }
});
