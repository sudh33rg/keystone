import { createHash } from "node:crypto";
import type { DevelopmentWorkflowService } from "../workflows/DevelopmentWorkflowService";
import type { ExecutionPersistenceStore } from "../persistence/ExecutionPersistenceStore";
import type { ReviewPersistenceStore } from "../persistence/ReviewPersistenceStore";
import type { RepositoryReadService } from "../repository/RepositoryReadService";
import {
  CompletionStateSchema,
  FindingDispositionSchema,
  ReviewDecisionSchema,
  ReviewNoteSchema,
  WorkflowCompletionRecordSchema,
  WorkflowReviewStateSchema,
  type CompletionMode,
  type CompletionState,
  type FindingDisposition,
  type ReviewChange,
  type ReviewDecision,
  type ReviewNote,
  type WorkflowCompletionRecord,
  type WorkflowReviewState,
} from "../../shared/contracts/review";
import type { ValidationFinding, ValidationRunV2 } from "../../shared/contracts/execution";
import type { DevelopmentTask } from "../../shared/contracts/delegation";

/**
 * Read-only RepositoryCapabilities surface.
 *
 * Keystone enforces a permanent local-first boundary: it may inspect repository
 * state (status, branch, revision, diffs, history, identity) but it can NEVER
 * stage, commit, push, change branches, or perform remote PR actions. This
 * service therefore reports only that mutation is unavailable.
 */
interface RepositoryCapabilities {
  schemaVersion: 1;
  repositoryRoot: string;
  repositoryDetected: boolean;
  readOnly: true;
  diagnostics: ReadonlyArray<{ code: string; severity: "info" | "warning"; message: string }>;
  refreshedAt: string;
}

export class ReviewCompletionService {
  constructor(
    private readonly store: ReviewPersistenceStore,
    private readonly workflows: DevelopmentWorkflowService,
    private readonly executions: ExecutionPersistenceStore,
    private readonly repository: RepositoryReadService,
  ) {}

  initialize(): Promise<unknown> {
    return this.store.initialize();
  }

  get persisted() {
    return this.store.snapshot;
  }

  getState(workflowId: string): WorkflowReviewState {
    const workflow = this.requireWorkflow(workflowId);
    const specification = workflow.specification;
    if (!specification) throw new Error("Review requires an approved specification.");
    const snapshot = this.workflows.getCurrentSnapshot();
    const repositoryFingerprint = fingerprint({
      repositoryId: snapshot?.repository.id ?? workflow.repositoryId,
      branch: snapshot?.repository.branch,
      headCommit: snapshot?.repository.headCommit,
      generation: snapshot?.manifest.generation ?? workflow.intelligenceGeneration,
    });
    const sessions = this.executions.snapshot.sessions.filter(
      (item) => item.workflowId === workflowId,
    );
    const runIds = new Set(sessions.flatMap((item) => item.validationRunIds));
    const runs = this.executions.snapshot.runs.filter((item) => runIds.has(item.id));
    const latestRuns = latestRunByTask(runs);
    const persisted = this.store.snapshot;
    const notes = persisted.notes.filter((item) => item.workflowId === workflowId);
    const dispositions = persisted.dispositions.filter((item) => item.workflowId === workflowId);
    const currentDecision = persisted.decisions
      .filter((item) => item.workflowId === workflowId)
      .at(-1);
    const decision =
      currentDecision &&
      (currentDecision.repositoryFingerprint !== repositoryFingerprint ||
        currentDecision.specificationRevision !== specification.revision)
        ? ReviewDecisionSchema.parse({ ...currentDecision, status: "stale" })
        : currentDecision;
    const changes = projectChanges(workflow.tasks, sessions);
    const findings = runs
      .flatMap((run) => run.findings)
      .map((finding) => projectFinding(finding, dispositions));
    const traceability = [
      ...specification.requirements.map((requirement) => {
        const tasks = workflow.tasks.filter((task) => task.requirementIds.includes(requirement.id));
        return traceItem(
          requirement.id,
          "requirement" as const,
          requirement.description,
          tasks,
          sessions,
          latestRuns,
        );
      }),
      ...specification.acceptanceCriteria.map((criterion) => {
        const tasks = workflow.tasks.filter((task) =>
          task.acceptanceCriterionIds.includes(criterion.id),
        );
        return traceItem(
          criterion.id,
          "acceptance-criterion" as const,
          criterion.description,
          tasks,
          sessions,
          latestRuns,
          criterion.required || criterion.blocking,
        );
      }),
    ];
    const requiredTasks = workflow.tasks.filter((task) => !task.optional);
    const incomplete = requiredTasks.filter((task) => task.status !== "completed");
    const failedRuns = [...latestRuns.values()].filter((run) => run.status !== "passed");
    const missingRuns = requiredTasks.filter((task) => !latestRuns.has(task.id));
    const unresolvedBlockingFindings = findings.filter(
      ({ finding, disposition }) =>
        finding.severity === "blocking" &&
        !["fixed", "accepted-risk", "false-positive", "verified", "accepted"].includes(
          disposition?.disposition ?? "",
        ),
    );
    const unexpected = changes.filter((item) =>
      ["unexpected", "ambiguous", "concurrent"].includes(item.classification),
    );
    const blockingNotes = notes.filter((note) => note.blocking && !note.resolvedAt);
    const blockingCriterionIds = new Set(
      specification.acceptanceCriteria
        .filter((item) => item.required || item.blocking)
        .map((item) => item.id),
    );
    const traceabilityBlockers = traceability.filter(
      (item) =>
        item.kind === "acceptance-criterion" &&
        blockingCriterionIds.has(item.id) &&
        ["failed", "not-evaluated", "stale"].includes(item.status),
    );
    const blockers = [
      ...incomplete.map((task) => `Required task is incomplete: ${task.title}.`),
      ...missingRuns.map((task) => `Validation evidence is missing for ${task.title}.`),
      ...failedRuns.map((run) => `Validation for task ${run.taskId} is ${run.status}.`),
      ...traceabilityBlockers.map((item) => `Acceptance criterion ${item.id} is ${item.status}.`),
      ...unresolvedBlockingFindings.map(
        (item) => `Blocking ${item.source} finding: ${item.finding.title}.`,
      ),
      ...unexpected.map(
        (item) => `${item.classification} change requires disposition: ${item.path}.`,
      ),
      ...blockingNotes.map((note) => `Blocking review note remains unresolved: ${note.text}.`),
    ].slice(0, 500);
    const warnings = findings
      .filter((item) => item.finding.severity === "warning")
      .map((item) => `${item.source}: ${item.finding.title}`)
      .slice(0, 500);
    const approved =
      decision?.status === "approved" || decision?.status === "approved-with-warnings";
    const status =
      decision?.status === "stale"
        ? "stale"
        : decision?.status === "changes-requested"
          ? "changes-requested"
          : approved
            ? decision.status
            : blockers.length
              ? "blocked"
              : "ready-for-review";
    return WorkflowReviewStateSchema.parse({
      schemaVersion: 1,
      workflow,
      summary: {
        workflowId,
        title: specification.title,
        workType: workflow.intent.workType ?? workflow.intent.category,
        specificationRevision: specification.revision,
        repositoryId: workflow.repositoryId,
        ...(snapshot?.repository.branch ? { branch: snapshot.repository.branch } : {}),
        ...(snapshot?.repository.headCommit ? { headCommit: snapshot.repository.headCommit } : {}),
        intelligenceGeneration: snapshot?.manifest.generation ?? workflow.intelligenceGeneration,
        tasksCompleted: workflow.tasks.filter((task) => task.status === "completed").length,
        tasksIncomplete: workflow.tasks.filter((task) => task.status !== "completed").length,
        validationPassed: runs.filter((run) => run.status === "passed").length,
        validationFailed: runs.filter((run) => run.status === "failed").length,
        blockingFindings: unresolvedBlockingFindings.length,
        warnings: warnings.length,
        unexpectedChanges: unexpected.length,
        status,
        completionReady: approved && blockers.length === 0,
      },
      traceability,
      changes,
      findings,
      notes,
      checklist: checklist(blockers, changes, findings, notes, requiredTasks, latestRuns),
      readinessBlockers: blockers,
      warnings,
      decision,
      repositoryFingerprint,
      generatedAt: new Date().toISOString(),
    });
  }

  async addNote(input: {
    workflowId: string;
    targetType: ReviewNote["targetType"];
    targetId: string;
    type: ReviewNote["type"];
    text: string;
    blocking: boolean;
  }): Promise<ReviewNote> {
    this.requireWorkflow(input.workflowId);
    const now = new Date().toISOString();
    const note = ReviewNoteSchema.parse({
      schemaVersion: 1,
      id: crypto.randomUUID(),
      ...input,
      author: "user",
      createdAt: now,
      updatedAt: now,
    });
    await this.store.update((state) => ({ ...state, notes: [...state.notes, note].slice(-5000) }));
    return note;
  }

  async updateNote(
    workflowId: string,
    noteId: string,
    text: string,
    blocking: boolean,
  ): Promise<ReviewNote> {
    const note = this.requireNote(workflowId, noteId);
    const value = ReviewNoteSchema.parse({
      ...note,
      text,
      blocking,
      updatedAt: new Date().toISOString(),
    });
    await this.store.update((state) => ({
      ...state,
      notes: state.notes.map((item) => (item.id === noteId ? value : item)),
    }));
    return value;
  }

  async resolveNote(workflowId: string, noteId: string, resolution: string): Promise<ReviewNote> {
    const note = this.requireNote(workflowId, noteId);
    const now = new Date().toISOString();
    const value = ReviewNoteSchema.parse({ ...note, resolution, resolvedAt: now, updatedAt: now });
    await this.store.update((state) => ({
      ...state,
      notes: state.notes.map((item) => (item.id === noteId ? value : item)),
    }));
    return value;
  }

  async disposition(
    workflowId: string,
    findingId: string,
    disposition: FindingDisposition["disposition"],
    reason: string,
    scope: string,
  ): Promise<FindingDisposition> {
    const finding = this.getState(workflowId).findings.find(
      (item) => item.finding.id === findingId,
    );
    if (!finding) throw new Error("Review finding was not found.");
    const value = FindingDispositionSchema.parse({
      id: crypto.randomUUID(),
      workflowId,
      findingId,
      disposition,
      reason,
      scope,
      approvedBy: "user",
      decidedAt: new Date().toISOString(),
    });
    await this.store.update((state) => ({
      ...state,
      dispositions: [
        ...state.dispositions.filter((item) => item.findingId !== findingId),
        value,
      ].slice(-5000),
    }));
    return value;
  }

  async requestChanges(input: {
    workflowId: string;
    targetType: string;
    targetId: string;
    requestedChange: string;
    action: string;
  }): Promise<ReviewDecision> {
    const workflow = this.requireWorkflow(input.workflowId);
    if (input.action === "reopen-task" || input.action === "repair-task") {
      const task = workflow.tasks.find((item) => item.id === input.targetId);
      if (!task) throw new Error("The affected task was not found.");
      await this.workflows.setTaskStatus(workflow.id, task.id, "ready", input.requestedChange);
    }
    const state = this.getState(workflow.id);
    return this.saveDecision(state, "changes-requested", input.requestedChange);
  }

  async createFollowUp(input: {
    workflowId: string;
    title: string;
    objective: string;
    relatedRequirementIds: string[];
    relatedFilePaths: string[];
    blocking: boolean;
  }) {
    const workflow = this.requireWorkflow(input.workflowId);
    if (!workflow.taskGraph) throw new Error("The workflow task plan is unavailable.");
    const criteria = workflow
      .specification!.acceptanceCriteria.filter((item) =>
        input.relatedRequirementIds.some((id) => item.requirementIds.includes(id)),
      )
      .map((item) => item.id)
      .slice(0, 100);
    return this.workflows.addTask(workflow.id, workflow.taskGraph.revision, {
      title: input.title,
      objective: input.objective,
      description: input.objective,
      category: "implementation",
      requirementIds: input.relatedRequirementIds.length
        ? input.relatedRequirementIds
        : workflow.specification!.requirements.slice(0, 1).map((item) => item.id),
      acceptanceCriterionIds: criteria.length
        ? criteria
        : workflow.specification!.acceptanceCriteria.slice(0, 1).map((item) => item.id),
      expectedFiles: input.relatedFilePaths,
      expectedEntityIds: [],
      validationSteps: [{ manualCheck: "Verify the follow-up against its linked review note." }],
      executionRoute: "manual",
      risk: "medium",
      optional: !input.blocking,
    });
  }

  async approve(workflowId: string, reason: string, withWarnings = false): Promise<ReviewDecision> {
    const state = this.getState(workflowId);
    if (state.readinessBlockers.length)
      throw new Error(`Review approval is blocked: ${state.readinessBlockers.join(" ")}`);
    return this.saveDecision(state, withWarnings ? "approved-with-warnings" : "approved", reason);
  }

  async reject(workflowId: string, reason: string): Promise<ReviewDecision> {
    return this.saveDecision(this.getState(workflowId), "rejected", reason);
  }

  async complete(
    workflowId: string,
    mode: CompletionMode,
    reason: string,
  ): Promise<WorkflowCompletionRecord> {
    const state = this.getState(workflowId);
    const partial =
      mode === "closed-partial" || mode === "cancelled-with-changes" || mode === "handed-off";
    if (!partial && !state.summary.completionReady)
      throw new Error("Completion requires a current approved Review with no blocking findings.");
    const workflow = state.workflow;
    const completed = workflow.tasks
      .filter((task) => task.status === "completed")
      .map((task) => task.id);
    const incomplete = workflow.tasks
      .filter((task) => task.status !== "completed")
      .map((task) => task.id);
    if (partial && !incomplete.length)
      throw new Error("Partial or retained-change closure requires explicit unfinished work.");
    const report = completionReport(state, mode, reason);
    const value = WorkflowCompletionRecordSchema.parse({
      schemaVersion: 1,
      id: crypto.randomUUID(),
      workflowId,
      specificationRevision: workflow.specification!.revision,
      mode,
      status:
        mode === "closed-partial"
          ? "closed-partial"
          : mode === "handed-off"
            ? "handed-off"
            : mode === "cancelled-with-changes"
              ? "cancelled-with-changes"
              : "completed",
      completedTaskIds: completed,
      incompleteTaskIds: incomplete,
      ...(state.decision ? { reviewDecisionId: state.decision.id } : {}),
      validationSummary: [
        `${state.summary.validationPassed} passed; ${state.summary.validationFailed} failed validation runs.`,
      ],
      acceptanceCriteria: state.traceability
        .filter((item) => item.kind === "acceptance-criterion")
        .map((item) => `${item.id}: ${item.status}`),
      qaDecision: state.readinessBlockers.some((item) => /validation|test|QA/i.test(item))
        ? "blocked"
        : state.warnings.length
          ? "accept-with-warnings"
          : "accept",
      securityDisposition: dispositionSummary(state, "security"),
      performanceDisposition: dispositionSummary(state, "performance"),
      documentationDisposition: dispositionSummary(state, "documentation"),
      commitHashes: [],
      handoffPackageIds: [],
      remainingWarnings: [...state.warnings, ...(partial ? [reason] : [])],
      repositoryFingerprint: state.repositoryFingerprint,
      report,
      confirmedBy: "user",
      completedAt: new Date().toISOString(),
    });
    await this.store.update((persistent) => ({
      ...persistent,
      completions: [
        ...persistent.completions.filter((item) => item.workflowId !== workflowId),
        value,
      ].slice(-500),
    }));
    return value;
  }

  async archive(workflowId: string): Promise<WorkflowCompletionRecord> {
    const current = this.store.snapshot.completions.find((item) => item.workflowId === workflowId);
    if (!current) throw new Error("Complete the workflow before archiving it.");
    const value = WorkflowCompletionRecordSchema.parse({ ...current, status: "archived" });
    await this.store.update((state) => ({
      ...state,
      completions: state.completions.map((item) => (item.id === value.id ? value : item)),
      archivedWorkflowIds: [...new Set([...state.archivedWorkflowIds, workflowId])].slice(-500),
    }));
    return value;
  }

  async getCompletionState(workflowId: string): Promise<CompletionState> {
    const review = this.getState(workflowId);
    const capabilities = await this.repositoryCapabilities();
    const completion = this.store.snapshot.completions.find(
      (item) => item.workflowId === workflowId,
    );
    return CompletionStateSchema.parse({
      schemaVersion: 1,
      review,
      options: completionOptions(review, capabilities),
      ...(completion ? { completion } : {}),
    });
  }

  /**
   * Build a read-only repository capabilities report.
   *
   * Keystone can inspect repository state but cannot perform Git mutations or
   * remote/PR actions, so this always reports `readOnly: true` and enumerates
   * only the inspection operations that are permitted.
   */
  private async repositoryCapabilities(): Promise<RepositoryCapabilities> {
    try {
      const status = await this.repository.getStatus();
      return {
        schemaVersion: 1,
        repositoryRoot: this.repositoryRoot(),
        repositoryDetected: status.repositoryDetected,
        readOnly: true,
        diagnostics: [],
        refreshedAt: new Date().toISOString(),
      };
    } catch {
      return {
        schemaVersion: 1,
        repositoryRoot: this.repositoryRoot(),
        repositoryDetected: false,
        readOnly: true,
        diagnostics: [
          {
            code: "git-read-only-unavailable",
            severity: "warning",
            message: "Read-only Git inspection is unavailable; local completion remains available.",
          },
        ],
        refreshedAt: new Date().toISOString(),
      };
    }
  }

  private repositoryRoot(): string {
    return (this.repository as unknown as { root?: string }).root ?? process.cwd();
  }

  private async saveDecision(
    state: WorkflowReviewState,
    status: ReviewDecision["status"],
    reason: string,
  ): Promise<ReviewDecision> {
    const value = ReviewDecisionSchema.parse({
      schemaVersion: 1,
      id: crypto.randomUUID(),
      workflowId: state.workflow.id,
      specificationRevision: state.workflow.specification!.revision,
      repositoryFingerprint: state.repositoryFingerprint,
      ...(state.summary.branch ? { branch: state.summary.branch } : {}),
      ...(state.summary.headCommit ? { headCommit: state.summary.headCommit } : {}),
      intelligenceGeneration: state.summary.intelligenceGeneration,
      status,
      findings: state.findings.map((item) => item.finding.id),
      warnings: state.warnings,
      noteIds: state.notes.map((item) => item.id),
      reason,
      decidedBy: "user",
      decidedAt: new Date().toISOString(),
    });
    await this.store.update((persistent) => ({
      ...persistent,
      decisions: [...persistent.decisions, value].slice(-500),
    }));
    return value;
  }

  private requireWorkflow(workflowId: string) {
    const workflow = this.workflows.get(workflowId);
    if (!workflow) throw new Error("Workflow not found.");
    return workflow;
  }

  private requireNote(workflowId: string, noteId: string) {
    const note = this.store.snapshot.notes.find(
      (item) => item.workflowId === workflowId && item.id === noteId,
    );
    if (!note) throw new Error("Review note was not found.");
    return note;
  }
}

function latestRunByTask(runs: ValidationRunV2[]): Map<string, ValidationRunV2> {
  return new Map(runs.map((run) => [run.taskId, run]));
}

function traceItem(
  id: string,
  kind: "requirement" | "acceptance-criterion",
  description: string,
  tasks: DevelopmentTask[],
  sessions: ReturnType<ExecutionPersistenceStore["snapshot"]["sessions"]["filter"]>,
  runs: Map<string, ValidationRunV2>,
  blocking = true,
) {
  const relatedSessions = sessions.filter((session) =>
    tasks.some((task) => task.id === session.taskId),
  );
  const criterionResults = [...runs.values()]
    .flatMap((run) => run.acceptanceCriteriaResults)
    .filter((result) => result.criterionId === id);
  const evidence = criterionResults.flatMap((result) => result.evidenceIds);
  const taskComplete = tasks.length > 0 && tasks.every((task) => task.status === "completed");
  const failed = criterionResults.some((result) => result.status === "failed");
  const passed = criterionResults.some((result) =>
    ["passed", "overridden"].includes(result.status),
  );
  const status = failed
    ? "failed"
    : taskComplete && passed
      ? "satisfied"
      : taskComplete && evidence.length
        ? "partially-satisfied"
        : taskComplete
          ? "manual-review-required"
          : runs.size
            ? "not-evaluated"
            : "not-evaluated";
  return {
    id,
    kind,
    description,
    taskIds: tasks.map((task) => task.id),
    changedFiles: [
      ...new Set(
        relatedSessions.flatMap((session) =>
          session.observedChanges.map((change) => change.relativePath),
        ),
      ),
    ],
    changedEntityIds: [
      ...new Set(
        relatedSessions.flatMap((session) =>
          session.changedEntities.map((entity) => entity.entityId),
        ),
      ),
    ],
    validationEvidenceIds: evidence,
    qaEvidence: criterionResults.map((result) => result.explanation),
    status,
    ...(blocking && status !== "satisfied"
      ? { openConcern: "Required evidence is incomplete or requires explicit review." }
      : {}),
  };
}

function projectChanges(
  tasks: DevelopmentTask[],
  sessions: ReturnType<ExecutionPersistenceStore["snapshot"]["sessions"]["filter"]>,
): ReviewChange[] {
  const byPath = new Map<string, ReviewChange>();
  for (const session of sessions)
    for (const change of session.observedChanges) {
      const relatedTasks = tasks.filter(
        (task) => task.id === session.taskId || task.expectedFiles.includes(change.relativePath),
      );
      const entities = session.changedEntities.filter(
        (item) => item.relativePath === change.relativePath,
      );
      byPath.set(change.relativePath, {
        path: change.relativePath,
        ...(change.originalPath ? { previousPath: change.originalPath } : {}),
        kind: change.kind,
        classification: change.userOverride?.classification ?? change.classification,
        taskIds: relatedTasks.map((task) => task.id),
        requirementIds: [...new Set(relatedTasks.flatMap((task) => task.requirementIds))],
        criterionIds: [...new Set(relatedTasks.flatMap((task) => task.acceptanceCriterionIds))],
        changedSymbols: entities.map((item) => item.qualifiedName),
        riskIndicators: [...new Set(entities.flatMap((item) => item.limitations))].slice(0, 100),
      });
    }
  return [...byPath.values()].slice(0, 5000);
}

function projectFinding(finding: ValidationFinding, dispositions: FindingDisposition[]) {
  const source =
    finding.category === "security"
      ? "security"
      : finding.category === "performance"
        ? "performance"
        : finding.category === "documentation"
          ? "documentation"
          : "qa";
  return {
    finding,
    source,
    evidence: finding.evidenceIds,
    staticOrMeasured: finding.category === "performance" ? "static" : "unknown",
    limitation:
      finding.details?.limitations?.join(" ") ||
      "The finding is bounded to retained validation evidence; it is not a certification.",
    ...(dispositions.find((item) => item.findingId === finding.id)
      ? { disposition: dispositions.find((item) => item.findingId === finding.id) }
      : {}),
  };
}

function checklist(
  blockers: string[],
  changes: ReviewChange[],
  findings: ReturnType<typeof projectFinding>[],
  notes: ReviewNote[],
  tasks: DevelopmentTask[],
  runs: Map<string, ValidationRunV2>,
) {
  const item = (id: string, label: string, passed: boolean, explanation: string) => ({
    id,
    label,
    passed,
    blocking: true,
    explanation,
  });
  return [
    item(
      "scope",
      "Scope matches specification",
      !changes.some((change) => ["unexpected", "ambiguous"].includes(change.classification)),
      "Unexpected and ambiguous changes must be resolved.",
    ),
    item(
      "criteria",
      "Acceptance criteria covered",
      blockers.every((value) => !/criterion/i.test(value)),
      "Evidence comes from retained validation results.",
    ),
    item(
      "tasks",
      "Required tasks complete",
      tasks.every((task) => task.status === "completed"),
      "Optional tasks do not block approval.",
    ),
    item(
      "validation",
      "Validation passed",
      tasks.every((task) => runs.get(task.id)?.status === "passed"),
      "Every required task needs a current passed validation run.",
    ),
    item(
      "security",
      "Security reviewed where relevant",
      !findings.some(
        (entry) =>
          entry.source === "security" &&
          entry.finding.severity === "blocking" &&
          !entry.disposition,
      ),
      "Risk acceptance is always explicit.",
    ),
    item(
      "documentation",
      "Documentation updated where required",
      !findings.some(
        (entry) =>
          entry.source === "documentation" &&
          entry.finding.severity === "blocking" &&
          !entry.disposition,
      ),
      "Required documentation findings block completion.",
    ),
    item(
      "notes",
      "Blocking review notes resolved",
      !notes.some((note) => note.blocking && !note.resolvedAt),
      "Blocking notes retain their resolution history.",
    ),
  ];
}

/**
 * Completion options are restricted to local-only, non-mutating modes.
 *
 * Keystone may record completion, hand off remaining work, or close partially /
 * with retained changes — all without staging, committing, pushing, changing
 * branches, or creating remote pull requests. The mutation-capable options
 * (local-commit, pushed-branch, prepared-pr, created-pr, patch-export) have been
 * removed permanently as part of the read-only Git boundary.
 */
function completionOptions(review: WorkflowReviewState, _capabilities: RepositoryCapabilities) {
  const ready = review.summary.completionReady;
  const option = (
    mode: CompletionMode,
    label: string,
    available: boolean,
    explanation: string,
  ) => ({
    mode,
    label,
    available,
    explanation,
    mutation: "none" as const,
    approvalRequired: "none" as const,
    capabilityRequired: "none" as const,
    reversible: true,
  });
  return [
    option(
      "local",
      "Complete locally",
      ready,
      ready
        ? "Records completion and preserves repository changes without Git mutation."
        : "Approve the current Review first.",
    ),
    option(
      "handed-off",
      "Hand off remaining work",
      review.workflow.tasks.some((task) => task.status !== "completed"),
      "Prepares task-centered continuation evidence; it does not mark unfinished work complete.",
    ),
    option(
      "closed-partial",
      "Close partially complete",
      review.workflow.tasks.some((task) => task.status !== "completed"),
      "Records completed and incomplete tasks distinctly.",
    ),
    option(
      "cancelled-with-changes",
      "Cancel with retained changes",
      review.workflow.tasks.some((task) => task.status !== "completed"),
      "Cancels workflow state while preserving repository changes.",
    ),
  ];
}

function completionReport(
  state: WorkflowReviewState,
  mode: CompletionMode,
  reason: string,
): string {
  return [
    `# ${state.summary.title} — completion report`,
    ``,
    `Intent: ${state.workflow.intent.normalizedObjective}`,
    `Specification: revision ${state.summary.specificationRevision}; ${state.workflow.specification?.objective ?? "unavailable"}`,
    `Tasks completed: ${state.summary.tasksCompleted}; incomplete: ${state.summary.tasksIncomplete}`,
    `Changes: ${state.changes.length} reviewed file changes`,
    `Validation: ${state.summary.validationPassed} passed; ${state.summary.validationFailed} failed`,
    `QA: ${state.readinessBlockers.some((item) => /validation|test/i.test(item)) ? "blocked" : "accepted from retained evidence"}`,
    `Security: ${dispositionSummary(state, "security")}`,
    `Performance: ${dispositionSummary(state, "performance")}`,
    `Documentation: ${dispositionSummary(state, "documentation")}`,
    `Review: ${state.decision?.status ?? "not approved"}`,
    `Completion mode: ${mode}`,
    `Delivery: repository changes are preserved locally; no Git mutation, push, or remote PR action is performed.`,
    `Remaining limitations: ${[...state.warnings, reason].join("; ") || "none recorded"}`,
  ]
    .join("\n")
    .slice(0, 20_000);
}

function dispositionSummary(
  state: WorkflowReviewState,
  source: "security" | "performance" | "documentation",
): string {
  const values = state.findings.filter((item) => item.source === source);
  return values.length
    ? values
        .map((item) => `${item.finding.title}: ${item.disposition?.disposition ?? "unresolved"}`)
        .join("; ")
        .slice(0, 1000)
    : "not triggered";
}

function fingerprint(value: unknown): string {
  return `sha256:${createHash("sha256").update(JSON.stringify(value)).digest("hex")}`;
}
