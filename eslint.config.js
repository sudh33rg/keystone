const tseslint = require("@typescript-eslint/eslint-plugin");
const tsParser = require("@typescript-eslint/parser");

module.exports = [
  {
    ignores: [
      ".git/**",
      ".vscode-test/**",
      "dist/**",
      "out/**",
      "coverage/**",
      "node_modules/**",
      "archive/**",
      "apps/**/dist/**",
      "packages/**/dist/**",
      "packages/**/.vite/**",
      "*.vsix"
    ]
  },
  {
    files: ["**/*.ts"],
    languageOptions: {
      parser: tsParser,
      parserOptions: {
        project: ["./tsconfig.eslint.json"],
        tsconfigRootDir: __dirname
      }
    },
    plugins: {
      "@typescript-eslint": tseslint
    },
    rules: {
      "no-console": "warn",
      "@typescript-eslint/consistent-type-imports": "error",
      "@typescript-eslint/no-floating-promises": "error",
      "@typescript-eslint/no-misused-promises": "error",
      "@typescript-eslint/no-unnecessary-type-assertion": "off"
    }
  }
];
