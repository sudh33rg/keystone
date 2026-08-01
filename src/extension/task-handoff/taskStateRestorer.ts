import type * as vscode from "vscode";
import { MANUAL_SYNC_CONFIRMATION, type RepositoryReference, type TaskStatePackage } from "@core/workflow/handoff/contracts";
import { migrateTaskStatePackage, verifyTaskStatePackage } from "@core/workflow/handoff/taskStatePackage";

export interface RestoredTaskStateStore { save(packageValue: TaskStatePackage): Promise<void>; }
export interface RestorationPreview { packageValue: TaskStatePackage; warnings: string[]; continuationBriefing: string; }
export class TaskStateRestorer {
  constructor(private readonly store: RestoredTaskStateStore) {}
  preview(value: TaskStatePackage, workspace?: { name?: string; path?: string }): RestorationPreview {
    verifyTaskStatePackage(value); const packageValue = migrateTaskStatePackage(value); const warnings = compareRepositoryGuidance(packageValue.repositoryReference, workspace);
    return { packageValue, warnings, continuationBriefing: continuationBriefing(packageValue) };
  }
  async restore(preview: RestorationPreview, confirmation: string): Promise<void> {
    if (confirmation !== MANUAL_SYNC_CONFIRMATION) throw new Error("Manual Repository Sync Required: confirm that you opened and synchronized the expected repository and branch.");
    // Metadata only. This deliberately contains no filesystem, terminal, or Git operation.
    await this.store.save(preview.packageValue);
  }
}
export function compareRepositoryGuidance(expected: RepositoryReference, workspace?: { name?: string; path?: string }): string[] {
  if (!workspace) return ["No VS Code workspace is open. Open the expected repository before restoring."];
  const actual = (workspace.name ?? workspace.path?.split(/[\\/]/).pop() ?? "").toLowerCase();
  return actual && actual !== expected.repositoryName.toLowerCase() ? [`Open workspace “${workspace.name ?? workspace.path}” appears different from expected repository “${expected.repositoryName}”. This warning does not block inspection.`] : [];
}
export function continuationBriefing(p: TaskStatePackage): string { return [
  ["Task", p.task.normalizedProblemStatement], ["Business objective", p.task.businessGoal], ["Current implementation phase", p.plan.currentPhase ?? "Not recorded"],
  ["Completed work", p.progress.completedWorkSummary.join("; ") || "None recorded"], ["Current work", p.progress.currentActivity ?? "Not recorded"], ["Pending work", p.plan.pendingTasks.join("; ") || "None recorded"],
  ["Expected repository", p.repositoryReference.repositoryName], ["Expected branch", p.repositoryReference.expectedBranch ?? "Not recorded"], ["Expected commit", p.repositoryReference.expectedCommit ?? "Not recorded"],
  ["Relevant files", p.context.relevantFiles.join(", ") || "None recorded"], ["Relevant symbols", p.context.relevantSymbols.join(", ") || "None recorded"],
  ["Tests passing", p.quality.testsReportedPassing.join("; ") || "None reported"], ["Tests failing", p.quality.testsReportedFailing.join("; ") || "None reported"],
  ["Security findings", p.quality.securityFindings.join("; ") || "None reported"], ["Performance findings", p.quality.performanceFindings.join("; ") || "None reported"],
  ["Open decisions", p.decisions.unresolvedQuestions.join("; ") || "None recorded"], ["Known risks", p.decisions.risks.join("; ") || "None recorded"], ["Current blockers", p.progress.blockers.join("; ") || "None recorded"],
  ["Exact next action", p.continuation.exactNextRecommendedAction], ["Recommended first prompt", p.continuation.suggestedFirstPrompt]
].map(([label, value]) => `${label}:\n${value}`).join("\n\n"); }

export class WorkspaceStateTaskStore implements RestoredTaskStateStore {
  constructor(private readonly context: vscode.ExtensionContext) {}
  async save(value: TaskStatePackage) { await this.context.workspaceState.update(`task-handoff.task.${value.taskId}`, value); await this.context.workspaceState.update("task-handoff.active-task-id", value.taskId); }
}
