import { z } from "zod";
import { RepositoryStateRefSchema, StalenessRecordSchema } from "./integration";

export const DELEGATION_SCHEMA_VERSION = 1 as const;

export const AgentCapabilitySchema = z.enum([
  "repository-exploration",
  "planning",
  "specification-refinement",
  "implementation",
  "refactoring",
  "testing",
  "debugging",
  "security-review",
  "performance-review",
  "documentation",
  "code-review",
  "migration",
  "infrastructure",
]);
export type AgentCapability = z.infer<typeof AgentCapabilitySchema>;

export const DelegationTaskCategorySchema = z.enum([
  "feature",
  "bug-fix",
  "refactoring",
  "testing",
  "investigation",
  "modernization",
  "performance",
  "security",
  "documentation",
  "review",
  "maintenance",
  "migration",
  "infrastructure",
  "implementation",
  "validation",
  "manual",
]);
export type DelegationTaskCategory = z.infer<typeof DelegationTaskCategorySchema>;

export const DevelopmentWorkTypeSchema = z.enum([
  "feature",
  "bug",
  "refactor",
  "test",
  "modernization",
  "investigation",
]);
export type DevelopmentWorkType = z.infer<typeof DevelopmentWorkTypeSchema>;
export const RepositoryScopeSelectionSchema = z
  .object({
    kind: z.enum(["repository", "current-file", "paths"]),
    paths: z.array(z.string().min(1).max(1024)).max(100).default([]),
  })
  .strict();
export type RepositoryScopeSelection = z.infer<typeof RepositoryScopeSelectionSchema>;

export const CopilotCapabilityDiagnosticSchema = z
  .object({
    code: z.string().min(1).max(100),
    severity: z.enum(["info", "warning", "error"]),
    message: z.string().min(1).max(1000),
    evidence: z.string().max(1000).optional(),
  })
  .strict();
export type CopilotCapabilityDiagnostic = z.infer<typeof CopilotCapabilityDiagnosticSchema>;

export const CopilotCapabilitiesSchema = z
  .object({
    schemaVersion: z.literal(DELEGATION_SCHEMA_VERSION),
    detectedAt: z.string().datetime(),
    extensionDetected: z.boolean(),
    extensionVersions: z.record(z.string(), z.string()),
    chatAvailable: z.boolean(),
    agentModeAvailable: z.boolean(),
    agentDiscoveryAvailable: z.boolean(),
    directInvocationAvailable: z.boolean(),
    promptInsertionAvailable: z.boolean(),
    completionEventsAvailable: z.boolean(),
    resultCaptureAvailable: z.boolean(),
    supportedInvocationMethods: z.array(z.string().max(100)).max(20),
    diagnostics: z.array(CopilotCapabilityDiagnosticSchema).max(50),
    fingerprint: z.string().min(1).max(256),
    discoveryDurationMs: z.number().nonnegative(),
  })
  .strict();
export type CopilotCapabilities = z.infer<typeof CopilotCapabilitiesSchema>;

export const AgentEvidenceSchema = z
  .object({
    kind: z.enum(["runtime", "extension", "configuration", "profile", "alias", "rule"]),
    source: z.string().min(1).max(500),
    statement: z.string().min(1).max(1000),
  })
  .strict();

export const AgentRestrictionSchema = z
  .object({
    kind: z.enum(["capability", "context", "invocation", "repository", "policy"]),
    description: z.string().min(1).max(1000),
    blocking: z.boolean(),
  })
  .strict();

export const CopilotAgentDescriptorSchema = z
  .object({
    id: z.string().min(1).max(200),
    displayName: z.string().min(1).max(200),
    description: z.string().max(1000).optional(),
    source: z.enum([
      "copilot-discovered",
      "workspace-configured",
      "repository-configured",
      "keystone-profile",
      "user-alias",
    ]),
    availability: z.enum(["available", "unavailable", "unknown"]),
    capabilities: z.array(AgentCapabilitySchema).max(30),
    taskCategories: z.array(DelegationTaskCategorySchema).max(30),
    invocationMethod: z.string().max(100).optional(),
    restrictions: z.array(AgentRestrictionSchema).max(50),
    confidence: z.number().min(0).max(1),
    evidence: z.array(AgentEvidenceSchema).max(50),
    aliasFor: z.string().max(200).optional(),
  })
  .strict();
export type CopilotAgentDescriptor = z.infer<typeof CopilotAgentDescriptorSchema>;

const TraceReferenceSchema = z
  .object({
    entityId: z.string().min(1).max(500),
    name: z.string().min(1).max(500),
    type: z.string().min(1).max(200),
    relativePath: z.string().max(1024).optional(),
    reason: z.string().min(1).max(1000),
    confidence: z.number().min(0).max(1),
    evidenceIds: z.array(z.string().max(500)).max(50),
  })
  .strict();

export const DevelopmentIntentSchema = z
  .object({
    id: z.string().uuid(),
    workflowId: z.string().uuid(),
    revision: z.number().int().positive(),
    originalText: z.string().min(1).max(50_000),
    normalizedObjective: z.string().min(1).max(5000),
    mode: z.enum(["quick", "guided", "spec-driven"]),
    category: DelegationTaskCategorySchema,
    expectedOutcome: z.string().min(1).max(5000),
    risk: z.enum(["low", "medium", "high", "critical"]),
    constraints: z
      .array(
        z
          .object({
            description: z.string().max(2000),
            provenance: z.enum(["user", "repository", "keystone-policy"]),
          })
          .strict(),
      )
      .max(100),
    ambiguities: z
      .array(
        z
          .object({
            question: z.string().max(2000),
            impact: z.string().max(2000),
            blocking: z.boolean(),
          })
          .strict(),
      )
      .max(50),
    requiredDecisions: z
      .array(
        z
          .object({
            id: z.string().uuid(),
            question: z.string().max(2000),
            blocking: z.boolean(),
            resolution: z.string().max(5000).optional(),
          })
          .strict(),
      )
      .max(50),
    affectedEntities: z.array(TraceReferenceSchema).max(100),
    intelligenceGeneration: z.number().int().nonnegative(),
    branch: z.string().max(500).optional(),
    createdAt: z.string().datetime(),
    updatedAt: z.string().datetime().optional(),
  })
  .extend({
    workType: DevelopmentWorkTypeSchema.optional(),
    repositoryScope: RepositoryScopeSelectionSchema.optional(),
  })
  .strict();
export type DevelopmentIntent = z.infer<typeof DevelopmentIntentSchema>;

const CriterionSchema = z
  .object({
    id: z.string().min(1).max(200),
    description: z.string().min(1).max(5000),
    required: z.boolean(),
    requirementIds: z.array(z.string().max(200)).max(50),
    validationMethod: z.string().min(1).max(2000),
    expectedEvidence: z.string().min(1).max(2000),
    coveringTaskIds: z.array(z.string().uuid()).max(100),
    category: z
      .enum([
        "behavior",
        "error-handling",
        "compatibility",
        "test",
        "security",
        "performance",
        "documentation",
        "manual-verification",
      ])
      .optional(),
    blocking: z.boolean().optional(),
    relatedEntityIds: z.array(z.string().max(500)).max(100).optional(),
  })
  .strict();

export const DevelopmentSpecificationSchema = z
  .object({
    id: z.string().uuid(),
    workflowId: z.string().uuid(),
    revision: z.number().int().positive(),
    status: z.enum(["draft", "awaiting-review", "approved", "stale", "cancelled"]),
    title: z.string().min(1).max(500),
    repositoryId: z.string().min(1).max(1000),
    branch: z.string().max(500).optional(),
    baseCommit: z.string().max(500).optional(),
    intelligenceGeneration: z.number().int().nonnegative(),
    objective: z.string().min(1).max(5000),
    scope: z
      .object({
        included: z.array(z.string().max(5000)).max(100),
        excluded: z.array(z.string().max(5000)).max(100),
        expectedFiles: z.array(z.string().max(1024)).max(200),
        entityIds: z.array(z.string().max(500)).max(200),
      })
      .strict(),
    requirements: z
      .array(
        z
          .object({ id: z.string().min(1).max(200), description: z.string().min(1).max(5000) })
          .strict(),
      )
      .min(1)
      .max(200),
    constraints: z.array(z.string().max(5000)).max(200),
    acceptanceCriteria: z.array(CriterionSchema).min(1).max(200),
    testStrategy: z
      .object({
        existingTests: z.array(z.string().max(1024)).max(200),
        requiredTests: z.array(z.string().max(5000)).max(200),
        validationCommands: z.array(z.string().max(1000)).max(100),
        manualScenarios: z.array(z.string().max(5000)).max(100),
        risks: z.array(z.string().max(5000)).max(100),
      })
      .strict(),
    decisions: z
      .array(
        z
          .object({
            id: z.string().uuid(),
            question: z.string().max(2000),
            resolution: z.string().max(5000).optional(),
            blocking: z.boolean(),
          })
          .strict(),
      )
      .max(100),
    evidence: z.array(TraceReferenceSchema).max(200),
    approval: z
      .object({
        approvedAt: z.string().datetime(),
        approvedBy: z.literal("user"),
        revision: z.number().int().positive(),
        rationale: z.string().max(2000).optional(),
      })
      .strict()
      .optional(),
    sections: z
      .object({
        currentBehavior: z.string().max(10_000),
        requiredBehavior: z.string().max(10_000),
        errorBehavior: z.string().max(10_000),
        compatibility: z.string().max(10_000),
        security: z.string().max(10_000),
        performance: z.string().max(10_000),
        assumptions: z.array(z.string().max(5000)).max(100),
        openQuestions: z.array(z.string().max(5000)).max(100),
      })
      .strict()
      .optional(),
    modifiedSections: z.array(z.string().max(100)).max(50).optional(),
    sectionSources: z
      .record(z.string(), z.enum(["generated", "user", "repository", "unknown"]))
      .optional(),
    createdAt: z.string().datetime(),
    updatedAt: z.string().datetime(),
  })
  .strict();
export type DevelopmentSpecification = z.infer<typeof DevelopmentSpecificationSchema>;

export const DevelopmentTaskSchema = z
  .object({
    id: z.string().uuid(),
    workflowId: z.string().uuid(),
    specificationId: z.string().uuid(),
    specificationRevision: z.number().int().positive(),
    title: z.string().min(1).max(500),
    objective: z.string().min(1).max(5000),
    description: z.string().min(1).max(10_000),
    category: DelegationTaskCategorySchema,
    status: z.enum([
      "pending",
      "ready",
      "delegating",
      "awaiting-external-start",
      "executing",
      "completed",
      "blocked",
      "cancelled",
      "stale",
    ]),
    dependencies: z.array(z.string().uuid()).max(100),
    requirementIds: z.array(z.string().max(200)).min(1).max(100),
    acceptanceCriterionIds: z.array(z.string().max(200)).min(1).max(100),
    expectedFiles: z.array(z.string().max(1024)).max(200),
    expectedEntityIds: z.array(z.string().max(500)).max(200),
    validationSteps: z
      .array(
        z
          .object({
            command: z.string().max(1000).optional(),
            manualCheck: z.string().max(5000).optional(),
          })
          .strict(),
      )
      .min(1)
      .max(100),
    assignedAgentId: z.string().max(200).optional(),
    requiredCapabilities: z.array(AgentCapabilitySchema).max(30),
    executionRoute: z.enum(["deterministic", "github-copilot", "manual", "unsupported"]).optional(),
    risk: z.enum(["low", "medium", "high", "critical"]).optional(),
    optional: z.boolean().optional(),
    staleReasons: z.array(z.string().max(1000)).max(50),
    baseEntityFingerprints: z.record(z.string(), z.string()),
    createdAt: z.string().datetime(),
    updatedAt: z.string().datetime(),
  })
  .strict();
export type DevelopmentTask = z.infer<typeof DevelopmentTaskSchema>;

export const TaskActionDescriptorSchema = z
  .object({
    id: z.enum(["hand-off"]),
    label: z.literal("Hand off"),
    eligible: z.boolean(),
    reason: z.string().min(1).max(1000),
  })
  .strict();
export type TaskActionDescriptor = z.infer<typeof TaskActionDescriptorSchema>;

export const DevelopmentTaskGraphSchema = z
  .object({
    id: z.string().uuid(),
    workflowId: z.string().uuid(),
    specificationId: z.string().uuid(),
    specificationRevision: z.number().int().positive(),
    revision: z.number().int().positive(),
    taskIds: z.array(z.string().uuid()).max(500),
    topologicalOrder: z.array(z.string().uuid()).max(500),
    ready: z.boolean(),
    status: z.enum(["draft", "approved", "stale"]).optional(),
    diagnostics: z.array(z.string().max(1000)).max(100),
    approval: z
      .object({
        approvedAt: z.string().datetime(),
        approvedBy: z.literal("user"),
        revision: z.number().int().positive(),
      })
      .strict()
      .optional(),
    createdAt: z.string().datetime(),
  })
  .strict();

export const WorkflowClarificationSchema = z
  .object({
    id: z.string().uuid(),
    workflowId: z.string().uuid(),
    question: z.string().min(1).max(2000),
    whyItMatters: z.string().min(1).max(2000),
    evidenceReferences: z.array(z.string().max(500)).max(100),
    options: z.array(z.string().max(1000)).max(20),
    answer: z.string().max(5000).optional(),
    status: z.enum(["open", "answered", "deferred", "not-applicable"]),
    blocking: z.boolean(),
    createdAt: z.string().datetime(),
    updatedAt: z.string().datetime(),
  })
  .strict();
export type WorkflowClarification = z.infer<typeof WorkflowClarificationSchema>;
export const WorkflowDecisionRecordSchema = z
  .object({
    id: z.string().uuid(),
    workflowId: z.string().uuid(),
    sourceClarificationId: z.string().uuid().optional(),
    title: z.string().min(1).max(500),
    decision: z.string().min(1).max(5000),
    rationale: z.string().max(5000).optional(),
    evidenceReferences: z.array(z.string().max(500)).max(100),
    createdAt: z.string().datetime(),
    updatedAt: z.string().datetime(),
  })
  .strict();
export type WorkflowDecisionRecord = z.infer<typeof WorkflowDecisionRecordSchema>;

export const DevelopmentWorkflowSnapshotSchema = z
  .object({
    schemaVersion: z.literal(DELEGATION_SCHEMA_VERSION),
    id: z.string().uuid(),
    revision: z.number().int().nonnegative(),
    repositoryId: z.string().min(1).max(1000),
    branch: z.string().max(500).optional(),
    headCommit: z.string().max(500).optional(),
    intelligenceGeneration: z.number().int().nonnegative(),
    intent: DevelopmentIntentSchema,
    repositoryState: RepositoryStateRefSchema.optional(),
    intentHistory: z.array(DevelopmentIntentSchema).max(100).default([]),
    clarifications: z.array(WorkflowClarificationSchema).max(100).default([]),
    decisions: z.array(WorkflowDecisionRecordSchema).max(200).default([]),
    specification: DevelopmentSpecificationSchema.optional(),
    specificationHistory: z.array(DevelopmentSpecificationSchema).max(100),
    taskGraphHistory: z.array(DevelopmentTaskGraphSchema).max(100).default([]),
    taskGraph: DevelopmentTaskGraphSchema.optional(),
    tasks: z.array(DevelopmentTaskSchema).max(500),
    status: z.enum(["capturing", "awaiting-spec-review", "planned", "stale", "cancelled"]),
    createdAt: z.string().datetime(),
    updatedAt: z.string().datetime(),
  })
  .strict();
export type DevelopmentWorkflowSnapshot = z.infer<typeof DevelopmentWorkflowSnapshotSchema>;

export const ContextBudgetSchema = z
  .object({
    maxEstimatedTokens: z.number().int().min(500).max(1_000_000).default(12_000),
    maxCharacters: z.number().int().min(2000).max(4_000_000).default(48_000),
    maxFiles: z.number().int().min(1).max(200).default(30),
    maxSourceFragments: z.number().int().min(1).max(500).default(60),
    maxGraphPaths: z.number().int().min(0).max(50).default(10),
    maxTestMappings: z.number().int().min(0).max(200).default(30),
  })
  .strict();
export type ContextBudget = z.infer<typeof ContextBudgetSchema>;

export const ContextItemSchema = z
  .object({
    id: z.string().min(1).max(500),
    kind: z.enum([
      "objective",
      "requirement",
      "acceptance-criterion",
      "constraint",
      "decision",
      "file",
      "symbol",
      "source-range",
      "signature",
      "graph-path",
      "flow",
      "test",
      "configuration",
      "data",
      "build-command",
      "change",
      "limitation",
    ]),
    tier: z.enum(["required", "supporting", "optional"]),
    title: z.string().min(1).max(1000),
    content: z.string().max(20_000),
    sourceEntityId: z.string().max(500).optional(),
    relativePath: z.string().max(1024).optional(),
    reason: z.string().min(1).max(2000),
    relationshipToTask: z.string().max(1000),
    evidenceIds: z.array(z.string().max(500)).max(50),
    confidence: z.number().min(0).max(1),
    estimatedCharacters: z.number().int().nonnegative(),
    estimatedTokens: z.number().int().nonnegative(),
    freshness: z.enum(["current", "stale", "unknown"]),
    priority: z.number(),
    pinned: z.boolean(),
    required: z.boolean(),
    included: z.boolean(),
    compression: z.string().max(200),
  })
  .strict();
export type ContextItem = z.infer<typeof ContextItemSchema>;

export const ExcludedContextItemSchema = z
  .object({
    item: ContextItemSchema,
    reason: z.enum([
      "over-budget",
      "duplicate",
      "optional-removed",
      "secret",
      "sensitive",
      "excluded",
      "stale",
      "unsupported",
      "user-removed",
    ]),
    restorable: z.boolean(),
  })
  .strict();

export const TaskContextPackageSchema = z
  .object({
    schemaVersion: z.literal(DELEGATION_SCHEMA_VERSION),
    id: z.string().uuid(),
    taskId: z.string().uuid(),
    specificationId: z.string().uuid(),
    specificationRevision: z.number().int().positive(),
    repositoryState: RepositoryStateRefSchema.optional(),
    staleness: z.array(StalenessRecordSchema).max(100).default([]),
    repositoryId: z.string().min(1).max(1000),
    branch: z.string().max(500),
    baseCommit: z.string().max(500),
    intelligenceGeneration: z.number().int().nonnegative(),
    selectedAgentId: z.string().max(200).optional(),
    objective: z.string().min(1).max(5000),
    requirements: z.array(z.string().max(5000)).max(200),
    acceptanceCriteria: z.array(z.string().max(5000)).max(200),
    constraints: z.array(z.string().max(5000)).max(200),
    items: z.array(ContextItemSchema).max(500),
    exclusions: z.array(ExcludedContextItemSchema).max(500),
    budget: ContextBudgetSchema,
    estimatedTokens: z.number().int().nonnegative(),
    estimatedCharacters: z.number().int().nonnegative(),
    completeness: z.enum(["complete", "partial", "blocked"]),
    diagnostics: z
      .array(
        z
          .object({
            code: z.string().max(100),
            severity: z.enum(["info", "warning", "error"]),
            message: z.string().max(2000),
          })
          .strict(),
      )
      .max(100),
    reviewed: z.boolean(),
    createdAt: z.string().datetime(),
    contentFingerprint: z.string().min(1).max(256),
    sourceFingerprint: z.string().min(1).max(256),
    metrics: z
      .object({
        buildDurationMs: z.number().nonnegative(),
        candidateCount: z.number().int().nonnegative(),
        includedCount: z.number().int().nonnegative(),
        excludedCount: z.number().int().nonnegative(),
        compressionRatioEstimate: z.number().min(0).max(1),
        cacheReuse: z.boolean(),
      })
      .strict(),
  })
  .strict();
export type TaskContextPackage = z.infer<typeof TaskContextPackageSchema>;

export const AgentRecommendationSchema = z
  .object({
    taskId: z.string().uuid(),
    candidates: z
      .array(
        z
          .object({
            agent: CopilotAgentDescriptorSchema,
            rank: z.number().int().positive(),
            score: z.number(),
            matchingCapabilities: z.array(AgentCapabilitySchema),
            missingCapabilities: z.array(AgentCapabilitySchema),
            restrictions: z.array(AgentRestrictionSchema),
            reasons: z.array(z.string().max(1000)).max(30),
          })
          .strict(),
      )
      .max(50),
    selectedAgentId: z.string().max(200).optional(),
    selectionMode: z.enum(["manual", "recommended", "rule-based", "fixed-workflow"]),
  })
  .strict();
export type AgentRecommendation = z.infer<typeof AgentRecommendationSchema>;

export const TaskEligibilitySchema = z
  .object({
    taskId: z.string().uuid(),
    eligible: z.boolean(),
    checkedAt: z.string().datetime(),
    reasons: z
      .array(
        z
          .object({
            code: z.string().max(100),
            message: z.string().max(2000),
            blocking: z.boolean(),
          })
          .strict(),
      )
      .max(100),
  })
  .strict();
export type TaskEligibility = z.infer<typeof TaskEligibilitySchema>;

export const RepositoryBaselineSchema = z
  .object({
    repositoryId: z.string().max(1000).default("unknown"),
    intelligenceGeneration: z.number().int().nonnegative().default(0),
    branch: z.string().max(500),
    headCommit: z.string().max(500),
    dirtyFiles: z.array(z.string().max(1024)).max(5000),
    stagedFiles: z.array(z.string().max(1024)).max(5000),
    untrackedFiles: z.array(z.string().max(1024)).max(5000),
    expectedFiles: z.array(z.string().max(1024)).max(500),
    fileHashes: z.record(z.string().max(1024), z.string().max(500)).default({}),
    entityFingerprints: z.record(z.string(), z.string()),
    diagnosticFingerprints: z.array(z.string().max(1000)).max(1000).default([]),
    knownValidationOutcomes: z
      .array(
        z
          .object({
            commandFingerprint: z.string().max(2000),
            status: z.enum(["passed", "failed"]),
            failureFingerprint: z.string().max(500).optional(),
          })
          .strict(),
      )
      .max(200)
      .default([]),
    capturedAt: z.string().datetime(),
  })
  .strict()
  .superRefine((value, context) => {
    if (Object.keys(value.fileHashes).length > 5000)
      context.addIssue({
        code: "custom",
        message: "Repository baseline file hashes exceed the 5,000-item limit.",
        path: ["fileHashes"],
      });
    if (Object.keys(value.entityFingerprints).length > 1000)
      context.addIssue({
        code: "custom",
        message: "Repository baseline entity fingerprints exceed the 1,000-item limit.",
        path: ["entityFingerprints"],
      });
  });
export type RepositoryBaseline = z.infer<typeof RepositoryBaselineSchema>;

export const DelegationStatusSchema = z.enum([
  "not-ready",
  "awaiting-agent",
  "preparing-context",
  "awaiting-context-review",
  "ready-to-delegate",
  "delegating",
  "awaiting-external-start",
  "executing",
  "awaiting-user-confirmation",
  "result-detected",
  "validating-later",
  "completed-later",
  "blocked",
  "failed",
  "cancelled",
  "stale",
]);
export type DelegationStatus = z.infer<typeof DelegationStatusSchema>;

export const DelegationSessionSchema = z
  .object({
    schemaVersion: z.literal(DELEGATION_SCHEMA_VERSION),
    id: z.string().uuid(),
    taskId: z.string().uuid(),
    specificationId: z.string().uuid(),
    specificationRevision: z.number().int().positive(),
    repositoryState: RepositoryStateRefSchema.optional(),
    staleness: z.array(StalenessRecordSchema).max(100).default([]),
    agentId: z.string().min(1).max(200),
    agentSnapshot: CopilotAgentDescriptorSchema,
    contextPackageId: z.string().uuid(),
    contextFingerprint: z.string().min(1).max(256),
    promptFingerprint: z.string().min(1).max(256),
    mode: z.enum(["direct", "assisted", "clipboard"]),
    status: DelegationStatusSchema,
    approvedAt: z.string().datetime(),
    startedAt: z.string().datetime().optional(),
    updatedAt: z.string().datetime(),
    repositoryStateAtDelegation: RepositoryBaselineSchema,
    expectedFiles: z.array(z.string().max(1024)).max(500),
    diagnostics: z
      .array(
        z
          .object({
            code: z.string().max(100),
            severity: z.enum(["info", "warning", "error"]),
            message: z.string().max(2000),
          })
          .strict(),
      )
      .max(100),
    changes: z
      .array(
        z
          .object({
            relativePath: z.string().max(1024),
            classification: z.enum([
              "expected",
              "related",
              "unexpected",
              "pre-existing",
              "ambiguous",
            ]),
            reason: z.string().max(2000),
          })
          .strict(),
      )
      .max(5000),
    externalHandle: z.string().max(1000).optional(),
  })
  .strict();
export type DelegationSession = z.infer<typeof DelegationSessionSchema>;

export const PreparedDelegationSchema = z
  .object({
    taskId: z.string().uuid(),
    agentId: z.string().min(1),
    contextPackageId: z.string().uuid(),
    contextFingerprint: z.string().min(1),
    prompt: z.string().min(1).max(200_000),
    promptFingerprint: z.string().min(1),
    approved: z.boolean(),
    userSections: z.record(z.string(), z.string()),
    eligibility: TaskEligibilitySchema,
  })
  .strict();
export type PreparedDelegation = z.infer<typeof PreparedDelegationSchema>;

export const DelegationPersistentStateSchema = z
  .object({
    schemaVersion: z.literal(DELEGATION_SCHEMA_VERSION),
    revision: z.number().int().nonnegative(),
    workflows: z.array(DevelopmentWorkflowSnapshotSchema).max(100),
    capabilities: CopilotCapabilitiesSchema.optional(),
    agents: z.array(CopilotAgentDescriptorSchema).max(200),
    selections: z.record(z.string(), z.string()),
    customizationSelections: z
      .record(z.string(), z.array(z.string().max(500)).max(500))
      .default({}),
    selectedTaskByWorkflow: z.record(z.string(), z.string().uuid()).default({}),
    buildPanelByWorkflow: z
      .record(z.string(), z.enum(["task", "copilot-context", "changes-validation"]))
      .default({}),
    buildBaselines: z.record(z.string(), RepositoryBaselineSchema).default({}),
    contexts: z.array(TaskContextPackageSchema).max(200),
    prepared: z.array(PreparedDelegationSchema).max(200),
    sessions: z.array(DelegationSessionSchema).max(200),
    updatedAt: z.string().datetime(),
  })
  .strict();
export type DelegationPersistentState = z.infer<typeof DelegationPersistentStateSchema>;

export const WorkflowCapturePayloadSchema = z
  .object({
    text: z.string().min(1).max(50_000),
    mode: z.enum(["quick", "guided", "spec-driven"]),
    title: z.string().max(500).optional(),
    workType: DevelopmentWorkTypeSchema.optional(),
    repositoryScope: RepositoryScopeSelectionSchema.optional(),
  })
  .strict();
export const WorkflowIdPayloadSchema = z.object({ workflowId: z.string().uuid() }).strict();
export const WorkflowSpecRevisePayloadSchema = z
  .object({
    workflowId: z.string().uuid(),
    reason: z.string().min(1).max(2000),
    patch: DevelopmentSpecificationSchema.pick({
      title: true,
      scope: true,
      requirements: true,
      constraints: true,
      acceptanceCriteria: true,
      testStrategy: true,
      decisions: true,
    }).partial(),
  })
  .strict();
export const WorkflowSpecApprovePayloadSchema = z
  .object({
    workflowId: z.string().uuid(),
    expectedRevision: z.number().int().positive(),
    rationale: z.string().max(2000).optional(),
  })
  .strict();
export const WorkflowDecisionPayloadSchema = z
  .object({
    workflowId: z.string().uuid(),
    decisionId: z.string().uuid(),
    resolution: z.string().min(1).max(5000),
  })
  .strict();
export const TaskIdPayloadSchema = z
  .object({ workflowId: z.string().uuid(), taskId: z.string().uuid() })
  .strict();
export const AgentRecommendationPayloadSchema = TaskIdPayloadSchema.extend({
  selectionMode: z
    .enum(["manual", "recommended", "rule-based", "fixed-workflow"])
    .default("recommended"),
}).strict();
export const AgentSelectionPayloadSchema = TaskIdPayloadSchema.extend({
  agentId: z.string().min(1).max(200),
  confirmed: z.literal(true),
}).strict();
export const ContextBuildPayloadSchema = TaskIdPayloadSchema.extend({
  budget: ContextBudgetSchema.partial().optional(),
  pinnedEntityIds: z.array(z.string().max(500)).max(100).optional(),
  pinnedFiles: z.array(z.string().max(1024)).max(100).optional(),
}).strict();
export const ContextGetPayloadSchema = z.object({ taskId: z.string().uuid() }).strict();
export const ContextItemActionPayloadSchema = z
  .object({
    taskId: z.string().uuid(),
    itemId: z.string().min(1).max(500),
    overrideRequired: z.boolean().optional(),
  })
  .strict();
export const ContextAddEntityPayloadSchema = TaskIdPayloadSchema.extend({
  entityId: z.string().min(1).max(500),
}).strict();
export const ContextAddFilePayloadSchema = TaskIdPayloadSchema.extend({
  relativePath: z.string().min(1).max(1024),
}).strict();
export const ContextBudgetPayloadSchema = TaskIdPayloadSchema.extend({
  budget: ContextBudgetSchema.partial(),
}).strict();
export const ContextValidatePayloadSchema = z
  .object({ taskId: z.string().uuid(), contentFingerprint: z.string().min(1).max(256) })
  .strict();
export const DelegationPreparePayloadSchema = TaskIdPayloadSchema.extend({
  userSections: z.record(z.string().max(100), z.string().max(20_000)).optional(),
}).strict();
export const DelegationPromptPayloadSchema = z.object({ taskId: z.string().uuid() }).strict();
export const DelegationApprovePayloadSchema = z
  .object({
    taskId: z.string().uuid(),
    promptFingerprint: z.string().min(1).max(256),
    contextFingerprint: z.string().min(1).max(256),
  })
  .strict();
export const DelegationStartPayloadSchema = TaskIdPayloadSchema.extend({
  overlapOverride: z.boolean().default(false),
}).strict();
export const DelegationSessionPayloadSchema = z
  .object({ workflowId: z.string().uuid(), sessionId: z.string().uuid() })
  .strict();
export const DelegationStatusPayloadSchema = z.object({ sessionId: z.string().uuid() }).strict();

export const WorkflowEventPayloadSchema = z
  .object({
    workflowId: z.string().uuid(),
    revision: z.number().int().nonnegative(),
    status: z.string().max(100),
    message: z.string().max(2000).optional(),
  })
  .strict();
export const CapabilityEventPayloadSchema = z
  .object({ fingerprint: z.string().min(1), capabilities: CopilotCapabilitiesSchema })
  .strict();
export const AgentsEventPayloadSchema = z
  .object({
    agents: z.array(CopilotAgentDescriptorSchema).max(200),
    refreshedAt: z.string().datetime(),
  })
  .strict();
export const ContextLifecycleEventSchema = z
  .object({
    taskId: z.string().uuid(),
    contextPackageId: z.string().uuid().optional(),
    progress: z.number().min(0).max(100).optional(),
    message: z.string().max(2000),
    fingerprint: z.string().max(256).optional(),
  })
  .strict();
export const DelegationLifecycleEventSchema = z
  .object({
    taskId: z.string().uuid(),
    sessionId: z.string().uuid().optional(),
    status: DelegationStatusSchema,
    message: z.string().max(2000),
  })
  .strict();
