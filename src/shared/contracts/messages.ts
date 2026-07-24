import { z } from "zod";
import type { HomeState } from "./home";
import type { DevelopmentAggregate } from "./development";
import type { ExecutionConfigurationAggregate, InstructionPreview, SkillDefinition } from "./executionConfiguration";
import {
  CanonicalWorkflowWorkTypeSchema,
  type CanonicalWorkflow,
  type WorkflowCreatedResponse,
  type WorkflowCreationFailedResponse,
} from "./canonicalWorkflow";
import {
  StageDelegationModeSchema,
  StageEvidenceSchema,
  PlanTaskSchema,
  StageResultSourceSchema,
  type CompleteState,
  type InvestigationState,
  type PlanState,
  type UnderstandState,
} from "./stageWorkspace";
import {
  ActivitySchema,
  AppRouteSchema,
  BootstrapSnapshotSchema,
  NavigationSectionSchema,
  PersistedFoundationStateSchema,
  SCHEMA_VERSION,
  envelopeFields,
  hostEnvelopeFields,
  type BootstrapSnapshot,
  type PersistedFoundationState,
} from "./domain";
import {
  IntelligenceEntityRequestSchema,
  IntelligenceDiagnosticsRequestSchema,
  IntelligenceNeighborhoodRequestSchema,
  IntelligenceOverviewSchema,
  IntelligenceSearchRequestSchema,
  IntelligenceRuntimeOverviewSchema,
  IntelligenceStatusSchema,
  SourceRangeSchema,
  type IntelligenceEntityDetails,
  type IntelligenceDiagnosticsResult,
  type IntelligenceNeighborhood,
  type IntelligenceOverview,
  type IntelligenceSearchResult,
} from "./intelligence";
import type { SerializedKeystoneError } from "../errors/KeystoneError";
import type { ImpactQaAggregate } from "./impactQa";
import {
  QaTestIntelligenceAggregateSchema,
  type QaTestIntelligenceAggregate,
  StructuredProposalIngestSchema,
  FailureCategorySchema,
  ValidationSourceSchema,
  ValidationLevelSchema,
  ValidationLevelStatusSchema,
} from "./qaTestIntelligence";
import {
  IntelligenceCanvasEntityActionRequestSchema,
  IntelligenceCanvasEvidenceRequestSchema,
  IntelligenceCanvasEvidenceActionRequestSchema,
  IntelligenceCanvasQueryRequestSchema,
  IntelligenceCanvasPathActionRequestSchema,
  IntelligenceCanvasSearchRequestSchema,
  IntelligenceGraphSliceRequestSchema,
  type IntelligenceEngineeringQueryResult,
  type IntelligenceGraphSlice,
  type IntelligenceCanvasSearchItem,
} from "./intelligenceCanvas";
import {
  InitializationAcknowledgedPayloadSchema,
  KeystoneDashboardStateSchema,
  KeystoneInitializationSchema,
  KeystonePanelStateSchema,
  NavigationAcknowledgedPayloadSchema,
  OpenKeystoneRequestSchema,
  ValidatedNavigationSchema,
  WebviewReadyPayloadSchema,
  WebviewStateChangedPayloadSchema,
  type KeystoneDashboardState,
  type KeystoneInitialization,
  type KeystonePanelState,
  type ValidatedNavigation,
} from "./nativeShell";
import {
  AssistedLaunchIdPayloadSchema,
  AssistedLaunchPayloadSchema,
  CopilotCustomizationIdPayloadSchema,
  CopilotCustomizationTogglePayloadSchema,
  CopilotScopePayloadSchema,
  CopilotToolTestPayloadSchema,
  type AssistedLaunchState,
  type CopilotCustomizationRecord,
  type CopilotIntegrationCapabilities,
  type CopilotToolAuditEntry,
  type KeystoneToolDescriptor,
  type KeystoneToolResult,
} from "./copilotIntegration";
import {
  CpgScopeQuerySchema,
  CpgSliceQuerySchema,
  type CpgQueryResult,
  type CpgSliceResult,
} from "./cpg";
import {
  AdapterDiagnosticsRequestSchema,
  TechnologyCoverageRequestSchema,
  type AdapterDiagnosticsResult,
  type TechnologyCoverageResult,
} from "./adapters";
import {
  IntelligenceQuerySchema,
  QueryCancelRequestSchema,
  QueryCompileRequestSchema,
  QueryExplanationRequestSchema,
  QueryLifecycleEventSchema,
  QuerySuggestionRequestSchema,
  UnifiedQueryRequestSchema,
  type IntelligenceQueryResult,
  type QueryCompilation,
  type QueryExplanation,
  type QuerySuggestionsResult,
  type QueryTemplatesResult,
} from "./query";
import { GuidedRequestSchema, type GuidedResult } from "./guidedIntelligence";
import {
  AgentRecommendationPayloadSchema,
  AgentSelectionPayloadSchema,
  AgentsEventPayloadSchema,
  CapabilityEventPayloadSchema,
  ContextAddEntityPayloadSchema,
  ContextAddFilePayloadSchema,
  ContextBudgetPayloadSchema,
  ContextBuildPayloadSchema,
  ContextGetPayloadSchema,
  ContextItemActionPayloadSchema,
  ContextLifecycleEventSchema,
  ContextValidatePayloadSchema,
  DelegationApprovePayloadSchema,
  DelegationLifecycleEventSchema,
  DelegationPreparePayloadSchema,
  DelegationPromptPayloadSchema,
  DelegationSessionPayloadSchema,
  DelegationStartPayloadSchema,
  DelegationStatusPayloadSchema,
  WorkflowCapturePayloadSchema,
  WorkflowDecisionPayloadSchema,
  WorkflowEventPayloadSchema,
  WorkflowIdPayloadSchema,
  WorkflowSpecApprovePayloadSchema,
  WorkflowSpecRevisePayloadSchema,
  type AgentRecommendation,
  type CopilotAgentDescriptor,
  type CopilotCapabilities,
  type DelegationSession,
  type DevelopmentWorkflowSnapshot,
  type PreparedDelegation,
} from "./delegation";
import type { ContextPackage } from "./contextPackage";
import {
  WorkbenchClarificationAnswerPayloadSchema,
  WorkbenchClarificationPayloadSchema,
  WorkbenchConstraintsUpdatePayloadSchema,
  WorkbenchCreateWorkflowPayloadSchema,
  WorkbenchDependencyUpdatePayloadSchema,
  WorkbenchIntentUpdatePayloadSchema,
  WorkbenchLifecycleEventSchema,
  WorkbenchPlanApprovalPayloadSchema,
  WorkbenchScopeUpdatePayloadSchema,
  WorkbenchSpecificationApprovePayloadSchema,
  WorkbenchSpecificationUpdatePayloadSchema,
  WorkbenchStageNavigationPayloadSchema,
  WorkbenchStaleEventSchema,
  WorkbenchTaskAddPayloadSchema,
  WorkbenchTaskRemovePayloadSchema,
  WorkbenchTaskReorderPayloadSchema,
  WorkbenchTaskUpdatePayloadSchema,
  type WorkbenchCreateContext,
  type WorkbenchDefineState,
  type WorkbenchPlanState,
  type WorkbenchStageState,
  type WorkbenchSummary,
  type WorkbenchTaskPlanValidation,
  type WorkbenchWorkflowState,
} from "./workbench";
import {
  BuildBlockTaskPayloadSchema,
  BuildCustomizationSelectionPayloadSchema,
  BuildLifecycleEventSchema,
  BuildSelectTaskPayloadSchema,
  BuildSelectAgentPayloadSchema,
  BuildTaskPayloadSchema,
  type BuildTaskQueue,
  type BuildTaskState,
  type CopilotCustomizationItem,
} from "./build";
import {
  AttributeChangePayloadSchema,
  CaptureResultPayloadSchema,
  CompleteTaskPayloadSchema,
  ExecutionSessionPayloadSchema,
  ExecutionStartPayloadSchema,
  RetryPlanPayloadSchema,
  ValidationApprovePayloadSchema,
  ValidationOverridePayloadSchema,
  ValidationPlanPayloadSchema,
  ValidationRunIdPayloadSchema,
  ValidationRunPayloadSchema,
  WorkflowReportPayloadSchema,
  type CompletionDecision,
  type RetryPlan,
  type TaskExecutionSession,
  type ValidationPlan,
  type ValidationRunV2,
  type WorkflowCompletionReport,
} from "./execution";
import { ExecutionRoutingRequestSchema, type ExecutionRoutingDecision } from "./routing";
import {
  type RepositoryStatus,
  type RepositoryDiff,
  type RepositoryIdentity,
  type RepositoryHistoryEntry,
} from "./repository";
import {
  OrchestrationCreatePayloadSchema,
  OrchestrationDecisionPayloadSchema,
  OrchestrationEventSchema,
  OrchestrationIdPayloadSchema,
  OrchestrationRecoverPayloadSchema,
  OrchestrationFindingPayloadSchema,
  OrchestrationTaskActionPayloadSchema,
  OrchestrationTaskPayloadSchema,
  type WorkflowDefinition,
  type WorkflowInstance,
  type WorkflowPolicy,
  type OrchestrationReviewPlan,
} from "./orchestration";
import {
  CompleteDecisionPayloadSchema,
  ReviewAddNotePayloadSchema,
  ReviewDecisionPayloadSchema,
  ReviewDiffPayloadSchema,
  ReviewFollowUpPayloadSchema,
  ReviewRequestChangesPayloadSchema,
  ReviewResolveNotePayloadSchema,
  ReviewRiskDispositionPayloadSchema,
  ReviewUpdateNotePayloadSchema,
  ReviewWorkflowPayloadSchema,
  ReviewLifecycleEventSchema,
  type CompletionState,
  type FindingDisposition,
  type ReviewDecision,
  type ReviewNote,
  type WorkflowCompletionRecord,
  type WorkflowReviewState,
} from "./review";
import {
  ReviewChangeSetSourceSchema,
  ReviewFindingStatusSchema,
  type PullRequestReview,
  type ReviewFinding,
  type ReviewScopeAssessment,
  type ReviewTraceabilityAssessment,
  type ReviewContractAssessment,
  type ReviewTestAssessment,
  type ChangeReadinessDecision,
  type PullRequestPackage,
} from "./prReview";
import {
  type HandoffCompatibilityReport,
  type HandoffPrivacyReport,
  type TaskHandoff,
  type TaskHandoffPackage,
} from "./handoff";

export const SerializedKeystoneErrorSchema = z
  .object({
    code: z.string(),
    category: z.enum([
      "WORKSPACE",
      "INDEXING",
      "PARSING",
      "PERSISTENCE",
      "COPILOT",
      "AGENT",
      "CONTEXT",
      "VALIDATION",
      "TERMINAL",
      "WEBVIEW",
      "CONFIGURATION",
      "INTERNAL",
      "RESOURCE",
    ]),
    message: z.string(),
    technicalDetails: z.string().optional(),
    operation: z.string(),
    recoverable: z.boolean(),
    recommendedAction: z.string(),
    retryable: z.boolean(),
    correlationId: z.string(),
  })
  .strict();

export const WebviewRequestSchema = z.discriminatedUnion("type", [
  request("home/getState", z.object({}).strict()),
  request("workflow.create", z.object({ correlationId: z.string().min(1).max(200), intent: z.string().trim().min(1).max(10_000), workType: CanonicalWorkflowWorkTypeSchema, specification: z.string().trim().min(1).max(50_000).optional() }).strict()),
  request("workflow.loadActive", z.object({}).strict()),
  request("workflow.listCanonical", z.object({}).strict()),
  request("workflow.getCanonical", z.object({ workflowId: z.string().uuid() }).strict()),
  request("workflow.setActiveCanonical", z.object({ workflowId: z.string().uuid() }).strict()),
  request("stage.understand.load", z.object({ workflowId: z.string().uuid() }).strict()),
  request("stage.understand.initializeIntelligence", z.object({ workflowId: z.string().uuid() }).strict()),
  request("stage.understand.analyzeIntent", z.object({ workflowId: z.string().uuid() }).strict()),
  request("stage.understand.approveAnalysis", z.object({ workflowId: z.string().uuid() }).strict()),
  request("stage.understand.setScopeItem", z.object({ workflowId: z.string().uuid(), itemId: z.string().min(1).max(500), included: z.boolean(), reason: z.string().max(2_000).optional() }).strict()),
  request("stage.understand.resolveAmbiguity", z.object({ workflowId: z.string().uuid(), ambiguityId: z.string().min(1).max(200), resolution: z.string().min(1).max(2_000) }).strict()),
  request("stage.understand.setConfiguration", z.object({ workflowId: z.string().uuid(), mode: StageDelegationModeSchema.optional(), skill: z.string().max(200).optional(), agentId: z.string().max(200).optional(), instructionIds: z.array(z.string().min(1).max(200)).max(100).optional(), conflictResolutions: z.array(z.object({ conflictId: z.string().min(1).max(200), resolution: z.enum(["win-first", "win-second", "exclude-first", "exclude-second", "acknowledge"]), note: z.string().max(2_000).optional() })).max(100).optional() }).strict()),
  request("stage.understand.previewInstruction", z.object({ instructionId: z.string().min(1).max(200) }).strict()),
  request("stage.understand.generateContext", z.object({ workflowId: z.string().uuid() }).strict()),
  request("stage.understand.approveContext", z.object({ workflowId: z.string().uuid(), packageId: z.string().uuid(), revision: z.number().int().positive() }).strict()),
  request("stage.understand.delegate", z.object({ workflowId: z.string().uuid() }).strict()),
  request("stage.understand.captureResult", z.object({ workflowId: z.string().uuid(), source: StageResultSourceSchema, content: z.string().min(1).max(500_000), referencedFiles: z.array(z.string().max(1_000)).max(200).optional(), unresolvedQuestions: z.array(z.string().max(2_000)).max(50).optional(), notes: z.string().max(10_000).optional() }).strict()),
  request("stage.understand.validateResult", z.object({ workflowId: z.string().uuid() }).strict()),
  request("stage.understand.acceptWarnings", z.object({ workflowId: z.string().uuid() }).strict()),
  request("stage.understand.complete", z.object({ workflowId: z.string().uuid() }).strict()),
  request("stage.investigation.load", z.object({ workflowId: z.string().uuid() }).strict()),
  request("stage.investigation.upsertQuestion", z.object({ workflowId: z.string().uuid(), questionId: z.string().uuid().optional(), text: z.string().max(2_000).optional(), required: z.boolean().optional(), answer: z.string().max(20_000).optional(), evidence: z.array(StageEvidenceSchema).max(30).optional() }).strict()),
  request("stage.investigation.setConclusion", z.object({ workflowId: z.string().uuid(), conclusion: z.string().max(50_000), limitations: z.array(z.string().max(2_000)).max(30), accepted: z.boolean() }).strict()),
  request("stage.investigation.complete", z.object({ workflowId: z.string().uuid() }).strict()),
  request("stage.complete.load", z.object({ workflowId: z.string().uuid() }).strict()),
  request("stage.complete.archive", z.object({ workflowId: z.string().uuid() }).strict()),
  request("stage.plan.load", z.object({ workflowId: z.string().uuid() }).strict()),
  request("stage.plan.setConfiguration", z.object({ workflowId: z.string().uuid(), mode: StageDelegationModeSchema.optional(), skill: z.string().max(200).optional() }).strict()),
  request("stage.plan.generateContext", z.object({ workflowId: z.string().uuid() }).strict()),
  request("stage.plan.approveContext", z.object({ workflowId: z.string().uuid(), packageId: z.string().uuid(), revision: z.number().int().positive() }).strict()),
  request("stage.plan.delegate", z.object({ workflowId: z.string().uuid() }).strict()),
  request("stage.plan.capturePlan", z.object({ workflowId: z.string().uuid(), planResult: z.string().min(1).max(200_000), tasks: z.array(PlanTaskSchema).max(60).optional(), validationExpectations: z.array(z.string().max(2_000)).max(30).optional() }).strict()),
  request("stage.plan.approvePlan", z.object({ workflowId: z.string().uuid() }).strict()),
  request("stage.plan.complete", z.object({ workflowId: z.string().uuid() }).strict()),
  request("development.initialize", z.object({ correlationId: z.string().min(1).max(200), workflowId: z.string().uuid() }).strict()),
  request("development.load", z.object({ correlationId: z.string().min(1).max(200), workflowId: z.string().uuid() }).strict()),
  request("development.updateObjective", z.object({ correlationId: z.string().min(1).max(200), workflowId: z.string().uuid(), workItemId: z.string().uuid(), objective: z.string().max(10_001) }).strict()),
  request("development.addCurrentFile", z.object({ correlationId: z.string().min(1).max(200), workflowId: z.string().uuid(), workItemId: z.string().uuid() }).strict()),
  request("development.addSelectedFiles", z.object({ correlationId: z.string().min(1).max(200), workflowId: z.string().uuid(), workItemId: z.string().uuid() }).strict()),
  request("development.addCurrentSelection", z.object({ correlationId: z.string().min(1).max(200), workflowId: z.string().uuid(), workItemId: z.string().uuid() }).strict()),
  request("development.addIntelligenceSymbol", z.object({ correlationId: z.string().min(1).max(200), workflowId: z.string().uuid(), workItemId: z.string().uuid(), entityId: z.string().min(1).max(500) }).strict()),
  request("development.removeScopeItem", z.object({ correlationId: z.string().min(1).max(200), workflowId: z.string().uuid(), workItemId: z.string().uuid(), scopeItemId: z.string().uuid() }).strict()),
  request("development.preparePrompt", z.object({ correlationId: z.string().min(1).max(200), workflowId: z.string().uuid(), workItemId: z.string().uuid(), notes: z.string().max(10_000).optional() }).strict()),
  request("development.context.build", z.object({ correlationId: z.string().min(1).max(200), workflowId: z.string().uuid(), workItemId: z.string().uuid(), budgetTokens: z.number().int().min(500).max(1_000_000), notes: z.string().max(10_000).optional(), pinnedItemIds: z.array(z.string().max(500)).max(100).default([]) }).strict()),
  request("development.context.changeBudget", z.object({ correlationId: z.string().min(1).max(200), workflowId: z.string().uuid(), workItemId: z.string().uuid(), packageId: z.string().uuid(), revision: z.number().int().positive(), budgetTokens: z.number().int().min(500).max(1_000_000), notes: z.string().max(10_000).optional(), pinnedItemIds: z.array(z.string().max(500)).max(100).default([]) }).strict()),
  request("development.context.approve", z.object({ correlationId: z.string().min(1).max(200), workflowId: z.string().uuid(), workItemId: z.string().uuid(), packageId: z.string().uuid(), revision: z.number().int().positive(), fingerprint: z.string().regex(/^[a-f0-9]{64}$/) }).strict()),
  request("development.context.pin", z.object({ correlationId: z.string().min(1).max(200), workflowId: z.string().uuid(), workItemId: z.string().uuid(), packageId: z.string().uuid(), revision: z.number().int().positive(), itemId: z.string().min(1).max(500), pinned: z.boolean() }).strict()),
  request("development.context.remove", z.object({ correlationId: z.string().min(1).max(200), workflowId: z.string().uuid(), workItemId: z.string().uuid(), packageId: z.string().uuid(), revision: z.number().int().positive(), itemId: z.string().min(1).max(500), overrideRequired: z.boolean().default(false) }).strict()),
  request("development.context.restore", z.object({ correlationId: z.string().min(1).max(200), workflowId: z.string().uuid(), workItemId: z.string().uuid(), packageId: z.string().uuid(), revision: z.number().int().positive(), itemId: z.string().min(1).max(500) }).strict()),
  request("development.copyPrompt", z.object({ correlationId: z.string().min(1).max(200), workflowId: z.string().uuid(), workItemId: z.string().uuid() }).strict()),
  request("development.confirmHandoff", z.object({ correlationId: z.string().min(1).max(200), workflowId: z.string().uuid(), workItemId: z.string().uuid() }).strict()),
  request("development.recordManualOrigin", z.object({ correlationId: z.string().min(1).max(200), workflowId: z.string().uuid(), workItemId: z.string().uuid() }).strict()),
  request("development.loadChanges", z.object({ correlationId: z.string().min(1).max(200), workflowId: z.string().uuid(), workItemId: z.string().uuid() }).strict()),
  request("development.recordResult", z.object({ correlationId: z.string().min(1).max(200), workflowId: z.string().uuid(), workItemId: z.string().uuid(), summary: z.string().max(20_001), decisions: z.string().max(20_000).optional(), assumptions: z.string().max(20_000).optional(), testsRun: z.string().max(20_000).optional(), unresolvedIssues: z.string().max(20_000).optional() }).strict()),
  request("development.associateChangedFiles", z.object({ correlationId: z.string().min(1).max(200), workflowId: z.string().uuid(), workItemId: z.string().uuid(), resultId: z.string().uuid(), associated: z.array(z.string().min(1).max(10_000)).max(1000), excluded: z.array(z.object({ path: z.string().min(1).max(10_000), reason: z.string().trim().min(1).max(2000) }).strict()).max(1000) }).strict()),
  request("development.confirmNoCode", z.object({ correlationId: z.string().min(1).max(200), workflowId: z.string().uuid(), workItemId: z.string().uuid(), resultId: z.string().uuid(), explanation: z.string().max(5000), confirmed: z.boolean() }).strict()),
  request("development.reviewResult", z.object({ correlationId: z.string().min(1).max(200), workflowId: z.string().uuid(), workItemId: z.string().uuid(), resultId: z.string().uuid(), decision: z.enum(["accepted", "changes-requested"]) }).strict()),
  request("development.complete", z.object({ correlationId: z.string().min(1).max(200), workflowId: z.string().uuid(), workItemId: z.string().uuid() }).strict()),
  request("impact.load", z.object({ correlationId: z.string().min(1).max(200), workflowId: z.string().uuid() }).strict()),
  request("impact.detect", z.object({ correlationId: z.string().min(1).max(200), workflowId: z.string().uuid(), manualSelection: z.boolean() }).strict()),
  request("impact.openChangedFile", z.object({ correlationId: z.string().min(1).max(200), workflowId: z.string().uuid(), path: z.string().min(1).max(2000) }).strict()),
  request("impact.acceptChangeSet", z.object({ correlationId: z.string().min(1).max(200), workflowId: z.string().uuid(), expectedHash: z.string().startsWith("sha256:") }).strict()),
  request("impact.analyze", z.object({ correlationId: z.string().min(1).max(200), workflowId: z.string().uuid(), expectedHash: z.string().startsWith("sha256:") }).strict()),
  request("impact.acceptAnalysis", z.object({ correlationId: z.string().min(1).max(200), workflowId: z.string().uuid(), impactAnalysisId: z.string().min(1).max(500), expectedHash: z.string().startsWith("sha256:") }).strict()),
  request("qa.generatePlan", z.object({ correlationId: z.string().min(1).max(200), workflowId: z.string().uuid(), qaMode: z.enum(["recommend", "legacy-modernize", "flaky-focused", "coverage-gap"]).optional(), testMode: z.enum(["impacted", "affected-suite", "all"]).optional() }).strict()),
  request("qa.updatePlan", z.object({ correlationId: z.string().min(1).max(200), workflowId: z.string().uuid(), itemId: z.string().min(1).max(500), selected: z.boolean(), overrideReason: z.string().min(1).max(2000).optional() }).strict()),
  request("qa.approvePlan", z.object({ correlationId: z.string().min(1).max(200), workflowId: z.string().uuid(), qaPlanId: z.string().min(1).max(500), expectedHash: z.string().startsWith("sha256:") }).strict()),
  request("qa.execute", z.object({ correlationId: z.string().min(1).max(200), workflowId: z.string().uuid(), qaPlanId: z.string().min(1).max(500) }).strict()),
  request("qa.cancel", z.object({ correlationId: z.string().min(1).max(200), workflowId: z.string().uuid(), commandId: z.string().min(1).max(500) }).strict()),
  request("testIntelligence.load", z.object({ correlationId: z.string().min(1).max(200), workflowId: z.string().uuid() }).strict()),
  request("testIntelligence.createGenerationRequest", z.object({ correlationId: z.string().min(1).max(200), workflowId: z.string().uuid(), coverageGapId: z.string().min(1).max(500) }).strict()),
  request("testIntelligence.deriveScenarios", z.object({ correlationId: z.string().min(1).max(200), workflowId: z.string().uuid(), generationRequestId: z.string().min(1).max(500) }).strict()),
  request("testIntelligence.updateScenario", z.object({ correlationId: z.string().min(1).max(200), workflowId: z.string().uuid(), scenarioId: z.string().min(1).max(500), title: z.string().min(1).max(500).optional(), behaviour: z.string().min(1).max(5000).optional(), selected: z.boolean().optional(), removalReason: z.string().min(1).max(2000).optional() }).strict()),
  request("testIntelligence.approveScenarios", z.object({ correlationId: z.string().min(1).max(200), workflowId: z.string().uuid(), generationRequestId: z.string().min(1).max(500) }).strict()),
  request("testIntelligence.buildGenerationContext", z.object({ correlationId: z.string().min(1).max(200), workflowId: z.string().uuid(), generationRequestId: z.string().min(1).max(500), budgetTokens: z.number().int().min(500).max(1_000_000) }).strict()),
  request("testIntelligence.approveGenerationContext", z.object({ correlationId: z.string().min(1).max(200), workflowId: z.string().uuid(), generationRequestId: z.string().min(1).max(500), packageId: z.string().uuid(), revision: z.number().int().positive(), fingerprint: z.string().regex(/^[a-f0-9]{64}$/) }).strict()),
  request("testIntelligence.recordProposal", z.object({ correlationId: z.string().min(1).max(200), workflowId: z.string().uuid(), generationRequestId: z.string().min(1).max(500), proposal: StructuredProposalIngestSchema }).strict()),
  request("testIntelligence.validateProposalPolicy", z.object({ correlationId: z.string().min(1).max(200), workflowId: z.string().uuid(), proposalId: z.string().min(1).max(500) }).strict()),
  request("testIntelligence.applyProposal", z.object({ correlationId: z.string().min(1).max(200), workflowId: z.string().uuid(), proposalId: z.string().min(1).max(500), selectedChangeIds: z.array(z.string().min(1).max(500)).max(200) }).strict()),
  request("testIntelligence.revertApplied", z.object({ correlationId: z.string().min(1).max(200), workflowId: z.string().uuid(), appliedChangeId: z.string().min(1).max(500) }).strict()),
  request("testIntelligence.createFailureAnalysis", z.object({ correlationId: z.string().min(1).max(200), workflowId: z.string().uuid(), testFailureId: z.string().min(1).max(500) }).strict()),
  request("testIntelligence.acceptFailureClassification", z.object({ correlationId: z.string().min(1).max(200), workflowId: z.string().uuid(), analysisId: z.string().min(1).max(500), category: FailureCategorySchema }).strict()),
  request("testIntelligence.requestRepeatedRuns", z.object({ correlationId: z.string().min(1).max(200), workflowId: z.string().uuid(), testId: z.string().min(1).max(500), count: z.number().int().min(1).max(20), mode: z.enum(["default", "seed", "isolation", "related-file", "suite-order"]).default("default"), seed: z.string().max(200).optional() }).strict()),
  request("testIntelligence.loadFlakyHistory", z.object({ correlationId: z.string().min(1).max(200), workflowId: z.string().uuid(), testId: z.string().min(1).max(500) }).strict()),
  request("testIntelligence.createRemediationProposal", z.object({ correlationId: z.string().min(1).max(200), workflowId: z.string().uuid(), analysisId: z.string().min(1).max(500), proposal: StructuredProposalIngestSchema }).strict()),
  request("testIntelligence.validateRemediationPolicy", z.object({ correlationId: z.string().min(1).max(200), workflowId: z.string().uuid(), proposalId: z.string().min(1).max(500) }).strict()),
  request("testIntelligence.applyRemediation", z.object({ correlationId: z.string().min(1).max(200), workflowId: z.string().uuid(), proposalId: z.string().min(1).max(500), selectedChangeIds: z.array(z.string().min(1).max(500)).max(200) }).strict()),
  request("testIntelligence.runValidationSequence", z.object({ correlationId: z.string().min(1).max(200), workflowId: z.string().uuid(), source: ValidationSourceSchema, sourceRecordId: z.string().min(1).max(500) }).strict()),
  request("testIntelligence.loadValidationState", z.object({ correlationId: z.string().min(1).max(200), workflowId: z.string().uuid(), source: ValidationSourceSchema, sourceRecordId: z.string().min(1).max(500) }).strict()),
  request("testIntelligence.refreshQaDecision", z.object({ correlationId: z.string().min(1).max(200), workflowId: z.string().uuid() }).strict()),
  request("executionConfiguration.load", z.object({ correlationId: z.string().min(1).max(200), workflowId: z.string().uuid(), workItemId: z.string().uuid() }).strict()),
  request("executionConfiguration.refresh", z.object({ correlationId: z.string().min(1).max(200), workflowId: z.string().uuid(), workItemId: z.string().uuid() }).strict()),
  request("executionConfiguration.discoverInstructions", z.object({ correlationId: z.string().min(1).max(200), workflowId: z.string().uuid(), workItemId: z.string().uuid() }).strict()),
  request("executionConfiguration.listSkills", z.object({ correlationId: z.string().min(1).max(200), workflowId: z.string().uuid(), workItemId: z.string().uuid() }).strict()),
  request("executionConfiguration.detectConflicts", z.object({ correlationId: z.string().min(1).max(200), workflowId: z.string().uuid(), workItemId: z.string().uuid(), instructionIds: z.array(z.string().min(1).max(200)).max(100) }).strict()),
  request("executionConfiguration.createManualAgent", z.object({ correlationId: z.string().min(1).max(200), workflowId: z.string().uuid(), workItemId: z.string().uuid(), displayName: z.string().max(201), chatCommandId: z.string().max(500).optional(), usageNote: z.string().max(2000).optional() }).strict()),
  request("executionConfiguration.updateManualAgent", z.object({ correlationId: z.string().min(1).max(200), workflowId: z.string().uuid(), workItemId: z.string().uuid(), agentId: z.string().uuid(), displayName: z.string().max(201), chatCommandId: z.string().max(500).optional(), usageNote: z.string().max(2000).optional() }).strict()),
  request("executionConfiguration.deleteManualAgent", z.object({ correlationId: z.string().min(1).max(200), workflowId: z.string().uuid(), workItemId: z.string().uuid(), agentId: z.string().uuid() }).strict()),
  request("executionConfiguration.addInstructionFile", z.object({ correlationId: z.string().min(1).max(200), workflowId: z.string().uuid(), workItemId: z.string().uuid() }).strict()),
  request("executionConfiguration.previewInstruction", z.object({ correlationId: z.string().min(1).max(200), workflowId: z.string().uuid(), workItemId: z.string().uuid(), instructionId: z.string().min(1).max(200) }).strict()),
  request("executionConfiguration.previewSkill", z.object({ correlationId: z.string().min(1).max(200), workflowId: z.string().uuid(), workItemId: z.string().uuid(), skillId: z.string().min(1).max(200) }).strict()),
  request("executionConfiguration.validateProfile", z.object({ correlationId: z.string().min(1).max(200), workflowId: z.string().uuid(), workItemId: z.string().uuid(), executionCapabilityId: z.string().min(1).max(200), agentConfigurationId: z.string().min(1).max(500).optional(), skillId: z.string().min(1).max(200), instructionIds: z.array(z.string().min(1).max(200)).max(100) }).strict()),
  request("executionConfiguration.saveProfile", z.object({ correlationId: z.string().min(1).max(200), workflowId: z.string().uuid(), workItemId: z.string().uuid(), executionCapabilityId: z.string().min(1).max(200), agentConfigurationId: z.string().min(1).max(500).optional(), skillId: z.string().min(1).max(200), instructionIds: z.array(z.string().min(1).max(200)).max(100) }).strict()),
  request("review/getState", ReviewWorkflowPayloadSchema),
  request("review/getSummary", ReviewWorkflowPayloadSchema),
  request("review/getTraceability", ReviewWorkflowPayloadSchema),
  request("review/getChanges", ReviewWorkflowPayloadSchema),
  request("review/getDiff", ReviewDiffPayloadSchema),
  request(
    "review/attributeChange",
    ReviewWorkflowPayloadSchema.extend({
      path: z.string().min(1).max(1024),
      classification: z.enum(["expected", "related", "pre-existing", "excluded"]),
      reason: z.string().min(1).max(2000),
    }).strict(),
  ),
  request("review/getQa", ReviewWorkflowPayloadSchema),
  request("review/getSecurity", ReviewWorkflowPayloadSchema),
  request("review/getPerformance", ReviewWorkflowPayloadSchema),
  request("review/getDocumentation", ReviewWorkflowPayloadSchema),
  request("review/addNote", ReviewAddNotePayloadSchema),
  request("review/updateNote", ReviewUpdateNotePayloadSchema),
  request("review/resolveNote", ReviewResolveNotePayloadSchema),
  request("review/requestChanges", ReviewRequestChangesPayloadSchema),
  request("review/createFollowUpTask", ReviewFollowUpPayloadSchema),
  request("review/generatePrDraft", ReviewWorkflowPayloadSchema),
  request("review/getPrDraft", ReviewWorkflowPayloadSchema),
  request("review/getPrChecklist", ReviewWorkflowPayloadSchema),
  request("review/getReadiness", ReviewWorkflowPayloadSchema),
  request("review/approve", ReviewDecisionPayloadSchema),
  request("review/approveWithWarnings", ReviewDecisionPayloadSchema),
  request("review/reject", ReviewDecisionPayloadSchema),
  request("review/returnToBuild", ReviewRequestChangesPayloadSchema),
  request("review/returnToDefine", ReviewRequestChangesPayloadSchema),
  request("review/dispositionFinding", ReviewRiskDispositionPayloadSchema),
  // Phase 10 — Evidence-Backed PR Review (deterministic; no git/PR writes performed here).
  request(
    "pr-review/prepare",
    z
      .object({
        workflowId: z.string().min(1).max(200),
        overrideChangeSet: ReviewChangeSetSourceSchema.optional(),
        confirmPartial: z.boolean().optional(),
      })
      .strict(),
  ),
  request("pr-review/getState", z.object({ workflowId: z.string().min(1).max(200) }).strict()),
  request("pr-review/getFindings", z.object({ workflowId: z.string().min(1).max(200) }).strict()),
  request(
    "pr-review/updateFindingStatus",
    z
      .object({
        workflowId: z.string().min(1).max(200),
        findingId: z.string().min(1).max(200),
        status: ReviewFindingStatusSchema,
        resolutionEvidence: z.array(z.string().min(1).max(2000)).max(500).optional(),
        justification: z.string().min(1).max(5000).optional(),
      })
      .strict(),
  ),
  request("pr-review/calculateReadiness", z.object({ workflowId: z.string().min(1).max(200) }).strict()),
  request(
    "pr-review/approveReadiness",
    z
      .object({
        workflowId: z.string().min(1).max(200),
        decision: z.enum(["ready", "ready-with-warnings"]),
        reason: z.string().min(1).max(5000),
      })
      .strict(),
  ),
  request("pr-review/generatePackage", z.object({ workflowId: z.string().min(1).max(200) }).strict()),
  // Phase 11 — Task Handoff (portable local package; no git/PR/account operations).
  request("taskHandoff/checkEligibility", z.object({ workflowId: z.string().min(1).max(200) }).strict()),
  request("taskHandoff/createDraft", z.object({ workflowId: z.string().min(1).max(200) }).strict()),
  request(
    "taskHandoff/updateDraft",
    z
      .object({
        workflowId: z.string().min(1).max(200),
        handoffId: z.string().min(1).max(200),
        progressSummary: z.string().min(1).max(20_000).optional(),
        completedWork: z.array(z.string().min(1).max(2000)).max(500).optional(),
        unresolvedWork: z.array(z.string().min(1).max(2000)).max(500).optional(),
        blockers: z.array(z.string().min(1).max(2000)).max(500).optional(),
        assumptions: z.array(z.string().min(1).max(2000)).max(500).optional(),
        nextActionTitle: z.string().min(1).max(2000).optional(),
        nextActionDescription: z.string().min(1).max(20_000).optional(),
        nextActionStageId: z.string().min(1).max(200).optional(),
        nextActionWorkItemId: z.string().min(1).max(200).optional(),
        senderLabel: z.string().min(1).max(200).optional(),
      })
      .strict(),
  ),
  request("taskHandoff/runPrivacyScan", z.object({ handoffId: z.string().min(1).max(200) }).strict()),
  request("taskHandoff/markRedacted", z.object({ handoffId: z.string().min(1).max(200), findingId: z.string().min(1).max(200) }).strict()),
  request(
    "taskHandoff/export",
    z.object({ handoffId: z.string().min(1).max(200), expectedRevision: z.number().int().nonnegative(), targetPath: z.string().min(1).max(4000) }).strict(),
  ),
  request("taskHandoff/listHistory", z.object({ workflowId: z.string().min(1).max(200) }).strict()),
  request("taskHandoff/previewImport", z.object({ rawContent: z.string().min(1).max(5_000_000) }).strict()),
  request("taskHandoff/acceptImport", z.object({ rawContent: z.string().min(1).max(5_000_000), receiverLabel: z.string().min(1).max(200).optional(), receiverNotes: z.string().min(1).max(20_000).optional() }).strict()),
  request("taskHandoff/rejectImport", z.object({ rawContent: z.string().min(1).max(5_000_000) }).strict()),
  request(
    "pr-review/updatePackage",
    z
      .object({
        workflowId: z.string().min(1).max(200),
        title: z.string().min(1).max(200).optional(),
        description: z.string().min(1).max(20_000).optional(),
      })
      .strict(),
  ),
  request("complete/getState", ReviewWorkflowPayloadSchema),
  request("complete/getOptions", ReviewWorkflowPayloadSchema),
  request("complete/getReport", ReviewWorkflowPayloadSchema),
  request("complete/completeLocally", CompleteDecisionPayloadSchema),
  request("complete/closePartial", CompleteDecisionPayloadSchema),
  request("complete/cancelWithChanges", CompleteDecisionPayloadSchema),
  request("complete/archive", ReviewWorkflowPayloadSchema),
  request("orchestration/create", OrchestrationCreatePayloadSchema),
  request("orchestration/get", OrchestrationIdPayloadSchema),
  request("orchestration/list", z.object({}).strict()),
  request("orchestration/definitions", z.object({}).strict()),
  request("orchestration/policies", z.object({}).strict()),
  request("orchestration/plan", OrchestrationIdPayloadSchema),
  request("orchestration/validatePlan", OrchestrationIdPayloadSchema),
  request("orchestration/start", OrchestrationIdPayloadSchema),
  request("orchestration/pause", OrchestrationIdPayloadSchema),
  request("orchestration/resume", OrchestrationRecoverPayloadSchema),
  request("orchestration/cancel", OrchestrationIdPayloadSchema),
  request("orchestration/recover", OrchestrationRecoverPayloadSchema),
  request("orchestration/status", OrchestrationIdPayloadSchema),
  request("orchestration/taskReadiness", OrchestrationTaskPayloadSchema),
  request("orchestration/startTask", OrchestrationTaskActionPayloadSchema),
  request("orchestration/pauseTask", OrchestrationTaskActionPayloadSchema),
  request("orchestration/cancelTask", OrchestrationTaskActionPayloadSchema),
  request("orchestration/retryTask", OrchestrationTaskActionPayloadSchema),
  request("orchestration/changeAgent", OrchestrationTaskActionPayloadSchema),
  request("orchestration/skipOptionalTask", OrchestrationTaskActionPayloadSchema),
  request("orchestration/schedule", OrchestrationIdPayloadSchema),
  request("orchestration/conflicts", OrchestrationIdPayloadSchema),
  request("orchestration/approvals", OrchestrationIdPayloadSchema),
  request("orchestration/approve", OrchestrationDecisionPayloadSchema),
  request("orchestration/reject", OrchestrationDecisionPayloadSchema),
  request("orchestration/requestChanges", OrchestrationDecisionPayloadSchema),
  request("orchestration/override", OrchestrationDecisionPayloadSchema),
  request("orchestration/qaPlan", OrchestrationIdPayloadSchema),
  request("orchestration/qaRun", OrchestrationIdPayloadSchema),
  request("orchestration/qaFinding", OrchestrationFindingPayloadSchema),
  request("orchestration/qaAccept", OrchestrationFindingPayloadSchema),
  request("orchestration/qaReturn", OrchestrationFindingPayloadSchema),
  request("orchestration/securityPlan", OrchestrationIdPayloadSchema),
  request("orchestration/securityRun", OrchestrationIdPayloadSchema),
  request("orchestration/securityFinding", OrchestrationFindingPayloadSchema),
  request("orchestration/securityAccept", OrchestrationFindingPayloadSchema),
  request("orchestration/performancePlan", OrchestrationIdPayloadSchema),
  request("orchestration/performanceRun", OrchestrationIdPayloadSchema),
  request("orchestration/performanceFinding", OrchestrationFindingPayloadSchema),
  request("orchestration/performanceAccept", OrchestrationFindingPayloadSchema),
  request("orchestration/validationPlan", OrchestrationIdPayloadSchema),
  request("orchestration/runValidation", OrchestrationIdPayloadSchema),
  request("orchestration/rerunValidation", OrchestrationIdPayloadSchema),
  request("orchestration/cancelValidation", OrchestrationIdPayloadSchema),
  request("orchestration/audit", OrchestrationIdPayloadSchema),
  request("orchestration/metrics", OrchestrationIdPayloadSchema),
  request("orchestration/report", OrchestrationIdPayloadSchema),
  request("app/bootstrap", z.object({}).strict()),
  request("app/ping", z.object({}).strict()),
  request(
    "navigation/set",
    z.union([
      z.object({ route: AppRouteSchema }).strict(),
      z.object({ section: NavigationSectionSchema }).strict(),
    ]),
  ),
  request("settings/open", z.object({ query: z.string().max(120).optional() }).strict()),
  request("logs/show", z.object({}).strict()),
  request("intelligence/overview", z.object({}).strict()),
  request("intelligence/scan/start", z.object({}).strict()),
  request("intelligence/scan/cancel", z.object({}).strict()),
  request("intelligence/runtime/pause", z.object({}).strict()),
  request("intelligence/runtime/resume", z.object({}).strict()),
  request("intelligence/search", IntelligenceSearchRequestSchema),
  request("intelligence/diagnostics", IntelligenceDiagnosticsRequestSchema),
  request("intelligence/entity", IntelligenceEntityRequestSchema),
  request("intelligence/neighborhood", IntelligenceNeighborhoodRequestSchema),
  request("intelligence.canvas.search", IntelligenceCanvasSearchRequestSchema),
  request("intelligence.canvas.graph", IntelligenceGraphSliceRequestSchema),
  request("intelligence.canvas.expand", IntelligenceGraphSliceRequestSchema),
  request("intelligence.canvas.evidence", IntelligenceCanvasEvidenceRequestSchema),
  request("intelligence.canvas.query", IntelligenceCanvasQueryRequestSchema),
  request("intelligence.canvas.openSource", IntelligenceCanvasEntityActionRequestSchema),
  request("intelligence.canvas.openEvidenceSource", IntelligenceCanvasEvidenceActionRequestSchema),
  request("intelligence.canvas.addScope", IntelligenceCanvasEntityActionRequestSchema),
  request("intelligence.canvas.addContext", IntelligenceCanvasEntityActionRequestSchema),
  request("intelligence.canvas.addPathContext", IntelligenceCanvasPathActionRequestSchema),
  request("intelligence/technologies", TechnologyCoverageRequestSchema),
  request("intelligence/adapter-diagnostics", AdapterDiagnosticsRequestSchema),
  request("intelligence/query", UnifiedQueryRequestSchema),
  request("intelligence/query/compile", QueryCompileRequestSchema),
  request("intelligence/query/cancel", QueryCancelRequestSchema),
  request("intelligence/query/suggestions", QuerySuggestionRequestSchema),
  request("intelligence/query/templates", z.object({}).strict()),
  request("intelligence/query/explanation", QueryExplanationRequestSchema),
  request("intelligence/path", IntelligenceQuerySchema),
  request("intelligence/impact", IntelligenceQuerySchema),
  request("intelligence/flow", IntelligenceQuerySchema),
  request("intelligence/architecture", IntelligenceQuerySchema),
  request("intelligence/dependencies", IntelligenceQuerySchema),
  request("intelligence/tests", IntelligenceQuerySchema),
  request("intelligence/changes", IntelligenceQuerySchema),
  request("intelligence/cpg", IntelligenceQuerySchema),
  request("intelligence/cpg/scope", CpgScopeQuerySchema),
  request("intelligence/cpg/slice", CpgSliceQuerySchema),
  request("intelligence/guided", GuidedRequestSchema),
  request(
    "intelligence/exported-symbols",
    z.object({ fileId: z.string().min(1).optional() }).strict(),
  ),
  request(
    "intelligence/wildcard-search",
    z
      .object({
        pattern: z.string().min(1).max(500),
        fields: z
          .array(z.enum(["name", "qualifiedName", "relativePath", "type", "language"]))
          .max(5)
          .optional(),
        limit: z.number().int().min(1).max(200).optional(),
      })
      .strict(),
  ),
  request("intelligence/module-mapping", z.object({}).strict()),
  request("intelligence/circular-dependencies", z.object({}).strict()),
  request("intelligence/node-metrics", z.object({}).strict()),
  request("intelligence/dead-code", z.object({}).strict()),
  request(
    "intelligence/filtered-subgraph",
    z
      .object({
        seedIds: z.array(z.string().min(1)).min(1).max(20),
        direction: z.enum(["incoming", "outgoing", "both"]).optional(),
        maxDepth: z.number().int().min(1).max(10).optional(),
      })
      .strict(),
  ),
  request("intelligence/cyclomatic-complexity", z.object({}).strict()),
  request(
    "intelligence/source/open",
    z
      .object({
        relativePath: z.string().min(1).max(1024),
        range: SourceRangeSchema.optional(),
      })
      .strict(),
  ),
  request("workflow/capture", WorkflowCapturePayloadSchema),
  request("workflow/list", z.object({}).strict()),
  request("workflow/get", WorkflowIdPayloadSchema),
  request("workflow/spec/submit", WorkflowIdPayloadSchema),
  request("workflow/spec/revise", WorkflowSpecRevisePayloadSchema),
  request("workflow/spec/resolveDecision", WorkflowDecisionPayloadSchema),
  request("workflow/spec/approve", WorkflowSpecApprovePayloadSchema),
  request("workflow/tasks/generate", WorkflowIdPayloadSchema),
  request("workflow/reconcile", WorkflowIdPayloadSchema),
  request("workbench/getCreateContext", z.object({}).strict()),
  request("workbench/createWorkflow", WorkbenchCreateWorkflowPayloadSchema),
  request("workbench/getWorkflow", WorkflowIdPayloadSchema),
  request("workbench/listWorkflows", z.object({}).strict()),
  request("workbench/openWorkflow", WorkbenchStageNavigationPayloadSchema),
  request("workbench/getDefineState", WorkflowIdPayloadSchema),
  request("workbench/updateIntent", WorkbenchIntentUpdatePayloadSchema),
  request("workbench/updateScope", WorkbenchScopeUpdatePayloadSchema),
  request("workbench/updateConstraints", WorkbenchConstraintsUpdatePayloadSchema),
  request("workbench/getClarifications", WorkflowIdPayloadSchema),
  request("workbench/answerClarification", WorkbenchClarificationAnswerPayloadSchema),
  request("workbench/deferClarification", WorkbenchClarificationPayloadSchema),
  request("workbench/markClarificationNotApplicable", WorkbenchClarificationPayloadSchema),
  request("workbench/reopenClarification", WorkbenchClarificationPayloadSchema),
  request("workbench/generateSpecification", WorkflowIdPayloadSchema),
  request("workbench/updateSpecification", WorkbenchSpecificationUpdatePayloadSchema),
  request("workbench/generateAcceptanceCriteria", WorkflowIdPayloadSchema),
  request("workbench/approveSpecification", WorkbenchSpecificationApprovePayloadSchema),
  request("workbench/getPlanState", WorkflowIdPayloadSchema),
  request("workbench/generateTaskPlan", WorkflowIdPayloadSchema),
  request("workbench/updateTask", WorkbenchTaskUpdatePayloadSchema),
  request("workbench/addTask", WorkbenchTaskAddPayloadSchema),
  request("workbench/removeTask", WorkbenchTaskRemovePayloadSchema),
  request("workbench/reorderTask", WorkbenchTaskReorderPayloadSchema),
  request("workbench/updateDependency", WorkbenchDependencyUpdatePayloadSchema),
  request("workbench/validateTaskPlan", WorkflowIdPayloadSchema),
  request("workbench/approveTaskPlan", WorkbenchPlanApprovalPayloadSchema),
  request("workbench/getStageStates", WorkflowIdPayloadSchema),
  request("workbench/navigateStage", WorkbenchStageNavigationPayloadSchema),
  request("workbench/getSummary", WorkflowIdPayloadSchema),
  request("build/getTaskQueue", WorkflowIdPayloadSchema),
  request("build/getTaskState", BuildTaskPayloadSchema),
  request("build/selectTask", BuildSelectTaskPayloadSchema),
  request("build/startTask", BuildTaskPayloadSchema),
  request("build/pauseTask", BuildTaskPayloadSchema),
  request("build/resumeTask", BuildTaskPayloadSchema),
  request("build/blockTask", BuildBlockTaskPayloadSchema),
  request("build/cancelTask", BuildTaskPayloadSchema),
  request("build/getCopilotCapabilities", BuildTaskPayloadSchema),
  request("build/getCustomizations", BuildTaskPayloadSchema),
  request("build/updateCustomizationSelection", BuildCustomizationSelectionPayloadSchema),
  request("build/getAgents", BuildTaskPayloadSchema),
  request("build/selectAgent", BuildSelectAgentPayloadSchema),
  request("build/createContext", ContextBuildPayloadSchema),
  request("build/getContext", ContextGetPayloadSchema),
  request("build/updateContextItem", ContextItemActionPayloadSchema),
  request("build/pinContextItem", ContextItemActionPayloadSchema),
  request("build/excludeContextItem", ContextItemActionPayloadSchema),
  request("build/regenerateContext", ContextBuildPayloadSchema),
  request("build/getPromptPreview", DelegationPromptPayloadSchema),
  request("build/prepareDelegation", DelegationPreparePayloadSchema),
  request("build/approveDelegation", DelegationApprovePayloadSchema),
  request("build/startDelegation", DelegationStartPayloadSchema),
  request("build/confirmAssistedState", DelegationSessionPayloadSchema),
  request("build/cancelDelegation", DelegationSessionPayloadSchema),
  request("build/getExecutionState", ExecutionSessionPayloadSchema),
  request("build/getRepositoryChanges", ExecutionSessionPayloadSchema),
  request("build/updateChangeAttribution", AttributeChangePayloadSchema),
  request(
    "build/getDiff",
    z
      .object({
        path: z.string().max(1024),
        mode: z.enum(["working-head", "index-head", "working-index"]),
        maxBytes: z.number().int().min(1000).max(100_000).default(50_000),
      })
      .strict(),
  ),
  request("build/refreshChanges", ExecutionSessionPayloadSchema),
  request("build/getValidationPlan", z.object({ planId: z.string().uuid() }).strict()),
  request("build/runValidation", ValidationRunPayloadSchema),
  request("build/cancelValidation", ValidationRunIdPayloadSchema),
  request(
    "build/rerunValidation",
    ValidationRunIdPayloadSchema.extend({ stepId: z.string().uuid() }).strict(),
  ),
  request(
    "build/addManualEvidence",
    ValidationRunIdPayloadSchema.extend({
      criterionId: z.string().max(200),
      statement: z.string().min(1).max(5000),
    }).strict(),
  ),
  request("build/getAcceptanceCriteriaState", ValidationRunIdPayloadSchema),
  request("build/prepareRetry", RetryPlanPayloadSchema),
  request("build/updateRetryAgent", RetryPlanPayloadSchema),
  request("build/approveRetry", ExecutionSessionPayloadSchema),
  request("build/startRetry", ExecutionSessionPayloadSchema),
  request("build/getCompletionReadiness", ExecutionSessionPayloadSchema),
  request("build/requestCompletionReview", ExecutionSessionPayloadSchema),
  request("copilot/capabilities", z.object({}).strict()),
  request("copilot/refreshCapabilities", z.object({}).strict()),
  request("copilot/agents", z.object({}).strict()),
  request("copilot/refreshAgents", z.object({}).strict()),
  request("copilot/agentRecommendation", AgentRecommendationPayloadSchema),
  request("copilot/selectAgent", AgentSelectionPayloadSchema),
  request("copilot/getCapabilities", z.object({}).strict()),
  request("copilot/getIntegrationStatus", z.object({}).strict()),
  request("copilot/listCustomizations", CopilotScopePayloadSchema),
  request("copilot/getCustomization", CopilotCustomizationIdPayloadSchema),
  request("copilot/refreshCustomizations", CopilotScopePayloadSchema),
  request("copilot/setCustomizationEnabled", CopilotCustomizationTogglePayloadSchema),
  request("copilot/getApplicableCustomizations", CopilotScopePayloadSchema),
  request("copilot/listAgents", CopilotScopePayloadSchema),
  request("copilot/getAgent", z.object({ agentId: z.string().min(1).max(500) }).strict()),
  request("copilot/recommendAgent", CopilotScopePayloadSchema),
  request("copilot/listKeystoneTools", z.object({}).strict()),
  request("copilot/getToolStatus", z.object({ toolName: z.string().min(1).max(100) }).strict()),
  request(
    "copilot/getToolAudit",
    z.object({ limit: z.number().int().min(1).max(200).default(50) }).strict(),
  ),
  request("copilot/testTool", CopilotToolTestPayloadSchema),
  request("copilot/prepareAssistedLaunch", AssistedLaunchPayloadSchema),
  request("copilot/getPreparedPrompt", AssistedLaunchIdPayloadSchema),
  request("copilot/openChat", AssistedLaunchIdPayloadSchema),
  request("copilot/copyPrompt", AssistedLaunchIdPayloadSchema),
  request("copilot/confirmSubmission", AssistedLaunchIdPayloadSchema),
  request("copilot/cancelAssistedLaunch", AssistedLaunchIdPayloadSchema),
  request("copilot/getParticipantStatus", z.object({}).strict()),
  request("copilot/openParticipant", z.object({}).strict()),
  request("copilot/disableParticipant", z.object({}).strict()),
  request("keystone/webviewReady", WebviewReadyPayloadSchema),
  request("keystone/initializationAcknowledged", InitializationAcknowledgedPayloadSchema),
  request("keystone/navigationAcknowledged", NavigationAcknowledgedPayloadSchema),
  request("keystone/webviewStateChanged", WebviewStateChangedPayloadSchema),
  request("dashboard/getState", z.object({}).strict()),
  request("dashboard/refresh", z.object({}).strict()),
  request("dashboard/openAction", z.object({ itemId: z.string().min(1).max(500) }).strict()),
  request("panel/getState", z.object({}).strict()),
  request("panel/updateState", WebviewStateChangedPayloadSchema),
  request("panel/getPendingNavigation", z.object({}).strict()),
  request("navigation/validateTarget", OpenKeystoneRequestSchema),
  request("navigation/resolveFallback", OpenKeystoneRequestSchema),
  request("navigation/open", OpenKeystoneRequestSchema),
  request("context/build", ContextBuildPayloadSchema),
  request("context/get", ContextGetPayloadSchema),
  request("context/update", ContextItemActionPayloadSchema),
  request("context/addEntity", ContextAddEntityPayloadSchema),
  request("context/addFile", ContextAddFilePayloadSchema),
  request("context/removeItem", ContextItemActionPayloadSchema),
  request("context/pinItem", ContextItemActionPayloadSchema),
  request("context/unpinItem", ContextItemActionPayloadSchema),
  request("context/changeBudget", ContextBudgetPayloadSchema),
  request("context/regenerate", ContextBuildPayloadSchema),
  request("context/validate", ContextValidatePayloadSchema),
  request("delegation/prepare", DelegationPreparePayloadSchema),
  request("delegation/getPrompt", DelegationPromptPayloadSchema),
  request("delegation/approve", DelegationApprovePayloadSchema),
  request("delegation/start", DelegationStartPayloadSchema),
  request("delegation/openCopilot", DelegationPromptPayloadSchema),
  request("delegation/copyPrompt", DelegationPromptPayloadSchema),
  request("delegation/confirmStarted", DelegationSessionPayloadSchema),
  request("delegation/confirmStopped", DelegationSessionPayloadSchema),
  request("delegation/cancel", DelegationSessionPayloadSchema),
  request("delegation/status", DelegationStatusPayloadSchema),
  request("execution/start", ExecutionStartPayloadSchema),
  request("execution/list", z.object({}).strict()),
  request("execution/get", ExecutionSessionPayloadSchema),
  request("execution/confirmStarted", ExecutionSessionPayloadSchema),
  request("execution/confirmStopped", ExecutionSessionPayloadSchema),
  request("execution/cancel", ExecutionSessionPayloadSchema),
  request("execution/observeChanges", ExecutionSessionPayloadSchema),
  request("execution/attributeChange", AttributeChangePayloadSchema),
  request("execution/captureResult", CaptureResultPayloadSchema),
  request("validation/plan", ValidationPlanPayloadSchema),
  request("validation/getPlan", z.object({ planId: z.string().uuid() }).strict()),
  request(
    "validation/updatePlan",
    z
      .object({
        planId: z.string().uuid(),
        testMode: z.enum(["impacted", "affected-suite", "all"]).optional(),
        excludedTestEntityIds: z.array(z.string().max(500)).max(500).optional(),
      })
      .strict(),
  ),
  request("validation/approveCommand", ValidationApprovePayloadSchema),
  request("validation/run", ValidationRunPayloadSchema),
  request("validation/cancel", ValidationRunIdPayloadSchema),
  request("validation/getRun", ValidationRunIdPayloadSchema),
  request(
    "validation/rerunStep",
    ValidationRunIdPayloadSchema.extend({ stepId: z.string().uuid() }).strict(),
  ),
  request("validation/override", ValidationOverridePayloadSchema),
  request(
    "validation/manualEvidence",
    ValidationRunIdPayloadSchema.extend({
      criterionId: z.string().max(200),
      statement: z.string().min(1).max(5000),
    }).strict(),
  ),
  request("retry/plan", RetryPlanPayloadSchema),
  request("retry/selectAgent", RetryPlanPayloadSchema),
  request("retry/buildContext", ExecutionSessionPayloadSchema),
  request("retry/prepare", ExecutionSessionPayloadSchema),
  request("retry/start", ExecutionSessionPayloadSchema),
  request("retry/manualRepair", RetryPlanPayloadSchema),
  request("retry/createRepairTask", RetryPlanPayloadSchema),
  request("completion/evaluate", ExecutionSessionPayloadSchema),
  request("completion/completeTask", CompleteTaskPayloadSchema),
  request("completion/acceptWithOverride", CompleteTaskPayloadSchema),
  request("completion/getWorkflowReport", WorkflowReportPayloadSchema),
  request("git/capabilities", z.object({}).strict()),
  request("git/refresh", z.object({}).strict()),
  request("git/repositoryState", z.object({}).strict()),
  request("git/remotes", z.object({}).strict()),
  request("git/branches", z.object({}).strict()),
  request("git/status", z.object({}).strict()),
  request("git/identity", z.object({}).strict()),
  request("git/history", z.object({ limit: z.number().int().min(1).max(200).default(50) }).strict()),
  request(
    "git/diff",
    z
      .object({
        path: z.string().max(1024),
        mode: z.enum(["working-head", "index-head", "working-index"]),
        maxBytes: z.number().int().min(1000).max(100_000).default(50_000),
      })
      .strict(),
  ),
  request("execution/route", ExecutionRoutingRequestSchema),
  request("request/cancel", z.object({ targetRequestId: z.string().uuid() }).strict()),
]);
export type WebviewRequest = z.infer<typeof WebviewRequestSchema>;
export type WebviewRequestType = WebviewRequest["type"];
export type WebviewPayload<T extends WebviewRequestType> = Extract<
  WebviewRequest,
  { type: T }
>["payload"];

const IntelligenceRuntimeEventPayloadSchema = z
  .object({
    status: IntelligenceStatusSchema,
    pendingUpdate: z.boolean(),
    scanRevision: z.number().int().nonnegative(),
    ...IntelligenceRuntimeOverviewSchema.shape,
    error: z.object({ code: z.string(), message: z.string() }).strict().optional(),
  })
  .strict();
const CopilotIntegrationEventPayloadSchema = z
  .object({
    repositoryId: z.string().max(500).optional(),
    workflowId: z.string().uuid().optional(),
    taskId: z.string().uuid().optional(),
    generation: z.number().int().nonnegative().optional(),
    invocationId: z.string().uuid().optional(),
    message: z.string().max(2000),
    at: z.string().datetime(),
  })
  .strict();

export const HostMessageSchema = z.discriminatedUnion("type", [
  event("qa.progress", z.object({ workflowId: z.string().uuid(), executionId: z.string().min(1), commandId: z.string(), output: z.string().max(50_000).optional(), source: z.enum(["stdout", "stderr"]).optional(), completed: z.number().int().nonnegative(), total: z.number().int().nonnegative(), status: z.string().max(100) }).strict()),
  event("testIntelligence.updated", QaTestIntelligenceAggregateSchema),
  event("testIntelligence.validationProgress", z.object({ workflowId: z.string().uuid(), validationId: z.string().min(1), level: ValidationLevelSchema, status: ValidationLevelStatusSchema, output: z.string().max(50_000).optional() }).strict()),
  event("review/stateChanged", ReviewLifecycleEventSchema),
  event("review/noteChanged", ReviewLifecycleEventSchema),
  event("review/changesRequested", ReviewLifecycleEventSchema),
  event("review/approved", ReviewLifecycleEventSchema),
  event("review/stale", ReviewLifecycleEventSchema),
  event("review/prDraftChanged", ReviewLifecycleEventSchema),
  event("complete/optionsChanged", ReviewLifecycleEventSchema),
  event("complete/handoffPrepared", ReviewLifecycleEventSchema),
  event("complete/workflowCompleted", ReviewLifecycleEventSchema),
  event("complete/workflowClosedPartial", ReviewLifecycleEventSchema),
  event("orchestration/created", OrchestrationEventSchema),
  event("orchestration/planned", OrchestrationEventSchema),
  event("orchestration/started", OrchestrationEventSchema),
  event("orchestration/stageChanged", OrchestrationEventSchema),
  event("orchestration/statusChanged", OrchestrationEventSchema),
  event("orchestration/paused", OrchestrationEventSchema),
  event("orchestration/resumed", OrchestrationEventSchema),
  event("orchestration/cancelled", OrchestrationEventSchema),
  event("orchestration/recovered", OrchestrationEventSchema),
  event("orchestration/completed", OrchestrationEventSchema),
  event("orchestration/failed", OrchestrationEventSchema),
  event("orchestration/stale", OrchestrationEventSchema),
  event("orchestration/taskReady", OrchestrationEventSchema),
  event("orchestration/taskStarted", OrchestrationEventSchema),
  event("orchestration/taskProgress", OrchestrationEventSchema),
  event("orchestration/taskBlocked", OrchestrationEventSchema),
  event("orchestration/taskCompleted", OrchestrationEventSchema),
  event("orchestration/taskFailed", OrchestrationEventSchema),
  event("orchestration/approvalRequested", OrchestrationEventSchema),
  event("orchestration/approvalResolved", OrchestrationEventSchema),
  event("orchestration/qaChanged", OrchestrationEventSchema),
  event("orchestration/securityChanged", OrchestrationEventSchema),
  event("orchestration/performanceChanged", OrchestrationEventSchema),
  event("orchestration/validationChanged", OrchestrationEventSchema),
  event("orchestration/findingChanged", OrchestrationEventSchema),
  event(
    "response/success",
    z.object({ requestId: z.string().uuid(), data: z.unknown().optional() }).strict(),
  ),
  event(
    "response/error",
    z
      .object({
        requestId: z.string().uuid(),
        error: SerializedKeystoneErrorSchema,
      })
      .strict(),
  ),
  event("bootstrap/ready", BootstrapSnapshotSchema),
  event("state/updated", PersistedFoundationStateSchema),
  event("activity/updated", ActivitySchema),
  event("intelligence/updated", IntelligenceOverviewSchema),
  event("intelligence/runtime", IntelligenceRuntimeEventPayloadSchema),
  event("intelligence/queryStarted", QueryLifecycleEventSchema),
  event("intelligence/queryProgress", QueryLifecycleEventSchema),
  event("intelligence/queryCompleted", QueryLifecycleEventSchema),
  event("intelligence/queryCancelled", QueryLifecycleEventSchema),
  event("intelligence/queryFailed", QueryLifecycleEventSchema),
  event("intelligence/queryInvalidated", QueryLifecycleEventSchema),
  event("workflow/updated", WorkflowEventPayloadSchema),
  event("workflow/stale", WorkflowEventPayloadSchema),
  event("workbench/workflowCreated", WorkbenchLifecycleEventSchema),
  event("workbench/workflowChanged", WorkbenchLifecycleEventSchema),
  event("workbench/stageStateChanged", WorkbenchLifecycleEventSchema),
  event("workbench/intentChanged", WorkbenchLifecycleEventSchema),
  event("workbench/clarificationChanged", WorkbenchLifecycleEventSchema),
  event("workbench/specificationGenerated", WorkbenchLifecycleEventSchema),
  event("workbench/specificationApproved", WorkbenchLifecycleEventSchema),
  event("workbench/taskPlanGenerated", WorkbenchLifecycleEventSchema),
  event("workbench/taskPlanChanged", WorkbenchLifecycleEventSchema),
  event("build/taskSelected", BuildLifecycleEventSchema),
  event("build/taskStarted", BuildLifecycleEventSchema),
  event("build/taskPaused", BuildLifecycleEventSchema),
  event("build/taskBlocked", BuildLifecycleEventSchema),
  event("build/taskChanged", BuildLifecycleEventSchema),
  event("build/contextStarted", BuildLifecycleEventSchema),
  event("build/contextCompleted", BuildLifecycleEventSchema),
  event("build/contextStale", BuildLifecycleEventSchema),
  event("build/agentChanged", BuildLifecycleEventSchema),
  event("build/delegationPrepared", BuildLifecycleEventSchema),
  event("build/delegationStarted", BuildLifecycleEventSchema),
  event("build/delegationChanged", BuildLifecycleEventSchema),
  event("build/repositoryChangesChanged", BuildLifecycleEventSchema),
  event("build/validationStarted", BuildLifecycleEventSchema),
  event("build/validationChanged", BuildLifecycleEventSchema),
  event("build/retryPrepared", BuildLifecycleEventSchema),
  event("build/retryStarted", BuildLifecycleEventSchema),
  event("build/handoffPrepared", BuildLifecycleEventSchema),
  event("build/completionReadinessChanged", BuildLifecycleEventSchema),
  event("workbench/taskPlanApproved", WorkbenchLifecycleEventSchema),
  event("workbench/staleStateDetected", WorkbenchStaleEventSchema),
  event("copilot/capabilitiesChanged", CapabilityEventPayloadSchema),
  event("copilot/agentsChanged", AgentsEventPayloadSchema),
  event("copilot/customizationsChanged", CopilotIntegrationEventPayloadSchema),
  event("copilot/toolsChanged", CopilotIntegrationEventPayloadSchema),
  event("copilot/toolInvocationStarted", CopilotIntegrationEventPayloadSchema),
  event("copilot/toolInvocationCompleted", CopilotIntegrationEventPayloadSchema),
  event("copilot/toolInvocationFailed", CopilotIntegrationEventPayloadSchema),
  event("copilot/assistedLaunchPrepared", CopilotIntegrationEventPayloadSchema),
  event("copilot/assistedLaunchConfirmed", CopilotIntegrationEventPayloadSchema),
  event("copilot/integrationDiagnosticChanged", CopilotIntegrationEventPayloadSchema),
  event("keystone/initialize", KeystoneInitializationSchema),
  event(
    "keystone/navigationRequest",
    ValidatedNavigationSchema.extend({ sequence: z.number().int().nonnegative() }).strict(),
  ),
  event("dashboard/stateChanged", KeystoneDashboardStateSchema),
  event("panel/created", KeystonePanelStateSchema),
  event("panel/revealed", KeystonePanelStateSchema),
  event("panel/disposed", KeystonePanelStateSchema),
  event("panel/ready", KeystonePanelStateSchema),
  event("navigation/requested", ValidatedNavigationSchema),
  event("navigation/completed", ValidatedNavigationSchema),
  event("navigation/failed", ValidatedNavigationSchema),
  event("navigation/fallbackApplied", ValidatedNavigationSchema),
  event("context/buildStarted", ContextLifecycleEventSchema),
  event("context/buildProgress", ContextLifecycleEventSchema),
  event("context/buildCompleted", ContextLifecycleEventSchema),
  event("context/invalidated", ContextLifecycleEventSchema),
  event("delegation/prepared", DelegationLifecycleEventSchema),
  event("delegation/started", DelegationLifecycleEventSchema),
  event("delegation/statusChanged", DelegationLifecycleEventSchema),
  event("delegation/repositoryChanged", DelegationLifecycleEventSchema),
  event("delegation/blocked", DelegationLifecycleEventSchema),
  event("delegation/failed", DelegationLifecycleEventSchema),
  event("delegation/cancelled", DelegationLifecycleEventSchema),
  event(
    "execution/statusChanged",
    z
      .object({
        sessionId: z.string().uuid(),
        taskId: z.string().uuid(),
        status: z.string().max(100),
        message: z.string().max(2000),
      })
      .strict(),
  ),
  event(
    "execution/repositoryChanged",
    z
      .object({
        sessionId: z.string().uuid(),
        taskId: z.string().uuid(),
        changeCount: z.number().int().nonnegative(),
        message: z.string().max(2000),
      })
      .strict(),
  ),
  event(
    "execution/resultCaptured",
    z
      .object({
        sessionId: z.string().uuid(),
        taskId: z.string().uuid(),
        mode: z.string().max(100),
        message: z.string().max(2000),
        postEditVerifierResult: z
          .object({
            passed: z.boolean(),
            verdict: z.enum(["satisfied", "needs_revision", "failed"]),
            signals: z
              .array(
                z
                  .object({
                    signal: z.string().max(200),
                    passed: z.boolean(),
                    details: z.string().max(2000),
                  })
                  .strict(),
              )
              .max(100),
          })
          .strict()
          .optional(),
      })
      .strict(),
  ),
  event(
    "execution/failed",
    z
      .object({
        sessionId: z.string().uuid().optional(),
        taskId: z.string().uuid().optional(),
        message: z.string().max(2000),
      })
      .strict(),
  ),
  event(
    "validation/planned",
    z
      .object({
        sessionId: z.string().uuid(),
        planId: z.string().uuid(),
        stepCount: z.number().int().nonnegative(),
        message: z.string().max(2000),
      })
      .strict(),
  ),
  event(
    "validation/started",
    z
      .object({
        sessionId: z.string().uuid(),
        planId: z.string().uuid(),
        runId: z.string().uuid().optional(),
        message: z.string().max(2000),
      })
      .strict(),
  ),
  event(
    "validation/progress",
    z
      .object({
        sessionId: z.string().uuid(),
        stepId: z.string().uuid(),
        progress: z.number().min(0).max(100),
        message: z.string().max(2000),
        output: z.string().max(1000).optional(),
      })
      .strict(),
  ),
  event(
    "validation/stepCompleted",
    z
      .object({
        sessionId: z.string().uuid(),
        stepId: z.string().uuid(),
        message: z.string().max(2000),
      })
      .strict(),
  ),
  event(
    "validation/completed",
    z
      .object({
        sessionId: z.string().uuid(),
        runId: z.string().uuid(),
        status: z.string().max(100),
        message: z.string().max(2000),
      })
      .strict(),
  ),
  event(
    "validation/failed",
    z
      .object({
        sessionId: z.string().uuid().optional(),
        message: z.string().max(2000),
      })
      .strict(),
  ),
  event(
    "validation/cancelled",
    z.object({ runId: z.string().uuid(), message: z.string().max(2000) }).strict(),
  ),
  event(
    "retry/prepared",
    z
      .object({
        sessionId: z.string().uuid(),
        retryId: z.string().uuid(),
        message: z.string().max(2000),
      })
      .strict(),
  ),
  event(
    "retry/started",
    z
      .object({
        sessionId: z.string().uuid(),
        retryId: z.string().uuid(),
        message: z.string().max(2000),
      })
      .strict(),
  ),
  event(
    "retry/completed",
    z
      .object({
        sessionId: z.string().uuid(),
        retryId: z.string().uuid(),
        message: z.string().max(2000),
      })
      .strict(),
  ),
  event(
    "completion/readinessChanged",
    z
      .object({
        sessionId: z.string().uuid(),
        status: z.string().max(100),
        blockers: z.number().int().nonnegative(),
        message: z.string().max(2000),
      })
      .strict(),
  ),
  event(
    "completion/taskCompleted",
    z
      .object({
        sessionId: z.string().uuid(),
        taskId: z.string().uuid(),
        message: z.string().max(2000),
      })
      .strict(),
  ),
  event(
    "completion/dependenciesUnlocked",
    z
      .object({
        taskIds: z.array(z.string().uuid()).max(500),
        message: z.string().max(2000),
      })
      .strict(),
  ),
  event(
    "completion/workflowCompleted",
    z
      .object({
        workflowId: z.string().uuid(),
        reportId: z.string().uuid(),
        message: z.string().max(2000),
      })
      .strict(),
  ),
]);
export type HostMessage = z.infer<typeof HostMessageSchema>;

export interface WebviewRequestResults {
  "home/getState": HomeState;
  "workflow.create": WorkflowCreatedResponse | WorkflowCreationFailedResponse;
  "workflow.loadActive": CanonicalWorkflow | null;
  "workflow.listCanonical": CanonicalWorkflow[];
  "workflow.getCanonical": CanonicalWorkflow | undefined;
  "workflow.setActiveCanonical": CanonicalWorkflow;
  "stage.understand.load": UnderstandState;
  "stage.understand.initializeIntelligence": UnderstandState;
  "stage.understand.analyzeIntent": UnderstandState;
  "stage.understand.approveAnalysis": UnderstandState;
  "stage.understand.setScopeItem": UnderstandState;
  "stage.understand.resolveAmbiguity": UnderstandState;
  "stage.understand.setConfiguration": UnderstandState;
  "stage.understand.previewInstruction": InstructionPreview;
  "stage.understand.generateContext": UnderstandState;
  "stage.understand.approveContext": UnderstandState;
  "stage.understand.delegate": UnderstandState;
  "stage.understand.captureResult": UnderstandState;
  "stage.understand.validateResult": UnderstandState;
  "stage.understand.acceptWarnings": UnderstandState;
  "stage.understand.complete": { state: UnderstandState; workflow: CanonicalWorkflow };
  "stage.investigation.load": InvestigationState;
  "stage.investigation.upsertQuestion": InvestigationState;
  "stage.investigation.setConclusion": InvestigationState;
  "stage.investigation.complete": { state: InvestigationState; workflow: CanonicalWorkflow };
  "stage.complete.load": CompleteState;
  "stage.complete.archive": CanonicalWorkflow;
  "stage.plan.load": PlanState;
  "stage.plan.setConfiguration": PlanState;
  "stage.plan.generateContext": PlanState;
  "stage.plan.approveContext": PlanState;
  "stage.plan.delegate": PlanState;
  "stage.plan.capturePlan": PlanState;
  "stage.plan.approvePlan": PlanState;
  "stage.plan.complete": { state: PlanState; workflow: CanonicalWorkflow };
  "development.initialize": DevelopmentAggregate;
  "development.load": DevelopmentAggregate;
  "development.updateObjective": DevelopmentAggregate;
  "development.addCurrentFile": DevelopmentAggregate;
  "development.addSelectedFiles": DevelopmentAggregate;
  "development.addCurrentSelection": DevelopmentAggregate;
  "development.addIntelligenceSymbol": DevelopmentAggregate;
  "development.removeScopeItem": DevelopmentAggregate;
  "development.preparePrompt": DevelopmentAggregate;
  "development.context.build": DevelopmentAggregate;
  "development.context.changeBudget": DevelopmentAggregate;
  "development.context.approve": DevelopmentAggregate;
  "development.context.pin": DevelopmentAggregate;
  "development.context.remove": DevelopmentAggregate;
  "development.context.restore": DevelopmentAggregate;
  "development.copyPrompt": DevelopmentAggregate;
  "development.confirmHandoff": DevelopmentAggregate;
  "development.recordManualOrigin": DevelopmentAggregate;
  "development.loadChanges": DevelopmentAggregate;
  "development.recordResult": DevelopmentAggregate;
  "development.associateChangedFiles": DevelopmentAggregate;
  "development.confirmNoCode": DevelopmentAggregate;
  "development.reviewResult": DevelopmentAggregate;
  "development.complete": DevelopmentAggregate;
  "impact.load": ImpactQaAggregate;
  "impact.detect": ImpactQaAggregate;
  "impact.openChangedFile": { opened: true };
  "impact.acceptChangeSet": ImpactQaAggregate;
  "impact.analyze": ImpactQaAggregate;
  "impact.acceptAnalysis": ImpactQaAggregate;
  "qa.generatePlan": ImpactQaAggregate;
  "qa.updatePlan": ImpactQaAggregate;
  "qa.approvePlan": ImpactQaAggregate;
  "qa.execute": ImpactQaAggregate;
  "qa.cancel": { cancelled: boolean };
  "testIntelligence.load": QaTestIntelligenceAggregate;
  "testIntelligence.createGenerationRequest": QaTestIntelligenceAggregate;
  "testIntelligence.deriveScenarios": QaTestIntelligenceAggregate;
  "testIntelligence.updateScenario": QaTestIntelligenceAggregate;
  "testIntelligence.approveScenarios": QaTestIntelligenceAggregate;
  "testIntelligence.buildGenerationContext": QaTestIntelligenceAggregate;
  "testIntelligence.approveGenerationContext": QaTestIntelligenceAggregate;
  "testIntelligence.recordProposal": QaTestIntelligenceAggregate;
  "testIntelligence.validateProposalPolicy": QaTestIntelligenceAggregate;
  "testIntelligence.applyProposal": QaTestIntelligenceAggregate;
  "testIntelligence.revertApplied": QaTestIntelligenceAggregate;
  "testIntelligence.createFailureAnalysis": QaTestIntelligenceAggregate;
  "testIntelligence.acceptFailureClassification": QaTestIntelligenceAggregate;
  "testIntelligence.requestRepeatedRuns": QaTestIntelligenceAggregate;
  "testIntelligence.loadFlakyHistory": QaTestIntelligenceAggregate;
  "testIntelligence.createRemediationProposal": QaTestIntelligenceAggregate;
  "testIntelligence.validateRemediationPolicy": QaTestIntelligenceAggregate;
  "testIntelligence.applyRemediation": QaTestIntelligenceAggregate;
  "testIntelligence.runValidationSequence": QaTestIntelligenceAggregate;
  "testIntelligence.loadValidationState": QaTestIntelligenceAggregate;
  "testIntelligence.refreshQaDecision": QaTestIntelligenceAggregate;
  "executionConfiguration.load": ExecutionConfigurationAggregate;
  "executionConfiguration.refresh": ExecutionConfigurationAggregate;
  "executionConfiguration.discoverInstructions": ExecutionConfigurationAggregate;
  "executionConfiguration.listSkills": ExecutionConfigurationAggregate;
  "executionConfiguration.detectConflicts": ExecutionConfigurationAggregate;
  "executionConfiguration.createManualAgent": ExecutionConfigurationAggregate;
  "executionConfiguration.updateManualAgent": ExecutionConfigurationAggregate;
  "executionConfiguration.deleteManualAgent": ExecutionConfigurationAggregate;
  "executionConfiguration.addInstructionFile": ExecutionConfigurationAggregate;
  "executionConfiguration.previewInstruction": InstructionPreview;
  "executionConfiguration.previewSkill": SkillDefinition;
  "executionConfiguration.validateProfile": ExecutionConfigurationAggregate;
  "executionConfiguration.saveProfile": ExecutionConfigurationAggregate;
  "review/getState": WorkflowReviewState;
  "review/getSummary": WorkflowReviewState["summary"];
  "review/getTraceability": WorkflowReviewState["traceability"];
  "review/getChanges": WorkflowReviewState["changes"];
  "review/getDiff": {
    path: string;
    text: string;
    binary: boolean;
    truncated: boolean;
    totalBytes: number;
  };
  "review/attributeChange": TaskExecutionSession;
  "review/getQa": WorkflowReviewState["findings"];
  "review/getSecurity": WorkflowReviewState["findings"];
  "review/getPerformance": WorkflowReviewState["findings"];
  "review/getDocumentation": WorkflowReviewState["findings"];
  "review/addNote": ReviewNote;
  "review/updateNote": ReviewNote;
  "review/resolveNote": ReviewNote;
  "review/requestChanges": ReviewDecision;
  "review/createFollowUpTask": DevelopmentWorkflowSnapshot;
  "review/generatePrDraft": PullRequestReview;
  "review/getPrDraft": PullRequestReview | undefined;
  "review/updatePrDraft": PullRequestReview;
  "review/getPrChecklist": WorkflowReviewState["checklist"];
  "review/getReadiness": { ready: boolean; blockers: string[]; warnings: string[] };
  "review/approve": ReviewDecision;
  "review/approveWithWarnings": ReviewDecision;
  "review/reject": ReviewDecision;
  "review/returnToBuild": ReviewDecision;
  "review/returnToDefine": ReviewDecision;
  "review/dispositionFinding": FindingDisposition;
  // Phase 10 — Evidence-Backed PR Review responses.
  "pr-review/prepare": {
    review: PullRequestReview;
    scope: ReviewScopeAssessment;
    traceability: ReviewTraceabilityAssessment;
    contract: ReviewContractAssessment;
    test: ReviewTestAssessment;
    findings: ReviewFinding[];
  };
  "pr-review/getState": {
    reviews: PullRequestReview[];
    scopeAssessments: ReviewScopeAssessment[];
    traceabilityAssessments: ReviewTraceabilityAssessment[];
    contractAssessments: ReviewContractAssessment[];
    testAssessments: ReviewTestAssessment[];
    findings: ReviewFinding[];
    readinessDecisions: ChangeReadinessDecision[];
    packages: PullRequestPackage[];
  };
  "pr-review/getFindings": ReviewFinding[];
  "pr-review/updateFindingStatus": ReviewFinding;
  "pr-review/calculateReadiness": ChangeReadinessDecision;
  "pr-review/approveReadiness": ChangeReadinessDecision;
  "pr-review/generatePackage": PullRequestPackage;
  "pr-review/updatePackage": PullRequestPackage;
  "taskHandoff/checkEligibility": { eligible: boolean; reason?: string };
  "taskHandoff/createDraft": TaskHandoff;
  "taskHandoff/updateDraft": TaskHandoff;
  "taskHandoff/runPrivacyScan": HandoffPrivacyReport;
  "taskHandoff/markRedacted": HandoffPrivacyReport;
  "taskHandoff/export": { pkg: TaskHandoffPackage; savedUri: string };
  "taskHandoff/listHistory": TaskHandoff[];
  "taskHandoff/previewImport": { pkg: TaskHandoffPackage; compatibility: HandoffCompatibilityReport; blocking: boolean };
  "taskHandoff/acceptImport": TaskHandoff;
  "taskHandoff/rejectImport": TaskHandoff;
  "complete/getState": CompletionState;
  "complete/getOptions": CompletionState["options"];
  "complete/getReport": WorkflowCompletionRecord | undefined;
  "complete/completeLocally": WorkflowCompletionRecord;
  "complete/closePartial": WorkflowCompletionRecord;
  "complete/cancelWithChanges": WorkflowCompletionRecord;
  "complete/archive": WorkflowCompletionRecord;
  "orchestration/create": WorkflowInstance;
  "orchestration/get": WorkflowInstance | undefined;
  "orchestration/list": WorkflowInstance[];
  "orchestration/definitions": WorkflowDefinition[];
  "orchestration/policies": WorkflowPolicy[];
  "orchestration/plan": WorkflowInstance;
  "orchestration/validatePlan": {
    valid: boolean;
    blockers: string[];
    warnings: string[];
  };
  "orchestration/start": WorkflowInstance;
  "orchestration/pause": WorkflowInstance;
  "orchestration/resume": WorkflowInstance;
  "orchestration/cancel": WorkflowInstance;
  "orchestration/recover": WorkflowInstance;
  "orchestration/status": WorkflowInstance | undefined;
  "orchestration/taskReadiness": {
    ready: boolean;
    blockers: string[];
    warnings: string[];
  };
  "orchestration/startTask": WorkflowInstance;
  "orchestration/pauseTask": WorkflowInstance;
  "orchestration/cancelTask": WorkflowInstance;
  "orchestration/retryTask": WorkflowInstance;
  "orchestration/changeAgent": WorkflowInstance;
  "orchestration/skipOptionalTask": WorkflowInstance;
  "orchestration/schedule": {
    order: string[];
    blockedPairs: Array<{
      left: string;
      right: string;
      classification: string;
    }>;
  };
  "orchestration/conflicts": {
    order: string[];
    blockedPairs: Array<{
      left: string;
      right: string;
      classification: string;
    }>;
  };
  "orchestration/approvals": WorkflowInstance["approvalGates"];
  "orchestration/approve": WorkflowInstance;
  "orchestration/reject": WorkflowInstance;
  "orchestration/requestChanges": WorkflowInstance;
  "orchestration/override": WorkflowInstance;
  "orchestration/qaPlan": OrchestrationReviewPlan;
  "orchestration/qaRun": OrchestrationReviewPlan;
  "orchestration/qaFinding": WorkflowInstance;
  "orchestration/qaAccept": WorkflowInstance;
  "orchestration/qaReturn": WorkflowInstance;
  "orchestration/securityPlan": OrchestrationReviewPlan;
  "orchestration/securityRun": OrchestrationReviewPlan;
  "orchestration/securityFinding": WorkflowInstance;
  "orchestration/securityAccept": WorkflowInstance;
  "orchestration/performancePlan": OrchestrationReviewPlan;
  "orchestration/performanceRun": OrchestrationReviewPlan;
  "orchestration/performanceFinding": WorkflowInstance;
  "orchestration/performanceAccept": WorkflowInstance;
  "orchestration/validationPlan": OrchestrationReviewPlan;
  "orchestration/runValidation": OrchestrationReviewPlan;
  "orchestration/rerunValidation": OrchestrationReviewPlan;
  "orchestration/cancelValidation": undefined;
  "orchestration/audit": WorkflowInstance["audit"];
  "orchestration/metrics": WorkflowInstance["metrics"];
  "orchestration/report": WorkflowInstance;
  "app/bootstrap": BootstrapSnapshot;
  "app/ping": { serverTime: string };
  "navigation/set": PersistedFoundationState;
  "settings/open": undefined;
  "logs/show": undefined;
  "intelligence/overview": IntelligenceOverview;
  "intelligence/scan/start": { scanRevision: number };
  "intelligence/scan/cancel": undefined;
  "intelligence/runtime/pause": undefined;
  "intelligence/runtime/resume": undefined;
  "intelligence/search": IntelligenceSearchResult;
  "intelligence/diagnostics": IntelligenceDiagnosticsResult;
  "intelligence/entity": IntelligenceEntityDetails | undefined;
  "intelligence/neighborhood": IntelligenceNeighborhood;
  "intelligence.canvas.search": { items: IntelligenceCanvasSearchItem[]; intelligenceRevision: string; stale: boolean };
  "intelligence.canvas.graph": IntelligenceGraphSlice;
  "intelligence.canvas.expand": IntelligenceGraphSlice;
  "intelligence.canvas.evidence": { items: Array<{ id: string; filePath: string; range?: import("./intelligence").SourceRange; provider: string; evidenceType: string; excerpt: string; confidence: number }>; intelligenceRevision: string };
  "intelligence.canvas.query": IntelligenceEngineeringQueryResult;
  "intelligence.canvas.openSource": undefined;
  "intelligence.canvas.openEvidenceSource": undefined;
  "intelligence.canvas.addScope": DevelopmentAggregate;
  "intelligence.canvas.addContext": DevelopmentAggregate;
  "intelligence.canvas.addPathContext": DevelopmentAggregate;
  "intelligence/technologies": TechnologyCoverageResult;
  "intelligence/adapter-diagnostics": AdapterDiagnosticsResult;
  "intelligence/query": IntelligenceQueryResult;
  "intelligence/query/compile": QueryCompilation;
  "intelligence/query/cancel": undefined;
  "intelligence/query/suggestions": QuerySuggestionsResult;
  "intelligence/query/templates": QueryTemplatesResult;
  "intelligence/query/explanation": QueryExplanation | undefined;
  "intelligence/path": IntelligenceQueryResult;
  "intelligence/impact": IntelligenceQueryResult;
  "intelligence/flow": IntelligenceQueryResult;
  "intelligence/architecture": IntelligenceQueryResult;
  "intelligence/dependencies": IntelligenceQueryResult;
  "intelligence/tests": IntelligenceQueryResult;
  "intelligence/changes": IntelligenceQueryResult;
  "intelligence/cpg": IntelligenceQueryResult;
  "intelligence/cpg/scope": CpgQueryResult | undefined;
  "intelligence/cpg/slice": CpgSliceResult | undefined;
  "intelligence/guided": GuidedResult;
  "intelligence/source/open": undefined;
  "workflow/capture": DevelopmentWorkflowSnapshot;
  "workflow/list": DevelopmentWorkflowSnapshot[];
  "workflow/get": DevelopmentWorkflowSnapshot | undefined;
  "workflow/spec/submit": DevelopmentWorkflowSnapshot;
  "workflow/spec/revise": DevelopmentWorkflowSnapshot;
  "workflow/spec/resolveDecision": DevelopmentWorkflowSnapshot;
  "workflow/spec/approve": DevelopmentWorkflowSnapshot;
  "workflow/tasks/generate": DevelopmentWorkflowSnapshot;
  "workflow/reconcile": DevelopmentWorkflowSnapshot;
  "workbench/getCreateContext": WorkbenchCreateContext;
  "workbench/createWorkflow": DevelopmentWorkflowSnapshot;
  "workbench/getWorkflow": WorkbenchWorkflowState | undefined;
  "workbench/listWorkflows": DevelopmentWorkflowSnapshot[];
  "workbench/openWorkflow": WorkbenchWorkflowState;
  "workbench/getDefineState": WorkbenchDefineState;
  "workbench/updateIntent": DevelopmentWorkflowSnapshot;
  "workbench/updateScope": DevelopmentWorkflowSnapshot;
  "workbench/updateConstraints": DevelopmentWorkflowSnapshot;
  "workbench/getClarifications": DevelopmentWorkflowSnapshot["clarifications"];
  "workbench/answerClarification": DevelopmentWorkflowSnapshot;
  "workbench/deferClarification": DevelopmentWorkflowSnapshot;
  "workbench/markClarificationNotApplicable": DevelopmentWorkflowSnapshot;
  "workbench/reopenClarification": DevelopmentWorkflowSnapshot;
  "workbench/generateSpecification": DevelopmentWorkflowSnapshot;
  "workbench/updateSpecification": DevelopmentWorkflowSnapshot;
  "workbench/generateAcceptanceCriteria": DevelopmentWorkflowSnapshot;
  "workbench/approveSpecification": DevelopmentWorkflowSnapshot;
  "workbench/getPlanState": WorkbenchPlanState;
  "workbench/generateTaskPlan": DevelopmentWorkflowSnapshot;
  "workbench/updateTask": DevelopmentWorkflowSnapshot;
  "workbench/addTask": DevelopmentWorkflowSnapshot;
  "workbench/removeTask": DevelopmentWorkflowSnapshot;
  "workbench/reorderTask": DevelopmentWorkflowSnapshot;
  "workbench/updateDependency": DevelopmentWorkflowSnapshot;
  "workbench/validateTaskPlan": WorkbenchTaskPlanValidation;
  "workbench/approveTaskPlan": DevelopmentWorkflowSnapshot;
  "workbench/getStageStates": WorkbenchStageState[];
  "workbench/navigateStage": WorkbenchWorkflowState;
  "workbench/getSummary": WorkbenchSummary;
  "build/getTaskQueue": BuildTaskQueue;
  "build/getTaskState": BuildTaskState;
  "build/selectTask": BuildTaskState;
  "build/startTask": BuildTaskState;
  "build/pauseTask": BuildTaskState;
  "build/resumeTask": BuildTaskState;
  "build/blockTask": BuildTaskState;
  "build/cancelTask": BuildTaskState;
  "build/getCopilotCapabilities": CopilotCapabilities;
  "build/getCustomizations": CopilotCustomizationItem[];
  "build/updateCustomizationSelection": CopilotCustomizationItem[];
  "build/getAgents": CopilotAgentDescriptor[];
  "build/selectAgent": DevelopmentWorkflowSnapshot;
  "build/createContext": ContextPackage;
  "build/getContext": ContextPackage | undefined;
  "build/updateContextItem": ContextPackage;
  "build/pinContextItem": ContextPackage;
  "build/excludeContextItem": ContextPackage;
  "build/regenerateContext": ContextPackage;
  "build/getPromptPreview": PreparedDelegation | undefined;
  "build/prepareDelegation": PreparedDelegation;
  "build/approveDelegation": PreparedDelegation;
  "build/startDelegation": DelegationSession;
  "build/confirmAssistedState": DelegationSession;
  "build/cancelDelegation": DelegationSession;
  "build/getExecutionState": TaskExecutionSession | undefined;
  "build/getRepositoryChanges": TaskExecutionSession;
  "build/updateChangeAttribution": TaskExecutionSession;
  "build/getDiff": {
    path: string;
    text: string;
    binary: boolean;
    truncated: boolean;
    totalBytes: number;
  };
  "build/refreshChanges": TaskExecutionSession;
  "build/getValidationPlan": ValidationPlan | undefined;
  "build/runValidation": ValidationRunV2;
  "build/cancelValidation": undefined;
  "build/rerunValidation": ValidationRunV2 | undefined;
  "build/addManualEvidence": ValidationRunV2;
  "build/getAcceptanceCriteriaState": ValidationRunV2["acceptanceCriteriaResults"];
  "build/prepareRetry": RetryPlan;
  "build/updateRetryAgent": RetryPlan;
  "build/approveRetry": RetryPlan | undefined;
  "build/startRetry": TaskExecutionSession;
  "build/exportHandoff": { destination?: string };
  "build/cancelHandoff": undefined;
  "build/getCompletionReadiness": CompletionDecision;
  "build/requestCompletionReview": CompletionDecision;
  "copilot/capabilities": CopilotCapabilities;
  "copilot/refreshCapabilities": CopilotCapabilities;
  "copilot/agents": CopilotAgentDescriptor[];
  "copilot/refreshAgents": CopilotAgentDescriptor[];
  "copilot/agentRecommendation": AgentRecommendation;
  "copilot/selectAgent": DevelopmentWorkflowSnapshot;
  "copilot/getCapabilities": CopilotIntegrationCapabilities;
  "copilot/getIntegrationStatus": CopilotIntegrationCapabilities;
  "copilot/listCustomizations": CopilotCustomizationRecord[];
  "copilot/getCustomization": CopilotCustomizationRecord | undefined;
  "copilot/refreshCustomizations": CopilotCustomizationRecord[];
  "copilot/setCustomizationEnabled": CopilotCustomizationRecord[];
  "copilot/getApplicableCustomizations": CopilotCustomizationRecord[];
  "copilot/listAgents": CopilotAgentDescriptor[];
  "copilot/getAgent": CopilotAgentDescriptor | undefined;
  "copilot/recommendAgent": AgentRecommendation;
  "copilot/listKeystoneTools": KeystoneToolDescriptor[];
  "copilot/getToolStatus": KeystoneToolDescriptor | undefined;
  "copilot/getToolAudit": CopilotToolAuditEntry[];
  "copilot/testTool": KeystoneToolResult;
  "copilot/prepareAssistedLaunch": AssistedLaunchState;
  "copilot/getPreparedPrompt": AssistedLaunchState | undefined;
  "copilot/openChat": AssistedLaunchState;
  "copilot/copyPrompt": AssistedLaunchState;
  "copilot/confirmSubmission": AssistedLaunchState;
  "copilot/cancelAssistedLaunch": AssistedLaunchState;
  "copilot/getParticipantStatus": { available: boolean; enabled: boolean; limitation?: string };
  "copilot/openParticipant": undefined;
  "copilot/disableParticipant": { enabled: false };
  "keystone/webviewReady": KeystoneInitialization;
  "keystone/initializationAcknowledged": KeystonePanelState;
  "keystone/navigationAcknowledged": KeystonePanelState;
  "keystone/webviewStateChanged": KeystonePanelState;
  "dashboard/getState": KeystoneDashboardState;
  "dashboard/refresh": KeystoneDashboardState;
  "dashboard/openAction": ValidatedNavigation;
  "panel/getState": KeystonePanelState;
  "panel/updateState": KeystonePanelState;
  "panel/getPendingNavigation": ValidatedNavigation | undefined;
  "navigation/validateTarget": ValidatedNavigation;
  "navigation/resolveFallback": ValidatedNavigation;
  "navigation/open": ValidatedNavigation;
  "context/build": ContextPackage;
  "context/get": ContextPackage | undefined;
  "context/update": ContextPackage;
  "context/addEntity": ContextPackage;
  "context/addFile": ContextPackage;
  "context/removeItem": ContextPackage;
  "context/pinItem": ContextPackage;
  "context/unpinItem": ContextPackage;
  "context/changeBudget": ContextPackage;
  "context/regenerate": ContextPackage;
  "context/validate": ContextPackage;
  "delegation/prepare": PreparedDelegation;
  "delegation/getPrompt": PreparedDelegation | undefined;
  "delegation/approve": PreparedDelegation;
  "delegation/start": DelegationSession;
  "delegation/openCopilot": undefined;
  "delegation/copyPrompt": undefined;
  "delegation/confirmStarted": DelegationSession;
  "delegation/confirmStopped": DelegationSession;
  "delegation/cancel": DelegationSession;
  "delegation/status": DelegationSession | undefined;
  "execution/start": TaskExecutionSession;
  "execution/list": TaskExecutionSession[];
  "execution/get": TaskExecutionSession | undefined;
  "execution/confirmStarted": TaskExecutionSession;
  "execution/confirmStopped": TaskExecutionSession;
  "execution/cancel": TaskExecutionSession;
  "execution/observeChanges": TaskExecutionSession;
  "execution/attributeChange": TaskExecutionSession;
  "execution/captureResult": TaskExecutionSession;
  "validation/plan": ValidationPlan;
  "validation/getPlan": ValidationPlan | undefined;
  "validation/updatePlan": ValidationPlan | undefined;
  "validation/approveCommand": ValidationPlan;
  "validation/run": ValidationRunV2;
  "validation/cancel": undefined;
  "validation/getRun": ValidationRunV2 | undefined;
  "validation/rerunStep": ValidationRunV2 | undefined;
  "validation/override": ValidationRunV2;
  "validation/manualEvidence": ValidationRunV2;
  "retry/plan": RetryPlan;
  "retry/selectAgent": RetryPlan;
  "retry/buildContext": RetryPlan | undefined;
  "retry/prepare": RetryPlan | undefined;
  "retry/start": TaskExecutionSession;
  "retry/manualRepair": RetryPlan;
  "retry/createRepairTask": RetryPlan;
  "completion/evaluate": CompletionDecision;
  "completion/completeTask": {
    decision: CompletionDecision;
    unlockedTaskIds: string[];
    report?: WorkflowCompletionReport;
  };
  "completion/acceptWithOverride": {
    decision: CompletionDecision;
    unlockedTaskIds: string[];
    report?: WorkflowCompletionReport;
  };
  "completion/getWorkflowReport": WorkflowCompletionReport | undefined;
  "git/capabilities": { readOnly: true };
  "git/refresh": { readOnly: true };
  "git/repositoryState": RepositoryStatus;
  "git/remotes": { sanitizedRemoteUrl?: string };
  "git/status": RepositoryStatus;
  "git/branches": { current?: string; detached: boolean };
  "git/identity": RepositoryIdentity;
  "git/diff": RepositoryDiff;
  "git/history": RepositoryHistoryEntry[];
  "git/readiness": { ready: true; message: string };
  "execution/route": ExecutionRoutingDecision;
  "request/cancel": undefined;
}

export type WebviewResult<T extends WebviewRequestType> = WebviewRequestResults[Extract<
  keyof WebviewRequestResults,
  T
>];

export function hostMessage<T extends HostMessage["type"]>(
  type: T,
  payload: Extract<HostMessage, { type: T }>["payload"],
): Extract<HostMessage, { type: T }> {
  return {
    eventId: crypto.randomUUID(),
    type,
    timestamp: new Date().toISOString(),
    schemaVersion: SCHEMA_VERSION,
    payload,
  } as Extract<HostMessage, { type: T }>;
}

function request<T extends string, P extends z.ZodType>(type: T, payload: P) {
  return z.object({ ...envelopeFields, type: z.literal(type), payload }).strict();
}

function event<T extends string, P extends z.ZodType>(type: T, payload: P) {
  return z.object({ ...hostEnvelopeFields, type: z.literal(type), payload }).strict();
}


export type { SerializedKeystoneError };
