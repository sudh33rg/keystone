import { z } from "zod";
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
  type TaskContextPackage,
} from "./delegation";
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
import {
  CommitPlanSchema,
  DeliveryChangeSetPayloadSchema,
  DeliveryFileDecisionPayloadSchema,
  DeliveryWorkflowPayloadSchema,
  PullRequestDraftPayloadSchema,
  PullRequestDraftSchema,
  type CommitPlan,
  type DeliveryChangeSet,
  type DeliveryReadiness,
  type GitActionResult,
  type GitCapabilities,
  type GitMutationApproval,
  type GitRepositoryState,
  type PullRequestDraft,
  type PullRequestCreationResult,
  type PullRequestProviderCapability,
} from "./delivery";
import {
  AssignmentCreatePayloadSchema,
  AssignmentDecisionPayloadSchema,
  HandoffAcceptPayloadSchema,
  HandoffCreatePayloadSchema,
  HandoffExportPayloadSchema,
  HandoffImportPayloadSchema,
  HandoffPackageIdPayloadSchema,
  HandoffReconcilePayloadSchema,
  HandoffValidatePayloadSchema,
  ParticipantCreatePayloadSchema,
  ParticipantIdPayloadSchema,
  ParticipantUpdatePayloadSchema,
  ReassignmentPayloadSchema,
  TaskAssignmentSchema,
  TeamAuditPayloadSchema,
  TeamProgressPayloadSchema,
  type HandoffAcceptance,
  type HandoffPackage,
  type HandoffReconciliation,
  type HandoffValidationResult,
  type TaskAssignment,
  type TeamAuditEntry,
  type TeamParticipant,
  type TeamPersistentState,
  type TeamProgressSnapshot,
} from "./team";
import {
  ExecutionRoutingRequestSchema,
  type ExecutionRoutingDecision,
} from "./routing";
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
  CompleteApprovalPayloadSchema,
  CompleteDecisionPayloadSchema,
  CompletePatchPayloadSchema,
  ReviewAddNotePayloadSchema,
  ReviewDecisionPayloadSchema,
  ReviewDiffPayloadSchema,
  ReviewFollowUpPayloadSchema,
  ReviewPrDraftUpdatePayloadSchema,
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
  request("review/getState", ReviewWorkflowPayloadSchema),
  request("review/getSummary", ReviewWorkflowPayloadSchema),
  request("review/getTraceability", ReviewWorkflowPayloadSchema),
  request("review/getChanges", ReviewWorkflowPayloadSchema),
  request("review/getDiff", ReviewDiffPayloadSchema),
  request("review/attributeChange", ReviewWorkflowPayloadSchema.extend({ path: z.string().min(1).max(1024), classification: z.enum(["expected", "related", "pre-existing", "excluded"]), reason: z.string().min(1).max(2000) }).strict()),
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
  request("review/updatePrDraft", ReviewPrDraftUpdatePayloadSchema),
  request("review/getPrChecklist", ReviewWorkflowPayloadSchema),
  request("review/getReadiness", ReviewWorkflowPayloadSchema),
  request("review/approve", ReviewDecisionPayloadSchema),
  request("review/approveWithWarnings", ReviewDecisionPayloadSchema),
  request("review/reject", ReviewDecisionPayloadSchema),
  request("review/returnToBuild", ReviewRequestChangesPayloadSchema),
  request("review/returnToDefine", ReviewRequestChangesPayloadSchema),
  request("review/dispositionFinding", ReviewRiskDispositionPayloadSchema),
  request("complete/getState", ReviewWorkflowPayloadSchema),
  request("complete/getOptions", ReviewWorkflowPayloadSchema),
  request("complete/getReport", ReviewWorkflowPayloadSchema),
  request("complete/completeLocally", CompleteDecisionPayloadSchema),
  request("complete/closePartial", CompleteDecisionPayloadSchema),
  request("complete/cancelWithChanges", CompleteDecisionPayloadSchema),
  request("complete/archive", ReviewWorkflowPayloadSchema),
  request("complete/getChangeSet", ReviewWorkflowPayloadSchema),
  request("complete/updateChangeSet", DeliveryFileDecisionPayloadSchema.extend({ included: z.boolean() }).strict()),
  request("complete/generateCommitPlan", DeliveryChangeSetPayloadSchema),
  request("complete/updateCommitPlan", z.object({ commitPlan: CommitPlanSchema }).strict()),
  request("complete/approveStaging", CompleteApprovalPayloadSchema),
  request("complete/stageChanges", z.object({ approvalId: z.string().uuid() }).strict()),
  request("complete/approveCommit", CompleteApprovalPayloadSchema),
  request("complete/createCommit", z.object({ approvalId: z.string().uuid() }).strict()),
  request("complete/getPushReadiness", ReviewWorkflowPayloadSchema),
  request("complete/approvePush", CompleteApprovalPayloadSchema),
  request("complete/push", z.object({ approvalId: z.string().uuid() }).strict()),
  request("complete/getPrCapabilities", ReviewWorkflowPayloadSchema),
  request("complete/preparePr", ReviewWorkflowPayloadSchema),
  request("complete/approvePrCreation", CompleteApprovalPayloadSchema),
  request("complete/createPr", z.object({ approvalId: z.string().uuid() }).strict()),
  request("complete/confirmAssistedPr", z.object({ workflowId: z.string().uuid(), url: z.string().url().max(2000), confirm: z.literal(true) }).strict()),
  request("complete/preparePatch", CompletePatchPayloadSchema),
  request("complete/approvePatchExport", CompleteApprovalPayloadSchema),
  request("complete/exportPatch", z.object({ workflowId: z.string().uuid(), approvalId: z.string().uuid() }).strict()),
  request("complete/prepareHandoff", ReviewWorkflowPayloadSchema),
  request("complete/exportHandoff", z.object({ packageId: z.string().uuid() }).strict()),
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
  request(
    "orchestration/skipOptionalTask",
    OrchestrationTaskActionPayloadSchema,
  ),
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
  request(
    "orchestration/performanceFinding",
    OrchestrationFindingPayloadSchema,
  ),
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
  request(
    "settings/open",
    z.object({ query: z.string().max(120).optional() }).strict(),
  ),
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
  request("intelligence/exported-symbols", z.object({ fileId: z.string().min(1).optional() }).strict()),
  request("intelligence/wildcard-search", z.object({ pattern: z.string().min(1).max(500), fields: z.array(z.enum(["name", "qualifiedName", "relativePath", "type", "language"])).max(5).optional(), limit: z.number().int().min(1).max(200).optional() }).strict()),
  request("intelligence/module-mapping", z.object({}).strict()),
  request("intelligence/circular-dependencies", z.object({}).strict()),
  request("intelligence/node-metrics", z.object({}).strict()),
  request("intelligence/dead-code", z.object({}).strict()),
  request("intelligence/filtered-subgraph", z.object({ seedIds: z.array(z.string().min(1)).min(1).max(20), direction: z.enum(["incoming", "outgoing", "both"]).optional(), maxDepth: z.number().int().min(1).max(10).optional() }).strict()),
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
  request(
    "workbench/updateConstraints",
    WorkbenchConstraintsUpdatePayloadSchema,
  ),
  request("workbench/getClarifications", WorkflowIdPayloadSchema),
  request(
    "workbench/answerClarification",
    WorkbenchClarificationAnswerPayloadSchema,
  ),
  request("workbench/deferClarification", WorkbenchClarificationPayloadSchema),
  request(
    "workbench/markClarificationNotApplicable",
    WorkbenchClarificationPayloadSchema,
  ),
  request("workbench/reopenClarification", WorkbenchClarificationPayloadSchema),
  request("workbench/generateSpecification", WorkflowIdPayloadSchema),
  request(
    "workbench/updateSpecification",
    WorkbenchSpecificationUpdatePayloadSchema,
  ),
  request("workbench/generateAcceptanceCriteria", WorkflowIdPayloadSchema),
  request(
    "workbench/approveSpecification",
    WorkbenchSpecificationApprovePayloadSchema,
  ),
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
  request(
    "build/updateCustomizationSelection",
    BuildCustomizationSelectionPayloadSchema,
  ),
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
  request(
    "build/getValidationPlan",
    z.object({ planId: z.string().uuid() }).strict(),
  ),
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
  request("build/prepareHandoff", HandoffCreatePayloadSchema),
  request("build/validateHandoff", HandoffValidatePayloadSchema),
  request("build/exportHandoff", HandoffExportPayloadSchema),
  request("build/cancelHandoff", HandoffPackageIdPayloadSchema),
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
  request("copilot/getToolAudit", z.object({ limit: z.number().int().min(1).max(200).default(50) }).strict()),
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
  request(
    "validation/getPlan",
    z.object({ planId: z.string().uuid() }).strict(),
  ),
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
  request("git/readiness", DeliveryWorkflowPayloadSchema),
  request("delivery/createChangeSet", DeliveryWorkflowPayloadSchema),
  request("delivery/getChangeSet", DeliveryChangeSetPayloadSchema),
  request("delivery/includeFile", DeliveryFileDecisionPayloadSchema),
  request("delivery/excludeFile", DeliveryFileDecisionPayloadSchema),
  request(
    "delivery/attributeFile",
    DeliveryFileDecisionPayloadSchema.extend({
      attribution: z.enum([
        "expected",
        "related",
        "unexpected",
        "pre-existing",
        "concurrent",
        "ambiguous",
        "excluded",
        "generated-output",
      ]),
    }).strict(),
  ),
  request("delivery/rebuildChangeSet", DeliveryWorkflowPayloadSchema),
  request(
    "commitPlan/create",
    z
      .object({
        changeSetId: z.string().uuid(),
        convention: z
          .enum(["conventional", "plain", "repository", "user-template"])
          .optional(),
      })
      .strict(),
  ),
  request(
    "commitPlan/get",
    z.object({ commitPlanId: z.string().uuid() }).strict(),
  ),
  request("commitPlan/update", z.object({ plan: CommitPlanSchema }).strict()),
  request(
    "commitPlan/merge",
    z
      .object({
        commitPlanId: z.string().uuid(),
        commitIds: z.array(z.string().uuid()).min(2).max(50),
      })
      .strict(),
  ),
  request(
    "commitPlan/split",
    z
      .object({
        commitPlanId: z.string().uuid(),
        commitId: z.string().uuid(),
        fileIds: z.array(z.string().max(500)).min(1).max(5000),
        title: z.string().min(1).max(200),
      })
      .strict(),
  ),
  request(
    "commitPlan/reorder",
    z
      .object({
        commitPlanId: z.string().uuid(),
        commitIds: z.array(z.string().uuid()).min(1).max(50),
      })
      .strict(),
  ),
  request(
    "commitPlan/moveFile",
    z
      .object({
        commitPlanId: z.string().uuid(),
        fileId: z.string().max(500),
        targetCommitId: z.string().uuid(),
      })
      .strict(),
  ),
  request(
    "commitPlan/approve",
    z
      .object({ commitPlanId: z.string().uuid(), confirm: z.literal(true) })
      .strict(),
  ),
  request(
    "git/stage",
    z
      .object({
        changeSetId: z.string().uuid(),
        paths: z.array(z.string().max(1024)).min(1).max(5000),
        confirm: z.literal(true),
      })
      .strict(),
  ),
  request(
    "git/unstage",
    z
      .object({
        changeSetId: z.string().uuid(),
        paths: z.array(z.string().max(1024)).min(1).max(5000),
        confirm: z.literal(true),
      })
      .strict(),
  ),
  request(
    "git/createBranch",
    z
      .object({ branch: z.string().min(1).max(200), confirm: z.literal(true) })
      .strict(),
  ),
  request(
    "git/commit",
    z
      .object({
        changeSetId: z.string().uuid(),
        commitPlanId: z.string().uuid(),
        proposedCommitId: z.string().uuid(),
        message: z.string().min(1).max(20_000),
        confirm: z.literal(true),
      })
      .strict(),
  ),
  request(
    "git/push",
    z
      .object({
        remote: z.string().min(1).max(200),
        branch: z.string().min(1).max(500),
        confirm: z.literal(true),
      })
      .strict(),
  ),
  request("pullRequest/capabilities", z.object({}).strict()),
  request("pullRequest/templates", z.object({}).strict()),
  request(
    "pullRequest/createDraft",
    z
      .object({
        changeSetId: z.string().uuid(),
        commitPlanId: z.string().uuid(),
        baseBranch: z.string().min(1).max(500),
      })
      .strict(),
  ),
  request(
    "pullRequest/updateDraft",
    z.object({ draft: PullRequestDraftSchema }).strict(),
  ),
  request("pullRequest/validate", PullRequestDraftPayloadSchema),
  request(
    "pullRequest/approve",
    PullRequestDraftPayloadSchema.extend({ confirm: z.literal(true) }).strict(),
  ),
  request(
    "pullRequest/create",
    PullRequestDraftPayloadSchema.extend({ confirm: z.literal(true) }).strict(),
  ),
  request(
    "pullRequest/confirmExternalCreation",
    PullRequestDraftPayloadSchema.extend({
      url: z.string().url().max(2000),
      confirm: z.literal(true),
    }).strict(),
  ),
  request("pullRequest/status", PullRequestDraftPayloadSchema),
  request("pullRequest/refresh", PullRequestDraftPayloadSchema),
  request("team/participants", z.object({}).strict()),
  request("team/addParticipant", ParticipantCreatePayloadSchema),
  request("team/updateParticipant", ParticipantUpdatePayloadSchema),
  request("team/removeParticipant", ParticipantIdPayloadSchema),
  request("team/capabilities", z.object({}).strict()),
  request("assignment/create", AssignmentCreatePayloadSchema),
  request(
    "assignment/get",
    z.object({ assignmentId: z.string().uuid() }).strict(),
  ),
  request(
    "assignment/list",
    z.object({ workflowId: z.string().uuid().optional() }).strict(),
  ),
  request(
    "assignment/update",
    z
      .object({
        assignmentId: z.string().uuid(),
        patch: TaskAssignmentSchema.pick({
          priority: true,
          dueDate: true,
          notes: true,
        }).partial(),
      })
      .strict(),
  ),
  request("assignment/accept", AssignmentDecisionPayloadSchema),
  request("assignment/reject", AssignmentDecisionPayloadSchema),
  request("assignment/requestClarification", AssignmentDecisionPayloadSchema),
  request("assignment/reassign", ReassignmentPayloadSchema),
  request("assignment/cancel", AssignmentDecisionPayloadSchema),
  request("handoff/prepare", HandoffCreatePayloadSchema),
  request("handoff/get", HandoffPackageIdPayloadSchema),
  request("handoff/validate", HandoffValidatePayloadSchema),
  request("handoff/export", HandoffExportPayloadSchema),
  request("handoff/import", HandoffImportPayloadSchema),
  request("handoff/reconcile", HandoffReconcilePayloadSchema),
  request("handoff/accept", HandoffAcceptPayloadSchema),
  request("handoff/reject", HandoffAcceptPayloadSchema),
  request("handoff/importReadOnly", HandoffAcceptPayloadSchema),
  request("handoff/cancel", HandoffPackageIdPayloadSchema),
  request("progress/workflows", z.object({}).strict()),
  request("progress/tasks", TeamProgressPayloadSchema),
  request(
    "progress/assignments",
    z.object({ workflowId: z.string().uuid().optional() }).strict(),
  ),
  request("progress/refresh", TeamProgressPayloadSchema),
  request("progress/audit", TeamAuditPayloadSchema),
  request("execution/route", ExecutionRoutingRequestSchema),
  request(
    "request/cancel",
    z.object({ targetRequestId: z.string().uuid() }).strict(),
  ),
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
    error: z
      .object({ code: z.string(), message: z.string() })
      .strict()
      .optional(),
  })
  .strict();
const CopilotIntegrationEventPayloadSchema = z.object({ repositoryId: z.string().max(500).optional(), workflowId: z.string().uuid().optional(), taskId: z.string().uuid().optional(), generation: z.number().int().nonnegative().optional(), invocationId: z.string().uuid().optional(), message: z.string().max(2000), at: z.string().datetime() }).strict();

export const HostMessageSchema = z.discriminatedUnion("type", [
  event("review/stateChanged", ReviewLifecycleEventSchema),
  event("review/noteChanged", ReviewLifecycleEventSchema),
  event("review/changesRequested", ReviewLifecycleEventSchema),
  event("review/approved", ReviewLifecycleEventSchema),
  event("review/stale", ReviewLifecycleEventSchema),
  event("review/prDraftChanged", ReviewLifecycleEventSchema),
  event("complete/optionsChanged", ReviewLifecycleEventSchema),
  event("complete/changeSetChanged", ReviewLifecycleEventSchema),
  event("complete/commitPlanChanged", ReviewLifecycleEventSchema),
  event("complete/commitCreated", ReviewLifecycleEventSchema),
  event("complete/pushCompleted", ReviewLifecycleEventSchema),
  event("complete/prCreated", ReviewLifecycleEventSchema),
  event("complete/patchExported", ReviewLifecycleEventSchema),
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
    z
      .object({ requestId: z.string().uuid(), data: z.unknown().optional() })
      .strict(),
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
  event("keystone/navigationRequest", ValidatedNavigationSchema.extend({ sequence: z.number().int().nonnegative() }).strict()),
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
    z
      .object({ runId: z.string().uuid(), message: z.string().max(2000) })
      .strict(),
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
  event(
    "git/stateChanged",
    z.object({ message: z.string().max(2000) }).strict(),
  ),
  event(
    "git/actionStarted",
    z
      .object({ action: z.string().max(100), message: z.string().max(2000) })
      .strict(),
  ),
  event(
    "git/actionProgress",
    z
      .object({ action: z.string().max(100), message: z.string().max(2000) })
      .strict(),
  ),
  event(
    "git/actionCompleted",
    z
      .object({
        action: z.string().max(100),
        resultId: z.string().uuid(),
        message: z.string().max(2000),
      })
      .strict(),
  ),
  event(
    "git/actionFailed",
    z
      .object({ action: z.string().max(100), message: z.string().max(2000) })
      .strict(),
  ),
  event(
    "delivery/changeSetChanged",
    z
      .object({ changeSetId: z.string().uuid(), message: z.string().max(2000) })
      .strict(),
  ),
  event(
    "delivery/stale",
    z
      .object({ changeSetId: z.string().uuid(), message: z.string().max(2000) })
      .strict(),
  ),
  event(
    "commitPlan/changed",
    z
      .object({
        commitPlanId: z.string().uuid(),
        message: z.string().max(2000),
      })
      .strict(),
  ),
  event(
    "commitPlan/stale",
    z
      .object({
        commitPlanId: z.string().uuid(),
        message: z.string().max(2000),
      })
      .strict(),
  ),
  event(
    "commitPlan/commitCreated",
    z
      .object({
        commitPlanId: z.string().uuid(),
        commitHash: z.string().max(100),
        message: z.string().max(2000),
      })
      .strict(),
  ),
  event(
    "pullRequest/draftChanged",
    z
      .object({ draftId: z.string().uuid(), message: z.string().max(2000) })
      .strict(),
  ),
  event(
    "pullRequest/creationStarted",
    z
      .object({ draftId: z.string().uuid(), message: z.string().max(2000) })
      .strict(),
  ),
  event(
    "pullRequest/created",
    z
      .object({
        draftId: z.string().uuid(),
        url: z.string().url().max(2000),
        message: z.string().max(2000),
      })
      .strict(),
  ),
  event(
    "pullRequest/statusChanged",
    z
      .object({
        draftId: z.string().uuid(),
        status: z.string().max(100),
        message: z.string().max(2000),
      })
      .strict(),
  ),
  event(
    "pullRequest/failed",
    z
      .object({
        draftId: z.string().uuid().optional(),
        message: z.string().max(2000),
      })
      .strict(),
  ),
  event(
    "pullRequest/stale",
    z
      .object({ draftId: z.string().uuid(), message: z.string().max(2000) })
      .strict(),
  ),
  event(
    "team/participantsChanged",
    z
      .object({
        participantIds: z.array(z.string().uuid()).max(500),
        message: z.string().max(2000),
      })
      .strict(),
  ),
  event("assignment/created", teamLifecycle("assignmentId")),
  event("assignment/statusChanged", teamLifecycle("assignmentId")),
  event("assignment/stale", teamLifecycle("assignmentId")),
  event("assignment/reassigned", teamLifecycle("assignmentId")),
  event("handoff/preparationStarted", teamLifecycle("packageId", true)),
  event("handoff/prepared", teamLifecycle("packageId")),
  event("handoff/exported", teamLifecycle("packageId")),
  event("handoff/imported", teamLifecycle("packageId")),
  event("handoff/reconciliationCompleted", teamLifecycle("packageId")),
  event("handoff/accepted", teamLifecycle("packageId")),
  event("handoff/rejected", teamLifecycle("packageId")),
  event("handoff/stale", teamLifecycle("packageId")),
  event("handoff/failed", teamLifecycle("packageId", true)),
  event(
    "progress/changed",
    z
      .object({ workflowId: z.string().uuid(), message: z.string().max(2000) })
      .strict(),
  ),
  event(
    "progress/blockerChanged",
    z
      .object({
        workflowId: z.string().uuid(),
        taskId: z.string().uuid().optional(),
        message: z.string().max(2000),
      })
      .strict(),
  ),
]);
export type HostMessage = z.infer<typeof HostMessageSchema>;

export interface WebviewRequestResults {
  "review/getState": WorkflowReviewState;
  "review/getSummary": WorkflowReviewState["summary"];
  "review/getTraceability": WorkflowReviewState["traceability"];
  "review/getChanges": WorkflowReviewState["changes"];
  "review/getDiff": { path: string; text: string; binary: boolean; truncated: boolean; totalBytes: number };
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
  "review/generatePrDraft": PullRequestDraft;
  "review/getPrDraft": PullRequestDraft | undefined;
  "review/updatePrDraft": PullRequestDraft;
  "review/getPrChecklist": WorkflowReviewState["checklist"];
  "review/getReadiness": { ready: boolean; blockers: string[]; warnings: string[] };
  "review/approve": ReviewDecision;
  "review/approveWithWarnings": ReviewDecision;
  "review/reject": ReviewDecision;
  "review/returnToBuild": ReviewDecision;
  "review/returnToDefine": ReviewDecision;
  "review/dispositionFinding": FindingDisposition;
  "complete/getState": CompletionState;
  "complete/getOptions": CompletionState["options"];
  "complete/getReport": WorkflowCompletionRecord | undefined;
  "complete/completeLocally": WorkflowCompletionRecord;
  "complete/closePartial": WorkflowCompletionRecord;
  "complete/cancelWithChanges": WorkflowCompletionRecord;
  "complete/archive": WorkflowCompletionRecord;
  "complete/getChangeSet": DeliveryChangeSet | undefined;
  "complete/updateChangeSet": DeliveryChangeSet;
  "complete/generateCommitPlan": CommitPlan;
  "complete/updateCommitPlan": CommitPlan;
  "complete/approveStaging": GitMutationApproval;
  "complete/stageChanges": GitActionResult;
  "complete/approveCommit": GitMutationApproval;
  "complete/createCommit": GitActionResult;
  "complete/getPushReadiness": DeliveryReadiness;
  "complete/approvePush": GitMutationApproval;
  "complete/push": GitActionResult;
  "complete/getPrCapabilities": PullRequestProviderCapability;
  "complete/preparePr": PullRequestDraft;
  "complete/approvePrCreation": GitMutationApproval;
  "complete/createPr": PullRequestCreationResult;
  "complete/confirmAssistedPr": PullRequestCreationResult;
  "complete/preparePatch": { paths: string[]; totalBytes: number; blockedPaths: string[] };
  "complete/approvePatchExport": GitMutationApproval;
  "complete/exportPatch": { path: string; hash: string };
  "complete/prepareHandoff": HandoffPackage;
  "complete/exportHandoff": { uri: string; hash: string };
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
  "build/createContext": TaskContextPackage;
  "build/getContext": TaskContextPackage | undefined;
  "build/updateContextItem": TaskContextPackage;
  "build/pinContextItem": TaskContextPackage;
  "build/excludeContextItem": TaskContextPackage;
  "build/regenerateContext": TaskContextPackage;
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
  "build/prepareHandoff": HandoffPackage;
  "build/validateHandoff": HandoffValidationResult;
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
  "context/build": TaskContextPackage;
  "context/get": TaskContextPackage | undefined;
  "context/update": TaskContextPackage;
  "context/addEntity": TaskContextPackage;
  "context/addFile": TaskContextPackage;
  "context/removeItem": TaskContextPackage;
  "context/pinItem": TaskContextPackage;
  "context/unpinItem": TaskContextPackage;
  "context/changeBudget": TaskContextPackage;
  "context/regenerate": TaskContextPackage;
  "context/validate": TaskContextPackage;
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
  "git/capabilities": GitCapabilities;
  "git/refresh": GitCapabilities;
  "git/repositoryState": GitRepositoryState;
  "git/remotes": GitRepositoryState["remotes"];
  "git/branches": {
    current?: string;
    upstream?: string;
    defaultBranch?: string;
    detached: boolean;
  };
  "git/diff": {
    path: string;
    text: string;
    binary: boolean;
    truncated: boolean;
    totalBytes: number;
  };
  "git/readiness": DeliveryReadiness;
  "delivery/createChangeSet": DeliveryChangeSet;
  "delivery/getChangeSet": DeliveryChangeSet | undefined;
  "delivery/includeFile": DeliveryChangeSet;
  "delivery/excludeFile": DeliveryChangeSet;
  "delivery/attributeFile": DeliveryChangeSet;
  "delivery/rebuildChangeSet": DeliveryChangeSet;
  "commitPlan/create": CommitPlan;
  "commitPlan/get": CommitPlan | undefined;
  "commitPlan/update": CommitPlan;
  "commitPlan/merge": CommitPlan;
  "commitPlan/split": CommitPlan;
  "commitPlan/reorder": CommitPlan;
  "commitPlan/moveFile": CommitPlan;
  "commitPlan/approve": CommitPlan;
  "git/stage": GitActionResult;
  "git/unstage": GitActionResult;
  "git/createBranch": GitActionResult;
  "git/commit": GitActionResult;
  "git/push": GitActionResult;
  "pullRequest/capabilities": PullRequestProviderCapability;
  "pullRequest/templates": Array<{ id: string; name: string; body: string }>;
  "pullRequest/createDraft": PullRequestDraft;
  "pullRequest/updateDraft": PullRequestDraft;
  "pullRequest/validate": {
    ready: boolean;
    blockers: string[];
    warnings: string[];
  };
  "pullRequest/approve": PullRequestDraft;
  "pullRequest/create": PullRequestCreationResult;
  "pullRequest/confirmExternalCreation": PullRequestCreationResult;
  "pullRequest/status": PullRequestCreationResult | undefined;
  "pullRequest/refresh": PullRequestCreationResult | undefined;
  "team/participants": TeamParticipant[];
  "team/addParticipant": TeamParticipant;
  "team/updateParticipant": TeamParticipant;
  "team/removeParticipant": undefined;
  "team/capabilities": {
    identityAssurance: "self-asserted-local";
    capabilities: string[];
    limitations: string[];
  };
  "assignment/create": TaskAssignment;
  "assignment/get": TaskAssignment | undefined;
  "assignment/list": TaskAssignment[];
  "assignment/update": TaskAssignment;
  "assignment/accept": TaskAssignment;
  "assignment/reject": TaskAssignment;
  "assignment/requestClarification": TaskAssignment;
  "assignment/reassign": TaskAssignment;
  "assignment/cancel": TaskAssignment;
  "handoff/prepare": HandoffPackage;
  "handoff/get": HandoffPackage | undefined;
  "handoff/validate": HandoffValidationResult;
  "handoff/export": { destination?: string };
  "handoff/import":
    | {
        package: HandoffPackage;
        validation: HandoffValidationResult;
        importId: string;
      }
    | undefined;
  "handoff/reconcile": HandoffReconciliation;
  "handoff/accept": HandoffAcceptance;
  "handoff/reject": HandoffAcceptance;
  "handoff/importReadOnly": HandoffAcceptance;
  "handoff/cancel": undefined;
  "progress/workflows": TeamPersistentState["progress"];
  "progress/tasks": TeamProgressSnapshot;
  "progress/assignments": TaskAssignment[];
  "progress/refresh": TeamProgressSnapshot;
  "progress/audit": TeamAuditEntry[];
  "execution/route": ExecutionRoutingDecision;
  "request/cancel": undefined;
}

export type WebviewResult<T extends WebviewRequestType> =
  WebviewRequestResults[T];

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
  return z
    .object({ ...envelopeFields, type: z.literal(type), payload })
    .strict();
}

function event<T extends string, P extends z.ZodType>(type: T, payload: P) {
  return z
    .object({ ...hostEnvelopeFields, type: z.literal(type), payload })
    .strict();
}

function teamLifecycle(key: "assignmentId" | "packageId", optional = false) {
  const id = optional ? z.string().uuid().optional() : z.string().uuid();
  return z.object({ [key]: id, message: z.string().max(2000) }).strict();
}

export type { SerializedKeystoneError };
