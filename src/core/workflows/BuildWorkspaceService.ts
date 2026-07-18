import type { DelegationPersistenceStore } from "../persistence/DelegationPersistenceStore";
import type { DevelopmentWorkflowService } from "./DevelopmentWorkflowService";
import type { CopilotAdapter } from "../copilot/CopilotAdapter";
import type { CopilotAgentRegistry } from "../copilot/AgentRegistry";
import type { CopilotCustomizationService } from "../copilot/CopilotCustomizationService";
import type { TaskContextService } from "../context/TaskContextService";
import type { DelegationService } from "../copilot/DelegationService";
import type { TaskExecutionService } from "../execution/TaskExecutionService";
import type { ValidationOrchestrator } from "../validation/TaskValidationService";
import type { CompletionDecisionService } from "../execution/CompletionService";
import {
  BuildTaskQueueSchema,
  BuildTaskStateSchema,
  type BuildReadinessCheck,
  type BuildTaskQueue,
  type BuildTaskState,
} from "../../shared/contracts/build";
import type {
  DevelopmentTask,
  DevelopmentWorkflowSnapshot,
} from "../../shared/contracts/delegation";

export class BuildWorkspaceService {
  constructor(
    private readonly persistence: DelegationPersistenceStore,
    private readonly workflows: DevelopmentWorkflowService,
    private readonly copilot: CopilotAdapter,
    private readonly agents: CopilotAgentRegistry,
    private readonly customizations: CopilotCustomizationService,
    private readonly contexts: TaskContextService,
    private readonly delegation: DelegationService,
    private readonly executions: TaskExecutionService,
    private readonly validation: ValidationOrchestrator,
    private readonly completion: CompletionDecisionService,
  ) {}

  async select(workflowId: string, taskId: string): Promise<BuildTaskState> {
    this.requireTask(workflowId, taskId);
    await this.persistence.update((state) => ({
      ...state,
      selectedTaskByWorkflow: {
        ...state.selectedTaskByWorkflow,
        [workflowId]: taskId,
      },
    }));
    return this.state(workflowId, taskId);
  }
  async start(workflowId: string, taskId: string): Promise<BuildTaskState> {
    const { workflow, task } = this.requireTask(workflowId, taskId);
    const blockers = this.readiness(workflow, task).filter(
      (item) => item.blocking && !item.passed,
    );
    if (blockers.length)
      throw new Error(
        `Task start blocked: ${blockers.map((item) => item.explanation).join(" ")}`,
      );
    const active = workflow.tasks.find(
      (item) =>
        item.id !== taskId && item.status === "executing" && codeWriting(item),
    );
    if (active && codeWriting(task))
      throw new Error(
        `Another code-writing task is active: ${active.title}. Pause or complete it first.`,
      );
    await this.delegation.captureBuildBaseline(task);
    await this.workflows.setTaskStatus(
      workflowId,
      taskId,
      task.executionRoute === "manual" ? "executing" : "delegating",
    );
    return this.select(workflowId, taskId);
  }
  async pause(workflowId: string, taskId: string): Promise<BuildTaskState> {
    await this.workflows.setTaskStatus(
      workflowId,
      taskId,
      "blocked",
      "Paused by the user; resume requires readiness revalidation.",
    );
    return this.state(workflowId, taskId);
  }
  async resume(workflowId: string, taskId: string): Promise<BuildTaskState> {
    const { workflow, task } = this.requireTask(workflowId, taskId);
    const blockers = this.readiness(workflow, task).filter(
      (item) => item.blocking && !item.passed && item.code !== "task-status",
    );
    if (blockers.length)
      throw new Error(
        `Resume blocked: ${blockers.map((item) => item.explanation).join(" ")}`,
      );
    await this.workflows.setTaskStatus(
      workflowId,
      taskId,
      task.executionRoute === "manual" ? "executing" : "delegating",
    );
    return this.state(workflowId, taskId);
  }
  async block(
    workflowId: string,
    taskId: string,
    reason: string,
  ): Promise<BuildTaskState> {
    await this.workflows.setTaskStatus(workflowId, taskId, "blocked", reason);
    return this.state(workflowId, taskId);
  }
  async cancel(workflowId: string, taskId: string): Promise<BuildTaskState> {
    await this.workflows.setTaskStatus(workflowId, taskId, "cancelled");
    return this.state(workflowId, taskId);
  }

  queue(workflowId: string): BuildTaskQueue {
    const workflow = this.requireWorkflow(workflowId);
    const snapshot = this.workflows.getCurrentSnapshot();
    const selectedTaskId =
      this.persistence.snapshot.selectedTaskByWorkflow[workflowId];
    return BuildTaskQueueSchema.parse({
      schemaVersion: 1,
      workflowId,
      selectedTaskId,
      activeTaskId: workflow.tasks.find((task) =>
        ["delegating", "awaiting-external-start", "executing"].includes(
          task.status,
        ),
      )?.id,
      items: workflow.tasks.map((task) => ({
        task,
        group: group(
          task,
          this.executions.sessions
            .list()
            .filter((item) => item.taskId === task.id)
            .at(-1)?.status,
        ),
        owner: task.assignedAgentId,
        validationSummary: validationSummary(
          task,
          this.executions,
          this.validation,
        ),
        blockerSummary:
          task.status === "blocked"
            ? (task.staleReasons.at(-1) ?? "Task is blocked.")
            : undefined,
        readiness: this.readiness(workflow, task),
      })),
      repositoryGeneration: snapshot?.manifest.generation ?? 0,
      branch: snapshot?.repository.branch,
      head: snapshot?.repository.headCommit,
    });
  }

  async state(workflowId: string, taskId?: string): Promise<BuildTaskState> {
    const workflow = this.requireWorkflow(workflowId);
    const queue = this.queue(workflowId);
    const task =
      workflow.tasks.find(
        (item) =>
          item.id === (taskId ?? queue.selectedTaskId ?? queue.activeTaskId),
      ) ??
      workflow.tasks.find((item) => item.status === "ready") ??
      workflow.tasks[0];
    if (!task) throw new Error("The approved workflow contains no user tasks.");
    const capabilities =
      this.copilot.getCapabilities() ??
      (await this.copilot.refreshCapabilities());
    const agents = this.agents.getProfiles();
    const recommendation = this.agents.recommend(task);
    const context = this.contexts.get(task.id);
    const prepared = this.delegation.getPrepared(task.id);
    const delegationSession = this.delegation.sessions
      .list()
      .filter((item) => item.taskId === task.id)
      .at(-1);
    const execution = this.executions.sessions
      .list()
      .filter((item) => item.taskId === task.id)
      .at(-1);
    const validationPlan = execution?.validationPlanId
      ? this.validation.getPlan(execution.validationPlanId)
      : undefined;
    const validationRun = execution?.validationRunIds.length
      ? this.validation.getRun(execution.validationRunIds.at(-1)!)
      : undefined;
    const retry = execution
      ? this.executions.getRetry(execution.id)
      : undefined;
    let completion;
    if (execution) {
      try {
        completion = this.completion.evaluate(execution.id);
      } catch {
        completion = undefined;
      }
    }
    const customizations = await this.customizations.discover(task);
    const readiness = this.readiness(workflow, task);
    return BuildTaskStateSchema.parse({
      schemaVersion: 1,
      workflow,
      task,
      queue,
      readiness,
      capabilities,
      agents,
      recommendedAgentId: recommendation.candidates[0]?.agent.id,
      customizations,
      context,
      prepared,
      delegationSession,
      execution,
      validationPlan,
      validationRun,
      retry,
      completion,
      nextAction: nextAction(
        task,
        context,
        prepared,
        execution,
        validationRun,
        completion,
      ),
      diagnostics: [],
    });
  }

  private readiness(
    workflow: DevelopmentWorkflowSnapshot,
    task: DevelopmentTask,
  ): BuildReadinessCheck[] {
    const snapshot = this.workflows.getCurrentSnapshot();
    const checks: BuildReadinessCheck[] = [];
    const add = (
      code: string,
      label: string,
      passed: boolean,
      explanation: string,
      recoveryAction: string,
      blocking = true,
    ): void => {
      checks.push({
        code,
        label,
        passed,
        blocking,
        explanation,
        recoveryAction,
      });
    };
    add(
      "specification-approved",
      "Specification approved",
      workflow.specification?.status === "approved",
      "The current specification revision must be approved.",
      "Return to Define and approve it.",
    );
    add(
      "plan-approved",
      "Task plan approved",
      Boolean(workflow.taskGraph?.ready),
      "The task plan requires explicit approval.",
      "Return to Plan and approve it.",
    );
    add(
      "dependencies-complete",
      "Dependencies complete",
      task.dependencies.every(
        (id) =>
          workflow.tasks.find((item) => item.id === id)?.status === "completed",
      ),
      "All dependencies must be explicitly completed.",
      "Complete or unblock dependency tasks.",
    );
    add(
      "repository-compatible",
      "Repository compatible",
      Boolean(
        snapshot &&
        snapshot.repository.id === workflow.repositoryId &&
        snapshot.repository.branch === workflow.branch,
      ),
      "The active repository and branch must match the workflow baseline.",
      "Review repository changes and reconcile the workflow.",
    );
    add(
      "intelligence-current",
      "Intelligence current",
      Boolean(
        snapshot &&
        snapshot.manifest.generation >= workflow.intelligenceGeneration,
      ),
      "Current Intelligence cannot be older than the workflow.",
      "Wait for Intelligence reconciliation and refresh.",
    );
    add(
      "execution-route",
      "Execution route supported",
      task.executionRoute !== "unsupported",
      "The selected task needs a supported deterministic, Copilot, or manual route.",
      "Edit the task route in Plan.",
    );
    add(
      "copilot-capability",
      "Copilot capability available",
      task.executionRoute !== "github-copilot" ||
        Boolean(this.copilot.getCapabilities()?.extensionDetected),
      "GitHub Copilot tasks require detected capability; context can still be prepared.",
      "Refresh capabilities or use an explicitly supported manual route.",
    );
    add(
      "no-conflict",
      "No conflicting active task",
      !workflow.tasks.some(
        (item) =>
          item.id !== task.id &&
          item.status === "executing" &&
          codeWriting(item) &&
          codeWriting(task),
      ),
      "Only one code-writing task may own the working tree by default.",
      "Pause or complete the active code-writing task.",
    );
    add(
      "task-status",
      "Task selectable",
      !["stale", "cancelled", "completed"].includes(task.status),
      `Task status is ${task.status}.`,
      "Select another task or repair its state.",
    );
    return checks;
  }
  private requireWorkflow(id: string): DevelopmentWorkflowSnapshot {
    const workflow = this.workflows.get(id);
    if (!workflow) throw new Error("Workflow not found.");
    return workflow;
  }
  private requireTask(
    workflowId: string,
    taskId: string,
  ): { workflow: DevelopmentWorkflowSnapshot; task: DevelopmentTask } {
    const workflow = this.requireWorkflow(workflowId);
    const task = workflow.tasks.find((item) => item.id === taskId);
    if (!task) throw new Error("Task not found.");
    return { workflow, task };
  }
}

function codeWriting(task: DevelopmentTask): boolean {
  return !["review", "validation", "manual", "documentation"].includes(
    task.category,
  );
}
function group(
  task: DevelopmentTask,
  execution?: string,
): BuildTaskQueue["items"][number]["group"] {
  if (task.status === "completed") return "completed";
  if (task.status === "blocked" || task.status === "stale") return "blocked";
  if (
    ["executing", "delegating", "awaiting-external-start"].includes(task.status)
  )
    return "in-progress";
  if (
    execution === "validation-required" ||
    execution === "validation-failed" ||
    execution === "validating"
  )
    return "awaiting-validation";
  if (execution === "awaiting-user-review") return "awaiting-review";
  return "ready";
}
function validationSummary(
  task: DevelopmentTask,
  executions: TaskExecutionService,
  validation: ValidationOrchestrator,
): string {
  const execution = executions.sessions
    .list()
    .filter((item) => item.taskId === task.id)
    .at(-1);
  const run = execution?.validationRunIds.length
    ? validation.getRun(execution.validationRunIds.at(-1)!)
    : undefined;
  return run
    ? `${run.status}: ${run.summary.requiredStepsPassed + run.summary.optionalStepsPassed} passed, ${run.summary.requiredStepsFailed} failed`
    : "Validation not run";
}
function nextAction(
  task: DevelopmentTask,
  context: unknown,
  prepared: unknown,
  execution: { status: string } | undefined,
  run: { status: string } | undefined,
  completion: { status: string } | undefined,
): string {
  if (task.status === "ready")
    return "Start the task after reviewing readiness.";
  if (!context) return "Build the deterministic context package.";
  if (!prepared)
    return "Review context and prepare the exact delegation prompt.";
  if (!execution) return "Approve and start the supported delegation mode.";
  if (!run) return "Capture the result and create the task validation plan.";
  if (completion?.status === "ready")
    return "Request explicit completion review.";
  return `Resolve the current ${execution.status} execution and ${run.status} validation state.`;
}
