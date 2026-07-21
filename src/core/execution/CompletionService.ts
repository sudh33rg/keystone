import type { DevelopmentWorkflowService } from "../workflows/DevelopmentWorkflowService";
import type { ExecutionPersistenceStore } from "../persistence/ExecutionPersistenceStore";
import type { IntelligenceSnapshotReader } from "../persistence/IntelligenceStore";
import type { TaskExecutionService } from "./TaskExecutionService";
import {
  CompletionDecisionSchema,
  OverrideAuditSchema,
  WorkflowCompletionReportSchema,
  type CompletionDecision,
  type WorkflowCompletionReport,
} from "../../shared/contracts/execution";
import { validationFingerprint } from "../validation/TaskValidationService";

export class CompletionDecisionService {
  constructor(
    private readonly persistence: ExecutionPersistenceStore,
    private readonly executions: TaskExecutionService,
    private readonly workflows: DevelopmentWorkflowService,
    private readonly snapshots: IntelligenceSnapshotReader,
  ) {}

  evaluate(sessionId: string): CompletionDecision {
    const session = this.executions.get(sessionId);
    if (!session) throw new Error("Execution session not found.");
    const run = this.persistence.snapshot.runs.find(
      (item) => item.id === session.validationRunIds.at(-1),
    );
    const plan = this.persistence.snapshot.plans.find(
      (item) => item.id === session.validationPlanId,
    );
    const workflow = this.workflows.get(session.workflowId);
    const task = workflow?.tasks.find((item) => item.id === session.taskId);
    const specification = workflow?.specification;
    const snapshot = this.snapshots.getSnapshot();
    const blockers: string[] = [];
    const warnings: string[] = [];
    if (!run) blockers.push("No validation run exists.");
    else {
      if (["running", "cancelled", "stale"].includes(run.status))
        blockers.push(`Validation run is ${run.status}.`);
      const required = new Set(
        plan?.steps.filter((item) => item.required).map((item) => item.id) ?? [],
      );
      for (const criterion of run.acceptanceCriteriaResults)
        if (!["passed", "overridden"].includes(criterion.status))
          blockers.push(`Criterion ${criterion.criterionId} is ${criterion.status}.`);
      if (
        run.stepResults.some(
          (item) =>
            required.has(item.stepId) &&
            ["failed", "cancelled", "skipped", "stale"].includes(item.status),
        )
      )
        blockers.push("A required validation step is not currently passed.");
      if (run.findings.some((item) => item.severity === "blocking" && !item.override))
        blockers.push("Blocking validation findings remain.");
      warnings.push(
        ...run.findings
          .filter((item) => ["warning", "informational", "error"].includes(item.severity))
          .filter((item) => item.severity !== "error" || Boolean(item.override))
          .map((item) => item.title),
      );
    }
    if (
      !task ||
      !specification ||
      task.specificationRevision !== specification.revision ||
      specification.status !== "approved"
    )
      blockers.push("Task/specification revision is not current and approved.");
    if (
      snapshot &&
      (snapshot.repository.branch !== specification?.branch ||
        snapshot.manifest.generation < (specification?.intelligenceGeneration ?? 0))
    )
      blockers.push("Repository state is stale or on another branch.");
    if (
      snapshot &&
      plan?.steps.some(
        (step) =>
          step.required &&
          validationFingerprint(snapshot, step.scopePaths) !== step.inputFingerprint,
      )
    )
      blockers.push(
        "Repository changed after validation in a required step scope; validation evidence is stale.",
      );
    if (
      session.observedChanges.some(
        (item) => ["unexpected", "ambiguous"].includes(item.classification) && !item.userOverride,
      )
    )
      blockers.push("Unexpected or ambiguous repository changes remain unresolved.");
    return CompletionDecisionSchema.parse({
      id: crypto.randomUUID(),
      taskId: session.taskId,
      executionSessionId: session.id,
      status: blockers.length ? "blocked" : "ready",
      blockers: unique(blockers),
      warnings: unique(warnings),
      decidedAt: new Date().toISOString(),
    });
  }

  async complete(
    sessionId: string,
    confirm: boolean,
    overrideReason?: string,
  ): Promise<{
    decision: CompletionDecision;
    unlockedTaskIds: string[];
    report?: WorkflowCompletionReport;
  }> {
    if (!confirm) throw new Error("Task completion requires explicit user confirmation.");
    const evaluated = this.evaluate(sessionId);
    const nonOverridable = evaluated.blockers.filter(
      (item) =>
        item === "No validation run exists." ||
        item.startsWith("Validation run is") ||
        item.startsWith("Task/specification") ||
        item.startsWith("Repository state") ||
        item.startsWith("Repository changed after validation"),
    );
    if (nonOverridable.length) throw new Error(`Completion blocked: ${nonOverridable.join(" ")}`);
    if (evaluated.blockers.length && !overrideReason?.trim())
      throw new Error(`Completion blocked: ${evaluated.blockers.join(" ")}`);
    const session = this.executions.get(sessionId)!;
    const now = new Date().toISOString();
    const status = overrideReason
      ? "accepted-with-override"
      : evaluated.warnings.length
        ? "completed-with-warnings"
        : "completed";
    const decision = CompletionDecisionSchema.parse({
      ...evaluated,
      status,
      ...(overrideReason ? { overrideReason } : {}),
      completedAt: now,
      decidedAt: now,
    });
    const completionAudit = overrideReason
      ? OverrideAuditSchema.parse({
          id: crypto.randomUUID(),
          executionSessionId: session.id,
          targetType: "completion",
          targetId: session.taskId,
          reason: overrideReason,
          userId: "user",
          priorStatus: "blocked",
          resultingStatus: "accepted-with-override",
          riskAcknowledgement:
            "The user explicitly accepted unresolved overridable completion blockers; non-overridable staleness and missing validation remain blocked.",
          createdAt: now,
        })
      : undefined;
    await this.persistence.update((state) => ({
      ...state,
      decisions: [
        ...state.decisions.filter((item) => item.taskId !== session.taskId),
        decision,
      ].slice(-500),
      overrides: completionAudit
        ? [...state.overrides, completionAudit].slice(-1000)
        : state.overrides,
    }));
    if (session.status !== "completed") {
      if (overrideReason && session.status !== "accepted-with-override")
        await this.executions.sessions.transition(sessionId, "accepted-with-override");
      await this.executions.sessions.transition(sessionId, "completed", {
        completedAt: now,
      });
    }
    await this.workflows.setTaskStatus(session.workflowId, session.taskId, "completed");
    const workflow = this.workflows.get(session.workflowId)!;
    const unlockedTaskIds: string[] = [];
    for (const task of workflow.tasks.filter(
      (item) =>
        item.status === "pending" &&
        item.dependencies.every(
          (id) => workflow.tasks.find((candidate) => candidate.id === id)?.status === "completed",
        ),
    )) {
      if (!task.staleReasons.length) {
        await this.workflows.setTaskStatus(workflow.id, task.id, "ready");
        unlockedTaskIds.push(task.id);
      }
    }
    const current = this.workflows.get(session.workflowId)!;
    const report = current.tasks.every((item) => item.status === "completed")
      ? await new WorkflowCompletionService(
          this.persistence,
          this.workflows,
          this.snapshots,
        ).create(current.id)
      : undefined;
    return {
      decision,
      unlockedTaskIds,
      ...(report ? { report } : {}),
    };
  }
}

export class TaskDependencyUnlockService {
  constructor(private readonly completion: CompletionDecisionService) {}
  complete(sessionId: string, overrideReason?: string) {
    return this.completion.complete(sessionId, true, overrideReason);
  }
}

export class WorkflowCompletionService {
  constructor(
    private readonly persistence: ExecutionPersistenceStore,
    private readonly workflows: DevelopmentWorkflowService,
    private readonly snapshots: IntelligenceSnapshotReader,
  ) {}

  get(workflowId: string): WorkflowCompletionReport | undefined {
    return this.persistence.snapshot.reports.find((item) => item.workflowId === workflowId);
  }

  async create(workflowId: string): Promise<WorkflowCompletionReport> {
    const workflow = this.workflows.get(workflowId);
    const specification = workflow?.specification;
    if (!workflow || !specification || workflow.tasks.some((item) => item.status !== "completed"))
      throw new Error(
        "All workflow tasks must be explicitly completed before reporting completion.",
      );
    const sessions = this.persistence.snapshot.sessions.filter(
      (item) => item.workflowId === workflowId,
    );
    const snapshot = this.snapshots.getSnapshot();
    const changed = sessions.flatMap((item) => item.changedEntities);
    const runs = this.persistence.snapshot.runs.filter((item) =>
      sessions.some((session) => session.validationRunIds.includes(item.id)),
    );
    const report = WorkflowCompletionReportSchema.parse({
      id: crypto.randomUUID(),
      workflowId,
      specificationId: specification.id,
      specificationRevision: specification.revision,
      taskIds: workflow.tasks.map((item) => item.id),
      completedTaskIds: workflow.tasks.map((item) => item.id),
      attempts: sessions.length,
      filesChanged: unique(
        sessions.flatMap((item) => item.observedChanges.map((change) => change.relativePath)),
      ),
      symbolsChanged: unique(
        changed
          .filter(
            (item) => item.changeKind.includes("symbol") || item.changeKind === "signature-change",
          )
          .map((item) => `${item.changeKind}: ${item.qualifiedName}`),
      ),
      apiChanges: unique(
        changed
          .filter((item) => ["route-change", "contract-change"].includes(item.changeKind))
          .map((item) => `${item.changeKind}: ${item.qualifiedName}`),
      ),
      dataChanges: unique(
        changed
          .filter((item) => item.changeKind === "schema-change")
          .map((item) => item.qualifiedName),
      ),
      testsChanged: unique(
        changed
          .filter((item) => item.changeKind === "test-change")
          .map((item) => item.qualifiedName),
      ),
      validationOutcomes: runs.flatMap((run) =>
        run.acceptanceCriteriaResults.map((item) => `${item.criterionId}: ${item.status}`),
      ),
      contextFingerprints: unique(
        sessions.flatMap((session) =>
          session.contextFingerprint ? [session.contextFingerprint] : [],
        ),
      ),
      promptFingerprints: unique(
        sessions.flatMap((session) =>
          session.promptFingerprint ? [session.promptFingerprint] : [],
        ),
      ),
      validationRunIds: runs.map((item) => item.id),
      overrides: this.persistence.snapshot.overrides
        .filter((item) => sessions.some((session) => session.id === item.executionSessionId))
        .map((item) => `${item.targetType}:${item.targetId}: ${item.reason}`),
      warnings: this.persistence.snapshot.decisions
        .filter((item) => workflow.tasks.some((task) => task.id === item.taskId))
        .flatMap((item) => item.warnings),
      branch: snapshot?.repository.branch ?? workflow.branch ?? "unknown",
      headCommit: snapshot?.repository.headCommit ?? workflow.headCommit ?? "unknown",
      intelligenceGeneration: snapshot?.manifest.generation ?? workflow.intelligenceGeneration,
      createdAt: new Date().toISOString(),
    });
    await this.persistence.update((state) => ({
      ...state,
      reports: [...state.reports.filter((item) => item.workflowId !== workflowId), report].slice(
        -100,
      ),
    }));
    return report;
  }
}

function unique(values: string[]): string[] {
  return [...new Set(values)].sort();
}
