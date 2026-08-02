import { createQuarantineStore } from "./quarantine";

/**
 * Flaky test detection — run each test multiple times, collect pass/fail
 * rates, classify failure patterns, and return actionable recommendations.
 */

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type FlakyConfig = {
  /** Number of times to run each test (default 5) */
  runs: number;
  /** Failure rate above which a test is considered flaky (default 0.2) */
  threshold: number;
  /** Per-test timeout in ms (default 30_000) */
  timeoutMs: number;
  /** Skip quarantined tests (default false) */
  skipQuarantined: boolean;
  /** Workspace root (needed to run tests) */
  workspaceRoot?: string;
  /** Test command to run (e.g. "npx vitest run") */
  testCommand?: string;
  /** Optional cancellation signal for long repeated runs. */
  signal?: AbortSignal;
};

export type TestRunResult = {
  testPath: string;
  attempt: number;
  passed: boolean;
  error?: string;
  durationMs: number;
};

export type FlakyTest = {
  testPath: string;
  runs: number;
  failures: number;
  flakinessScore: number;
  classification: FlakyClassification;
  lastError?: string;
  recommendations: string[];
};

export type FlakyClassification = "BROKEN_LOCATOR" | "REAL_BUG" | "FLAKY" | "ENV_ISSUE";

export type FlakyDetectionResult = {
  flakyTests: FlakyTest[];
  totalTests: number;
  flakyRate: number;
  recommendations: string[];
};

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const DEFAULT_CONFIG: FlakyConfig = {
  runs: 5,
  threshold: 0.2,
  timeoutMs: 30_000,
  skipQuarantined: false,
  workspaceRoot: undefined,
  testCommand: undefined
};

const BROKEN_LOCATOR_PATTERNS = [
  /locator/i,
  /waiting/i,
  /timed out/i,
  /not found/i,
  /could not find/i,
  /element.*not/i,
  /stale/i,
  /no matching/i,
  /detached/i,
  /shadow/i
];

const REAL_BUG_PATTERNS = [
  /assertion/i,
  /expected/i,
  /received/i,
  /toBe/i,
  /toEqual/i,
  /toThrow/i,
  /toMatch/i,
  /snapshot/i,
  /expect.*failed/i
];

const ENV_ISSUE_PATTERNS = [
  /timeout/i,
  /ECONNREFUSED/i,
  /network/i,
  /connection.*reset/i,
  /ENOSPC/i,
  /EACCES/i,
  /permission/i,
  /out of memory/i,
  /OOM/i
];

// ---------------------------------------------------------------------------
// Classification
// ---------------------------------------------------------------------------

export function classifyFailure(error: string): FlakyClassification {
  if (BROKEN_LOCATOR_PATTERNS.some((p) => p.test(error))) {
    return "BROKEN_LOCATOR";
  }
  if (REAL_BUG_PATTERNS.some((p) => p.test(error))) {
    return "REAL_BUG";
  }
  if (ENV_ISSUE_PATTERNS.some((p) => p.test(error))) {
    return "ENV_ISSUE";
  }
  return "FLAKY";
}

function buildRecommendations(
  testPath: string,
  classification: FlakyClassification,
  lastError?: string
): string[] {
  const recs: string[] = [];

  switch (classification) {
    case "BROKEN_LOCATOR":
      recs.push(
        `Review locator strategy for \`${testPath}\` — consider stable selectors and proper waits.`
      );
      break;
    case "REAL_BUG":
      recs.push(
        `Fix the underlying bug in \`${testPath}\` — this is a real assertion failure, not flakiness.`
      );
      break;
    case "ENV_ISSUE":
      recs.push(
        `Check environment for \`${testPath}\` — timeouts, network issues, or resource constraints.`
      );
      if (lastError?.includes("timeout")) {
        recs.push(`Consider increasing timeout or optimizing the test execution path.`);
      }
      break;
    case "FLAKY":
      recs.push(
        `Investigate flakiness in \`${testPath}\` — ensure test isolation and avoid shared mutable state.`
      );
      recs.push(`Consider adding retries with backoff or quarantining if persistent.`);
      break;
  }

  return recs;
}

// ---------------------------------------------------------------------------
// Execution
// ---------------------------------------------------------------------------

/**
 * Run a single test N times and collect results.
 *
 * Override this function to inject your own test runner (Jest, Vitest,
 * Playwright, etc.).
 */
export async function runTest(testPath: string, config: FlakyConfig): Promise<TestRunResult[]> {
  const results: TestRunResult[] = [];

  for (let attempt = 0; attempt < config.runs; attempt++) {
    if (config.signal?.aborted)
      throw Object.assign(new Error("Flaky detection cancelled"), { name: "CancellationError" });
    const start = Date.now();
    let passed = false;
    let error: string | undefined;

    try {
      await runSingleTest(testPath, config);
      passed = true;
    } catch (err) {
      passed = false;
      error = err instanceof Error ? err.message : String(err);
    }

    results.push({
      testPath,
      attempt,
      passed,
      error,
      durationMs: Date.now() - start
    });
  }

  return results;
}

/**
 * Run a single test invocation.
 *
 * Uses the testExecution module to run the test file.
 */
export async function runSingleTest(testPath: string, config: FlakyConfig): Promise<void> {
  const { executeTests } = await import("./testExecution");

  const result = await executeTests(
    {
      command: config.testCommand ?? "npx vitest run",
      cwd: config.workspaceRoot ?? process.cwd(),
      testPathPattern: testPath,
      timeoutMs: config.timeoutMs,
      signal: config.signal
    },
    undefined
  );

  if (result.exitCode !== 0) {
    throw new Error(result.output || `Test failed with exit code ${result.exitCode}`);
  }
}

// ---------------------------------------------------------------------------
// Detection
// ---------------------------------------------------------------------------

/**
 * Detect flaky tests from a list of test paths.
 *
 * @param testPaths - List of test identifiers to check
 * @param config - Detection configuration
 * @returns Detection result with classifications and recommendations
 */
export async function detectFlakyTests(
  testPaths: string[],
  config: Partial<FlakyConfig> = {},
  workspaceRoot?: string
): Promise<FlakyDetectionResult> {
  const merged = { ...DEFAULT_CONFIG, ...config };
  const quarantine = workspaceRoot ? createQuarantineStore(workspaceRoot) : undefined;

  // Filter quarantined tests if configured
  const candidates = merged.skipQuarantined
    ? testPaths.filter((p) => !quarantine?.isQuarantined(p))
    : testPaths;

  const allResults: TestRunResult[] = [];
  const flakyTests: FlakyTest[] = [];

  // Run each test in isolation
  for (const testPath of candidates) {
    if (merged.signal?.aborted)
      throw Object.assign(new Error("Flaky detection cancelled"), { name: "CancellationError" });
    const runResults = await runTest(testPath, merged);
    allResults.push(...runResults);

    const failures = runResults.filter((r) => !r.passed).length;
    const flakinessScore = failures / runResults.length;

    if (flakinessScore >= merged.threshold) {
      const lastError = runResults.find((r) => !r.passed)?.error;
      const classification = lastError ? classifyFailure(lastError) : "FLAKY";

      flakyTests.push({
        testPath,
        runs: runResults.length,
        failures,
        flakinessScore,
        classification,
        lastError,
        recommendations: buildRecommendations(testPath, classification, lastError)
      });
    }
  }

  // Build top-level recommendations
  const recommendations = buildGlobalRecommendations(flakyTests);

  return {
    flakyTests,
    totalTests: candidates.length,
    flakyRate: candidates.length > 0 ? flakyTests.length / candidates.length : 0,
    recommendations
  };
}

// ---------------------------------------------------------------------------
// Reporting
// ---------------------------------------------------------------------------

function buildGlobalRecommendations(flakyTests: FlakyTest[]): string[] {
  const recs: string[] = [];

  if (flakyTests.length === 0) {
    recs.push("No flaky tests detected. All tests passed consistently.");
    return recs;
  }

  const byClass = new Map<FlakyClassification, number>();
  for (const ft of flakyTests) {
    byClass.set(ft.classification, (byClass.get(ft.classification) ?? 0) + 1);
  }

  if (byClass.get("REAL_BUG") ?? 0 > 0) {
    recs.push(
      `${byClass.get("REAL_BUG")} test(s) appear to have real bugs — fix these before addressing flakiness.`
    );
  }

  if (byClass.get("BROKEN_LOCATOR") ?? 0 > 0) {
    recs.push(
      `${byClass.get("BROKEN_LOCATOR")} test(s) show broken locator patterns — review selectors and waits.`
    );
  }

  if (byClass.get("ENV_ISSUE") ?? 0 > 0) {
    recs.push(
      `${byClass.get("ENV_ISSUE")} test(s) show environment issues — check CI/CD infrastructure.`
    );
  }

  if (byClass.get("FLAKY") ?? 0 > 0) {
    recs.push(
      `${byClass.get("FLAKY")} test(s) show genuine flakiness — isolate state and consider retries.`
    );
  }

  recs.push(`Quarantine persistent flaky tests to prevent CI signal loss.`);

  return recs;
}

/**
 * Format detection results as a human-readable string.
 */
export function formatFlakyDetection(result: FlakyDetectionResult): string {
  const lines: string[] = [
    "# Keystone Flaky Test Detection",
    "",
    `Total tests scanned: ${result.totalTests}`,
    `Flaky tests found: ${result.flakyTests.length}`,
    `Flaky rate: ${(result.flakyRate * 100).toFixed(1)}%`,
    ""
  ];

  if (result.flakyTests.length === 0) {
    lines.push("No flaky tests detected.");
    return lines.join("\n");
  }

  lines.push("## Flaky Tests");

  for (const ft of result.flakyTests) {
    lines.push("");
    lines.push(`### \`${ft.testPath}\``);
    lines.push(
      `- **Score:** ${(ft.flakinessScore * 100).toFixed(1)}% (${ft.failures}/${ft.runs} failures)`
    );
    lines.push(`- **Classification:** ${ft.classification}`);
    if (ft.lastError) {
      lines.push(`- **Last error:** \`${truncate(ft.lastError, 120)}\``);
    }
    for (const rec of ft.recommendations) {
      lines.push(`- ${rec}`);
    }
  }

  lines.push("");
  lines.push("## Recommendations");
  for (const rec of result.recommendations) {
    lines.push(`- ${rec}`);
  }

  return lines.join("\n");
}

function truncate(s: string, max: number): string {
  return s.length > max ? s.slice(0, max) + "…" : s;
}
