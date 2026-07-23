import { z } from "zod";

export const PR_REVIEW_SCHEMA_VERSION = 1 as const;
const Id = z.string().uuid();
const Timestamp = z.string().datetime();
const Path = z.string().min(1).max(1024);
const Text = z.string().max(40_000);
const ContentHash = z.string().min(1).max(200);

// ---------------------------------------------------------------------------
// Review scope (spec §6, §13)
// ---------------------------------------------------------------------------

export const ReviewScopeAreaSchema = z.object({
  area: z.string().min(1).max(500),
  entityIds: z.array(z.string().min(1)).max(2000).default([]),
  filePaths: z.array(Path).max(2000).default([]),
  rationale: z.string().max(2000).default(""),
});
export type ReviewScopeArea = z.infer<typeof ReviewScopeAreaSchema>;

export const ReviewChangeSetSourceSchema = z.object({
  baseRevision: z.string().max(500).optional(),
  currentRevision: z.string().max(500).optional(),
  committedPaths: z.array(Path).max(5000).default([]),
  stagedPaths: z.array(Path).max(5000).default([]),
  unstagedPaths: z.array(Path).max(5000).default([]),
  untrackedPaths: z.array(Path).max(5000).default([]),
  includedPaths: z.array(Path).max(5000).default([]),
  excludedPaths: z.array(Path).max(5000).default([]),
  generatedPaths: z.array(Path).max(5000).default([]),
  testPaths: z.array(Path).max(5000).default([]),
  configPaths: z.array(Path).max(5000).default([]),
  documentationPaths: z.array(Path).max(5000).default([]),
  partial: z.boolean().default(false),
  gitWritesPerformed: z.boolean().default(false),
});
export type ReviewChangeSetSource = z.infer<typeof ReviewChangeSetSourceSchema>;

export const ReviewScopeAssessmentSchema = z.object({
  schemaVersion: z.literal(PR_REVIEW_SCHEMA_VERSION),
  id: Id,
  workflowId: Id,
  expectedAreas: z.array(ReviewScopeAreaSchema).max(200).default([]),
  actualAreas: z.array(ReviewScopeAreaSchema).max(200).default([]),
  unlinkedFilePaths: z.array(Path).max(2000).default([]),
  justifiedExpansionIds: z.array(Id).max(200).default([]),
  state: z.enum([
    "aligned",
    "expanded-with-explanation",
    "unexplained-expansion",
    "materially-out-of-scope",
    "incomplete",
  ]),
  evidenceIds: z.array(z.string().max(500)).max(500).default([]),
  repositoryStateAvailable: z.boolean().default(false),
  partialReviewConfirmed: z.boolean().default(false),
  createdAt: Timestamp,
  contentHash: ContentHash,
});
export type ReviewScopeAssessment = z.infer<typeof ReviewScopeAssessmentSchema>;

// ---------------------------------------------------------------------------
// Changed symbols (spec §8)
// ---------------------------------------------------------------------------

export const ChangedSymbolSchema = z.object({
  name: z.string().min(1).max(1000),
  kind: z.string().min(1).max(100),
  file: Path,
  changeType: z.enum(["added", "removed", "signature-changed", "modified"]),
  visibility: z.enum(["public", "internal", "private", "unknown"]).default("unknown"),
  oldSignature: z.string().max(5000).optional(),
  newSignature: z.string().max(5000).optional(),
  publicContract: z.boolean().default(false),
  entryPoint: z.boolean().default(false),
  directCallers: z.array(z.string().min(1)).max(2000).default([]),
  directDependents: z.array(z.string().min(1)).max(2000).default([]),
  affectedFlows: z.array(z.string().min(1)).max(500).default([]),
  mappedTests: z.array(z.string().min(1)).max(1000).default([]),
  relatedRequirementIds: z.array(z.string().min(1)).max(200).default([]),
  resolved: z.boolean().default(true),
});
export type ChangedSymbol = z.infer<typeof ChangedSymbolSchema>;

// ---------------------------------------------------------------------------
// Requirement traceability (spec §9, §10)
// ---------------------------------------------------------------------------

export const TraceabilityStateSchema = z.enum([
  "implemented-and-validated",
  "implemented-not-validated",
  "partially-implemented",
  "possible-implementation",
  "no-implementation-found",
  "contradicted",
  "not-applicable",
  "ambiguous",
]);
export type TraceabilityState = z.infer<typeof TraceabilityStateSchema>;

export const ReviewTraceabilityLinkSchema = z.object({
  id: z.string().min(1).max(200),
  kind: z.enum(["requirement", "acceptance-criterion", "constraint", "objective"]),
  sourceRef: z.string().min(1).max(500),
  description: z.string().max(5000),
  implementationRefs: z.array(z.string().min(1)).max(1000).default([]),
  validationRefs: z.array(z.string().min(1)).max(1000).default([]),
  confidence: z.number().min(0).max(1),
  evidence: z.array(z.string().max(3000)).max(500).default([]),
  explanation: z.string().max(3000),
  state: TraceabilityStateSchema,
});
export type ReviewTraceabilityLink = z.infer<typeof ReviewTraceabilityLinkSchema>;

export const ReviewTraceabilityAssessmentSchema = z.object({
  schemaVersion: z.literal(PR_REVIEW_SCHEMA_VERSION),
  id: Id,
  workflowId: Id,
  links: z.array(ReviewTraceabilityLinkSchema).max(1000).default([]),
  unlinkedChangePaths: z.array(Path).max(2000).default([]),
  ambiguousLinkIds: z.array(z.string().min(1)).max(500).default([]),
  createdAt: Timestamp,
  contentHash: ContentHash,
});
export type ReviewTraceabilityAssessment = z.infer<typeof ReviewTraceabilityAssessmentSchema>;

export const AcceptanceCriterionReviewSchema = z.object({
  criterionId: z.string().min(1).max(200),
  text: z.string().max(5000),
  implementationMapping: z.array(z.string().min(1)).max(1000).default([]),
  testMapping: z.array(z.string().min(1)).max(1000).default([]),
  executionResult: z.enum(["passed", "failed", "skipped", "not-run", "unknown"]).default("unknown"),
  securityRelevant: z.boolean().default(false),
  performanceRelevant: z.boolean().default(false),
  state: z.enum([
    "satisfied",
    "satisfied-with-warnings",
    "partially-satisfied",
    "not-satisfied",
    "not-verified",
    "conflicting-evidence",
    "not-applicable",
  ]),
  missingEvidence: z.array(z.string().max(2000)).max(100).default([]),
});
export type AcceptanceCriterionReview = z.infer<typeof AcceptanceCriterionReviewSchema>;

// ---------------------------------------------------------------------------
// Contract review (spec §16, §17)
// ---------------------------------------------------------------------------

export const ContractChangeSchema = z.object({
  id: z.string().min(1).max(200),
  contractKind: z.enum([
    "exported-function",
    "public-method",
    "interface",
    "api-route",
    "request-type",
    "response-type",
    "event-contract",
    "configuration-schema",
    "database-schema",
    "persisted-format",
    "package-export",
  ]),
  location: z.string().max(2000),
  oldShape: z.string().max(5000).optional(),
  newShape: z.string().max(5000).optional(),
  classification: z.enum([
    "additive",
    "compatible",
    "potentially-breaking",
    "breaking",
    "destructive",
    "unresolved",
  ]),
  affectedConsumers: z.array(z.string().max(2000)).max(500).default([]),
  behaviouralNote: z.string().max(3000).default(""),
  evidenceIds: z.array(z.string().max(500)).max(500).default([]),
  confidence: z.number().min(0).max(1),
});
export type ContractChange = z.infer<typeof ContractChangeSchema>;

export const ReviewContractAssessmentSchema = z.object({
  schemaVersion: z.literal(PR_REVIEW_SCHEMA_VERSION),
  id: Id,
  workflowId: Id,
  changes: z.array(ContractChangeSchema).max(2000).default([]),
  createdAt: Timestamp,
  contentHash: ContentHash,
});
export type ReviewContractAssessment = z.infer<typeof ReviewContractAssessmentSchema>;

// ---------------------------------------------------------------------------
// Test adequacy (spec §21, §22)
// ---------------------------------------------------------------------------

export const ReviewTestAssessmentSchema = z.object({
  schemaVersion: z.literal(PR_REVIEW_SCHEMA_VERSION),
  id: Id,
  workflowId: Id,
  state: z.enum([
    "sufficient",
    "sufficient-with-warnings",
    "incomplete",
    "failed",
    "stale",
    "unavailable",
  ]),
  requiredImpactedTests: z.array(z.string().min(1)).max(1000).default([]),
  testsExecuted: z.array(z.string().min(1)).max(1000).default([]),
  resultsByTest: z
    .record(
      z.string(),
      z.enum(["passed", "failed", "skipped", "not-run", "flaky"]),
    )
    .default({}),
  generatedTestValidationIds: z.array(z.string().min(1)).max(500).default([]),
  remediationValidationIds: z.array(z.string().min(1)).max(500).default([]),
  unresolvedFailures: z.array(z.string().min(1)).max(1000).default([]),
  flakyStateIds: z.array(z.string().min(1)).max(500).default([]),
  skippedTests: z.array(z.string().min(1)).max(1000).default([]),
  coverageGaps: z.array(z.string().max(2000)).max(500).default([]),
  policyViolations: z.array(z.string().min(1)).max(500).default([]),
  qaDecisionCurrent: z.boolean().default(false),
  createdAt: Timestamp,
  contentHash: ContentHash,
});
export type ReviewTestAssessment = z.infer<typeof ReviewTestAssessmentSchema>;

// ---------------------------------------------------------------------------
// Review findings (spec §29)
// ---------------------------------------------------------------------------

export const ReviewFindingCategorySchema = z.enum([
  "requirement",
  "scope",
  "architecture",
  "dependency",
  "contract",
  "compatibility",
  "database",
  "configuration",
  "documentation",
  "test",
  "security",
  "performance",
  "quality",
  "error-handling",
  "other",
]);
export type ReviewFindingCategory = z.infer<typeof ReviewFindingCategorySchema>;

export const ReviewFindingSeveritySchema = z.enum([
  "info",
  "suggestion",
  "warning",
  "high",
  "critical",
]);
export type ReviewFindingSeverity = z.infer<typeof ReviewFindingSeveritySchema>;

export const ReviewFindingProvenanceSchema = z.enum([
  "deterministic",
  "qa",
  "security",
  "performance",
  "agent",
  "user",
]);
export type ReviewFindingProvenance = z.infer<typeof ReviewFindingProvenanceSchema>;

export const ReviewFindingStatusSchema = z.enum([
  "open",
  "remediation-planned",
  "resolved",
  "accepted-risk",
  "false-positive",
  "deferred",
  "superseded",
]);
export type ReviewFindingStatus = z.infer<typeof ReviewFindingStatusSchema>;

export const ReviewFindingSchema = z.object({
  id: z.string().min(1).max(200),
  reviewId: z.string().min(1).max(200).optional(),
  category: ReviewFindingCategorySchema,
  severity: ReviewFindingSeveritySchema,
  confidence: z.number().min(0).max(1),
  title: z.string().min(1).max(500),
  description: z.string().max(5000),
  location: z
    .object({
      filePath: Path,
      startLine: z.number().int().nonnegative().optional(),
      endLine: z.number().int().nonnegative().optional(),
      entityId: z.string().max(500).optional(),
    })
    .optional(),
  requirementIds: z.array(z.string().min(1)).max(200).default([]),
  evidenceIds: z.array(z.string().min(1)).max(500).default([]),
  provenance: ReviewFindingProvenanceSchema,
  status: ReviewFindingStatusSchema.default("open"),
  resolutionEvidence: z.array(z.string().min(1)).max(500).optional(),
  createdAt: Timestamp,
  contentHash: ContentHash,
});
export type ReviewFinding = z.infer<typeof ReviewFindingSchema>;

// ---------------------------------------------------------------------------
// Readiness decision (spec §36, §37)
// ---------------------------------------------------------------------------

export const ReviewGateResultSchema = z.object({
  gate: z.string().min(1).max(200),
  result: z.enum(["passed", "warning", "failed", "incomplete"]),
  evidence: z.array(z.string().max(3000)).max(100).default([]),
  reason: z.string().max(3000),
  requiredNextAction: z.string().max(3000).default(""),
});
export type ReviewGateResult = z.infer<typeof ReviewGateResultSchema>;

export const ChangeReadinessDecisionSchema = z.object({
  schemaVersion: z.literal(PR_REVIEW_SCHEMA_VERSION),
  id: Id,
  workflowId: Id,
  reviewId: z.string().min(1).max(200),
  decision: z.enum([
    "ready",
    "ready-with-warnings",
    "remediation-required",
    "blocked",
    "incomplete",
  ]),
  gates: z.array(ReviewGateResultSchema).max(100).default([]),
  counts: z.object({
    criticalOpen: z.number().int().nonnegative(),
    highOpen: z.number().int().nonnegative(),
    warningOpen: z.number().int().nonnegative(),
    acceptedRisk: z.number().int().nonnegative(),
    deferred: z.number().int().nonnegative(),
  }),
  evidence: z.object({
    traceabilityCurrent: z.boolean(),
    qaCurrent: z.boolean(),
    securityCurrent: z.boolean(),
    performanceCurrent: z.boolean(),
    reviewCurrent: z.boolean(),
  }),
  approvedByUser: z.boolean().default(false),
  createdAt: Timestamp,
  contentHash: ContentHash,
});
export type ChangeReadinessDecision = z.infer<typeof ChangeReadinessDecisionSchema>;

// ---------------------------------------------------------------------------
// Pull request package (spec §39, §40, §41, §43)
// ---------------------------------------------------------------------------

export const PullRequestPackageSchema = z.object({
  schemaVersion: z.literal(PR_REVIEW_SCHEMA_VERSION),
  id: Id,
  workflowId: Id,
  reviewId: z.string().min(1).max(200),
  title: z.string().min(1).max(500),
  description: Text,
  generatedAt: Timestamp,
  contentHash: ContentHash,
  userEdited: z.boolean().default(false),
  stale: z.boolean().default(false),
  sections: z
    .object({
      summary: z.string().max(20_000).default(""),
      problem: z.string().max(20_000).default(""),
      solution: z.string().max(20_000).default(""),
      mainChanges: z.string().max(20_000).default(""),
      requirementCoverage: z.string().max(20_000).default(""),
      affectedAreas: z.string().max(20_000).default(""),
      contractChanges: z.string().max(20_000).default(""),
      configurationOrMigration: z.string().max(20_000).default(""),
      testEvidence: z.string().max(20_000).default(""),
      security: z.string().max(20_000).default(""),
      performance: z.string().max(20_000).default(""),
      knownLimitations: z.string().max(20_000).default(""),
      acceptedRisks: z.string().max(20_000).default(""),
      reviewerGuidance: z.string().max(20_000).default(""),
      checklist: z.string().max(20_000).default(""),
    })
    .default({
      summary: "",
      problem: "",
      solution: "",
      mainChanges: "",
      requirementCoverage: "",
      affectedAreas: "",
      contractChanges: "",
      configurationOrMigration: "",
      testEvidence: "",
      security: "",
      performance: "",
      knownLimitations: "",
      acceptedRisks: "",
      reviewerGuidance: "",
      checklist: "",
    }),
  contextBudget: z
    .object({
      maxSummaryTokens: z.number().int().nonnegative().default(2000),
      maxSectionTokens: z.number().int().nonnegative().default(1000),
      maxTotalTokens: z.number().int().nonnegative().default(12_000),
      estimatedTokensUsed: z.number().int().nonnegative().default(0),
    })
    .default({
      maxSummaryTokens: 2000,
      maxSectionTokens: 1000,
      maxTotalTokens: 12_000,
      estimatedTokensUsed: 0,
    })
    .optional(),
});
export type PullRequestPackage = z.infer<typeof PullRequestPackageSchema>;

// ---------------------------------------------------------------------------
// Canonical review model (spec §7)
// ---------------------------------------------------------------------------

export const PullRequestReviewSchema = z.object({
  schemaVersion: z.literal(PR_REVIEW_SCHEMA_VERSION),
  id: Id,
  workflowId: Id,
  changeSetId: z.string().max(500).default(""),
  specificationRevision: z.number().int().nonnegative(),
  intelligenceRevision: z.string().max(500).default(""),
  traceabilityAssessmentId: z.string().max(200).optional(),
  scopeAssessmentId: z.string().max(200).optional(),
  contractAssessmentId: z.string().max(200).optional(),
  testAssessmentId: z.string().max(200).optional(),
  securityDecisionId: z.string().max(500).optional(),
  performanceDecisionId: z.string().max(500).optional(),
  findingIds: z.array(z.string().min(1)).max(2000).default([]),
  readinessDecisionId: z.string().max(200).optional(),
  prPackageId: z.string().max(200).optional(),
  status: z.enum([
    "preparing",
    "analyzing",
    "awaiting-review",
    "remediation-required",
    "revalidating",
    "ready",
    "ready-with-warnings",
    "blocked",
    "stale",
    "failed",
  ]),
  createdAt: Timestamp,
  updatedAt: Timestamp,
  contentHash: ContentHash,
});
export type PullRequestReview = z.infer<typeof PullRequestReviewSchema>;

// ---------------------------------------------------------------------------
// Typed extension protocol (spec §45)
// ---------------------------------------------------------------------------

export const PrReviewCorrelationSchema = z.object({
  correlationId: z.string().min(1).max(200),
  workflowId: Id,
});

export const PrReviewPrepareRequestSchema = PrReviewCorrelationSchema.extend({
  overrideChangeSet: ReviewChangeSetSourceSchema.optional(),
  confirmPartial: z.boolean().default(false),
});
export const PrReviewScopeRequestSchema = PrReviewCorrelationSchema;
export const PrReviewConfirmScopeRequestSchema = PrReviewCorrelationSchema.extend({
  confirmed: z.literal(true),
});
export const PrReviewTraceabilityRequestSchema = PrReviewCorrelationSchema;
export const PrReviewScopeAssessmentRequestSchema = PrReviewCorrelationSchema;
export const PrReviewContractRequestSchema = PrReviewCorrelationSchema;
export const PrReviewTestRequestSchema = PrReviewCorrelationSchema;
export const PrReviewSecurityPerformanceRequestSchema = PrReviewCorrelationSchema;
export const PrReviewStartAgentRequestSchema = PrReviewCorrelationSchema.extend({
  skillId: z.string().min(1).max(200).default("pr-review"),
  buildContext: z.boolean().default(true),
});
export const PrReviewRecordAgentFindingsRequestSchema = PrReviewCorrelationSchema.extend({
  findings: z.array(z.object({
    category: ReviewFindingCategorySchema,
    severity: ReviewFindingSeveritySchema,
    confidence: z.number().min(0).max(1),
    title: z.string().min(1).max(500),
    description: z.string().max(5000),
    location: z
      .object({ filePath: Path, startLine: z.number().int().nonnegative().optional(), endLine: z.number().int().nonnegative().optional(), entityId: z.string().max(500).optional() })
      .optional(),
    requirementIds: z.array(z.string().min(1)).max(200).default([]),
    evidenceIds: z.array(z.string().min(1)).max(500).default([]),
    recommendation: z.string().max(5000).default(""),
  })).max(200),
});
export const PrReviewFindingsRequestSchema = PrReviewCorrelationSchema;
export const PrReviewUpdateFindingStatusRequestSchema = PrReviewCorrelationSchema.extend({
  findingId: z.string().min(1).max(200),
  status: ReviewFindingStatusSchema,
  resolutionEvidence: z.array(z.string().min(1)).max(500).default([]),
  justification: z.string().max(3000).default(""),
});
export const PrReviewCreateRemediationRequestSchema = PrReviewCorrelationSchema.extend({
  findingId: z.string().min(1).max(200),
  targetStage: z.enum(["development", "test-generation", "test-healing", "security", "performance", "documentation"]),
  expectedCorrection: z.string().max(5000),
  requiredValidation: z.string().max(5000),
});
export const PrReviewRefreshRequestSchema = PrReviewCorrelationSchema;
export const PrReviewReadinessRequestSchema = PrReviewCorrelationSchema;
export const PrReviewApproveReadinessRequestSchema = PrReviewCorrelationSchema.extend({
  reason: z.string().min(1).max(5000),
  decision: z.enum(["ready", "ready-with-warnings"]),
});
export const PrReviewGeneratePackageRequestSchema = PrReviewCorrelationSchema;
export const PrReviewUpdatePackageRequestSchema = PrReviewCorrelationSchema.extend({
  title: z.string().min(1).max(500).optional(),
  description: Text.optional(),
});
export const PrReviewCopyPackageRequestSchema = PrReviewCorrelationSchema.extend({
  target: z.enum(["title", "description", "complete"]).default("complete"),
});

export type PrReviewPrepareRequest = z.infer<typeof PrReviewPrepareRequestSchema>;
export type PrReviewConfirmScopeRequest = z.infer<typeof PrReviewConfirmScopeRequestSchema>;
export type PrReviewRecordAgentFindingsRequest = z.infer<typeof PrReviewRecordAgentFindingsRequestSchema>;
export type PrReviewUpdateFindingStatusRequest = z.infer<typeof PrReviewUpdateFindingStatusRequestSchema>;
export type PrReviewCreateRemediationRequest = z.infer<typeof PrReviewCreateRemediationRequestSchema>;
export type PrReviewApproveReadinessRequest = z.infer<typeof PrReviewApproveReadinessRequestSchema>;
export type PrReviewUpdatePackageRequest = z.infer<typeof PrReviewUpdatePackageRequestSchema>;
export type PrReviewCopyPackageRequest = z.infer<typeof PrReviewCopyPackageRequestSchema>;

// ---------------------------------------------------------------------------
// Security/Performance decision (spec §23) — consolidated current-evidence view.
// Shape mirrors the deterministic review contract used by the test suite.
// ---------------------------------------------------------------------------

export const ReviewSecurityPerformanceDecisionSchema = z.object({
  schemaVersion: z.literal(PR_REVIEW_SCHEMA_VERSION),
  id: Id,
  workflowId: Id,
  securityStatus: z.enum(["reviewed", "stale", "open", "unavailable"]),
  performanceStatus: z.enum(["reviewed", "stale", "open", "unavailable"]),
  currentSecurityDecisionId: z.string().max(500).optional(),
  currentSecurityDecisionAt: Timestamp.optional(),
  securityDecisionAgeMs: z.number().nonnegative(),
  currentPerformanceDecisionId: z.string().max(500).optional(),
  currentPerformanceDecisionAt: Timestamp.optional(),
  performanceDecisionAgeMs: z.number().nonnegative(),
  acceptedRisks: z.array(z.any()).default([]),
  openBlockingFindings: z.array(z.any()).default([]),
  confirmedRegressions: z.array(z.any()).default([]),
  blocked: z.boolean().default(false),
  createdAt: Timestamp,
  contentHash: ContentHash,
});
export type ReviewSecurityPerformanceDecision = z.infer<typeof ReviewSecurityPerformanceDecisionSchema>;
export type PrReviewPersistentState = {
  schemaVersion: typeof PR_REVIEW_SCHEMA_VERSION;
  revision: number;
  reviews: PullRequestReview[];
  scopeAssessments: ReviewScopeAssessment[];
  traceabilityAssessments: ReviewTraceabilityAssessment[];
  contractAssessments: ReviewContractAssessment[];
  testAssessments: ReviewTestAssessment[];
  findings: ReviewFinding[];
  readinessDecisions: ChangeReadinessDecision[];
  packages: PullRequestPackage[];
  updatedAt: string;
};
