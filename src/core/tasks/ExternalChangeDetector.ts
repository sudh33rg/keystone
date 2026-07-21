import type { GitAdapter } from "../../extension/adapters/GitAdapter";
import type { WorkspaceAdapter } from "../../extension/adapters/WorkspaceAdapter";
import { type ExternalChange } from "../../shared/contracts/domain";

export class ExternalChangeDetector {
  private baselines = new Map<
    string,
    { timestamp: string; commitHash: string; branch: string; files: Set<string> }
  >();

  constructor(
    private readonly git: GitAdapter,
    private readonly workspace: WorkspaceAdapter,
  ) {}

  setBaseline(taskId: string, commitHash: string, branch: string, files: string[]): void {
    this.baselines.set(taskId, {
      timestamp: new Date().toISOString(),
      commitHash,
      branch,
      files: new Set(files),
    });
  }

  async detectChanges(taskId: string, branch?: string): Promise<ExternalChange | undefined> {
    const baseline = this.baselines.get(taskId);
    if (!baseline) return undefined;

    // Use provided branch or get current branch
    const rootUri = this.workspace.getRoots()[0]?.uri;
    if (!rootUri) return undefined;
    const currentBranch = branch ?? this.git.getCurrentBranch(rootUri);
    if (currentBranch && currentBranch !== baseline.branch) {
      return {
        taskId,
        detectedAt: new Date().toISOString(),
        type: "branch-switch",
        severity: "high",
        details: `Switched from ${baseline.branch} to ${currentBranch}`,
        stale: true,
      };
    }

    // Check for new commits on the same branch
    const currentHead = this.git.getHeadCommit(rootUri);
    if (currentHead && currentHead !== baseline.commitHash) {
      return {
        taskId,
        detectedAt: new Date().toISOString(),
        type: "external-commit",
        severity: "high",
        details: `New commit detected on ${currentBranch}: ${currentHead.slice(0, 8)}`,
        stale: true,
      };
    }

    // Check for file changes
    const changedFiles = await this.git.getChangedFiles(rootUri);
    const changedSet = new Set(changedFiles);
    const impactedFiles = Array.from(baseline.files).filter((f) => changedSet.has(f));

    if (impactedFiles.length > 0) {
      return {
        taskId,
        detectedAt: new Date().toISOString(),
        type: "file-change",
        severity: impactedFiles.length > 3 ? "high" : "medium",
        details: `${impactedFiles.length} tracked files changed`,
        impactedFiles,
        stale: true,
      };
    }

    return undefined;
  }

  markResolved(taskId: string): void {
    const baseline = this.baselines.get(taskId);
    if (baseline) {
      const rootUri = this.workspace.getRoots()[0]?.uri;
      if (!rootUri) return;
      const currentBranch = this.git.getCurrentBranch(rootUri);
      const currentHead = this.git.getHeadCommit(rootUri);
      this.setBaseline(
        taskId,
        currentHead ?? baseline.commitHash,
        currentBranch ?? baseline.branch,
        Array.from(baseline.files),
      );
    }
  }

  clearBaseline(taskId: string): void {
    this.baselines.delete(taskId);
  }
}
