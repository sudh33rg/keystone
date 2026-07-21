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
    testTimeout: 15_000,
    coverage: {
      reporter: ["text", "html"],
      thresholds: {
        statements: 70,
        branches: 70,
        functions: 70,
        lines: 70
      }
    }
  }
});
