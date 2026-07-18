import type { GitAdapter } from "../../extension/adapters/GitAdapter";
import type { WorkspaceAdapter } from "../../extension/adapters/WorkspaceAdapter";
import type { CopilotAdapter } from "./CopilotAdapter";
import type { CopilotAgentRegistry } from "./AgentRegistry";
import type { DelegationPersistenceStore } from "../persistence/DelegationPersistenceStore";
import type { IntelligenceSnapshotReader } from "../persistence/IntelligenceStore";
import type { DevelopmentWorkflowService } from "../workflows/DevelopmentWorkflowService";
import { RepositoryBaselineService } from "../execution/ExecutionAnalysisServices";
import { RepositoryStateService } from "../integration/ProductIntegrationService";
import {
  DelegationSessionSchema,
  PreparedDelegationSchema,
  TaskEligibilitySchema,
  type CopilotAgentDescriptor,
  type CopilotCapabilities,
  type DelegationSession,
  type DevelopmentSpecification,
  type DevelopmentTask,
  type DevelopmentWorkflowSnapshot,
  type PreparedDelegation,
  type RepositoryBaseline,
  type TaskContextPackage,
  type TaskEligibility,
} from "../../shared/contracts/delegation";

export class TaskEligibilityService {
  check(input: {
    workflow: DevelopmentWorkflowSnapshot;
    task: DevelopmentTask;
    specification: DevelopmentSpecification;
    agent?: CopilotAgentDescriptor;
    context?: TaskContextPackage;
    prepared?: PreparedDelegation;
    activeSessions?: DelegationSession[];
    currentGeneration: number;
    currentBranch?: string;
    overlapOverride?: boolean;
  }): TaskEligibility {
    const reasons: TaskEligibility["reasons"] = [];
    const block = (code: string, message: string): void => {
      reasons.push({ code, message, blocking: true });
    };
    if (input.specification.status !== "approved")
      block(
        "specification-not-approved",
        "The specification revision is not approved.",
      );
    if (input.task.specificationRevision !== input.specification.revision)
      block(
        "task-specification-stale",
        "The task targets another specification revision.",
      );
    if (input.task.status === "stale" || input.task.staleReasons.length)
      block(
        "task-stale",
        input.task.staleReasons.join(" ") || "The task is stale.",
      );
    const dependencies = input.task.dependencies.map((id) =>
      input.workflow.tasks.find((item) => item.id === id),
    );
    if (dependencies.some((item) => !item || item.status !== "completed"))
      block(
        "dependencies-incomplete",
        "One or more task dependencies are not complete. This milestone never fabricates dependency completion.",
      );
    if (
      input.specification.decisions.some(
        (item) => item.blocking && !item.resolution?.trim(),
      )
    )
      block(
        "decisions-unresolved",
        "Blocking specification decisions remain unresolved.",
      );
    if (
      input.currentBranch &&
      input.specification.branch &&
      input.currentBranch !== input.specification.branch
    )
      block(
        "branch-mismatch",
        `Current branch ${input.currentBranch} differs from specification baseline ${input.specification.branch}.`,
      );
    if (input.currentGeneration < input.specification.intelligenceGeneration)
      block(
        "intelligence-regressed",
        "The active intelligence generation is older than the approved specification.",
      );
    if (!input.task.acceptanceCriterionIds.length)
      block("criteria-missing", "The task has no acceptance criteria.");
    if (!input.task.validationSteps.length)
      block("validation-missing", "The task has no validation steps.");
    if (!input.agent)
      block("agent-missing", "No valid agent selection exists.");
    else if (input.agent.availability === "unavailable")
      block("agent-unavailable", "The selected agent is unavailable.");
    if (!input.context) block("context-missing", "No context package exists.");
    else {
      if (!input.context.reviewed)
        block(
          "context-unreviewed",
          "The exact context package has not been approved.",
        );
      if (input.context.completeness === "blocked")
        block("context-blocked", "Context diagnostics block delegation.");
      if (
        input.context.specificationRevision !== input.specification.revision ||
        input.context.intelligenceGeneration !== input.currentGeneration
      )
        block(
          "context-stale",
          "The context package does not match the current specification/intelligence state.",
        );
    }
    if (!input.prepared?.approved)
      block(
        "delegation-unapproved",
        "The exact prompt and context require explicit delegation approval.",
      );
    if (
      input.prepared &&
      input.context &&
      input.prepared.contextFingerprint !== input.context.contentFingerprint
    )
      block(
        "fingerprint-mismatch",
        "The approved prompt references a different context fingerprint.",
      );
    const overlap = (input.activeSessions ?? []).filter(
      (session) =>
        !["cancelled", "failed", "stale"].includes(session.status) &&
        session.taskId !== input.task.id &&
        session.expectedFiles.some((file) =>
          input.task.expectedFiles.includes(file),
        ),
    );
    if (overlap.length && !input.overlapOverride)
      block(
        "overlapping-active-task",
        `Expected files overlap ${overlap.length} active delegation session(s).`,
      );
    if (overlap.length && input.overlapOverride)
      reasons.push({
        code: "overlap-override",
        message:
          "The user explicitly accepted the overlapping delegation risk.",
        blocking: false,
      });
    return TaskEligibilitySchema.parse({
      taskId: input.task.id,
      eligible: !reasons.some((item) => item.blocking),
      checkedAt: new Date().toISOString(),
      reasons,
    });
  }
}

export class DelegationPromptBuilder {
  async build(
    task: DevelopmentTask,
    specification: DevelopmentSpecification,
    agent: CopilotAgentDescriptor,
    context: TaskContextPackage,
    userSections: Record<string, string> = {},
  ): Promise<{ prompt: string; fingerprint: string; diagnostics: string[] }> {
    const itemLines = context.items.map(
      (item) =>
        `### ${item.title}\nReason: ${item.reason}\nSource: ${item.relativePath ?? item.sourceEntityId ?? item.id}\n\n${item.content}`,
    );
    const prompt = [
      "You are executing one approved Keystone development task.",
      `Selected agent intent: ${agent.displayName}. Use only the capabilities actually available to you; report any mismatch.`,
      `\nTask:\n${task.objective}\n\n${task.description}`,
      `\nSpecification:\n${specification.title}, revision ${specification.revision} (${specification.id})`,
      section(
        "Requirements",
        specification.requirements
          .filter((item) => task.requirementIds.includes(item.id))
          .map((item) => `${item.id}: ${item.description}`),
      ),
      section(
        "Acceptance criteria",
        specification.acceptanceCriteria
          .filter((item) => task.acceptanceCriterionIds.includes(item.id))
          .map(
            (item) =>
              `${item.id}: ${item.description}\nValidation: ${item.validationMethod}`,
          ),
      ),
      section("Engineering constraints", specification.constraints),
      section(
        "Expected repository areas",
        task.expectedFiles.length
          ? task.expectedFiles
          : [
              "No file path is assumed; inspect supplied canonical entities before choosing files.",
            ],
      ),
      section("Relevant repository context", itemLines),
      section(
        "Tests and validation",
        task.validationSteps.map(
          (item) =>
            item.command ?? item.manualCheck ?? "Report applicable validation.",
        ),
      ),
      section("Prohibited changes", [
        "Do not modify unrelated areas.",
        "Do not change approved behavior or acceptance criteria.",
        "Do not introduce unnecessary dependencies.",
        "Do not ignore failed validation.",
        "Do not assume missing repository facts.",
      ]),
      "\nBefore implementation:\n1. Inspect the supplied context.\n2. Report blockers or contradictions.\n3. State the files you expect to change.\n4. Stop if requirements are unresolved.",
      "\nAfter implementation:\n1. Summarize changes.\n2. List files changed.\n3. Report commands and validation outcomes.\n4. Map evidence to acceptance criteria.\n5. Report assumptions, deviations, blockers, and unresolved issues.",
      ...Object.entries(userSections)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([title, content]) => `\nUser-approved ${title}:\n${content}`),
    ].join("\n");
    const bounded = prompt.slice(0, 200_000);
    const diagnostics =
      prompt.length > bounded.length
        ? [
            "Prompt was truncated at the hard 200,000-character Webview/delegation limit; review is required.",
          ]
        : [];
    return { prompt: bounded, fingerprint: await digest(bounded), diagnostics };
  }
}

export class DelegationFallbackService {
  mode(
    capabilities: CopilotCapabilities,
    agent?: CopilotAgentDescriptor,
  ): DelegationSession["mode"] {
    return capabilities.directInvocationAvailable &&
      agent?.availability === "available" &&
      Boolean(agent.invocationMethod)
      ? "direct"
      : capabilities.chatAvailable && capabilities.promptInsertionAvailable
        ? "assisted"
        : "clipboard";
  }
  instructions(mode: DelegationSession["mode"]): string[] {
    if (mode === "direct")
      return [
        "Keystone will use the supported direct invocation and require a real handle.",
      ];
    if (mode === "assisted")
      return [
        "Keystone will open Copilot and insert the approved prompt.",
        "Confirm externally when execution begins or stops.",
      ];
    return [
      "Keystone will copy the approved prompt after explicit start.",
      "Paste it into the opened Copilot surface and confirm externally when work begins.",
    ];
  }
}

export class DelegationDiagnosticsService {
  forMode(
    mode: DelegationSession["mode"],
    capabilities: CopilotCapabilities,
  ): DelegationSession["diagnostics"] {
    const output: DelegationSession["diagnostics"] = [];
    if (mode !== "direct")
      output.push({
        code: "reduced-attribution",
        severity: "warning",
        message:
          "Keystone cannot authoritatively attribute Copilot progress or completion in this fallback mode.",
      });
    if (!capabilities.completionEventsAvailable)
      output.push({
        code: "user-confirmation-required",
        severity: "info",
        message:
          "Completion events are unavailable; this milestone will not mark the task completed.",
      });
    return output;
  }
}

export class DelegationTrackingService {
  private readonly baselines: RepositoryBaselineService;
  constructor(
    private readonly git: GitAdapter,
    private readonly workspace: WorkspaceAdapter,
    snapshots: IntelligenceSnapshotReader,
  ) {
    this.baselines = new RepositoryBaselineService(git, workspace, snapshots);
  }
  async capture(
    expectedFiles: string[],
    entityFingerprints: Record<string, string>,
  ): Promise<RepositoryBaseline> {
    return this.baselines.capture(expectedFiles, entityFingerprints);
  }
  async detect(
    session: DelegationSession,
  ): Promise<DelegationSession["changes"]> {
    const root = this.workspace.getRoots()[0];
    if (!root) return [];
    const current = normalized(
      await this.git.getChangedFiles(root.uri),
      root.uri,
    );
    const baseline = new Set([
      ...session.repositoryStateAtDelegation.dirtyFiles,
      ...session.repositoryStateAtDelegation.stagedFiles,
      ...session.repositoryStateAtDelegation.untrackedFiles,
    ]);
    return current
      .slice(0, 5000)
      .map((relativePath) =>
        baseline.has(relativePath)
          ? {
              relativePath,
              classification: "pre-existing" as const,
              reason: "The file was already changed at delegation baseline.",
            }
          : session.expectedFiles.includes(relativePath)
            ? {
                relativePath,
                classification: "expected" as const,
                reason: "The file is explicitly expected by the approved task.",
              }
            : session.expectedFiles.some((file) => sameArea(file, relativePath))
              ? {
                  relativePath,
                  classification: "related" as const,
                  reason:
                    "The file is in an expected repository area; attribution remains unconfirmed.",
                }
              : {
                  relativePath,
                  classification: "unexpected" as const,
                  reason: "The file was not in the approved expected set.",
                },
      );
  }
}

export class DelegationSessionService {
  constructor(private readonly persistence: DelegationPersistenceStore) {}
  list(): DelegationSession[] {
    return this.persistence.snapshot.sessions;
  }
  get(id: string): DelegationSession | undefined {
    return this.list().find((item) => item.id === id);
  }
  async save(session: DelegationSession): Promise<DelegationSession> {
    await this.persistence.update((state) => ({
      ...state,
      sessions: [
        ...state.sessions.filter((item) => item.id !== session.id),
        session,
      ].slice(-200),
    }));
    return session;
  }
  async update(
    id: string,
    patch: Partial<DelegationSession>,
  ): Promise<DelegationSession> {
    let output: DelegationSession | undefined;
    await this.persistence.update((state) => ({
      ...state,
      sessions: state.sessions.map((item) => {
        if (item.id !== id) return item;
        output = DelegationSessionSchema.parse({
          ...item,
          ...patch,
          updatedAt: new Date().toISOString(),
        });
        return output;
      }),
    }));
    if (!output) throw new Error(`Delegation session ${id} was not found.`);
    return output;
  }
}

export class TaskExecutionStateService {
  constructor(private readonly workflows: DevelopmentWorkflowService) {}
  transition(
    workflowId: string,
    taskId: string,
    status: DevelopmentTask["status"],
    reason?: string,
  ): Promise<DevelopmentWorkflowSnapshot> {
    return this.workflows.setTaskStatus(workflowId, taskId, status, reason);
  }
}

export class DelegationService {
  readonly eligibility = new TaskEligibilityService();
  readonly prompts = new DelegationPromptBuilder();
  readonly fallback = new DelegationFallbackService();
  readonly diagnostics = new DelegationDiagnosticsService();
  readonly sessions: DelegationSessionService;
  readonly execution: TaskExecutionStateService;
  constructor(
    private readonly adapter: CopilotAdapter,
    private readonly registry: CopilotAgentRegistry,
    private readonly persistence: DelegationPersistenceStore,
    private readonly workflows: DevelopmentWorkflowService,
    private readonly snapshots: IntelligenceSnapshotReader,
    readonly tracking: DelegationTrackingService,
  ) {
    this.sessions = new DelegationSessionService(persistence);
    this.execution = new TaskExecutionStateService(workflows);
  }

  async captureBuildBaseline(task: DevelopmentTask): Promise<RepositoryBaseline> {
    const baseline = await this.tracking.capture(task.expectedFiles, task.baseEntityFingerprints);
    await this.persistence.update((state) => ({ ...state, buildBaselines: { ...state.buildBaselines, [task.id]: baseline } }));
    return baseline;
  }
  getBuildBaseline(taskId: string): RepositoryBaseline | undefined { return this.persistence.snapshot.buildBaselines[taskId]; }

  async prepare(
    workflowId: string,
    taskId: string,
    context: TaskContextPackage,
    userSections: Record<string, string> = {},
  ): Promise<PreparedDelegation> {
    const { workflow, task, specification, agent } = this.resolve(
      workflowId,
      taskId,
    );
    const built = await this.prompts.build(
      task,
      specification,
      agent,
      context,
      userSections,
    );
    const current = this.snapshots.getSnapshot();
    const prepared = PreparedDelegationSchema.parse({
      taskId,
      agentId: agent.id,
      contextPackageId: context.id,
      contextFingerprint: context.contentFingerprint,
      prompt: built.prompt,
      promptFingerprint: built.fingerprint,
      approved: false,
      userSections,
      eligibility: this.eligibility.check({
        workflow,
        task,
        specification,
        agent,
        context,
        currentGeneration: current?.manifest.generation ?? 0,
        currentBranch: current?.repository.branch,
        activeSessions: this.sessions.list(),
      }),
    });
    await this.persistence.update((state) => ({
      ...state,
      prepared: [
        ...state.prepared.filter((item) => item.taskId !== taskId),
        prepared,
      ].slice(-200),
    }));
    return prepared;
  }

  getPrepared(taskId: string): PreparedDelegation | undefined {
    return this.persistence.snapshot.prepared.find(
      (item) => item.taskId === taskId,
    );
  }
  validateExecutionStart(session: DelegationSession): string[] {
    const prepared = this.getPrepared(session.taskId);
    const context = this.persistence.snapshot.contexts.find(
      (item) => item.id === session.contextPackageId,
    );
    const blockers: string[] = [];
    if (!prepared?.approved)
      blockers.push("The delegated prompt is no longer approved.");
    if (!context?.reviewed)
      blockers.push("The delegated context package is no longer reviewed.");
    if (prepared && prepared.promptFingerprint !== session.promptFingerprint)
      blockers.push(
        "The delegated prompt fingerprint no longer matches the approved prompt.",
      );
    if (prepared && prepared.contextFingerprint !== session.contextFingerprint)
      blockers.push(
        "The prepared prompt references another context fingerprint.",
      );
    if (context && context.contentFingerprint !== session.contextFingerprint)
      blockers.push(
        "The delegated context fingerprint no longer matches canonical persisted context.",
      );
    return blockers;
  }
  async approve(
    taskId: string,
    promptFingerprint: string,
    contextFingerprint: string,
  ): Promise<PreparedDelegation> {
    let output: PreparedDelegation | undefined;
    await this.persistence.update((state) => ({
      ...state,
      prepared: state.prepared.map((item) => {
        if (item.taskId !== taskId) return item;
        if (
          item.promptFingerprint !== promptFingerprint ||
          item.contextFingerprint !== contextFingerprint
        )
          throw new Error(
            "Prompt or context changed after preview; delegation approval was rejected.",
          );
        output = PreparedDelegationSchema.parse({ ...item, approved: true });
        return output;
      }),
    }));
    if (!output)
      throw new Error(`No prepared delegation exists for task ${taskId}.`);
    return output;
  }
  async invalidate(taskId: string, reason: string): Promise<void> {
    await this.persistence.update((state) => ({
      ...state,
      prepared: state.prepared.map((item) =>
        item.taskId === taskId
          ? PreparedDelegationSchema.parse({
              ...item,
              approved: false,
              eligibility: {
                ...item.eligibility,
                eligible: false,
                checkedAt: new Date().toISOString(),
                reasons: [
                  ...item.eligibility.reasons,
                  {
                    code: "prepared-invalidated",
                    message: reason,
                    blocking: true,
                  },
                ].slice(-100),
              },
            })
          : item,
      ),
    }));
  }

  async start(
    workflowId: string,
    taskId: string,
    context: TaskContextPackage,
    overlapOverride = false,
    signal?: AbortSignal,
  ): Promise<DelegationSession> {
    const prepared = this.getPrepared(taskId);
    if (!prepared?.approved)
      throw new Error(
        "Explicit delegation approval is required before transmission, insertion, or clipboard copy.",
      );
    const { workflow, task, specification, agent } = this.resolve(
      workflowId,
      taskId,
    );
    const current = this.snapshots.getSnapshot();
    const eligibility = this.eligibility.check({
      workflow,
      task,
      specification,
      agent,
      context,
      prepared,
      currentGeneration: current?.manifest.generation ?? 0,
      currentBranch: current?.repository.branch,
      activeSessions: this.sessions.list(),
      overlapOverride,
    });
    if (!eligibility.eligible)
      throw new Error(
        `Delegation blocked: ${eligibility.reasons
          .filter((item) => item.blocking)
          .map((item) => item.message)
          .join(" ")}`,
      );
    const capabilities =
      this.adapter.getCapabilities() ??
      (await this.adapter.refreshCapabilities(signal));
    const mode = this.fallback.mode(capabilities, agent);
    const baseline = await this.tracking.capture(
      task.expectedFiles,
      task.baseEntityFingerprints,
    );
    const now = new Date().toISOString();
    let session = DelegationSessionSchema.parse({
      schemaVersion: 1,
      id: crypto.randomUUID(),
      taskId,
      specificationId: specification.id,
      specificationRevision: specification.revision,
      repositoryState: new RepositoryStateService().fromBaseline(baseline),
      agentId: agent.id,
      agentSnapshot: agent,
      contextPackageId: context.id,
      contextFingerprint: context.contentFingerprint,
      promptFingerprint: prepared.promptFingerprint,
      mode,
      status: "delegating",
      approvedAt: now,
      updatedAt: now,
      repositoryStateAtDelegation: baseline,
      expectedFiles: task.expectedFiles,
      diagnostics: this.diagnostics.forMode(mode, capabilities),
      changes: [],
    });
    session = await this.sessions.save(session);
    await this.execution.transition(workflowId, taskId, "delegating");
    try {
      if (mode === "direct") {
        const result = await this.adapter.invokeDirect(prepared, signal);
        session = await this.sessions.update(session.id, {
          status: result.status === "executing" ? "executing" : "delegating",
          externalHandle: result.handle,
          startedAt: new Date().toISOString(),
        });
        await this.execution.transition(
          workflowId,
          taskId,
          result.status === "executing" ? "executing" : "delegating",
        );
      } else if (mode === "assisted") {
        await this.adapter.openCopilot();
        await this.adapter.insertPrompt(prepared.prompt);
        session = await this.sessions.update(session.id, {
          status: "awaiting-external-start",
        });
        await this.execution.transition(
          workflowId,
          taskId,
          "awaiting-external-start",
        );
      } else {
        await this.adapter.copyPrompt(prepared.prompt);
        if (capabilities.chatAvailable) await this.adapter.openCopilot();
        session = await this.sessions.update(session.id, {
          status: "awaiting-external-start",
        });
        await this.execution.transition(
          workflowId,
          taskId,
          "awaiting-external-start",
        );
      }
      return session;
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : String(cause);
      await this.execution.transition(workflowId, taskId, "blocked", message);
      await this.sessions.update(session.id, {
        status: "failed",
        diagnostics: [
          ...session.diagnostics,
          { code: "integration-failure", severity: "error" as const, message },
        ].slice(-100),
      });
      throw new Error(
        `Copilot delegation failed after the repository baseline was persisted: ${message}`,
        { cause },
      );
    }
  }

  async confirmStarted(
    workflowId: string,
    sessionId: string,
  ): Promise<DelegationSession> {
    const session = await this.sessions.update(sessionId, {
      status: "executing",
      startedAt: new Date().toISOString(),
    });
    await this.execution.transition(workflowId, session.taskId, "executing");
    return session;
  }
  async confirmStopped(sessionId: string): Promise<DelegationSession> {
    return this.sessions.update(sessionId, {
      status: "awaiting-user-confirmation",
    });
  }
  async refreshChanges(sessionId: string): Promise<DelegationSession> {
    const session = this.sessions.get(sessionId);
    if (!session)
      throw new Error(`Delegation session ${sessionId} was not found.`);
    const changes = await this.tracking.detect(session);
    return this.sessions.update(sessionId, {
      changes,
      ...(changes.length ? { status: "result-detected" as const } : {}),
    });
  }
  async cancel(
    workflowId: string,
    sessionId: string,
  ): Promise<DelegationSession> {
    const session = await this.sessions.update(sessionId, {
      status: "cancelled",
      diagnostics: [
        ...(this.sessions.get(sessionId)?.diagnostics ?? []),
        {
          code: "tracking-cancelled",
          severity: "info",
          message:
            "Keystone stopped tracking. Unsupported external execution may continue.",
        },
      ],
    });
    await this.execution.transition(workflowId, session.taskId, "cancelled");
    return session;
  }

  private resolve(
    workflowId: string,
    taskId: string,
  ): {
    workflow: DevelopmentWorkflowSnapshot;
    task: DevelopmentTask;
    specification: DevelopmentSpecification;
    agent: CopilotAgentDescriptor;
  } {
    const workflow = this.workflows.get(workflowId);
    if (!workflow) throw new Error(`Workflow ${workflowId} was not found.`);
    const task = workflow.tasks.find((item) => item.id === taskId);
    if (!task) throw new Error(`Task ${taskId} was not found.`);
    if (!workflow.specification)
      throw new Error("The workflow has no specification.");
    const agentId =
      task.assignedAgentId ?? this.registry.selections.get(taskId);
    if (!agentId) throw new Error("The task has no confirmed agent selection.");
    const agent = this.registry.getProfile(agentId);
    if (!agent)
      throw new Error(
        `Selected agent ${agentId} is not in the current registry.`,
      );
    return { workflow, task, specification: workflow.specification, agent };
  }
}

function section(title: string, items: string[]): string {
  return `\n${title}:\n${items.length ? items.map((item) => `- ${item}`).join("\n") : "- No canonical item supplied."}`;
}
function normalized(values: string[], rootUri: string): string[] {
  const base = rootUri.replace(/\/$/, "");
  return [
    ...new Set(
      values.map((value) =>
        decodeURIComponent(value.replace(/^file:\/\//, ""))
          .replace(decodeURIComponent(base.replace(/^file:\/\//, "")), "")
          .replace(/^\//, ""),
      ),
    ),
  ].sort();
}
function sameArea(left: string, right: string): boolean {
  const leftParts = left.split("/");
  const rightParts = right.split("/");
  return (
    leftParts.length > 1 &&
    rightParts.length > 1 &&
    leftParts[0] === rightParts[0] &&
    leftParts[1] === rightParts[1]
  );
}
async function digest(value: string): Promise<string> {
  const hash = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(value),
  );
  return `sha256:${Array.from(new Uint8Array(hash), (item) => item.toString(16).padStart(2, "0")).join("")}`;
}
