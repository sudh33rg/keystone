import { z } from "zod";

export const DELIVERY_SCHEMA_VERSION = 1 as const;
const Timestamp = z.string().datetime();
const Id = z.string().uuid();
const Text = z.string().max(20_000);
const Path = z.string().min(1).max(1024);

export const GitDiagnosticSchema = z.object({ code: z.string().max(100), severity: z.enum(["info", "warning", "error"]), message: z.string().max(2000) }).strict();
export const PullRequestProviderCapabilitySchema = z.object({
  provider: z.enum(["github", "gitlab", "azure-devops", "bitbucket", "unknown"]),
  detected: z.boolean(), authenticated: z.union([z.boolean(), z.literal("unknown")]),
  draftCreationAvailable: z.boolean(), directCreationAvailable: z.boolean(), reviewerSelectionAvailable: z.boolean(),
  labelSelectionAvailable: z.boolean(), templateDiscoveryAvailable: z.boolean(), resultTrackingAvailable: z.boolean(),
  integrationMethod: z.string().max(200).optional(), diagnostics: z.array(GitDiagnosticSchema).max(50),
}).strict();
export type PullRequestProviderCapability = z.infer<typeof PullRequestProviderCapabilitySchema>;

export const GitCapabilitiesSchema = z.object({
  schemaVersion: z.literal(DELIVERY_SCHEMA_VERSION), repositoryRoot: z.string().max(2048).optional(),
  repositoryDetected: z.boolean(), gitExtensionAvailable: z.boolean(), gitExecutableAvailable: z.boolean(),
  statusAvailable: z.boolean(), diffAvailable: z.boolean(), stagingAvailable: z.boolean(), commitAvailable: z.boolean(),
  branchCreationAvailable: z.boolean(), pushAvailable: z.boolean(), remotesAvailable: z.boolean(), upstreamAvailable: z.boolean(),
  pullRequestProvider: PullRequestProviderCapabilitySchema.optional(), diagnostics: z.array(GitDiagnosticSchema).max(50), refreshedAt: Timestamp,
}).strict();
export type GitCapabilities = z.infer<typeof GitCapabilitiesSchema>;

export const GitRemoteSchema = z.object({ name: z.string().max(200), sanitizedUrl: z.string().max(1000), isDefault: z.boolean(), defaultBranch: z.string().max(500).optional() }).strict();
export const GitRepositoryStateSchema = z.object({
  schemaVersion: z.literal(DELIVERY_SCHEMA_VERSION), repositoryRoot: z.string().max(2048), repositoryId: z.string().max(500),
  branch: z.string().max(500).optional(), detachedHead: z.boolean(), headCommit: z.string().max(100).optional(), upstreamBranch: z.string().max(500).optional(),
  ahead: z.number().int().nonnegative(), behind: z.number().int().nonnegative(), dirty: z.boolean(),
  stagedFiles: z.array(Path).max(5000), unstagedFiles: z.array(Path).max(5000), untrackedFiles: z.array(Path).max(5000), conflictedFiles: z.array(Path).max(5000),
  remotes: z.array(GitRemoteSchema).max(50), defaultRemote: z.string().max(200).optional(), defaultBranch: z.string().max(500).optional(),
  operation: z.enum(["none", "merge", "rebase", "cherry-pick", "revert"]).default("none"), worktree: z.boolean().default(false), submodules: z.boolean().default(false),
  fingerprint: z.string().max(500), capturedAt: Timestamp, diagnostics: z.array(GitDiagnosticSchema).max(100),
}).strict();
export type GitRepositoryState = z.infer<typeof GitRepositoryStateSchema>;

export const DeliveryFileChangeSchema = z.object({
  id: z.string().max(500), path: Path, previousPath: Path.optional(), status: z.enum(["added", "modified", "deleted", "renamed", "untracked", "conflicted"]), staged: z.boolean(), sourceKind: z.enum(["file", "symlink", "submodule"]).default("file"),
  attribution: z.enum(["expected", "related", "unexpected", "pre-existing", "concurrent", "ambiguous", "excluded", "generated-output"]),
  relatedTaskIds: z.array(Id).max(100), relatedRequirementIds: z.array(z.string().max(200)).max(100), relatedAcceptanceCriterionIds: z.array(z.string().max(200)).max(100),
  changedEntityIds: z.array(z.string().max(500)).max(500), additions: z.number().int().nonnegative().optional(), deletions: z.number().int().nonnegative().optional(),
  binary: z.boolean(), generated: z.boolean(), sensitive: z.boolean(), included: z.boolean(), exclusionReason: z.string().max(2000).optional(), explanation: z.string().max(5000).optional(), diagnostics: z.array(z.string().max(2000)).max(50),
}).strict();
export type DeliveryFileChange = z.infer<typeof DeliveryFileChangeSchema>;

export const DeliveryReadinessSchema = z.object({
  workflowId: Id, ready: z.boolean(), blockers: z.array(z.string().max(2000)).max(200), warnings: z.array(z.string().max(2000)).max(200), recommendations: z.array(z.string().max(2000)).max(200),
  repositoryStateFingerprint: z.string().max(500), validationRunIds: z.array(Id).max(1000), durationMs: z.number().nonnegative(), evaluatedAt: Timestamp,
}).strict();
export type DeliveryReadiness = z.infer<typeof DeliveryReadinessSchema>;

export const DeliveryChangeSetSchema = z.object({
  schemaVersion: z.literal(DELIVERY_SCHEMA_VERSION), id: Id, workflowId: Id, specificationId: Id, specificationRevision: z.number().int().positive(),
  repositoryId: z.string().max(500), branch: z.string().max(500), baseCommit: z.string().max(100), currentHead: z.string().max(100), repositoryStateFingerprint: z.string().max(500), intelligenceGeneration: z.number().int().nonnegative(),
  files: z.array(DeliveryFileChangeSchema).max(5000), entities: z.array(z.object({ entityId: z.string().max(500), qualifiedName: z.string().max(1000), changeKind: z.string().max(100), evidenceIds: z.array(z.string().max(500)).max(100) }).strict()).max(5000),
  includedFileIds: z.array(z.string().max(500)).max(5000), excludedFileIds: z.array(z.string().max(500)).max(5000), validationRunIds: z.array(Id).max(1000), findings: z.array(z.string().max(2000)).max(500),
  status: z.enum(["draft", "reviewing", "ready", "stale", "committed", "cancelled"]), fingerprint: z.string().max(500), createdAt: Timestamp, updatedAt: Timestamp,
}).strict();
export type DeliveryChangeSet = z.infer<typeof DeliveryChangeSetSchema>;

export const ProposedCommitSchema = z.object({
  id: Id, order: z.number().int().nonnegative(), title: z.string().min(1).max(200), description: Text, includedFileIds: z.array(z.string().max(500)).min(1).max(5000),
  relatedTaskIds: z.array(Id).max(100), relatedRequirementIds: z.array(z.string().max(200)).max(100), relatedAcceptanceCriterionIds: z.array(z.string().max(200)).max(100), dependencies: z.array(Id).max(100),
  commitType: z.enum(["feat", "fix", "refactor", "test", "docs", "build", "chore", "migration"]), scope: z.string().max(100).optional(), breaking: z.boolean(), validationRunIds: z.array(Id).max(1000), risks: z.array(z.string().max(2000)).max(100), userNotes: Text.default(""), createdCommitHash: z.string().max(100).optional(), actualFiles: z.array(Path).max(5000).default([]),
}).strict();
export type ProposedCommit = z.infer<typeof ProposedCommitSchema>;
export const CommitPlanSchema = z.object({
  schemaVersion: z.literal(DELIVERY_SCHEMA_VERSION), id: Id, changeSetId: Id, convention: z.enum(["conventional", "plain", "repository", "user-template"]), commits: z.array(ProposedCommitSchema).min(1).max(50),
  status: z.enum(["draft", "reviewed", "approved", "partially-created", "completed", "stale"]), fingerprint: z.string().max(500), diagnostics: z.array(z.string().max(2000)).max(100), createdAt: Timestamp, updatedAt: Timestamp,
}).strict();
export type CommitPlan = z.infer<typeof CommitPlanSchema>;

export const GitMutationApprovalSchema = z.object({
  id: Id, action: z.enum(["stage", "unstage", "create-branch", "commit", "push", "create-pr", "update-pr", "export-patch"]), repositoryId: z.string().max(500), branch: z.string().max(500).optional(),
  changeSetId: Id.optional(), changeSetFingerprint: z.string().max(500).optional(), commitPlanId: Id.optional(), proposedCommitId: Id.optional(), paths: z.array(Path).max(5000), message: Text.optional(), remote: z.string().max(200).optional(), remoteBranch: z.string().max(500).optional(),
  risks: z.array(z.string().max(2000)).max(100), safelyRetryable: z.boolean(), approvedBy: z.literal("user"), approvedAt: Timestamp, consumedAt: Timestamp.optional(),
}).strict();
export type GitMutationApproval = z.infer<typeof GitMutationApprovalSchema>;
export const GitActionResultSchema = z.object({ id: Id, approvalId: Id, action: GitMutationApprovalSchema.shape.action, status: z.enum(["succeeded", "failed", "uncertain"]), durationMs: z.number().nonnegative(), commitHash: z.string().max(100).optional(), affectedPaths: z.array(Path).max(5000), sanitizedOutput: z.string().max(20_000), retrySafe: z.boolean(), createdAt: Timestamp }).strict();
export type GitActionResult = z.infer<typeof GitActionResultSchema>;

export const PullRequestDraftSchema = z.object({
  schemaVersion: z.literal(DELIVERY_SCHEMA_VERSION), id: Id, workflowId: Id, changeSetId: Id, provider: z.enum(["github", "gitlab", "azure-devops", "bitbucket", "unknown"]), repository: z.string().max(500), baseBranch: z.string().max(500), headBranch: z.string().max(500),
  title: z.string().min(1).max(256), body: Text, isDraft: z.boolean(), reviewers: z.array(z.string().max(200)).max(100), labels: z.array(z.string().max(200)).max(100), linkedTasks: z.array(Id).max(500), linkedRequirements: z.array(z.string().max(200)).max(500), linkedAcceptanceCriteria: z.array(z.string().max(200)).max(500),
  validationSummary: z.array(z.string().max(2000)).max(500), riskSummary: z.array(z.string().max(2000)).max(200), reviewGuidance: z.array(z.string().max(2000)).max(100), status: z.enum(["draft", "reviewed", "approved", "created", "failed", "stale", "awaiting-external-creation"]), fingerprint: z.string().max(500), createdAt: Timestamp, updatedAt: Timestamp,
}).strict();
export type PullRequestDraft = z.infer<typeof PullRequestDraftSchema>;
export const PullRequestCreationResultSchema = z.object({ id: Id, draftId: Id, provider: z.string().max(100), status: z.enum(["created", "awaiting-external-creation", "failed", "uncertain"]), number: z.number().int().positive().optional(), url: z.string().url().max(2000).optional(), baseBranch: z.string().max(500), headBranch: z.string().max(500), isDraft: z.boolean(), evidence: z.array(z.string().max(2000)).max(50), createdAt: Timestamp }).strict();
export type PullRequestCreationResult = z.infer<typeof PullRequestCreationResultSchema>;

export const DeliveryReportSchema = z.object({ id: Id, workflowId: Id, specificationId: Id, specificationRevision: z.number().int().positive(), changeSetFingerprint: z.string().max(500), includedFiles: z.array(Path).max(5000), excludedFiles: z.array(Path).max(5000), commitHashes: z.array(z.string().max(100)).max(100), branch: z.string().max(500), remote: z.string().max(200).optional(), pushResultId: Id.optional(), pullRequestResultId: Id.optional(), validationSummary: z.array(z.string().max(2000)).max(500), overrides: z.array(z.string().max(2000)).max(500), warnings: z.array(z.string().max(2000)).max(500), limitations: z.array(z.string().max(2000)).max(500), intelligenceGeneration: z.number().int().nonnegative(), createdAt: Timestamp }).strict();
export type DeliveryReport = z.infer<typeof DeliveryReportSchema>;

export const DeliveryPersistentStateSchema = z.object({ schemaVersion: z.literal(DELIVERY_SCHEMA_VERSION), revision: z.number().int().nonnegative(), capabilities: z.array(GitCapabilitiesSchema).max(20), repositoryStates: z.array(GitRepositoryStateSchema).max(20), changeSets: z.array(DeliveryChangeSetSchema).max(100), commitPlans: z.array(CommitPlanSchema).max(100), approvals: z.array(GitMutationApprovalSchema).max(500), actionResults: z.array(GitActionResultSchema).max(500), pullRequestDrafts: z.array(PullRequestDraftSchema).max(100), pullRequestResults: z.array(PullRequestCreationResultSchema).max(100), reports: z.array(DeliveryReportSchema).max(100), diagnostics: z.array(GitDiagnosticSchema).max(500), updatedAt: Timestamp }).strict();
export type DeliveryPersistentState = z.infer<typeof DeliveryPersistentStateSchema>;

export const DeliveryWorkflowPayloadSchema = z.object({ workflowId: Id }).strict();
export const DeliveryChangeSetPayloadSchema = z.object({ changeSetId: Id }).strict();
export const DeliveryFileDecisionPayloadSchema = DeliveryChangeSetPayloadSchema.extend({ fileId: z.string().max(500), explanation: z.string().max(5000).optional() }).strict();
export const CommitPlanPayloadSchema = z.object({ commitPlanId: Id }).strict();
export const GitApprovalPayloadSchema = z.object({ approval: GitMutationApprovalSchema }).strict();
export const PullRequestDraftPayloadSchema = z.object({ draftId: Id }).strict();
