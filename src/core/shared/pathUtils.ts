/**
 * Additive path utilities reused from reference implementations.
 * No runtime dependencies. Safe for POSIX/Windows paths.
 */

const TEST_DIRECTORY_NAMES = new Set(["__tests__", "tests"]);
const TEST_FILE_REGEX = /^(.+)\.(spec|test)\.(ts|tsx|js|jsx|mts|cts)$/;

export function isTestPath(path: string): boolean {
  const normalized = path.split(/[\\/]+/).join("/");
  const parts = normalized.split("/");
  const hasTestDirectory = parts.some((part) => TEST_DIRECTORY_NAMES.has(part));
  const hasTestFile = typeof normalized === "string" && /\.(spec|test)\.(ts|tsx|js|jsx|mts|cts)$/.test(normalized);
  return hasTestDirectory || hasTestFile;
}

export function testStem(path: string): string {
  const normalized = path.split(/[\\/]+/).join("/");
  const basename = normalized.includes("/") ? normalized.slice(normalized.lastIndexOf("/") + 1) : normalized;
  const match = basename.match(TEST_FILE_REGEX);
  if (match) return match[1]!;
  return basename.includes(".") ? basename.slice(0, basename.lastIndexOf(".")) : basename;
}

export function sourceCandidatesForTestPath(testPath: string): string[] {
  const normalized = testPath.split(/[\\/]+/).join("/");
  const stem = testStem(normalized);
  if (!stem || !normalized.includes("/")) return [];

  const candidates: string[] = [];
  const current = normalized;
  let parent = current.slice(0, current.lastIndexOf("/"));
  while (parent) {
    const candidate = `${parent}/${stem}.ts`;
    candidates.push(candidate);
    const next = parent.slice(0, parent.lastIndexOf("/"));
    if (next === parent) break;
    parent = next;
  }
  return candidates;
}
