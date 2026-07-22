import { createHash, randomUUID } from "node:crypto";
import { canonicalWorkTypeLabel, type CanonicalWorkflowWorkType } from "../../shared/contracts/canonicalWorkflow";
import type { DevelopmentPromptPreparation } from "../../shared/contracts/development";
import type { DevelopmentExecutionProfile, ExecutionCapability, InstructionPreview, ManualAgentConfiguration, SkillDefinition } from "../../shared/contracts/executionConfiguration";

interface PromptScope { id: string; kind: "file" | "symbol"; workspaceRelativePath: string; symbol?: { entityId: string; name: string; kind: string }; }
export interface DevelopmentPromptInput {
  workflowId: string; workItemId: string; intent: string; workType: CanonicalWorkflowWorkType; specification?: string; objective: string;
  objectiveRevision: number; specificationRevision?: number; repositoryName: string; notes?: string; scope: PromptScope[];
  execution?: { profile: DevelopmentExecutionProfile; capability: ExecutionCapability; skill: SkillDefinition; instructions: InstructionPreview[]; agent?: ManualAgentConfiguration };
}

export class DevelopmentPromptService {
  constructor(private readonly now: () => string = () => new Date().toISOString(), private readonly createId: () => string = randomUUID) {}
  prepare(input: DevelopmentPromptInput): DevelopmentPromptPreparation {
    const scope = input.scope.map((item) => item.kind === "symbol" && item.symbol ? `- ${item.symbol.name} (${item.symbol.kind}) — ${item.workspaceRelativePath}` : `- ${item.workspaceRelativePath}`).join("\n") || "- No source scope selected.";
    const execution = input.execution;
    const instructionSections = execution?.instructions.flatMap((item) => ["", `### ${item.name}`, `Path: ${item.workspaceRelativePath}`, item.content]) ?? [];
    const executionNote = execution ? execution.capability.kind === "manual-work"
      ? "This work is configured for manual execution. Keystone does not claim agent execution."
      : execution.capability.kind === "chat-command-handoff"
        ? `This prompt is being prepared for the registered chat command ${execution.capability.commandId}. Keystone does not claim control over external execution.`
        : "This prompt is being prepared for clipboard handoff. Keystone does not claim control over external execution." : "Keystone does not claim control over external execution.";
    const content = [
      "Keystone Development Work Item", "", `Repository: ${input.repositoryName}`, "", `## Intent\n${input.intent}`, "", `## Work type\n${canonicalWorkTypeLabel(input.workType)}`, "", `## Objective\n${input.objective}`,
      "", `## Specification\n${input.specification ?? "No specification was provided."}`, "", `## Selected source scope\n${scope}`,
      ...(input.notes?.trim() ? ["", `User notes:\n${input.notes.trim()}`] : []),
      ...(execution ? ["", `## Development skill\n${execution.skill.name}\n${execution.skill.promptFragment}`, "", "## Repository and project instructions", ...instructionSections, "", `## Execution note\n${executionNote}`, ...(execution.agent ? ["", `Manual agent label: ${execution.agent.displayName}`, "This agent is manually configured. Execution depends on the selected handoff mode."] : [])] : []),
      "", "## Required result", "Report:", "1. Summary of work completed", "2. Files changed", "3. Main implementation decisions", "4. Assumptions", "5. Tests actually run", "6. Unresolved issues",
      "", "## Constraints", "- Do not modify unrelated files.", "- Do not perform Git commit, push, merge, or PR operations.", "- Ask for clarification when the selected scope is insufficient.",
    ].join("\n");
    return { id: this.createId(), workflowId: input.workflowId, workItemId: input.workItemId, content, contentHash: createHash("sha256").update(content).digest("hex"), sourceScopeIds: input.scope.map((item) => item.id), objectiveRevision: input.objectiveRevision, ...(input.specificationRevision ? { specificationRevision: input.specificationRevision } : {}), ...(execution ? { executionProfileId: execution.profile.id, executionProfileHash: execution.profile.contentHash } : {}), status: "prepared", createdAt: this.now() };
  }
}
