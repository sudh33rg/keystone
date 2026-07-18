import type { IntelligenceQueryService } from "../intelligence/IntelligenceQueryService";
import type { IntelligenceSnapshotReader } from "../persistence/IntelligenceStore";
import type { DelegationPersistenceStore } from "../persistence/DelegationPersistenceStore";
import {
  DevelopmentIntentSchema,
  DevelopmentSpecificationSchema,
  DevelopmentTaskGraphSchema,
  DevelopmentTaskSchema,
  DevelopmentWorkflowSnapshotSchema,
  WorkflowClarificationSchema,
  WorkflowDecisionRecordSchema,
  type DelegationTaskCategory,
  type DevelopmentIntent,
  type DevelopmentSpecification,
  type DevelopmentTask,
  type DevelopmentWorkType,
  type DevelopmentWorkflowSnapshot,
  type RepositoryScopeSelection,
} from "../../shared/contracts/delegation";
import type { IntelligenceSnapshot } from "../../shared/contracts/intelligence";
import { RepositoryStateService, StalenessService } from "../integration/ProductIntegrationService";
import { WorkbenchDefineStateSchema, WorkbenchPlanStateSchema, WorkbenchRepositorySummarySchema, WorkbenchStageStateSchema, WorkbenchSummarySchema, WorkbenchTaskPlanValidationSchema, WorkbenchWorkflowStateSchema, type WorkbenchConstraintInput, type WorkbenchDefineState, type WorkbenchPlanState, type WorkbenchRepositorySummary, type WorkbenchStageState, type WorkbenchTaskPlanValidation, type WorkbenchWorkflowState } from "../../shared/contracts/workbench";

export class DevelopmentWorkflowService {
  private reviewStateProvider?: (workflowId: string) => { status: string; completionReady: boolean; blockers: string[]; completed: boolean };
  constructor(
    private readonly persistence: DelegationPersistenceStore,
    private readonly snapshots: IntelligenceSnapshotReader,
    private readonly queries: IntelligenceQueryService,
  ) {}

  async initialize(): Promise<void> {
    await this.persistence.initialize();
  }
  setReviewStateProvider(provider: (workflowId: string) => { status: string; completionReady: boolean; blockers: string[]; completed: boolean }): void { this.reviewStateProvider = provider; }
  list(): DevelopmentWorkflowSnapshot[] {
    return this.persistence.snapshot.workflows;
  }
  get(workflowId: string): DevelopmentWorkflowSnapshot | undefined {
    return this.list().find((item) => item.id === workflowId);
  }

  getCurrentSnapshot(): IntelligenceSnapshot | undefined { return this.snapshots.getSnapshot(); }

  async createWorkbenchDraft(input: { intent: string; workType: DevelopmentWorkType; repositoryScope: RepositoryScopeSelection; constraints: WorkbenchConstraintInput[]; expectedRepositoryId: string; expectedIntelligenceGeneration: number }, signal?: AbortSignal): Promise<DevelopmentWorkflowSnapshot> {
    const snapshot = this.requireSnapshot();
    if (snapshot.repository.id !== input.expectedRepositoryId) throw new Error("The active repository changed before the workflow could be created. Refresh the Workbench and review the selected repository.");
    if (snapshot.manifest.generation !== input.expectedIntelligenceGeneration) throw new Error("Repository Intelligence changed before the workflow could be created. Refresh the Workbench before saving the draft.");
    const now = new Date().toISOString(); const workflowId = crypto.randomUUID(); const risk = assessRisk(input.intent);
    const affectedEntities = await this.resolveEntities(input.intent, snapshot, signal);
    const constraints = input.constraints.map((item) => ({ description: `${constraintLabel(item.kind)}: ${item.value}`, provenance: "user" as const }));
    const ambiguities = extractAmbiguities(input.intent, risk);
    const intent = DevelopmentIntentSchema.parse({ id: crypto.randomUUID(), workflowId, revision: 1, originalText: input.intent, normalizedObjective: normalizeObjective(input.intent), mode: "guided", category: categoryForWorkType(input.workType), expectedOutcome: expectedOutcome(input.intent), risk, constraints, ambiguities, requiredDecisions: [], affectedEntities, intelligenceGeneration: snapshot.manifest.generation, branch: snapshot.repository.branch, workType: input.workType, repositoryScope: input.repositoryScope, createdAt: now, updatedAt: now });
    const clarifications = buildClarifications(intent, snapshot, now);
    const workflow = DevelopmentWorkflowSnapshotSchema.parse({ schemaVersion: 1, id: workflowId, revision: 1, repositoryId: snapshot.repository.id, branch: snapshot.repository.branch, headCommit: snapshot.repository.headCommit, intelligenceGeneration: snapshot.manifest.generation, repositoryState: new RepositoryStateService().fromIntelligence(snapshot), intent, intentHistory: [], clarifications, decisions: [], specificationHistory: [], taskGraphHistory: [], tasks: [], status: "capturing", createdAt: now, updatedAt: now });
    await this.save(workflow); return workflow;
  }

  async updateIntent(workflowId: string, text: string, reason: string): Promise<DevelopmentWorkflowSnapshot> {
    return this.mutate(workflowId, (workflow) => reviseIntent(workflow, { originalText: text, normalizedObjective: normalizeObjective(text), expectedOutcome: expectedOutcome(text), risk: assessRisk(text), ambiguities: extractAmbiguities(text, assessRisk(text)) }, reason));
  }

  async updateScope(workflowId: string, repositoryScope: RepositoryScopeSelection, reason: string): Promise<DevelopmentWorkflowSnapshot> {
    return this.mutate(workflowId, (workflow) => reviseIntent(workflow, { repositoryScope }, reason));
  }

  async updateConstraints(workflowId: string, constraints: WorkbenchConstraintInput[], reason: string): Promise<DevelopmentWorkflowSnapshot> {
    return this.mutate(workflowId, (workflow) => reviseIntent(workflow, { constraints: constraints.map((item) => ({ description: `${constraintLabel(item.kind)}: ${item.value}`, provenance: "user" as const })) }, reason));
  }

  async answerClarification(workflowId: string, clarificationId: string, answer: string, rationale?: string): Promise<DevelopmentWorkflowSnapshot> {
    return this.mutate(workflowId, (workflow) => { const current = workflow.clarifications.find((item) => item.id === clarificationId); if (!current) throw new Error("Clarification was not found."); const now = new Date().toISOString(); const decision = WorkflowDecisionRecordSchema.parse({ id: crypto.randomUUID(), workflowId, sourceClarificationId: clarificationId, title: current.question, decision: answer, ...(rationale ? { rationale } : {}), evidenceReferences: current.evidenceReferences, createdAt: now, updatedAt: now }); return { ...workflow, clarifications: workflow.clarifications.map((item) => item.id === clarificationId ? WorkflowClarificationSchema.parse({ ...item, answer, status: "answered", updatedAt: now }) : item), decisions: [...workflow.decisions.filter((item) => item.sourceClarificationId !== clarificationId), decision].slice(-200) }; });
  }

  async setClarificationStatus(workflowId: string, clarificationId: string, status: "deferred" | "not-applicable" | "open"): Promise<DevelopmentWorkflowSnapshot> {
    return this.mutate(workflowId, (workflow) => { if (!workflow.clarifications.some((item) => item.id === clarificationId)) throw new Error("Clarification was not found."); return { ...workflow, clarifications: workflow.clarifications.map((item) => item.id === clarificationId ? WorkflowClarificationSchema.parse({ ...item, status, ...(status === "open" ? { answer: undefined } : {}), updatedAt: new Date().toISOString() }) : item) }; });
  }

  async generateSpecification(workflowId: string): Promise<DevelopmentWorkflowSnapshot> {
    return this.mutate(workflowId, (workflow) => { const snapshot = this.requireSnapshot(); const open = workflow.clarifications.filter((item) => item.blocking && item.status === "open"); if (open.length) throw new Error(`${open.length} blocking clarification(s) must be answered, deferred, or marked not applicable before specification generation.`); const generated = buildSpecification(workflow.intent, snapshot); const current = workflow.specification; const specification = DevelopmentSpecificationSchema.parse({ ...generated, id: current?.id ?? generated.id, revision: (current?.revision ?? 0) + 1, sections: specificationSections(workflow), decisions: workflow.decisions.map((item) => ({ id: item.id, question: item.title, resolution: item.decision, blocking: false })), modifiedSections: [], sectionSources: { objective: "generated", currentBehavior: workflow.intent.affectedEntities.length ? "repository" : "unknown", requiredBehavior: "generated", errorBehavior: "generated", compatibility: "generated", security: "generated", performance: "generated", assumptions: "generated", openQuestions: "generated" }, createdAt: current?.createdAt ?? generated.createdAt, updatedAt: new Date().toISOString() }); return { ...workflow, specification, specificationHistory: current ? [...workflow.specificationHistory, current].slice(-100) : workflow.specificationHistory, tasks: workflow.tasks.map((task) => ({ ...task, status: "stale" as const, staleReasons: [...new Set([...task.staleReasons, "Specification regenerated from a newer intent revision."])] })), taskGraph: workflow.taskGraph ? { ...workflow.taskGraph, status: "stale" as const, ready: false, approval: undefined } : undefined, status: "awaiting-spec-review" }; });
  }

  async generateAcceptanceCriteria(workflowId: string): Promise<DevelopmentWorkflowSnapshot> {
    const workflow = this.requireWorkflow(workflowId); const specification = requireSpecification(workflow); const criteria = criteriaFor(specification.requirements, workflow.intent);
    return this.revise(workflowId, { acceptanceCriteria: criteria }, "Acceptance criteria regenerated from structured requirements");
  }

  async generateTaskPlan(workflowId: string): Promise<DevelopmentWorkflowSnapshot> { return this.buildTasks(workflowId, false); }

  validateTaskPlan(workflowId: string): WorkbenchTaskPlanValidation { return validatePlan(this.requireWorkflow(workflowId)); }

  async updateTask(workflowId: string, taskId: string, expectedPlanRevision: number, patch: Partial<Pick<DevelopmentTask, "title" | "objective" | "category" | "validationSteps" | "executionRoute" | "optional">>): Promise<DevelopmentWorkflowSnapshot> { return this.editTaskPlan(workflowId, expectedPlanRevision, (tasks) => tasks.map((task) => task.id === taskId ? DevelopmentTaskSchema.parse({ ...task, ...patch, status: "pending", updatedAt: new Date().toISOString() }) : task), "Task updated"); }

  async addTask(workflowId: string, expectedPlanRevision: number, input: Pick<DevelopmentTask, "title" | "objective" | "description" | "category" | "requirementIds" | "acceptanceCriterionIds" | "expectedFiles" | "expectedEntityIds" | "validationSteps" | "executionRoute" | "risk" | "optional">): Promise<DevelopmentWorkflowSnapshot> { const workflow = this.requireWorkflow(workflowId); const spec = requireSpecification(workflow); const now = new Date().toISOString(); const task = DevelopmentTaskSchema.parse({ ...input, id: crypto.randomUUID(), workflowId, specificationId: spec.id, specificationRevision: spec.revision, status: "pending", dependencies: [], requiredCapabilities: requiredCapabilities(input.category), staleReasons: [], baseEntityFingerprints: fingerprints(this.requireSnapshot(), input.expectedFiles, input.expectedEntityIds), createdAt: now, updatedAt: now }); return this.editTaskPlan(workflowId, expectedPlanRevision, (tasks) => [...tasks, task], "Task added"); }

  async removeTask(workflowId: string, taskId: string, expectedPlanRevision: number): Promise<DevelopmentWorkflowSnapshot> { return this.editTaskPlan(workflowId, expectedPlanRevision, (tasks) => tasks.filter((task) => task.id !== taskId).map((task) => ({ ...task, dependencies: task.dependencies.filter((id) => id !== taskId) })), "Task removed"); }

  async reorderTask(workflowId: string, taskId: string, direction: "up" | "down", expectedPlanRevision: number): Promise<DevelopmentWorkflowSnapshot> { return this.editTaskPlan(workflowId, expectedPlanRevision, (tasks) => { const index = tasks.findIndex((task) => task.id === taskId); const target = index + (direction === "up" ? -1 : 1); if (index < 0) throw new Error("Task was not found."); if (target < 0 || target >= tasks.length) return tasks; const reordered = [...tasks]; [reordered[index], reordered[target]] = [reordered[target]!, reordered[index]!]; const positions = new Map(reordered.map((task, position) => [task.id, position])); const invalid = reordered.find((task) => task.dependencies.some((dependency) => (positions.get(dependency) ?? -1) >= (positions.get(task.id) ?? 0))); if (invalid) throw new Error(`Cannot reorder ${invalid.title} before one of its dependencies.`); return reordered; }, `Task moved ${direction}`); }

  async updateDependency(workflowId: string, taskId: string, dependencyId: string, action: "add" | "remove", expectedPlanRevision: number): Promise<DevelopmentWorkflowSnapshot> { if (taskId === dependencyId) throw new Error("A task cannot depend on itself."); return this.editTaskPlan(workflowId, expectedPlanRevision, (tasks) => tasks.map((task) => task.id === taskId ? { ...task, dependencies: action === "add" ? [...new Set([...task.dependencies, dependencyId])] : task.dependencies.filter((id) => id !== dependencyId) } : task), `Dependency ${action}`); }

  async approveTaskPlan(workflowId: string, expectedPlanRevision: number): Promise<DevelopmentWorkflowSnapshot> { const validation = this.validateTaskPlan(workflowId); if (!validation.valid) throw new Error(`Task plan approval is blocked: ${validation.diagnostics.filter((item) => item.blocking).map((item) => item.message).join(" ")}`); return this.mutate(workflowId, (workflow) => { const graph = requireTaskGraph(workflow); if (graph.revision !== expectedPlanRevision) throw new Error(`Task plan revision mismatch: expected ${expectedPlanRevision}, current ${graph.revision}.`); const now = new Date().toISOString(); const first = validation.topologicalOrder[0]; return { ...workflow, taskGraph: { ...graph, status: "approved", ready: true, topologicalOrder: validation.topologicalOrder, approval: { approvedAt: now, approvedBy: "user", revision: graph.revision }, diagnostics: [] }, tasks: workflow.tasks.map((task) => ({ ...task, status: task.id === first ? "ready" as const : "pending" as const, updatedAt: now })), status: "planned" }; }); }

  getWorkbenchState(workflowId: string): WorkbenchWorkflowState { const workflow = this.requireWorkflow(workflowId); const projection = this.projectWorkbench(workflow); return WorkbenchWorkflowStateSchema.parse({ schemaVersion: 1, workflow, repositoryName: this.snapshots.getSnapshot()?.repository.displayName, repositoryState: workflow.repositoryState, staleness: projection.staleness, stageStates: projection.stageStates, summary: projection.summary }); }
  getDefineState(workflowId: string): WorkbenchDefineState { const workflow = this.requireWorkflow(workflowId); const projection = this.projectWorkbench(workflow); return WorkbenchDefineStateSchema.parse({ schemaVersion: 1, workflow, repository: this.repositorySummary(workflow), clarifications: workflow.clarifications, diagnostics: projection.diagnostics, staleness: projection.staleness, stageStates: projection.stageStates, summary: projection.summary }); }
  getPlanState(workflowId: string): WorkbenchPlanState { const workflow = this.requireWorkflow(workflowId); const projection = this.projectWorkbench(workflow); return WorkbenchPlanStateSchema.parse({ schemaVersion: 1, workflow, validation: validatePlan(workflow), stageStates: projection.stageStates, summary: projection.summary }); }
  getStageStates(workflowId: string): WorkbenchStageState[] { return this.projectWorkbench(this.requireWorkflow(workflowId)).stageStates; }

  async capture(
    text: string,
    mode: "quick" | "guided" | "spec-driven",
    title?: string,
    signal?: AbortSignal,
    draft?: { workType?: DevelopmentWorkType; repositoryScope?: RepositoryScopeSelection },
  ): Promise<DevelopmentWorkflowSnapshot> {
    const snapshot = this.requireSnapshot();
    const now = new Date().toISOString();
    const workflowId = crypto.randomUUID();
    const category = draft?.workType ? categoryForWorkType(draft.workType) : categorize(text);
    const risk = assessRisk(text);
    const affectedEntities = await this.resolveEntities(text, snapshot, signal);
    const constraints = extractConstraints(text);
    const ambiguities = extractAmbiguities(text, risk);
    const requiredDecisions = ambiguities
      .filter((item) => item.blocking)
      .map((item) => ({
        id: crypto.randomUUID(),
        question: item.question,
        blocking: true,
      }));
    const intent = DevelopmentIntentSchema.parse({
      id: crypto.randomUUID(),
      workflowId,
      revision: 1,
      originalText: text,
      normalizedObjective: normalizeObjective(text),
      mode,
      category,
      expectedOutcome: expectedOutcome(text),
      risk,
      constraints,
      ambiguities,
      requiredDecisions,
      affectedEntities,
      intelligenceGeneration: snapshot.manifest.generation,
      branch: snapshot.repository.branch,
      ...(draft?.workType ? { workType: draft.workType } : {}),
      ...(draft?.repositoryScope ? { repositoryScope: draft.repositoryScope } : {}),
      createdAt: now,
    });
    const specification = buildSpecification(intent, snapshot, title);
    const workflow = DevelopmentWorkflowSnapshotSchema.parse({
      schemaVersion: 1,
      id: workflowId,
      revision: 1,
      repositoryId: snapshot.repository.id,
      branch: snapshot.repository.branch,
      headCommit: snapshot.repository.headCommit,
      intelligenceGeneration: snapshot.manifest.generation,
      intent,
      specification,
      specificationHistory: [],
      tasks: [],
      status: "awaiting-spec-review",
      createdAt: now,
      updatedAt: now,
    });
    await this.save(workflow);
    return workflow;
  }

  async submitForReview(
    workflowId: string,
  ): Promise<DevelopmentWorkflowSnapshot> {
    return this.mutate(workflowId, (workflow) => ({
      ...workflow,
      specification: workflow.specification
        ? {
            ...workflow.specification,
            status: "awaiting-review",
            updatedAt: new Date().toISOString(),
          }
        : undefined,
      status: "awaiting-spec-review",
    }));
  }

  async resolveDecision(
    workflowId: string,
    decisionId: string,
    resolution: string,
  ): Promise<DevelopmentWorkflowSnapshot> {
    return this.revise(
      workflowId,
      {
        decisions: this.requireWorkflow(
          workflowId,
        ).specification!.decisions.map((item) =>
          item.id === decisionId ? { ...item, resolution } : item,
        ),
      },
      "Resolved specification decision",
    );
  }

  async revise(
    workflowId: string,
    patch: Partial<
      Pick<
        DevelopmentSpecification,
        | "title"
        | "scope"
        | "requirements"
        | "constraints"
        | "acceptanceCriteria"
        | "testStrategy"
        | "decisions"
      >
    >,
    reason: string,
  ): Promise<DevelopmentWorkflowSnapshot> {
    return this.mutate(workflowId, (workflow) => {
      const current = requireSpecification(workflow);
      const now = new Date().toISOString();
      const material = Object.keys(patch).some((key) => key !== "title");
      const next = DevelopmentSpecificationSchema.parse({
        ...current,
        ...patch,
        revision: current.revision + 1,
        status:
          material || current.status === "approved" ? "draft" : current.status,
        approval: undefined,
        updatedAt: now,
      });
      const tasks = material
        ? workflow.tasks.map((task) =>
            DevelopmentTaskSchema.parse({
              ...task,
              status: "stale",
              staleReasons: [
                ...new Set([
                  ...task.staleReasons,
                  `Specification revision changed: ${reason}`,
                ]),
              ],
              updatedAt: now,
            }),
          )
        : workflow.tasks;
      return {
        ...workflow,
        specification: next,
        specificationHistory: [...workflow.specificationHistory, current].slice(
          -100,
        ),
        tasks,
        taskGraph: material ? undefined : workflow.taskGraph,
        status: material ? "stale" : workflow.status,
      };
    });
  }

  async approve(
    workflowId: string,
    expectedRevision: number,
    rationale?: string,
  ): Promise<DevelopmentWorkflowSnapshot> {
    return this.mutate(workflowId, (workflow) => {
      const specification = requireSpecification(workflow);
      if (specification.revision !== expectedRevision)
        throw new Error(
          `Specification revision mismatch: expected ${expectedRevision}, current ${specification.revision}.`,
        );
      if (
        specification.status !== "awaiting-review" &&
        specification.status !== "draft"
      )
        throw new Error(
          `Specification is not approvable from ${specification.status}.`,
        );
      const unresolved = specification.decisions.filter(
        (item) => item.blocking && !item.resolution?.trim(),
      );
      if (unresolved.length)
        throw new Error(
          `${unresolved.length} blocking specification decision(s) remain unresolved.`,
        );
      const openClarifications = workflow.clarifications.filter(
        (item) => item.blocking && item.status === "open",
      );
      if (openClarifications.length)
        throw new Error(
          `${openClarifications.length} blocking clarification(s) remain open.`,
        );
      if (specification.sections?.openQuestions.length)
        throw new Error(
          `${specification.sections.openQuestions.length} specification question(s) remain open.`,
        );
      if (
        !specification.acceptanceCriteria.length ||
        specification.acceptanceCriteria.some(
          (item) => !item.validationMethod.trim(),
        )
      )
        throw new Error(
          "Every specification requires acceptance criteria with validation methods.",
        );
      const now = new Date().toISOString();
      return {
        ...workflow,
        specification: {
          ...specification,
          status: "approved",
          approval: {
            approvedAt: now,
            approvedBy: "user",
            revision: specification.revision,
            ...(rationale ? { rationale } : {}),
          },
          updatedAt: now,
        },
        status: "planned",
      };
    });
  }

  async generateTasks(
    workflowId: string,
  ): Promise<DevelopmentWorkflowSnapshot> {
    return this.mutate(workflowId, (workflow) => {
      const specification = requireSpecification(workflow);
      if (specification.status !== "approved")
        throw new Error(
          "Only an approved specification can produce a ready task plan.",
        );
      const snapshot = this.requireSnapshot();
      const now = new Date().toISOString();
      const tasks: DevelopmentTask[] = [];
      for (
        let index = 0;
        index < specification.acceptanceCriteria.length;
        index++
      ) {
        const criterion = specification.acceptanceCriteria[index]!;
        const id = crypto.randomUUID();
        const previous = tasks.at(-1);
        tasks.push(
          DevelopmentTaskSchema.parse({
            id,
            workflowId,
            specificationId: specification.id,
            specificationRevision: specification.revision,
            title: `Implement ${criterion.id}`,
            objective: criterion.description,
            description: `Satisfy ${criterion.description} and produce ${criterion.expectedEvidence}.`,
            category: workflow.intent.category,
            status: index === 0 ? "ready" : "pending",
            dependencies: previous ? [previous.id] : [],
            requirementIds: criterion.requirementIds.length
              ? criterion.requirementIds
              : specification.requirements.slice(0, 1).map((item) => item.id),
            acceptanceCriterionIds: [criterion.id],
            expectedFiles: specification.scope.expectedFiles,
            expectedEntityIds: specification.scope.entityIds,
            validationSteps: [{ manualCheck: criterion.validationMethod }],
            requiredCapabilities: requiredCapabilities(
              workflow.intent.category,
            ),
            staleReasons: [],
            baseEntityFingerprints: fingerprints(
              snapshot,
              specification.scope.expectedFiles,
              specification.scope.entityIds,
            ),
            createdAt: now,
            updatedAt: now,
          }),
        );
      }
      const criteria = specification.acceptanceCriteria.map((criterion) => ({
        ...criterion,
        coveringTaskIds: tasks
          .filter((task) => task.acceptanceCriterionIds.includes(criterion.id))
          .map((task) => task.id),
      }));
      const taskGraph = DevelopmentTaskGraphSchema.parse({
        id: crypto.randomUUID(),
        workflowId,
        specificationId: specification.id,
        specificationRevision: specification.revision,
        revision: 1,
        taskIds: tasks.map((item) => item.id),
        topologicalOrder: topologicalOrder(tasks),
        ready: true,
        diagnostics: [],
        createdAt: now,
      });
      return {
        ...workflow,
        specification: { ...specification, acceptanceCriteria: criteria },
        tasks,
        taskGraph,
        status: "planned",
      };
    });
  }

  async reconcileStaleness(
    workflowId: string,
  ): Promise<DevelopmentWorkflowSnapshot> {
    return this.mutate(workflowId, (workflow) => {
      const snapshot = this.requireSnapshot();
      const now = new Date().toISOString();
      const branchChanged = Boolean(
        workflow.branch &&
        snapshot.repository.branch &&
        workflow.branch !== snapshot.repository.branch,
      );
      const tasks = workflow.tasks.map((task) => {
        const current = fingerprints(
          snapshot,
          task.expectedFiles,
          task.expectedEntityIds,
        );
        const changed = Object.entries(task.baseEntityFingerprints)
          .filter(([key, value]) => current[key] !== value)
          .map(([key]) => key);
        const reasons = [
          ...(branchChanged
            ? [
                `Repository branch changed from ${workflow.branch} to ${snapshot.repository.branch}.`,
              ]
            : []),
          ...(changed.length
            ? [
                `Relevant intelligence changed: ${changed.slice(0, 20).join(", ")}.`,
              ]
            : []),
        ];
        return reasons.length
          ? DevelopmentTaskSchema.parse({
              ...task,
              status: "stale",
              staleReasons: [
                ...new Set([...task.staleReasons, ...reasons]),
              ].slice(0, 50),
              updatedAt: now,
            })
          : task;
      });
      const stale = tasks.some((item) => item.status === "stale");
      return {
        ...workflow,
        tasks,
        status: stale ? "stale" : workflow.status,
        intelligenceGeneration: snapshot.manifest.generation,
        branch: snapshot.repository.branch,
        headCommit: snapshot.repository.headCommit,
      };
    });
  }

  async assignAgent(
    workflowId: string,
    taskId: string,
    agentId: string,
  ): Promise<DevelopmentWorkflowSnapshot> {
    return this.mutate(workflowId, (workflow) => ({
      ...workflow,
      tasks: workflow.tasks.map((task) =>
        task.id === taskId
          ? DevelopmentTaskSchema.parse({
              ...task,
              assignedAgentId: agentId,
              updatedAt: new Date().toISOString(),
            })
          : task,
      ),
    }));
  }

  async setTaskStatus(
    workflowId: string,
    taskId: string,
    status: DevelopmentTask["status"],
    reason?: string,
  ): Promise<DevelopmentWorkflowSnapshot> {
    return this.mutate(workflowId, (workflow) => ({
      ...workflow,
      tasks: workflow.tasks.map((task) =>
        task.id === taskId
          ? DevelopmentTaskSchema.parse({
              ...task,
              status,
              staleReasons: reason
                ? [...new Set([...task.staleReasons, reason])].slice(-50)
                : task.staleReasons,
              updatedAt: new Date().toISOString(),
            })
          : task,
      ),
    }));
  }

  async createRepairTask(
    workflowId: string,
    sourceTaskId: string,
    failedCriterionIds: string[],
    expectedFiles: string[],
    reason: string,
  ): Promise<DevelopmentWorkflowSnapshot> {
    return this.mutate(workflowId, (workflow) => {
      const source = workflow.tasks.find((item) => item.id === sourceTaskId);
      const specification = requireSpecification(workflow);
      if (!source)
        throw new Error(`Source task ${sourceTaskId} was not found.`);
      const criteria = [...new Set(failedCriterionIds)].filter((id) =>
        source.acceptanceCriterionIds.includes(id),
      );
      if (!criteria.length)
        throw new Error(
          "A partial repair task requires at least one failed criterion from the source task.",
        );
      const now = new Date().toISOString();
      const id = crypto.randomUUID();
      const ready = source.dependencies.every(
        (dependency) =>
          workflow.tasks.find((item) => item.id === dependency)?.status ===
          "completed",
      );
      const repair = DevelopmentTaskSchema.parse({
        ...source,
        id,
        title: `Repair ${criteria.join(", ")}`,
        objective: `Repair only the failed criteria ${criteria.join(", ")}.`,
        description: `${reason}\nThis is a focused repair task; the approved specification is unchanged.`,
        status: ready ? "ready" : "pending",
        acceptanceCriterionIds: criteria,
        expectedFiles: [
          ...new Set(
            expectedFiles.length ? expectedFiles : source.expectedFiles,
          ),
        ].slice(0, 200),
        assignedAgentId: undefined,
        staleReasons: [],
        createdAt: now,
        updatedAt: now,
      });
      const tasks = [...workflow.tasks, repair];
      const taskGraph = DevelopmentTaskGraphSchema.parse({
        ...(workflow.taskGraph ?? {
          id: crypto.randomUUID(),
          workflowId,
          specificationId: specification.id,
          specificationRevision: specification.revision,
          revision: 0,
          createdAt: now,
        }),
        revision: (workflow.taskGraph?.revision ?? 0) + 1,
        taskIds: tasks.map((item) => item.id),
        topologicalOrder: topologicalOrder(tasks),
        ready: true,
        diagnostics: [
          `Focused repair task ${id} was created without changing specification revision ${specification.revision}.`,
        ],
      });
      return { ...workflow, tasks, taskGraph };
    });
  }

  async importTransferredTask(
    intent: DevelopmentIntent,
    specification: DevelopmentSpecification,
    task: DevelopmentTask,
    repository: {
      repositoryId: string;
      branch?: string;
      headCommit?: string;
      intelligenceGeneration: number;
    },
  ): Promise<DevelopmentWorkflowSnapshot> {
    const existing = this.get(intent.workflowId);
    if (existing) {
      if (existing.specification?.id !== specification.id || existing.specification.revision !== specification.revision)
        throw new Error("The local workflow has a different specification identity or revision.");
      if (!existing.tasks.some((item) => item.id === task.id))
        throw new Error("The local workflow does not contain the transferred task identity.");
      return existing;
    }
    const now = new Date().toISOString();
    const continuationTask = DevelopmentTaskSchema.parse({
      ...task,
      status: "ready",
      assignedAgentId: undefined,
      staleReasons: [],
      updatedAt: now,
    });
    const workflow = DevelopmentWorkflowSnapshotSchema.parse({
      schemaVersion: 1,
      id: intent.workflowId,
      revision: 1,
      repositoryId: repository.repositoryId,
      ...(repository.branch ? { branch: repository.branch } : {}),
      ...(repository.headCommit ? { headCommit: repository.headCommit } : {}),
      intelligenceGeneration: repository.intelligenceGeneration,
      intent,
      specification,
      specificationHistory: [],
      tasks: [continuationTask],
      status: "planned",
      createdAt: now,
      updatedAt: now,
    });
    await this.save(workflow);
    return workflow;
  }

  private async buildTasks(workflowId: string, approved: boolean): Promise<DevelopmentWorkflowSnapshot> {
    return this.mutate(workflowId, (workflow) => {
      const specification = requireSpecification(workflow); if (specification.status !== "approved") throw new Error("Only an approved specification can produce a task plan.");
      const snapshot = this.requireSnapshot(); const now = new Date().toISOString(); const tasks: DevelopmentTask[] = [];
      for (const criterion of specification.acceptanceCriteria) {
        const category: DelegationTaskCategory = criterion.category === "test" ? "testing" : criterion.category === "security" ? "security" : criterion.category === "performance" ? "performance" : criterion.category === "documentation" ? "documentation" : criterion.category === "manual-verification" ? "manual" : "implementation";
        const previous = tasks.at(-1); const id = crypto.randomUUID();
        tasks.push(DevelopmentTaskSchema.parse({ id, workflowId, specificationId: specification.id, specificationRevision: specification.revision, title: taskTitle(category, criterion.id), objective: criterion.description, description: `Satisfy ${criterion.description} and produce ${criterion.expectedEvidence}.`, category, status: "pending", dependencies: previous ? [previous.id] : [], requirementIds: criterion.requirementIds.length ? criterion.requirementIds : specification.requirements.slice(0, 1).map((item) => item.id), acceptanceCriterionIds: [criterion.id], expectedFiles: specification.scope.expectedFiles, expectedEntityIds: criterion.relatedEntityIds?.length ? criterion.relatedEntityIds : specification.scope.entityIds, validationSteps: [{ manualCheck: criterion.validationMethod }], executionRoute: executionRoute(category), risk: workflow.intent.risk, optional: criterion.blocking === false, requiredCapabilities: requiredCapabilities(category), staleReasons: [], baseEntityFingerprints: fingerprints(snapshot, specification.scope.expectedFiles, specification.scope.entityIds), createdAt: now, updatedAt: now }));
      }
      const text = `${workflow.intent.originalText} ${specification.requirements.map((item) => item.description).join(" ")}`.toLowerCase();
      for (const trigger of [{ category: "security" as const, match: /(auth|security|permission|secret|credential|encrypt|endpoint)/, title: "Review security impact" }, { category: "performance" as const, match: /(performance|latency|throughput|cache|query|concurr|bundle)/, title: "Validate performance impact" }]) if (trigger.match.test(text) && !tasks.some((task) => task.category === trigger.category)) { const id = crypto.randomUUID(); tasks.push(DevelopmentTaskSchema.parse({ id, workflowId, specificationId: specification.id, specificationRevision: specification.revision, title: trigger.title, objective: `Review ${trigger.category} requirements and evidence.`, description: `Required because deterministic ${trigger.category} terms are present in the approved intent or specification.`, category: trigger.category, status: "pending", dependencies: tasks.length ? [tasks.at(-1)!.id] : [], requirementIds: specification.requirements.slice(0, 1).map((item) => item.id), acceptanceCriterionIds: specification.acceptanceCriteria.filter((item) => item.category === trigger.category).map((item) => item.id).length ? specification.acceptanceCriteria.filter((item) => item.category === trigger.category).map((item) => item.id) : [specification.acceptanceCriteria[0]!.id], expectedFiles: specification.scope.expectedFiles, expectedEntityIds: specification.scope.entityIds, validationSteps: [{ manualCheck: `Record evidence for the ${trigger.category} review.` }], executionRoute: "manual", risk: workflow.intent.risk, optional: false, requiredCapabilities: requiredCapabilities(trigger.category), staleReasons: [], baseEntityFingerprints: fingerprints(snapshot, specification.scope.expectedFiles, specification.scope.entityIds), createdAt: now, updatedAt: now })); }
      const criteria = specification.acceptanceCriteria.map((criterion) => ({ ...criterion, coveringTaskIds: tasks.filter((task) => task.acceptanceCriterionIds.includes(criterion.id)).map((task) => task.id) }));
      const current = workflow.taskGraph; const revision = (current?.revision ?? 0) + 1; const order = topologicalOrder(tasks); const graph = DevelopmentTaskGraphSchema.parse({ id: current?.id ?? crypto.randomUUID(), workflowId, specificationId: specification.id, specificationRevision: specification.revision, revision, taskIds: tasks.map((item) => item.id), topologicalOrder: order, ready: approved, status: approved ? "approved" : "draft", diagnostics: [], ...(approved ? { approval: { approvedAt: now, approvedBy: "user", revision } } : {}), createdAt: current?.createdAt ?? now });
      return { ...workflow, specification: { ...specification, acceptanceCriteria: criteria }, tasks: tasks.map((task, index) => ({ ...task, status: approved && index === 0 ? "ready" as const : "pending" as const })), taskGraph: graph, taskGraphHistory: current ? [...workflow.taskGraphHistory, current].slice(-100) : workflow.taskGraphHistory, status: "planned" };
    });
  }

  private async editTaskPlan(workflowId: string, expectedRevision: number, edit: (tasks: DevelopmentTask[]) => DevelopmentTask[], reason: string): Promise<DevelopmentWorkflowSnapshot> {
    return this.mutate(workflowId, (workflow) => { const graph = requireTaskGraph(workflow); if (graph.revision !== expectedRevision) throw new Error(`Task plan revision mismatch: expected ${expectedRevision}, current ${graph.revision}.`); const tasks = edit(workflow.tasks).map((task) => DevelopmentTaskSchema.parse(task)); const validation = validateTasks(tasks, requireSpecification(workflow)); const next = DevelopmentTaskGraphSchema.parse({ ...graph, revision: graph.revision + 1, taskIds: tasks.map((item) => item.id), topologicalOrder: validation.topologicalOrder, status: "draft", ready: false, approval: undefined, diagnostics: [`Change: ${reason}`, ...validation.diagnostics.map((item) => `${item.code}: ${item.message}`)], createdAt: graph.createdAt }); return { ...workflow, tasks: tasks.map((task) => ({ ...task, status: "pending" as const })), taskGraph: next, taskGraphHistory: [...workflow.taskGraphHistory, graph].slice(-100), status: "planned", updatedAt: new Date().toISOString() }; });
  }

  private projectWorkbench(workflow: DevelopmentWorkflowSnapshot): { stageStates: WorkbenchStageState[]; summary: WorkbenchWorkflowState["summary"]; diagnostics: WorkbenchDefineState["diagnostics"]; staleness: WorkbenchWorkflowState["staleness"] } {
    const snapshot = this.snapshots.getSnapshot(); const currentState = snapshot ? new RepositoryStateService().fromIntelligence(snapshot) : undefined; const staleness = workflow.repositoryState && currentState ? new StalenessService().compare(workflow.repositoryState, currentState, "workflow", workflow.id) : [];
    const repositoryMissing = !snapshot || snapshot.repository.id !== workflow.repositoryId; const repositoryStale = staleness.some((item) => item.reason !== "intelligence-generation-changed"); const intelligenceStale = !snapshot || snapshot.manifest.generation !== workflow.intelligenceGeneration; const specApproved = workflow.specification?.status === "approved"; const planApproved = Boolean(workflow.taskGraph?.ready) && (workflow.taskGraph?.status === "approved" || workflow.taskGraph?.status === undefined); const implemented = workflow.tasks.some((task) => ["executing", "completed"].includes(task.status)); const implementationComplete = Boolean(workflow.tasks.length) && workflow.tasks.filter((task) => !task.optional).every((task) => task.status === "completed"); const review = implementationComplete ? this.reviewStateProvider?.(workflow.id) : undefined;
    const diagnostics = [...(!snapshot ? [diagnostic("INTELLIGENCE_UNAVAILABLE", "error", "A complete Intelligence generation is unavailable.", true, "Wait for Intelligence to become ready, then refresh the workflow.")] : []), ...(repositoryStale ? [diagnostic("REPOSITORY_STALE", "error", "The repository branch or HEAD differs from the workflow baseline.", true, "Review repository changes and reconcile the workflow before approval.")] : []), ...(intelligenceStale ? [diagnostic("INTELLIGENCE_STALE", "warning", `Workflow generation ${workflow.intelligenceGeneration} differs from current generation ${snapshot?.manifest.generation ?? "unavailable"}.`, false, "Review repository evidence and regenerate affected projections where needed.")] : [])];
    const stage = !specApproved ? "define" : !planApproved ? "plan" : !implementationComplete ? "build" : !review ? "validate" : !review.completionReady ? "review" : "complete";
    const states: WorkbenchStageState[] = [
      stageState("define", specApproved ? "complete" : "current", repositoryMissing ? [{ code: "REPOSITORY_UNAVAILABLE", message: "The workflow repository is unavailable.", recoveryAction: "Open the original repository." }] : [], intelligenceStale ? ["Repository Intelligence changed after the workflow was created."] : [], !workflow.specification ? { id: "generate-specification", label: "Generate specification", enabled: !workflow.clarifications.some((item) => item.blocking && item.status === "open") } : !specApproved ? { id: "approve-specification", label: "Approve specification", enabled: !repositoryStale } : undefined),
      stageState("plan", specApproved ? planApproved ? "complete" : stage === "plan" ? "current" : "ready" : "blocked", specApproved ? [] : [{ code: "SPECIFICATION_NOT_APPROVED", message: "Approve the current specification before planning tasks.", recoveryAction: "Return to Define and approve the specification." }], [], specApproved && !workflow.taskGraph ? { id: "generate-task-plan", label: "Create task plan", enabled: true } : specApproved && !planApproved ? { id: "approve-task-plan", label: "Approve task plan", enabled: validatePlan(workflow).valid } : undefined),
      stageState("build", planApproved ? stage === "build" ? "current" : implementationComplete ? "complete" : "ready" : "blocked", planApproved ? [] : [{ code: "TASK_PLAN_NOT_APPROVED", message: "Build requires an approved task plan.", recoveryAction: "Generate, validate, and approve the task plan in Plan." }], [], planApproved ? { id: "start-first-task", label: "Start first task", enabled: Boolean(workflow.tasks.find((task) => task.status === "ready")) } : undefined),
      stageState("validate", implemented ? implementationComplete ? review ? "complete" : "current" : "ready" : "blocked", implemented ? [] : [{ code: "NO_IMPLEMENTATION_CHANGES", message: "Validation requires implementation progress or manually supplied changes.", recoveryAction: "Complete or record implementation work in Build." }], []),
      stageState("review", implementationComplete ? !review ? "ready" : review.completionReady ? "complete" : "current" : "blocked", implementationComplete ? (review?.blockers ?? []).slice(0, 50).map((message) => ({ code: "REVIEW_BLOCKED", message, recoveryAction: "Resolve the finding or return to Build/Validate, then review again." })) : [{ code: "VALIDATION_INCOMPLETE", message: "Review is unavailable until required implementation and validation are complete.", recoveryAction: "Complete required tasks and validation first." }], review?.status === "stale" ? ["The prior Review decision is stale because repository or specification evidence changed."] : []),
      stageState("complete", !review ? implementationComplete ? "optional" : "unavailable" : review.completed ? "complete" : review.completionReady ? "current" : implementationComplete ? "blocked" : "unavailable", !review || review.completionReady || review.completed ? [] : [{ code: "REVIEW_NOT_APPROVED", message: "Complete requires a current approved Review with no blocking findings.", recoveryAction: "Resolve Review blockers and explicitly approve Review." }], ["Git, PR, export, and handoff actions are optional and capability-driven."])
    ].map((item) => WorkbenchStageStateSchema.parse(item));
    const counts = Object.fromEntries([...new Set(workflow.tasks.map((task) => task.status))].map((status) => [status, workflow.tasks.filter((task) => task.status === status).length]));
    const summary = WorkbenchSummarySchema.parse({ workflowId: workflow.id, currentStage: stage, specificationStatus: workflow.specification?.status ?? "not-generated", taskPlanStatus: workflow.taskGraph?.status ?? "not-generated", taskCounts: counts, currentReadyTaskId: workflow.tasks.find((task) => task.status === "ready")?.id, pendingApprovals: Number(Boolean(workflow.specification && !specApproved)) + Number(Boolean(workflow.taskGraph && !planApproved)), blockingDiagnostics: diagnostics.filter((item) => item.blocking).length + validatePlan(workflow).diagnostics.filter((item) => item.blocking).length, repositoryFreshness: repositoryMissing ? "unavailable" : repositoryStale ? "stale" : "current", intelligenceFreshness: !snapshot ? "unavailable" : intelligenceStale ? "stale" : "current" });
    return { stageStates: states, summary, diagnostics, staleness };
  }

  private repositorySummary(workflow: DevelopmentWorkflowSnapshot): WorkbenchRepositorySummary {
    const snapshot = this.snapshots.getSnapshot(); const unavailable = !snapshot; const evidence = workflow.intent.affectedEntities.map((item) => ({ entityId: item.entityId, name: item.name, type: item.type, ...(item.relativePath ? { relativePath: item.relativePath } : {}), classification: item.confidence >= 0.9 ? "exact" as const : "candidate" as const, confidence: item.confidence, reason: item.reason, evidenceIds: item.evidenceIds }));
    const isType = (pattern: RegExp) => evidence.filter((item) => pattern.test(item.type));
    const paths = evidence.flatMap((item) => item.relativePath ? [item.relativePath.split("/").slice(0, -1).join("/")] : []).filter(Boolean);
    return WorkbenchRepositorySummarySchema.parse({ generation: snapshot?.manifest.generation ?? workflow.intelligenceGeneration, freshness: unavailable ? "unavailable" : snapshot.manifest.generation === workflow.intelligenceGeneration ? "current" : "stale", modules: isType(/Module|Package|Directory/).slice(0, 20), entities: evidence.slice(0, 50), tests: isType(/Test|Suite|Fixture/).slice(0, 30), apisAndData: isType(/Route|Endpoint|API|Table|Column|Entity|Schema/).slice(0, 30), patterns: [...new Set(paths)].slice(0, 30).map((path) => `Relevant repository area: ${path}`), limitations: [...(!evidence.length ? ["No exact entity was resolved from the intent; repository behavior remains unknown until scope is clarified."] : []), ...(evidence.some((item) => item.classification === "candidate") ? ["Candidate relationships are shown separately and are not treated as exact scope."] : [])] });
  }

  private async resolveEntities(
    text: string,
    snapshot: IntelligenceSnapshot,
    signal?: AbortSignal,
  ): Promise<DevelopmentIntent["affectedEntities"]> {
    const terms = explicitTerms(text);
    const output = new Map<
      string,
      DevelopmentIntent["affectedEntities"][number]
    >();
    let hadAmbiguousResolution = false;
    for (const term of terms.slice(0, 8)) {
      signal?.throwIfAborted();
      const result = await this.queries.unified(
        {
          query: {
            operation: "SEARCH",
            seeds: [{ value: term, kind: "name" }],
            limits: {
              results: 10,
              nodes: 20,
              edges: 20,
              paths: 2,
              depth: 2,
              evidence: 20,
              timeBudgetMs: 1000,
            },
          },
        },
        signal,
      );
      const resolution = result.resolvedSeeds?.[0];
      if (resolution?.ambiguous) hadAmbiguousResolution = true;
      const selected = resolution && !resolution.ambiguous ? resolution.selected : undefined;
      if (selected)
        output.set(selected.id, {
          entityId: selected.id,
          name: selected.name,
          type: selected.type,
          ...(selected.relativePath ? { relativePath: selected.relativePath } : {}),
          reason: `Resolved from intent term “${term}” through Keystone Intelligence.`,
          confidence: selected.confidence,
          evidenceIds: result.evidence
            .filter((evidence) => evidence.subjectId === selected.id)
            .map((evidence) => evidence.id)
            .slice(0, 50),
        });
      if (output.size >= 100) break;
    }
    if (!output.size && !hadAmbiguousResolution && snapshot.files.length === 1) {
      const file = snapshot.files[0]!;
      output.set(file.id, {
        entityId: file.id,
        name: file.relativePath,
        type: "keystone.core.File",
        relativePath: file.relativePath,
        reason:
          "Only indexed repository file; retained as a low-priority candidate after explicit terms produced no exact result.",
        confidence: 0.5,
        evidenceIds: file.evidenceIds,
      });
    }
    return [...output.values()];
  }

  private async mutate(
    workflowId: string,
    mutation: (
      workflow: DevelopmentWorkflowSnapshot,
    ) => DevelopmentWorkflowSnapshot,
  ): Promise<DevelopmentWorkflowSnapshot> {
    let output: DevelopmentWorkflowSnapshot | undefined;
    await this.persistence.update((state) => ({
      ...state,
      workflows: state.workflows.map((workflow) => {
        if (workflow.id !== workflowId) return workflow;
        const next = DevelopmentWorkflowSnapshotSchema.parse({
          ...mutation(structuredClone(workflow)),
          revision: workflow.revision + 1,
          updatedAt: new Date().toISOString(),
        });
        output = next;
        return next;
      }),
    }));
    if (!output) throw new Error(`Workflow ${workflowId} was not found.`);
    return output;
  }

  private async save(workflow: DevelopmentWorkflowSnapshot): Promise<void> {
    await this.persistence.update((state) => ({
      ...state,
      workflows: [
        ...state.workflows.filter((item) => item.id !== workflow.id),
        workflow,
      ].slice(-100),
    }));
  }
  private requireWorkflow(id: string): DevelopmentWorkflowSnapshot {
    const value = this.get(id);
    if (!value) throw new Error(`Workflow ${id} was not found.`);
    return value;
  }
  private requireSnapshot(): IntelligenceSnapshot {
    const value = this.snapshots.getSnapshot();
    if (!value)
      throw new Error(
        "A complete Keystone Intelligence generation is required.",
      );
    return value;
  }
}

function buildSpecification(
  intent: DevelopmentIntent,
  snapshot: IntelligenceSnapshot,
  title?: string,
): DevelopmentSpecification {
  const now = new Date().toISOString();
  const files = [
    ...new Set(
      [...(intent.repositoryScope?.kind === "paths" ? intent.repositoryScope.paths : []), ...intent.affectedEntities.flatMap((item) =>
        item.relativePath ? [item.relativePath] : [],
      )],
    ),
  ];
  const tests = snapshot.symbols
    .filter(
      (item) =>
        /Test/.test(item.type) &&
        snapshot.relationships.some(
          (relation) =>
            relation.sourceId === item.id &&
            intent.affectedEntities.some(
              (entity) => entity.entityId === relation.targetId,
            ),
        ),
    )
    .map((item) => item.qualifiedName)
    .slice(0, 200);
  const commands = snapshot.symbols
    .filter((item) => /BuildTarget|TestCommand|Command/.test(item.type))
    .flatMap((item) =>
      typeof item.properties?.command === "string"
        ? [item.properties.command]
        : [],
    )
    .slice(0, 100);
  const requirements = [
    { id: "REQ-1", description: intent.normalizedObjective },
    ...intent.constraints.map((item, index) => ({
      id: `REQ-${index + 2}`,
      description: item.description,
    })),
  ];
  const criteria = requirements.map((item, index) => ({
    id: `AC-${index + 1}`,
    description:
      index === 0
        ? `The approved objective is implemented: ${item.description}`
        : `The implementation respects: ${item.description}`,
    required: true,
    requirementIds: [item.id],
    validationMethod:
      index === 0
        ? "Relevant automated tests and focused user review"
        : "Focused review plus applicable automated checks",
    expectedEvidence: "Current command output or explicit review evidence",
    coveringTaskIds: [],
  }));
  return DevelopmentSpecificationSchema.parse({
    id: crypto.randomUUID(),
    workflowId: intent.workflowId,
    revision: 1,
    status: "draft",
    title: title?.trim() || intent.normalizedObjective.slice(0, 120),
    repositoryId: snapshot.repository.id,
    branch: snapshot.repository.branch,
    baseCommit: snapshot.repository.headCommit,
    intelligenceGeneration: snapshot.manifest.generation,
    objective: intent.normalizedObjective,
    scope: {
      included: [intent.expectedOutcome],
      excluded: ["Unrelated repository behavior and files"],
      expectedFiles: files,
      entityIds: intent.affectedEntities.map((item) => item.entityId),
    },
    requirements,
    constraints: [
      ...intent.constraints.map((item) => item.description),
      "Preserve repository conventions and do not modify unrelated files.",
    ],
    acceptanceCriteria: criteria,
    testStrategy: {
      existingTests: tests,
      requiredTests: [
        "Add or update focused tests for changed behavior where the repository supports them.",
      ],
      validationCommands: commands,
      manualScenarios: [intent.expectedOutcome],
      risks: [
        intent.risk === "low"
          ? "Low risk; verify affected behavior and regression scope."
          : `${intent.risk} risk requires explicit scope and regression review.`,
        ...intent.ambiguities.map((item) => item.impact),
      ],
    },
    decisions: intent.requiredDecisions.map((item) => ({ ...item })),
    evidence: intent.affectedEntities,
    createdAt: now,
    updatedAt: now,
  });
}

function requireSpecification(
  workflow: DevelopmentWorkflowSnapshot,
): DevelopmentSpecification {
  if (!workflow.specification)
    throw new Error("The workflow has no specification.");
  return workflow.specification;
}
function requireTaskGraph(workflow: DevelopmentWorkflowSnapshot) { if (!workflow.taskGraph) throw new Error("The workflow has no task plan."); return workflow.taskGraph; }
function constraintLabel(kind: WorkbenchConstraintInput["kind"]): string { return ({ avoid: "Avoid", framework: "Required framework or pattern", compatibility: "Backward compatibility", test: "Testing", security: "Security", performance: "Performance", notes: "User note" } as const)[kind]; }
function buildClarifications(intent: DevelopmentIntent, snapshot: IntelligenceSnapshot, now: string) {
  const items: Array<{ question: string; whyItMatters: string; evidenceReferences: string[]; options: string[]; blocking: boolean }> = intent.ambiguities.map((item) => ({ question: item.question, whyItMatters: item.impact, evidenceReferences: intent.affectedEntities.flatMap((entity) => entity.evidenceIds).slice(0, 100), options: [], blocking: item.blocking }));
  if (!intent.affectedEntities.length) items.push({ question: "Which repository module or entity should define the implementation boundary?", whyItMatters: "No exact entity was resolved from the intent, so Keystone cannot safely infer scope.", evidenceReferences: [], options: intent.repositoryScope?.kind === "paths" ? intent.repositoryScope.paths : [], blocking: true });
  if (!/(error|failure|invalid|retry|fallback)/i.test(intent.originalText)) items.push({ question: "What error or failure behavior must be preserved or introduced?", whyItMatters: "Error behavior is part of the approved behavioral contract and must not be invented.", evidenceReferences: intent.affectedEntities.flatMap((entity) => entity.evidenceIds).slice(0, 100), options: ["Preserve existing error behavior", "Define explicit failure behavior"], blocking: false });
  if (!/(test|verify|validation|coverage)/i.test(intent.originalText)) items.push({ question: "Which validation outcome is required?", whyItMatters: "Every blocking acceptance criterion needs an evidence-producing verification method.", evidenceReferences: snapshot.symbols.filter((item) => /Test|Command/.test(item.type)).flatMap((item) => item.evidenceIds).slice(0, 100), options: ["Focused automated tests", "Automated checks plus manual verification"], blocking: false });
  if (["high", "critical"].includes(intent.risk)) items.push({ question: "Confirm compatibility and rollback expectations for this high-risk change.", whyItMatters: "High-risk downstream behavior cannot be assumed from naming or convention.", evidenceReferences: intent.affectedEntities.flatMap((entity) => entity.evidenceIds).slice(0, 100), options: ["Backward compatible with rollback", "Explicitly approved breaking change"], blocking: true });
  return items.slice(0, 100).map((item) => WorkflowClarificationSchema.parse({ id: crypto.randomUUID(), workflowId: intent.workflowId, ...item, status: "open", createdAt: now, updatedAt: now }));
}
function reviseIntent(workflow: DevelopmentWorkflowSnapshot, patch: Partial<DevelopmentIntent>, reason: string): DevelopmentWorkflowSnapshot { const now = new Date().toISOString(); const previous = workflow.intent; const intent = DevelopmentIntentSchema.parse({ ...previous, ...patch, revision: previous.revision + 1, updatedAt: now }); const specification = workflow.specification ? DevelopmentSpecificationSchema.parse({ ...workflow.specification, status: "stale", approval: undefined, updatedAt: now }) : undefined; const tasks = workflow.tasks.map((task) => DevelopmentTaskSchema.parse({ ...task, status: "stale", staleReasons: [...new Set([...task.staleReasons, `Intent revision changed: ${reason}`])].slice(-50), updatedAt: now })); const taskGraph = workflow.taskGraph ? DevelopmentTaskGraphSchema.parse({ ...workflow.taskGraph, status: "stale", ready: false, approval: undefined, diagnostics: [...workflow.taskGraph.diagnostics, `Intent revision ${intent.revision} invalidated plan readiness.`].slice(-100) }) : undefined; return { ...workflow, intent, intentHistory: [...workflow.intentHistory, previous].slice(-100), specification, tasks, taskGraph, status: specification ? "stale" : "capturing" }; }
function specificationSections(workflow: DevelopmentWorkflowSnapshot): NonNullable<DevelopmentSpecification["sections"]> { const exact = workflow.intent.affectedEntities.filter((item) => item.confidence >= 0.9); const answers = workflow.clarifications.filter((item) => item.status === "answered").map((item) => `${item.question}: ${item.answer}`); return { currentBehavior: exact.length ? `Known scope is limited to evidenced entities: ${exact.map((item) => item.name).join(", ")}. Behavior beyond those entities is unknown.` : "Unknown — no exact repository evidence establishes current behavior.", requiredBehavior: workflow.intent.expectedOutcome, errorBehavior: answers.find((item) => /error|failure/i.test(item)) ?? "Unknown — error behavior requires explicit review.", compatibility: workflow.intent.constraints.find((item) => /compatib/i.test(item.description))?.description ?? "Preserve existing public behavior unless an approved decision says otherwise.", security: /security|auth|credential|permission/i.test(workflow.intent.originalText) ? "Security-sensitive scope requires explicit review and evidence." : "No deterministic security trigger was found; this is not proof that security impact is absent.", performance: /performance|latency|throughput|cache|query/i.test(workflow.intent.originalText) ? "Performance-sensitive scope requires measurable validation." : "No deterministic performance trigger was found; performance impact remains unmeasured.", assumptions: ["Repository conventions remain applicable unless contradicted by exact evidence.", ...workflow.clarifications.filter((item) => item.status === "deferred").map((item) => `Deferred: ${item.question}`)], openQuestions: workflow.clarifications.filter((item) => item.status === "open").map((item) => item.question) };
}
function criteriaFor(requirements: DevelopmentSpecification["requirements"], intent: DevelopmentIntent): DevelopmentSpecification["acceptanceCriteria"] { return requirements.map((item, index) => ({ id: `AC-${index + 1}`, description: index === 0 ? `The approved objective is implemented: ${item.description}` : `The implementation respects: ${item.description}`, required: true, blocking: true, category: /security|auth|credential|permission/i.test(item.description) ? "security" as const : /performance|latency|throughput|cache/i.test(item.description) ? "performance" as const : /test|validation|coverage/i.test(item.description) ? "test" as const : /compatib|breaking/i.test(item.description) ? "compatibility" as const : "behavior" as const, requirementIds: [item.id], validationMethod: index === 0 ? "Relevant automated tests and focused user review" : "Focused review plus applicable automated checks", expectedEvidence: "Current command output or explicit review evidence", coveringTaskIds: [], relatedEntityIds: intent.affectedEntities.map((entity) => entity.entityId).slice(0, 100) })); }
function taskTitle(category: DelegationTaskCategory, criterionId: string): string { return `${category === "implementation" ? "Implement" : category === "testing" ? "Test" : category === "manual" ? "Verify" : "Review"} ${criterionId}`; }
function executionRoute(category: DelegationTaskCategory): DevelopmentTask["executionRoute"] { if (["investigation", "review", "validation", "security", "performance", "manual"].includes(category)) return "manual"; if (["implementation", "testing", "refactoring", "documentation", "migration", "modernization", "bug-fix", "feature"].includes(category)) return "github-copilot"; return "unsupported"; }
function validatePlan(workflow: DevelopmentWorkflowSnapshot): WorkbenchTaskPlanValidation { if (!workflow.specification || !workflow.taskGraph) return WorkbenchTaskPlanValidationSchema.parse({ valid: false, diagnostics: [diagnostic("TASK_PLAN_UNAVAILABLE", "error", "Generate a task plan from an approved specification.", true, "Generate the task plan in Plan.")], topologicalOrder: [], uncoveredCriterionIds: workflow.specification?.acceptanceCriteria.filter((item) => item.blocking).map((item) => item.id) ?? [], unsupportedTaskIds: [] }); return validateTasks(workflow.tasks, workflow.specification); }
function validateTasks(tasks: DevelopmentTask[], specification: DevelopmentSpecification): WorkbenchTaskPlanValidation { const diagnostics: WorkbenchTaskPlanValidation["diagnostics"] = []; const ids = new Set(tasks.map((task) => task.id)); for (const task of tasks) for (const dependency of task.dependencies) if (!ids.has(dependency)) diagnostics.push(diagnostic("MISSING_DEPENDENCY", "error", `${task.title} references a missing dependency.`, true, "Remove the dependency or restore the task.")); const order = boundedTopologicalOrder(tasks); if (order.length !== tasks.length) diagnostics.push(diagnostic("DEPENDENCY_CYCLE", "error", "The task plan contains a dependency cycle.", true, "Remove or reverse dependencies until the ordered list includes every task.")); const covered = new Set(tasks.flatMap((task) => task.acceptanceCriterionIds)); const uncoveredCriterionIds = specification.acceptanceCriteria.filter((item) => item.blocking && !covered.has(item.id)).map((item) => item.id); if (uncoveredCriterionIds.length) diagnostics.push(diagnostic("ACCEPTANCE_COVERAGE_GAP", "error", `${uncoveredCriterionIds.length} blocking acceptance criterion/criteria are not covered by a task.`, true, "Map every blocking criterion to a task or validation step.")); const unsupportedTaskIds = tasks.filter((task) => task.executionRoute === "unsupported").map((task) => task.id); if (unsupportedTaskIds.length) diagnostics.push(diagnostic("UNSUPPORTED_ROUTE", "error", `${unsupportedTaskIds.length} task(s) have no supported execution route.`, true, "Choose deterministic, GitHub Copilot, or manual execution.")); if (tasks.some((task) => !task.validationSteps.length)) diagnostics.push(diagnostic("VALIDATION_MISSING", "error", "Every task requires at least one validation step.", true, "Add a command or manual validation check.")); const text = `${specification.objective} ${specification.requirements.map((item) => item.description).join(" ")}`; if (/security|auth|permission|credential/i.test(text) && !tasks.some((task) => task.category === "security")) diagnostics.push(diagnostic("SECURITY_TASK_REQUIRED", "error", "Security-sensitive scope requires a security task.", true, "Add a security review task.")); if (/performance|latency|throughput|cache|query/i.test(text) && !tasks.some((task) => task.category === "performance")) diagnostics.push(diagnostic("PERFORMANCE_TASK_REQUIRED", "error", "Performance-sensitive scope requires a performance task.", true, "Add a performance validation task.")); return WorkbenchTaskPlanValidationSchema.parse({ valid: !diagnostics.some((item) => item.blocking), diagnostics, topologicalOrder: order, uncoveredCriterionIds, unsupportedTaskIds }); }
function boundedTopologicalOrder(tasks: DevelopmentTask[]): string[] { const remaining = new Map(tasks.map((task) => [task.id, new Set(task.dependencies)])); const ready = [...remaining.entries()].filter(([, dependencies]) => dependencies.size === 0).map(([id]) => id); const output: string[] = []; while (ready.length) { const id = ready.shift()!; if (output.includes(id)) continue; output.push(id); for (const [candidate, dependencies] of remaining) { dependencies.delete(id); if (!dependencies.size && !output.includes(candidate) && !ready.includes(candidate)) ready.push(candidate); } } return output; }
function diagnostic(code: string, severity: "info" | "warning" | "error", message: string, blocking: boolean, recoveryAction: string) { return { id: crypto.randomUUID(), code, severity, message, blocking, recoveryAction }; }
function stageState(stage: WorkbenchStageState["stage"], status: WorkbenchStageState["status"], blockers: WorkbenchStageState["blockers"], warnings: string[], primaryAction?: WorkbenchStageState["primaryAction"]): WorkbenchStageState { return { stage, status, blockers, warnings, ...(primaryAction ? { primaryAction } : {}) }; }
function normalizeObjective(text: string): string {
  return text.trim().replace(/\s+/g, " ").slice(0, 5000);
}
function categorize(text: string): DelegationTaskCategory {
  const value = text.toLowerCase();
  if (/security|auth|credential|permission/.test(value)) return "security";
  if (/performance|latency|memory|optim/.test(value)) return "performance";
  if (/bug|fix|defect|crash|error/.test(value)) return "bug-fix";
  if (/refactor|restructure/.test(value)) return "refactoring";
  if (/test|coverage/.test(value)) return "testing";
  if (/document|readme/.test(value)) return "documentation";
  if (/migrat/.test(value)) return "migration";
  if (/terraform|kubernetes|infrastructure/.test(value))
    return "infrastructure";
  if (/investigate|diagnose|understand/.test(value)) return "investigation";
  if (/\b(?:review|audit)\b/.test(value)) return "review";
  return /add|implement|create|feature/.test(value) ? "feature" : "maintenance";
}
function categoryForWorkType(type: DevelopmentWorkType): DelegationTaskCategory {
  return ({ feature: "feature", bug: "bug-fix", refactor: "refactoring", test: "testing", modernization: "modernization", investigation: "investigation" } as const)[type];
}
function assessRisk(text: string): DevelopmentIntent["risk"] {
  const value = text.toLowerCase();
  if (
    /credential|permission|security|database migration|production/.test(value)
  )
    return "critical";
  if (/public api|architecture|migration|breaking/.test(value)) return "high";
  if (/add|implement|refactor|config/.test(value)) return "medium";
  return "low";
}
function extractConstraints(text: string): DevelopmentIntent["constraints"] {
  const output: DevelopmentIntent["constraints"] = [
    {
      description: "Do not modify unrelated repository areas.",
      provenance: "keystone-policy",
    },
  ];
  if (/backward.compat|without breaking/i.test(text))
    output.push({
      description: "Maintain backward compatibility.",
      provenance: "user",
    });
  if (/no new dependenc|without (?:new )?dependenc/i.test(text))
    output.push({
      description: "Do not introduce new dependencies.",
      provenance: "user",
    });
  if (/security|secret|credential/i.test(text))
    output.push({
      description: "Preserve security and secret-handling boundaries.",
      provenance: "user",
    });
  return output;
}
function extractAmbiguities(
  text: string,
  risk: DevelopmentIntent["risk"],
): DevelopmentIntent["ambiguities"] {
  const output: DevelopmentIntent["ambiguities"] = [];
  if (/\b(maybe|perhaps|possibly|or)\b/i.test(text))
    output.push({
      question: "Which of the alternative or uncertain behaviors is required?",
      impact: "Scope may change materially.",
      blocking: true,
    });
  if (risk === "critical")
    output.push({
      question:
        "Confirm the high-risk implementation boundary and rollback expectations.",
      impact: "High-risk behavior must not be inferred.",
      blocking: true,
    });
  return output;
}
function expectedOutcome(text: string): string {
  return `Repository behavior satisfies: ${normalizeObjective(text)}`;
}
function explicitTerms(text: string): string[] {
  const values = [
    ...text.matchAll(
      /`([^`]{1,200})`|\b(?:src|lib|app|test|tests|docs)\/[\w./-]+|\b[A-Z][A-Za-z0-9_.]{2,}\b/g,
    ),
  ].map((match) => match[1] ?? match[0]);
  return [...new Set(values.map((item) => item.trim()).filter(Boolean))].slice(
    0,
    20,
  );
}
function fingerprints(
  snapshot: IntelligenceSnapshot,
  expectedFiles: string[],
  entityIds: string[],
): Record<string, string> {
  const output: Record<string, string> = {};
  for (const path of expectedFiles) {
    const file = snapshot.files.find((item) => item.relativePath === path);
    output[`file:${path}`] =
      file?.contentHash ?? file?.structuralHash ?? "missing";
  }
  for (const id of entityIds) {
    const entity = snapshot.symbols.find((item) => item.id === id);
    output[`entity:${id}`] = entity
      ? `${entity.signature ?? ""}:${entity.codeAnalysis?.structuralHash ?? ""}:${snapshot.files.find((file) => file.id === entity.fileId)?.contentHash ?? ""}`
      : "missing";
  }
  return output;
}
function requiredCapabilities(category: DelegationTaskCategory): string[] {
  if (category === "testing") return ["testing"];
  if (category === "security") return ["implementation", "security-review"];
  if (category === "performance")
    return ["implementation", "performance-review"];
  if (category === "documentation") return ["documentation"];
  if (category === "refactoring") return ["refactoring", "testing"];
  if (category === "infrastructure") return ["infrastructure"];
  if (category === "migration") return ["migration", "testing"];
  return ["implementation", "testing"];
}
function topologicalOrder(tasks: DevelopmentTask[]): string[] {
  const ready = tasks
    .filter((item) => !item.dependencies.length)
    .map((item) => item.id);
  const output: string[] = [];
  while (ready.length) {
    const id = ready.shift()!;
    output.push(id);
    for (const task of tasks)
      if (
        !output.includes(task.id) &&
        task.dependencies.every((dependency) => output.includes(dependency)) &&
        !ready.includes(task.id)
      )
        ready.push(task.id);
  }
  if (output.length !== tasks.length)
    throw new Error(
      "Generated task graph contains a dependency cycle or missing dependency.",
    );
  return output;
}
