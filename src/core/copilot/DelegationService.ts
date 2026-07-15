import type { CopilotAdapter, DelegationRequest } from "./CopilotAdapter";
import type { AgentRegistry } from "./AgentRegistry";
import type { ContextEngine } from "../context/ContextEngine";
import {
  type Workflow,
  type Task,
  WorkflowSchema
} from "../../shared/contracts/domain";
import { KeystoneError } from "../../shared/errors/KeystoneError";

export interface DelegationOutcome {
  success: boolean;
  method: "direct" | "assisted";
  agentId: string;
  externalHandle?: string;
  error?: string;
  observedChanges?: { files: string[]; commits: string[] };
}

export class DelegationService {
  constructor(
    private readonly copilotAdapter: CopilotAdapter,
    private readonly agentRegistry: AgentRegistry,
    private readonly contextEngine: ContextEngine
  ) {}

  async delegate(
    taskId: string,
    workflowId: string,
    task: Task,
    specificationRevision: number
  ): Promise<DelegationOutcome> {
    // Select agent
    const selection = this.agentRegistry.select(taskId);
    if (!selection.agentId) {
      return {
        success: false,
        method: "assisted",
        agentId: "",
        error: "No agent available for delegation."
      };
    }

    // Assign agent
    const assignment = this.agentRegistry.assign(taskId, workflowId, selection.agentId);

    // Build context package
    const contextResult = await this.contextEngine.buildPackage(taskId, specificationRevision);

    // Prepare delegation request
    const request: DelegationRequest = {
      taskId,
      objective: task.objective,
      description: task.description,
      contextPackage: {
        items: contextResult.package.items.map((item) => ({
          kind: item.kind,
          content: item.sourceReference,
          sourceReference: item.sourceReference,
          selectionReason: item.selectionReason
        })),
        fingerprint: contextResult.package.fingerprint,
        estimatedTokens: contextResult.package.estimatedTokens
      },
      expectedOutput: task.expectedOutput,
      acceptanceCriteria: task.acceptanceCriterionIds || [],
      validationSteps: task.validationSteps || []
    };

    // Delegate to agent
    const result = await this.copilotAdapter.delegate(request);

    return {
      success: result.success,
      method: result.method,
      agentId: assignment.agentId,
      externalHandle: result.externalHandle,
      error: result.error,
      observedChanges: result.observedChanges
    };
  }

  createWorkflow(
    id: string,
    specificationId: string,
    title: string,
    status: Workflow["status"] = "drafting"
  ): Workflow {
    const workflow: Workflow = {
      id,
      repositoryId: specificationId,
      activeIntentRevision: 0,
      activeSpecificationRevision: 0,
      status,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      validationRunIds: [],
      uiResumeRoute: "/intelligence",
      activitySummary: title
    };

    const validated = WorkflowSchema.safeParse(workflow);
    if (!validated.success) {
      throw new KeystoneError({
        code: "WORKFLOW_VALIDATION_FAILED",
        category: "INTERNAL",
        message: "Workflow creation failed validation.",
        operation: "workflow.create",
        recoverable: false,
        recommendedAction: "Review the workflow fields and retry."
      });
    }

    return validated.data;
  }
}
