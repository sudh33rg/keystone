import type { IntelligenceQueryService } from "../intelligence/IntelligenceQueryService";
import type { IntelligenceSnapshotReader } from "../persistence/IntelligenceStore";
import type { DelegationPersistenceStore } from "../persistence/DelegationPersistenceStore";
import {
  DevelopmentIntentSchema,
  DevelopmentSpecificationSchema,
  DevelopmentTaskGraphSchema,
  DevelopmentTaskSchema,
  DevelopmentWorkflowSnapshotSchema,
  type DelegationTaskCategory,
  type DevelopmentIntent,
  type DevelopmentSpecification,
  type DevelopmentTask,
  type DevelopmentWorkflowSnapshot,
} from "../../shared/contracts/delegation";
import type { IntelligenceSnapshot } from "../../shared/contracts/intelligence";

export class DevelopmentWorkflowService {
  constructor(
    private readonly persistence: DelegationPersistenceStore,
    private readonly snapshots: IntelligenceSnapshotReader,
    private readonly queries: IntelligenceQueryService,
  ) {}

  async initialize(): Promise<void> {
    await this.persistence.initialize();
  }
  list(): DevelopmentWorkflowSnapshot[] {
    return this.persistence.snapshot.workflows;
  }
  get(workflowId: string): DevelopmentWorkflowSnapshot | undefined {
    return this.list().find((item) => item.id === workflowId);
  }

  async capture(
    text: string,
    mode: "quick" | "guided" | "spec-driven",
    title?: string,
    signal?: AbortSignal,
  ): Promise<DevelopmentWorkflowSnapshot> {
    const snapshot = this.requireSnapshot();
    const now = new Date().toISOString();
    const workflowId = crypto.randomUUID();
    const category = categorize(text);
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
      intent.affectedEntities.flatMap((item) =>
        item.relativePath ? [item.relativePath] : [],
      ),
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
