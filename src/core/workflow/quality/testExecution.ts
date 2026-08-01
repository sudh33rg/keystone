import { spawn, type ChildProcess } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

import { getBestTestCommand, getAllTestCommands } from "./test-runtime/TestRunnerDetection";
import type { TestCommandResult } from "./test-runtime/types";
import type { QuarantineStore } from "./quarantine";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface ExecutionOptions {
  /** Base test command (e.g. "npx jest", "npx vitest run") */
  command: string;
  /** Working directory for the test runner */
  cwd: string;
  /** Maximum number of parallel workers (e.g. 4 for --maxWorkers) */
  maxWorkers?: number;
  /** Timeout in milliseconds before killing the process */
  timeoutMs?: number;
  /** Regex pattern to filter which tests to run (e.g. --testPathPattern) */
  testPathPattern?: string;
  /** Exclude quarantined (known flaky) tests from the run */
  excludeQuarantined?: boolean;
}

export interface TestExecutionResult {
  /** The command that was executed */
  command: string;
  /** Exit code from the test runner (0 = pass, non-zero = failure) */
  exitCode: number;
  /** Wall-clock duration in milliseconds */
  durationMs: number;
  /** Number of tests that passed */
  passed: number;
  /** Number of tests that failed */
  failed: number;
  /** Number of tests that were skipped */
  skipped: number;
  /** Full stdout/stderr output */
  output: string;
}

export interface TestExecutionProgress {
  /** Current phase of execution */
  status: "preparing" | "running" | "completed";
  /** Elapsed milliseconds */
  elapsedMs: number;
  /** Tests that have completed so far */
  passed: number;
  /** Tests that have failed so far */
  failed: number;
  /** Tests skipped so far */
  skipped: number;
  /** Lines of output emitted so far */
  outputLines: string[];
}

type ProgressCallback = (progress: TestExecutionProgress) => void;

// ---------------------------------------------------------------------------
// Output parsing
// ---------------------------------------------------------------------------

const REGEX_PATTERNS = [
  /(\d+)\s+test(?:s)?\s+?(?:passed|failed|skipped)/i,
  /(\d+)\s+tests?\s+?(?:passed|failed|skipped)/i,
  /PASS\s+(?:\s+\((\d+)\s+tests?\))?/i,
  /FAIL\s+(?:\s+\((\d+)\s+tests?\))?/i,
  /(\d+)\s+test.*?passed/i,
  /(\d+)\s+test.*?failed/i,
  /(\d+)\s+test.*?skipped/i,
  /(\d+)\s+tests?\s+passed/i,
  /(\d+)\s+tests?\s+failed/i,
  /(\d+)\s+tests?\s+skipped/i,
];

function countMatches(output: string, regex: RegExp): number {
  let count = 0;
  let match: RegExpExecArray | null;
  while ((match = regex.exec(output)) !== null) {
    if (match[1]) {
      count += Number(match[1]);
    } else {
      count += 1;
    }
  }
  return count;
}

function parseTestCounts(output: string): { passed: number; failed: number; skipped: number } {
  const passed = Math.max(
    countMatches(output, /(\d+)\s+test(?:s)?\s+passed/i),
    countMatches(output, /(\d+)\s+tests?\s+passed/i),
  );
  const failed = Math.max(
    countMatches(output, /(\d+)\s+test(?:s)?\s+failed/i),
    countMatches(output, /(\d+)\s+tests?\s+failed/i),
  );
  const skipped = Math.max(
    countMatches(output, /(\d+)\s+test(?:s)?\s+skipped/i),
    countMatches(output, /(\d+)\s+tests?\s+skipped/i),
  );
  return { passed, failed, skipped };
}

// ---------------------------------------------------------------------------
// Quarantine-aware test path filtering
// ---------------------------------------------------------------------------

function buildQuarantineExclusionArgs(
  quarantineStore: QuarantineStore,
  cwd: string,
  runner: string,
): string[] {
  const quarantined = quarantineStore.list();
  if (quarantined.length === 0) {
    return [];
  }

  // Translate paths to runner-specific exclusion format
  const paths = quarantined.map((entry) => entry.testPath);
  return buildExclusionArgs(paths, runner);
}

function buildExclusionArgs(paths: string[], runner: string): string[] {
  switch (runner) {
    case "vitest":
      return ["--exclude", paths.map((p) => path.posix.join("**", p)).join(",")];
    case "jest":
      return ["--testPathIgnorePatterns", paths.map((p) => p.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("|")];
    case "mocha":
      return ["--ignore", paths.join(" ")];
    case "pytest":
      return ["-k", `not (${paths.map((p) => p.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join(" or ")})`];
    default:
      // No standard exclusion flag — return empty
      return [];
  }
}

// ---------------------------------------------------------------------------
// Command builder
// ---------------------------------------------------------------------------

function buildExecutionCommand(options: ExecutionOptions, quarantineStore?: QuarantineStore): string {
  const parts = [options.command];

  if (options.maxWorkers) {
    parts.push("--maxWorkers", String(options.maxWorkers));
  }

  if (options.testPathPattern) {
    parts.push("--testPathPattern", options.testPathPattern);
  }

  if (quarantineStore && options.excludeQuarantined) {
    const runner = detectRunner(options.command);
    parts.push(...buildQuarantineExclusionArgs(quarantineStore, options.cwd, runner));
  }

  return parts.join(" ");
}

function detectRunner(command: string): string {
  const lower = command.toLowerCase();
  if (lower.includes("vitest")) return "vitest";
  if (lower.includes("jest")) return "jest";
  if (lower.includes("mocha")) return "mocha";
  if (lower.includes("pytest")) return "pytest";
  return "unknown";
}

// ---------------------------------------------------------------------------
// Test runner detection helpers
// ---------------------------------------------------------------------------

export function detectRunnerCommand(cwd: string): TestCommandResult | null {
  const packageJsonPath = path.join(cwd, "package.json");
  if (fs.existsSync(packageJsonPath)) {
    try {
      const pkg = JSON.parse(fs.readFileSync(packageJsonPath, "utf8")) as Record<string, unknown>;
      const results = getAllTestCommands(pkg, undefined, undefined, undefined, undefined, cwd);
      return getBestTestCommand(results);
    } catch {
      return null;
    }
  }
  return null;
}

// ---------------------------------------------------------------------------
// Execution engine
// ---------------------------------------------------------------------------

export async function executeTests(
  options: ExecutionOptions,
  quarantineStore?: QuarantineStore,
  onProgress?: ProgressCallback,
): Promise<TestExecutionResult> {
  const command = buildExecutionCommand(options, quarantineStore);
  const startTime = Date.now();

  emitProgress(onProgress, "preparing", startTime, { passed: 0, failed: 0, skipped: 0 });

  return new Promise<TestExecutionResult>((resolve, reject) => {
    const child = spawn(options.command, {
      cwd: options.cwd,
      shell: true,
      env: { ...process.env },
    });

    const stdoutChunks: string[] = [];
    const stderrChunks: string[] = [];
    let killed = false;

    child.stdout.on("data", (chunk: Buffer) => {
      const text = chunk.toString("utf8");
      stdoutChunks.push(text);
      const lines = text.split("\n").filter((l) => l.trim().length > 0);
      emitProgress(onProgress, "running", startTime, { passed: 0, failed: 0, skipped: 0 }, lines);
    });

    child.stderr.on("data", (chunk: Buffer) => {
      const text = chunk.toString("utf8");
      stderrChunks.push(text);
      const lines = text.split("\n").filter((l) => l.trim().length > 0);
      emitProgress(onProgress, "running", startTime, { passed: 0, failed: 0, skipped: 0 }, lines);
    });

    child.on("error", (err: NodeJS.ErrnoException) => {
      killed = true;
      reject(err);
    });

    child.on("exit", (code, signal) => {
      if (killed) return;
      const output = stdoutChunks.join("") + stderrChunks.join("");
      const counts = parseTestCounts(output);
      const durationMs = Date.now() - startTime;

      emitProgress(onProgress, "completed", startTime, {
        passed: counts.passed,
        failed: counts.failed,
        skipped: counts.skipped,
      });

      resolve({
        command,
        exitCode: code ?? -1,
        durationMs,
        passed: counts.passed,
        failed: counts.failed,
        skipped: counts.skipped,
        output,
      });
    });

    // Timeout guard
    if (options.timeoutMs) {
      const timer = setTimeout(() => {
        killed = true;
        try {
          child.kill("SIGTERM");
        } catch {
          // Process may already be dead
        }
      }, options.timeoutMs);
      timer.unref();
    }
  });
}

// ---------------------------------------------------------------------------
// Parallel execution
// ---------------------------------------------------------------------------

export async function executeTestsParallel(
  options: Omit<ExecutionOptions, "command"> & { commands: string[] },
  quarantineStore?: QuarantineStore,
  onProgress?: ProgressCallback,
): Promise<TestExecutionResult[]> {
  const concurrency = options.maxWorkers ?? 4;
  const queued = options.commands.map((cmd) => ({
    command: cmd,
    ...options,
  }));

  const results: TestExecutionResult[] = [];
  let active = 0;

  async function runNext(): Promise<void> {
    while (queued.length > 0) {
      const item = queued.shift()!;
      active++;
      try {
        const result = await executeTests(
          item,
          quarantineStore,
          onProgress,
        );
        results.push(result);
      } finally {
        active--;
        await runNext();
      }
    }
  }

  const workers = Array.from({ length: Math.min(concurrency, queued.length) }, () => runNext());
  await Promise.all(workers);

  return results;
}

// ---------------------------------------------------------------------------
// Progress emitter
// ---------------------------------------------------------------------------

function emitProgress(
  onProgress: ProgressCallback | undefined,
  status: TestExecutionProgress["status"],
  startTime: number,
  counts: { passed: number; failed: number; skipped: number },
  outputLines: string[] = [],
): void {
  if (!onProgress) return;
  onProgress({
    status,
    elapsedMs: Date.now() - startTime,
    ...counts,
    outputLines,
  });
}
