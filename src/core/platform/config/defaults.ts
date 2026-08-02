export const KEYSTONE_DIR = ".keystone";

export const INTELLIGENCE_FILE = ".keystone/intelligence/summary.json";
export const SKILLS_FILE = ".keystone/skills.json";
export const METRICS_FILE = ".keystone/metrics.json";

export const IGNORED_DIRECTORIES = new Set([
  "node_modules",
  "bower_components",
  ".pnpm-store",
  ".yarn",
  "dist",
  "build",
  "out",
  "bin",
  "obj",
  "vendor",
  ".git",
  ".keystone",
  ".sdlc-agent",
  "temp-kg",
  ".vscode-test",
  ".venv",
  "venv",
  "env",
  ".envdir",
  "site-packages",
  ".tox",
  ".nox",
  "__pycache__",
  ".pytest_cache",
  ".mypy_cache",
  ".ruff_cache",
  ".hypothesis",
  ".ipynb_checkpoints",
  ".next",
  ".nuxt",
  ".svelte-kit",
  ".angular",
  ".parcel-cache",
  ".vite",
  ".turbo",
  "coverage",
  "target",
  "vendor",
  ".bundle",
  "gems",
  "generated",
  ".cache",
  ".gradle",
  ".mvn",
  ".idea",
  ".build",
  "DerivedData",
  "Pods",
  ".dart_tool",
  ".pub-cache",
  ".terraform",
  ".serverless",
  ".aws-sam"
]);

export const SECURITY_KEYWORDS = [
  "auth",
  "authentication",
  "authorization",
  "permission",
  "token",
  "credential",
  "secret",
  "password",
  "payment",
  "pii",
  "admin",
  "cookie",
  "jwt",
  "oauth"
];

export const PERFORMANCE_KEYWORDS = [
  "query",
  "database",
  "n+1",
  "cache",
  "pagination",
  "batch",
  "queue",
  "stream",
  "serialize",
  "deserialize",
  "backpressure",
  "throttle"
];

export const MODERNIZATION_KEYWORDS = ["todo", "fixme", "hack", "legacy", "deprecated"];

export const DEFAULT_QA_CHECKLIST = [
  "functional path covered",
  "negative path covered",
  "edge cases covered",
  "regression path covered",
  "existing tests updated",
  "new tests added where behavior changed",
  "impacted integration tests identified",
  "test data/factory reuse considered"
];
