import eslint from "@eslint/js";
import reactHooks from "eslint-plugin-react-hooks";
import tseslint from "typescript-eslint";

export default tseslint.config(
  { ignores: ["dist/**", "coverage/**", "node_modules/**", ".vscode-test/**", "scripts/**", "*.config.*", "tests/fixtures/benchmarks/typescript-backend/**", "tests/fixtures/benchmarks/react-frontend/**", "tests/fixtures/benchmarks/fullstack/**", "tests/fixtures/benchmarks/multi-package/**", "tests/fixtures/intelligence/**"] },
  eslint.configs.recommended,
  ...tseslint.configs.recommendedTypeChecked,
  {
    languageOptions: {
      parserOptions: {
        projectService: true,
        tsconfigRootDir: import.meta.dirname
      }
    },
    plugins: { "react-hooks": reactHooks },
    rules: {
      ...reactHooks.configs.recommended.rules,
      // "@typescript-eslint/consistent-type-imports": "error",
      "@typescript-eslint/no-unused-vars": ["error", { "argsIgnorePattern": "^_", "varsIgnorePattern": "^_", "caughtErrorsIgnorePattern": "^_", "ignoreRestSiblings": true }],
      // "@typescript-eslint/no-misused-promises": ["error", { "checksVoidReturn": false }],
      // "@typescript-eslint/no-floating-promises": "error",
      // require-await is stylistic only; these methods are intentionally Promise-typed
      // via their contracts (health-check `check`, view-builder `build` overrides) even
      // when the body is synchronous. The type system enforces the Promise contract at
      // call sites, so the rule adds no safety here.
      "@typescript-eslint/require-await": "off",
      "complexity": ["warn", { "max": 15 }],
      "max-lines": ["warn", { "max": 500, "skipBlankLines": true, "skipComments": true }],
      "max-depth": ["warn", { "max": 4 }],
      "max-nested-callbacks": ["warn", { "max": 4 }],
      "max-params": ["warn", { "max": 5 }]
    }
  }
);
