/**
 * Phase 11 — Task Handoff transport contracts.
 *
 * This module defines an EXPLICIT transport schema for portable, local handoff
 * packages. It deliberately does NOT serialize internal service classes. Every
 * shape here is versioned, bounded, and safe to parse independently of the host.
 *
 * The handoff package transfers workflow continuity only — never credentials,
 * Copilot sessions, Git contents, or remote state.
 */
import { z } from "zod";

export const HANDOFF_SCHEMA_VERSION = 1 as const;
export const HANDOFF_FILE_EXTENSION = ".keystone-handoff" as const;
export const CONTENT_HASH_PLACEHOLDER = "sha256:placeholder" as const;
export type HandoffFileExtension = typeof HANDOFF_FILE_EXTENSION;

const Id = z.string().uuid();
const Timestamp = z.string().datetime();
const RelativePath = z
  .string()
  .min(1)
  .max(1024)
  .refine(
    (value) =>
      !value.startsWith("/") &&
      !value.split(/[\\/]/).includes("..") &&
      !/[\0\r\n]/.test(value),
    "Path must be a safe relative path.",
  );
const ContentHash = z.string().regex(/^sha256:[0-9a-f]{64}$/);
const Text20k = z.string().trim().min(1).max(20_000);
const Text50k = z.string().trim().max(50_000);

// ---------------------------------------------------------------------------
// Task handoff record (persisted state for drafts/exports/imports history)
// ---------------------------------------------------------------------------

export const TaskHandoffDirectionSchema = z.enum(["outgoing", "incoming"]);
export type TaskHandoffDirection = z.infer<typeof TaskHandoffDirectionSchema>;

export const TaskHandoffStatusSchema = z.enum([
  "draft",
  "ready-for-review",
  "exported",
  "imported",
  "validation-required",
  "accepted",
  "rejected",
  "superseded",
  "failed",
]);
export type TaskHandoffStatus = z.infer<typeof TaskHandoffStatusSchema>;

export const HandoffNextActionSchema = z
  .object({
    title: z.string().trim().min(1).max(2_000),
    description: z.string().trim().max(10_000),
    stageId: z.string().uuid().optional(),
    workItemId: z.string().uuid().optional(),
  })
  .strict();
export type HandoffNextAction = z.infer<typeof HandoffNextActionSchema>;

export const TaskHandoffSchema = z
  .object({
    schemaVersion: z.literal(HANDOFF_SCHEMA_VERSION),
    id: Id,
    workflowId: Id,
    direction: TaskHandoffDirectionSchema,
    status: TaskHandoffStatusSchema,
    progressSummary: z.string().trim().max(20_000),
    completedWork: z.array(z.string().trim().min(1).max(10_000)).max(500),
    unresolvedWork: z.array(z.string().trim().min(1).max(10_000)).max(500),
    blockers: z.array(z.string().trim().min(1).max(10_000)).max(500),
    assumptions: z.array(z.string().trim().min(1).max(10_000)).max(500),
    nextAction: HandoffNextActionSchema.nullable(),
    packageId: Id.optional(),
    senderLabel: z.string().trim().max(200).optional(),
    receiverLabel: z.string().trim().max(200).optional(),
    createdAt: Timestamp,
    updatedAt: Timestamp,
    exportedAt: Timestamp.optional(),
    importedAt: Timestamp.optional(),
    acceptedAt: Timestamp.optional(),
    supersededAt: Timestamp.optional(),
    integrity: z
      .object({
        contentHash: ContentHash,
        verifiedAt: Timestamp,
        status: z.enum(["verified", "stale", "unverified"]),
      })
      .strict()
      .optional(),
    compatibility: z
      .enum([
        "exact-match",
        "compatible-revision-difference",
        "probable-match",
        "ambiguous",
        "incompatible",
        "unverifiable",
      ])
      .optional(),
  })
  .strict();
export type TaskHandoff = z.infer<typeof TaskHandoffSchema>;

// ---------------------------------------------------------------------------
// Repository identity (bounded, path-independent) — §13, §14
// ---------------------------------------------------------------------------

export const HandoffRepositoryRootSchema = z
  .object({
    logicalName: z.string().min(1).max(200),
    relativeMarkerHash: ContentHash,
  })
  .strict();
export type HandoffRepositoryRoot = z.infer<typeof HandoffRepositoryRootSchema>;

export const HandoffRepositoryGitSchema = z
  .object({
    remoteIdentityHash: ContentHash.optional(),
    branchName: z.string().max(250).optional(),
    revision: z.string().max(100).optional(),
  })
  .strict();
export type HandoffRepositoryGit = z.infer<typeof HandoffRepositoryGitSchema>;

export const HandoffRepositoryIdentitySchema = z
  .object({
    repositoryName: z.string().min(1).max(200),
    identityHash: ContentHash,
    roots: z.array(HandoffRepositoryRootSchema).min(1).max(10),
    git: HandoffRepositoryGitSchema.optional(),
    manifestHashes: z
      .array(z.object({ relativePath: RelativePath, contentHash: ContentHash }).strict())
      .max(200),
  })
  .strict();
export type HandoffRepositoryIdentity = z.infer<typeof HandoffRepositoryIdentitySchema>;

// ---------------------------------------------------------------------------
// Workflow snapshot (transport-safe) — §15
// ---------------------------------------------------------------------------

export const HandoffStageSummarySchema = z
  .object({
    id: Id,
    type: z.string().min(1).max(50),
    displayName: z.string().min(1).max(100),
    order: z.number().int().positive().max(12),
    status: z.enum(["ready", "not-ready", "completed", "in-progress", "interrupted"]),
  })
  .strict();
export type HandoffStageSummary = z.infer<typeof HandoffStageSummarySchema>;

export const HandoffWorkflowSnapshotSchema = z
  .object({
    workflowId: Id,
    intent: z.object({ text: z.string().trim().min(1).max(10_000), workType: z.string().min(1).max(50) }).strict(),
    specification: z.object({ text: Text50k, revision: z.number().int().positive() }).strict().optional(),
    status: z.enum(["draft", "active", "completed", "cancelled", "blocked"]),
    stages: z.array(HandoffStageSummarySchema).min(1).max(12),
    currentStageId: Id.nullable(),
    handoffSourceRevision: z.number().int().nonnegative(),
    createdAt: Timestamp,
    updatedAt: Timestamp,
  })
  .strict();
export type HandoffWorkflowSnapshot = z.infer<typeof HandoffWorkflowSnapshotSchema>;

// ---------------------------------------------------------------------------
// Continuity summary (bounded Development evidence) — §16
// ---------------------------------------------------------------------------

export const HandoffSourceScopeReferenceSchema = z
  .object({
    itemId: Id,
    workItemId: Id,
    kind: z.enum(["file", "symbol"]),
    workspaceRelativePath: RelativePath,
    entityId: z.string().min(1).max(500).optional(),
    range: z
      .object({ startLine: z.number().int().nonnegative(), endLine: z.number().int().nonnegative() })
      .strict()
      .optional(),
    availabilityExported: z.enum(["available", "missing", "unresolved"]),
  })
  .strict();
export type HandoffSourceScopeReference = z.infer<typeof HandoffSourceScopeReferenceSchema>;

export const HandoffContinuitySummarySchema = z
  .object({
    objective: z.string().trim().min(1).max(10_000).optional(),
    workItemStatus: z.string().min(1).max(50).optional(),
    sourceScope: z.array(HandoffSourceScopeReferenceSchema).max(2000),
    executionProfileReference: z
      .object({ profileId: Id.optional(), profileHash: ContentHash.optional() })
      .strict()
      .optional(),
    selectedSkillReference: z
      .object({ skillId: Id, name: z.string().min(1).max(200), version: z.number().int().nonnegative() })
      .strict()
      .optional(),
    instructionReferences: z
      .array(z.object({ instructionId: Id, relativePath: RelativePath, contentHash: ContentHash }).strict())
      .max(200),
    handoffMode: z.enum(["clipboard", "supported-chat-command", "file"]).optional(),
    developmentResult: z
      .object({
        summary: Text20k,
        decisions: z.string().trim().max(20_000).optional(),
        assumptions: z.string().trim().max(20_000).optional(),
        testsRun: z.string().trim().max(20_000).optional(),
        unresolvedIssues: z.string().trim().max(20_000).optional(),
        associatedChangedFiles: z.array(RelativePath).max(1000),
        noCode: z.boolean().optional(),
      })
      .strict()
      .optional(),
    changedFileAssociations: z.array(RelativePath).max(1000),
    unresolvedIssues: z.array(z.string().trim().min(1).max(10_000)).max(500),
  })
  .strict();
export type HandoffContinuitySummary = z.infer<typeof HandoffContinuitySummarySchema>;

// ---------------------------------------------------------------------------
// Reference manifest — §20
// ---------------------------------------------------------------------------

export const HandoffFileReferenceSchema = z
  .object({
    relativePath: RelativePath,
    contentHash: ContentHash.optional(),
    availabilityAtExport: z.enum(["available", "missing", "unreadable"]),
    required: z.boolean(),
  })
  .strict();
export const HandoffSymbolReferenceSchema = z
  .object({
    entityId: z.string().min(1).max(500),
    filePath: RelativePath,
    range: z
      .object({ startLine: z.number().int().nonnegative(), endLine: z.number().int().nonnegative() })
      .strict()
      .optional(),
    contentHash: ContentHash.optional(),
  })
  .strict();
export const HandoffInstructionReferenceSchema = z
  .object({
    instructionId: Id,
    relativePath: RelativePath,
    contentHash: ContentHash,
  })
  .strict();
export const HandoffSkillReferenceSchema = z
  .object({
    skillId: Id,
    name: z.string().min(1).max(200),
    version: z.number().int().nonnegative(),
    contentHash: ContentHash,
  })
  .strict();

export const HandoffReferenceManifestSchema = z
  .object({
    files: z.array(HandoffFileReferenceSchema).max(2000),
    symbols: z.array(HandoffSymbolReferenceSchema).max(2000),
    instructions: z.array(HandoffInstructionReferenceSchema).max(200),
    skills: z.array(HandoffSkillReferenceSchema).max(200),
    intelligenceRevision: z.string().min(1).max(100).optional(),
  })
  .strict();
export type HandoffReferenceManifest = z.infer<typeof HandoffReferenceManifestSchema>;

// ---------------------------------------------------------------------------
// Evidence bundle (bounded SDLC summaries) — §18
// ---------------------------------------------------------------------------

export const HandoffEvidenceExcerptSchema = z
  .object({
    kind: z.string().min(1).max(50),
    excerpt: z.string().trim().max(5_000),
  })
  .strict();

export const HandoffEvidenceBundleSchema = z
  .object({
    impact: z
      .object({
        changeSetSummary: z.string().trim().max(10_000).optional(),
        changedEntityCount: z.number().int().nonnegative().optional(),
        majorImpacts: z.array(z.string().trim().min(1).max(2_000)).max(100),
        riskFactors: z.array(z.string().trim().min(1).max(2_000)).max(100),
        affectedFlows: z.array(z.string().trim().min(1).max(2_000)).max(100),
        mappedTestCount: z.number().int().nonnegative().optional(),
        coverageGaps: z.array(z.string().trim().min(1).max(2_000)).max(100),
        decisionState: z.string().min(1).max(50).optional(),
      })
      .strict()
      .optional(),
    qa: z
      .object({
        planSummary: z.string().trim().max(10_000).optional(),
        commandsExecuted: z.array(z.string().trim().min(1).max(1_000)).max(100),
        unresolvedFailures: z.array(z.string().trim().min(1).max(2_000)).max(200),
        flakyState: z.string().min(1).max(50).optional(),
        decision: z.string().min(1).max(50).optional(),
      })
      .strict()
      .optional(),
    security: z
      .object({
        decision: z.string().min(1).max(50).optional(),
        openFindings: z.number().int().nonnegative().optional(),
        acceptedRisks: z.array(z.string().trim().min(1).max(2_000)).max(100),
        stale: z.boolean().optional(),
      })
      .strict()
      .optional(),
    performance: z
      .object({
        decision: z.string().min(1).max(50).optional(),
        findings: z.array(z.string().trim().min(1).max(2_000)).max(100),
        selectedBaseline: z.string().trim().max(2_000).optional(),
        acceptedRisks: z.array(z.string().trim().min(1).max(2_000)).max(100),
        stale: z.boolean().optional(),
      })
      .strict()
      .optional(),
    prReview: z
      .object({
        reviewStatus: z.string().min(1).max(50).optional(),
        readinessState: z.string().min(1).max(50).optional(),
        openFindings: z.number().int().nonnegative().optional(),
        acceptedRisks: z.array(z.string().trim().min(1).max(2_000)).max(100),
        traceabilitySummary: z.string().trim().max(10_000).optional(),
        prPackageReference: z
          .object({ title: z.string().min(1).max(200), description: z.string().trim().max(20_000) })
          .strict()
          .optional(),
      })
      .strict()
      .optional(),
    contextPackages: z
      .array(
        z
          .object({
            packageId: Id,
            revision: z.number().int().positive(),
            contentHash: ContentHash,
            tokenMeasurements: z.string().trim().max(2_000).optional(),
            includedBoundedContent: z.string().trim().max(20_000).optional(),
            summarizedContent: z.string().trim().max(10_000).optional(),
            sourceReferenceCount: z.number().int().nonnegative().optional(),
            requiredFactCoverage: z.array(z.string().trim().min(1).max(500)).max(100),
            approvalState: z.enum(["approved", "stale", "superseded"]),
            stale: z.boolean().optional(),
          })
          .strict(),
      )
      .max(50),
    findingsAndRemediation: z.array(HandoffEvidenceExcerptSchema).max(200),
    evidenceIncluded: z.boolean(),
  })
  .strict();
export type HandoffEvidenceBundle = z.infer<typeof HandoffEvidenceBundleSchema>;

// ---------------------------------------------------------------------------
// Privacy report — §21, §22
// ---------------------------------------------------------------------------

export const HandoffPrivacyFindingCategorySchema = z.enum([
  "access-token",
  "api-key",
  "authorization-header",
  "cookie",
  "password",
  "private-key",
  "connection-string",
  "secret-env-value",
  "personal-absolute-path",
  "email-address",
  "private-url",
  "raw-request-payload",
  "raw-user-data",
  "raw-customer-data",
  "large-log",
  "embedded-binary",
  "path-traversal",
]);
export type HandoffPrivacyFindingCategory = z.infer<typeof HandoffPrivacyFindingCategorySchema>;

export const PrivacySeveritySchema = z.enum(["critical", "high", "medium", "low"]);
export type PrivacySeverity = z.infer<typeof PrivacySeveritySchema>;
export const PrivacyConfidenceSchema = z.enum(["high", "medium", "low"]);
export type PrivacyConfidence = z.infer<typeof PrivacyConfidenceSchema>;

export const HandoffPrivacyFindingSchema = z
  .object({
    id: Id,
    category: HandoffPrivacyFindingCategorySchema,
    location: z.string().trim().min(1).max(1_000),
    severity: PrivacySeveritySchema,
    confidence: PrivacyConfidenceSchema,
    recommendedAction: z.enum(["redact", "remove", "replace-with-summary", "mark-false-positive"]),
    maskedPreview: z.string().trim().max(500),
    status: z.enum(["open", "redacted", "removed", "replaced", "false-positive"]),
    reason: z.string().trim().max(2_000).optional(),
  })
  .strict();
export type HandoffPrivacyFinding = z.infer<typeof HandoffPrivacyFindingSchema>;

export const HandoffPrivacyReportSchema = z
  .object({
    scanPassed: z.boolean(),
    findings: z.array(HandoffPrivacyFindingSchema).max(500),
    scannedSections: z.array(z.string().min(1).max(100)).max(50),
    scannedAt: Timestamp,
  })
  .strict();
export type HandoffPrivacyReport = z.infer<typeof HandoffPrivacyReportSchema>;

// ---------------------------------------------------------------------------
// Full package — §12
// ---------------------------------------------------------------------------

export const TaskHandoffPackageSchema = z
  .object({
    schemaVersion: z.literal(HANDOFF_SCHEMA_VERSION),
    package: z
      .object({
        id: Id,
        createdAt: Timestamp,
        contentHash: ContentHash,
        keystoneVersion: z.string().min(1).max(50),
      })
      .strict(),
    repository: HandoffRepositoryIdentitySchema,
    workflow: HandoffWorkflowSnapshotSchema,
    continuity: HandoffContinuitySummarySchema,
    references: HandoffReferenceManifestSchema,
    evidence: HandoffEvidenceBundleSchema,
    privacy: HandoffPrivacyReportSchema,
  })
  .strict();
export type TaskHandoffPackage = z.infer<typeof TaskHandoffPackageSchema>;

export type HandoffPackagePreview = TaskHandoffPackage;

// ---------------------------------------------------------------------------
// Compatibility report — §30
// ---------------------------------------------------------------------------

export const HandoffReferenceStatusSchema = z
  .object({
    referenceId: z.string().min(1).max(500),
    relativePath: RelativePath.optional(),
    entityId: z.string().min(1).max(500).optional(),
    state: z.enum([
      "matching",
      "changed",
      "missing",
      "renamed-candidate",
      "unreadable",
      "outside-workspace",
      "unverifiable",
    ]),
    exportedHash: ContentHash.optional(),
    currentHash: ContentHash.optional(),
    required: z.boolean(),
    relatedWorkflowItem: z.string().trim().max(500).optional(),
  })
  .strict();
export type HandoffReferenceStatus = z.infer<typeof HandoffReferenceStatusSchema>;

export const HandoffCompatibilityIssueSchema = z
  .object({
    code: z.string().min(1).max(100),
    section: z.string().min(1).max(100),
    message: z.string().trim().min(1).max(2_000),
    blocking: z.boolean(),
  })
  .strict();
export type HandoffCompatibilityIssue = z.infer<typeof HandoffCompatibilityIssueSchema>;

export const HandoffCompatibilityReportSchema = z
  .object({
    repository: z.enum([
      "exact-match",
      "compatible-revision-difference",
      "probable-match",
      "ambiguous",
      "incompatible",
      "unverifiable",
    ]),
    workflow: z.enum([
      "new",
      "matching",
      "older-local-version",
      "newer-local-version",
      "conflicting",
      "duplicate",
    ]),
    files: z.array(HandoffReferenceStatusSchema).max(2000),
    symbols: z.array(HandoffReferenceStatusSchema).max(2000),
    instructions: z.array(HandoffReferenceStatusSchema).max(200),
    skills: z.array(HandoffReferenceStatusSchema).max(200),
    intelligence: z.enum(["matching", "newer-local", "older-local", "missing", "incompatible"]),
    blockingIssues: z.array(HandoffCompatibilityIssueSchema).max(200),
    warnings: z.array(HandoffCompatibilityIssueSchema).max(200),
  })
  .strict();
export type HandoffCompatibilityReport = z.infer<typeof HandoffCompatibilityReportSchema>;

// ---------------------------------------------------------------------------
// Structured error codes — §47
// ---------------------------------------------------------------------------

export const HANDOFF_ERROR_CODES = [
  "handoff-not-eligible",
  "handoff-draft-exists",
  "handoff-summary-required",
  "handoff-next-action-required",
  "handoff-running-execution",
  "handoff-evidence-stale",
  "privacy-scan-failed",
  "sensitive-content-blocked",
  "repository-identity-unavailable",
  "package-too-large",
  "package-format-unsupported",
  "package-schema-unsupported",
  "package-integrity-failed",
  "package-path-unsafe",
  "package-content-unsafe",
  "repository-incompatible",
  "workflow-conflict",
  "workflow-newer-local",
  "duplicate-package",
  "file-reference-missing",
  "symbol-reference-ambiguous",
  "instruction-reference-changed",
  "skill-reference-unavailable",
  "execution-capability-unavailable",
  "import-validation-required",
  "import-blocked",
  "export-failed",
  "import-failed",
  "task-handoff-unavailable",
  "persistence-failed",
  "internal-error",
] as const;
export type HandoffErrorCode = (typeof HANDOFF_ERROR_CODES)[number];

export class HandoffError extends Error {
  constructor(
    public readonly code: HandoffErrorCode,
    message: string,
    public readonly recoverable = true,
    public readonly section: string = "handoff",
    public readonly blocking = true,
    public readonly nextAction: string = "Correct the handoff input and try again.",
    public readonly technicalDetails?: string,
  ) {
    super(message);
    this.name = "HandoffError";
  }
  toStructured() {
    return {
      code: this.code,
      message: this.message,
      recoverable: this.recoverable,
      section: this.section,
      blocking: this.blocking,
      nextAction: this.nextAction,
      technicalDetails: this.technicalDetails,
    };
  }
}

// ---------------------------------------------------------------------------
// Canonical size/limits — §29
// ---------------------------------------------------------------------------

export const HANDOFF_LIMITS = {
  totalPackageBytes: 8 * 1024 * 1024, // 8 MiB
  recordCount: 2000,
  stringLength: 20_000,
  evidenceExcerptBytes: 5_000,
  contextPackageCount: 50,
  findingsCount: 200,
  fileReferenceCount: 2000,
  symbolReferenceCount: 2000,
  nestingDepth: 8,
  maxSchemaVersion: HANDOFF_SCHEMA_VERSION,
} as const;

export function canonicalSerialize(value: unknown): string {
  return stableStringify(value);
}

function stableStringify(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map((item) => stableStringify(item)).join(",")}]`;
  const entries = Object.keys(value as Record<string, unknown>)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${stableStringify((value as Record<string, unknown>)[key])}`);
  return `{${entries.join(",")}}`;
}
