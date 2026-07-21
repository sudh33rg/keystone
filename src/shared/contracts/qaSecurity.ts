/**
 * Phase 8 — Canonical Security & Performance Intelligence model (spec §4, §19, §23, §31, §51, §53).
 *
 * Defines the persisted concepts for security and performance analysis as first-class SDLC stages that
 * connect to the Phase 6 change set / impact analysis, Phase 4 graph & flows, Phase 3 context
 * compression, Phase 2 execution profiles, Phase 5 queries, and Phase 7 remediation. Deterministic
 * analysis is usable without any agent. No remote service, external DB, or LLM is required.
 *
 * zod v4: every `z.record` uses the two-argument form `z.record(keySchema, valueSchema)`.
 */
import { z } from "zod";
import type { QaDecision } from "./qaLifecycle";

export type { QaDecision };

// ---------------------------------------------------------------------------
// Shared enums (spec §4, §5, §7, §14, §19, §23, §31, §38)
// ---------------------------------------------------------------------------

export const ExposureLevelSchema = z.enum([
  "public-external",
  "authenticated-external",
  "partner-or-service-external",
  "local-user-initiated",
  "internal-service",
  "background-system-initiated",
  "administrative",
  "test-only",
  "unknown",
]);
export type ExposureLevel = z.infer<typeof ExposureLevelSchema>;

export const SecurityEntityRoleSchema = z.enum([
  "external-entry-point",
  "internal-entry-point",
  "authenticated-entry-point",
  "unauthenticated-entry-point",
  "trust-boundary",
  "identity-provider",
  "authentication-handler",
  "authorization-decision",
  "role-or-permission-check",
  "input-source",
  "validator",
  "sanitizer",
  "encoder",
  "sensitive-data-source",
  "sensitive-data-processor",
  "security-sensitive-sink",
  "persistence-sink",
  "logging-sink",
  "external-service-sink",
  "command-execution-sink",
  "file-system-sink",
  "deserialization-boundary",
  "configuration-source",
  "secret-reference",
  "cryptographic-operation",
  "session-store",
  "token-handler",
  "unknown-security-role",
]);
export type SecurityEntityRole = z.infer<typeof SecurityEntityRoleSchema>;

export const SensitiveDataCategorySchema = z.enum([
  "authentication-credential",
  "access-token",
  "private-key",
  "secret",
  "personal-identifier",
  "contact-information",
  "financial-information",
  "payment-information",
  "health-related-data",
  "session-data",
  "location-data",
  "internal-confidential-data",
  "user-content",
  "unknown-sensitive-data",
]);
export type SensitiveDataCategory = z.infer<typeof SensitiveDataCategorySchema>;

export const SecurityPathCategorySchema = z.enum([
  "injection-candidate",
  "command-execution-candidate",
  "path-traversal-candidate",
  "unsafe-deserialization-candidate",
  "server-side-request-candidate",
  "cross-site-scripting-candidate",
  "sensitive-logging-candidate",
  "authorization-bypass-candidate",
  "insecure-direct-object-access-candidate",
  "secret-exposure-candidate",
  "weak-randomness-candidate",
  "cryptographic-misuse-candidate",
  "unsafe-file-handling-candidate",
  "open-redirect-candidate",
  "configuration-exposure-candidate",
  "unresolved-security-sensitive-flow",
]);
export type SecurityPathCategory = z.infer<typeof SecurityPathCategorySchema>;

export const FindingConfidenceTuple = z.tuple([z.string(), z.number().min(0).max(1)]);
export const RiskLevelSchema = z.enum(["low", "medium", "high", "critical"]);
export type RiskLevel = z.infer<typeof RiskLevelSchema>;

export const AnalysisStatusSchema = z.enum(["complete", "partial", "blocked", "stale"]);
export type AnalysisStatus = z.infer<typeof AnalysisStatusSchema>;

export const SecurityFindingStatusSchema = z.enum([
  "open",
  "accepted-risk",
  "false-positive",
  "remediation-planned",
  "remediated",
  "verified",
  "blocked",
  "superseded",
]);
export type SecurityFindingStatus = z.infer<typeof SecurityFindingStatusSchema>;

export const SecuritySeveritySchema = z.enum(["info", "low", "medium", "high", "critical"]);
export type SecuritySeverity = z.infer<typeof SecuritySeveritySchema>;

// ---------------------------------------------------------------------------
// Security structural models (spec §4, §5, §6, §7, §8, §9, §10, §12, §13, §19)
// ---------------------------------------------------------------------------

export const AttackSurfaceEntrySchema = z.object({
  entityId: z.string().min(1).max(500),
  protocolOrTrigger: z.string().min(1).max(200),
  exposure: ExposureLevelSchema,
  authenticationRequired: z.boolean(),
  authorizationRequired: z.boolean(),
  acceptedInput: z.array(z.string().max(500)).max(50).default([]),
  downstreamFlowIds: z.array(z.string().min(1)).max(200).default([]),
  sensitiveOperations: z.array(z.string().max(500)).max(50).default([]),
  evidence: z.array(z.string().min(1).max(2000)).max(50).default([]),
  confidence: z.number().min(0).max(1),
});
export type AttackSurfaceEntry = z.infer<typeof AttackSurfaceEntrySchema>;

export const SecurityAttackSurfaceSchema = z.object({
  entries: z.array(AttackSurfaceEntrySchema).max(1000).default([]),
  metadata: z.object({ generatedAt: z.string().min(1), contentHash: z.string().min(1) }),
});
export type SecurityAttackSurface = z.infer<typeof SecurityAttackSurfaceSchema>;

export const TrustBoundarySchema = z.object({
  id: z.string().min(1).max(500),
  sourceZone: z.string().min(1).max(500),
  destinationZone: z.string().min(1).max(500),
  crossingEntityIds: z.array(z.string().min(1)).max(500).default([]),
  inputOrDataTypes: z.array(z.string().max(500)).max(50).default([]),
  authenticationState: z.enum(["authenticated", "unauthenticated", "unknown"]),
  authorizationState: z.enum(["authorized", "unauthorized", "unknown"]),
  validationState: z.enum(["validated", "unvalidated", "unknown"]),
  encryptionEvidence: z.string().max(2000).optional(),
  confidence: z.number().min(0).max(1),
  evidence: z.array(z.string().min(1).max(2000)).max(50).default([]),
});
export type TrustBoundary = z.infer<typeof TrustBoundarySchema>;

export const SecurityAuthPathSchema = z.object({
  id: z.string().min(1).max(500),
  entryPointEntityId: z.string().min(1).max(500),
  steps: z
    .array(z.object({ kind: z.string().min(1), entityId: z.string().min(1) }))
    .max(50)
    .default([]),
  hasAuthenticationEvidence: z.boolean(),
  authOccursAfterSensitiveAction: z.boolean().default(false),
  inconsistentAcrossRelatedRoutes: z.boolean().default(false),
  bypassPath: z.boolean().default(false),
  unresolved: z.boolean().default(false),
  testOnlyAuth: z.boolean().default(false),
  configurationDependent: z.boolean().default(false),
  evidence: z.array(z.string().min(1).max(2000)).max(50).default([]),
});
export type SecurityAuthPath = z.infer<typeof SecurityAuthPathSchema>;

export const SecurityAuthorizationPathSchema = z.object({
  id: z.string().min(1).max(500),
  operationEntityId: z.string().min(1).max(500),
  decisionEntityId: z.string().min(1).max(500).optional(),
  checkType: z.enum([
    "role",
    "permission",
    "ownership",
    "policy",
    "tenant",
    "resource-level",
    "administrative",
    "none-visible",
  ]),
  hasAuthorizationEvidence: z.boolean(),
  authorizationOnlyInUi: z.boolean().default(false),
  inconsistentSiblingRoute: z.boolean().default(false),
  broadRoleUse: z.boolean().default(false),
  unresolvedIndirect: z.boolean().default(false),
  authorizationAfterDataAccess: z.boolean().default(false),
  missingOwnershipValidation: z.boolean().default(false),
  configBasedBypass: z.boolean().default(false),
  evidence: z.array(z.string().min(1).max(2000)).max(50).default([]),
});
export type SecurityAuthorizationPath = z.infer<typeof SecurityAuthorizationPathSchema>;

export const SecurityDataFlowSchema = z.object({
  id: z.string().min(1).max(500),
  sourceEntityId: z.string().min(1).max(500),
  sinkEntityId: z.string().min(1).max(500),
  dataCategories: z.array(SensitiveDataCategorySchema).max(20).default([]),
  relationship: z.enum(["proven", "structural", "inferred", "unresolved"]),
  crossesTrustBoundary: z.boolean().default(false),
  evidence: z.array(z.string().min(1).max(2000)).max(50).default([]),
});
export type SecurityDataFlow = z.infer<typeof SecurityDataFlowSchema>;

export const SecurityPathSchema = z.object({
  id: z.string().min(1).max(500),
  category: SecurityPathCategorySchema,
  sourceEntityId: z.string().min(1).max(500),
  sinkEntityId: z.string().min(1).max(500),
  intermediateSteps: z.array(z.string().min(1).max(500)).max(100).default([]),
  trustBoundaryCrossings: z.array(z.string().min(1).max(500)).max(50).default([]),
  validators: z.array(z.string().min(1).max(500)).max(50).default([]),
  sanitizers: z.array(z.string().min(1).max(500)).max(50).default([]),
  encoders: z.array(z.string().min(1).max(500)).max(50).default([]),
  unresolvedTransformations: z.array(z.string().min(1).max(500)).max(50).default([]),
  confidence: z.number().min(0).max(1),
  evidence: z.array(z.string().min(1).max(2000)).max(50).default([]),
  riskCategory: SecurityPathCategorySchema,
});
export type SecurityPath = z.infer<typeof SecurityPathSchema>;

export const SecurityRiskFactorSchema = z.object({
  id: z.string().min(1).max(200),
  description: z.string().min(1).max(1000),
  weight: z.number().min(0).max(1),
  contribution: z.number().min(0).max(1),
});
export type SecurityRiskFactor = z.infer<typeof SecurityRiskFactorSchema>;

export const SecurityWarningSchema = z.object({
  code: z.string().min(1).max(100),
  message: z.string().min(1).max(2000),
});
export type SecurityWarning = z.infer<typeof SecurityWarningSchema>;

export const SecurityAnalysisSchema = z.object({
  id: z.string().min(1).max(500),
  workflowId: z.string().max(500).optional(),
  changeSetId: z.string().max(500).optional(),
  scope: z.object({
    rootEntityIds: z.array(z.string().min(1)).max(2000).default([]),
    flowIds: z.array(z.string().min(1)).max(2000).default([]),
    packageIds: z.array(z.string().min(1)).max(2000).default([]),
    planned: z.boolean().default(false),
  }),
  attackSurface: SecurityAttackSurfaceSchema,
  trustBoundaries: z.array(TrustBoundarySchema).max(500).default([]),
  authPaths: z.array(SecurityAuthPathSchema).max(500).default([]),
  dataFlows: z.array(SecurityDataFlowSchema).max(500).default([]),
  sourceSinkPaths: z.array(SecurityPathSchema).max(1000).default([]),
  configurationFindings: z.array(z.any()).max(500).default([]),
  dependencyFindings: z.array(z.any()).max(500).default([]),
  findings: z.array(z.any()).max(2000).default([]),
  risk: z.object({
    level: RiskLevelSchema,
    score: z.number().min(0).max(1),
    factors: z.array(SecurityRiskFactorSchema).max(100).default([]),
  }),
  warnings: z.array(SecurityWarningSchema).max(100).default([]),
  metadata: z.object({
    intelligenceRevision: z.string().min(1),
    specificationRevision: z.string().min(1),
    generatedAt: z.string().min(1),
    contentHash: z.string().min(1),
    status: AnalysisStatusSchema,
  }),
});
export type SecurityAnalysis = z.infer<typeof SecurityAnalysisSchema>;

export const SecurityFindingSchema = z.object({
  id: z.string().min(1).max(500),
  analysisId: z.string().min(1).max(500),
  category: z.string().min(1).max(200),
  title: z.string().min(1).max(500),
  description: z.string().min(1).max(2000),
  severity: SecuritySeveritySchema,
  confidence: z.number().min(0).max(1),
  status: SecurityFindingStatusSchema.default("open"),
  scope: z.object({
    entityIds: z.array(z.string().min(1)).max(2000).default([]),
    flowIds: z.array(z.string().min(1)).max(2000).default([]),
    pathIds: z.array(z.string().min(1)).max(2000).default([]),
    filePaths: z.array(z.string().min(1).max(2000)).max(500).default([]),
  }),
  evidenceIds: z.array(z.string().min(1)).max(2000).default([]),
  recommendation: z.object({
    action: z.string().min(1).max(2000),
    validationType: z.string().max(200).optional(),
    executionProfileId: z.string().max(500).optional(),
  }),
  metadata: z.object({
    createdAt: z.string().min(1),
    updatedAt: z.string().min(1),
    contentHash: z.string().min(1),
  }),
});
export type SecurityFinding = z.infer<typeof SecurityFindingSchema>;

// ---------------------------------------------------------------------------
// Performance models (spec §23, §25, §26, §27, §28, §29, §31, §32, §33, §34)
// ---------------------------------------------------------------------------

export const PerformancePathKindSchema = z.enum([
  "request-response",
  "event-processing",
  "batch-processing",
  "startup",
  "extension-activation",
  "build-or-analysis",
  "database-transaction",
  "external-integration",
]);
export type PerformancePathKind = z.infer<typeof PerformancePathKindSchema>;

export const PerformancePathSchema = z.object({
  id: z.string().min(1).max(500),
  kind: PerformancePathKindSchema,
  entryEntityId: z.string().min(1).max(500),
  mark: z.enum([
    "configured-critical",
    "runtime-evidenced",
    "structurally-likely",
    "inferred",
    "unresolved",
  ]),
  confidence: z.number().min(0).max(1),
  evidence: z.array(z.string().min(1).max(2000)).max(50).default([]),
});
export type PerformancePath = z.infer<typeof PerformancePathSchema>;

export const DatabaseInteractionSchema = z.object({
  id: z.string().min(1).max(500),
  entityId: z.string().min(1).max(500),
  operation: z.enum(["read", "write", "transaction", "query-construction", "unknown"]),
  inLoop: z.boolean().default(false),
  loopContext: z.string().max(500).optional(),
  perItemQuery: z.boolean().default(false),
  batchingEvidence: z.boolean().default(false),
  cachingEvidence: z.boolean().default(false),
  confidence: z.number().min(0).max(1),
  evidence: z.array(z.string().min(1).max(2000)).max(50).default([]),
  runtimeConfirmation: z.boolean().default(false),
});
export type DatabaseInteraction = z.infer<typeof DatabaseInteractionSchema>;

export const ExternalCallInteractionSchema = z.object({
  id: z.string().min(1).max(500),
  entityId: z.string().min(1).max(500),
  target: z.string().min(1).max(500),
  inLoop: z.boolean().default(false),
  sequentialIndependent: z.boolean().default(false),
  fanOutBreadth: z.number().int().nonnegative().optional(),
  timeoutConfigured: z.boolean().default(false),
  retryBehaviour: z.boolean().default(false),
  circuitBreakingEvidence: z.boolean().default(false),
  confidence: z.number().min(0).max(1),
  evidence: z.array(z.string().min(1).max(2000)).max(50).default([]),
});
export type ExternalCallInteraction = z.infer<typeof ExternalCallInteractionSchema>;

export const PerformanceFindingCategorySchema = z.enum([
  "database-in-loop",
  "n-plus-one-candidate",
  "sequential-external-calls",
  "unbounded-fanout",
  "blocking-operation",
  "missing-timeout",
  "large-allocation",
  "repeated-parsing",
  "unbounded-scan",
  "cache-regression",
  "startup-regression",
  "latency-regression",
  "throughput-regression",
  "memory-regression",
  "unknown",
]);
export type PerformanceFindingCategory = z.infer<typeof PerformanceFindingCategorySchema>;

export const PerformanceFindingStatusSchema = z.enum([
  "open",
  "accepted-risk",
  "false-positive",
  "measurement-required",
  "remediation-planned",
  "remediated",
  "verified",
  "superseded",
]);
export type PerformanceFindingStatus = z.infer<typeof PerformanceFindingStatusSchema>;

export const PerformanceSeveritySchema = SecuritySeveritySchema;
export type PerformanceSeverity = z.infer<typeof PerformanceSeveritySchema>;

export const PerformanceFindingSchema = z.object({
  id: z.string().min(1).max(500),
  analysisId: z.string().min(1).max(500),
  category: PerformanceFindingCategorySchema,
  title: z.string().min(1).max(500),
  description: z.string().min(1).max(2000),
  severity: PerformanceSeveritySchema,
  confidence: z.number().min(0).max(1),
  status: PerformanceFindingStatusSchema.default("open"),
  scope: z.object({
    entityIds: z.array(z.string().min(1)).max(2000).default([]),
    flowIds: z.array(z.string().min(1)).max(2000).default([]),
    filePaths: z.array(z.string().min(1).max(2000)).max(500).default([]),
  }),
  staticEvidenceIds: z.array(z.string().min(1)).max(2000).default([]),
  runtimeEvidenceIds: z.array(z.string().min(1)).max(2000).default([]),
  recommendation: z.object({
    action: z.string().min(1).max(2000),
    benchmarkId: z.string().max(500).optional(),
    executionProfileId: z.string().max(500).optional(),
  }),
  metadata: z.object({
    createdAt: z.string().min(1),
    updatedAt: z.string().min(1),
    contentHash: z.string().min(1),
  }),
});
export type PerformanceFinding = z.infer<typeof PerformanceFindingSchema>;

export const PerformanceRiskFactorSchema = z.object({
  id: z.string().min(1).max(200),
  description: z.string().min(1).max(1000),
  weight: z.number().min(0).max(1),
  contribution: z.number().min(0).max(1),
});
export type PerformanceRiskFactor = z.infer<typeof PerformanceRiskFactorSchema>;

export const PerformanceWarningSchema = z.object({
  code: z.string().min(1).max(100),
  message: z.string().min(1).max(2000),
});
export type PerformanceWarning = z.infer<typeof PerformanceWarningSchema>;

export const PerformanceRuntimeEvidenceSchema = z.object({
  id: z.string().min(1).max(500),
  tool: z.string().min(1).max(200),
  toolVersion: z.string().max(200).optional(),
  command: z.string().min(1).max(2000),
  environmentFingerprint: z.string().max(500).optional(),
  repositoryRevision: z.string().max(500).optional(),
  scenario: z.string().min(1).max(500),
  metric: z.string().min(1).max(200),
  unit: z.string().min(1).max(50),
  sampleCount: z.number().int().nonnegative(),
  baseline: z.number(),
  currentValue: z.number(),
  variance: z.number(),
  confidence: z.number().min(0).max(1),
  rawOutputRef: z.string().max(2000).optional(),
});
export type PerformanceRuntimeEvidence = z.infer<typeof PerformanceRuntimeEvidenceSchema>;

export const PerformanceBaselineSchema = z.object({
  id: z.string().min(1).max(500),
  benchmarkOrScenario: z.string().min(1).max(500),
  revision: z.string().max(500).optional(),
  environmentFingerprint: z.string().max(500).optional(),
  metric: z.string().min(1).max(200),
  sampleCount: z.number().int().nonnegative(),
  aggregationMethod: z.enum(["mean", "median", "p95", "max", "min"]),
  value: z.number(),
  timestamp: z.string().min(1),
  source: z.enum(["repository", "user-approved", "previous-workflow", "selected-run"]),
  confidence: z.number().min(0).max(1),
});
export type PerformanceBaseline = z.infer<typeof PerformanceBaselineSchema>;

export const PerformanceAnalysisSchema = z.object({
  id: z.string().min(1).max(500),
  workflowId: z.string().max(500).optional(),
  changeSetId: z.string().max(500).optional(),
  scope: z.object({
    rootEntityIds: z.array(z.string().min(1)).max(2000).default([]),
    flowIds: z.array(z.string().min(1)).max(2000).default([]),
    planned: z.boolean().default(false),
  }),
  criticalPaths: z.array(PerformancePathSchema).max(500).default([]),
  databaseInteractions: z.array(DatabaseInteractionSchema).max(1000).default([]),
  externalCalls: z.array(ExternalCallInteractionSchema).max(1000).default([]),
  loopAndFanoutFindings: z.array(PerformanceFindingSchema).max(1000).default([]),
  blockingFindings: z.array(PerformanceFindingSchema).max(1000).default([]),
  allocationFindings: z.array(PerformanceFindingSchema).max(1000).default([]),
  runtimeEvidence: z.array(PerformanceRuntimeEvidenceSchema).max(1000).default([]),
  findings: z.array(PerformanceFindingSchema).max(2000).default([]),
  risk: z.object({
    level: RiskLevelSchema,
    score: z.number().min(0).max(1),
    factors: z.array(PerformanceRiskFactorSchema).max(100).default([]),
  }),
  warnings: z.array(PerformanceWarningSchema).max(100).default([]),
  metadata: z.object({
    intelligenceRevision: z.string().min(1),
    generatedAt: z.string().min(1),
    contentHash: z.string().min(1),
    status: AnalysisStatusSchema,
  }),
});
export type PerformanceAnalysis = z.infer<typeof PerformanceAnalysisSchema>;

// ---------------------------------------------------------------------------
// Gate decisions, risk acceptance, remediation link, freshness (spec §22, §37, §39, §47, §49)
// ---------------------------------------------------------------------------

export const GateEvaluationSchema = z.object({
  id: z.string().min(1).max(500),
  analysisId: z.string().min(1).max(500),
  kind: z.enum(["security", "performance"]),
  rule: z.string().min(1).max(200),
  passed: z.boolean(),
  blocking: z.boolean().default(false),
  evidence: z.array(z.string().min(1).max(2000)).max(50).default([]),
  remediationAction: z.string().max(2000).optional(),
  evaluatedAt: z.string().min(1),
});
export type GateEvaluation = z.infer<typeof GateEvaluationSchema>;

export const RiskAcceptanceSchema = z.object({
  id: z.string().min(1).max(500),
  findingId: z.string().min(1).max(500),
  reason: z.string().min(1).max(2000),
  approvedBy: z.string().min(1).max(200),
  scope: z.string().min(1).max(2000),
  expiry: z.string().max(200).optional(),
  reviewNote: z.string().max(2000).optional(),
  acceptedAt: z.string().min(1),
});
export type RiskAcceptance = z.infer<typeof RiskAcceptanceSchema>;

export const FindingRemediationLinkSchema = z.object({
  findingId: z.string().min(1).max(500),
  remediationRequestId: z.string().min(1).max(500),
  targetStage: z.enum([
    "development",
    "test-generation",
    "security-validation",
    "performance-validation",
  ]),
  allowedScope: z.array(z.string().min(1).max(2000)).max(500).default([]),
  executionProfileId: z.string().max(500).optional(),
});
export type FindingRemediationLink = z.infer<typeof FindingRemediationLinkSchema>;

export const AnalysisFreshnessSchema = z.object({
  analysisId: z.string().min(1).max(500),
  fresh: z.boolean(),
  reasons: z.array(z.string().min(1).max(2000)).max(50).default([]),
  lastEvaluatedAt: z.string().min(1),
});
export type AnalysisFreshness = z.infer<typeof AnalysisFreshnessSchema>;

// ---------------------------------------------------------------------------
// Error model (spec §53)
// ---------------------------------------------------------------------------

export const SecurityPerformanceErrorCodeSchema = z.enum([
  "attack-surface-unavailable",
  "trust-boundary-unresolved",
  "auth-path-incomplete",
  "authorization-path-incomplete",
  "sensitive-data-classification-ambiguous",
  "source-sink-path-truncated",
  "secret-redacted",
  "dependency-advisory-unavailable",
  "security-command-unavailable",
  "security-validation-failed",
  "security-analysis-stale",
  "critical-path-unavailable",
  "database-interaction-unresolved",
  "external-call-unresolved",
  "runtime-evidence-unavailable",
  "baseline-unavailable",
  "baseline-incompatible",
  "benchmark-command-unavailable",
  "benchmark-failed",
  "comparison-insufficient",
  "performance-analysis-stale",
  "approval-required",
  "execution-cancelled",
  "execution-timeout",
  "result-parser-failed",
  "finding-superseded",
  "internal-error",
]);
export type SecurityPerformanceErrorCode = z.infer<typeof SecurityPerformanceErrorCodeSchema>;

export const SecurityPerformanceErrorSchema = z.object({
  code: SecurityPerformanceErrorCodeSchema,
  message: z.string().min(1).max(2000),
  affectedRecord: z.string().max(500).optional(),
  recoverable: z.boolean(),
  suggestedAction: z.string().min(1).max(2000),
  technicalDetails: z.string().max(5000).optional(),
});
export type SecurityPerformanceError = z.infer<typeof SecurityPerformanceErrorSchema>;
