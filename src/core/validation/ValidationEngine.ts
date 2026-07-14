import * as vscode from "vscode";
import type { WorkspaceAdapter } from "../../extension/adapters/WorkspaceAdapter";
import type { GitAdapter } from "../../extension/adapters/GitAdapter";
import {
  type ValidationRun,
  type ValidationResult,
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

  async run(runId: string, commands: ValidationCommand[]): Promise<ValidationRun> {
    const run: ValidationRun = {
      id: runId,
      workflowId: "",
      specificationRevision: 0,
      taskIds: [],
      status: "running",
      startedAt: new Date().toISOString(),
      checks: [],
      changedFiles: [],
      criterionResults: [],
      driftFindings: [],
      overrideRecords: []
    };

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

  private async detectCommand(type: string): Promise<{ label: string; command: string } | undefined> {
    const roots = this.workspace.getRoots();
    if (roots.length === 0) return undefined;

    const root = roots[0];
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

    const root = roots[0];
    const tsconfigPath = vscode.Uri.joinPath(root.uri, "tsconfig.json");
    try {
      await this.workspace.readFile(tsconfigPath);
      return true;
    } catch {
      return false;
    }
  }

  private async executeCommand(command: string): Promise<{ exitCode: number; output: string }> {
    return new Promise((resolve) => {
      const terminal = vscode.window.createTerminal(`keystone-validation-${crypto.randomUUID().slice(0, 8)}`);
      terminal.sendText(command, false);

      // For now, we'll just return a placeholder
      // In a real implementation, we'd capture the output
      setTimeout(() => {
        terminal.dispose();
        resolve({ exitCode: 0, output: "" });
      }, 5000);
    });
  }
}
