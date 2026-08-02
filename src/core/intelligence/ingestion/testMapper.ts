import path from "node:path";

import type { RepoFile, TestMapping } from "../../domain/types";

export function isTestPath(filePath: string): boolean {
  return (
    /(?:^|\/)(__tests__|tests?|spec)\//i.test(filePath) || /\.(test|spec)\.[tj]sx?$/i.test(filePath)
  );
}

export function mapTests(files: RepoFile[]): TestMapping[] {
  // Markdown is indexed as documentation, but it is not a valid target for the
  // OKF `tests`/`covers` relationships. Keep filename matching scoped to files
  // that can actually be exercised by a test.
  const sourceFiles = files.filter((file) => !file.isTest && file.language !== "markdown");
  return files
    .filter((file) => file.isTest && file.language !== "markdown")
    .map((testFile) => {
      const stem = path.posix
        .basename(testFile.path)
        .replace(/\.(test|spec)?\.[^.]+$/i, "")
        .replace(/\.(test|spec)$/i, "");
      const target = sourceFiles.find((candidate) =>
        path.posix.basename(candidate.path).startsWith(stem)
      );
      return {
        testFile: testFile.path,
        targetFile: target?.path,
        confidence: target ? 0.75 : 0.35,
        reason: target
          ? "matched by filename convention"
          : "test file detected but target is ambiguous"
      };
    });
}
