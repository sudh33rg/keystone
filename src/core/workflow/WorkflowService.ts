import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { AtomicFileWriter } from "../persistence/AtomicFileWriter";
import {
  CANONICAL_WORKFLOW_SCHEMA_VERSION,
  canonicalStageOutline,
  CanonicalWorkflowPersistentStateSchema,
  CreateCanonicalWorkflowInputSchema,
  type CanonicalWorkflow,
  type CanonicalWorkflowPersistentState,
  type CanonicalWorkflowStageSummary,
  type CreateCanonicalWorkflowInput,
} from "../../shared/contracts/canonicalWorkflow";

export interface WorkflowPersistence {
  read(): Promise<unknown>;
  write(value: CanonicalWorkflowPersistentState): Promise<void>;
}

export class FileWorkflowPersistence implements WorkflowPersistence {
  constructor(private readonly path: string, private readonly writer = new AtomicFileWriter()) {}
  async read(): Promise<unknown> {
    try { return JSON.parse(await readFile(this.path, "utf8")) as unknown; }
    catch (cause) {
      if (cause instanceof Error && "code" in cause && cause.code === "ENOENT") return undefined;
      return { malformed: true };
    }
  }
  write(value: CanonicalWorkflowPersistentState): Promise<void> { return this.writer.writeJson(this.path, value); }
}

export class WorkflowServiceError extends Error {
  constructor(public readonly code: string, message: string, public readonly recoverable: boolean) { super(message); this.name = "WorkflowServiceError"; }
}

export class WorkflowService {
  private state: CanonicalWorkflowPersistentState = emptyState();
  private readonly pending = new Map<string, Promise<CanonicalWorkflow>>();
  readonly diagnostics: string[] = [];

  constructor(
    private readonly persistence: WorkflowPersistence,
    private readonly now: () => string = () => new Date().toISOString(),
    private readonly createId: () => string = randomUUID,
  ) {}

  async initialize(): Promise<void> {
    const stored = await this.persistence.read();
    if (stored === undefined) { this.state = emptyState(this.now()); return; }
    const parsed = CanonicalWorkflowPersistentStateSchema.safeParse(stored);
    if (!parsed.success) {
      this.diagnostics.push("Stored workflow state is malformed and was not loaded.");
      this.state = emptyState(this.now());
      return;
    }
    this.state = parsed.data;
    if (this.state.activeWorkflowId && !this.state.workflows.some((item) => item.id === this.state.activeWorkflowId && item.status === "active")) {
      this.diagnostics.push("Stored active workflow reference is stale.");
      this.state = { ...this.state, activeWorkflowId: null };
    }
  }

  createWorkflow(raw: CreateCanonicalWorkflowInput, correlationId: string): Promise<CanonicalWorkflow> {
    if (!correlationId.trim() || correlationId.length > 200) return Promise.reject(new WorkflowServiceError("CORRELATION_ID_INVALID", "A valid workflow correlation ID is required.", true));
    const priorId = this.state.correlations[correlationId];
    if (priorId) {
      const prior = this.getWorkflow(priorId);
      if (prior) return Promise.resolve(prior);
    }
    const current = this.pending.get(correlationId);
    if (current) return current;
    const creation = this.createAndPersist(raw, correlationId).finally(() => this.pending.delete(correlationId));
    this.pending.set(correlationId, creation);
    return creation;
  }

  private async createAndPersist(raw: CreateCanonicalWorkflowInput, correlationId: string): Promise<CanonicalWorkflow> {
    const parsed = CreateCanonicalWorkflowInputSchema.safeParse(raw);
    if (!parsed.success) {
      const intentIssue = parsed.error.issues.some((issue) => issue.path[0] === "intent");
      throw new WorkflowServiceError(intentIssue ? "WORKFLOW_INTENT_INVALID" : "WORKFLOW_INPUT_INVALID", parsed.error.issues[0]?.message ?? "Workflow input is invalid.", true);
    }
    if (this.getActiveWorkflow()) throw new WorkflowServiceError("ACTIVE_WORKFLOW_EXISTS", "Complete or cancel the current workflow before starting another.", true);
    const timestamp = this.now();
    const stages = canonicalStageOutline(parsed.data.workType).map((stage, index): CanonicalWorkflowStageSummary => ({ id: this.createId(), ...stage, order: index + 1, status: index === 0 ? "ready" : "not-ready", required: true }));
    const workflow: CanonicalWorkflow = {
      schemaVersion: CANONICAL_WORKFLOW_SCHEMA_VERSION,
      id: this.createId(),
      intent: { text: parsed.data.intent, workType: parsed.data.workType },
      ...(parsed.data.specification ? { specification: { text: parsed.data.specification, revision: 1 } } : {}),
      status: "active",
      stages,
      currentStageId: stages[0]?.id ?? null,
      createdAt: timestamp,
      updatedAt: timestamp,
    };
    const next: CanonicalWorkflowPersistentState = {
      schemaVersion: CANONICAL_WORKFLOW_SCHEMA_VERSION,
      revision: this.state.revision + 1,
      workflows: [...this.state.workflows, workflow],
      activeWorkflowId: workflow.id,
      correlations: { ...this.state.correlations, [correlationId]: workflow.id },
      updatedAt: timestamp,
    };
    await this.persistence.write(next);
    this.state = next;
    return workflow;
  }

  getWorkflow(id: string): CanonicalWorkflow | undefined { return this.state.workflows.find((workflow) => workflow.id === id); }
  getActiveWorkflow(): CanonicalWorkflow | null { return this.state.activeWorkflowId ? this.getWorkflow(this.state.activeWorkflowId) ?? null : null; }
  listWorkflows(): CanonicalWorkflow[] { return this.state.workflows.slice().sort((left, right) => right.updatedAt.localeCompare(left.updatedAt)); }
  async activateDevelopmentStage(workflowId: string): Promise<CanonicalWorkflow> {
    const workflow = this.getWorkflow(workflowId);
    if (!workflow) throw new WorkflowServiceError("WORKFLOW_NOT_FOUND", "The selected workflow was not found.", true);
    const development = workflow.stages.find((stage) => stage.type === "development");
    if (!development) throw new WorkflowServiceError("DEVELOPMENT_STAGE_NOT_FOUND", "This workflow does not contain a Development stage.", true);
    if (workflow.currentStageId === development.id && development.status === "ready") return workflow;
    const timestamp = this.now();
    const updated: CanonicalWorkflow = {
      ...workflow,
      stages: workflow.stages.map((stage) => stage.order < development.order ? { ...stage, status: "completed" as const } : stage.id === development.id ? { ...stage, status: "ready" as const } : stage),
      currentStageId: development.id,
      updatedAt: timestamp,
    };
    await this.replaceWorkflow(updated, timestamp);
    return updated;
  }
  async completeDevelopmentStage(workflowId: string, stageId: string): Promise<CanonicalWorkflow> {
    const workflow = this.getWorkflow(workflowId);
    if (!workflow) throw new WorkflowServiceError("WORKFLOW_NOT_FOUND", "The selected workflow was not found.", true);
    const development = workflow.stages.find((stage) => stage.id === stageId && stage.type === "development");
    if (!development) throw new WorkflowServiceError("DEVELOPMENT_STAGE_NOT_FOUND", "The Development stage was not found.", true);
    const nextStage = workflow.stages.find((stage) => stage.type === "impact-analysis")
      ?? workflow.stages.filter((stage) => stage.order > development.order).sort((left, right) => left.order - right.order)[0];
    const timestamp = this.now();
    const updated: CanonicalWorkflow = {
      ...workflow,
      stages: workflow.stages.map((stage) => stage.id === development.id ? { ...stage, status: "completed" as const } : stage.id === nextStage?.id ? { ...stage, status: "ready" as const } : stage),
      currentStageId: nextStage?.id ?? null,
      status: nextStage ? workflow.status : "completed",
      updatedAt: timestamp,
    };
    await this.replaceWorkflow(updated, timestamp);
    return updated;
  }
  async acceptImpactAnalysisStage(workflowId: string): Promise<CanonicalWorkflow> {
    const workflow = this.getWorkflow(workflowId);
    if (!workflow) throw new WorkflowServiceError("WORKFLOW_NOT_FOUND", "The selected workflow was not found.", true);
    const impact = workflow.stages.find((stage) => stage.type === "impact-analysis");
    const qa = workflow.stages.find((stage) => stage.type === "qa");
    if (!impact || !qa) throw new WorkflowServiceError("IMPACT_QA_STAGE_NOT_FOUND", "This workflow does not contain Impact Analysis and QA stages.", true);
    const timestamp = this.now();
    const updated: CanonicalWorkflow = { ...workflow, stages: workflow.stages.map((stage) => stage.id === impact.id ? { ...stage, status: "completed" as const } : stage.id === qa.id ? { ...stage, status: "ready" as const } : stage), currentStageId: qa.id, updatedAt: timestamp };
    await this.replaceWorkflow(updated, timestamp); return updated;
  }
  async completeQaStage(workflowId: string): Promise<CanonicalWorkflow> {
    const workflow = this.getWorkflow(workflowId);
    if (!workflow) throw new WorkflowServiceError("WORKFLOW_NOT_FOUND", "The selected workflow was not found.", true);
    const qa = workflow.stages.find((stage) => stage.type === "qa");
    if (!qa) throw new WorkflowServiceError("QA_STAGE_NOT_FOUND", "This workflow does not contain a QA stage.", true);
    const nextStage = workflow.stages.filter((stage) => stage.order > qa.order).sort((left, right) => left.order - right.order)[0]; const timestamp = this.now();
    const updated: CanonicalWorkflow = { ...workflow, stages: workflow.stages.map((stage) => stage.id === qa.id ? { ...stage, status: "completed" as const } : stage.id === nextStage?.id ? { ...stage, status: "ready" as const } : stage), currentStageId: nextStage?.id ?? null, status: nextStage ? workflow.status : "completed", updatedAt: timestamp };
    await this.replaceWorkflow(updated, timestamp); return updated;
  }
  /** Complete any stage by id and mark the next ordered stage ready. Host-computed; ignores caller-supplied status. */
  async completeStage(workflowId: string, stageId: string): Promise<CanonicalWorkflow> {
    const workflow = this.getWorkflow(workflowId);
    if (!workflow) throw new WorkflowServiceError("WORKFLOW_NOT_FOUND", "The selected workflow was not found.", true);
    const stage = workflow.stages.find((item) => item.id === stageId);
    if (!stage) throw new WorkflowServiceError("STAGE_NOT_FOUND", "The selected stage was not found in this workflow.", true);
    if (stage.status === "completed") return workflow;
    const nextStage = workflow.stages.filter((item) => item.order > stage.order).sort((left, right) => left.order - right.order)[0];
    const timestamp = this.now();
    const updated: CanonicalWorkflow = {
      ...workflow,
      stages: workflow.stages.map((item) => item.id === stage.id ? { ...item, status: "completed" as const } : item.id === nextStage?.id ? { ...item, status: "ready" as const } : item),
      currentStageId: nextStage?.id ?? null,
      status: nextStage ? workflow.status : "completed",
      updatedAt: timestamp,
    };
    await this.replaceWorkflow(updated, timestamp);
    return updated;
  }

  private async replaceWorkflow(workflow: CanonicalWorkflow, timestamp: string): Promise<void> {
    const next: CanonicalWorkflowPersistentState = { ...this.state, revision: this.state.revision + 1, workflows: this.state.workflows.map((item) => item.id === workflow.id ? workflow : item), updatedAt: timestamp };
    await this.persistence.write(next);
    this.state = next;
  }
  async setActiveWorkflow(id: string): Promise<CanonicalWorkflow> {
    const workflow = this.getWorkflow(id);
    if (!workflow) throw new WorkflowServiceError("WORKFLOW_NOT_FOUND", "The selected workflow was not found.", true);
    if (workflow.status !== "active") throw new WorkflowServiceError("WORKFLOW_NOT_ACTIVE", "Only an active workflow can be resumed.", true);
    if (this.state.activeWorkflowId === id) return workflow;
    const next = { ...this.state, revision: this.state.revision + 1, activeWorkflowId: id, updatedAt: this.now() };
    await this.persistence.write(next);
    this.state = next;
    return workflow;
  }
}

function emptyState(updatedAt = new Date().toISOString()): CanonicalWorkflowPersistentState {
  return { schemaVersion: CANONICAL_WORKFLOW_SCHEMA_VERSION, revision: 0, workflows: [], activeWorkflowId: null, correlations: {}, updatedAt };
}
