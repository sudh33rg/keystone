import type { WorkspaceStateStore } from "../../core/persistence/WorkspaceStateStore";
import {
  type Workflow,
  type Task,
  type TaskGraph,
  WorkflowSchema,
  TaskSchema,
  TaskGraphSchema,
  SCHEMA_VERSION
} from "../../shared/contracts/domain";
import { KeystoneError } from "../../shared/errors/KeystoneError";
import type { TaskGraphService } from "../tasks/TaskGraphService";

export type ApprovalPolicy = "none" | "required" | "on-failure";

export class WorkflowOrchestrator {
  private workflows = new Map<string, Workflow>();
  private approvalPolicy: ApprovalPolicy = "required";

  constructor(
    private readonly store: WorkspaceStateStore,
    private readonly taskGraphService: TaskGraphService,
    approvalPolicy?: ApprovalPolicy
  ) {
    if (approvalPolicy) {
      this.approvalPolicy = approvalPolicy;
    }
  }

  setApprovalPolicy(policy: ApprovalPolicy): void {
    this.approvalPolicy = policy;
  }

  getApprovalPolicy(): ApprovalPolicy {
    return this.approvalPolicy;
  }

  startWorkflow(workflow: Workflow): Workflow {
    if (workflow.status !== "draft" && workflow.status !== "paused") {
      throw new KeystoneError({
        code: "WORKFLOW_INVALID_STATUS",
        category: "WORKFLOW",
        message: `Cannot start workflow in status ${workflow.status}.`,
        operation: "workflow.start",
        recoverable: false,
        recommendedAction: "Set the workflow to draft or paused before starting."
      });
    }

    const updated = { ...workflow, status: "running", updatedAt: new Date().toISOString() };
    const validated = WorkflowSchema.safeParse(updated);
    if (!validated.success) {
      throw new KeystoneError({
        code: "WORKFLOW_VALIDATION_FAILED",
        category: "WORKFLOW",
        message: "Workflow start failed validation.",
        operation: "workflow.start",
        recoverable: false,
        recommendedAction: "Review the workflow fields and retry."
      });
    }

    this.workflows.set(workflow.id, validated.data);
    return validated.data;
  }

  pauseWorkflow(workflowId: string): Workflow {
    const workflow = this.workflows.get(workflowId);
    if (!workflow) {
      throw new KeystoneError({
        code: "WORKFLOW_NOT_FOUND",
        category: "WORKFLOW",
        message: `Workflow ${workflowId} not found.`,
        operation: "workflow.pause",
        recoverable: false,
        recommendedAction: "Check the workflow ID and retry."
      });
    }

    const updated = { ...workflow, status: "paused", updatedAt: new Date().toISOString() };
    const validated = WorkflowSchema.safeParse(updated);
    if (!validated.success) {
      throw new KeystoneError({
        code: "WORKFLOW_VALIDATION_FAILED",
        category: "WORKFLOW",
        message: "Workflow pause failed validation.",
        operation: "workflow.pause",
        recoverable: false,
        recommendedAction: "Review the workflow fields and retry."
      });
    }

    this.workflows.set(workflowId, validated.data);
    return validated.data;
  }

  skipTask(workflowId: string, taskId: string): Workflow {
    const workflow = this.workflows.get(workflowId);
    if (!workflow) {
      throw new KeystoneError({
        code: "WORKFLOW_NOT_FOUND",
        category: "WORKFLOW",
        message: `Workflow ${workflowId} not found.`,
        operation: "workflow.skip",
        recoverable: false,
        recommendedAction: "Check the workflow ID and retry."
      });
    }

    // Mark task as skipped
    this.taskGraphService.transitionTask(taskId, "ready", "skipped");

    return workflow;
  }

  cancelWorkflow(workflowId: string): Workflow {
    const workflow = this.workflows.get(workflowId);
    if (!workflow) {
      throw new KeystoneError({
        code: "WORKFLOW_NOT_FOUND",
        category: "WORKFLOW",
        message: `Workflow ${workflowId} not found.`,
        operation: "workflow.cancel",
        recoverable: false,
        recommendedAction: "Check the workflow ID and retry."
      });
    }

    const updated = { ...workflow, status: "cancelled", updatedAt: new Date().toISOString() };
    const validated = WorkflowSchema.safeParse(updated);
    if (!validated.success) {
      throw new KeystoneError({
        code: "WORKFLOW_VALIDATION_FAILED",
        category: "WORKFLOW",
        message: "Workflow cancellation failed validation.",
        operation: "workflow.cancel",
        recoverable: false,
        recommendedAction: "Review the workflow fields and retry."
      });
    }

    this.workflows.set(workflowId, validated.data);
    return validated.data;
  }

  completeWorkflow(workflowId: string): Workflow {
    const workflow = this.workflows.get(workflowId);
    if (!workflow) {
      throw new KeystoneError({
        code: "WORKFLOW_NOT_FOUND",
        category: "WORKFLOW",
        message: `Workflow ${workflowId} not found.`,
        operation: "workflow.complete",
        recoverable: false,
        recommendedAction: "Check the workflow ID and retry."
      });
    }

    const updated = { ...workflow, status: "completed", updatedAt: new Date().toISOString() };
    const validated = WorkflowSchema.safeParse(updated);
    if (!validated.success) {
      throw new KeystoneError({
        code: "WORKFLOW_VALIDATION_FAILED",
        category: "WORKFLOW",
        message: "Workflow completion failed validation.",
        operation: "workflow.complete",
        recoverable: false,
        recommendedAction: "Review the workflow fields and retry."
      });
    }

    this.workflows.set(workflowId, validated.data);
    return validated.data;
  }

  getWorkflow(workflowId: string): Workflow | undefined {
    return this.workflows.get(workflowId);
  }

  getAllWorkflows(): Workflow[] {
    return Array.from(this.workflows.values());
  }

  getReadyTasks(workflowId: string): Task[] {
    const workflow = this.workflows.get(workflowId);
    if (!workflow) return [];

    return this.taskGraphService.getAllTasks().filter(task => task.status === "ready");
  }

  requiresApproval(taskId: string): boolean {
    return this.approvalPolicy === "required";
  }
}
