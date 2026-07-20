import { z } from "zod";
import { IntelligenceStatusSchema } from "./intelligence";

export const SCHEMA_VERSION = 1 as const;

// Shared envelope fields for message schemas
export const envelopeFields = {
  requestId: z.string().uuid(),
  timestamp: z.string().datetime(),
  schemaVersion: z.literal(SCHEMA_VERSION)
};

export const hostEnvelopeFields = {
  eventId: z.string().uuid(),
  timestamp: z.string().datetime(),
  schemaVersion: z.literal(SCHEMA_VERSION)
};

export const NavigationSectionSchema = z.enum([
  "home",
  "active-work",
  "intelligence",
  "history",
  "settings",
  // Legacy sections preserved for backward compatibility
  "intent",
  "specifications",
  "tasks",
  "context",
  "orchestration",
  "validation",
  "delivery",
  "team",
  "diagnostics",
  "workbench",
]);

export type NavigationSection = z.infer<typeof NavigationSectionSchema>;

export const WorkbenchStageSchema = z.enum(["define", "plan", "build", "validate", "review", "complete"]);
export type WorkbenchStage = z.infer<typeof WorkbenchStageSchema>;

export const AppRouteSchema = z.string().min(1).max(1024).refine((value) =>
  value === "/" || value === "/intelligence" || value === "/history" || value === "/workbench/new" || value === "/support/diagnostics" || value === "/settings" || /^\/workbench\/[0-9a-f-]+\/(define|plan|build|validate|review|complete)$/.test(value),
"Unsupported Keystone route.");
export type AppRoute = z.infer<typeof AppRouteSchema>;

export const NAVIGATION_SECTIONS: readonly NavigationSection[] = NavigationSectionSchema.options;

export const ActivitySchema = z.object({
  operation: z.string().min(1),
  detail: z.string(),
  status: z.enum(["idle", "running", "waiting", "completed", "warning", "failed"]),
  progress: z.number().min(0).max(100).optional(),
  cancellable: z.boolean(),
  updatedAt: z.string().datetime()
});

export type Activity = z.infer<typeof ActivitySchema>;

export const WorkspaceSummarySchema = z.object({
  name: z.string().min(1),
  rootCount: z.number().int().nonnegative(),
  trust: z.enum(["trusted", "restricted"]),
  indexStatus: IntelligenceStatusSchema
});

export type WorkspaceSummary = z.infer<typeof WorkspaceSummarySchema>;

export const PersistedFoundationStateSchema = z.object({
  schemaVersion: z.literal(SCHEMA_VERSION),
  revision: z.number().int().nonnegative(),
  activeSection: NavigationSectionSchema,
  activeRoute: AppRouteSchema,
  workflowCount: z.number().int().nonnegative(),
  updatedAt: z.string().datetime()
});

export type PersistedFoundationState = z.infer<typeof PersistedFoundationStateSchema>;

export const BootstrapSnapshotSchema = z.object({
  extensionVersion: z.string(),
  workspace: WorkspaceSummarySchema,
  state: PersistedFoundationStateSchema,
  activity: ActivitySchema,
  implementation: z.object({
    phase: z.number().int().nonnegative(),
    phaseName: z.string(),
    completedTasks: z.array(z.string()),
    nextTask: z.string()
  })
});

export type BootstrapSnapshot = z.infer<typeof BootstrapSnapshotSchema>;

// ============================================================================
// Repository Intelligence Domain Types (Phase 2)
// ============================================================================

export type IndexStatus =
  | "idle"
  | "scanning"
  | "extracting-symbols"
  | "building-relationships"
  | "ready"
  | "partial"
  | "cancelled"
  | "failed"
  | "stale";

export type FileCategory =
  | "source"
  | "test"
  | "config"
  | "manifest"
  | "documentation"
  | "other";

export type SymbolKind =
  | "function"
  | "method"
  | "class"
  | "interface"
  | "variable"
  | "constant"
  | "enum"
  | "type"
  | "module"
  | "namespace"
  | "property"
  | "parameter";

export type RelationshipKind =
  | "imports"
  | "exports"
  | "references"
  | "calls"
  | "inherits"
  | "implements"
  | "routes-to"
  | "tests"
  | "configures"
  | "depends-on";

export type ContextItemKind =
  | "objective"
  | "specification-section"
  | "criterion"
  | "convention"
  | "symbol-summary"
  | "code-range"
  | "file"
  | "dependency-interface"
  | "related-test"
  | "configuration"
  | "prior-task-output"
  | "constraint"
  | "validation-command";

export type AgentAvailability = "available" | "configured" | "unavailable" | "unknown";

export type AgentTaskCategory =
  | "implementation"
  | "testing"
  | "review"
  | "refactoring"
  | "documentation"
  | "debugging"
  | "architecture"
  | "security"
  | "performance";

export type TaskStatus =
  | "pending"
  | "ready"
  | "awaiting_approval"
  | "delegating"
  | "executing"
  | "awaiting_user"
  | "validating"
  | "passed"
  | "failed"
  | "skipped"
  | "cancelled"
  | "blocked";

export type WorkflowStatus =
  | "drafting"
  | "awaiting-spec-approval"
  | "planned"
  | "executing"
  | "awaiting-user"
  | "blocked"
  | "validating"
  | "completed"
  | "cancelled";

export type SpecificationStatus =
  | "draft"
  | "awaiting_review"
  | "approved"
  | "in_progress"
  | "blocked"
  | "validation"
  | "completed"
  | "cancelled"
  | "superseded";

export type CriterionResult =
  | "unverified"
  | "passed"
  | "failed"
  | "requires-user-review"
  | "overridden";

export type ValidationCheckStatus =
  | "passed"
  | "warning"
  | "failed"
  | "not-executed"
  | "requires-user-review";

export type DelegationMethod = "direct" | "assisted";

// --- Repository Identity ---

export interface RepositoryIdentity {
  id: string;
  displayName: string;
  workspaceRoots: string[];
  gitRoot?: string;
  branch?: string;
  headCommit?: string;
}

// --- File Record ---

export interface FileRecord {
  id: string;
  workspaceRootId: string;
  relativePath: string;
  language: string;
  category: FileCategory;
  byteSize: number;
  modificationTime: string;
  fingerprint: string;
  isGenerated: boolean;
  isBinary: boolean;
  isSecret: boolean;
  isExcluded: boolean;
  parseSupported: boolean;
  symbolIds: string[];
  importTargets: string[];
  exportTargets: string[];
  testMappingIds: string[];
  lastIndexedAt: string;
}

// --- Symbol Record ---

export interface SymbolRecord {
  id: string;
  name: string;
  kind: SymbolKind;
  fileId: string;
  declarationRange: { startLine: number; startColumn: number; endLine: number; endColumn: number };
  isExported: boolean;
  containerId?: string;
  signature?: string;
  documentationSummary?: string;
  parserSource: string;
  confidence: number;
}

// --- Relationship ---

export interface Relationship {
  id: string;
  sourceFileId: string;
  targetFileId: string;
  sourceSymbolId?: string;
  targetSymbolId?: string;
  kind: RelationshipKind;
  confidence: number;
  evidenceLocation: string;
  extractionMethod: string;
}

// --- Project Command ---

export interface ProjectCommand {
  label: string;
  command: string;
  provenance: string;
  riskLevel: "safe" | "moderate" | "dangerous";
}

// --- Framework Signal ---

export interface FrameworkSignal {
  name: string;
  version?: string;
  confidence: number;
  evidence: string;
}

// --- Repository Index ---

export interface RepositoryIndex {
  id: string;
  repositoryId: string;
  branchKey: string;
  status: IndexStatus;
  startedAt?: string;
  completedAt?: string;
  indexVersion: number;
  fileIds: string[];
  relationshipIds: string[];
  commands: ProjectCommand[];
  frameworks: FrameworkSignal[];
  errors: { message: string; category: string }[];
}

// --- Intent Record ---

export interface IntentRecord {
  id: string;
  workflowId: string;
  revision: number;
  originalText: string;
  normalizedObjective: string;
  category: string;
  developmentMode: "quick" | "guided" | "spec-driven";
  affectedAreas: { reference: string; reason: string }[];
  expectedOutcome: string;
  constraints: { description: string; provenance: string }[];
  ambiguities: { question: string; impact: string }[];
  riskLevel: "low" | "medium" | "high" | "critical";
  recommendedWorkflow: { mode: string; approvalPolicy: boolean };
  recommendedAgents: { agentId: string; reason: string }[];
  requiredDecisions: { id: string; question: string; blocking: boolean }[];
}

// --- Specification ---

export interface KeystoneSpecification {
  id: string;
  title: string;
  status: SpecificationStatus;
  revision: number;
  workflowId: string;
  repositoryId: string;
  branch?: string;
  baseCommit?: string;
  indexVersion: number;
  intent: {
    originalRequest: string;
    normalizedIntent: string;
    businessObjective: string;
    outcome: string;
  };
  scope: {
    includedFunctionality: string[];
    excludedFunctionality: string[];
    modules: string[];
    expectedFiles: string[];
    dependencies: string[];
  };
  existingBehavior: {
    implementationSummary: string;
    architecture: string;
    constraints: string[];
    knownLimitations: string[];
    evidenceReferences: string[];
  };
  proposedBehavior: {
    functionalRequirements: string[];
    nonFunctionalRequirements: string[];
    userFlows: string;
    interfaces: string;
    models: string;
    errors: string;
  };
  engineeringConstraints: {
    conventions: string[];
    frameworks: string[];
    dependencies: string[];
    security: string[];
    performance: string[];
    compatibility: string[];
    protectedAreas: string[];
  };
  criteria: AcceptanceCriterion[];
  testStrategy: {
    existingTests: string[];
    newTests: string[];
    impactedSuites: string[];
    manualScenarios: string[];
    negativeScenarios: string[];
    regressionRisks: string[];
  };
  implementationPlan: {
    taskGraphId?: string;
    planRevision: number;
  };
  decisionLog: {
    questions: { id: string; question: string; status: string }[];
    decisions: { id: string; decision: string; rationale: string }[];
    assumptions: string[];
    rejectedApproaches: { id: string; approach: string; reason: string }[];
    revisions: { id: string; revision: string; summary: string }[];
  };
}

export interface SpecificationRevision {
  id: string;
  specificationId: string;
  revisionNumber: number;
  snapshot: KeystoneSpecification;
  previousRevisionId?: string;
  changedSectionPaths: string[];
  semanticChangeClass: "editorial" | "clarification" | "material";
  impactedTaskIds: string[];
  author: string;
  reason: string;
  approvalRecord?: ApprovalRecord;
}

export interface ApprovalRecord {
  approvedBy: string;
  approvedAt: string;
  expectedRevision: number;
  rationale?: string;
}

export interface AcceptanceCriterion {
  id: string;
  description: string;
  required: boolean;
  sourceRequirementIds: string[];
  validationMethod: string;
  expectedEvidenceType: string;
  coveringTaskIds: string[];
  result: CriterionResult;
  evidenceReferences: string[];
  overrideDecisionId?: string;
}

// --- Task Graph ---

export interface TaskGraph {
  id: string;
  workflowId: string;
  specificationId: string;
  specificationRevision: number;
  graphRevision: number;
  taskIds: string[];
  generatedAt: string;
  generationProvenance: string;
  validationStatus: string;
  topologicalOrder: string[];
}

export interface Task {
  id: string;
  title: string;
  objective: string;
  description: string;
  status: TaskStatus;
  dependencies: string[];
  assignedAgentId?: string;
  requiredContextPolicy: {
    selectionSeeds: string[];
    budget: number;
    mandatoryItems: string[];
    excludedItems: string[];
  };
  expectedFiles: string[];
  expectedOutput: string;
  acceptanceCriterionIds: string[];
  validationSteps: { command?: string; manualCheck?: string; policyClass: string }[];
  retryHistory: string[];
  executionNotes: { timestamp: string; author: string; entry: string }[];
  baseFingerprint: {
    specRevision: number;
    indexVersion: number;
    gitBase?: string;
    contextFingerprint?: string;
  };
  attemptNumber?: number;
}

export interface TaskAttempt {
  id: string;
  attemptNumber: number;
  taskId: string;
  agentAssignmentSnapshot: {
    agentId: string;
    selectionMode: string;
    capabilityFingerprint: string;
  };
  contextPackageId: string;
  delegationMethod: DelegationMethod;
  startedAt: string;
  completedAt?: string;
  externalHandle?: string;
  state: string;
  result?: string;
  observedChanges?: { files: string[]; commits: string[] };
  userConfirmations: { action: string; timestamp: string }[];
  failure?: { error: string; recoverable: boolean };
}

// --- Agent ---

export interface AgentProfile {
  id: string;
  displayName: string;
  description: string;
  source: string;
  availability: AgentAvailability;
  supportedTaskCategories: AgentTaskCategory[];
  toolsAndActions: string[];
  repositoryAccessExpectations: string[];
  strengths: string[];
  restrictions: string[];
  defaultContextPolicy: {
    maxEstimatedTokens: number;
    includeTests: boolean;
  };
  discoveredAt: string;
  capabilityFingerprint: string;
}

export interface AgentAssignment {
  selectionMode: string;
  taskId: string;
  workflowId: string;
  agentId: string;
  recommendationCandidates: { agentId: string; reason: string }[];
  userConfirmed: boolean;
  assignedAt: string;
  capabilityFingerprint: string;
}

// --- Context ---

export interface ContextPackage {
  id: string;
  taskId: string;
  specificationRevision: number;
  repositoryIndexVersion: number;
  baseCommit?: string;
  createdAt: string;
  selectionPolicyVersion: number;
  budget: number;
  estimatedTokens: number;
  estimatedBytes: number;
  items: ContextItem[];
  excludedCandidates: { id: string; reason: string }[];
  fingerprint: string;
  reviewStatus: "unreviewed" | "reviewed" | "stale";
  reviewedAt?: string;
  delegationAttemptId?: string;
}

export interface ContextItem {
  kind: ContextItemKind;
  sourceReference: string;
  sourceFingerprint: string;
  selectionReason: string;
  rankScoreComponents: { [key: string]: number };
  compressionForm: string;
  estimatedTokens: number;
  estimatedBytes: number;
  isMandatory: boolean;
  isPinned: boolean;
  included: boolean;
  exclusionReason?: string;
}

// --- Validation ---

export interface ValidationRun {
  id: string;
  workflowId: string;
  specificationRevision: number;
  taskIds: string[];
  repositoryBaseCommit?: string;
  status: string;
  startedAt: string;
  completedAt?: string;
  checks: ValidationCheck[];
  changedFiles: string[];
  criterionResults: { criterionId: string; result: CriterionResult }[];
  driftFindings: { description: string; affectedCriteria: string[] }[];
  overrideRecords: string[];
}

export interface ValidationCheck {
  id: string;
  type: string;
  status: ValidationCheckStatus;
  command?: string;
  reviewMethod?: string;
  startedAt: string;
  completedAt?: string;
  exitCode?: number;
  outputReference?: string;
  evidenceReferences: string[];
  affectedCriteria: string[];
  retryable: boolean;
  error?: string;
}

export interface OverrideRecord {
  id: string;
  userId: string;
  timestamp: string;
  criterionId: string;
  reason: string;
  riskAcknowledgement: string;
  priorResult: CriterionResult;
  resultingStatus: CriterionResult;
}

// --- Workflow ---

export interface Workflow {
  id: string;
  repositoryId: string;
  activeIntentRevision: number;
  activeSpecificationRevision: number;
  taskGraphId?: string;
  activeTaskId?: string;
  activeAttemptId?: string;
  validationRunIds: string[];
  uiResumeRoute: string;
  activitySummary: string;
  status: WorkflowStatus;
  createdAt: string;
  updatedAt: string;
}

// ============================================================================
// Zod Schemas for Repository Intelligence
// ============================================================================

export const IndexStatusSchema = z.enum([
  "idle", "scanning", "extracting-symbols", "building-relationships",
  "ready", "partial", "cancelled", "failed", "stale"
]);

export const FileCategorySchema = z.enum([
  "source", "test", "config", "manifest", "documentation", "other"
]);

export const SymbolKindSchema = z.enum([
  "function", "method", "class", "interface", "variable", "constant",
  "enum", "type", "module", "namespace", "property", "parameter"
]);

export const RelationshipKindSchema = z.enum([
  "imports", "exports", "references", "calls", "inherits", "implements",
  "routes-to", "tests", "configures", "depends-on"
]);

export const RelationshipSchema = z.object({
  id: z.string().uuid(),
  sourceFileId: z.string(),
  targetFileId: z.string(),
  sourceSymbolId: z.string().optional(),
  targetSymbolId: z.string().optional(),
  kind: RelationshipKindSchema,
  confidence: z.number().min(0).max(1),
  evidenceLocation: z.string(),
  extractionMethod: z.string()
});

export const SymbolRecordSchema = z.object({
  id: z.string().uuid(),
  name: z.string(),
  kind: SymbolKindSchema,
  fileId: z.string(),
  declarationRange: z.object({
    startLine: z.number().int().min(0),
    startColumn: z.number().int().min(0),
    endLine: z.number().int().min(0),
    endColumn: z.number().int().min(0)
  }),
  isExported: z.boolean(),
  containerId: z.string().optional(),
  signature: z.string().optional(),
  documentationSummary: z.string().optional(),
  parserSource: z.string(),
  confidence: z.number().min(0).max(1)
});

export const FileRecordSchema = z.object({
  id: z.string().uuid(),
  workspaceRootId: z.string(),
  relativePath: z.string(),
  language: z.string(),
  category: FileCategorySchema,
  byteSize: z.number().int().min(0),
  modificationTime: z.string().datetime(),
  fingerprint: z.string(),
  isGenerated: z.boolean(),
  isBinary: z.boolean(),
  isSecret: z.boolean(),
  isExcluded: z.boolean(),
  parseSupported: z.boolean(),
  symbolIds: z.array(z.string()),
  importTargets: z.array(z.string()),
  exportTargets: z.array(z.string()),
  testMappingIds: z.array(z.string()),
  lastIndexedAt: z.string().datetime()
});

export const ProjectCommandSchema = z.object({
  label: z.string(),
  command: z.string(),
  provenance: z.string(),
  riskLevel: z.enum(["safe", "moderate", "dangerous"])
});

export const FrameworkSignalSchema = z.object({
  name: z.string(),
  version: z.string().optional(),
  confidence: z.number().min(0).max(1),
  evidence: z.string()
});

export const RepositoryIndexSchema = z.object({
  id: z.string().uuid(),
  repositoryId: z.string(),
  branchKey: z.string(),
  status: IndexStatusSchema,
  startedAt: z.string().datetime().optional(),
  completedAt: z.string().datetime().optional(),
  indexVersion: z.number().int().nonnegative(),
  fileIds: z.array(z.string()),
  relationshipIds: z.array(z.string()),
  commands: z.array(ProjectCommandSchema),
  frameworks: z.array(FrameworkSignalSchema),
  errors: z.array(z.object({ message: z.string(), category: z.string() }))
});

export const RepositoryIdentitySchema = z.object({
  id: z.string(),
  displayName: z.string(),
  workspaceRoots: z.array(z.string()),
  gitRoot: z.string().optional(),
  branch: z.string().optional(),
  headCommit: z.string().optional()
});

export const WorkflowSchema = z.object({
  id: z.string().uuid(),
  repositoryId: z.string(),
  activeIntentRevision: z.number().int().nonnegative(),
  activeSpecificationRevision: z.number().int().nonnegative(),
  taskGraphId: z.string().optional(),
  activeTaskId: z.string().optional(),
  activeAttemptId: z.string().optional(),
  validationRunIds: z.array(z.string()),
  uiResumeRoute: z.string(),
  activitySummary: z.string(),
  status: z.enum([
    "drafting", "awaiting-spec-approval", "planned", "executing",
    "awaiting-user", "blocked", "validating", "completed", "cancelled"
  ]),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime()
});

export const AgentProfileSchema = z.object({
  id: z.string(),
  displayName: z.string(),
  description: z.string(),
  source: z.string(),
  availability: z.enum(["available", "configured", "unavailable", "unknown"]),
  supportedTaskCategories: z.array(z.enum([
    "implementation", "testing", "review", "refactoring",
    "documentation", "debugging", "architecture", "security", "performance"
  ])),
  toolsAndActions: z.array(z.string()),
  repositoryAccessExpectations: z.array(z.string()),
  strengths: z.array(z.string()),
  restrictions: z.array(z.string()),
  defaultContextPolicy: z.object({
    maxEstimatedTokens: z.number(),
    includeTests: z.boolean()
  }),
  discoveredAt: z.string(),
  capabilityFingerprint: z.string()
});

export const TaskSchema = z.object({
  id: z.string().uuid(),
  title: z.string(),
  objective: z.string(),
  description: z.string(),
  status: z.enum([
    "pending", "ready", "awaiting_approval", "delegating", "executing",
    "awaiting_user", "validating", "passed", "failed", "skipped", "cancelled", "blocked"
  ]),
  dependencies: z.array(z.string()),
  assignedAgentId: z.string().optional(),
  requiredContextPolicy: z.object({
    selectionSeeds: z.array(z.string()),
    budget: z.number(),
    mandatoryItems: z.array(z.string()),
    excludedItems: z.array(z.string())
  }),
  expectedFiles: z.array(z.string()),
  expectedOutput: z.string(),
  acceptanceCriterionIds: z.array(z.string()),
  validationSteps: z.array(z.object({
    command: z.string().optional(),
    manualCheck: z.string().optional(),
    policyClass: z.string()
  })),
  retryHistory: z.array(z.string()),
  executionNotes: z.array(z.object({
    timestamp: z.string(),
    author: z.string(),
    entry: z.string()
  })),
  baseFingerprint: z.object({
    specRevision: z.number(),
    indexVersion: z.number(),
    gitBase: z.string().optional(),
    contextFingerprint: z.string().optional()
  }),
  attemptNumber: z.number().int().nonnegative().optional()
});

export const TaskAttemptSchema = z.object({
  id: z.string().uuid(),
  attemptNumber: z.number().int().nonnegative(),
  taskId: z.string(),
  agentAssignmentSnapshot: z.object({
    agentId: z.string(),
    selectionMode: z.string(),
    capabilityFingerprint: z.string()
  }),
  contextPackageId: z.string(),
  delegationMethod: z.enum(["direct", "assisted"]),
  startedAt: z.string().datetime(),
  completedAt: z.string().datetime().optional(),
  externalHandle: z.string().optional(),
  state: z.string(),
  result: z.string().optional(),
  observedChanges: z.object({
    files: z.array(z.string()),
    commits: z.array(z.string())
  }).optional(),
  userConfirmations: z.array(z.object({
    action: z.string(),
    timestamp: z.string()
  })),
  failure: z.object({
    error: z.string(),
    recoverable: z.boolean()
  }).optional()
});

export const AcceptanceCriterionSchema = z.object({
  id: z.string(),
  description: z.string(),
  required: z.boolean(),
  sourceRequirementIds: z.array(z.string()),
  validationMethod: z.string(),
  expectedEvidenceType: z.string(),
  coveringTaskIds: z.array(z.string()),
  result: z.enum(["unverified", "passed", "failed", "requires-user-review", "overridden"]),
  evidenceReferences: z.array(z.string()),
  overrideDecisionId: z.string().optional()
});

export const KeystoneSpecificationSchema = z.object({
  id: z.string(),
  title: z.string(),
  status: z.enum([
    "draft", "awaiting_review", "approved", "in_progress",
    "blocked", "validation", "completed", "cancelled", "superseded"
  ]),
  revision: z.number().int().nonnegative(),
  workflowId: z.string(),
  repositoryId: z.string(),
  branch: z.string().optional(),
  baseCommit: z.string().optional(),
  indexVersion: z.number().int().nonnegative(),
  intent: z.object({
    originalRequest: z.string(),
    normalizedIntent: z.string(),
    businessObjective: z.string(),
    outcome: z.string()
  }),
  scope: z.object({
    includedFunctionality: z.array(z.string()),
    excludedFunctionality: z.array(z.string()),
    modules: z.array(z.string()),
    expectedFiles: z.array(z.string()),
    dependencies: z.array(z.string())
  }),
  existingBehavior: z.object({
    implementationSummary: z.string(),
    architecture: z.string(),
    constraints: z.array(z.string()),
    knownLimitations: z.array(z.string()),
    evidenceReferences: z.array(z.string())
  }),
  proposedBehavior: z.object({
    functionalRequirements: z.array(z.string()),
    nonFunctionalRequirements: z.array(z.string()),
    userFlows: z.string(),
    interfaces: z.string(),
    models: z.string(),
    errors: z.string()
  }),
  engineeringConstraints: z.object({
    conventions: z.array(z.string()),
    frameworks: z.array(z.string()),
    dependencies: z.array(z.string()),
    security: z.array(z.string()),
    performance: z.array(z.string()),
    compatibility: z.array(z.string()),
    protectedAreas: z.array(z.string())
  }),
  criteria: z.array(AcceptanceCriterionSchema),
  testStrategy: z.object({
    existingTests: z.array(z.string()),
    newTests: z.array(z.string()),
    impactedSuites: z.array(z.string()),
    manualScenarios: z.array(z.string()),
    negativeScenarios: z.array(z.string()),
    regressionRisks: z.array(z.string())
  }),
  implementationPlan: z.object({
    taskGraphId: z.string().optional(),
    planRevision: z.number().int().nonnegative()
  }),
  decisionLog: z.object({
    questions: z.array(z.object({
      id: z.string(),
      question: z.string(),
      status: z.string()
    })),
    decisions: z.array(z.object({
      id: z.string(),
      decision: z.string(),
      rationale: z.string()
    })),
    assumptions: z.array(z.string()),
    rejectedApproaches: z.array(z.object({
      id: z.string(),
      approach: z.string(),
      reason: z.string()
    })),
    revisions: z.array(z.object({
      id: z.string(),
      revision: z.string(),
      summary: z.string()
    }))
  })
});

export const TaskGraphSchema = z.object({
  id: z.string().uuid(),
  workflowId: z.string(),
  specificationId: z.string(),
  specificationRevision: z.number().int().nonnegative(),
  graphRevision: z.number().int().nonnegative(),
  taskIds: z.array(z.string()),
  generatedAt: z.string(),
  generationProvenance: z.string(),
  validationStatus: z.string(),
  topologicalOrder: z.array(z.string())
});

export const ContextPackageSchema = z.object({
  id: z.string().uuid(),
  taskId: z.string(),
  specificationRevision: z.number().int().nonnegative(),
  repositoryIndexVersion: z.number().int().nonnegative(),
  baseCommit: z.string().optional(),
  createdAt: z.string(),
  selectionPolicyVersion: z.number().int().nonnegative(),
  budget: z.number(),
  estimatedTokens: z.number(),
  estimatedBytes: z.number(),
  items: z.array(z.object({
    kind: z.string(),
    sourceReference: z.string(),
    sourceFingerprint: z.string(),
    selectionReason: z.string(),
    rankScoreComponents: z.record(z.string(), z.number()),
    compressionForm: z.string(),
    estimatedTokens: z.number(),
    estimatedBytes: z.number(),
    isMandatory: z.boolean(),
    isPinned: z.boolean(),
    included: z.boolean(),
    exclusionReason: z.string().optional()
  })),
  excludedCandidates: z.array(z.object({
    id: z.string(),
    reason: z.string()
  })),
  fingerprint: z.string(),
  reviewStatus: z.enum(["unreviewed", "reviewed", "stale"]),
  reviewedAt: z.string().optional(),
  delegationAttemptId: z.string().optional()
});

export const ExternalChangeSchema = z.object({
  taskId: z.string(),
  detectedAt: z.string(),
  type: z.enum(["external-commit", "file-change", "branch-switch"]),
  severity: z.enum(["low", "medium", "high", "critical"]),
  details: z.string(),
  impactedFiles: z.array(z.string()).optional(),
  stale: z.boolean()
});

export type ExternalChange = z.infer<typeof ExternalChangeSchema>;

export const ValidationRunSchema = z.object({
  id: z.string().uuid(),
  workflowId: z.string(),
  specificationRevision: z.number().int().nonnegative(),
  taskIds: z.array(z.string()),
  repositoryBaseCommit: z.string().optional(),
  status: z.string(),
  startedAt: z.string(),
  completedAt: z.string().optional(),
  checks: z.array(z.object({
    id: z.string(),
    type: z.string(),
    status: z.enum(["passed", "warning", "failed", "not-executed", "requires-user-review"]),
    command: z.string().optional(),
    reviewMethod: z.string().optional(),
    startedAt: z.string(),
    completedAt: z.string().optional(),
    exitCode: z.number().int().optional(),
    outputReference: z.string().optional(),
    evidenceReferences: z.array(z.string()),
    affectedCriteria: z.array(z.string()),
    retryable: z.boolean(),
    error: z.string().optional()
  })),
  changedFiles: z.array(z.string()),
  criterionResults: z.array(z.object({
    criterionId: z.string(),
    result: z.enum(["unverified", "passed", "failed", "requires-user-review", "overridden"])
  })),
  driftFindings: z.array(z.object({
    description: z.string(),
    affectedCriteria: z.array(z.string())
  })),
  overrideRecords: z.array(z.string())
});

export const IntentRecordSchema = z.object({
  id: z.string().uuid(),
  workflowId: z.string(),
  revision: z.number().int().nonnegative(),
  originalText: z.string(),
  normalizedObjective: z.string(),
  category: z.string(),
  developmentMode: z.enum(["quick", "guided", "spec-driven"]),
  affectedAreas: z.array(z.object({
    reference: z.string(),
    reason: z.string()
  })),
  expectedOutcome: z.string(),
  constraints: z.array(z.object({
    description: z.string(),
    provenance: z.string()
  })),
  ambiguities: z.array(z.object({
    question: z.string(),
    impact: z.string()
  })),
  riskLevel: z.enum(["low", "medium", "high", "critical"]),
  recommendedWorkflow: z.object({
    mode: z.string(),
    approvalPolicy: z.boolean()
  }),
  recommendedAgents: z.array(z.object({
    agentId: z.string(),
    reason: z.string()
  })),
  requiredDecisions: z.array(z.object({
    id: z.string(),
    question: z.string(),
    blocking: z.boolean()
  }))
});

// ============================================================================
// Message types for Intelligence, Intent, Spec, Task, Context, Validation
// ============================================================================

export const IndexStartRequestSchema = z.object({
  ...envelopeFields,
  type: z.literal("index/start"),
  payload: z.object({
    branch: z.string().optional()
  }).strict()
});

export const IndexCancelRequestSchema = z.object({
  ...envelopeFields,
  type: z.literal("index/cancel"),
  payload: z.object({}).strict()
});

export const IndexSearchRequestSchema = z.object({
  ...envelopeFields,
  type: z.literal("index/search"),
  payload: z.object({
    query: z.string().min(1).max(200),
    category: z.enum(["file", "symbol"]).optional(),
    language: z.string().optional(),
    page: z.number().int().min(0).optional()
  }).strict()
});

export const IntentAnalyzeRequestSchema = z.object({
  ...envelopeFields,
  type: z.literal("intent/analyze"),
  payload: z.object({
    text: z.string().min(1).max(2000),
    mode: z.enum(["quick", "guided", "spec-driven"]),
    workspaceRoot: z.string().optional()
  }).strict()
});

export const SpecCreateRequestSchema = z.object({
  ...envelopeFields,
  type: z.literal("spec/create"),
  payload: z.object({
    workflowId: z.string(),
    title: z.string().min(1).max(200),
    intentId: z.string()
  }).strict()
});

export const SpecUpdateRequestSchema = z.object({
  ...envelopeFields,
  type: z.literal("spec/update"),
  payload: z.object({
    specificationId: z.string(),
    revision: z.number().int().nonnegative(),
    patch: z.record(z.string(), z.unknown())
  }).strict()
});

export const SpecApproveRequestSchema = z.object({
  ...envelopeFields,
  type: z.literal("spec/approve"),
  payload: z.object({
    specificationId: z.string(),
    expectedRevision: z.number().int().nonnegative(),
    rationale: z.string().max(500).optional()
  }).strict()
});

export const SpecReviseRequestSchema = z.object({
  ...envelopeFields,
  type: z.literal("spec/revise"),
  payload: z.object({
    specificationId: z.string(),
    reason: z.string()
  }).strict()
});

export const AgentListRequestSchema = z.object({
  ...envelopeFields,
  type: z.literal("agent/list"),
  payload: z.object({}).strict()
});

export const AgentAssignRequestSchema = z.object({
  ...envelopeFields,
  type: z.literal("agent/assign"),
  payload: z.object({
    taskId: z.string(),
    workflowId: z.string(),
    agentId: z.string()
  }).strict()
});

export const TaskGenerateRequestSchema = z.object({
  ...envelopeFields,
  type: z.literal("task/generate"),
  payload: z.object({
    specificationId: z.string(),
    specificationRevision: z.number().int().nonnegative()
  }).strict()
});

export const TaskDelegateRequestSchema = z.object({
  ...envelopeFields,
  type: z.literal("task/delegate"),
  payload: z.object({
    taskId: z.string(),
    workflowId: z.string(),
    contextFingerprint: z.string()
  }).strict()
});

export const TaskControlRequestSchema = z.object({
  ...envelopeFields,
  type: z.literal("task/control"),
  payload: z.object({
    taskId: z.string(),
    workflowId: z.string(),
    action: z.enum(["approve", "reject", "retry", "pause", "resume", "skip", "cancel", "reorder"])
  }).strict()
});

export const ContextPreviewRequestSchema = z.object({
  ...envelopeFields,
  type: z.literal("context/preview"),
  payload: z.object({
    taskId: z.string(),
    workflowId: z.string(),
    package: z.unknown()
  }).strict()
});

export const ContextPinRequestSchema = z.object({
  ...envelopeFields,
  type: z.literal("context/pin"),
  payload: z.object({
    taskId: z.string(),
    workflowId: z.string(),
    itemId: z.string()
  }).strict()
});

export const ContextExcludeRequestSchema = z.object({
  ...envelopeFields,
  type: z.literal("context/exclude"),
  payload: z.object({
    taskId: z.string(),
    workflowId: z.string(),
    itemId: z.string()
  }).strict()
});

export const ValidationPlanRequestSchema = z.object({
  ...envelopeFields,
  type: z.literal("validation/plan"),
  payload: z.object({
    workflowId: z.string(),
    specificationId: z.string(),
    specificationRevision: z.number().int().nonnegative()
  }).strict()
});

export const ValidationRunRequestSchema = z.object({
  ...envelopeFields,
  type: z.literal("validation/run"),
  payload: z.object({
    validationRunId: z.string()
  }).strict()
});

export const ValidationOverrideRequestSchema = z.object({
  ...envelopeFields,
  type: z.literal("validation/override"),
  payload: z.object({
    workflowId: z.string(),
    criterionId: z.string(),
    reason: z.string().max(500),
    riskAcknowledgement: z.string().max(500)
  }).strict()
});

export const DelegationRequestSchema = z.object({
  ...envelopeFields,
  type: z.literal("delegation/delegate"),
  payload: z.object({
    taskId: z.string(),
    workflowId: z.string(),
    task: z.unknown(),
    specificationRevision: z.number().int().nonnegative()
  }).strict()
});

export const ChangeDetectRequestSchema = z.object({
  ...envelopeFields,
  type: z.literal("change/detect"),
  payload: z.object({
    taskId: z.string(),
    branch: z.string().optional()
  }).strict()
});

export const WorkflowStartRequestSchema = z.object({
  ...envelopeFields,
  type: z.literal("workflow/start"),
  payload: z.object({
    workflow: z.unknown()
  }).strict()
});

export const WorkflowPauseRequestSchema = z.object({
  ...envelopeFields,
  type: z.literal("workflow/pause"),
  payload: z.object({
    workflowId: z.string()
  }).strict()
});

export const WorkflowCancelRequestSchema = z.object({
  ...envelopeFields,
  type: z.literal("workflow/cancel"),
  payload: z.object({
    workflowId: z.string()
  }).strict()
});

export const WorkflowUpdatedEventSchema = z.object({
  ...hostEnvelopeFields,
  type: z.literal("workflow/updated"),
  payload: z.unknown()
});

// ============================================================================
// Host message types for the new message families
// ============================================================================

export const IndexProgressEventSchema = z.object({
  ...hostEnvelopeFields,
  type: z.literal("index/progress"),
  payload: z.object({
    stage: z.string(),
    fileCount: z.number().int().nonnegative().optional(),
    totalFiles: z.number().int().nonnegative().optional(),
    estimatedRemainingMs: z.number().int().nonnegative().optional()
  }).strict()
});

export const IndexUpdatedEventSchema = z.object({
  ...hostEnvelopeFields,
  type: z.literal("index/updated"),
  payload: z.object({
    status: IndexStatusSchema,
    indexVersion: z.number().int().nonnegative(),
    fileCount: z.number().int().nonnegative()
  }).strict()
});

export const IndexErrorEventSchema = z.object({
  ...hostEnvelopeFields,
  type: z.literal("index/error"),
  payload: z.object({
    message: z.string(),
    category: z.string(),
    recoverable: z.boolean()
  }).strict()
});

export const IntentUpdatedEventSchema = z.object({
  ...hostEnvelopeFields,
  type: z.literal("intent/updated"),
  payload: z.object({
    intentId: z.string(),
    revision: z.number().int().nonnegative()
  }).strict()
});

export const SpecUpdatedEventSchema = z.object({
  ...hostEnvelopeFields,
  type: z.literal("spec/updated"),
  payload: z.object({
    specificationId: z.string(),
    revision: z.number().int().nonnegative(),
    status: z.enum(["draft", "awaiting_review", "approved", "in_progress", "cancelled"])
  }).strict()
});

export const SpecApprovalRequiredEventSchema = z.object({
  ...hostEnvelopeFields,
  type: z.literal("spec/approvalRequired"),
  payload: z.object({
    specificationId: z.string(),
    reason: z.string()
  }).strict()
});

export const AgentAvailabilityChangedEventSchema = z.object({
  ...hostEnvelopeFields,
  type: z.literal("agent/availabilityChanged"),
  payload: z.object({
    agentId: z.string(),
    availability: z.enum(["available", "configured", "unavailable", "unknown"])
  }).strict()
});

export const TaskUpdatedEventSchema = z.object({
  ...hostEnvelopeFields,
  type: z.literal("task/updated"),
  payload: z.object({
    taskId: z.string(),
    status: z.enum(["pending", "ready", "awaiting_approval", "delegating", "executing", "awaiting_user", "validating", "passed", "failed", "skipped", "cancelled", "blocked"]),
    attemptNumber: z.number().int().nonnegative().optional()
  }).strict()
});

export const TaskStaleEventSchema = z.object({
  ...hostEnvelopeFields,
  type: z.literal("task/stale"),
  payload: z.object({
    taskId: z.string(),
    reason: z.string()
  }).strict()
});

export const ContextUpdatedEventSchema = z.object({
  ...hostEnvelopeFields,
  type: z.literal("context/updated"),
  payload: z.object({
    taskId: z.string(),
    fingerprint: z.string(),
    reviewStatus: z.enum(["unreviewed", "reviewed", "stale"])
  }).strict()
});

export const ValidationProgressEventSchema = z.object({
  ...hostEnvelopeFields,
  type: z.literal("validation/progress"),
  payload: z.object({
    validationRunId: z.string(),
    checkId: z.string(),
    status: z.enum(["passed", "warning", "failed", "not-executed", "requires-user-review"])
  }).strict()
});

export const ValidationUpdatedEventSchema = z.object({
  ...hostEnvelopeFields,
  type: z.literal("validation/updated"),
  payload: z.object({
    validationRunId: z.string(),
    status: z.string(),
    completedChecks: z.number().int().nonnegative(),
    totalChecks: z.number().int().nonnegative()
  }).strict()
});
