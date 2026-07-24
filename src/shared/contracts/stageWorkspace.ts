import { z } from "zod";

export const STAGE_WORKSPACE_SCHEMA_VERSION = 1 as const;

export const StageEvidenceKindSchema = z.enum(["file", "symbol", "module", "flow", "document", "test", "graph-entity"]);
export const StageEvidenceSchema = z.object({
  kind: StageEvidenceKindSchema,
  reference: z.string().min(1).max(1_000),
  label: z.string().min(1).max(500),
}).strict();

export const StageConfidenceSchema = z.enum(["confirmed", "inferred", "unresolved"]);

export const UnderstandingSectionSchema = z.object({
  title: z.string().min(1).max(200),
  statement: z.string().min(1).max(10_000),
  confidence: StageConfidenceSchema,
  evidence: z.array(StageEvidenceSchema).max(50),
}).strict();

export const StageScopeItemSchema = z.object({
  id: z.string().min(1).max(500),
  kind: StageEvidenceKindSchema,
  reference: z.string().min(1).max(1_000),
  label: z.string().min(1).max(500),
  confidence: StageConfidenceSchema,
  included: z.boolean(),
  exclusionReason: z.string().max(2_000).optional(),
}).strict();

export const StageAmbiguitySchema = z.object({
  id: z.string().min(1).max(200),
  text: z.string().min(1).max(2_000),
  blocking: z.boolean(),
  resolved: z.boolean(),
  resolution: z.string().max(2_000).optional(),
}).strict();

export const IntentAnalysisSchema = z.object({
  id: z.string().uuid(),
  objective: z.string().min(1).max(10_000),
  sections: z.array(UnderstandingSectionSchema).max(40),
  scope: z.array(StageScopeItemSchema).max(200),
  assumptions: z.array(z.string().max(2_000)).max(50),
  ambiguities: z.array(StageAmbiguitySchema).max(50),
  requiredFacts: z.array(z.string().max(1_000)).max(50),
  recommendedNextAction: z.string().min(1).max(2_000),
  intelligenceRevision: z.number().int().nonnegative(),
  contentHash: z.string().min(1).max(200),
  approved: z.boolean(),
  createdAt: z.string().datetime(),
}).strict();

export const StageIntelligenceStateSchema = z.object({
  status: z.enum(["unavailable", "ready"]),
  generation: z.number().int().nonnegative(),
  files: z.number().int().nonnegative(),
  symbols: z.number().int().nonnegative(),
  relationships: z.number().int().nonnegative(),
  message: z.string().max(2_000),
}).strict();

export const StageDelegationModeSchema = z.enum(["chat-open", "clipboard", "manual"]);
export const StageCapabilitySchema = z.object({
  id: z.string().min(1).max(200),
  label: z.string().min(1).max(200),
  available: z.boolean(),
  detail: z.string().max(2_000),
}).strict();

export const StageCopilotConfigurationSchema = z.object({
  mode: StageDelegationModeSchema,
  agentId: z.string().max(200),
  agentLabel: z.string().max(200),
  agentAvailable: z.boolean(),
  skill: z.string().max(200),
  instructions: z.array(z.string().max(2_000)).max(30),
  capabilities: z.array(StageCapabilitySchema).max(20),
  discoveryNotice: z.string().max(2_000).optional(),
}).strict();

export const StageContextItemSchema = z.object({
  id: z.string().min(1).max(500),
  label: z.string().min(1).max(500),
  kind: StageEvidenceKindSchema,
  tokens: z.number().int().nonnegative(),
  included: z.boolean(),
  reason: z.string().max(2_000).optional(),
}).strict();

export const StageContextPackageSchema = z.object({
  id: z.string().uuid(),
  revision: z.number().int().positive(),
  status: z.enum(["generated", "approved", "stale"]),
  candidateTokens: z.number().int().nonnegative(),
  compressedTokens: z.number().int().nonnegative(),
  reductionPercent: z.number().min(0).max(100),
  tokenMeasurement: z.enum(["estimated", "measured"]),
  items: z.array(StageContextItemSchema).max(300),
  requiredFacts: z.array(z.object({ fact: z.string().max(1_000), covered: z.boolean() }).strict()).max(50),
  intelligenceRevision: z.number().int().nonnegative(),
  content: z.string().max(500_000),
  generatedAt: z.string().datetime(),
  approvedAt: z.string().datetime().optional(),
}).strict();

export const StagePromptSchema = z.object({
  id: z.string().uuid(),
  revision: z.number().int().positive(),
  content: z.string().min(1).max(500_000),
  contentHash: z.string().min(1).max(200),
  contextPackageRevision: z.number().int().positive(),
  preparedAt: z.string().datetime(),
}).strict();

export const StageDelegationStatusSchema = z.enum(["chat-opened", "copied-chat-opened", "copied", "manual", "failed"]);
export const StageDelegationRecordSchema = z.object({
  id: z.string().uuid(),
  workflowId: z.string().uuid(),
  stageId: z.string().uuid(),
  mode: StageDelegationModeSchema,
  capabilityUsed: z.string().min(1).max(200),
  status: StageDelegationStatusSchema,
  statusDetail: z.string().max(2_000),
  promptRevision: z.number().int().positive(),
  contextPackageRevision: z.number().int().positive(),
  executionProfileRevision: z.number().int().nonnegative(),
  failureReason: z.string().max(4_000).optional(),
  createdAt: z.string().datetime(),
}).strict();

export const StageResultSourceSchema = z.enum(["integration", "pasted", "file-import", "manual"]);
export const StageResultSchema = z.object({
  id: z.string().uuid(),
  source: StageResultSourceSchema,
  content: z.string().min(1).max(500_000),
  referencedFiles: z.array(z.string().max(1_000)).max(200),
  unresolvedQuestions: z.array(z.string().max(2_000)).max(50),
  notes: z.string().max(10_000),
  capturedAt: z.string().datetime(),
}).strict();

export const StageValidationStatusSchema = z.enum(["sufficient", "sufficient-with-warnings", "incomplete", "contradicted", "stale"]);
export const StageValidationSchema = z.object({
  id: z.string().uuid(),
  resultId: z.string().uuid(),
  status: StageValidationStatusSchema,
  coveredAreas: z.array(z.string().max(200)).max(30),
  missingAreas: z.array(z.string().max(200)).max(30),
  warnings: z.array(z.string().max(2_000)).max(30),
  contradictions: z.array(z.object({ statement: z.string().max(2_000), evidence: StageEvidenceSchema }).strict()).max(30),
  intelligenceRevision: z.number().int().nonnegative(),
  warningsAccepted: z.boolean(),
  validatedAt: z.string().datetime(),
}).strict();

export const UnderstandPrimaryActionSchema = z.enum([
  "initialize-intelligence",
  "analyze-intent",
  "approve-analysis",
  "generate-context",
  "review-approve-context",
  "delegate",
  "capture-result",
  "validate-result",
  "complete-stage",
  "stage-completed",
]);

export const StageCompletionGateSchema = z.object({ allowed: z.boolean(), unmet: z.array(z.string().max(500)).max(20) }).strict();

export const UnderstandStateSchema = z.object({
  schemaVersion: z.literal(STAGE_WORKSPACE_SCHEMA_VERSION),
  workflowId: z.string().uuid(),
  stageId: z.string().uuid(),
  intelligence: StageIntelligenceStateSchema,
  analysis: IntentAnalysisSchema.optional(),
  configuration: StageCopilotConfigurationSchema,
  contextPackage: StageContextPackageSchema.optional(),
  prompt: StagePromptSchema.optional(),
  delegations: z.array(StageDelegationRecordSchema).max(50),
  result: StageResultSchema.optional(),
  validation: StageValidationSchema.optional(),
  primaryAction: UnderstandPrimaryActionSchema,
  completion: StageCompletionGateSchema,
  completedAt: z.string().datetime().optional(),
  updatedAt: z.string().datetime(),
}).strict();

export const InvestigationQuestionSchema = z.object({
  id: z.string().uuid(),
  text: z.string().min(1).max(2_000),
  required: z.boolean(),
  status: z.enum(["open", "answered"]),
  answer: z.string().max(20_000),
  evidence: z.array(StageEvidenceSchema).max(30),
}).strict();

export const InvestigationStateSchema = z.object({
  schemaVersion: z.literal(STAGE_WORKSPACE_SCHEMA_VERSION),
  workflowId: z.string().uuid(),
  stageId: z.string().uuid(),
  objective: z.string().max(10_000),
  questions: z.array(InvestigationQuestionSchema).max(60),
  limitations: z.array(z.string().max(2_000)).max(30),
  conclusion: z.string().max(50_000),
  conclusionAccepted: z.boolean(),
  completion: StageCompletionGateSchema,
  completedAt: z.string().datetime().optional(),
  updatedAt: z.string().datetime(),
}).strict();

export const PlanTaskSchema = z.object({
  id: z.string().min(1).max(200),
  title: z.string().min(1).max(500),
  detail: z.string().max(4_000),
  dependencies: z.array(z.string().max(200)).max(30),
  affectedAreas: z.array(z.string().max(1_000)).max(60),
  acceptanceCriteria: z.array(z.string().max(2_000)).max(30),
  evidence: z.array(StageEvidenceSchema).max(20),
}).strict();

export const PlanPrimaryActionSchema = z.enum([
  "generate-context",
  "review-approve-context",
  "delegate",
  "capture-plan",
  "approve-plan",
  "complete-plan",
  "stage-completed",
]);

export const PlanStateSchema = z.object({
  schemaVersion: z.literal(STAGE_WORKSPACE_SCHEMA_VERSION),
  workflowId: z.string().uuid(),
  stageId: z.string().uuid(),
  objective: z.string().max(10_000),
  understanding: z.array(UnderstandingSectionSchema).max(40),
  configuration: StageCopilotConfigurationSchema,
  contextPackage: StageContextPackageSchema.optional(),
  prompt: StagePromptSchema.optional(),
  delegations: z.array(StageDelegationRecordSchema).max(50),
  tasks: z.array(PlanTaskSchema).max(60),
  validationExpectations: z.array(z.string().max(2_000)).max(30),
  planResult: z.string().max(200_000),
  planApproved: z.boolean(),
  primaryAction: PlanPrimaryActionSchema,
  completion: StageCompletionGateSchema,
  completedAt: z.string().datetime().optional(),
  updatedAt: z.string().datetime(),
}).strict();

export const CompleteStateSchema = z.object({
  schemaVersion: z.literal(STAGE_WORKSPACE_SCHEMA_VERSION),
  workflowId: z.string().uuid(),
  stageId: z.string().uuid(),
  intentText: z.string().max(10_000),
  workTypeLabel: z.string().max(100),
  outcome: z.string().max(50_000),
  completedStages: z.array(z.object({ displayName: z.string().max(100), completed: z.boolean() }).strict()).max(12),
  evidence: z.array(StageEvidenceSchema).max(200),
  limitations: z.array(z.string().max(2_000)).max(60),
  tokenMetrics: z.object({
    candidateTokens: z.number().int().nonnegative(),
    compressedTokens: z.number().int().nonnegative(),
    reductionPercent: z.number().min(0).max(100),
    tokenMeasurement: z.enum(["estimated", "measured"]),
  }).strict().optional(),
  delegationHistory: z.array(StageDelegationRecordSchema).max(100),
  updatedAt: z.string().datetime(),
}).strict();

export const StageWorkspacePersistentStateSchema = z.object({
  schemaVersion: z.literal(STAGE_WORKSPACE_SCHEMA_VERSION),
  revision: z.number().int().nonnegative(),
  understand: z.record(z.string(), UnderstandStateSchema),
  investigation: z.record(z.string(), InvestigationStateSchema),
  plan: z.record(z.string(), PlanStateSchema).optional(),
  updatedAt: z.string().datetime(),
}).strict();

export type StageEvidence = z.infer<typeof StageEvidenceSchema>;
export type StageResultSource = z.infer<typeof StageResultSourceSchema>;
export type StageConfidence = z.infer<typeof StageConfidenceSchema>;
export type UnderstandingSection = z.infer<typeof UnderstandingSectionSchema>;
export type StageScopeItem = z.infer<typeof StageScopeItemSchema>;
export type IntentAnalysis = z.infer<typeof IntentAnalysisSchema>;
export type StageIntelligenceState = z.infer<typeof StageIntelligenceStateSchema>;
export type StageDelegationMode = z.infer<typeof StageDelegationModeSchema>;
export type StageCopilotConfiguration = z.infer<typeof StageCopilotConfigurationSchema>;
export type StageContextPackage = z.infer<typeof StageContextPackageSchema>;
export type StagePrompt = z.infer<typeof StagePromptSchema>;
export type StageDelegationRecord = z.infer<typeof StageDelegationRecordSchema>;
export type StageDelegationStatus = z.infer<typeof StageDelegationStatusSchema>;
export type StageResult = z.infer<typeof StageResultSchema>;
export type StageValidation = z.infer<typeof StageValidationSchema>;
export type UnderstandPrimaryAction = z.infer<typeof UnderstandPrimaryActionSchema>;
export type UnderstandState = z.infer<typeof UnderstandStateSchema>;
export type InvestigationQuestion = z.infer<typeof InvestigationQuestionSchema>;
export type InvestigationState = z.infer<typeof InvestigationStateSchema>;
export type PlanTask = z.infer<typeof PlanTaskSchema>;
export type PlanPrimaryAction = z.infer<typeof PlanPrimaryActionSchema>;
export type PlanState = z.infer<typeof PlanStateSchema>;
export type CompleteState = z.infer<typeof CompleteStateSchema>;
export type StageWorkspacePersistentState = z.infer<typeof StageWorkspacePersistentStateSchema>;
