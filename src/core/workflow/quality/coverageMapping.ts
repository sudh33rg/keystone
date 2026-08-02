/**
 * Per-Test Coverage Mapping
 *
 * Maps tests to the source files/lines they cover, enabling:
 * - Git diff inversion (changed files → affected tests)
 * - Line-level precision (--precise flag)
 * - Safety net fallback to full test run
 *
 * Inspired by Radius's per-test coverage mapping and TDAD-TS's coverage strategy.
 */

import path from "node:path";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** Coverage data for a single test */
export interface TestCoverage {
  /** Test file path */
  testPath: string;

  /** Test name/identifier */
  testName: string;

  /** Files covered by this test */
  coveredFiles: CoveredFile[];

  /** Framework that produced this coverage */
  framework: TestFrameworkName;

  /** Commit hash this coverage was built at */
  builtAtCommit: string;

  /** Timestamp when coverage was built */
  builtAt: number;
}

/** Files covered by a test */
export interface CoveredFile {
  /** File path relative to project root */
  filePath: string;

  /** Lines covered (1-indexed) */
  lines: number[];

  /** Functions/methods covered */
  functions?: string[];

  /** Statements covered */
  statements?: number[];

  /** Branches covered */
  branches?: Array<{ line: number; branch: number }>;
}

/** Test framework type */
export type TestFrameworkName =
  "vitest" | "jest" | "mocha" | "pytest" | "unittest" | "tap" | "ava" | "unknown";

/** Test coverage index */
export interface CoverageIndex {
  /** All test coverage entries */
  tests: TestCoverage[];

  /** Commit hash this index was built at */
  builtAtCommit: string;

  /** Timestamp when index was built */
  builtAt: number;

  /** Number of tests indexed */
  testCount: number;

  /** Number of files covered */
  fileCount: number;
}

/** Configuration for coverage mapping */
export interface CoverageMappingConfig {
  /** Test framework to use */
  framework?: TestFrameworkName;

  /** Path to coverage output file (e.g., coverage/vitest.xml) */
  coveragePath?: string;

  /** Whether to use line-level precision */
  precise?: boolean;

  /** Path to store the coverage index */
  indexFilePath?: string;

  /** Staleness threshold for re-running coverage (ms) */
  stalenessThresholdMs?: number;
}

// ---------------------------------------------------------------------------
// Coverage Index Manager
// ---------------------------------------------------------------------------

export class CoverageIndexManager {
  private index: CoverageIndex | null = null;
  private config: Required<CoverageMappingConfig>;

  constructor(config: CoverageMappingConfig = {}) {
    this.config = {
      framework: config.framework ?? "unknown",
      coveragePath: config.coveragePath ?? "coverage/vitest.xml",
      precise: config.precise ?? false,
      indexFilePath: config.indexFilePath ?? ".keystone/coverage_index.json",
      stalenessThresholdMs: config.stalenessThresholdMs ?? 24 * 60 * 60 * 1000
    };
  }

  /**
   * Get the current coverage index.
   */
  getIndex(): CoverageIndex | null {
    return this.index;
  }

  /**
   * Check if the index is stale and needs rebuilding.
   */
  isStale(): boolean {
    if (!this.index) return true;
    const now = Date.now();
    return now - this.index.builtAt > this.config.stalenessThresholdMs;
  }

  /**
   * Update the coverage index with new coverage data.
   */
  updateIndex(coverageData: TestCoverage[]): void {
    const fileSet = new Set<string>();
    for (const test of coverageData) {
      for (const file of test.coveredFiles) {
        fileSet.add(file.filePath);
      }
    }

    this.index = {
      tests: coverageData,
      builtAtCommit: "current",
      builtAt: Date.now(),
      testCount: coverageData.length,
      fileCount: fileSet.size
    };
  }

  /**
   * Get tests that cover a specific file.
   */
  getTestsForFile(filePath: string): TestCoverage[] {
    if (!this.index) return [];

    return this.index.tests.filter((test) =>
      test.coveredFiles.some((f) => f.filePath === filePath)
    );
  }

  /**
   * Get tests that cover a specific line in a file.
   */
  getTestsForLine(filePath: string, line: number): TestCoverage[] {
    if (!this.index) return [];

    return this.index.tests.filter((test) =>
      test.coveredFiles.some((f) => f.filePath === filePath && f.lines.includes(line))
    );
  }

  /**
   * Get tests affected by a list of changed files (git diff inversion).
   */
  getAffectedTests(changedFiles: string[]): TestCoverage[] {
    if (!this.index) return [];

    const affectedTests = new Set<TestCoverage>();
    for (const changedFile of changedFiles) {
      const normalizedPath = this.normalizePath(changedFile);
      const tests = this.getTestsForFile(normalizedPath);
      for (const test of tests) {
        affectedTests.add(test);
      }
    }

    return Array.from(affectedTests);
  }

  /**
   * Normalize file path for comparison.
   */
  private normalizePath(filePath: string): string {
    return path.posix.normalize(filePath);
  }

  /**
   * Clear the index.
   */
  clear(): void {
    this.index = null;
  }
}

// ---------------------------------------------------------------------------
// Adapter Pattern for Test Frameworks
// ---------------------------------------------------------------------------

/**
 * Adapter interface for different test frameworks.
 */
export interface CoverageAdapter {
  /** Framework name */
  framework: TestFrameworkName;

  /** Parse coverage output */
  parseCoverage(content: string): TestCoverage[];

  /** Run tests with coverage */
  runTests(options?: { args?: string[]; env?: Record<string, string> }): Promise<void>;
}

/**
 * Vitest coverage adapter.
 */
export class VitestAdapter implements CoverageAdapter {
  framework = "vitest" as const;

  parseCoverage(content: string): TestCoverage[] {
    // Parse vitest JSON coverage output (V8 format)
    try {
      const data = JSON.parse(content);
      const coverageMap = data?.reportMetadata?.coverageMap || data?.unit?.coverageMap;

      if (!coverageMap) return [];

      const coverage: TestCoverage[] = [];
      const fileNames = Object.keys(coverageMap);

      for (const fileName of fileNames) {
        const fileCoverage = coverageMap[fileName];
        if (!fileCoverage) continue;

        const coveredFile: CoveredFile = {
          filePath: fileCoverage.path || fileName,
          lines: Object.keys(fileCoverage.s || {})
            .map(Number)
            .filter((n) => n > 0),
          functions: fileCoverage.f ? Object.keys(fileCoverage.f) : undefined,
          statements: fileCoverage.s
            ? Object.keys(fileCoverage.s)
                .map(Number)
                .filter((n) => n > 0)
            : undefined,
          branches: fileCoverage.b
            ? Object.entries(fileCoverage.b).map(([line, branches]) => ({
                line: Number(line),
                branch: branches as number
              }))
            : undefined
        };

        coverage.push({
          testPath: `vitest`,
          testName: `${fileName} coverage`,
          coveredFiles: [coveredFile],
          framework: "vitest",
          builtAtCommit: "current",
          builtAt: Date.now()
        });
      }

      return coverage;
    } catch {
      return [];
    }
  }

  async runTests(options?: { args?: string[]; env?: Record<string, string> }): Promise<void> {
    // Run vitest with coverage
    const { execSync } = await import("node:child_process");
    const args = ["test", "--coverage", ...(options?.args ?? [])];
    const env = { ...process.env, ...(options?.env ?? {}) };
    execSync(`npx vitest ${args.join(" ")}`, { env, stdio: "inherit" });
  }
}

/**
 * Jest coverage adapter.
 */
export class JestAdapter implements CoverageAdapter {
  framework = "jest" as const;

  parseCoverage(content: string): TestCoverage[] {
    // Parse jest coverage output
    try {
      const data = JSON.parse(content);
      const files = data?.files || [];

      const coverage: TestCoverage[] = [];

      for (const file of files) {
        const statementMap = file?.statementMap || {};
        const functions = file?.fnMap ? Object.keys(file.fnMap) : undefined;

        const coveredFile: CoveredFile = {
          filePath: file.path,
          lines: Object.keys(statementMap).map(Number),
          functions,
          statements: Object.keys(file?.s || {}).map(Number),
          branches: file?.b
            ? Object.entries(file.b).map(([line, branches]) => ({
                line: Number(line),
                branch: branches as number
              }))
            : undefined
        };

        coverage.push({
          testPath: `jest`,
          testName: `${file.path} coverage`,
          coveredFiles: [coveredFile],
          framework: "jest",
          builtAtCommit: "current",
          builtAt: Date.now()
        });
      }

      return coverage;
    } catch {
      return [];
    }
  }

  async runTests(options?: { args?: string[]; env?: Record<string, string> }): Promise<void> {
    const { execSync } = await import("node:child_process");
    const args = ["test", "--coverage", ...(options?.args ?? [])];
    const env = { ...process.env, ...(options?.env ?? {}) };
    execSync(`npx jest ${args.join(" ")}`, { env, stdio: "inherit" });
  }
}

// ---------------------------------------------------------------------------
// Factory Function
// ---------------------------------------------------------------------------

/**
 * Create a coverage adapter for the specified framework.
 */
export function createCoverageAdapter(framework: TestFrameworkName): CoverageAdapter {
  switch (framework) {
    case "vitest":
      return new VitestAdapter();
    case "jest":
      return new JestAdapter();
    default:
      throw new Error(`Unsupported test framework: ${framework}`);
  }
}
