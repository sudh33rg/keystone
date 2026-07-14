import type { GitAdapter } from "../../extension/adapters/GitAdapter";
import type { WorkspaceAdapter } from "../../extension/adapters/WorkspaceAdapter";
import {
  type Task,
  type ExternalChange,
  TaskSchema
} from "../../shared/contracts/domain";
import { KeystoneError } from "../../shared/errors/KeystoneError";

export class ExternalChangeDetector {
  private baselines = new Map<string, { timestamp: string; commitHash: string; files: Set<string> }>();

  constructor(
    private readonly git: GitAdapter,
    private readonly workspace: WorkspaceAdapter
  ) {}

  setBaseline(taskId: string, commitHash: string, files: string[]): void {
    this.baselines.set(taskId, {
      timestamp: new Date().toISOString(),
      commitHash,
      files: new Set(files)
    });
  }

  detectChanges(taskId: string): ExternalChange | undefined {
    const baseline = this.baselines.get(taskId);
    if (!baseline) return undefined;

    // Check for new commits
    const currentHead = this.git.getCurrentBranch();
    if (currentHead && currentHead !== baseline.commitHash) {
      return {
        taskId,
        detectedAt: new Date().toISOString(),
        type: "external-commit",
        severity: "high",
        details: `New commit detected: ${currentHead.slice(0, 8)}`,
        stale: true
      };
    }

    // Check for file changes
    const changedFiles = this.git.getChangedFiles();
    const changedSet = new Set(changedFiles.map(f => f.path));
    const impactedFiles = Array.from(baseline.files).filter(f => changedSet.has(f));

    if (impactedFiles.length > 0) {
      return {
        taskId,
        detectedAt: new Date().toISOString(),
        type: "file-change",
        severity: impactedFiles.length > 3 ? "high" : "medium",
        details: `${impactedFiles.length} tracked files changed`,
        impactedFiles,
        stale: true
      };
    }

    return undefined;
  }

  markResolved(taskId: string): void {
    const baseline = this.baselines.get(taskId);
    if (baseline) {
      this.setBaseline(taskId, baseline.commitHash, Array.from(baseline.files));
    }
  }

  clearBaseline(taskId: string): void {
    this.baselines.delete(taskId);
  }
}
