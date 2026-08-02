import type { ExecutionHandle, WorkflowDefinition, WorkflowRequest, WorkflowRun } from "./model";

export class WorkflowApi {
  private readonly definitions = new Map<string, WorkflowDefinition>();
  private readonly runs = new Map<string, WorkflowRun>();

  register(definition: WorkflowDefinition): WorkflowDefinition {
    this.definitions.set(definition.id, definition);
    return definition;
  }

  listDefinitions(): WorkflowDefinition[] {
    return [...this.definitions.values()];
  }

  start(workflowId: string): WorkflowRun {
    const run: WorkflowRun = {
      id: `workflow-run-${Date.now()}`,
      workflowId,
      status: "running",
      startedAt: new Date().toISOString()
    };
    this.runs.set(run.id, run);
    return run;
  }

  listRuns(): WorkflowRun[] {
    return [...this.runs.values()];
  }

  execute(request: WorkflowRequest | string): ExecutionHandle {
    const workflowId =
      typeof request === "string"
        ? request
        : (request.workflowId ?? request.id ?? request.name ?? "workflow");
    return {
      id: `execution-${workflowId}-${Date.now()}`,
      workflowId,
      state: "running",
      status: "running",
      startedAt: new Date().toISOString(),
      metadata: typeof request === "string" ? undefined : request.metadata
    };
  }

  async create(request: WorkflowRequest): Promise<{ id: string; request: WorkflowRequest }> {
    return {
      id: request.id ?? request.workflowId ?? request.name ?? `workflow-${Date.now()}`,
      request
    };
  }
}

export { WorkflowApi as WorkflowPlatformApi };
