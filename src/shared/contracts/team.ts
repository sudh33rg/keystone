import { z } from "zod";
import { DevelopmentIntentSchema, DevelopmentSpecificationSchema, DevelopmentTaskSchema } from "./delegation";

export const TEAM_SCHEMA_VERSION = 1 as const;
const Id = z.string().uuid();
const Timestamp = z.string().datetime();
const Path = z.string().min(1).max(1024).refine((value) => !value.startsWith("/") && !value.split(/[\\/]/).includes("..") && !/[\0\r\n]/.test(value), "Path must be a safe relative path.");
const Text = z.string().max(20_000);
const Fingerprint = z.string().regex(/^sha256:[0-9a-f]{64}$/);

export const TeamCapabilitySchema = z.enum(["create-intent", "approve-specification", "create-task-plan", "assign-task", "accept-task", "execute-task", "validate-task", "review-task", "approve-delivery", "observe-workflow", "reassign-task"]);
export type TeamCapability = z.infer<typeof TeamCapabilitySchema>;
export const TeamParticipantSchema = z.object({ schemaVersion: z.literal(TEAM_SCHEMA_VERSION), id: Id, displayName: z.string().min(1).max(200), email: z.string().email().max(320).optional(), role: z.enum(["manager", "lead", "developer", "qa", "reviewer", "observer"]), source: z.enum(["local", "workspace-config", "repository-config", "imported"]), capabilities: z.array(TeamCapabilitySchema).max(20), active: z.boolean(), createdAt: Timestamp, updatedAt: Timestamp }).strict();
export type TeamParticipant = z.infer<typeof TeamParticipantSchema>;

export const HandoffRepositoryReferenceSchema = z.object({ repositoryId: z.string().min(1).max(1000), branch: z.string().max(500).optional(), baseCommit: z.string().max(100).optional(), headCommit: z.string().max(100).optional(), upstreamBranch: z.string().max(500).optional(), intelligenceGeneration: z.number().int().nonnegative(), repositoryFingerprint: z.string().max(500), relevantFileFingerprints: z.record(Path, z.string().max(500)).refine((value) => Object.keys(value).length <= 500) }).strict();
export type HandoffRepositoryReference = z.infer<typeof HandoffRepositoryReferenceSchema>;

export const TaskAssignmentStatusSchema = z.enum(["draft", "assigned", "awaiting-acceptance", "accepted", "rejected", "in-progress", "handoff-requested", "handoff-prepared", "transferred", "completed", "cancelled", "stale"]);
export const TaskAssignmentSchema = z.object({ schemaVersion: z.literal(TEAM_SCHEMA_VERSION), id: Id, taskId: Id, workflowId: Id, assignedBy: Id, assignedTo: Id, status: TaskAssignmentStatusSchema, priority: z.enum(["low", "normal", "high", "urgent"]).optional(), dueDate: Timestamp.optional(), notes: Text.optional(), rejectionReason: z.string().max(5000).optional(), clarificationRequest: z.string().max(5000).optional(), repositoryBaseline: HandoffRepositoryReferenceSchema, specificationRevision: z.number().int().positive(), intelligenceGeneration: z.number().int().nonnegative(), createdAt: Timestamp, updatedAt: Timestamp, acceptedAt: Timestamp.optional(), endedAt: Timestamp.optional(), previousAssignmentId: Id.optional() }).strict();
export type TaskAssignment = z.infer<typeof TaskAssignmentSchema>;
export const TaskOwnershipSchema = z.object({ taskId: Id, primaryAssignmentId: Id.optional(), reviewerParticipantIds: z.array(Id).max(20), observerParticipantIds: z.array(Id).max(50), qaParticipantId: Id.optional(), concurrentBoundaries: z.array(z.object({ participantId: Id, paths: z.array(Path).min(1).max(100), reason: z.string().min(1).max(2000) }).strict()).max(20), updatedAt: Timestamp }).strict();
export type TaskOwnership = z.infer<typeof TaskOwnershipSchema>;
export const AssignmentEligibilitySchema = z.object({ eligible: z.boolean(), blockers: z.array(z.string().max(2000)).max(100), warnings: z.array(z.string().max(2000)).max(100), requiredCapabilities: z.array(TeamCapabilitySchema).max(20), missingCapabilities: z.array(TeamCapabilitySchema).max(20), evaluatedAt: Timestamp }).strict();
export type AssignmentEligibility = z.infer<typeof AssignmentEligibilitySchema>;

export const HandoffDiagnosticSchema = z.object({ code: z.string().min(1).max(100), severity: z.enum(["info", "warning", "error"]), message: z.string().min(1).max(2000), path: z.string().max(1000).optional() }).strict();
export type HandoffDiagnostic = z.infer<typeof HandoffDiagnosticSchema>;
const ParticipantSnapshotSchema = TeamParticipantSchema.pick({ id: true, displayName: true, role: true, capabilities: true }).extend({ identityAssurance: z.literal("self-asserted-local") }).strict();
const ProgressSnapshotSchema = z.object({ stage: z.enum(["unassigned", "assigned", "accepted", "ready", "in-progress", "blocked", "awaiting-handoff", "handoff-prepared", "awaiting-acceptance", "transferred", "validating", "awaiting-review", "completed", "cancelled", "stale"]), completedWork: z.array(z.string().max(2000)).max(100), remainingWork: z.array(z.string().max(2000)).max(100), blocker: z.string().max(5000).optional(), lastSuccessfulAction: z.string().max(2000).optional(), nextRecommendedAction: z.string().max(2000).optional(), updatedAt: Timestamp }).strict();
const ExecutionSnapshotSchema = z.object({ sessionIds: z.array(Id).max(100), latestStatus: z.string().max(100), selectedAgentId: z.string().max(200).optional(), delegationMode: z.string().max(100).optional(), contextFingerprint: z.string().max(500).optional(), promptFingerprint: z.string().max(500).optional(), attemptCount: z.number().int().nonnegative(), transferred: z.literal(true), continuationRequiresNewApproval: z.literal(true), observedChangeCount: z.number().int().nonnegative() }).strict();
const ValidationSnapshotSchema = z.object({ planIds: z.array(Id).max(100), runIds: z.array(Id).max(100), latestStatus: z.string().max(100).optional(), passedSteps: z.number().int().nonnegative(), failedSteps: z.number().int().nonnegative(), criterionResults: z.array(z.object({ criterionId: z.string().max(200), status: z.string().max(100), evidenceIds: z.array(z.string().max(500)).max(100) }).strict()).max(200), findingSummaries: z.array(z.string().max(2000)).max(200), overrideIds: z.array(Id).max(100), repositoryFingerprint: z.string().max(500).optional(), providerVersions: z.record(z.string(), z.string()).refine((value) => Object.keys(value).length <= 50) }).strict();
const DeliverySnapshotSchema = z.object({ changeSetId: Id.optional(), changeSetFingerprint: z.string().max(500).optional(), commitPlanId: Id.optional(), commitHashes: z.array(z.string().max(100)).max(100), pushStatus: z.string().max(100).optional(), pullRequestStatus: z.string().max(100).optional(), pullRequestUrl: z.string().url().max(2000).optional() }).strict();
const ContextReferenceSchema = z.object({ contextPackageId: Id, contentFingerprint: z.string().max(500), sourceFingerprint: z.string().max(500), reviewed: z.boolean(), pinnedItemIds: z.array(z.string().max(500)).max(200), canonicalEntityIds: z.array(z.string().max(500)).max(500), sourcePaths: z.array(Path).max(500), graphPathIds: z.array(z.string().max(500)).max(100), cpgScopeIds: z.array(z.string().max(500)).max(100), okfConceptIds: z.array(z.string().max(500)).max(100) }).strict();
const ChangedFileSchema = z.object({ path: Path, kind: z.enum(["added", "modified", "deleted", "renamed"]), classification: z.string().max(100), contentFingerprint: z.string().max(500).optional(), availability: z.enum(["committed-available", "shared-branch", "patch-attached", "diff-summary-only", "local-unavailable", "excluded"]), commitHash: z.string().max(100).optional(), patchAttachmentId: Id.optional(), summary: z.string().max(2000).optional() }).strict();
const ChangedEntitySchema = z.object({ entityId: z.string().max(500), qualifiedName: z.string().max(1000), entityType: z.string().max(500), relativePath: Path, changeKind: z.string().max(100), fingerprint: z.string().max(500).optional(), evidenceIds: z.array(z.string().max(500)).max(100) }).strict();
export const HandoffAttachmentReferenceSchema = z.object({ id: Id, filename: z.string().min(1).max(200).refine((value) => !/[\\/]/.test(value) && !/\.(?:exe|dll|dylib|so|bat|cmd|ps1|sh|jar|class|app|msi)$/i.test(value), "Unsafe attachment filename."), mediaType: z.enum(["application/json", "text/plain", "text/markdown", "image/png", "image/jpeg", "application/pdf"]), origin: z.enum(["validation-log", "diff-summary", "report", "screenshot", "user-document"]), sizeBytes: z.number().int().nonnegative().max(5_000_000), sha256: Fingerprint, optional: z.boolean(), archivePath: Path.optional() }).strict();
export type HandoffAttachmentReference = z.infer<typeof HandoffAttachmentReferenceSchema>;

export const HandoffPackageSchema = z.object({ schemaVersion: z.literal(TEAM_SCHEMA_VERSION), id: Id, workflowId: Id, taskId: Id, assignmentId: Id, sender: ParticipantSnapshotSchema, intendedReceiver: ParticipantSnapshotSchema.optional(), repository: HandoffRepositoryReferenceSchema, intent: DevelopmentIntentSchema, specification: DevelopmentSpecificationSchema, task: DevelopmentTaskSchema, assignment: TaskAssignmentSchema, progress: ProgressSnapshotSchema, execution: ExecutionSnapshotSchema.optional(), validation: ValidationSnapshotSchema.optional(), delivery: DeliverySnapshotSchema.optional(), context: z.array(ContextReferenceSchema).max(20), changedFiles: z.array(ChangedFileSchema).max(1000), changedEntities: z.array(ChangedEntitySchema).max(1000), blockers: z.array(z.object({ id: Id, category: z.string().max(100), description: z.string().max(5000), blocking: z.boolean() }).strict()).max(100), openQuestions: z.array(z.object({ id: Id, question: z.string().max(5000), blocking: z.boolean() }).strict()).max(100), senderNotes: Text.optional(), attachments: z.array(HandoffAttachmentReferenceSchema).max(50), createdAt: Timestamp, expiresAt: Timestamp.optional(), fingerprint: Fingerprint, diagnostics: z.array(HandoffDiagnosticSchema).max(200), metrics: z.object({ generationDurationMs: z.number().nonnegative(), packageBytes: z.number().int().nonnegative(), attachmentBytes: z.number().int().nonnegative() }).strict() }).strict();
export type HandoffPackage = z.infer<typeof HandoffPackageSchema>;

export const RepositoryCompatibilitySchema = z.enum(["exact", "compatible", "ahead", "behind", "diverged", "wrong-branch", "wrong-repository", "missing-commits", "unknown"]);
export const HandoffReconciliationSchema = z.object({ schemaVersion: z.literal(TEAM_SCHEMA_VERSION), id: Id, packageId: Id, packageFingerprint: Fingerprint, receiverRepositoryFingerprint: z.string().max(500), compatibility: RepositoryCompatibilitySchema, safeToAccept: z.boolean(), differences: z.array(z.string().max(2000)).max(200), staleContextIds: z.array(Id).max(100), reusableContextIds: z.array(Id).max(100), reusedValidationRunIds: z.array(Id).max(100), invalidatedValidationRunIds: z.array(Id).max(100), unresolvedEntityIds: z.array(z.string().max(500)).max(500), missingChangedFiles: z.array(Path).max(1000), requiredActions: z.array(z.string().max(2000)).max(100), diagnostics: z.array(HandoffDiagnosticSchema).max(200), durationMs: z.number().nonnegative(), createdAt: Timestamp }).strict();
export type HandoffReconciliation = z.infer<typeof HandoffReconciliationSchema>;
export const HandoffValidationResultSchema = z.object({ valid: z.boolean(), diagnostics: z.array(HandoffDiagnosticSchema).max(200), calculatedFingerprint: Fingerprint.optional(), sizeBytes: z.number().int().nonnegative(), durationMs: z.number().nonnegative(), validatedAt: Timestamp }).strict();
export type HandoffValidationResult = z.infer<typeof HandoffValidationResultSchema>;

export const HandoffImportRecordSchema = z.object({ id: Id, packageId: Id, packageFingerprint: Fingerprint, source: z.enum(["file", "repository-artifact", "local-workspace"]), sourceLabel: z.string().max(500), status: z.enum(["validating", "reviewable", "accepted", "rejected", "read-only", "failed", "cancelled", "interrupted"]), reconciliationId: Id.optional(), receiverParticipantId: Id.optional(), reason: z.string().max(5000).optional(), importedAt: Timestamp, updatedAt: Timestamp }).strict();
export const HandoffExportRecordSchema = z.object({ id: Id, packageId: Id, packageFingerprint: Fingerprint, mode: z.enum(["json", "zip", "repository-artifact", "clipboard-summary"]), destinationLabel: z.string().max(500), status: z.enum(["prepared", "exported", "failed", "interrupted"]), reducedFidelity: z.boolean(), sizeBytes: z.number().int().nonnegative(), exportedAt: Timestamp }).strict();
export const ReassignmentRecordSchema = z.object({ id: Id, taskId: Id, workflowId: Id, previousAssignmentId: Id, newAssignmentId: Id, requestedBy: Id, reason: z.string().min(1).max(5000), handoffPackageId: Id.optional(), createdAt: Timestamp }).strict();
export const HandoffAcceptanceSchema = z.object({ id: Id, packageId: Id, importId: Id.optional(), assignmentId: Id, receiverParticipantId: Id, decision: z.enum(["accepted", "rejected", "read-only"]), reason: z.string().max(5000).optional(), packageFingerprint: Fingerprint, reconciliationId: Id, continuationSessionRequired: z.boolean(), decidedAt: Timestamp }).strict();
export type HandoffImportRecord = z.infer<typeof HandoffImportRecordSchema>;
export type HandoffExportRecord = z.infer<typeof HandoffExportRecordSchema>;
export type HandoffAcceptance = z.infer<typeof HandoffAcceptanceSchema>;
export type ReassignmentRecord = z.infer<typeof ReassignmentRecordSchema>;
export const TeamAuditEntrySchema = z.object({ id: Id, actorParticipantId: Id.optional(), actorAssurance: z.literal("self-asserted-local"), action: z.enum(["participant-created", "participant-updated", "participant-removed", "intent-created", "specification-approved", "task-created", "assignment-created", "assignment-accepted", "assignment-rejected", "assignment-stale", "clarification-requested", "handoff-requested", "package-created", "package-validated", "package-exported", "package-imported", "handoff-accepted", "handoff-rejected", "read-only-import", "reassigned", "execution-continuation", "validation-continuation", "completed", "cancelled", "override"]), relatedType: z.string().max(100), relatedId: z.string().max(500), previousState: z.string().max(100).optional(), newState: z.string().max(100).optional(), reason: z.string().max(5000).optional(), evidence: z.array(z.string().max(1000)).max(50), createdAt: Timestamp }).strict();
export type TeamAuditEntry = z.infer<typeof TeamAuditEntrySchema>;
export const TeamProgressSnapshotSchema = z.object({ workflowId: Id, specificationRevision: z.number().int().positive(), taskCounts: z.record(z.string(), z.number().int().nonnegative()).refine((value) => Object.keys(value).length <= 30), assignmentCounts: z.record(z.string(), z.number().int().nonnegative()).refine((value) => Object.keys(value).length <= 30), activeBlockers: z.array(z.string().max(2000)).max(100), staleTaskIds: z.array(Id).max(500), unassignedTaskIds: z.array(Id).max(500), dueAssignments: z.array(Id).max(500), handoffIds: z.array(Id).max(500), validationStates: z.record(z.string(), z.string().max(100)).refine((value) => Object.keys(value).length <= 500), deliveryState: z.string().max(100).optional(), freshness: z.enum(["current-local", "imported-snapshot", "unknown"]), updatedAt: Timestamp }).strict();
export type TeamProgressSnapshot = z.infer<typeof TeamProgressSnapshotSchema>;

export const TeamSettingsSchema = z.object({ repositoryArtifactsEnabled: z.boolean(), repositoryArtifactPath: z.literal(".keystone/handoffs"), allowAssignmentBeforeDependencies: z.boolean(), maxPackageBytes: z.number().int().min(10_000).max(10_000_000), maxAttachmentBytes: z.number().int().min(0).max(5_000_000), maxAttachments: z.number().int().min(0).max(50), retainAuditEntries: z.number().int().min(100).max(5000) }).strict();
export const TeamPersistentStateSchema = z.object({ schemaVersion: z.literal(TEAM_SCHEMA_VERSION), revision: z.number().int().nonnegative(), participants: z.array(TeamParticipantSchema).max(500), assignments: z.array(TaskAssignmentSchema).max(2000), ownership: z.array(TaskOwnershipSchema).max(1000), packages: z.array(HandoffPackageSchema).max(200), imports: z.array(HandoffImportRecordSchema).max(500), exports: z.array(HandoffExportRecordSchema).max(500), reconciliations: z.array(HandoffReconciliationSchema).max(500), acceptances: z.array(HandoffAcceptanceSchema).max(500), reassignments: z.array(ReassignmentRecordSchema).max(500), progress: z.array(TeamProgressSnapshotSchema).max(500), audit: z.array(TeamAuditEntrySchema).max(5000), settings: TeamSettingsSchema, diagnostics: z.array(HandoffDiagnosticSchema).max(500), updatedAt: Timestamp }).strict();
export type TeamPersistentState = z.infer<typeof TeamPersistentStateSchema>;

export const ParticipantCreatePayloadSchema = TeamParticipantSchema.pick({
  displayName: true,
  email: true,
  role: true,
  source: true,
  capabilities: true,
}).strict();
export const ParticipantUpdatePayloadSchema = z.object({
  participantId: Id,
  patch: TeamParticipantSchema.pick({
    displayName: true,
    email: true,
    role: true,
    capabilities: true,
    active: true,
  }).partial(),
}).strict();
export const ParticipantIdPayloadSchema = z.object({ participantId: Id }).strict();
export const AssignmentCreatePayloadSchema = z.object({
  workflowId: Id,
  taskId: Id,
  assignedBy: Id,
  assignedTo: Id,
  priority: z.enum(["low", "normal", "high", "urgent"]).optional(),
  dueDate: Timestamp.optional(),
  notes: Text.optional(),
}).strict();
export const AssignmentDecisionPayloadSchema = z.object({
  assignmentId: Id,
  participantId: Id,
  reason: z.string().max(5000).optional(),
}).strict();
export const HandoffCreatePayloadSchema = z.object({
  assignmentId: Id,
  senderParticipantId: Id,
  receiverParticipantId: Id.optional(),
  completedWork: z.array(z.string().max(2000)).max(100),
  remainingWork: z.array(z.string().max(2000)).max(100),
  blockers: z.array(z.object({ id: Id, category: z.string().max(100), description: z.string().max(5000), blocking: z.boolean() }).strict()).max(100).default([]),
  openQuestions: z.array(z.object({ id: Id, question: z.string().max(5000), blocking: z.boolean() }).strict()).max(100).default([]),
  senderNotes: Text.optional(),
}).strict();
export const HandoffPackageIdPayloadSchema = z.object({ packageId: Id }).strict();
export const HandoffValidatePayloadSchema = z.object({
  package: HandoffPackageSchema,
}).strict();
export const HandoffExportPayloadSchema = z.object({
  packageId: Id,
  mode: z.enum(["json", "zip", "repository-artifact", "clipboard-summary"]),
}).strict();
export const HandoffImportPayloadSchema = z.object({
  source: z.enum(["file", "repository-artifact", "local-workspace"]),
}).strict();
export const HandoffAcceptPayloadSchema = z.object({
  packageId: Id,
  importId: Id.optional(),
  receiverParticipantId: Id,
  reconciliationId: Id,
  decision: z.enum(["accepted", "rejected", "read-only"]),
  reason: z.string().max(5000).optional(),
}).strict();
export const HandoffReconcilePayloadSchema = z.object({
  packageId: Id,
}).strict();
export const ReassignmentPayloadSchema = z.object({
  assignmentId: Id,
  requestedBy: Id,
  assignedTo: Id,
  reason: z.string().min(1).max(5000),
  handoffPackageId: Id.optional(),
}).strict();
export const TeamProgressPayloadSchema = z.object({ workflowId: Id }).strict();
export const TeamAuditPayloadSchema = z.object({
  workflowId: Id.optional(),
  taskId: Id.optional(),
  limit: z.number().int().min(1).max(500).default(100),
}).strict();

export type ParticipantCreatePayload = z.infer<typeof ParticipantCreatePayloadSchema>;
export type ParticipantUpdatePayload = z.infer<typeof ParticipantUpdatePayloadSchema>;
export type AssignmentCreatePayload = z.infer<typeof AssignmentCreatePayloadSchema>;
export type AssignmentDecisionPayload = z.infer<typeof AssignmentDecisionPayloadSchema>;
export type HandoffCreatePayload = z.infer<typeof HandoffCreatePayloadSchema>;
export type HandoffAcceptPayload = z.infer<typeof HandoffAcceptPayloadSchema>;
export type ReassignmentPayload = z.infer<typeof ReassignmentPayloadSchema>;
