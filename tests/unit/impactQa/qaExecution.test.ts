import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { TestFrameworkDiscoveryService } from "../../../src/core/impactQa/TestFrameworkDiscoveryService";
import { QaPlanService } from "../../../src/core/impactQa/QaPlanService";
import { ControlledCommandRunner } from "../../../src/core/impactQa/ControlledCommandRunner";
import { TestResultParserService } from "../../../src/core/impactQa/TestResultParserService";
import { QaDecisionService } from "../../../src/core/impactQa/QaDecisionService";

const workflowId = "00000000-0000-4000-8000-000000000071";

describe("Phase 7 test discovery and planning", () => {
  it("discovers verified Vitest commands from repository configuration without inventing commands", async () => {
    const root = await mkdtemp(join(tmpdir(), "keystone-p7-discovery-"));
    await writeFile(join(root, "package.json"), JSON.stringify({ scripts: { test: "vitest run", lint: "eslint ." }, devDependencies: { vitest: "1.0.0" } }));
    const result = await new TestFrameworkDiscoveryService().discover(root);
    expect(result).toEqual([expect.objectContaining({ framework: "vitest", availability: "available", commands: [expect.objectContaining({ executable: "npm", arguments: ["run", "test", "--"], source: "package-script" })] })]);
  });

  it("reports unsupported framework state and never promotes a non-test script", async () => {
    const root = await mkdtemp(join(tmpdir(), "keystone-p7-unsupported-"));
    await writeFile(join(root, "package.json"), JSON.stringify({ scripts: { build: "tsc" } }));
    const result = await new TestFrameworkDiscoveryService().discover(root);
    expect(result[0]).toMatchObject({ availability: "unsupported" });
    expect(result[0]?.commands).toEqual([]);
  });

  it("separates required, recommended and optional tests with exact verified commands", () => {
    const plan = new QaPlanService().generate({ workflowId, impactAnalysisId: "impact-1", impactHash: "sha256:impact", changeSetHash: "sha256:change", mappings: [
      { id: "m1", productionEntityId: "changed", testFilePath: "tests/direct.test.ts", mappingType: "call", confidence: 1, evidenceIds: ["e1"], distance: 0 },
      { id: "m2", productionEntityId: "transitive", testFilePath: "tests/transitive.test.ts", mappingType: "import", confidence: .8, evidenceIds: ["e2"], distance: 2 },
    ], capabilities: [{ id: "vitest", framework: "vitest", sourceFiles: ["package.json"], availability: "available", commands: [{ id: "cmd-test", frameworkId: "vitest", displayName: "Test", executable: "npm", arguments: ["run", "test", "--"], workingDirectory: ".", scope: "test-file", source: "package-script", timeoutMs: 120000 }] }], coverageGaps: [] });
    expect(plan.requiredItems).toHaveLength(1);
    expect(plan.recommendedItems).toHaveLength(1);
    expect(plan.optionalItems.length).toBeGreaterThanOrEqual(1);
    expect(plan.requiredItems[0]?.reason).toBeTruthy();
    expect(plan.requiredItems[0]?.command.executable).toBe("npm");
  });

  it("requires a reason to override required tests and becomes stale on input changes", () => {
    const service = new QaPlanService();
    expect(() => service.updateSelection({} as never, "missing", false)).toThrow();
    expect(service.freshness({ changeSetHash: "a", impactHash: "b" }, { changeSetHash: "x", impactHash: "b" }).stale).toBe(true);
  });
});

describe("Phase 7 controlled execution and decisions", () => {
  it("runs a real process without a shell, streams output and preserves raw output", async () => {
    const root = await mkdtemp(join(tmpdir(), "keystone-p7-run-"));
    const chunks: string[] = [];
    const result = await new ControlledCommandRunner(root).run({ id: "node-pass", frameworkId: "node", displayName: "Node pass", executable: process.execPath, arguments: ["-e", "console.log('passed 2 tests')"], workingDirectory: ".", scope: "suite", source: "user-configured", timeoutMs: 5000 }, { onOutput: (chunk) => chunks.push(chunk) });
    expect(result.status).toBe("completed");
    expect(result.exitCode).toBe(0);
    expect(chunks.join("")).toContain("passed 2 tests");
    expect(result.rawOutput).toContain("passed 2 tests");
  });

  it("rejects traversal, shell fragments, duplicate runs and supports timeout", async () => {
    const root = await mkdtemp(join(tmpdir(), "keystone-p7-safe-"));
    const runner = new ControlledCommandRunner(root);
    await expect(runner.run({ id: "bad", frameworkId: "x", displayName: "bad", executable: "sh", arguments: ["-c", "rm -rf /"], workingDirectory: "../", scope: "suite", source: "user-configured", timeoutMs: 10 }, {})).rejects.toMatchObject({ code: "test-command-unavailable" });
    const timeout = await runner.run({ id: "slow", frameworkId: "node", displayName: "slow", executable: process.execPath, arguments: ["-e", "setTimeout(()=>{}, 1000)"], workingDirectory: ".", scope: "suite", source: "user-configured", timeoutMs: 20 }, {});
    expect(timeout.status).toBe("timed-out");
  });

  it("rejects a duplicate in-flight command and cancels the real child process", async () => {
    const root = await mkdtemp(join(tmpdir(), "keystone-p7-cancel-"));
    const runner = new ControlledCommandRunner(root);
    const command = { id: "long-running", frameworkId: "node", displayName: "long", executable: process.execPath, arguments: ["-e", "console.log('ready'), setInterval(()=>{}, 1000)"], workingDirectory: ".", scope: "suite" as const, source: "user-configured" as const, timeoutMs: 5000 };
    let ready!: () => void;
    const started = new Promise<void>((resolve) => { ready = resolve; });
    const running = runner.run(command, { onOutput: (chunk) => { if (chunk.includes("ready")) ready(); } });
    await started;
    await expect(runner.run(command, {})).rejects.toMatchObject({ code: "duplicate-execution" });
    expect(runner.cancel(command.id)).toBe(true);
    await expect(running).resolves.toMatchObject({ status: "cancelled", cancelled: true, timedOut: false });
  });

  it("parses Vitest totals and leaves unknown output unparsed without fabricated counts", () => {
    const parser = new TestResultParserService();
    expect(parser.parse("vitest", "Test Files  2 passed (2)\nTests  7 passed | 1 skipped (8)\nDuration  1.20s", "", 0)).toMatchObject({ parseStatus: "parsed", suites: { total: 2, passed: 2 }, tests: { total: 8, passed: 7, skipped: 1 } });
    expect(parser.parse("unknown", "hello", "", 0)).toEqual(expect.objectContaining({ parseStatus: "unparsed", suites: {}, tests: {}, failures: [] }));
  });

  it("distinguishes passed, warning, failed, incomplete and cancelled decisions", () => {
    const service = new QaDecisionService();
    const base = { workflowId, qaPlanId: "plan", qaExecutionId: "run", planCurrent: true, impactCurrent: true, requiredExecuted: true, requiredPassed: true, executionSucceeded: true, blockingGapIds: [], warningGapIds: [], optionalSkipped: false, cancelled: false, evidenceIds: ["run"] };
    expect(service.decide(base).decision).toBe("passed");
    expect(service.decide({ ...base, optionalSkipped: true }).decision).toBe("passed-with-warnings");
    expect(service.decide({ ...base, requiredPassed: false }).decision).toBe("failed");
    expect(service.decide({ ...base, planCurrent: false }).decision).toBe("incomplete");
    expect(service.decide({ ...base, cancelled: true }).decision).toBe("cancelled");
  });
});
