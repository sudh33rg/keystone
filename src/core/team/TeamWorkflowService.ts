import type { DevelopmentWorkflowService } from "../workflows/DevelopmentWorkflowService";
import type { TeamWorkflowPersistenceStore } from "../persistence/TeamWorkflowPersistenceStore";
import type { ContextPackage } from "../../shared/contracts/contextPackage";
import {
  AssignmentEligibilitySchema,
  HandoffPackageSchema,
  HandoffReconciliationSchema,
  TEAM_SCHEMA_VERSION,
  TaskAssignmentSchema,
  TeamParticipantSchema,
  type AssignmentCreatePayload,
  type AssignmentDecisionPayload,
  type AssignmentEligibility,
  type HandoffAcceptance,
  type HandoffAcceptPayload,
  type HandoffCreatePayload,
  type HandoffDiagnostic,
  type HandoffExportRecord,
  type HandoffImportRecord,
  type HandoffPackage,
  type HandoffReconciliation,
  type HandoffRepositoryReference,
  type HandoffValidationResult,
  type ParticipantCreatePayload,
  type ParticipantUpdatePayload,
  type ReassignmentPayload,
  type TaskAssignment,
  type TeamAuditEntry,
  type TeamCapability,
  type TeamParticipant,
  type TeamPersistentState,
  type TeamProgressSnapshot,
} from "../../shared/contracts/team";
import {
  HandoffPackageValidator,
  decodeHandoffArtifact,
  packageFingerprint,
  sha256,
} from "./HandoffSecurity";

const ACTIVE_ASSIGNMENT_STATES: TaskAssignment["status"][] = [
  "assigned",
  "awaiting-acceptance",
  "accepted",
  "in-progress",
  "handoff-requested",
  "handoff-prepared",
];

export interface TeamRepositoryProvider {
  current(): Promise<HandoffRepositoryReference> | HandoffRepositoryReference;
  compare?(
    sender: HandoffRepositoryReference,
    receiver: HandoffRepositoryReference,
  ): Promise<"ahead" | "behind" | "diverged" | "missing-commits" | "unknown">;
  resolveEntities?(ids: string[]): Promise<string[]> | string[];
  providerVersions?(): Promise<Record<string, string>> | Record<string, string>;
}

export interface SharedArtifactAdapter {
  exportJson(suggestedName: string, content: string): Promise<string | undefined>;
  exportZip(suggestedName: string, content: Uint8Array): Promise<string | undefined>;
  exportRepositoryArtifact(relativePath: string, content: string): Promise<string>;
  importArtifact(): Promise<
    { source: "file" | "repository-artifact"; label: string; bytes: Uint8Array } | undefined
  >;
  writeClipboard(value: string): Promise<void>;
}

export interface HandoffEvidenceProvider {
  snapshot(
    taskId: string,
    workflowId: string,
  ): Partial<
    Pick<
      HandoffPackage,
      "execution" | "validation" | "delivery" | "changedFiles" | "changedEntities"
    >
  >;
}

export class ParticipantService {
  constructor(
    private readonly store: TeamWorkflowPersistenceStore,
    private readonly audit: HandoffAuditService,
  ) {}
  list(): TeamParticipant[] {
    return this.store.snapshot.participants;
  }
  get(id: string): TeamParticipant | undefined {
    return this.list().find((item) => item.id === id);
  }
  async create(
    input: ParticipantCreatePayload,
    actorParticipantId?: string,
  ): Promise<TeamParticipant> {
    const now = new Date().toISOString();
    const participant = TeamParticipantSchema.parse({
      schemaVersion: TEAM_SCHEMA_VERSION,
      id: crypto.randomUUID(),
      ...input,
      active: true,
      createdAt: now,
      updatedAt: now,
    });
    await this.store.update((state) =>
      this.audit.append(
        { ...state, participants: [...state.participants, participant] },
        "participant-created",
        participant.id,
        actorParticipantId,
      ),
    );
    return participant;
  }
  async update(
    input: ParticipantUpdatePayload,
    actorParticipantId?: string,
  ): Promise<TeamParticipant> {
    const current = this.get(input.participantId);
    if (!current) throw new Error("Participant not found.");
    const participant = TeamParticipantSchema.parse({
      ...current,
      ...input.patch,
      id: current.id,
      source: current.source,
      updatedAt: new Date().toISOString(),
    });
    await this.store.update((state) =>
      this.audit.append(
        {
          ...state,
          participants: state.participants.map((item) =>
            item.id === participant.id ? participant : item,
          ),
        },
        "participant-updated",
        participant.id,
        actorParticipantId,
      ),
    );
    return participant;
  }
  async remove(id: string, actorParticipantId?: string): Promise<void> {
    const current = this.get(id);
    if (!current) throw new Error("Participant not found.");
    if (
      this.store.snapshot.assignments.some(
        (item) => item.assignedTo === id && ACTIVE_ASSIGNMENT_STATES.includes(item.status),
      )
    )
      throw new Error("Participant has an active assignment and cannot be removed.");
    await this.store.update((state) =>
      this.audit.append(
        { ...state, participants: state.participants.filter((item) => item.id !== id) },
        "participant-removed",
        id,
        actorParticipantId,
      ),
    );
  }
}

export class AssignmentEligibilityService {
  constructor(
    private readonly workflows: DevelopmentWorkflowService,
    private readonly store: TeamWorkflowPersistenceStore,
  ) {}
  evaluate(
    workflowId: string,
    taskId: string,
    participant: TeamParticipant,
    replacingAssignmentId?: string,
  ): AssignmentEligibility {
    const workflow = this.workflows.get(workflowId);
    const task = workflow?.tasks.find((item) => item.id === taskId);
    const blockers: string[] = [];
    const warnings: string[] = [];
    const requiredCapabilities: TeamCapability[] = ["accept-task", "execute-task"];
    if (!workflow || !task)
      blockers.push("Workflow or task does not exist in canonical local workflow state.");
    if (workflow?.specification?.status !== "approved")
      blockers.push("The task specification is not approved.");
    if (task?.status === "stale") blockers.push("The task is stale.");
    if (task && !["ready", "pending", "blocked"].includes(task.status))
      blockers.push(`Task state ${task.status} is not assignable.`);
    const incomplete =
      task?.dependencies.filter(
        (id) => workflow?.tasks.find((item) => item.id === id)?.status !== "completed",
      ) ?? [];
    if (incomplete.length && !this.store.snapshot.settings.allowAssignmentBeforeDependencies)
      blockers.push(`${incomplete.length} task dependencies are incomplete.`);
    else if (incomplete.length)
      warnings.push(
        `${incomplete.length} dependencies remain incomplete; assignment is allowed by local policy.`,
      );
    if (!participant.active) blockers.push("Participant is inactive.");
    const missingCapabilities = requiredCapabilities.filter(
      (item) => !participant.capabilities.includes(item),
    );
    if (missingCapabilities.length)
      blockers.push(`Participant lacks required capabilities: ${missingCapabilities.join(", ")}.`);
    if (
      this.store.snapshot.assignments.some(
        (item) =>
          item.id !== replacingAssignmentId &&
          item.taskId === taskId &&
          ACTIVE_ASSIGNMENT_STATES.includes(item.status),
      )
    )
      blockers.push("The task already has an active primary assignment.");
    return AssignmentEligibilitySchema.parse({
      eligible: blockers.length === 0,
      blockers,
      warnings,
      requiredCapabilities,
      missingCapabilities,
      evaluatedAt: new Date().toISOString(),
    });
  }
}

export class HandoffAuditService {
  constructor(private readonly retain = 2_000) {}
  append(
    state: TeamPersistentState,
    action: TeamAuditEntry["action"],
    relatedId: string,
    actorParticipantId?: string,
    details?: Partial<
      Pick<TeamAuditEntry, "relatedType" | "previousState" | "newState" | "reason" | "evidence">
    >,
  ): TeamPersistentState {
    const entry: TeamAuditEntry = {
      id: crypto.randomUUID(),
      actorAssurance: "self-asserted-local",
      action,
      relatedType: details?.relatedType ?? "team-workflow",
      relatedId,
      evidence: details?.evidence ?? [],
      createdAt: new Date().toISOString(),
      ...(actorParticipantId ? { actorParticipantId } : {}),
      ...(details?.previousState ? { previousState: details.previousState } : {}),
      ...(details?.newState ? { newState: details.newState } : {}),
      ...(details?.reason ? { reason: details.reason } : {}),
    };
    return {
      ...state,
      audit: [...state.audit, entry].slice(
        -Math.min(this.retain, state.settings.retainAuditEntries),
      ),
    };
  }
  list(
    state: TeamPersistentState,
    input: { workflowId?: string; taskId?: string; limit?: number } = {},
  ): TeamAuditEntry[] {
    const ids = new Set(
      [input.workflowId, input.taskId].filter((item): item is string => Boolean(item)),
    );
    return state.audit
      .filter(
        (item) =>
          !ids.size || ids.has(item.relatedId) || item.evidence.some((value) => ids.has(value)),
      )
      .slice(-(input.limit ?? 100))
      .reverse();
  }
}

export class AssignmentService {
  constructor(
    private readonly store: TeamWorkflowPersistenceStore,
    private readonly workflows: DevelopmentWorkflowService,
    private readonly participants: ParticipantService,
    private readonly eligibility: AssignmentEligibilityService,
    private readonly repositories: TeamRepositoryProvider,
    private readonly audit: HandoffAuditService,
  ) {}
  list(workflowId?: string): TaskAssignment[] {
    return this.store.snapshot.assignments.filter(
      (item) => !workflowId || item.workflowId === workflowId,
    );
  }
  get(id: string): TaskAssignment | undefined {
    return this.list().find((item) => item.id === id);
  }
  async create(
    input: AssignmentCreatePayload,
    replacingAssignmentId?: string,
  ): Promise<TaskAssignment> {
    const workflow = this.workflows.get(input.workflowId);
    const task = workflow?.tasks.find((item) => item.id === input.taskId);
    const participant = this.participants.get(input.assignedTo);
    if (!workflow || !task || !participant)
      throw new Error("Workflow, task, or participant not found.");
    if (!this.participants.get(input.assignedBy)?.capabilities.includes("assign-task"))
      throw new Error("Assigning participant lacks assign-task capability.");
    const result = this.eligibility.evaluate(
      input.workflowId,
      input.taskId,
      participant,
      replacingAssignmentId,
    );
    if (!result.eligible) throw new Error(result.blockers.join(" "));
    const repositoryBaseline = await this.repositories.current();
    if (repositoryBaseline.repositoryId !== workflow.repositoryId)
      throw new Error("The active repository identity does not match the workflow repository.");
    const now = new Date().toISOString();
    const assignment = TaskAssignmentSchema.parse({
      schemaVersion: TEAM_SCHEMA_VERSION,
      id: crypto.randomUUID(),
      ...input,
      status: "awaiting-acceptance",
      repositoryBaseline,
      specificationRevision: workflow.specification!.revision,
      intelligenceGeneration: repositoryBaseline.intelligenceGeneration,
      ...(replacingAssignmentId ? { previousAssignmentId: replacingAssignmentId } : {}),
      createdAt: now,
      updatedAt: now,
    });
    await this.store.update((state) =>
      this.audit.append(
        {
          ...state,
          assignments: [...state.assignments, assignment],
          ownership: [
            ...state.ownership.filter((item) => item.taskId !== assignment.taskId),
            {
              taskId: assignment.taskId,
              primaryAssignmentId: assignment.id,
              reviewerParticipantIds: [],
              observerParticipantIds: [],
              concurrentBoundaries: [],
              updatedAt: now,
            },
          ],
        },
        "assignment-created",
        assignment.id,
        input.assignedBy,
        {
          relatedType: "assignment",
          newState: assignment.status,
          evidence: [assignment.workflowId, assignment.taskId],
        },
      ),
    );
    return assignment;
  }
  async decide(
    input: AssignmentDecisionPayload,
    decision: "accepted" | "rejected" | "clarification-requested",
  ): Promise<TaskAssignment> {
    const current = this.get(input.assignmentId);
    if (!current) throw new Error("Assignment not found.");
    if (current.assignedTo !== input.participantId)
      throw new Error("Only the intended participant can decide this assignment.");
    if (current.status !== "awaiting-acceptance")
      throw new Error(`Assignment cannot be decided from ${current.status}.`);
    if (decision !== "accepted" && !input.reason?.trim()) throw new Error("A reason is required.");
    const status =
      decision === "accepted"
        ? "accepted"
        : decision === "rejected"
          ? "rejected"
          : "awaiting-acceptance";
    const now = new Date().toISOString();
    const updated = TaskAssignmentSchema.parse({
      ...current,
      status,
      updatedAt: now,
      ...(decision === "accepted" ? { acceptedAt: now } : {}),
      ...(decision === "rejected" ? { rejectionReason: input.reason, endedAt: now } : {}),
      ...(decision === "clarification-requested" ? { clarificationRequest: input.reason } : {}),
    });
    await this.store.update((state) =>
      this.audit.append(
        {
          ...state,
          assignments: state.assignments.map((item) => (item.id === updated.id ? updated : item)),
          ownership:
            decision === "rejected"
              ? state.ownership.map((item) =>
                  item.primaryAssignmentId === updated.id
                    ? { ...item, primaryAssignmentId: undefined, updatedAt: now }
                    : item,
                )
              : state.ownership,
        },
        decision === "accepted"
          ? "assignment-accepted"
          : decision === "rejected"
            ? "assignment-rejected"
            : "clarification-requested",
        updated.id,
        input.participantId,
        {
          relatedType: "assignment",
          previousState: current.status,
          newState: updated.status,
          reason: input.reason,
          evidence: [updated.workflowId, updated.taskId],
        },
      ),
    );
    return updated;
  }
  async update(
    id: string,
    patch: Partial<Pick<TaskAssignment, "priority" | "dueDate" | "notes">>,
  ): Promise<TaskAssignment> {
    const current = this.get(id);
    if (!current) throw new Error("Assignment not found.");
    const updated = TaskAssignmentSchema.parse({
      ...current,
      ...patch,
      id: current.id,
      updatedAt: new Date().toISOString(),
    });
    await this.store.update((state) => ({
      ...state,
      assignments: state.assignments.map((item) => (item.id === id ? updated : item)),
    }));
    return updated;
  }
  async cancel(input: AssignmentDecisionPayload): Promise<TaskAssignment> {
    const current = this.get(input.assignmentId);
    if (!current) throw new Error("Assignment not found.");
    if (input.participantId !== current.assignedBy && input.participantId !== current.assignedTo)
      throw new Error("Only the assigner or assignee can cancel this assignment.");
    if (!input.reason?.trim()) throw new Error("A cancellation reason is required.");
    const now = new Date().toISOString();
    const updated = TaskAssignmentSchema.parse({
      ...current,
      status: "cancelled",
      endedAt: now,
      updatedAt: now,
    });
    await this.store.update((state) =>
      this.audit.append(
        {
          ...state,
          assignments: state.assignments.map((item) => (item.id === updated.id ? updated : item)),
          ownership: state.ownership.map((item) =>
            item.primaryAssignmentId === updated.id
              ? { ...item, primaryAssignmentId: undefined, updatedAt: now }
              : item,
          ),
        },
        "cancelled",
        updated.id,
        input.participantId,
        {
          relatedType: "assignment",
          previousState: current.status,
          newState: updated.status,
          reason: input.reason,
        },
      ),
    );
    return updated;
  }
}

export class TaskOwnershipService {
  constructor(private readonly store: TeamWorkflowPersistenceStore) {}
  get(taskId: string) {
    return this.store.snapshot.ownership.find((item) => item.taskId === taskId);
  }
}

export class HandoffPackageBuilder {
  constructor(
    private readonly store: TeamWorkflowPersistenceStore,
    private readonly workflows: DevelopmentWorkflowService,
    private readonly participants: ParticipantService,
    private readonly contexts: (taskId: string) => ContextPackage | undefined,
    private readonly repositories: TeamRepositoryProvider,
    private readonly audit: HandoffAuditService,
    private readonly evidence?: HandoffEvidenceProvider,
  ) {}
  async build(input: HandoffCreatePayload): Promise<HandoffPackage> {
    const started = performance.now();
    const assignment = this.store.snapshot.assignments.find(
      (item) => item.id === input.assignmentId,
    );
    if (!assignment) throw new Error("Assignment not found.");
    if (assignment.assignedTo !== input.senderParticipantId)
      throw new Error("Only the current assignee can prepare this handoff.");
    if (!["accepted", "in-progress", "handoff-requested"].includes(assignment.status))
      throw new Error(`A handoff cannot be prepared from ${assignment.status}.`);
    const workflow = this.workflows.get(assignment.workflowId);
    const task = workflow?.tasks.find((item) => item.id === assignment.taskId);
    const specification = workflow?.specification;
    const sender = this.participants.get(input.senderParticipantId);
    const receiver = input.receiverParticipantId
      ? this.participants.get(input.receiverParticipantId)
      : undefined;
    if (!workflow || !task || !specification || !sender)
      throw new Error("Canonical task, specification, or sender state is unavailable.");
    if (input.receiverParticipantId && !receiver) throw new Error("Intended receiver not found.");
    const repository = await this.repositories.current();
    if (repository.repositoryId !== workflow.repositoryId)
      throw new Error("The active repository identity does not match the handed-off workflow.");
    const context = this.contexts(task.id);
    const evidence = this.evidence?.snapshot(task.id, workflow.id) ?? {};
    const now = new Date().toISOString();
    const placeholder = `sha256:${"0".repeat(64)}`;
    const packageData = HandoffPackageSchema.parse({
      schemaVersion: TEAM_SCHEMA_VERSION,
      id: crypto.randomUUID(),
      workflowId: workflow.id,
      taskId: task.id,
      assignmentId: assignment.id,
      sender: participantSnapshot(sender),
      ...(receiver ? { intendedReceiver: participantSnapshot(receiver) } : {}),
      repository,
      intent: workflow.intent,
      specification,
      task,
      assignment,
      progress: {
        stage: "handoff-prepared",
        completedWork: input.completedWork,
        remainingWork: input.remainingWork,
        nextRecommendedAction: input.remainingWork[0],
        updatedAt: now,
      },
      context: context
        ? [
            {
              contextPackageId: context.id,
              contentFingerprint: context.contentFingerprint,
              sourceFingerprint: context.contentFingerprint,
              reviewed: context.metadata.status === "approved",
              pinnedItemIds: context.items.filter((item) => item.pinned).map((item) => item.id),
              canonicalEntityIds: context.items.flatMap((item) =>
                item.sourceReference.symbolId ? [item.sourceReference.symbolId] : [],
              ),
              sourcePaths: [
                ...new Set(
                  context.items.flatMap((item) =>
                    item.sourceReference.filePath ? [item.sourceReference.filePath] : [],
                  ),
                ),
              ],
              graphPathIds: context.items
                .filter(
                  (item) => item.sourceType === "data-flow" || item.sourceType === "call-flow",
                )
                .map((item) => item.id),
              cpgScopeIds: context.items
                .filter((item) => item.sourceType === "call-flow" && item.id.startsWith("cpg:"))
                .map((item) => item.id),
              okfConceptIds: [],
            },
          ]
        : [],
      ...evidence,
      changedFiles: evidence.changedFiles ?? [],
      changedEntities: evidence.changedEntities ?? [],
      blockers: input.blockers,
      openQuestions: input.openQuestions,
      ...(input.senderNotes ? { senderNotes: input.senderNotes } : {}),
      attachments: [],
      createdAt: now,
      fingerprint: placeholder,
      diagnostics: [
        {
          code: "local-identity",
          severity: "info",
          message:
            "Participant identity is self-asserted local metadata, not authenticated identity.",
        },
        {
          code: "changes-not-embedded",
          severity: "info",
          message:
            "No working-tree content or executable patch is embedded. The receiver must reconcile repository state separately.",
        },
      ],
      metrics: { generationDurationMs: 0, packageBytes: 0, attachmentBytes: 0 },
    });
    packageData.fingerprint = packageFingerprint(packageData);
    packageData.metrics.generationDurationMs = performance.now() - started;
    packageData.metrics.packageBytes = Buffer.byteLength(JSON.stringify(packageData));
    const finalPackage = HandoffPackageSchema.parse(packageData);
    const validation = new HandoffPackageValidator().validate(
      finalPackage,
      this.store.snapshot.settings,
    );
    if (!validation.valid)
      throw new Error(validation.diagnostics.map((item) => item.message).join(" "));
    const updatedAssignment = TaskAssignmentSchema.parse({
      ...assignment,
      status: "handoff-prepared",
      updatedAt: now,
    });
    await this.store.update((state) =>
      this.audit.append(
        {
          ...state,
          packages: [
            ...state.packages.filter((item) => item.id !== finalPackage.id),
            finalPackage,
          ].slice(-200),
          assignments: state.assignments.map((item) =>
            item.id === assignment.id ? updatedAssignment : item,
          ),
        },
        "package-created",
        finalPackage.id,
        sender.id,
        {
          relatedType: "handoff-package",
          evidence: [workflow.id, task.id, assignment.id, finalPackage.fingerprint],
        },
      ),
    );
    return finalPackage;
  }
}

export class HandoffReconciliationService {
  constructor(
    private readonly store: TeamWorkflowPersistenceStore,
    private readonly repositories: TeamRepositoryProvider,
    private readonly workflows: DevelopmentWorkflowService,
    private readonly audit: HandoffAuditService,
  ) {}
  async reconcile(packageData: HandoffPackage): Promise<HandoffReconciliation> {
    const started = performance.now();
    const receiver = await this.repositories.current();
    let compatibility: HandoffReconciliation["compatibility"] = "unknown";
    const differences: string[] = [];
    if (packageData.repository.repositoryId !== receiver.repositoryId) {
      compatibility = "wrong-repository";
      differences.push("Repository identity differs from the sender package.");
    } else if (packageData.repository.branch !== receiver.branch) {
      compatibility = "wrong-branch";
      differences.push(
        `Sender branch ${packageData.repository.branch ?? "unknown"}; receiver branch ${receiver.branch ?? "unknown"}.`,
      );
    } else if (packageData.repository.repositoryFingerprint === receiver.repositoryFingerprint)
      compatibility = "exact";
    else if (
      packageData.repository.headCommit &&
      packageData.repository.headCommit === receiver.headCommit
    )
      compatibility = "compatible";
    else if (this.repositories.compare)
      compatibility = await this.repositories.compare(packageData.repository, receiver);
    const fileDifferences = Object.entries(packageData.repository.relevantFileFingerprints)
      .filter(([path, fingerprint]) => receiver.relevantFileFingerprints[path] !== fingerprint)
      .map(([path]) => path);
    if (fileDifferences.length)
      differences.push(`${fileDifferences.length} relevant file fingerprint(s) differ.`);
    if (compatibility === "exact" && fileDifferences.length) compatibility = "compatible";
    const receiverWorkflow = this.workflows.get(packageData.workflowId);
    const specificationMismatch = Boolean(
      receiverWorkflow?.specification &&
      (receiverWorkflow.specification.id !== packageData.specification.id ||
        receiverWorkflow.specification.revision !== packageData.specification.revision),
    );
    const taskMissing = Boolean(
      receiverWorkflow && !receiverWorkflow.tasks.some((item) => item.id === packageData.taskId),
    );
    const generationMismatch =
      receiver.intelligenceGeneration !== packageData.repository.intelligenceGeneration;
    if (!receiverWorkflow)
      differences.push(
        "The receiver has no local canonical workflow matching this package; the imported snapshot remains reviewable.",
      );
    if (specificationMismatch)
      differences.push(
        "The receiver specification identity or revision differs from the handoff snapshot.",
      );
    if (taskMissing)
      differences.push("The receiver workflow does not contain the handed-off task identity.");
    if (generationMismatch)
      differences.push(
        `Intelligence generation differs: sender ${packageData.repository.intelligenceGeneration}, receiver ${receiver.intelligenceGeneration}.`,
      );
    const entityIds = [
      ...new Set([
        ...packageData.task.expectedEntityIds,
        ...packageData.changedEntities.map((item) => item.entityId),
        ...packageData.context.flatMap((item) => item.canonicalEntityIds),
      ]),
    ].slice(0, 500);
    const unresolvedEntityIds = this.repositories.resolveEntities
      ? await this.repositories.resolveEntities(entityIds)
      : [];
    if (unresolvedEntityIds.length)
      differences.push(
        `${unresolvedEntityIds.length} canonical entity reference(s) are unresolved in receiver intelligence.`,
      );
    const receiverVersions = this.repositories.providerVersions
      ? await this.repositories.providerVersions()
      : {};
    const providerMismatches = Object.entries(packageData.validation?.providerVersions ?? {})
      .filter(([id, version]) => receiverVersions[id] !== version)
      .map(([id]) => id);
    if (providerMismatches.length)
      differences.push(
        `Validation or Intelligence provider versions differ: ${providerMismatches.join(", ")}.`,
      );
    const affectedFileDifference = fileDifferences.some(
      (path) =>
        packageData.task.expectedFiles.includes(path) ||
        packageData.changedFiles.some((item) => item.path === path),
    );
    const safeToAccept =
      ["exact", "compatible", "ahead"].includes(compatibility) &&
      !affectedFileDifference &&
      !specificationMismatch &&
      !taskMissing &&
      unresolvedEntityIds.length === 0 &&
      providerMismatches.length === 0;
    const contextStale = !safeToAccept || generationMismatch;
    const diagnostics: HandoffDiagnostic[] = safeToAccept
      ? []
      : [
          {
            code: "repository-review-required",
            severity: "warning",
            message: "Repository differences require review before active continuation.",
          },
        ];
    const reconciliation = HandoffReconciliationSchema.parse({
      schemaVersion: TEAM_SCHEMA_VERSION,
      id: crypto.randomUUID(),
      packageId: packageData.id,
      packageFingerprint: packageData.fingerprint,
      receiverRepositoryFingerprint: receiver.repositoryFingerprint,
      compatibility,
      safeToAccept,
      differences,
      staleContextIds: contextStale ? packageData.context.map((item) => item.contextPackageId) : [],
      reusableContextIds: contextStale
        ? []
        : packageData.context.map((item) => item.contextPackageId),
      reusedValidationRunIds:
        safeToAccept && !generationMismatch ? (packageData.validation?.runIds ?? []) : [],
      invalidatedValidationRunIds:
        safeToAccept && !generationMismatch ? [] : (packageData.validation?.runIds ?? []),
      unresolvedEntityIds,
      missingChangedFiles: fileDifferences,
      requiredActions: safeToAccept
        ? [
            "Review the package and explicitly accept, reject, or keep it read-only.",
            ...(generationMismatch
              ? ["Rebuild context against the receiver Intelligence generation before delegation."]
              : []),
          ]
        : [
            "Align or review repository state.",
            "Rebuild stale context and validation before continuation.",
          ],
      diagnostics,
      durationMs: performance.now() - started,
      createdAt: new Date().toISOString(),
    });
    await this.store.update((state) =>
      this.audit.append(
        { ...state, reconciliations: [...state.reconciliations, reconciliation].slice(-500) },
        "package-validated",
        reconciliation.id,
        undefined,
        { relatedType: "reconciliation", evidence: [packageData.id, packageData.fingerprint] },
      ),
    );
    return reconciliation;
  }
}

export class HandoffAcceptanceService {
  constructor(
    private readonly store: TeamWorkflowPersistenceStore,
    private readonly participants: ParticipantService,
    private readonly workflows: DevelopmentWorkflowService,
    private readonly repositories: TeamRepositoryProvider,
    private readonly audit: HandoffAuditService,
  ) {}
  async decide(input: HandoffAcceptPayload): Promise<HandoffAcceptance> {
    const packageData = this.store.snapshot.packages.find((item) => item.id === input.packageId);
    const reconciliation = this.store.snapshot.reconciliations.find(
      (item) => item.id === input.reconciliationId,
    );
    const receiver = this.participants.get(input.receiverParticipantId);
    if (!packageData || !reconciliation || !receiver)
      throw new Error("Package, reconciliation, or receiver not found.");
    if (reconciliation.packageFingerprint !== packageData.fingerprint)
      throw new Error("Reconciliation is stale for this package fingerprint.");
    if (packageData.intendedReceiver && packageData.intendedReceiver.id !== receiver.id)
      throw new Error("The package names a different intended receiver.");
    if (input.decision === "accepted" && !reconciliation.safeToAccept)
      throw new Error(
        "Repository reconciliation is not safe for active acceptance. Use read-only review or resolve differences.",
      );
    if (input.decision !== "accepted" && !input.reason?.trim())
      throw new Error("A reason is required for rejection or read-only review.");
    const receiverRepository =
      input.decision === "accepted" ? await this.repositories.current() : packageData.repository;
    if (input.decision === "accepted")
      await this.workflows.importTransferredTask(
        packageData.intent,
        packageData.specification,
        packageData.task,
        receiverRepository,
      );
    const source =
      this.store.snapshot.assignments.find((item) => item.id === packageData.assignmentId) ??
      packageData.assignment;
    const now = new Date().toISOString();
    const newAssignment = TaskAssignmentSchema.parse({
      ...source,
      id: crypto.randomUUID(),
      assignedBy: packageData.sender.id,
      assignedTo: receiver.id,
      status: input.decision === "accepted" ? "accepted" : "draft",
      previousAssignmentId: source.id,
      repositoryBaseline: receiverRepository,
      specificationRevision: packageData.specification.revision,
      intelligenceGeneration: receiverRepository.intelligenceGeneration,
      rejectionReason: undefined,
      clarificationRequest: undefined,
      acceptedAt: input.decision === "accepted" ? now : undefined,
      endedAt: undefined,
      createdAt: now,
      updatedAt: now,
    });
    const acceptance: HandoffAcceptance = {
      id: crypto.randomUUID(),
      packageId: packageData.id,
      ...(input.importId ? { importId: input.importId } : {}),
      assignmentId: newAssignment.id,
      receiverParticipantId: receiver.id,
      decision: input.decision,
      ...(input.reason ? { reason: input.reason } : {}),
      packageFingerprint: packageData.fingerprint,
      reconciliationId: reconciliation.id,
      continuationSessionRequired: true,
      decidedAt: now,
    };
    await this.store.update((state) =>
      this.audit.append(
        {
          ...state,
          acceptances: [...state.acceptances, acceptance].slice(-500),
          assignments:
            input.decision === "accepted"
              ? [
                  ...state.assignments.map((item) =>
                    item.id === source.id
                      ? { ...item, status: "transferred" as const, endedAt: now, updatedAt: now }
                      : item,
                  ),
                  newAssignment,
                ]
              : state.assignments,
          ownership:
            input.decision === "accepted"
              ? state.ownership.some((item) => item.taskId === packageData.taskId)
                ? state.ownership.map((item) =>
                    item.taskId === packageData.taskId
                      ? { ...item, primaryAssignmentId: newAssignment.id, updatedAt: now }
                      : item,
                  )
                : [
                    ...state.ownership,
                    {
                      taskId: packageData.taskId,
                      primaryAssignmentId: newAssignment.id,
                      reviewerParticipantIds: [],
                      observerParticipantIds: [],
                      concurrentBoundaries: [],
                      updatedAt: now,
                    },
                  ]
              : state.ownership,
          imports: state.imports.map((item) =>
            item.id === input.importId
              ? {
                  ...item,
                  status:
                    input.decision === "accepted"
                      ? ("accepted" as const)
                      : input.decision === "rejected"
                        ? ("rejected" as const)
                        : ("read-only" as const),
                  receiverParticipantId: receiver.id,
                  reason: input.reason,
                  updatedAt: now,
                }
              : item,
          ),
        },
        input.decision === "accepted"
          ? "handoff-accepted"
          : input.decision === "rejected"
            ? "handoff-rejected"
            : "read-only-import",
        acceptance.id,
        receiver.id,
        {
          relatedType: "handoff-acceptance",
          reason: input.reason,
          evidence: [packageData.id, packageData.taskId, reconciliation.id],
        },
      ),
    );
    return acceptance;
  }
}

export class ReassignmentService {
  constructor(
    private readonly assignments: AssignmentService,
    private readonly store: TeamWorkflowPersistenceStore,
    private readonly audit: HandoffAuditService,
  ) {}
  async reassign(input: ReassignmentPayload): Promise<TaskAssignment> {
    const previous = this.assignments.get(input.assignmentId);
    if (!previous) throw new Error("Assignment not found.");
    if (ACTIVE_ASSIGNMENT_STATES.includes(previous.status) && !input.handoffPackageId)
      throw new Error("Active reassignment requires an explicit handoff package.");
    if (
      input.handoffPackageId &&
      !this.store.snapshot.packages.some(
        (item) => item.id === input.handoffPackageId && item.assignmentId === previous.id,
      )
    )
      throw new Error("The reassignment handoff package does not match the active assignment.");
    const next = await this.assignments.create(
      {
        workflowId: previous.workflowId,
        taskId: previous.taskId,
        assignedBy: input.requestedBy,
        assignedTo: input.assignedTo,
        priority: previous.priority,
        dueDate: previous.dueDate,
        notes: input.reason,
      },
      previous.id,
    );
    const now = new Date().toISOString();
    await this.store.update((state) =>
      this.audit.append(
        {
          ...state,
          assignments: state.assignments.map((item) =>
            item.id === previous.id
              ? { ...item, status: "transferred" as const, endedAt: now, updatedAt: now }
              : item,
          ),
          reassignments: [
            ...state.reassignments,
            {
              id: crypto.randomUUID(),
              taskId: previous.taskId,
              workflowId: previous.workflowId,
              previousAssignmentId: previous.id,
              newAssignmentId: next.id,
              requestedBy: input.requestedBy,
              reason: input.reason,
              ...(input.handoffPackageId ? { handoffPackageId: input.handoffPackageId } : {}),
              createdAt: now,
            },
          ].slice(-500),
        },
        "reassigned",
        next.id,
        input.requestedBy,
        {
          relatedType: "assignment",
          reason: input.reason,
          evidence: [previous.id, previous.taskId],
        },
      ),
    );
    return next;
  }
}

export class ProgressService {
  constructor(
    private readonly store: TeamWorkflowPersistenceStore,
    private readonly workflows: DevelopmentWorkflowService,
  ) {}
  get(workflowId: string): TeamProgressSnapshot {
    const workflow = this.workflows.get(workflowId);
    if (!workflow?.specification) throw new Error("Workflow or specification not found.");
    const assignments = this.store.snapshot.assignments.filter(
      (item) => item.workflowId === workflowId,
    );
    return {
      workflowId,
      specificationRevision: workflow.specification.revision,
      taskCounts: countBy(workflow.tasks.map((item) => item.status)),
      assignmentCounts: countBy(assignments.map((item) => item.status)),
      activeBlockers: workflow.tasks.flatMap((item) =>
        item.status === "blocked" ? [`${item.title} is blocked.`] : [],
      ),
      staleTaskIds: workflow.tasks.filter((item) => item.status === "stale").map((item) => item.id),
      unassignedTaskIds: workflow.tasks
        .filter(
          (task) =>
            !assignments.some(
              (item) => item.taskId === task.id && ACTIVE_ASSIGNMENT_STATES.includes(item.status),
            ),
        )
        .map((item) => item.id),
      dueAssignments: assignments
        .filter(
          (item) =>
            item.dueDate &&
            Date.parse(item.dueDate) <= Date.now() &&
            ACTIVE_ASSIGNMENT_STATES.includes(item.status),
        )
        .map((item) => item.id),
      handoffIds: this.store.snapshot.packages
        .filter((item) => item.workflowId === workflowId)
        .map((item) => item.id),
      validationStates: {},
      freshness: "current-local",
      updatedAt: new Date().toISOString(),
    };
  }
}

export class HandoffImportService {
  constructor(
    private readonly store: TeamWorkflowPersistenceStore,
    private readonly validator: HandoffPackageValidator,
    private readonly audit: HandoffAuditService,
  ) {}
  async importJson(
    bytes: Uint8Array,
    source: HandoffImportRecord["source"],
    label: string,
    signal?: AbortSignal,
  ): Promise<{
    package: HandoffPackage;
    validation: HandoffValidationResult;
    record: HandoffImportRecord;
  }> {
    signal?.throwIfAborted();
    const settings = this.store.snapshot.settings;
    const decoded = decodeHandoffArtifact(bytes, settings.maxPackageBytes);
    signal?.throwIfAborted();
    const now = new Date().toISOString();
    const provisional: HandoffImportRecord = {
      id: crypto.randomUUID(),
      packageId: crypto.randomUUID(),
      packageFingerprint: sha256(decoded),
      source,
      sourceLabel: label.slice(0, 500),
      status: "validating",
      importedAt: now,
      updatedAt: now,
    };
    await this.store.update((state) => ({
      ...state,
      imports: [...state.imports, provisional].slice(-500),
    }));
    try {
      let raw: unknown;
      try {
        raw = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(decoded));
      } catch {
        throw new Error("Handoff artifact is not valid UTF-8 JSON.");
      }
      const validation = this.validator.validate(raw, settings);
      signal?.throwIfAborted();
      if (!validation.valid)
        throw new Error(validation.diagnostics.map((item) => item.message).join(" "));
      const packageData = HandoffPackageSchema.parse(raw);
      const record: HandoffImportRecord = {
        ...provisional,
        packageId: packageData.id,
        packageFingerprint: packageData.fingerprint,
        status: "reviewable",
        updatedAt: new Date().toISOString(),
      };
      if (
        this.store.snapshot.imports.some(
          (item) =>
            item.id !== provisional.id &&
            item.packageFingerprint === packageData.fingerprint &&
            !["failed", "cancelled", "interrupted"].includes(item.status),
        )
      )
        throw new Error(
          "This exact handoff package was already imported. Review its existing import record instead of replaying it.",
        );
      signal?.throwIfAborted();
      await this.store.update((state) => {
        const importedReceiver =
          packageData.intendedReceiver &&
          !state.participants.some((item) => item.id === packageData.intendedReceiver!.id)
            ? TeamParticipantSchema.parse({
                schemaVersion: TEAM_SCHEMA_VERSION,
                id: packageData.intendedReceiver.id,
                displayName: packageData.intendedReceiver.displayName,
                role: packageData.intendedReceiver.role,
                source: "imported",
                capabilities: packageData.intendedReceiver.capabilities,
                active: true,
                createdAt: now,
                updatedAt: now,
              })
            : undefined;
        return this.audit.append(
          {
            ...state,
            participants: importedReceiver
              ? [...state.participants, importedReceiver]
              : state.participants,
            packages: [
              ...state.packages.filter((item) => item.fingerprint !== packageData.fingerprint),
              packageData,
            ].slice(-200),
            imports: state.imports.map((item) => (item.id === provisional.id ? record : item)),
          },
          "package-imported",
          record.id,
          undefined,
          { relatedType: "handoff-import", evidence: [packageData.id, packageData.fingerprint] },
        );
      });
      return { package: packageData, validation, record };
    } catch (cause) {
      const cancelled = signal?.aborted === true;
      const reason =
        cause instanceof Error ? cause.message.slice(0, 5000) : "Handoff import failed.";
      await this.store.update((state) => ({
        ...state,
        imports: state.imports.map((item) =>
          item.id === provisional.id
            ? {
                ...item,
                status: cancelled ? ("cancelled" as const) : ("failed" as const),
                reason,
                updatedAt: new Date().toISOString(),
              }
            : item,
        ),
      }));
      throw cause;
    }
  }
}

export class SharedArtifactService {
  constructor(
    private readonly store: TeamWorkflowPersistenceStore,
    private readonly adapter: SharedArtifactAdapter,
    private readonly audit: HandoffAuditService,
  ) {}
  async export(
    packageData: HandoffPackage,
    mode: "json" | "zip" | "repository-artifact" | "clipboard-summary",
  ): Promise<string | undefined> {
    const validation = new HandoffPackageValidator().validate(
      packageData,
      this.store.snapshot.settings,
    );
    if (!validation.valid)
      throw new Error(validation.diagnostics.map((item) => item.message).join(" "));
    const content = JSON.stringify(packageData, null, 2);
    const base = safeName(packageData.task.title);
    let destination: string | undefined;
    let reducedFidelity = false;
    if (mode === "json")
      destination = await this.adapter.exportJson(`${base}.keystone-handoff.json`, content);
    else if (mode === "zip")
      destination = await this.adapter.exportZip(
        `${base}.keystone-handoff.zip`,
        createStoredZip("handoff.json", new TextEncoder().encode(content)),
      );
    else if (mode === "repository-artifact") {
      if (!this.store.snapshot.settings.repositoryArtifactsEnabled)
        throw new Error(
          "Repository artifact export is disabled. Enable it explicitly before writing under .keystone/handoffs.",
        );
      destination = await this.adapter.exportRepositoryArtifact(
        `.keystone/handoffs/${base}.keystone-handoff.json`,
        content,
      );
    } else {
      reducedFidelity = true;
      const summary = clipboardSummary(packageData);
      await this.adapter.writeClipboard(summary);
      destination = "clipboard";
    }
    if (!destination) return undefined;
    const record: HandoffExportRecord = {
      id: crypto.randomUUID(),
      packageId: packageData.id,
      packageFingerprint: packageData.fingerprint,
      mode,
      destinationLabel: destination.slice(0, 500),
      status: "exported",
      reducedFidelity,
      sizeBytes:
        mode === "clipboard-summary"
          ? Buffer.byteLength(clipboardSummary(packageData))
          : Buffer.byteLength(content),
      exportedAt: new Date().toISOString(),
    };
    await this.store.update((state) =>
      this.audit.append(
        { ...state, exports: [...state.exports, record].slice(-500) },
        "package-exported",
        packageData.id,
        packageData.sender.id,
        { relatedType: "handoff-export", evidence: [packageData.fingerprint, mode] },
      ),
    );
    return destination;
  }
  selectImport(): ReturnType<SharedArtifactAdapter["importArtifact"]> {
    return this.adapter.importArtifact();
  }
}

export class HandoffContextService {
  reusable(reconciliation: HandoffReconciliation): string[] {
    return reconciliation.reusableContextIds;
  }
}
export class TeamWorkflowPersistenceService extends ParticipantService {}
export class HandoffExportService extends SharedArtifactService {}

export class HandoffService {
  constructor(
    readonly packages: HandoffPackageBuilder,
    readonly validator: HandoffPackageValidator,
    readonly imports: HandoffImportService,
    readonly reconciliation: HandoffReconciliationService,
    readonly acceptance: HandoffAcceptanceService,
    readonly artifacts: SharedArtifactService,
  ) {}
}

export class TeamWorkflowService {
  readonly audit: HandoffAuditService;
  readonly participants: ParticipantService;
  readonly eligibility: AssignmentEligibilityService;
  readonly assignments: AssignmentService;
  readonly ownership: TaskOwnershipService;
  readonly packages: HandoffPackageBuilder;
  readonly validator: HandoffPackageValidator;
  readonly imports: HandoffImportService;
  readonly reconciliation: HandoffReconciliationService;
  readonly acceptance: HandoffAcceptanceService;
  readonly reassignments: ReassignmentService;
  readonly progress: ProgressService;
  readonly artifacts: SharedArtifactService;
  readonly handoff: HandoffService;
  constructor(
    readonly store: TeamWorkflowPersistenceStore,
    private readonly workflows: DevelopmentWorkflowService,
    private readonly repositories: TeamRepositoryProvider,
    contexts: (taskId: string) => ContextPackage | undefined,
    adapter: SharedArtifactAdapter,
    evidence?: HandoffEvidenceProvider,
  ) {
    this.audit = new HandoffAuditService();
    this.participants = new ParticipantService(store, this.audit);
    this.eligibility = new AssignmentEligibilityService(workflows, store);
    this.assignments = new AssignmentService(
      store,
      workflows,
      this.participants,
      this.eligibility,
      repositories,
      this.audit,
    );
    this.ownership = new TaskOwnershipService(store);
    this.packages = new HandoffPackageBuilder(
      store,
      workflows,
      this.participants,
      contexts,
      repositories,
      this.audit,
      evidence,
    );
    this.validator = new HandoffPackageValidator();
    this.imports = new HandoffImportService(store, this.validator, this.audit);
    this.reconciliation = new HandoffReconciliationService(
      store,
      repositories,
      workflows,
      this.audit,
    );
    this.acceptance = new HandoffAcceptanceService(
      store,
      this.participants,
      workflows,
      repositories,
      this.audit,
    );
    this.reassignments = new ReassignmentService(this.assignments, store, this.audit);
    this.progress = new ProgressService(store, workflows);
    this.artifacts = new SharedArtifactService(store, adapter, this.audit);
    this.handoff = new HandoffService(
      this.packages,
      this.validator,
      this.imports,
      this.reconciliation,
      this.acceptance,
      this.artifacts,
    );
  }
  async initialize(): Promise<TeamPersistentState> {
    return this.store.initialize();
  }
  snapshot(): TeamPersistentState {
    return this.store.snapshot;
  }
  async reconcileStaleness(workflowId: string): Promise<TaskAssignment[]> {
    const workflow = this.workflows.get(workflowId);
    if (!workflow) return [];
    const repository = await this.repositories.current();
    const active = this.assignments
      .list(workflowId)
      .filter((item) => ACTIVE_ASSIGNMENT_STATES.includes(item.status));
    const stale = active.filter((assignment) => {
      const task = workflow.tasks.find((item) => item.id === assignment.taskId);
      return (
        !task ||
        task.status === "stale" ||
        assignment.specificationRevision !== workflow.specification?.revision ||
        assignment.intelligenceGeneration !== repository.intelligenceGeneration ||
        assignment.repositoryBaseline.repositoryId !== repository.repositoryId ||
        assignment.repositoryBaseline.branch !== repository.branch
      );
    });
    if (!stale.length) return [];
    const ids = new Set(stale.map((item) => item.id));
    const now = new Date().toISOString();
    await this.store.update((state) => {
      let next = {
        ...state,
        assignments: state.assignments.map((item) =>
          ids.has(item.id)
            ? { ...item, status: "stale" as const, endedAt: now, updatedAt: now }
            : item,
        ),
        ownership: state.ownership.map((item) =>
          item.primaryAssignmentId && ids.has(item.primaryAssignmentId)
            ? { ...item, primaryAssignmentId: undefined, updatedAt: now }
            : item,
        ),
      };
      for (const assignment of stale)
        next = this.audit.append(next, "assignment-stale", assignment.id, undefined, {
          relatedType: "assignment",
          previousState: assignment.status,
          newState: "stale",
          reason: "Specification, task, repository, branch, or Intelligence generation changed.",
          evidence: [workflowId, assignment.taskId],
        });
      return next;
    });
    return this.assignments.list(workflowId).filter((item) => ids.has(item.id));
  }
}

function participantSnapshot(participant: TeamParticipant): HandoffPackage["sender"] {
  return {
    id: participant.id,
    displayName: participant.displayName,
    role: participant.role,
    capabilities: participant.capabilities,
    identityAssurance: "self-asserted-local",
  };
}
function countBy(values: string[]): Record<string, number> {
  return values.reduce<Record<string, number>>(
    (result, value) => ({ ...result, [value]: (result[value] ?? 0) + 1 }),
    {},
  );
}
function safeName(value: string): string {
  return (
    value
      .toLowerCase()
      .replace(/[^a-z0-9._-]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 80) || "task"
  );
}
function clipboardSummary(value: HandoffPackage): string {
  return [
    `Keystone handoff: ${value.task.title}`,
    `Package: ${value.id}`,
    `Fingerprint: ${value.fingerprint}`,
    `Sender: ${value.sender.displayName} (self-asserted local)`,
    `Repository: ${value.repository.repositoryId}`,
    `Branch/HEAD: ${value.repository.branch ?? "unknown"} @ ${value.repository.headCommit ?? "unknown"}`,
    `Completed: ${value.progress.completedWork.join("; ") || "none recorded"}`,
    `Remaining: ${value.progress.remainingWork.join("; ") || "none recorded"}`,
    "Reduced-fidelity summary only. Import the signed-fingerprint JSON/ZIP artifact for acceptance.",
  ].join("\n");
}

function createStoredZip(name: string, data: Uint8Array): Uint8Array {
  const filename = new TextEncoder().encode(name);
  const crc = crc32(data);
  const local = new Uint8Array(30 + filename.length + data.length);
  const localView = new DataView(local.buffer);
  localView.setUint32(0, 0x04034b50, true);
  localView.setUint16(4, 20, true);
  localView.setUint32(14, crc, true);
  localView.setUint32(18, data.length, true);
  localView.setUint32(22, data.length, true);
  localView.setUint16(26, filename.length, true);
  local.set(filename, 30);
  local.set(data, 30 + filename.length);
  const central = new Uint8Array(46 + filename.length);
  const centralView = new DataView(central.buffer);
  centralView.setUint32(0, 0x02014b50, true);
  centralView.setUint16(4, 20, true);
  centralView.setUint16(6, 20, true);
  centralView.setUint32(16, crc, true);
  centralView.setUint32(20, data.length, true);
  centralView.setUint32(24, data.length, true);
  centralView.setUint16(28, filename.length, true);
  central.set(filename, 46);
  const end = new Uint8Array(22);
  const endView = new DataView(end.buffer);
  endView.setUint32(0, 0x06054b50, true);
  endView.setUint16(8, 1, true);
  endView.setUint16(10, 1, true);
  endView.setUint32(12, central.length, true);
  endView.setUint32(16, local.length, true);
  const result = new Uint8Array(local.length + central.length + end.length);
  result.set(local);
  result.set(central, local.length);
  result.set(end, local.length + central.length);
  return result;
}
function crc32(bytes: Uint8Array): number {
  let crc = 0xffffffff;
  for (const byte of bytes) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit++) crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0);
  }
  return (crc ^ 0xffffffff) >>> 0;
}
