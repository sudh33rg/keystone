import type { WorkspaceAdapter } from "../../extension/adapters/WorkspaceAdapter";
import type { GitAdapter } from "../../extension/adapters/GitAdapter";
import type { OverrideRecord } from "../../shared/contracts/domain";

export {
  AcceptanceCriteriaValidator,
  CommandExecutionService,
  ValidationOrchestrator,
  ValidationPlanner,
} from "./TaskValidationService";

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

/** Compatibility-only discovery facade. Execution is owned by the typed, non-shell ValidationOrchestrator. */
export class ValidationEngine {
  constructor(
    private readonly workspace: WorkspaceAdapter,
    private readonly git: GitAdapter,
  ) {
    void this.git;
  }
  async plan(
    workflowId: string,
    specificationRevision: number,
    taskIds: string[],
  ): Promise<ValidationPlan> {
    void workflowId;
    void specificationRevision;
    void taskIds;
    const root = this.workspace.getRoots()[0];
    if (!root) return { commands: [], checks: [] };
    try {
      const value = JSON.parse(
        (
          await this.workspace.readTextFile(this.workspace.fileReference(root, "package.json").uri)
        ).slice(0, 1_000_000),
      ) as { scripts?: Record<string, unknown> };
      const commands: ValidationCommand[] = [];
      for (const [name, riskLevel] of [
        ["typecheck", "safe"],
        ["lint", "safe"],
        ["test", "moderate"],
        ["build", "moderate"],
      ] as const)
        if (typeof value.scripts?.[name] === "string")
          commands.push({
            label: name,
            command: `npm run ${name}`,
            riskLevel,
            provenance: "repository-script",
          });
      return { commands, checks: commands.map((item) => item.label) };
    } catch {
      return { commands: [], checks: [] };
    }
  }
  createOverride(
    _workflowId: string,
    criterionId: string,
    reason: string,
    riskAcknowledgement: string,
    priorResult: string,
  ): OverrideRecord {
    return {
      id: crypto.randomUUID(),
      userId: "user",
      timestamp: new Date().toISOString(),
      criterionId,
      reason,
      riskAcknowledgement,
      priorResult: priorResult as OverrideRecord["priorResult"],
      resultingStatus: "overridden",
    };
  }
}
