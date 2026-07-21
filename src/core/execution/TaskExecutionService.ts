import type { GitAdapter, GitFileChange } from "../../extension/adapters/GitAdapter";
import type { WorkspaceAdapter } from "../../extension/adapters/WorkspaceAdapter";
import type { DelegationService } from "../copilot/DelegationService";
import type { CopilotAgentRegistry } from "../copilot/AgentRegistry";
import type { DevelopmentWorkflowService } from "../workflows/DevelopmentWorkflowService";
import type { ExecutionPersistenceStore } from "../persistence/ExecutionPersistenceStore";
import type { IntelligenceSnapshotReader } from "../persistence/IntelligenceStore";
import { RepositoryBaselineSchema } from "../../shared/contracts/delegation";
import {
  AttributedChangeSchema,
  ExecutionResultCaptureSchema,
  TaskExecutionSessionSchema,
  type AttributedChange,
  type ExecutionResultCapture,
  type RetryPlan,
  type TaskExecutionSession,
  type TaskExecutionStatus,
} from "../../shared/contracts/execution";
import {
  ChangedEntityResolver,
  ExecutionDiagnosticsService,
  RepositoryBaselineService,
  RetryPlanningService,
  commandFingerprint,
  failureFingerprint,
} from "./ExecutionAnalysisServices";
import { RepositoryStateService } from "../integration/ProductIntegrationService";

const TRANSITIONS: Record<TaskExecutionStatus, readonly TaskExecutionStatus[]> = {
  prepared: ["awaiting-start", "cancelled", "stale"],
  "awaiting-start": ["executing", "cancelled", "stale", "failed"],
  executing: ["repository-changed", "awaiting-result-capture", "cancelled", "failed", "stale"],
  "repository-changed": ["executing", "awaiting-result-capture", "cancelled", "stale"],
  "awaiting-result-capture": ["result-captured", "cancelled", "stale"],
  "result-captured": ["planning-validation", "retry-planned", "cancelled", "stale"],
  "planning-validation": ["validating", "blocked", "stale"],
  validating: [
    "validation-passed",
    "validation-failed",
    "awaiting-user-review",
    "cancelled",
    "stale",
    "failed",
  ],
  "validation-passed": [
    "validating",
    "awaiting-user-review",
    "completed",
    "accepted-with-override",
    "stale",
  ],
  "validation-failed": [
    "validating",
    "awaiting-user-review",
    "retry-planned",
    "accepted-with-override",
    "stale",
  ],
  "awaiting-user-review": [
    "validating",
    "retry-planned",
    "completed",
    "accepted-with-override",
    "cancelled",
    "stale",
  ],
  "retry-planned": ["retrying", "cancelled", "stale"],
  retrying: [
    "executing",
    "repository-changed",
    "awaiting-result-capture",
    "failed",
    "cancelled",
    "stale",
  ],
  "accepted-with-override": ["completed", "stale"],
  completed: [],
  blocked: ["retry-planned", "cancelled", "stale"],
  failed: ["retry-planned", "cancelled", "stale"],
  cancelled: [],
  stale: [],
};

export class ExecutionStateMachine {
  transition(current: TaskExecutionStatus, next: TaskExecutionStatus): void {
    if (!TRANSITIONS[current].includes(next))
      throw new Error(`Invalid execution transition: ${current} -> ${next}.`);
  }
}

export class ChangeAttributionService {
  classify(
    change: GitFileChange,
    baseline: TaskExecutionSession["repositoryBaseline"],
    expectedFiles: string[],
    snapshot: ReturnType<IntelligenceSnapshotReader["getSnapshot"]>,
  ): AttributedChange {
    const relativePath = normalize(change.uri);
    const originalPath = change.originalUri ? normalize(change.originalUri) : undefined;
    const preExisting = new Set([
      ...baseline.dirtyFiles,
      ...baseline.stagedFiles,
      ...baseline.untrackedFiles,
    ]);
    const file = snapshot?.files.find((item) => item.relativePath === relativePath);
    let classification: AttributedChange["classification"];
    let confidence: number;
    let reasons: string[];
    if (preExisting.has(relativePath)) {
      classification = "pre-existing";
      confidence = 1;
      reasons = ["The path was changed before the delegation baseline."];
    } else if (file?.classification.generated) {
      classification = "generated-output";
      confidence = 1;
      reasons = ["Canonical inventory classifies the path as generated output."];
    } else if (file && (!file.classification.included || file.classification.sensitive)) {
      classification = "excluded";
      confidence = 1;
      reasons = [file.classification.reason];
    } else if (expectedFiles.includes(relativePath)) {
      classification = "expected";
      confidence = 1;
      reasons = ["The approved task explicitly lists this path as expected."];
    } else if (expectedFiles.some((expected) => sameArea(expected, relativePath))) {
      classification = "related";
      confidence = 0.7;
      reasons = ["The path shares an approved repository area; ownership is not proven."];
    } else if (!file && change.kind === "added") {
      classification = "ambiguous";
      confidence = 0.35;
      reasons = [
        "A new unindexed path appeared after baseline; time alone does not prove attribution.",
      ];
    } else {
      classification = "unexpected";
      confidence = 0.9;
      reasons = ["The path is outside the approved expected files and repository areas."];
    }
    return AttributedChangeSchema.parse({
      relativePath,
      kind: change.kind,
      ...(originalPath ? { originalPath } : {}),
      classification,
      confidence,
      reasons,
      relatedEntityIds: file ? [file.id] : [],
      evidenceIds: file?.evidenceIds ?? [],
    });
  }
}

export class RepositoryChangeDetector {
  constructor(
    private readonly git: GitAdapter,
    private readonly workspace: WorkspaceAdapter,
    private readonly snapshots: IntelligenceSnapshotReader,
    private readonly attribution = new ChangeAttributionService(),
  ) {}
  async observe(session: TaskExecutionSession): Promise<AttributedChange[]> {
    const root = this.workspace.getRoots()[0];
    if (!root) return [];
    const changes = await this.git.getReconciliationChanges(root.uri);
    return changes.slice(0, 5000).map((change) =>
      this.attribution.classify(
        {
          ...change,
          uri: this.workspace.resolveFile(change.uri)?.relativePath ?? change.uri,
          ...(change.originalUri
            ? {
                originalUri:
                  this.workspace.resolveFile(change.originalUri)?.relativePath ??
                  change.originalUri,
              }
            : {}),
        },
        session.repositoryBaseline,
        session.expectedFiles,
        this.snapshots.getSnapshot(),
      ),
    );
  }
}

export class ResultCaptureService {
  capture(
    session: TaskExecutionSession,
    input: {
      mode: ExecutionResultCapture["mode"];
      agentClaims?: ExecutionResultCapture["agentClaims"];
      userNotes?: string;
    },
    supportedDirect = false,
  ): ExecutionResultCapture {
    if (input.mode === "direct" && (!supportedDirect || session.delegationMode !== "direct"))
      throw new Error(
        "Direct result capture requires a supported integration completion/result event.",
      );
    const diagnostics =
      input.mode === "repository-only"
        ? [
            "No Copilot result was available; validation relies on repository evidence and user confirmation.",
          ]
        : input.mode === "assisted"
          ? ["Agent claims are untrusted and remain distinct from repository/command evidence."]
          : ["Captured through a supported result contract; claims still require validation."];
    return ExecutionResultCaptureSchema.parse({
      ...input,
      agentClaims: input.agentClaims ? sanitizeClaims(input.agentClaims) : undefined,
      attributedChanges: session.observedChanges,
      capturedAt: new Date().toISOString(),
      diagnostics,
    });
  }
}

export class ExecutionSessionService {
  readonly states = new ExecutionStateMachine();
  constructor(private readonly persistence: ExecutionPersistenceStore) {}
  list(): TaskExecutionSession[] {
    return this.persistence.snapshot.sessions;
  }
  get(id: string): TaskExecutionSession | undefined {
    return this.list().find((item) => item.id === id);
  }
  async save(session: TaskExecutionSession): Promise<TaskExecutionSession> {
    await this.persistence.update((state) => ({
      ...state,
      sessions: [...state.sessions.filter((item) => item.id !== session.id), session].slice(-500),
    }));
    return session;
  }
  async transition(
    id: string,
    status: TaskExecutionStatus,
    patch: Partial<TaskExecutionSession> = {},
  ): Promise<TaskExecutionSession> {
    const current = this.get(id);
    if (!current) throw new Error(`Execution session ${id} was not found.`);
    this.states.transition(current.status, status);
    const next = TaskExecutionSessionSchema.parse({
      ...current,
      ...patch,
      status,
      updatedAt: new Date().toISOString(),
    });
    return this.save(next);
  }
  async replace(id: string, patch: Partial<TaskExecutionSession>): Promise<TaskExecutionSession> {
    const current = this.get(id);
    if (!current) throw new Error(`Execution session ${id} was not found.`);
    return this.save(
      TaskExecutionSessionSchema.parse({
        ...current,
        ...patch,
        updatedAt: new Date().toISOString(),
      }),
    );
  }
}

export class TaskExecutionService {
  readonly sessions: ExecutionSessionService;
  readonly changes: RepositoryChangeDetector;
  readonly results = new ResultCaptureService();
  readonly changedEntities: ChangedEntityResolver;
  readonly baselines: RepositoryBaselineService;
  readonly retries = new RetryPlanningService();
  readonly diagnostics = new ExecutionDiagnosticsService();
  constructor(
    private readonly persistence: ExecutionPersistenceStore,
    private readonly delegation: DelegationService,
    private readonly workflows: DevelopmentWorkflowService,
    git: GitAdapter,
    workspace: WorkspaceAdapter,
    private readonly snapshots: IntelligenceSnapshotReader,
    private readonly agents?: CopilotAgentRegistry,
  ) {
    this.sessions = new ExecutionSessionService(persistence);
    this.changes = new RepositoryChangeDetector(git, workspace, snapshots);
    this.changedEntities = new ChangedEntityResolver(snapshots);
    this.baselines = new RepositoryBaselineService(git, workspace, snapshots);
  }
  async initialize(): Promise<void> {
    await this.persistence.initialize();
    const interrupted = this.sessions
      .list()
      .filter((item) =>
        ["executing", "repository-changed", "validating", "retrying"].includes(item.status),
      );
    for (const session of interrupted) {
      await this.sessions.replace(session.id, {
        status: "blocked",
        diagnostics: [...session.diagnostics, this.diagnostics.interrupted(session.status)].slice(
          -100,
        ),
      });
      try {
        await this.workflows.setTaskStatus(
          session.workflowId,
          session.taskId,
          "blocked",
          "VS Code restarted during active execution or validation; explicit review is required.",
        );
      } catch {
        await this.sessions.replace(session.id, {
          diagnostics: [
            ...this.require(session.id).diagnostics,
            {
              code: "workflow-recovery-unavailable",
              severity: "warning" as const,
              message:
                "The execution record was recovered, but its workflow task could not be updated and requires reconciliation.",
            },
          ].slice(-100),
        });
      }
    }
    const running = this.persistence.snapshot.runs.filter((item) => item.status === "running");
    if (running.length) {
      const interruptedIds = new Set(running.map((item) => item.id));
      await this.persistence.update((state) => ({
        ...state,
        runs: state.runs.map((run) =>
          interruptedIds.has(run.id)
            ? {
                ...run,
                status: "cancelled",
                completedAt: new Date().toISOString(),
                stepResults: run.stepResults.map((item) =>
                  item.status === "passed" ? item : { ...item, status: "stale" },
                ),
                diagnostics: [
                  ...run.diagnostics,
                  "Interrupted validation recovered after restart; incomplete evidence cannot support completion.",
                ].slice(-100),
              }
            : run,
        ),
      }));
    }
  }
  async start(
    workflowId: string,
    taskId: string,
    delegationSessionId: string,
  ): Promise<TaskExecutionSession> {
    const delegation = this.delegation.sessions.get(delegationSessionId);
    if (!delegation || delegation.taskId !== taskId)
      throw new Error("A persisted matching delegation session is required.");
    if (["failed", "cancelled", "stale"].includes(delegation.status))
      throw new Error(`Delegation session is ${delegation.status}.`);
    const delegationBlockers = this.delegation.validateExecutionStart(delegation);
    if (delegationBlockers.length)
      throw new Error(`Execution start blocked: ${delegationBlockers.join(" ")}`);
    const workflow = this.workflows.get(workflowId);
    const task = workflow?.tasks.find((item) => item.id === taskId);
    const specification = workflow?.specification;
    if (!workflow || !task || !specification)
      throw new Error("Approved workflow task was not found.");
    if (
      specification.status !== "approved" ||
      task.specificationRevision !== specification.revision ||
      task.status === "stale"
    )
      throw new Error("Task/specification is not current and approved.");
    if (
      task.dependencies.some(
        (id) => workflow.tasks.find((candidate) => candidate.id === id)?.status !== "completed",
      )
    )
      throw new Error("Task dependencies are no longer complete.");
    const overlaps = this.sessions
      .list()
      .filter(
        (item) =>
          item.taskId !== task.id &&
          !["completed", "cancelled", "failed", "stale"].includes(item.status) &&
          item.expectedFiles.some((file) => task.expectedFiles.includes(file)),
      );
    if (overlaps.length)
      throw new Error(`Execution overlaps ${overlaps.length} active task session(s).`);
    const current = this.snapshots.getSnapshot();
    if (current?.repository.branch && specification.branch !== current.repository.branch)
      throw new Error("Repository branch differs from the approved specification baseline.");
    const existing = this.sessions
      .list()
      .find((item) => item.delegationSessionId === delegationSessionId);
    if (existing) return existing;
    const repositoryBaseline = RepositoryBaselineSchema.parse({
      ...delegation.repositoryStateAtDelegation,
      knownValidationOutcomes: this.knownValidationOutcomes(),
    });
    const now = new Date().toISOString();
    const session = TaskExecutionSessionSchema.parse({
      schemaVersion: 1,
      repositoryState:
        delegation.repositoryState ?? new RepositoryStateService().fromBaseline(repositoryBaseline),
      id: crypto.randomUUID(),
      taskId,
      workflowId,
      specificationId: specification.id,
      specificationRevision: specification.revision,
      delegationSessionId,
      contextFingerprint: delegation.contextFingerprint,
      promptFingerprint: delegation.promptFingerprint,
      agentId: delegation.agentId,
      agentSnapshot: delegation.agentSnapshot,
      delegationMode: delegation.mode,
      status: "prepared",
      repositoryBaseline,
      expectedFiles: task.expectedFiles,
      expectedEntityIds: task.expectedEntityIds,
      observedChanges: [],
      validationRunIds: [],
      retryAttempt: 0,
      updatedAt: now,
      diagnostics: [
        {
          code: "explicit-start-required",
          severity: "info",
          message:
            "Opening Copilot does not start execution. User confirmation or a supported start event is required.",
        },
      ],
    });
    await this.sessions.save(session);
    return this.sessions.transition(session.id, "awaiting-start");
  }
  get(id: string): TaskExecutionSession | undefined {
    return this.sessions.get(id);
  }
  getRetry(id: string): RetryPlan | undefined {
    return this.persistence.snapshot.retries
      .filter((item) => item.executionSessionId === id)
      .at(-1);
  }
  async confirmStarted(id: string): Promise<TaskExecutionSession> {
    const session = await this.sessions.transition(id, "executing", {
      startedAt: new Date().toISOString(),
    });
    await this.workflows.setTaskStatus(session.workflowId, session.taskId, "executing");
    return session;
  }
  async confirmStopped(id: string): Promise<TaskExecutionSession> {
    const current = this.require(id);
    if (current.status === "executing") await this.observeChanges(id);
    const refreshed = this.require(id);
    const stoppedAt = new Date().toISOString();
    const executionDurationMs = refreshed.startedAt
      ? Math.max(0, Date.parse(stoppedAt) - Date.parse(refreshed.startedAt))
      : 0;
    const session = await this.sessions.transition(id, "awaiting-result-capture", {
      stoppedAt,
      metrics: { ...refreshed.metrics, executionDurationMs },
    });
    await this.workflows.setTaskStatus(
      session.workflowId,
      session.taskId,
      "blocked",
      "Execution stopped; result capture and validation are required before completion.",
    );
    return { ...session, observedChanges: refreshed.observedChanges };
  }
  async observeChanges(id: string): Promise<TaskExecutionSession> {
    const session = this.require(id);
    const observedChanges = await this.changes.observe(session);
    const changedEntities = await this.changedEntities.resolve({
      ...session,
      observedChanges,
    });
    const averageAttributionConfidence = observedChanges.length
      ? observedChanges.reduce((sum, item) => sum + item.confidence, 0) / observedChanges.length
      : 0;
    const next = await this.sessions.replace(id, {
      observedChanges,
      changedEntities,
      metrics: {
        ...session.metrics,
        filesChanged: observedChanges.length,
        averageAttributionConfidence,
      },
    });
    if (observedChanges.length && session.status === "executing")
      return this.sessions.transition(id, "repository-changed");
    return next;
  }
  async attributeChange(
    id: string,
    relativePath: string,
    classification: AttributedChange["classification"],
    reason: string,
  ): Promise<TaskExecutionSession> {
    const session = this.require(id);
    const observedChanges = session.observedChanges.map((item) =>
      item.relativePath === relativePath
        ? AttributedChangeSchema.parse({
            ...item,
            classification,
            userOverride: {
              classification,
              reason,
              at: new Date().toISOString(),
            },
            reasons: [...item.reasons, `User attribution override: ${reason}`].slice(-20),
          })
        : item,
    );
    return this.sessions.replace(id, { observedChanges });
  }
  async captureResult(
    id: string,
    input: {
      mode: ExecutionResultCapture["mode"];
      agentClaims?: ExecutionResultCapture["agentClaims"];
      userNotes?: string;
    },
    supportedDirect = false,
  ): Promise<TaskExecutionSession> {
    const session = this.require(id);
    if (session.status !== "awaiting-result-capture")
      throw new Error("Execution must be explicitly stopped before result capture.");
    const resultCapture = this.results.capture(session, input, supportedDirect);
    const changedEntities = await this.changedEntities.resolve(session);
    return this.sessions.transition(id, "result-captured", {
      resultCapture,
      changedEntities,
    });
  }
  async cancel(id: string): Promise<TaskExecutionSession> {
    const session = await this.sessions.transition(id, "cancelled");
    await this.workflows.setTaskStatus(session.workflowId, session.taskId, "cancelled");
    return session;
  }
  async planRetry(
    id: string,
    mode: RetryPlan["mode"],
    reason: string,
    selectedAgentId?: string,
  ): Promise<RetryPlan> {
    const session = this.require(id);
    if (mode === "different-agent" && !selectedAgentId)
      throw new Error("A different-agent retry requires an explicit agent selection.");
    if (mode === "different-agent" && selectedAgentId === session.agentId)
      throw new Error("The selected retry agent must differ from the prior agent.");
    if (mode === "same-agent" && selectedAgentId && selectedAgentId !== session.agentId)
      throw new Error("A same-agent retry cannot silently change the agent.");
    if (!session.validationRunIds.length)
      throw new Error("A validation attempt is required before retry planning.");
    const run = this.persistence.snapshot.runs.find(
      (item) => item.id === session.validationRunIds.at(-1),
    );
    if (!run) throw new Error("The latest validation run is unavailable.");
    const validationPlan = this.persistence.snapshot.plans.find(
      (item) => item.id === session.validationPlanId,
    );
    let plan = this.retries.create(session, run, mode, reason, selectedAgentId, validationPlan);
    if (mode === "partial-repair") {
      const workflow = await this.workflows.createRepairTask(
        session.workflowId,
        session.taskId,
        plan.failedCriterionIds,
        session.observedChanges
          .filter((item) => ["expected", "related"].includes(item.classification))
          .map((item) => item.relativePath),
        reason,
      );
      const repairTask = workflow.tasks.at(-1);
      if (!repairTask) throw new Error("Focused repair task creation failed.");
      plan = { ...plan, partialRepairTaskId: repairTask.id };
    }
    await this.persistence.update((state) => ({
      ...state,
      retries: [...state.retries, plan].slice(-500),
    }));
    await this.sessions.transition(id, "retry-planned", {
      retryAttempt: plan.attempt,
    });
    return plan;
  }
  async startRetry(id: string): Promise<TaskExecutionSession> {
    const original = this.require(id);
    const plan = this.getRetry(id);
    if (!plan || plan.status !== "planned") throw new Error("A reviewed retry plan is required.");
    if (plan.mode === "partial-repair")
      throw new Error(
        "The focused repair task must be reviewed and delegated separately; it cannot silently reuse the original execution session.",
      );
    const selected = plan.selectedAgentId
      ? this.agents?.getProfile(plan.selectedAgentId)
      : original.agentSnapshot;
    if (!selected || selected.availability === "unavailable")
      throw new Error("The retry agent is unavailable or not evidence-backed.");
    const baseline = await this.baselines.capture(
      original.expectedFiles,
      original.repositoryBaseline.entityFingerprints,
      this.knownValidationOutcomes(),
    );
    const retry = TaskExecutionSessionSchema.parse({
      ...original,
      id: crypto.randomUUID(),
      agentId: selected.id,
      agentSnapshot: selected,
      status: "awaiting-start",
      repositoryBaseline: baseline,
      observedChanges: [],
      changedEntities: [],
      resultCapture: undefined,
      validationPlanId: undefined,
      validationRunIds: [],
      retryAttempt: plan.attempt,
      parentExecutionSessionId: original.id,
      startedAt: undefined,
      stoppedAt: undefined,
      completedAt: undefined,
      updatedAt: new Date().toISOString(),
      metrics: {
        ...original.metrics,
        executionDurationMs: 0,
        filesChanged: 0,
        averageAttributionConfidence: 0,
        validationDurationMs: 0,
        retryCount: plan.attempt,
      },
      diagnostics: [
        {
          code: "retry-awaiting-start",
          severity: "info",
          message:
            "Retry history is preserved. Explicit execution start is required; no next task is auto-delegated.",
        },
      ],
    });
    await this.sessions.transition(original.id, "retrying");
    await this.sessions.save(retry);
    await this.persistence.update((state) => ({
      ...state,
      retries: state.retries.map((item) =>
        item.id === plan.id ? { ...item, status: "started" } : item,
      ),
    }));
    return retry;
  }
  private knownValidationOutcomes(): TaskExecutionSession["repositoryBaseline"]["knownValidationOutcomes"] {
    const current = this.snapshots.getSnapshot();
    const values = new Map<
      string,
      TaskExecutionSession["repositoryBaseline"]["knownValidationOutcomes"][number]
    >();
    for (const run of this.persistence.snapshot.runs) {
      if (!["passed", "failed", "awaiting-user-review"].includes(run.status)) continue;
      const priorSession = this.sessions.get(run.executionSessionId);
      if (
        !priorSession ||
        priorSession.repositoryBaseline.branch !== current?.repository.branch ||
        priorSession.repositoryBaseline.headCommit !== current?.repository.headCommit
      )
        continue;
      const plan = this.persistence.snapshot.plans.find(
        (item) => item.executionSessionId === run.executionSessionId,
      );
      for (const result of run.stepResults) {
        const command = plan?.steps.find((item) => item.id === result.stepId)?.command;
        if (!command || !["passed", "failed"].includes(result.status)) continue;
        const key = commandFingerprint(command);
        values.set(key, {
          commandFingerprint: key,
          status: result.status as "passed" | "failed",
          ...(result.status === "failed"
            ? {
                failureFingerprint: failureFingerprint(result.outputTail, result.errorTail),
              }
            : {}),
        });
      }
    }
    return [...values.values()].slice(-200);
  }
  private require(id: string): TaskExecutionSession {
    const value = this.sessions.get(id);
    if (!value) throw new Error(`Execution session ${id} was not found.`);
    return value;
  }
}

function normalize(uri: string): string {
  try {
    return decodeURIComponent(uri.replace(/^file:\/\//, "")).replace(/^\//, "");
  } catch {
    return uri;
  }
}
function sameArea(left: string, right: string): boolean {
  const a = left.split("/");
  const b = right.split("/");
  return a.length > 1 && b.length > 1 && a[0] === b[0] && a[1] === b[1];
}
function sanitize(value: string): string {
  const printable = [...value]
    .filter((character) => {
      const code = character.charCodeAt(0);
      return character === "\n" || character === "\t" || (code >= 32 && code !== 127);
    })
    .join("");
  return printable
    .replace(
      /(?:gh[pousr]_[A-Za-z0-9_]{20,}|AKIA[0-9A-Z]{16}|-----BEGIN [A-Z ]*PRIVATE KEY-----|(?:password|token|secret|api[_-]?key)\s*[:=]\s*[^\s]+)/gi,
      "[REDACTED]",
    )
    .slice(0, 20_000);
}
function sanitizeClaims(
  claims: NonNullable<ExecutionResultCapture["agentClaims"]>,
): NonNullable<ExecutionResultCapture["agentClaims"]> {
  return {
    ...(claims.summary ? { summary: sanitize(claims.summary) } : {}),
    ...(claims.filesChanged ? { filesChanged: claims.filesChanged.slice(0, 500) } : {}),
    ...(claims.commandsRun ? { commandsRun: claims.commandsRun.map(sanitize).slice(0, 100) } : {}),
    ...(claims.testsRun ? { testsRun: claims.testsRun.map(sanitize).slice(0, 100) } : {}),
    ...(claims.blockers ? { blockers: claims.blockers.map(sanitize).slice(0, 100) } : {}),
    ...(claims.unresolvedIssues
      ? {
          unresolvedIssues: claims.unresolvedIssues.map(sanitize).slice(0, 100),
        }
      : {}),
  };
}
