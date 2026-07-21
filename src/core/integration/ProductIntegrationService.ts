import { createHash } from "node:crypto";
import {
  OperationContextSchema,
  RepositoryStateRefSchema,
  StalenessRecordSchema,
  StartupStateSchema,
  type OperationContext,
  type RepositoryStateRef,
  type StalenessRecord,
  type StartupState,
} from "../../shared/contracts/integration";
import type { IntelligenceSnapshot } from "../../shared/contracts/intelligence";
import type {
  DevelopmentWorkflowSnapshot,
  RepositoryBaseline,
} from "../../shared/contracts/delegation";

export class RepositoryStateService {
  fromIntelligence(
    snapshot: IntelligenceSnapshot,
    input: { stagedPaths?: string[]; workingTreePaths?: string[] } = {},
  ): RepositoryStateRef {
    return RepositoryStateRefSchema.parse({
      repositoryId: snapshot.repository.id,
      rootPathIdentity: fingerprint(
        snapshot.repository.workspaceRoots.map((root) => root.id).sort(),
      ),
      ...(snapshot.repository.branch ? { branch: snapshot.repository.branch } : {}),
      ...(snapshot.repository.headCommit ? { head: snapshot.repository.headCommit } : {}),
      intelligenceGeneration: snapshot.manifest.generation,
      ...(input.stagedPaths
        ? { stagedFingerprint: fingerprint([...input.stagedPaths].sort()) }
        : {}),
      ...(input.workingTreePaths
        ? { workingTreeFingerprint: fingerprint([...input.workingTreePaths].sort()) }
        : {}),
      capturedAt: new Date().toISOString(),
    });
  }

  fromWorkflow(workflow: DevelopmentWorkflowSnapshot): RepositoryStateRef {
    return RepositoryStateRefSchema.parse({
      repositoryId: workflow.repositoryId,
      rootPathIdentity: fingerprint(workflow.repositoryId),
      ...(workflow.branch ? { branch: workflow.branch } : {}),
      ...(workflow.headCommit ? { head: workflow.headCommit } : {}),
      intelligenceGeneration: workflow.intelligenceGeneration,
      capturedAt: workflow.updatedAt,
    });
  }

  fromBaseline(baseline: RepositoryBaseline): RepositoryStateRef {
    return RepositoryStateRefSchema.parse({
      repositoryId: baseline.repositoryId,
      rootPathIdentity: fingerprint(baseline.repositoryId),
      branch: baseline.branch,
      head: baseline.headCommit,
      intelligenceGeneration: baseline.intelligenceGeneration,
      stagedFingerprint: fingerprint([...baseline.stagedFiles].sort()),
      workingTreeFingerprint: fingerprint(
        [...baseline.dirtyFiles, ...baseline.untrackedFiles].sort(),
      ),
      capturedAt: baseline.capturedAt,
    });
  }
}

export class StalenessService {
  compare(
    previous: RepositoryStateRef,
    current: RepositoryStateRef,
    affectedType: StalenessRecord["affectedType"],
    affectedId: string,
  ): StalenessRecord[] {
    const records: StalenessRecord[] = [];
    const add = (
      reason: StalenessRecord["reason"],
      before: string | number | undefined,
      after: string | number | undefined,
      safe: boolean,
      action: string,
    ): void => {
      if (before === after) return;
      records.push(
        StalenessRecordSchema.parse({
          id: crypto.randomUUID(),
          reason,
          ...(before !== undefined ? { previousFingerprint: String(before) } : {}),
          ...(after !== undefined ? { currentFingerprint: String(after) } : {}),
          affectedType,
          affectedId,
          automaticRegenerationSafe: safe,
          requiredUserAction: action,
          detectedAt: new Date().toISOString(),
        }),
      );
    };
    if (
      previous.repositoryId !== current.repositoryId ||
      previous.rootPathIdentity !== current.rootPathIdentity
    )
      add(
        "repository-unavailable",
        `${previous.repositoryId}:${previous.rootPathIdentity}`,
        `${current.repositoryId}:${current.rootPathIdentity}`,
        false,
        "Open the original repository or create a new workflow.",
      );
    add(
      "branch-changed",
      previous.branch,
      current.branch,
      false,
      "Return to the approved branch or review and rebase the workflow state.",
    );
    add(
      "head-changed",
      previous.head,
      current.head,
      false,
      "Review repository changes and rebuild affected context and validation.",
    );
    add(
      "intelligence-generation-changed",
      previous.intelligenceGeneration,
      current.intelligenceGeneration,
      true,
      "Re-run readiness and regenerate affected deterministic projections.",
    );
    add(
      "relevant-files-changed",
      previous.workingTreeFingerprint,
      current.workingTreeFingerprint,
      false,
      "Review changed files before delegation, completion, or delivery.",
    );
    add(
      "delivery-change-set-changed",
      previous.stagedFingerprint,
      current.stagedFingerprint,
      false,
      "Rebuild and approve the delivery change set.",
    );
    return records;
  }
}

export class OperationContextFactory {
  create(
    input: Partial<Pick<OperationContext, "repositoryId" | "workflowId" | "taskId">> = {},
  ): OperationContext {
    const id = crypto.randomUUID();
    return OperationContextSchema.parse({
      schemaVersion: 1,
      operationId: id,
      correlationId: id,
      ...input,
      startedAt: new Date().toISOString(),
    });
  }
  child(
    parent: OperationContext,
    input: Partial<Pick<OperationContext, "repositoryId" | "workflowId" | "taskId">> = {},
  ): OperationContext {
    return OperationContextSchema.parse({ ...parent, operationId: crypto.randomUUID(), ...input });
  }
}

export class StartupStateService {
  private readonly started = performance.now();
  private state: StartupState = StartupStateSchema.parse({
    schemaVersion: 1,
    stage: "extension-activated",
    status: "running",
    message: "Keystone Extension Host activated.",
    startedAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    durationMs: 0,
    diagnostics: [],
  });
  get snapshot(): StartupState {
    return structuredClone(this.state);
  }
  transition(
    stage: StartupState["stage"],
    status: StartupState["status"],
    message: string,
    diagnostics: StartupState["diagnostics"] = this.state.diagnostics,
  ): StartupState {
    this.state = StartupStateSchema.parse({
      ...this.state,
      stage,
      status,
      message,
      updatedAt: new Date().toISOString(),
      durationMs: performance.now() - this.started,
      diagnostics: diagnostics.slice(-100),
    });
    return this.snapshot;
  }
  diagnose(input: Omit<StartupState["diagnostics"][number], "id">): StartupState {
    return this.transition("degraded", "degraded", input.message, [
      ...this.state.diagnostics,
      { id: crypto.randomUUID(), ...input },
    ]);
  }
}

function fingerprint(value: unknown): string {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}
