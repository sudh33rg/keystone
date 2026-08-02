/**
 * QA Gap Analysis — discover tests, detect coverage gaps, and generate recommendations.
 *
 * Composes existing QA intelligence modules:
 * - testDiscovery.ts  → discoverTests()
 * - riskScoring.ts    → computeRiskScores()
 * - coverageMapping.ts → CoverageIndexManager
 * - impactedTests.ts  → suggestImpactedTests()
 * - flakyDetection.ts → detectFlakyTests()
 *
 * @module qa-intelligence/qaGapAnalysis
 */

import * as fs from "node:fs";
import * as path from "node:path";
import { discoverTests, type TestDiscoveryResult } from "./testDiscovery";
import { computeRiskScores, type FileRiskScore, type FileRiskData } from "./riskScoring";
import { CoverageIndexManager, type TestCoverage } from "./coverageMapping";
import { suggestImpactedTests, type ImpactedTestSuggestion } from "./impactedTests";
import { detectFlakyTests, type FlakyDetectionResult } from "./flakyDetection";
import { executeTests, type TestExecutionResult } from "./testExecution";
import { createQuarantineStore } from "./quarantine";
import { DEFAULT_QA_CONFIG, type QAConfig } from "../../platform/config/qualityConfig";
import type { RepoIndex } from "../../platform/storage/types";
import type { CancellationToken } from "./cancellation";
import { IGNORED_DIRECTORIES } from "../../platform/config/defaults";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** A coverage gap in the test suite */
export interface Gap {
  /** Type of gap */
  type: "uncovered" | "under-tested" | "high-risk-no-test" | "no-coverage-data" | "stale-coverage";
  /** File path */
  filePath: string;
  /** Severity (0-1) */
  severity: number;
  /** Human-readable reason */
  reason: string;
  /** Suggested action */
  action?: string;
}

/** Coverage data for a module (directory) */
export interface ModuleCoverage {
  /** Module directory path */
  modulePath: string;
  /** Total source files in module */
  sourceFileCount: number;
  /** Files with test coverage */
  coveredFileCount: number;
  /** Coverage ratio */
  coverageRatio: number;
  /** Test count in module */
  testCount: number;
}

/** A recommendation for improving test coverage */
export interface Recommendation {
  /** Priority (high / medium / low) */
  priority: "high" | "medium" | "low";
  /** Category */
  category: "coverage" | "quality" | "risk" | "maintenance";
  /** Title */
  title: string;
  /** Description */
  description: string;
  /** Affected files */
  affectedFiles?: string[];
  /** Suggested command or action */
  suggestedAction?: string;
}

/** Full gap analysis result */
export interface GapAnalysisResult {
  /** Scan mode that was used */
  scanMode: "quick" | "deep";
  /** Summary statistics */
  summary: {
    testFramework: TestDiscoveryResult["framework"];
    totalTests: number;
    totalSourceFiles: number;
    coverageRatio: number; // tests / source files
    coverageRate: number; // source files with tests / total
    flakyTests: number;
    brokenTests: number;
    riskScore: number; // 0-100
  };
  /** Detected gaps */
  gaps: Gap[];
  /** Recommendations */
  recommendations: Recommendation[];
  /** Per-module coverage (deep scan only) */
  coverageByModule?: ModuleCoverage[];
  /** Impacted test suggestions (deep scan only) */
  impactedTests?: ImpactedTestSuggestion[];
  /** Flaky detection result (deep scan only) */
  flakyDetection?: FlakyDetectionResult;
  /** Execution result (deep scan only) */
  executionResult?: TestExecutionResult;
  /** Timing metrics */
  metrics: {
    elapsedMs: number;
    testsDiscovered: number;
    sourcesAnalyzed: number;
    gapsFound: number;
    recommendationsGenerated: number;
  };
}

/** Configuration for gap analysis */
export interface GapAnalysisConfig {
  /** Timeout for quick scan in ms (default: 30_000) */
  quickScanTimeoutMs?: number;
  /** Timeout for deep scan in ms (default: 120_000) */
  deepScanTimeoutMs?: number;
  /** Minimum coverage ratio to consider a file "covered" (default: 0.1) */
  coverageThreshold?: number;
  /** Minimum severity to report a gap (default: 0.1) */
  minSeverity?: number;
}

export interface GapAnalysisContext {
  /** Cooperative cancellation for synchronous analysis phases. */
  cancellation?: CancellationToken;
  /** Abort child test processes and repeated flaky-test runs. */
  signal?: AbortSignal;
  /** Workspace-relative files changed for task-scoped impact analysis. */
  changedPaths?: string[];
}

// ---------------------------------------------------------------------------
// Defaults
// ---------------------------------------------------------------------------

const DEFAULT_GAP_CONFIG: GapAnalysisConfig = {
  quickScanTimeoutMs: 30_000,
  deepScanTimeoutMs: 120_000,
  coverageThreshold: 0.1,
  minSeverity: 0.1
};

// ---------------------------------------------------------------------------
// Source file enumeration
// ---------------------------------------------------------------------------

/**
 * Enumerate source files in a workspace, excluding common non-source patterns.
 */
function enumerateSourceFiles(workspaceRoot: string): string[] {
  const excluded = new Set([
    ...IGNORED_DIRECTORIES,
    "node_modules",
    ".git",
    ".keystone",
    "dist",
    "out",
    "build",
    "coverage",
    ".next",
    ".nuxt",
    ".cache",
    "vendor",
    "target",
    "builds",
    "cypress"
  ]);
  const excludedExt = new Set([
    ".png",
    ".jpg",
    ".jpeg",
    ".gif",
    ".svg",
    ".ico",
    ".woff",
    ".woff2",
    ".ttf",
    ".eot"
  ]);
  const sourceExt = new Set([
    ".ts",
    ".tsx",
    ".js",
    ".jsx",
    ".mjs",
    ".cjs",
    ".py",
    ".go",
    ".java",
    ".rs",
    ".rb",
    ".php",
    ".cs",
    ".kt",
    ".scala"
  ]);

  const results: string[] = [];

  function walk(dir: string): void {
    try {
      const entries = fs.readdirSync(dir, { withFileTypes: true });
      for (const entry of entries) {
        if (entry.name.startsWith(".")) continue;
        if (excluded.has(entry.name)) continue;

        const fullPath = path.join(dir, entry.name);

        if (entry.isDirectory()) {
          walk(fullPath);
        } else {
          const ext = path.extname(entry.name).toLowerCase();
          if (sourceExt.has(ext) && !excludedExt.has(ext)) {
            results.push(fullPath);
          }
        }
      }
    } catch {
      // Silently skip unreadable directories
    }
  }

  walk(workspaceRoot);
  return results;
}

// ---------------------------------------------------------------------------
// Coverage map computation
// ---------------------------------------------------------------------------

/**
 * Compute a coverage map: which source files are covered by tests.
 *
 * Uses the coverage mapping infrastructure to parse coverage data.
 */
function computeCoverageMap(
  testPaths: string[],
  coverageData: TestCoverage[],
  sourceFiles: string[],
  workspaceRoot: string
): Map<string, Set<number>> {
  const coverageMap = new Map<string, Set<number>>();

  for (const test of coverageData) {
    for (const covered of test.coveredFiles) {
      const normalized = path.relative(workspaceRoot, covered.filePath);
      const normalizedSource = sourceFiles.map((f) => path.relative(workspaceRoot, f));
      if (normalizedSource.includes(normalized)) {
        const lines = coverageMap.get(normalized) ?? new Set<number>();
        for (const line of covered.lines) {
          lines.add(line);
        }
        coverageMap.set(normalized, lines);
      }
    }
  }

  return coverageMap;
}

/**
 * Estimate coverage for files without real coverage data.
 *
 * Uses the test-to-source file ratio as a heuristic.
 */
function estimateCoverageRatio(testFiles: string[], sourceFiles: string[]): number {
  if (sourceFiles.length === 0) return 0;
  if (testFiles.length === 0) return 0;

  // Simple heuristic: each test covers ~1 source file on average
  const ratio = Math.min(testFiles.length / sourceFiles.length, 1.0);
  return ratio;
}

function discoverExecutionCommand(
  discovery: TestDiscoveryResult,
  configured?: string
): string | undefined {
  if (configured?.trim()) return configured.trim();
  const hint = discovery.testCommands[0];
  return hint ? [hint.command, ...hint.args].join(" ").trim() : undefined;
}

function loadCoverageData(workspaceRoot: string, index?: RepoIndex): TestCoverage[] {
  const persisted = path.join(workspaceRoot, ".keystone", "coverage_index.json");
  try {
    const parsed = JSON.parse(fs.readFileSync(persisted, "utf8")) as { tests?: TestCoverage[] };
    if (Array.isArray(parsed.tests)) return parsed.tests;
  } catch {
    /* optional runtime artifact */
  }

  const mappings =
    (
      index?.summary as unknown as
        { coverageMappings?: Array<{ testPath: string; coveredPath: string }> } | undefined
    )?.coverageMappings ?? [];
  if (mappings.length) {
    const byTest = new Map<string, string[]>();
    for (const mapping of mappings) {
      if (!mapping.testPath || !mapping.coveredPath) continue;
      const values = byTest.get(mapping.testPath) ?? [];
      values.push(mapping.coveredPath);
      byTest.set(mapping.testPath, values);
    }
    return [...byTest.entries()].map(([testPath, coveredPaths]) => ({
      testPath,
      testName: path.basename(testPath),
      coveredFiles: [...new Set(coveredPaths)].map((filePath) => ({ filePath, lines: [] })),
      framework: "unknown",
      builtAtCommit: "repository-index",
      builtAt: Date.now()
    }));
  }

  // Istanbul-compatible aggregate coverage emitted by Jest/Vitest/nyc. It is
  // not per-test coverage, but it is real executed coverage and is useful for
  // gap/module coverage without pretending to identify an individual test.
  for (const relative of ["coverage/coverage-final.json", "coverage/coverage.json"]) {
    try {
      const value = JSON.parse(
        fs.readFileSync(path.join(workspaceRoot, relative), "utf8")
      ) as Record<string, any>;
      const result: TestCoverage[] = [];
      for (const [fileName, file] of Object.entries(value)) {
        if (!file || typeof file !== "object") continue;
        const statementMap = file.statementMap ?? {};
        const counts = file.s ?? {};
        const lines = Object.entries(statementMap)
          .filter(([id]) => Number(counts[id] ?? 0) > 0)
          .map(([, statement]: any) => Number(statement?.start?.line ?? 0))
          .filter((line: number) => line > 0);
        if (!lines.length) continue;
        result.push({
          testPath: `aggregate:${relative}`,
          testName: `Executed aggregate coverage for ${path.basename(fileName)}`,
          coveredFiles: [
            {
              filePath: path.relative(workspaceRoot, fileName),
              lines: [...new Set(lines)].sort((a, b) => a - b)
            }
          ],
          framework: "unknown",
          builtAtCommit: "executed-workspace",
          builtAt: Date.now()
        });
      }
      if (result.length) return result;
    } catch {
      /* try next coverage artifact */
    }
  }
  return [];
}

// ---------------------------------------------------------------------------
// Gap detection
// ---------------------------------------------------------------------------

/**
 * Detect coverage gaps in the test suite.
 *
 * Identifies:
 * - Uncovered source files (no test coverage)
 * - Under-tested files (low test count relative to complexity)
 * - High-risk files without tests
 * - Files with stale coverage data
 */
function detectGaps(
  sourceFiles: string[],
  testFiles: string[],
  coverageMap: Map<string, Set<number>>,
  riskScores: FileRiskScore[],
  config: GapAnalysisConfig,
  workspaceRoot: string
): Gap[] {
  const gaps: Gap[] = [];
  const riskMap = new Map(riskScores.map((r) => [r.filePath, r]));
  const coverageThreshold = config.coverageThreshold ?? DEFAULT_GAP_CONFIG.coverageThreshold;
  const minSeverity = config.minSeverity ?? DEFAULT_GAP_CONFIG.minSeverity ?? 0.1;

  // Find uncovered source files
  const sourceRelative = sourceFiles.map((f) => path.relative(workspaceRoot, f));
  const coveredFiles = new Set(coverageMap.keys());

  for (const relativePath of sourceRelative) {
    if (coveredFiles.has(relativePath)) continue;

    const risk = riskMap.get(path.join(workspaceRoot, relativePath));
    const severity = risk ? Math.max(risk.overallScore, 0.5) : 0.3;

    if (severity < minSeverity) continue;

    gaps.push({
      type: "uncovered",
      filePath: path.join(workspaceRoot, relativePath),
      severity,
      reason: risk
        ? `High-risk file (${risk.tier}) with no test coverage`
        : "Source file with no test coverage",
      action: risk
        ? `Write tests for ${path.basename(relativePath)} (risk: ${risk.tier})`
        : undefined
    });
  }

  // Find high-risk files without tests
  const highRisk = riskScores.filter((r) => r.tier === "critical" || r.tier === "high");
  for (const risk of highRisk) {
    const relative = path.relative(workspaceRoot, risk.filePath);
    if (coveredFiles.has(relative)) continue;

    gaps.push({
      type: "high-risk-no-test",
      filePath: risk.filePath,
      severity: risk.overallScore,
      reason: `Critical/high risk file (${risk.tier}) without tests: ${risk.riskFactors.join(", ")}`,
      action: `Priority test coverage for ${path.basename(risk.filePath)}`
    });
  }

  // Find under-tested files (source files with low coverage ratio)
  for (const relative of sourceRelative) {
    if (coveredFiles.has(relative)) continue;

    // Check if there's a test file nearby
    const testNearby = testFiles.some((t) => {
      const testRelative = path.relative(workspaceRoot, t);
      const testDir = path.dirname(testRelative);
      const srcDir = path.dirname(relative);
      // Same directory or parent/child
      return testDir === srcDir || testDir === path.dirname(srcDir);
    });

    if (testNearby) {
      gaps.push({
        type: "under-tested",
        filePath: path.join(workspaceRoot, relative),
        severity: 0.4,
        reason: "Source file has nearby tests but no direct coverage",
        action: "Add tests that import and exercise this module"
      });
    }
  }

  return gaps;
}

function hasConventionMappedTest(sourceFile: string, testFiles: readonly string[]): boolean {
  const sourceStem = path
    .basename(sourceFile)
    .replace(/\.[^.]+$/, "")
    .toLowerCase();
  if (!sourceStem) return false;
  return testFiles.some((testFile) => {
    const testStem = path
      .basename(testFile)
      .replace(/\.(?:test|spec)?\.[^.]+$/i, "")
      .replace(/\.(?:test|spec)$/i, "")
      .toLowerCase();
    return (
      testStem === sourceStem || testStem.startsWith(sourceStem) || sourceStem.startsWith(testStem)
    );
  });
}

// ---------------------------------------------------------------------------
// Recommendation generation
// ---------------------------------------------------------------------------

/**
 * Generate actionable recommendations based on detected gaps and metrics.
 */
function generateRecommendations(
  gaps: Gap[],
  summary: GapAnalysisResult["summary"],
  testDiscovery: TestDiscoveryResult
): Recommendation[] {
  const recommendations: Recommendation[] = [];

  // Coverage gap recommendations
  const uncovered = gaps.filter((g) => g.type === "uncovered");
  const highRiskNoTest = gaps.filter((g) => g.type === "high-risk-no-test");

  if (uncovered.length > 0) {
    recommendations.push({
      priority: "high",
      category: "coverage",
      title: `${uncovered.length} uncovered source files`,
      description: `Found ${uncovered.length} source files with no test coverage. Focus on high-risk files first.`,
      affectedFiles: uncovered.slice(0, 10).map((g) => path.basename(g.filePath)),
      suggestedAction: "Run `keystone qa analyze --deep` for detailed coverage report"
    });
  }

  if (highRiskNoTest.length > 0) {
    recommendations.push({
      priority: "high",
      category: "risk",
      title: `${highRiskNoTest.length} high-risk files without tests`,
      description:
        "Critical or high-risk files have no test coverage. These should be prioritized.",
      affectedFiles: highRiskNoTest.slice(0, 5).map((g) => path.basename(g.filePath)),
      suggestedAction: "Write integration tests for these files before making changes"
    });
  }

  // Framework-specific recommendations
  if (testDiscovery.framework === "vitest" || testDiscovery.framework === "jest") {
    if (summary.coverageRate < 0.5) {
      recommendations.push({
        priority: "medium",
        category: "coverage",
        title: "Low test coverage rate",
        description: `Only ${(summary.coverageRate * 100).toFixed(0)}% of source files have test coverage. Consider adding tests for core modules.`,
        suggestedAction: `Run \`npx ${testDiscovery.framework} --coverage\` for detailed report`
      });
    }
  }

  // Maintenance recommendations
  if (summary.flakyTests > 0) {
    recommendations.push({
      priority: "medium",
      category: "maintenance",
      title: `${summary.flakyTests} flaky tests detected`,
      description: "Flaky tests can mask real issues. Consider quarantining or fixing them.",
      suggestedAction: "Run `keystone qa quarantine` to quarantine flaky tests"
    });
  }

  if (summary.brokenTests > 0) {
    recommendations.push({
      priority: "high",
      category: "quality",
      title: `${summary.brokenTests} broken tests`,
      description: "Broken tests block CI and mask real issues. Fix them before adding new tests.",
      suggestedAction: "Run `keystone qa repair` to auto-fix common test failures"
    });
  }

  // General recommendations
  if (summary.totalTests === 0 && summary.totalSourceFiles > 0) {
    recommendations.push({
      priority: "high",
      category: "coverage",
      title: "No tests discovered",
      description: "No test files were found in this workspace. Consider adding a test suite.",
      suggestedAction: `Initialize ${testDiscovery.framework !== "unknown" ? testDiscovery.framework : "a test framework"} and write your first test`
    });
  }

  return recommendations;
}

// ---------------------------------------------------------------------------
// Module coverage computation
// ---------------------------------------------------------------------------

/**
 * Compute per-module coverage statistics.
 */
function computeModuleCoverage(
  sourceFiles: string[],
  coverageMap: Map<string, Set<number>>,
  testFiles: string[],
  workspaceRoot: string
): ModuleCoverage[] {
  const moduleMap = new Map<string, { sources: Set<string>; tests: Set<string> }>();

  // Group source files by module (directory)
  for (const file of sourceFiles) {
    const relative = path.relative(workspaceRoot, file);
    const moduleDir = path.dirname(relative);
    if (!moduleMap.has(moduleDir)) {
      moduleMap.set(moduleDir, { sources: new Set(), tests: new Set() });
    }
    moduleMap.get(moduleDir)!.sources.add(relative);
  }

  // Group test files by module
  for (const file of testFiles) {
    const relative = path.relative(workspaceRoot, file);
    const moduleDir = path.dirname(relative);
    if (!moduleMap.has(moduleDir)) {
      moduleMap.set(moduleDir, { sources: new Set(), tests: new Set() });
    }
    moduleMap.get(moduleDir)!.tests.add(relative);
  }

  const result: ModuleCoverage[] = [];

  for (const [moduleDir, data] of moduleMap) {
    const coveredFiles = new Set<string>();
    for (const relative of data.sources) {
      if (coverageMap.has(relative)) {
        coveredFiles.add(relative);
      }
    }

    result.push({
      modulePath: moduleDir,
      sourceFileCount: data.sources.size,
      coveredFileCount: coveredFiles.size,
      coverageRatio: data.sources.size > 0 ? coveredFiles.size / data.sources.size : 0,
      testCount: data.tests.size
    });
  }

  return result.sort((a, b) => b.coverageRatio - a.coverageRatio);
}

// ---------------------------------------------------------------------------
// GapAnalyzer
// ---------------------------------------------------------------------------

/**
 * Analyze test coverage gaps in a workspace.
 *
 * Two scan modes:
 * - **Quick**: Discover tests, estimate coverage, find high-risk uncovered files. Fast (~10s).
 * - **Deep**: Quick + run tests, real coverage data, flaky detection. Slower (~60s).
 */
export class GapAnalyzer {
  private config: Required<GapAnalysisConfig>;
  private qaConfig: QAConfig;
  private onProgress?: (message: string, progress: number) => void;
  private workspaceRoot: string;

  constructor(options: {
    workspaceRoot: string;
    config?: GapAnalysisConfig;
    qaConfig?: QAConfig;
    onProgress?: (message: string, progress: number) => void;
  }) {
    const { workspaceRoot, config = {}, qaConfig = DEFAULT_QA_CONFIG, onProgress } = options;
    this.workspaceRoot = workspaceRoot;
    this.config = { ...DEFAULT_GAP_CONFIG, ...config } as Required<GapAnalysisConfig>;
    this.qaConfig = qaConfig;
    this.onProgress = onProgress;
  }

  /**
   * Run a quick gap analysis (no test execution).
   */
  async analyzeQuick(ctx?: GapAnalysisContext): Promise<GapAnalysisResult> {
    const startTime = Date.now();
    this.log("Discovering tests", 10);
    this.checkCancellation(ctx);

    const discovery = discoverTests(this.workspaceRoot);
    this.log("Enumerating source files", 30);
    this.checkCancellation(ctx);

    const discoveredTests = new Set(discovery.testFiles.map((file) => path.resolve(file)));
    const sourceFiles = enumerateSourceFiles(this.workspaceRoot).filter(
      (file) => !discoveredTests.has(path.resolve(file))
    );
    this.log("Computing coverage estimates", 50);
    this.checkCancellation(ctx);

    const coverageRatio = estimateCoverageRatio(discovery.testFiles, sourceFiles);
    const coverageRate =
      sourceFiles.length > 0 ? Math.min(discovery.testFiles.length / sourceFiles.length, 1.0) : 0;

    // Build risk data for uncovered files
    const riskData: FileRiskData[] = sourceFiles.map((file) => ({
      filePath: file,
      churn: 0.3,
      coupling: 0.2,
      coverage: 0,
      authorConcentration: 0.5,
      testInstability: 0,
      ageDays: 30
    }));

    const riskScores = computeRiskScores(riskData);
    // Quick analysis has no executed line coverage. Preserve the distinction between
    // “a mapped test exists” and “measured coverage exists” so Keystone does not tell
    // users that a source file is untested merely because coverage has not been run.
    const coverageMap = new Map<string, Set<number>>();
    const mappedWithoutCoverage: string[] = [];
    for (const sourceFile of sourceFiles) {
      if (!hasConventionMappedTest(sourceFile, discovery.testFiles)) continue;
      const relative = path.relative(this.workspaceRoot, sourceFile);
      coverageMap.set(relative, new Set());
      mappedWithoutCoverage.push(sourceFile);
    }

    this.log("Detecting gaps", 70);
    this.checkCancellation(ctx);

    const gaps = detectGaps(
      sourceFiles,
      discovery.testFiles,
      coverageMap,
      riskScores,
      this.config,
      this.workspaceRoot
    );
    for (const filePath of mappedWithoutCoverage)
      gaps.push({
        type: "no-coverage-data",
        filePath,
        severity: 0.2,
        reason:
          "A mapped test file exists, but executed line-coverage evidence is not available in quick analysis.",
        action: "Run the relevant test suite with coverage when measured coverage is required."
      });

    this.log("Generating recommendations", 90);
    this.checkCancellation(ctx);

    const recommendations = generateRecommendations(
      gaps,
      {
        testFramework: discovery.framework,
        totalTests: discovery.testFiles.length,
        totalSourceFiles: sourceFiles.length,
        coverageRatio,
        coverageRate,
        flakyTests: 0,
        brokenTests: 0,
        riskScore: Math.round(
          (riskScores.reduce((a, b) => a + b.overallScore, 0) / Math.max(riskScores.length, 1)) *
            100
        )
      },
      discovery
    );

    return {
      scanMode: "quick",
      summary: {
        testFramework: discovery.framework,
        totalTests: discovery.testFiles.length,
        totalSourceFiles: sourceFiles.length,
        coverageRatio,
        coverageRate,
        flakyTests: 0,
        brokenTests: 0,
        riskScore: Math.round(
          (riskScores.reduce((a, b) => a + b.overallScore, 0) / Math.max(riskScores.length, 1)) *
            100
        )
      },
      gaps,
      recommendations,
      metrics: {
        elapsedMs: Date.now() - startTime,
        testsDiscovered: discovery.testFiles.length,
        sourcesAnalyzed: sourceFiles.length,
        gapsFound: gaps.length,
        recommendationsGenerated: recommendations.length
      }
    };
  }

  /**
   * Run a deep gap analysis (with test execution and real coverage).
   */
  async analyzeDeep(ctx?: GapAnalysisContext, index?: RepoIndex): Promise<GapAnalysisResult> {
    const startTime = Date.now();
    this.log("Running quick analysis first", 5);

    const quickResult = await this.analyzeQuick(ctx);
    const discovery = discoverTests(this.workspaceRoot);
    const discoveredTests = new Set(discovery.testFiles.map((file) => path.resolve(file)));
    const sourceFiles = enumerateSourceFiles(this.workspaceRoot).filter(
      (file) => !discoveredTests.has(path.resolve(file))
    );
    const riskData: FileRiskData[] = sourceFiles.map((file) => ({
      filePath: file,
      churn: 0.3,
      coupling: 0.2,
      coverage: 0,
      authorConcentration: 0.5,
      testInstability: 0,
      ageDays: 30
    }));
    const riskScores = computeRiskScores(riskData);

    this.log("Running tests for coverage", 35);
    this.checkCancellation(ctx);

    const execConfig = this.qaConfig.execution;
    const command = discoverExecutionCommand(discovery, execConfig.testCommand);
    const quarantineStore = createQuarantineStore(this.workspaceRoot, this.qaConfig.quarantine);

    let executionResult: TestExecutionResult | undefined;
    if (command && discovery.testFiles.length > 0) {
      try {
        executionResult = await executeTests(
          {
            command,
            cwd: this.workspaceRoot,
            maxWorkers: execConfig.maxWorkers,
            timeoutMs: execConfig.timeoutMs,
            excludeQuarantined: execConfig.excludeQuarantined,
            signal: ctx?.signal
          },
          quarantineStore
        );
      } catch (error) {
        if (ctx?.signal?.aborted)
          throw Object.assign(new Error("Gap analysis cancelled"), { name: "CancellationError" });
        executionResult = {
          command,
          exitCode: -1,
          durationMs: 0,
          passed: 0,
          failed: 0,
          skipped: 0,
          output: error instanceof Error ? error.message : String(error)
        };
      }
    }

    this.log("Loading coverage evidence", 50);
    this.checkCancellation(ctx);
    const coverageData = loadCoverageData(this.workspaceRoot, index);
    const coverageMap = computeCoverageMap(
      discovery.testFiles,
      coverageData,
      sourceFiles,
      this.workspaceRoot
    );
    const deepGaps = detectGaps(
      sourceFiles,
      discovery.testFiles,
      coverageMap,
      riskScores,
      this.config,
      this.workspaceRoot
    );
    const coverageByModule = computeModuleCoverage(
      sourceFiles,
      coverageMap,
      discovery.testFiles,
      this.workspaceRoot
    );
    const coverageRate = sourceFiles.length > 0 ? coverageMap.size / sourceFiles.length : 0;

    this.log("Detecting flaky tests", 65);
    this.checkCancellation(ctx);
    const flakyConfig = this.qaConfig.flakyDetection;
    let flakyResult: FlakyDetectionResult | undefined;
    if (command && discovery.testFiles.length > 0) {
      try {
        flakyResult = await detectFlakyTests(
          discovery.testFiles,
          {
            ...flakyConfig,
            workspaceRoot: this.workspaceRoot,
            testCommand: command,
            signal: ctx?.signal
          },
          this.workspaceRoot
        );
      } catch (error) {
        if (ctx?.signal?.aborted)
          throw Object.assign(new Error("Gap analysis cancelled"), { name: "CancellationError" });
        flakyResult = {
          flakyTests: [],
          flakyRate: 0,
          totalTests: discovery.testFiles.length,
          recommendations: [error instanceof Error ? error.message : String(error)]
        };
      }
    } else {
      flakyResult = {
        flakyTests: [],
        flakyRate: 0,
        totalTests: discovery.testFiles.length,
        recommendations: []
      };
    }

    this.log("Analyzing impacted tests", 82);
    this.checkCancellation(ctx);
    let impactedTests: ImpactedTestSuggestion[] | undefined;
    if (index && (ctx?.changedPaths?.length ?? 0) > 0) {
      try {
        impactedTests = suggestImpactedTests(index, ctx!.changedPaths!);
      } catch {
        impactedTests = [];
      }
    }

    const totalFlaky = flakyResult?.flakyTests.length ?? 0;
    const totalFailed = executionResult?.failed ?? 0;

    return {
      scanMode: "deep",
      summary: {
        ...quickResult.summary,
        flakyTests: totalFlaky,
        brokenTests: totalFailed,
        coverageRate
      },
      gaps: deepGaps,
      recommendations: [
        ...generateRecommendations(
          deepGaps,
          {
            ...quickResult.summary,
            coverageRate,
            flakyTests: totalFlaky,
            brokenTests: totalFailed
          },
          discovery
        ),
        ...(totalFlaky > 0
          ? [
              {
                priority: "medium" as const,
                category: "maintenance",
                title: `${totalFlaky} flaky tests detected`,
                description:
                  "Flaky tests can mask real issues. Consider quarantining or fixing them.",
                suggestedAction: "Run `keystone qa quarantine` to quarantine flaky tests"
              }
            ]
          : []),
        ...(totalFailed > 0
          ? [
              {
                priority: "high" as const,
                category: "quality",
                title: `${totalFailed} broken tests`,
                description: "Broken tests block CI and mask real issues.",
                suggestedAction: "Run `keystone qa repair` to auto-fix common test failures"
              }
            ]
          : [])
      ] as Recommendation[],
      coverageByModule,
      impactedTests,
      flakyDetection: flakyResult,
      executionResult,
      metrics: {
        ...quickResult.metrics,
        elapsedMs: Date.now() - startTime
      }
    };
  }

  // ---------------------------------------------------------------------------
  // Internal helpers
  // ---------------------------------------------------------------------------

  private log(message: string, progress: number): void {
    this.onProgress?.(message, progress);
  }

  private checkCancellation(ctx?: GapAnalysisContext): void {
    if (ctx?.cancellation?.isCancellationRequested) {
      throw Object.assign(new Error("Gap analysis cancelled"), { name: "CancellationError" });
    }
  }
}

// ---------------------------------------------------------------------------
// Factory
// ---------------------------------------------------------------------------

/**
 * Create a gap analyzer instance.
 */
export function createGapAnalyzer(options: {
  workspaceRoot: string;
  config?: GapAnalysisConfig;
  qaConfig?: QAConfig;
  onProgress?: (message: string, progress: number) => void;
}): GapAnalyzer {
  return new GapAnalyzer(options);
}
