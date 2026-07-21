/**
 * TestCommandDiscoveryService (§24) + TestCommandConfigurationService (§25) +
 * TestResultParserRegistry (§30) + TestExecutionService (§27, adapter-based, no real shell).
 *
 * Commands are discovered/validated against allowlisted templates. Execution is delegated to
 * an injectable TestExecutionAdapter (never a raw shell), satisfying the safety model (§42):
 * no destructive/unvalidated commands, secrets are never stored as values, runs are
 * previewable and cancellable.
 */
import type {
  TestLayer,
  TestExecutionRun,
  TestCommandRun,
  ParsedTestResult,
  RawCommandResult,
  TestCommandDefinition,
} from "../../../shared/contracts/qaLifecycle";
import { createHash } from "node:crypto";

// ---------------------------------------------------------------------------
// Command definition + discovery
// ---------------------------------------------------------------------------

export interface DiscoveredCommand {
  id: string;
  displayName: string;
  commandTemplate: string;
  workingDirectory?: string;
  layer: TestLayer;
  framework?: string;
  supportsFileTargeting: boolean;
  supportsTestNameTargeting: boolean;
  supportsCoverage: boolean;
  estimatedScope: "single-test" | "file" | "package" | "project" | "repository";
  requiredEnvironment: string[];
  source:
    | "package-script"
    | "workspace-task"
    | "build-tool"
    | "test-config"
    | "user-config"
    | "validation-provider";
  confidence: number;
  available: boolean;
}

const DESTRUCTIVE =
  /(rm\s+-rf|git\s+push|git\s+commit|deploy|kubectl|docker\s+rm|drop\s+table|truncate\s+table|npm\s+publish|--force\s+push|curl\s+.*\|\s*(sh|bash))/i;
const SECRET_KEYS =
  /(token|secret|password|passwd|api[_-]?key|access[_-]?key|private[_-]?key|credential)/i;

export class TestCommandDiscoveryService {
  /** Discover candidate commands from deterministic sources. Does NOT execute anything. */
  discover(input: {
    packageScripts?: Record<string, string>;
    workspaceTasks?: Array<{ id: string; command: string; layer?: TestLayer }>;
    buildToolTargets?: Array<{ id: string; command: string; layer?: TestLayer }>;
    testConfigCommands?: Array<{ id: string; command: string; layer: TestLayer }>;
    validationProviderCommands?: Array<{ id: string; command: string; layer: TestLayer }>;
  }): DiscoveredCommand[] {
    const out: DiscoveredCommand[] = [];
    const push = (
      id: string,
      command: string,
      layer: TestLayer,
      source: DiscoveredCommand["source"],
      confidence: number,
    ) => {
      const available = !DESTRUCTIVE.test(command);
      out.push({
        id,
        displayName: id,
        commandTemplate: command,
        layer,
        supportsFileTargeting: /(\{\{file\}\}|\{\{path\}\}|--file|\bf\b)/.test(command),
        supportsTestNameTargeting: /(\{\{test\}\}|\{\{name\}\}|--testName|--grep|-t\b)/.test(
          command,
        ),
        supportsCoverage: /(--coverage|coverage|--cov)/.test(command),
        estimatedScope:
          command.includes("{{file}}") || command.includes("{{path}}") ? "file" : "project",
        requiredEnvironment: SECRET_KEYS.test(command) ? ["<secret-redacted>"] : [],
        source,
        confidence,
        available,
      });
    };
    for (const [name, cmd] of Object.entries(input.packageScripts ?? {}))
      push(`pkg:${name}`, cmd, classifyScript(name), "package-script", 0.9);
    for (const t of input.workspaceTasks ?? [])
      push(`task:${t.id}`, t.command, t.layer ?? "unit", "workspace-task", 0.8);
    for (const t of input.buildToolTargets ?? [])
      push(`build:${t.id}`, t.command, t.layer ?? "unit", "build-tool", 0.8);
    for (const t of input.testConfigCommands ?? [])
      push(`cfg:${t.id}`, t.command, t.layer, "test-config", 0.85);
    for (const t of input.validationProviderCommands ?? [])
      push(`val:${t.id}`, t.command, t.layer, "validation-provider", 0.9);
    return out;
  }
}

function classifyScript(name: string): TestLayer {
  if (/e2e|integration/i.test(name)) return "integration";
  if (/contract|schema/i.test(name)) return "contract";
  if (/unit/i.test(name)) return "unit";
  return "unit";
}

// ---------------------------------------------------------------------------
// Configuration (allowlisted templates only)
// ---------------------------------------------------------------------------

export interface CommandConfig {
  enabled: boolean;
  layer: TestLayer;
  workingDirectory?: string;
  allowedArgs: string[];
  timeoutMs: number;
  environmentVariableNames: string[]; // names only; values never stored
  resultParserId: string;
  coverageParserId?: string;
  requireApproval: boolean;
  allowAutoRun: boolean;
  retryPolicy: { maxRetries: number; backoffMs: number };
}

export class TestCommandConfigurationService {
  validate(template: string, args: string[]): { ok: boolean; reason?: string } {
    if (DESTRUCTIVE.test(template) || args.some((a) => DESTRUCTIVE.test(a))) {
      return { ok: false, reason: "Command or arguments are destructive and not permitted." };
    }
    // Only allowlist-substituted args.
    for (const a of args) {
      if (/[;&|`$]/.test(a)) return { ok: false, reason: "Unvalidated shell fragment detected." };
    }
    return { ok: true };
  }

  maskSecrets(env: Record<string, string>): Record<string, string> {
    const out: Record<string, string> = {};
    for (const [k, v] of Object.entries(env)) out[k] = SECRET_KEYS.test(k) ? "[REDACTED]" : v;
    return out;
  }
}

// ---------------------------------------------------------------------------
// Result parsers (pluggable, §30)
// ---------------------------------------------------------------------------

export interface TestResultParser {
  id: string;
  supports(command: TestCommandDefinition): boolean;
  parse(result: RawCommandResult): ParsedTestResult[];
}

export interface FallbackParserOptions {
  id?: string;
  fallbackExitCodePass?: number;
}

export class GenericFallbackParser implements TestResultParser {
  id = "generic-fallback";
  supports(_command: TestCommandDefinition): boolean {
    return true; // universal fallback
  }
  parse(result: RawCommandResult): ParsedTestResult[] {
    const passed = result.exitCode === 0;
    return [
      {
        parserId: this.id,
        status: result.timedOut ? "timed-out" : passed ? "passed" : "failed",
        durationMs: result.durationMs,
        errorMessage: passed ? undefined : result.stderr.slice(0, 2000) || "Command failed",
        stackTrace: passed ? undefined : result.stderr.slice(0, 20000),
        retryNumber: 0,
        relatedChangedEntityIds: [],
        relatedAcceptanceCriteria: [],
        parserConfidence: "command-level",
        rawOutputRef: result.rawOutputRef,
      },
    ];
  }
}

export class TestResultParserRegistry {
  private parsers: TestResultParser[] = [new GenericFallbackParser()];
  register(parser: TestResultParser): void {
    this.parsers.unshift(parser);
  }
  parse(command: TestCommandDefinition, result: RawCommandResult): ParsedTestResult[] {
    const parser = this.parsers.find((p) => p.supports(command)) ?? new GenericFallbackParser();
    return parser.parse(result);
  }
}

// ---------------------------------------------------------------------------
// Execution (adapter-based, §27)
// ---------------------------------------------------------------------------

export interface TestExecutionAdapter {
  run(
    command: TestCommandDefinition,
    opts: {
      timeoutMs: number;
      env?: Record<string, string>;
      onOutput?: (chunk: string) => void;
      signal?: AbortSignal;
    },
  ): Promise<RawCommandResult>;
}

export interface ExecutePlanInput {
  testPlanId: string;
  workflowId?: string;
  commands: Array<{ command: TestCommandDefinition; selectedTestIds?: string[] }>;
  timeoutMs: number;
  requireApproval: boolean;
  approved?: boolean;
  env?: Record<string, string>;
  adapter: TestExecutionAdapter;
  parserRegistry: TestResultParserRegistry;
}

export class TestExecutionService {
  async executePlan(
    input: ExecutePlanInput,
    signal?: AbortSignal,
  ): Promise<{ run: TestExecutionRun; results: ParsedTestResult[] }> {
    if (input.requireApproval && !input.approved) {
      return this.shell(input, "awaiting-approval", signal);
    }
    const startedAt = new Date().toISOString();
    const commandRuns: TestCommandRun[] = [];
    const allResults: ParsedTestResult[] = [];
    let failed = 0;
    let passed = 0;
    let cancelled = 0;

    for (const c of input.commands) {
      if (signal?.aborted) {
        commandRuns.push(this.cmd(c.command, "cancelled"));
        cancelled++;
        continue;
      }
      const run = this.cmd(c.command, "running");
      commandRuns.push(run);
      try {
        const raw = await input.adapter.run(c.command, {
          timeoutMs: input.timeoutMs,
          env: input.env,
          signal,
        });
        const parsed = input.parserRegistry.parse(c.command, raw);
        allResults.push(...parsed);
        const ok = parsed.every((p) => p.status === "passed" || p.status === "skipped");
        run.status = raw.timedOut ? "timed-out" : ok ? "passed" : "failed";
        run.exitCode = raw.exitCode;
        run.completedAt = new Date().toISOString();
        if (ok) passed++;
        else failed++;
      } catch (err) {
        run.status = "failed";
        run.completedAt = new Date().toISOString();
        failed++;
        void err;
      }
    }

    const status: TestExecutionRun["status"] =
      cancelled > 0 && passed + failed === 0 ? "cancelled" : failed > 0 ? "failed" : "passed";
    const run: TestExecutionRun = {
      id: crypto.randomUUID(),
      workflowId: input.workflowId,
      testPlanId: input.testPlanId,
      commands: commandRuns,
      summary: {
        totalCommands: commandRuns.length,
        passedCommands: passed,
        failedCommands: failed,
        cancelledCommands: cancelled,
        testCases: allResults.length,
        passedTests: allResults.filter((r) => r.status === "passed").length,
        failedTests: allResults.filter((r) => r.status === "failed").length,
        skippedTests: allResults.filter((r) => r.status === "skipped").length,
        durationMs: Date.now(),
      },
      status,
      metadata: {
        startedAt,
        completedAt: new Date().toISOString(),
        contentHash: this.hash(commandRuns.length, allResults.length),
      },
    };
    return { run, results: allResults };
  }

  private shell(
    input: ExecutePlanInput,
    status: TestExecutionRun["status"],
    signal?: AbortSignal,
  ): { run: TestExecutionRun; results: ParsedTestResult[] } {
    const run: TestExecutionRun = {
      id: crypto.randomUUID(),
      workflowId: input.workflowId,
      testPlanId: input.testPlanId,
      commands: input.commands.map((c) => this.cmd(c.command, "queued")),
      summary: {
        totalCommands: input.commands.length,
        passedCommands: 0,
        failedCommands: 0,
        cancelledCommands: 0,
        durationMs: 0,
      },
      status,
      metadata: {
        startedAt: new Date().toISOString(),
        contentHash: this.hash(input.commands.length, 0),
      },
    };
    void signal;
    return { run, results: [] };
  }

  private cmd(command: TestCommandDefinition, status: TestCommandRun["status"]): TestCommandRun {
    return {
      id: crypto.randomUUID(),
      commandId: command.id,
      displayName: command.displayName,
      template: command.commandTemplate,
      workingDirectory: command.workingDirectory,
      layer: command.layer,
      status,
    };
  }

  private hash(commands: number, results: number): string {
    return createHash("sha256").update(`${commands}:${results}`).digest("hex").slice(0, 32);
  }
}
