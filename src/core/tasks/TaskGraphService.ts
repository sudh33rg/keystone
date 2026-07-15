import type { WorkspaceStateStore } from "../../core/persistence/WorkspaceStateStore";
import {
  type Task,
  type TaskGraph,
  type AcceptanceCriterion,
  type AgentAssignment,
  type TaskAttempt,
  TaskSchema,
  TaskAttemptSchema
} from "../../shared/contracts/domain";
import { KeystoneError } from "../../shared/errors/KeystoneError";

export class TaskGraphService {
  private taskGraphs = new Map<string, TaskGraph>();
  private tasks = new Map<string, Task>();
  private attempts = new Map<string, TaskAttempt>();

  constructor(
    private readonly store: WorkspaceStateStore
  ) {}

  generateFromSpecification(
    specificationId: string,
    specificationRevision: number,
    criteria: AcceptanceCriterion[]
  ): TaskGraph {
    const graphId = crypto.randomUUID();
    const tasks: Task[] = [];
    const taskIds: string[] = [];

    // Generate tasks based on criteria
    for (const criterion of criteria) {
      if (criterion.coveringTaskIds.length > 0) {
        // Existing tasks referenced by criteria
        for (const taskId of criterion.coveringTaskIds) {
          const existing = this.tasks.get(taskId);
          if (existing) {
            tasks.push(existing);
            taskIds.push(existing.id);
          }
        }
      } else {
        // Generate a new task for this criterion
        const taskId = crypto.randomUUID();
        const task: Task = {
          id: taskId,
          title: `Implement: ${criterion.description}`,
          objective: criterion.description,
          description: `Address criterion: ${criterion.description}`,
          status: "pending",
          dependencies: [],
          requiredContextPolicy: {
            selectionSeeds: [],
            budget: 12000,
            mandatoryItems: [],
            excludedItems: []
          },
          expectedFiles: [],
          expectedOutput: criterion.description,
          acceptanceCriterionIds: [criterion.id],
          validationSteps: [{
            command: undefined,
            manualCheck: criterion.description,
            policyClass: "manual"
          }],
          retryHistory: [],
          executionNotes: [],
          baseFingerprint: {
            specRevision: specificationRevision,
            indexVersion: 0
          }
        };

        const validated = TaskSchema.safeParse(task);
        if (validated.success) {
          tasks.push(validated.data);
          taskIds.push(validated.data.id);
          this.tasks.set(validated.data.id, validated.data);
        }
      }
    }

    // Topological sort
    const topologicalOrder = this.topologicalSort(tasks);

    const graph: TaskGraph = {
      id: graphId,
      workflowId: "",
      specificationId,
      specificationRevision,
      graphRevision: 1,
      taskIds,
      generatedAt: new Date().toISOString(),
      generationProvenance: "specification-generated",
      validationStatus: "pending",
      topologicalOrder
    };

    this.taskGraphs.set(graphId, graph);
    return graph;
  }

  getGraph(graphId: string): TaskGraph | undefined {
    return this.taskGraphs.get(graphId);
  }

  getTask(taskId: string): Task | undefined {
    return this.tasks.get(taskId);
  }

  getAllTasks(): Task[] {
    return Array.from(this.tasks.values());
  }

  updateTask(taskId: string, updates: Partial<Task>): Task {
    const task = this.tasks.get(taskId);
    if (!task) {
      throw new KeystoneError({
        code: "TASK_NOT_FOUND",
        category: "INTERNAL",
        message: `Task ${taskId} not found.`,
        operation: "task.update",
        recoverable: false,
        recommendedAction: "Generate a task graph first."
      });
    }

    const next: Task = { ...task, ...updates };
    const validated = TaskSchema.safeParse(next);
    if (!validated.success) {
      throw new KeystoneError({
        code: "TASK_VALIDATION_FAILED",
        category: "INTERNAL",
        message: "Task update failed validation.",
        operation: "task.update",
        recoverable: false,
        recommendedAction: "Review the task fields and retry."
      });
    }

    this.tasks.set(taskId, validated.data);

    // Update graph topological order
    for (const graph of this.taskGraphs.values()) {
      if (graph.taskIds.includes(taskId)) {
        graph.topologicalOrder = this.topologicalSort(this.getAllTasks());
      }
    }

    return validated.data;
  }

  createAttempt(
    taskId: string,
    agentAssignment: AgentAssignment,
    contextPackageId: string,
    delegationMethod: "direct" | "assisted"
  ): TaskAttempt {
    const task = this.tasks.get(taskId);
    if (!task) {
      throw new KeystoneError({
        code: "TASK_NOT_FOUND",
        category: "INTERNAL",
        message: `Task ${taskId} not found.`,
        operation: "task.createAttempt",
        recoverable: false,
        recommendedAction: "Generate a task graph first."
      });
    }

    const attemptNumber = (task.attemptNumber ?? 0) + 1;

    const attempt: TaskAttempt = {
      id: crypto.randomUUID(),
      attemptNumber,
      taskId,
      agentAssignmentSnapshot: {
        agentId: agentAssignment.agentId,
        selectionMode: agentAssignment.selectionMode,
        capabilityFingerprint: agentAssignment.capabilityFingerprint
      },
      contextPackageId,
      delegationMethod,
      startedAt: new Date().toISOString(),
      state: "delegating",
      userConfirmations: []
    };

    const validated = TaskAttemptSchema.safeParse(attempt);
    if (!validated.success) {
      throw new KeystoneError({
        code: "ATTEMPT_VALIDATION_FAILED",
        category: "INTERNAL",
        message: "Task attempt failed validation.",
        operation: "task.createAttempt",
        recoverable: false,
        recommendedAction: "Review the attempt fields and retry."
      });
    }

    this.attempts.set(attempt.id, validated.data);
    task.attemptNumber = attemptNumber;
    return validated.data;
  }

  transitionTask(taskId: string, from: Task["status"], to: Task["status"], agentAssignment?: AgentAssignment, contextPackageId?: string): Task {
    const task = this.tasks.get(taskId);
    if (!task) {
      throw new KeystoneError({
        code: "TASK_NOT_FOUND",
        category: "INTERNAL",
        message: `Task ${taskId} not found.`,
        operation: "task.transition",
        recoverable: false,
        recommendedAction: "Generate a task graph first."
      });
    }

    const validTransitions: Record<string, string[]> = {
      pending: ["ready", "cancelled", "blocked"],
      ready: ["awaiting_approval", "delegating", "skipped", "cancelled", "blocked"],
      awaiting_approval: ["ready", "delegating", "cancelled"],
      delegating: ["executing", "awaiting_user", "cancelled"],
      executing: ["awaiting_user", "validating", "cancelled"],
      awaiting_user: ["validating", "cancelled"],
      validating: ["passed", "failed", "blocked"],
      passed: [],
      failed: ["ready"],
      skipped: [],
      cancelled: [],
      blocked: ["ready"]
    };

    const allowed = validTransitions[from];
    if (!allowed?.includes(to)) {
      throw new KeystoneError({
        code: "TASK_INVALID_TRANSITION",
        category: "INTERNAL",
        message: `Cannot transition task ${taskId} from ${from} to ${to}.`,
        operation: "task.transition",
        recoverable: false,
        recommendedAction: "Review the task state machine and retry."
      });
    }

    // Record attempt when entering delegating state
    if (to === "delegating" && agentAssignment && contextPackageId) {
      this.createAttempt(taskId, agentAssignment, contextPackageId, "assisted");
    }

    return this.updateTask(taskId, { status: to });
  }

  private topologicalSort(tasks: Task[]): string[] {
    const graph = new Map<string, Set<string>>();
    const inDegree = new Map<string, number>();

    for (const task of tasks) {
      graph.set(task.id, new Set(task.dependencies));
      inDegree.set(task.id, task.dependencies.length);
    }

    const queue: string[] = [];
    for (const [taskId, degree] of inDegree) {
      if (degree === 0) queue.push(taskId);
    }

    const order: string[] = [];
    while (queue.length > 0) {
      const current = queue.shift()!;
      order.push(current);

      for (const task of tasks) {
        if (task.dependencies.includes(current)) {
          const deps = graph.get(task.id)!;
          deps.delete(current);
          inDegree.set(task.id, inDegree.get(task.id)! - 1);
          if (inDegree.get(task.id) === 0) {
            queue.push(task.id);
          }
        }
      }
    }

    return order;
  }
}
