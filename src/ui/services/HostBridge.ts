import { z } from "zod";
import { HomeStateSchema } from "../../shared/contracts/home";
import { CanonicalWorkflowSchema, WorkflowCreatedResponseSchema, WorkflowCreationFailedResponseSchema } from "../../shared/contracts/canonicalWorkflow";
import { DevelopmentAggregateSchema } from "../../shared/contracts/development";
import { ExecutionConfigurationAggregateSchema, InstructionPreviewSchema, SkillDefinitionSchema } from "../../shared/contracts/executionConfiguration";
import {
  BootstrapSnapshotSchema,
  PersistedFoundationStateSchema,
  SCHEMA_VERSION,
  type AppRoute,
  type BootstrapSnapshot,
  type PersistedFoundationState,
} from "../../shared/contracts/domain";
import {
  IntelligenceDiagnosticsResultSchema,
  IntelligenceEntityDetailsSchema,
  IntelligenceNeighborhoodSchema,
  IntelligenceOverviewSchema,
  IntelligenceSearchResultSchema,
  emptyIntelligenceOverview,
  type IntelligenceOverview,
} from "../../shared/contracts/intelligence";
import { QaTestIntelligenceAggregateSchema } from "../../shared/contracts/qaTestIntelligence";
import {
  HostMessageSchema,
  hostMessage,
  type HostMessage,
  type WebviewPayload,
  type WebviewRequest,
  type WebviewRequestType,
  type WebviewResult,
} from "../../shared/contracts/messages";
import { CpgQueryResultSchema, CpgSliceResultSchema } from "../../shared/contracts/cpg";
import {
  IntelligenceQueryResultSchema,
  QueryCompilationSchema,
  QueryExplanationSchema,
  QuerySuggestionsResultSchema,
  QueryTemplatesResultSchema,
} from "../../shared/contracts/query";
import {
  AgentRecommendationSchema,
  CopilotAgentDescriptorSchema,
  CopilotCapabilitiesSchema,
  DelegationSessionSchema,
  DevelopmentWorkflowSnapshotSchema,
  PreparedDelegationSchema,
  TaskContextPackageSchema,
  WorkflowClarificationSchema,
} from "../../shared/contracts/delegation";
import {
  CompletionDecisionSchema,
  RetryPlanSchema,
  TaskExecutionSessionSchema,
  ValidationPlanSchema,
  ValidationRunSchemaV2,
  WorkflowCompletionReportSchema,
} from "../../shared/contracts/execution";
import {
} from "../../shared/contracts/delivery";
import {
  HandoffCompatibilityReportSchema,
  HandoffPrivacyReportSchema,
  TaskHandoffSchema,
  TaskHandoffPackageSchema,
} from "../../shared/contracts/handoff";
import { ExecutionRoutingDecisionSchema } from "../../shared/contracts/routing";
import {
  OrchestrationReviewPlanSchema,
  WorkflowDefinitionSchema,
  WorkflowInstanceSchema,
  WorkflowPolicySchema,
} from "../../shared/contracts/orchestration";
import {
  AdapterDiagnosticsResultSchema,
  TechnologyCoverageResultSchema,
} from "../../shared/contracts/adapters";
import { sectionForRoute } from "../../shared/navigation";
import {
  WorkbenchCreateContextSchema,
  WorkbenchDefineStateSchema,
  WorkbenchPlanStateSchema,
  WorkbenchSummarySchema,
  WorkbenchTaskPlanValidationSchema,
  WorkbenchWorkflowStateSchema,
} from "../../shared/contracts/workbench";
import {
  BuildTaskQueueSchema,
  BuildTaskStateSchema,
  CopilotCustomizationItemSchema,
} from "../../shared/contracts/build";
import {
  CompletionStateSchema,
  FindingDispositionSchema,
  ReviewDecisionSchema,
  ReviewNoteSchema,
  WorkflowCompletionRecordSchema,
  WorkflowReviewStateSchema,
} from "../../shared/contracts/review";
import {
  ChangeReadinessDecisionSchema,
  PullRequestPackageSchema,
  ReviewFindingSchema,
} from "../../shared/contracts/prReview";
import {
  AssistedLaunchStateSchema,
  CopilotCustomizationRecordSchema,
  CopilotIntegrationCapabilitiesSchema,
  CopilotToolAuditEntrySchema,
  KeystoneToolDescriptorSchema,
  KeystoneToolResultSchema,
} from "../../shared/contracts/copilotIntegration";
import {
  KeystoneDashboardStateSchema,
  KeystoneInitializationSchema,
  KeystonePanelStateSchema,
  ValidatedNavigationSchema,
} from "../../shared/contracts/nativeShell";

interface VsCodeApi {
  postMessage(message: unknown): void;
  getState(): unknown;
  setState(state: unknown): void;
}

declare function acquireVsCodeApi(): VsCodeApi;

type Listener = (message: HostMessage) => void;

interface PendingRequest {
  type: WebviewRequestType;
  resolve(value: unknown): void;
  reject(reason: Error): void;
  timer: number;
  removeAbort?: () => void;
}

export class HostBridge {
  private readonly pending = new Map<string, PendingRequest>();
  private readonly listeners = new Set<Listener>();

  constructor(private readonly api: VsCodeApi) {
    window.addEventListener("message", this.receive);
  }

  request<T extends WebviewRequestType>(
    type: T,
    payload: WebviewPayload<T>,
    options?: { signal?: AbortSignal },
  ): Promise<WebviewResult<T>> {
    const requestId = crypto.randomUUID();
    const request = {
      requestId,
      type,
      timestamp: new Date().toISOString(),
      schemaVersion: SCHEMA_VERSION,
      payload,
    } as WebviewRequest;
    return new Promise<WebviewResult<T>>((resolve, reject) => {
      if (options?.signal?.aborted) {
        reject(new DOMException("The Keystone request was cancelled.", "AbortError"));
        return;
      }
      const timeoutMs = type === "qa.execute" ? 3_600_000 : 15_000;
      const timer = window.setTimeout(() => {
        this.settle(requestId);
        reject(new Error(`Keystone host request timed out: ${type}`));
        this.postCancellation(requestId);
      }, timeoutMs);
      const pending: PendingRequest = { type, resolve, reject, timer };
      if (options?.signal) {
        const abort = (): void => {
          this.settle(requestId);
          reject(new DOMException("The Keystone request was cancelled.", "AbortError"));
          this.postCancellation(requestId);
        };
        options.signal.addEventListener("abort", abort, { once: true });
        pending.removeAbort = () => options.signal?.removeEventListener("abort", abort);
      }
      this.pending.set(requestId, pending);
      this.api.postMessage(request);
    });
  }

  subscribe(listener: Listener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  getWebviewState(): unknown {
    return this.api.getState();
  }

  setWebviewState(state: unknown): void {
    this.api.setState(state);
  }

  dispose(): void {
    window.removeEventListener("message", this.receive);
    for (const [requestId, request] of this.pending) {
      window.clearTimeout(request.timer);
      request.removeAbort?.();
      request.reject(new Error("The Keystone Webview was disposed."));
      this.pending.delete(requestId);
    }
    this.listeners.clear();
  }

  private readonly receive = (event: MessageEvent<unknown>): void => {
    const parsed = HostMessageSchema.safeParse(event.data);
    if (!parsed.success) return;
    const message = parsed.data;
    if (message.type === "response/success" || message.type === "response/error") {
      const pending = this.pending.get(message.payload.requestId);
      if (pending) {
        this.settle(message.payload.requestId);
        if (message.type === "response/success") {
          try {
            pending.resolve(validateResult(pending.type, message.payload.data));
          } catch (cause) {
            pending.reject(cause instanceof Error ? cause : new Error(String(cause)));
          }
        } else {
          pending.reject(
            new Error(
              `${message.payload.error.message} ${message.payload.error.recommendedAction}`,
            ),
          );
        }
      }
    }
    for (const listener of this.listeners) listener(message);
  };

  private settle(requestId: string): void {
    const pending = this.pending.get(requestId);
    if (!pending) return;
    window.clearTimeout(pending.timer);
    pending.removeAbort?.();
    this.pending.delete(requestId);
  }

  private postCancellation(targetRequestId: string): void {
    this.api.postMessage({
      requestId: crypto.randomUUID(),
      type: "request/cancel",
      timestamp: new Date().toISOString(),
      schemaVersion: SCHEMA_VERSION,
      payload: { targetRequestId },
    } satisfies WebviewRequest);
  }
}

export function createHostBridge(): HostBridge {
  if (typeof acquireVsCodeApi === "function") return new HostBridge(acquireVsCodeApi());
  if (import.meta.env.DEV) return new HostBridge(createPreviewApi());
  throw new Error("Keystone must run inside a VS Code Webview.");
}

function validateResult(type: WebviewRequestType, value: unknown): unknown {
  switch (type) {
    case "home/getState":
      return HomeStateSchema.parse(value);
    case "workflow.create":
      return WorkflowCreatedResponseSchema.or(WorkflowCreationFailedResponseSchema).parse(value);
    case "workflow.loadActive":
      return value === null ? null : CanonicalWorkflowSchema.parse(value);
    case "workflow.listCanonical":
      return CanonicalWorkflowSchema.array().max(1000).parse(value);
    case "workflow.getCanonical":
      return value === undefined ? undefined : CanonicalWorkflowSchema.parse(value);
    case "workflow.setActiveCanonical":
      return CanonicalWorkflowSchema.parse(value);
    case "development.initialize":
    case "development.load":
    case "development.updateObjective":
    case "development.addCurrentFile":
    case "development.addSelectedFiles":
    case "development.addCurrentSelection":
    case "development.addIntelligenceSymbol":
    case "development.removeScopeItem":
    case "development.preparePrompt":
    case "development.context.build":
    case "development.context.changeBudget":
    case "development.context.approve":
    case "development.context.pin":
    case "development.context.remove":
    case "development.context.restore":
    case "development.copyPrompt":
    case "development.confirmHandoff":
    case "development.recordManualOrigin":
    case "development.loadChanges":
    case "development.recordResult":
    case "development.associateChangedFiles":
    case "development.confirmNoCode":
    case "development.reviewResult":
    case "development.complete":
      return DevelopmentAggregateSchema.parse(value);
    case "executionConfiguration.load":
    case "executionConfiguration.refresh":
    case "executionConfiguration.discoverInstructions":
    case "executionConfiguration.listSkills":
    case "executionConfiguration.detectConflicts":
    case "executionConfiguration.createManualAgent":
    case "executionConfiguration.updateManualAgent":
    case "executionConfiguration.deleteManualAgent":
    case "executionConfiguration.addInstructionFile":
    case "executionConfiguration.validateProfile":
    case "executionConfiguration.saveProfile":
      return ExecutionConfigurationAggregateSchema.parse(value);
    case "executionConfiguration.previewInstruction":
      return InstructionPreviewSchema.parse(value);
    case "executionConfiguration.previewSkill":
      return SkillDefinitionSchema.parse(value);
    case "keystone/webviewReady":
      return KeystoneInitializationSchema.parse(value);
    case "keystone/initializationAcknowledged":
    case "keystone/navigationAcknowledged":
    case "keystone/webviewStateChanged":
    case "panel/getState":
    case "panel/updateState":
      return KeystonePanelStateSchema.parse(value);
    case "dashboard/getState":
    case "dashboard/refresh":
      return KeystoneDashboardStateSchema.parse(value);
    case "dashboard/openAction":
    case "navigation/validateTarget":
    case "navigation/resolveFallback":
    case "navigation/open":
      return ValidatedNavigationSchema.parse(value);
    case "panel/getPendingNavigation":
      return value === undefined ? undefined : ValidatedNavigationSchema.parse(value);
    case "orchestration/create":
    case "orchestration/plan":
    case "orchestration/start":
    case "orchestration/pause":
    case "orchestration/resume":
    case "orchestration/cancel":
    case "orchestration/recover":
    case "orchestration/approve":
    case "orchestration/reject":
    case "orchestration/requestChanges":
    case "orchestration/override":
    case "orchestration/startTask":
    case "orchestration/pauseTask":
    case "orchestration/cancelTask":
    case "orchestration/retryTask":
    case "orchestration/changeAgent":
    case "orchestration/skipOptionalTask":
    case "orchestration/qaFinding":
    case "orchestration/qaAccept":
    case "orchestration/qaReturn":
    case "orchestration/securityFinding":
    case "orchestration/securityAccept":
    case "orchestration/performanceFinding":
    case "orchestration/performanceAccept":
    case "orchestration/report":
      return WorkflowInstanceSchema.parse(value);
    case "orchestration/get":
    case "orchestration/status":
      return value === undefined ? undefined : WorkflowInstanceSchema.parse(value);
    case "orchestration/list":
      return WorkflowInstanceSchema.array().max(100).parse(value);
    case "orchestration/definitions":
      return WorkflowDefinitionSchema.array().max(20).parse(value);
    case "orchestration/policies":
      return WorkflowPolicySchema.array().max(20).parse(value);
    case "orchestration/validatePlan":
      return value;
    case "orchestration/taskReadiness":
      return value;
    case "orchestration/schedule":
    case "orchestration/conflicts":
      return value;
    case "orchestration/approvals":
      return WorkflowInstanceSchema.shape.approvalGates.parse(value);
    case "orchestration/audit":
      return WorkflowInstanceSchema.shape.audit.parse(value);
    case "orchestration/metrics":
      return WorkflowInstanceSchema.shape.metrics.parse(value);
    case "orchestration/qaPlan":
    case "orchestration/qaRun":
    case "orchestration/securityPlan":
    case "orchestration/securityRun":
    case "orchestration/performancePlan":
    case "orchestration/performanceRun":
    case "orchestration/validationPlan":
    case "orchestration/runValidation":
    case "orchestration/rerunValidation":
      return OrchestrationReviewPlanSchema.parse(value);
    case "orchestration/cancelValidation":
      return undefined;
    case "app/bootstrap":
      return BootstrapSnapshotSchema.parse(value);
    case "navigation/set":
      return PersistedFoundationStateSchema.parse(value);
    case "intelligence/overview":
      return IntelligenceOverviewSchema.parse(value);
    case "intelligence/search":
      return IntelligenceSearchResultSchema.parse(value);
    case "intelligence/diagnostics":
      return IntelligenceDiagnosticsResultSchema.parse(value);
    case "intelligence/entity":
      return value === undefined ? undefined : IntelligenceEntityDetailsSchema.parse(value);
    case "intelligence/neighborhood":
      return IntelligenceNeighborhoodSchema.parse(value);
    case "intelligence.canvas.search":
    case "intelligence.canvas.graph":
    case "intelligence.canvas.expand":
    case "intelligence.canvas.evidence":
    case "intelligence.canvas.query":
    case "intelligence.canvas.addScope":
    case "intelligence.canvas.addContext":
    case "intelligence.canvas.addPathContext":
      return value;
    case "intelligence/technologies":
      return TechnologyCoverageResultSchema.parse(value);
    case "intelligence/adapter-diagnostics":
      return AdapterDiagnosticsResultSchema.parse(value);
    case "intelligence/cpg/scope":
      return value === undefined ? undefined : CpgQueryResultSchema.parse(value);
    case "intelligence/cpg/slice":
      return value === undefined ? undefined : CpgSliceResultSchema.parse(value);
    case "intelligence/query":
    case "intelligence/path":
    case "intelligence/impact":
    case "intelligence/flow":
    case "intelligence/architecture":
    case "intelligence/dependencies":
    case "intelligence/tests":
    case "intelligence/changes":
    case "intelligence/cpg":
      return IntelligenceQueryResultSchema.parse(value);
    case "intelligence/query/compile":
      return QueryCompilationSchema.parse(value);
    case "intelligence/query/suggestions":
      return QuerySuggestionsResultSchema.parse(value);
    case "intelligence/query/templates":
      return QueryTemplatesResultSchema.parse(value);
    case "intelligence/query/explanation":
      return value === undefined ? undefined : QueryExplanationSchema.parse(value);
    case "workflow/capture":
    case "workflow/spec/submit":
    case "workflow/spec/revise":
    case "workflow/spec/resolveDecision":
    case "workflow/spec/approve":
    case "workflow/tasks/generate":
    case "workflow/reconcile":
    case "copilot/selectAgent":
    case "build/selectAgent":
      return DevelopmentWorkflowSnapshotSchema.parse(value);
    case "workflow/list":
      return DevelopmentWorkflowSnapshotSchema.array().max(100).parse(value);
    case "workflow/get":
      return value === undefined ? undefined : DevelopmentWorkflowSnapshotSchema.parse(value);
    case "workbench/getCreateContext":
      return WorkbenchCreateContextSchema.parse(value);
    case "workbench/createWorkflow":
    case "workbench/updateIntent":
    case "workbench/updateScope":
    case "workbench/updateConstraints":
    case "workbench/answerClarification":
    case "workbench/deferClarification":
    case "workbench/markClarificationNotApplicable":
    case "workbench/reopenClarification":
    case "workbench/generateSpecification":
    case "workbench/updateSpecification":
    case "workbench/generateAcceptanceCriteria":
    case "workbench/approveSpecification":
    case "workbench/generateTaskPlan":
    case "workbench/updateTask":
    case "workbench/addTask":
    case "workbench/removeTask":
    case "workbench/reorderTask":
    case "workbench/updateDependency":
    case "workbench/approveTaskPlan":
      return DevelopmentWorkflowSnapshotSchema.parse(value);
    case "workbench/getWorkflow":
      return value === undefined ? undefined : WorkbenchWorkflowStateSchema.parse(value);
    case "workbench/listWorkflows":
      return DevelopmentWorkflowSnapshotSchema.array().max(100).parse(value);
    case "workbench/openWorkflow":
    case "workbench/navigateStage":
      return WorkbenchWorkflowStateSchema.parse(value);
    case "workbench/getDefineState":
      return WorkbenchDefineStateSchema.parse(value);
    case "workbench/getClarifications":
      return WorkflowClarificationSchema.array().max(100).parse(value);
    case "workbench/getPlanState":
      return WorkbenchPlanStateSchema.parse(value);
    case "workbench/validateTaskPlan":
      return WorkbenchTaskPlanValidationSchema.parse(value);
    case "workbench/getStageStates":
      return [];
    case "workbench/getSummary":
      return WorkbenchSummarySchema.parse(value);
    case "build/getTaskQueue":
      return BuildTaskQueueSchema.parse(value);
    case "build/getTaskState":
    case "build/selectTask":
    case "build/startTask":
    case "build/pauseTask":
    case "build/resumeTask":
    case "build/blockTask":
    case "build/cancelTask":
      return BuildTaskStateSchema.parse(value);
    case "build/getCopilotCapabilities":
      return CopilotCapabilitiesSchema.parse(value);
    case "build/getCustomizations":
    case "build/updateCustomizationSelection":
      return CopilotCustomizationItemSchema.array().max(500).parse(value);
    case "build/getAgents":
      return CopilotAgentDescriptorSchema.array().max(200).parse(value);
    case "copilot/capabilities":
    case "copilot/refreshCapabilities":
      return CopilotCapabilitiesSchema.parse(value);
    case "copilot/agents":
    case "copilot/refreshAgents":
      return CopilotAgentDescriptorSchema.array().max(200).parse(value);
    case "copilot/agentRecommendation":
      return AgentRecommendationSchema.parse(value);
    case "copilot/getCapabilities":
    case "copilot/getIntegrationStatus":
      return CopilotIntegrationCapabilitiesSchema.parse(value);
    case "copilot/listCustomizations":
    case "copilot/refreshCustomizations":
    case "copilot/setCustomizationEnabled":
    case "copilot/getApplicableCustomizations":
      return CopilotCustomizationRecordSchema.array().max(500).parse(value);
    case "copilot/getCustomization":
      return value === undefined ? undefined : CopilotCustomizationRecordSchema.parse(value);
    case "copilot/listAgents":
      return CopilotAgentDescriptorSchema.array().max(200).parse(value);
    case "copilot/getAgent":
      return value === undefined ? undefined : CopilotAgentDescriptorSchema.parse(value);
    case "copilot/recommendAgent":
      return AgentRecommendationSchema.parse(value);
    case "copilot/listKeystoneTools":
      return KeystoneToolDescriptorSchema.array().max(50).parse(value);
    case "copilot/getToolStatus":
      return value === undefined ? undefined : KeystoneToolDescriptorSchema.parse(value);
    case "copilot/getToolAudit":
      return CopilotToolAuditEntrySchema.array().max(200).parse(value);
    case "copilot/testTool":
      return KeystoneToolResultSchema.parse(value);
    case "copilot/prepareAssistedLaunch":
    case "copilot/getPreparedPrompt":
    case "copilot/openChat":
    case "copilot/copyPrompt":
    case "copilot/confirmSubmission":
    case "copilot/cancelAssistedLaunch":
      return value === undefined ? undefined : AssistedLaunchStateSchema.parse(value);
    case "context/build":
    case "context/get":
    case "context/update":
    case "context/addEntity":
    case "context/addFile":
    case "context/removeItem":
    case "context/pinItem":
    case "context/unpinItem":
    case "context/changeBudget":
    case "context/regenerate":
    case "context/validate":
      return value === undefined ? undefined : TaskContextPackageSchema.parse(value);
    case "build/createContext":
    case "build/getContext":
    case "build/updateContextItem":
    case "build/pinContextItem":
    case "build/excludeContextItem":
    case "build/regenerateContext":
      return value === undefined ? undefined : TaskContextPackageSchema.parse(value);
    case "delegation/prepare":
    case "delegation/getPrompt":
    case "delegation/approve":
      return value === undefined ? undefined : PreparedDelegationSchema.parse(value);
    case "build/prepareDelegation":
    case "build/getPromptPreview":
    case "build/approveDelegation":
      return value === undefined ? undefined : PreparedDelegationSchema.parse(value);
    case "delegation/start":
    case "delegation/confirmStarted":
    case "delegation/confirmStopped":
    case "delegation/cancel":
    case "delegation/status":
      return value === undefined ? undefined : DelegationSessionSchema.parse(value);
    case "build/startDelegation":
    case "build/confirmAssistedState":
    case "build/cancelDelegation":
      return value === undefined ? undefined : DelegationSessionSchema.parse(value);
    case "execution/list":
      return TaskExecutionSessionSchema.array().max(500).parse(value);
    case "execution/start":
    case "execution/get":
    case "execution/confirmStarted":
    case "execution/confirmStopped":
    case "execution/cancel":
    case "execution/observeChanges":
    case "execution/attributeChange":
    case "execution/captureResult":
      return value === undefined ? undefined : TaskExecutionSessionSchema.parse(value);
    case "build/getExecutionState":
    case "build/getRepositoryChanges":
    case "build/updateChangeAttribution":
    case "build/refreshChanges":
      return value === undefined ? undefined : TaskExecutionSessionSchema.parse(value);
    case "validation/plan":
    case "validation/getPlan":
    case "validation/updatePlan":
    case "validation/approveCommand":
      return value === undefined ? undefined : ValidationPlanSchema.parse(value);
    case "build/getValidationPlan":
      return value === undefined ? undefined : ValidationPlanSchema.parse(value);
    case "validation/run":
    case "validation/getRun":
    case "validation/rerunStep":
    case "validation/override":
    case "validation/manualEvidence":
      return value === undefined ? undefined : ValidationRunSchemaV2.parse(value);
    case "build/runValidation":
    case "build/rerunValidation":
    case "build/addManualEvidence":
      return value === undefined ? undefined : ValidationRunSchemaV2.parse(value);
    case "build/getAcceptanceCriteriaState":
      return ValidationRunSchemaV2.shape.acceptanceCriteriaResults.parse(value);
    case "retry/plan":
    case "retry/selectAgent":
    case "retry/buildContext":
    case "retry/prepare":
    case "retry/manualRepair":
    case "retry/createRepairTask":
      return value === undefined ? undefined : RetryPlanSchema.parse(value);
    case "build/prepareRetry":
    case "build/updateRetryAgent":
    case "build/approveRetry":
      return value === undefined ? undefined : RetryPlanSchema.parse(value);
    case "retry/start":
      return TaskExecutionSessionSchema.parse(value);
    case "build/startRetry":
      return TaskExecutionSessionSchema.parse(value);
    case "completion/evaluate":
    case "build/getCompletionReadiness":
    case "build/requestCompletionReview":
      return CompletionDecisionSchema.parse(value);
    case "completion/completeTask":
    case "completion/acceptWithOverride":
      return value && typeof value === "object"
        ? {
            ...value,
            decision: CompletionDecisionSchema.parse((value as { decision?: unknown }).decision),
            ...(Array.isArray((value as { unlockedTaskIds?: unknown }).unlockedTaskIds)
              ? {
                  unlockedTaskIds: (value as { unlockedTaskIds: unknown[] }).unlockedTaskIds,
                }
              : { unlockedTaskIds: [] }),
            ...(typeof (value as { report?: unknown }).report === "object"
              ? {
                  report: WorkflowCompletionReportSchema.parse(
                    (value as { report: unknown }).report,
                  ),
                }
              : {}),
          }
        : value;
    case "completion/getWorkflowReport":
      return value === undefined ? undefined : WorkflowCompletionReportSchema.parse(value);
    case "review/getState":
      return WorkflowReviewStateSchema.parse(value);
    case "review/getSummary":
      return WorkflowReviewStateSchema.shape.summary.parse(value);
    case "review/getTraceability":
      return WorkflowReviewStateSchema.shape.traceability.parse(value);
    case "review/getChanges":
      return WorkflowReviewStateSchema.shape.changes.parse(value);
    case "review/getQa":
    case "review/getSecurity":
    case "review/getPerformance":
    case "review/getDocumentation":
      return WorkflowReviewStateSchema.shape.findings.parse(value);
    case "review/getDiff":
      return value;
    case "review/attributeChange":
      return TaskExecutionSessionSchema.parse(value);
    case "review/addNote":
    case "review/updateNote":
    case "review/resolveNote":
      return ReviewNoteSchema.parse(value);
    case "review/dispositionFinding":
      return FindingDispositionSchema.parse(value);
    case "review/requestChanges":
    case "review/returnToBuild":
    case "review/returnToDefine":
    case "review/approve":
    case "review/approveWithWarnings":
    case "review/reject":
      return ReviewDecisionSchema.parse(value);
    case "review/createFollowUpTask":
      return DevelopmentWorkflowSnapshotSchema.parse(value);
    case "review/generatePrDraft":
    case "review/getPrChecklist":
      return WorkflowReviewStateSchema.shape.checklist.parse(value);
    case "review/getReadiness":
      return value;
    case "complete/getState":
      return CompletionStateSchema.parse(value);
    case "complete/getOptions":
      return CompletionStateSchema.shape.options.parse(value);
    case "complete/getReport":
      return value === undefined ? undefined : WorkflowCompletionRecordSchema.parse(value);
    case "complete/completeLocally":
    case "complete/closePartial":
    case "complete/cancelWithChanges":
    case "complete/archive":
      return WorkflowCompletionRecordSchema.parse(value);
    case "taskHandoff/checkEligibility":
      return value;
    case "taskHandoff/createDraft":
    case "taskHandoff/updateDraft":
      return TaskHandoffSchema.parse(value);
    case "taskHandoff/runPrivacyScan":
    case "taskHandoff/markRedacted":
      return HandoffPrivacyReportSchema.parse(value);
    case "taskHandoff/export":
      return { pkg: TaskHandoffPackageSchema.parse((value as { pkg: unknown }).pkg), savedUri: String((value as { savedUri: unknown }).savedUri) };
    case "taskHandoff/listHistory":
      return TaskHandoffSchema.array().parse(value);
    case "taskHandoff/previewImport":
      return { pkg: TaskHandoffPackageSchema.parse((value as { pkg: unknown }).pkg), compatibility: HandoffCompatibilityReportSchema.parse((value as { compatibility: unknown }).compatibility), blocking: Boolean((value as { blocking: unknown }).blocking) };
    case "taskHandoff/acceptImport":
    case "taskHandoff/rejectImport":
      return TaskHandoffSchema.parse(value);
    case "pr-review/prepare":
    case "pr-review/getState":
      return value;
    case "pr-review/getFindings":
      return ReviewFindingSchema.array().parse(value);
    case "pr-review/updateFindingStatus":
      return ReviewFindingSchema.parse(value);
    case "pr-review/calculateReadiness":
    case "pr-review/approveReadiness":
      return ChangeReadinessDecisionSchema.parse(value);
    case "pr-review/generatePackage":
    case "pr-review/updatePackage":
      return PullRequestPackageSchema.parse(value);
    case "taskHandoff/checkEligibility":
      return z.object({ eligible: z.boolean(), reason: z.string().max(2000).optional() }).strict().parse(value);
    case "taskHandoff/createDraft":
    case "taskHandoff/updateDraft":
    case "taskHandoff/acceptImport":
    case "taskHandoff/rejectImport":
      return z.object({ id: z.string(), status: z.string().max(200) }).strict().parse(value);
    case "taskHandoff/runPrivacyScan":
    case "taskHandoff/markRedacted":
      return z.object({ findings: z.array(z.object({ id: z.string(), message: z.string().max(2000) })).max(200).default([]) }).strict().parse(value);
    case "taskHandoff/export":
      return z.object({ savedUri: z.string() }).strict().parse(value);
    case "taskHandoff/listHistory":
      return z.array(z.object({ id: z.string(), status: z.string().max(200), direction: z.string().max(200) })).max(1000).parse(value);
    case "taskHandoff/previewImport":
      return z.object({ blocking: z.boolean(), blockingWarnings: z.array(z.string().max(2000)).max(100).default([]) }).strict().parse(value);
    case "execution/route":
      return ExecutionRoutingDecisionSchema.parse(value);
    case "git/capabilities":
    case "git/refresh":
    case "git/status":
    case "git/repositoryState":
      return value;
    case "git/repositoryState":
    case "git/remotes":
    case "git/branches":
    case "git/diff":
    case "build/getDiff":
      return value;
    case "app/ping":
      return value;
    case "intelligence/scan/start":
      return value;
    case "settings/open":
    case "logs/show":
    case "intelligence/scan/cancel":
    case "intelligence/runtime/pause":
    case "intelligence/runtime/resume":
    case "intelligence/source/open":
    case "intelligence.canvas.openSource":
    case "intelligence.canvas.openEvidenceSource":
    case "intelligence/query/cancel":
    case "build/cancelValidation":
    case "delegation/openCopilot":
    case "delegation/copyPrompt":
    case "validation/cancel":
    case "request/cancel":
      return undefined;
    case "testIntelligence.load":
    case "testIntelligence.createGenerationRequest":
    case "testIntelligence.deriveScenarios":
    case "testIntelligence.updateScenario":
    case "testIntelligence.approveScenarios":
    case "testIntelligence.buildGenerationContext":
    case "testIntelligence.approveGenerationContext":
    case "testIntelligence.recordProposal":
    case "testIntelligence.validateProposalPolicy":
    case "testIntelligence.applyProposal":
    case "testIntelligence.revertApplied":
    case "testIntelligence.createFailureAnalysis":
    case "testIntelligence.acceptFailureClassification":
    case "testIntelligence.requestRepeatedRuns":
    case "testIntelligence.loadFlakyHistory":
    case "testIntelligence.createRemediationProposal":
    case "testIntelligence.validateRemediationPolicy":
    case "testIntelligence.applyRemediation":
    case "testIntelligence.runValidationSequence":
    case "testIntelligence.loadValidationState":
    case "testIntelligence.refreshQaDecision":
      return QaTestIntelligenceAggregateSchema.parse(value);
  }
  throw new Error(`No Webview response validator is registered for ${type}.`);
}

function createPreviewApi(): VsCodeApi {
  let state: PersistedFoundationState = {
    schemaVersion: SCHEMA_VERSION,
    revision: 0,
    activeSection: "home",
    activeRoute: "/",
    workflowCount: 0,
    activityRecords: [],
    approvalRecords: [],
    blockerRecords: [],
    freshnessRecords: [],
    updatedAt: new Date().toISOString(),
  };
  let overview: IntelligenceOverview = emptyIntelligenceOverview("not-indexed");
  let previewWorkflow: ReturnType<typeof DevelopmentWorkflowSnapshotSchema.parse> | undefined;
  let panelState = KeystonePanelStateSchema.parse({
    schemaVersion: 1,
    wasOpen: true,
    visible: true,
    ready: true,
    column: 1,
    lastRoute: "/",
    navigationSequence: 0,
    updatedAt: new Date().toISOString(),
  });
  const dispatch = (message: HostMessage): void => {
    window.dispatchEvent(new MessageEvent("message", { data: message }));
  };
  return {
    getState: () => state,
    setState: (next) => {
      if (next && typeof next === "object") state = next as PersistedFoundationState;
    },
    postMessage: (message) => {
      const request = message as WebviewRequest;
      window.setTimeout(() => {
        let data: unknown;
        if (request.type === "keystone/webviewReady") {
          data = KeystoneInitializationSchema.parse({
            schemaVersion: 1,
            extensionVersion: "0.1.0-dev",
            workspace: {
              available: true,
              name: "Local UI preview",
              trusted: true,
            },
            repository: {
              id: "repository:preview",
              name: "Local UI preview",
              branch: "preview",
              intelligenceStatus: overview.status,
            },
            capabilities: { copilotAvailable: false, toolsAvailable: false },
            restoredRoute: panelState.lastRoute,
            restoredContext: {},
            initializedAt: new Date().toISOString(),
          });
        } else if (
          request.type === "keystone/initializationAcknowledged" ||
          request.type === "keystone/navigationAcknowledged"
        ) {
          data = panelState;
        } else if (request.type === "keystone/webviewStateChanged") {
          panelState = KeystonePanelStateSchema.parse({
            ...panelState,
            lastRoute: request.payload.route,
            updatedAt: new Date().toISOString(),
          });
          data = panelState;
        } else if (request.type === "app/bootstrap") {
          const snapshot: BootstrapSnapshot = {
            extensionVersion: "0.1.0-dev",
            workspace: {
              name: "Local UI preview",
              rootCount: 1,
              trust: "trusted",
              indexStatus: overview.status,
            },
            state,
            activity: {
              operation: "Intelligence preview",
              detail: "Local visual test mode.",
              status: "completed",
              progress: 100,
              cancellable: false,
              updatedAt: new Date().toISOString(),
            },
            implementation: {
              phase: 15,
              phaseName: "Product integration and end-to-end hardening",
              completedTasks: [
                "Canonical repository Intelligence",
                "Controlled development workflows",
                "Safe validation and delivery",
                "Restricted Mode mutation boundary",
              ],
              nextTask: "Resolve the remaining integration release gates",
            },
          };
          dispatch(hostMessage("bootstrap/ready", snapshot));
          data = snapshot;
        } else if (request.type === "navigation/set") {
          const route =
            "route" in request.payload
              ? request.payload.route
              : sectionForRoute(request.payload.section);
          state = {
            ...state,
            activeRoute: route,
            activeSection: sectionForRoute(route),
            revision: state.revision + 1,
            updatedAt: new Date().toISOString(),
          };
          dispatch(hostMessage("state/updated", state));
          data = state;
        } else if (request.type === "intelligence/overview") {
          dispatch(hostMessage("intelligence/updated", overview));
          data = overview;
        } else if (request.type === "intelligence/scan/start") {
          overview = { ...emptyIntelligenceOverview("scanning", true) };
          dispatch(hostMessage("intelligence/updated", overview));
          data = { scanRevision: 1 };
        } else if (
          request.type === "workflow/list" ||
          request.type === "workbench/listWorkflows" ||
          request.type === "orchestration/list"
        ) {
          data = [];
        } else if (request.type === "copilot/capabilities") {
          data = CopilotCapabilitiesSchema.parse({
            schemaVersion: 1,
            detectedAt: new Date().toISOString(),
            extensionDetected: false,
            extensionVersions: {},
            chatAvailable: false,
            agentModeAvailable: false,
            agentDiscoveryAvailable: false,
            directInvocationAvailable: false,
            promptInsertionAvailable: false,
            completionEventsAvailable: false,
            resultCaptureAvailable: false,
            supportedInvocationMethods: [],
            diagnostics: [
              {
                code: "preview-only",
                severity: "info",
                message: "Copilot is not invoked in local visual preview mode.",
              },
            ],
            fingerprint: "preview-unavailable",
            discoveryDurationMs: 0,
          });
        } else if (
          request.type === "copilot/getIntegrationStatus" ||
          request.type === "copilot/getCapabilities"
        ) {
          data = CopilotIntegrationCapabilitiesSchema.parse({
            schemaVersion: 1,
            detectedAt: new Date().toISOString(),
            chatAvailable: false,
            customizationDiscoveryAvailable: true,
            customAgentDefinitionsDiscoverable: true,
            promptFilesDiscoverable: true,
            instructionFilesDiscoverable: true,
            skillsDiscoverable: true,
            languageModelToolsAvailable: false,
            chatParticipantAvailable: false,
            directAgentInvocationAvailable: false,
            assistedInvocationAvailable: false,
            clipboardFallbackAvailable: true,
            limitations: [
              "Local visual preview uses clipboard fallback and does not invoke Copilot.",
            ],
            fingerprint: "preview-integration-unavailable",
          });
        } else if (request.type === "copilot/listKeystoneTools") {
          data = [];
        } else if (request.type === "workbench/getCreateContext") {
          data = WorkbenchCreateContextSchema.parse({
            schemaVersion: 1,
            repository: {
              available: true,
              trusted: true,
              id: "repository:preview",
              name: "Local UI preview",
              branch: "preview",
              head: "preview-head",
            },
            intelligence: {
              status: "ready",
              generation: 1,
              message: "Preview repository evidence is available for interaction testing.",
            },
            copilot: {
              available: false,
              directInvocation: false,
              summary: "Preview mode does not invoke Copilot.",
            },
            workflowDefinitions: [
              {
                workType: "feature",
                definitionId: "feature-development",
                label: "Feature",
                description: "Add user-visible behavior with specification, tests, and review.",
              },
              {
                workType: "bug",
                definitionId: "bug-fix",
                label: "Bug fix",
                description: "Repair incorrect behavior with regression evidence.",
              },
              {
                workType: "refactor",
                definitionId: "refactoring",
                label: "Refactoring",
                description: "Improve internal structure without changing approved behavior.",
              },
              {
                workType: "test",
                definitionId: "test-work",
                label: "Test work",
                description: "Add or improve deterministic verification.",
              },
              {
                workType: "modernization",
                definitionId: "modernization",
                label: "Modernization",
                description: "Move toward an approved target while preserving compatibility.",
              },
              {
                workType: "investigation",
                definitionId: "investigation",
                label: "Investigation",
                description: "Produce bounded evidence before implementation.",
              },
            ],
          });
        } else if (request.type === "workbench/createWorkflow") {
          const now = new Date().toISOString();
          const workflowId = crypto.randomUUID();
          previewWorkflow = DevelopmentWorkflowSnapshotSchema.parse({
            schemaVersion: 1,
            id: workflowId,
            revision: 0,
            repositoryId: request.payload.expectedRepositoryId,
            branch: "preview",
            headCommit: "preview-head",
            intelligenceGeneration: request.payload.expectedIntelligenceGeneration,
            intent: {
              id: crypto.randomUUID(),
              workflowId,
              revision: 1,
              originalText: request.payload.intent,
              normalizedObjective: request.payload.intent,
              mode: "guided",
              category: request.payload.workType,
              workType: request.payload.workType,
              repositoryScope: request.payload.repositoryScope,
              expectedOutcome: request.payload.intent,
              risk: "low",
              constraints: request.payload.constraints.map((item) => ({
                description: `${item.kind}: ${item.value}`,
                provenance: "user" as const,
              })),
              ambiguities: [],
              requiredDecisions: [],
              affectedEntities: [],
              intelligenceGeneration: request.payload.expectedIntelligenceGeneration,
              branch: "preview",
              createdAt: now,
              updatedAt: now,
            },
            intentHistory: [],
            clarifications: [],
            decisions: [],
            specificationHistory: [],
            taskGraphHistory: [],
            tasks: [],
            status: "capturing",
            createdAt: now,
            updatedAt: now,
          });
          data = previewWorkflow;
        } else if (
          request.type === "workbench/getWorkflow" &&
          previewWorkflow?.id === request.payload.workflowId
        ) {
          data = createPreviewWorkflowState(previewWorkflow);
        } else if (
          request.type === "workbench/getDefineState" &&
          previewWorkflow?.id === request.payload.workflowId
        ) {
          const projected = createPreviewWorkflowState(previewWorkflow);
          data = WorkbenchDefineStateSchema.parse({
            schemaVersion: 1,
            workflow: previewWorkflow,
            repository: {
              generation: 1,
              freshness: "current",
              modules: [],
              entities: [],
              tests: [],
              apisAndData: [],
              patterns: [],
              limitations: ["Local visual preview contains no repository source evidence."],
            },
            clarifications: [],
            diagnostics: [],
            staleness: [],
            stageStates: projected.stageStates,
            summary: projected.summary,
          });
        } else if (request.type === "app/ping") data = { serverTime: new Date().toISOString() };
        dispatch(
          hostMessage("response/success", {
            requestId: request.requestId,
            ...(data === undefined ? {} : { data }),
          }),
        );
      }, 0);
    },
  };
}

function createPreviewWorkflowState(
  workflow: ReturnType<typeof DevelopmentWorkflowSnapshotSchema.parse>,
) {
  const stageStates: Array<Record<string, unknown>> = [];
  const summary = WorkbenchSummarySchema.parse({
    workflowId: workflow.id,
    currentStage: "define",
    specificationStatus: "not generated",
    taskPlanStatus: "not generated",
    taskCounts: {},
    pendingApprovals: 0,
    blockingDiagnostics: 0,
    repositoryFreshness: "current",
    intelligenceFreshness: "current",
  });
  return WorkbenchWorkflowStateSchema.parse({
    schemaVersion: 1,
    workflow,
    repositoryName: "Local UI preview",
    staleness: [],
    stageStates,
    summary,
  });
}
