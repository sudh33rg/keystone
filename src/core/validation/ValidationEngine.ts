import * as vscode from "vscode";
import type { WorkspaceAdapter } from "../../extension/adapters/WorkspaceAdapter";
import type { GitAdapter } from "../../extension/adapters/GitAdapter";
import {
  type ValidationRun,
  type ValidationCheck,
  type OverrideRecord,
  ValidationRunSchema,
  SCHEMA_VERSION
} from "../../shared/contracts/domain";
import { KeystoneError } from "../../shared/errors/KeystoneError";

export interface ValidationCommand {
  label: string;
  command: string;
  riskLevel: "safe" | "moderate" | "dangerous";
  provenance: string;
}

export interface ValidationPlan {
  commands: ValidationCommand[];
  checks: string[];
}

export class ValidationEngine {
  constructor(
    private readonly workspace: WorkspaceAdapter,
    private readonly git: GitAdapter
  ) {}

  async plan(workflowId: string, specificationRevision: number, taskIds: string[]): Promise<ValidationPlan> {
    const commands: ValidationCommand[] = [];
    const checks: string[] = [];

    // Detect build command
    const buildCommand = await this.detectCommand("build");
    if (buildCommand) {
      commands.push({ ...buildCommand, riskLevel: "moderate", provenance: "detected" });
      checks.push("build");
    }

    // Detect lint command
    const lintCommand = await this.detectCommand("lint");
    if (lintCommand) {
      commands.push({ ...lintCommand, riskLevel: "safe", provenance: "detected" });
      checks.push("lint");
    }

    // Detect test command
    const testCommand = await this.detectCommand("test");
    if (testCommand) {
      commands.push({ ...testCommand, riskLevel: "moderate", provenance: "detected" });
      checks.push("test");
    }

    // Add type-check if TypeScript
    const tsConfig = await this.detectTypeScriptConfig();
    if (tsConfig) {
      commands.push({
        label: "Type Check",
        command: `npx tsc --noEmit`,
        riskLevel: "safe",
        provenance: "detected"
      });
      checks.push("type-check");
    }

    return { commands, checks };
  }

  async run(runId: string, commands: ValidationCommand[], runContext?: { workflowId: string; specificationRevision: number; baseCommit?: string }): Promise<ValidationRun> {
    const run: ValidationRun = {
      id: runId,
      workflowId: runContext?.workflowId ?? "",
      specificationRevision: runContext?.specificationRevision ?? 0,
      taskIds: [],
      status: "running",
      startedAt: new Date().toISOString(),
      checks: [],
      changedFiles: [],
      criterionResults: [],
      driftFindings: [],
      overrideRecords: []
    };

    // Detect file changes first
    try {
      const changed = await this.detectChangedFiles(runContext?.baseCommit, runContext);
      if (changed.expected.length > 0) {
        run.changedFiles.push(...changed.expected);
      }
      if (changed.preExisting.length > 0) {
        run.changedFiles.push(...changed.preExisting);
      }
    } catch {
      // Index error - skip file detection
    }

    // Detect permission changes and sensitive file touches
    try {
      const root = this.workspace.getRoots()[0];
      if (root) {
        const permChanges = await this.detectPermissionChanges(root.uri.fsPath);
        if (permChanges.length > 0) {
          run.driftFindings.push(...permChanges.map(f => ({ description: `Permission changed: ${f}`, affectedCriteria: [] })));
        }

        const sensitiveTouches = await this.detectSensitiveFileTouches(root.uri.fsPath);
        if (sensitiveTouches.length > 0) {
          run.driftFindings.push(...sensitiveTouches.map(f => ({ description: `Sensitive file touched: ${f}`, affectedCriteria: [] })));
        }
      }
    } catch {
      // Git error - skip file detection
    }

    for (const command of commands) {
      const checkId = crypto.randomUUID();
      const startTime = new Date();

      try {
        const result = await this.executeCommand(command.command);
        run.checks.push({
          id: checkId,
          type: command.label,
          status: result.exitCode === 0 ? "passed" : "failed",
          command: command.command,
          startedAt: startTime.toISOString(),
          completedAt: new Date().toISOString(),
          exitCode: result.exitCode,
          outputReference: `output:${checkId}`,
          evidenceReferences: [],
          affectedCriteria: [],
          retryable: true,
          error: result.exitCode !== 0 ? result.output.slice(0, 1000) : undefined
        });
      } catch (error) {
        run.checks.push({
          id: checkId,
          type: command.label,
          status: "failed",
          command: command.command,
          startedAt: startTime.toISOString(),
          completedAt: new Date().toISOString(),
          error: error instanceof Error ? error.message : String(error),
          evidenceReferences: [],
          affectedCriteria: [],
          retryable: true
        });
      }
    }

    run.status = "completed";
    run.completedAt = new Date().toISOString();

    const validated = ValidationRunSchema.safeParse(run);
    if (!validated.success) {
      throw new KeystoneError({
        code: "VALIDATION_RUN_VALIDATION_FAILED",
        category: "VALIDATION",
        message: "Validation run failed schema validation.",
        operation: "validation.run",
        recoverable: false,
        recommendedAction: "Review the validation results and retry."
      });
    }

    return validated.data;
  }

  createOverride(
    workflowId: string,
    criterionId: string,
    reason: string,
    riskAcknowledgement: string,
    priorResult: string
  ): OverrideRecord {
    return {
      id: crypto.randomUUID(),
      userId: "user",
      timestamp: new Date().toISOString(),
      criterionId,
      reason,
      riskAcknowledgement,
      priorResult: priorResult as "unverified" | "passed" | "failed" | "requires-user-review" | "overridden",
      resultingStatus: "overridden"
    };
  }

  async detectChangedFiles(
    baseCommit?: string,
    runContext?: { workflowId: string; specificationRevision: number; branch?: string }
  ): Promise<{ expected: string[]; actual: string[]; preExisting: string[]; uncertain: string[] }> {
    const roots = this.workspace.getRoots();
    if (roots.length === 0) return { expected: [], actual: [], preExisting: [], uncertain: [] };

    const root = roots[0]!;
    const branch = runContext?.branch ?? this.git.getCurrentBranch(root.uri.fsPath);

    let expected: string[] = [];
    let actual: string[] = [];
    let preExisting: string[] = [];

    try {
      // Get files changed since base commit or current HEAD
      const changed = await this.git.getChangedFiles(root.uri.fsPath, baseCommit);
      if (changed) {
        expected = changed.map(f => f.path);
      }
    } catch {
      // Fallback: get current HEAD changes
      const currentHead = await this.git.getCurrentBranch(root.uri.fsPath);
      if (currentHead) {
        const changed = await this.git.getChangedFiles(root.uri.fsPath, currentHead);
        expected = changed?.map(f => f.path) ?? [];
      }
    }

    // Get all modified tracked files
    try {
      const modified = await this.git.getChangedFiles(root.uri.fsPath);
      if (modified) {
        const modifiedFiles = modified.map(f => f.path);
        for (const file of modifiedFiles) {
          if (expected.includes(file)) continue;
          // File is modified but not in expected list - could be pre-existing change
          preExisting.push(file);
        }
      }
    } catch {
      // No modifications
    }

    return { expected, actual, preExisting, uncertain: [] };
  }

  async detectPermissionChanges(rootPath: string): Promise<string[]> {
    const changes: string[] = [];

    try {
      const index = await this.git.getChangedFiles(rootPath, "HEAD~1");
      if (!index) return changes;

      const current = await this.git.getChangedFiles(rootPath);
      if (!current) return changes;

      const changedFiles = index
        .filter(f => current.some(c => c.path === f.path))
        .map(f => f.path);

      for (const file of changedFiles) {
        changes.push(file);
      }
    } catch {
      // Git error - return empty
    }

    return changes;
  }

  async detectSensitiveFileTouches(rootPath: string): Promise<string[]> {
    const sensitivePatterns = [
      /(\.env|\.env\.(local|development|production)|\.pem|\.key|secret|token|credential)/i
    ];

    const changes: string[] = [];

    try {
      const index = await this.git.getChangedFiles(rootPath, "HEAD~1");
      if (!index) return changes;

      const current = await this.git.getChangedFiles(rootPath);
      if (!current) return changes;

      const changedFiles = index
        .filter(f => current.some(c => c.path === f.path))
        .map(f => f.path);

      for (const file of changedFiles) {
        if (sensitivePatterns.some(p => p.test(file))) {
          changes.push(file);
        }
      }
    } catch {
      // Git error - return empty
    }

    return changes;
  }

  // TODO: Implement TODO scanning when findFiles API is available

  private async detectCommand(type: string): Promise<{ label: string; command: string } | undefined> {
    const roots = this.workspace.getRoots();
    if (roots.length === 0) return undefined;

    const root = roots[0]!;
    try {
      const packageJson = await this.workspace.readTextFile(
        vscode.Uri.joinPath(root.uri, "package.json")
      );
      const pkg = JSON.parse(packageJson) as { scripts?: Record<string, string> };
      if (pkg.scripts?.[type]) {
        return { label: `${type.charAt(0).toUpperCase() + type.slice(1)}`, command: `npm run ${type}` };
      }
    } catch {
      // No package.json or parse error
    }
    return undefined;
  }

  private async detectTypeScriptConfig(): Promise<boolean> {
    const roots = this.workspace.getRoots();
    if (roots.length === 0) return false;

    const root = roots[0]!;
    const tsconfigPath = vscode.Uri.joinPath(root.uri, "tsconfig.json");
    try {
      await this.workspace.readFile(tsconfigPath);
      return true;
    } catch {
      return false;
    }
  }

  private async executeCommand(command: string, timeoutMs = 60000): Promise<{ exitCode: number; output: string; stderr: string }> {
    return new Promise<{ exitCode: number; output: string; stderr: string }>((resolve) => {
      const timeout = setTimeout(() => {
        resolve({ exitCode: -1, output: "", stderr: "command timed out" });
      }, timeoutMs);

      const proc = require("child_process").spawnSync(command, {
        shell: true,
        maxBuffer: 16 * 1024 * 1024,
        timeout: timeoutMs
      });

      clearTimeout(timeout);
      const output = proc.stdout?.toString() ?? "";
      const stderr = proc.stderr?.toString() ?? "";
      const redactedOutput = this.redactSecrets(output);
      const redactedStderr = this.redactSecrets(stderr);

      resolve({ exitCode: proc.status ?? -1, output: redactedOutput, stderr: redactedStderr });
    });
  }

  private redactSecrets(text: string): string {
    // Redact common secret patterns
    const patterns: RegExp[] = [
      /password\s*[=:]\s*["']?[\w\-]+["']?/gi,
      /api[_-]?key\s*[=:]\s*["']?[\w\-]+["']?/gi,
      /token\s*[=:]\s*["']?[\w\-]+["']?/gi,
      /secret\s*[=:]\s*["']?[\w\-]+["']?/gi,
      /PRIVATE[_-]?KEY\s*[=:]\s*[\w\-]+/gi,
      /AKIA[\w\-]{16}/gi,
      /ghp_[\w\-]{36}/gi
    ];

    let redacted = text;
    for (const pattern of patterns) {
      redacted = redacted.replace(pattern, (match) => {
        // Keep only first few chars for debugging
        const masked = match.slice(0, 6) + "...".repeat(Math.ceil((match.length - 6) / 4)) + match.slice(-4);
        return masked;
      });
    }
    return redacted;
  }

  determineStatus(checks: ValidationCheck[], driftFindings: Array<{ description: string; affectedCriteria: string[] }>): "passed" | "warning" | "failed" {
    const failedChecks = checks.filter(c => c.status === "failed");
    const passedChecks = checks.filter(c => c.status === "passed");

    if (failedChecks.length > 0) {
      return "failed";
    }

    // Check for warnings
    const nonPassedChecks = checks.filter(c => c.status !== "passed");
    const driftCount = driftFindings.length;
    const totalChecks = checks.length;

    // Warning if there are any non-passed checks or drift findings
    if (nonPassedChecks.length > 0 || driftCount > 0) {
      return "warning";
    }

    // Passed if all checks passed and no drift
    return "passed";
  }

  calculateCompletionScore(checks: ValidationCheck[], driftFindings: Array<{ description: string; affectedCriteria: string[] }>): { score: number; message: string } {
    const totalChecks = checks.length;
    const passedChecks = checks.filter(c => c.status === "passed").length;
    const failedChecks = checks.filter(c => c.status === "failed").length;
    const driftCount = driftFindings.length;
    const warningCount = checks.filter(c => c.status === "warning").length;

    // Base score: percentage of passed checks
    let score = (passedChecks / Math.max(1, totalChecks)) * 100;

    // Deduct points for drift findings
    score -= driftCount * 10;

    // Deduct points for failed checks
    score -= failedChecks * 20;

    // Deduct points for warnings
    score -= warningCount * 5;

    // Cap at 0
    score = Math.max(0, score);

    let message = "All checks passed.";
    if (driftCount > 0) {
      message += ` Drift detected in ${driftCount} area(s).`;
    }
    if (failedChecks > 0) {
      message += ` ${failedChecks} check(s) failed.`;
    }
    if (warningCount > 0) {
      message += ` ${warningCount} warning(s).`;
    }

    return { score, message };
  }
}
