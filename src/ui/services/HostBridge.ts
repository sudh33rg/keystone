import { z } from "zod";
import {
  BootstrapSnapshotSchema,
  PersistedFoundationStateSchema,
  SCHEMA_VERSION,
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
  CommitPlanSchema,
  DeliveryChangeSetSchema,
  DeliveryReadinessSchema,
  GitActionResultSchema,
  GitMutationApprovalSchema,
  GitCapabilitiesSchema,
  GitRepositoryStateSchema,
  PullRequestCreationResultSchema,
  PullRequestDraftSchema,
  PullRequestProviderCapabilitySchema,
} from "../../shared/contracts/delivery";
import {
  HandoffAcceptanceSchema,
  HandoffPackageSchema,
  HandoffReconciliationSchema,
  HandoffValidationResultSchema,
  TaskAssignmentSchema,
  TeamAuditEntrySchema,
  TeamParticipantSchema,
  TeamProgressSnapshotSchema,
} from "../../shared/contracts/team";
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
import { compatibilityRoute, sectionForRoute } from "../../shared/navigation";
import {
  WorkbenchCreateContextSchema,
  WorkbenchDefineStateSchema,
  WorkbenchPlanStateSchema,
  WorkbenchStageStateSchema,
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
      const timer = window.setTimeout(() => {
        this.settle(requestId);
        reject(new Error(`Keystone host request timed out: ${type}`));
        this.postCancellation(requestId);
      }, 15_000);
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
    case "intelligence/exported-symbols":
    case "intelligence/wildcard-search":
    case "intelligence/module-mapping":
    case "intelligence/circular-dependencies":
    case "intelligence/node-metrics":
    case "intelligence/dead-code":
    case "intelligence/filtered-subgraph":
    case "intelligence/cyclomatic-complexity":
      return z.any().parse(value);
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
      return WorkbenchStageStateSchema.array().length(6).parse(value);
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
    case "review/updatePrDraft":
    case "complete/preparePr":
      return PullRequestDraftSchema.parse(value);
    case "review/getPrDraft":
      return value === undefined ? undefined : PullRequestDraftSchema.parse(value);
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
    case "complete/getChangeSet":
      return value === undefined ? undefined : DeliveryChangeSetSchema.parse(value);
    case "complete/updateChangeSet":
      return DeliveryChangeSetSchema.parse(value);
    case "complete/generateCommitPlan":
    case "complete/updateCommitPlan":
      return CommitPlanSchema.parse(value);
    case "complete/getPushReadiness":
      return DeliveryReadinessSchema.parse(value);
    case "complete/getPrCapabilities":
      return PullRequestProviderCapabilitySchema.parse(value);
    case "complete/approveStaging":
    case "complete/approveCommit":
    case "complete/approvePush":
    case "complete/approvePrCreation":
    case "complete/approvePatchExport":
      return GitMutationApprovalSchema.parse(value);
    case "complete/stageChanges":
    case "complete/createCommit":
    case "complete/push":
      return GitActionResultSchema.parse(value);
    case "complete/createPr":
    case "complete/confirmAssistedPr":
      return PullRequestCreationResultSchema.parse(value);
    case "complete/prepareHandoff":
      return HandoffPackageSchema.parse(value);
    case "complete/preparePatch":
    case "complete/exportPatch":
    case "complete/exportHandoff":
      return value;
    case "team/participants":
      return TeamParticipantSchema.array().max(500).parse(value);
    case "team/addParticipant":
    case "team/updateParticipant":
      return TeamParticipantSchema.parse(value);
    case "assignment/create":
    case "assignment/update":
    case "assignment/accept":
    case "assignment/reject":
    case "assignment/requestClarification":
    case "assignment/reassign":
    case "assignment/cancel":
      return TaskAssignmentSchema.parse(value);
    case "assignment/get":
      return value === undefined ? undefined : TaskAssignmentSchema.parse(value);
    case "assignment/list":
    case "progress/assignments":
      return TaskAssignmentSchema.array().max(2000).parse(value);
    case "handoff/prepare":
    case "build/prepareHandoff":
      return HandoffPackageSchema.parse(value);
    case "handoff/get":
      return value === undefined ? undefined : HandoffPackageSchema.parse(value);
    case "handoff/validate":
    case "build/validateHandoff":
      return HandoffValidationResultSchema.parse(value);
    case "handoff/import":
      return value === undefined
        ? undefined
        : {
            package: HandoffPackageSchema.parse((value as { package: unknown }).package),
            validation: HandoffValidationResultSchema.parse(
              (value as { validation: unknown }).validation,
            ),
            importId: String((value as { importId: unknown }).importId),
          };
    case "handoff/reconcile":
      return HandoffReconciliationSchema.parse(value);
    case "handoff/export":
    case "build/exportHandoff": {
      if (!value || typeof value !== "object") return {};
      const destination = (value as { destination?: unknown }).destination;
      return typeof destination === "string" ? { destination } : {};
    }
    case "handoff/accept":
    case "handoff/reject":
    case "handoff/importReadOnly":
      return HandoffAcceptanceSchema.parse(value);
    case "progress/tasks":
    case "progress/refresh":
      return TeamProgressSnapshotSchema.parse(value);
    case "progress/workflows":
      return TeamProgressSnapshotSchema.array().max(500).parse(value);
    case "progress/audit":
      return TeamAuditEntrySchema.array().max(500).parse(value);
    case "execution/route":
      return ExecutionRoutingDecisionSchema.parse(value);
    case "git/capabilities":
    case "git/refresh":
      return GitCapabilitiesSchema.parse(value);
    case "git/repositoryState":
      return GitRepositoryStateSchema.parse(value);
    case "git/readiness":
      return DeliveryReadinessSchema.parse(value);
    case "delivery/createChangeSet":
    case "delivery/rebuildChangeSet":
    case "delivery/includeFile":
    case "delivery/excludeFile":
    case "delivery/attributeFile":
      return DeliveryChangeSetSchema.parse(value);
    case "delivery/getChangeSet":
      return value === undefined ? undefined : DeliveryChangeSetSchema.parse(value);
    case "commitPlan/create":
    case "commitPlan/update":
    case "commitPlan/merge":
    case "commitPlan/split":
    case "commitPlan/reorder":
    case "commitPlan/moveFile":
    case "commitPlan/approve":
      return CommitPlanSchema.parse(value);
    case "commitPlan/get":
      return value === undefined ? undefined : CommitPlanSchema.parse(value);
    case "git/stage":
    case "git/unstage":
    case "git/createBranch":
    case "git/commit":
    case "git/push":
      return GitActionResultSchema.parse(value);
    case "pullRequest/capabilities":
      return PullRequestProviderCapabilitySchema.parse(value);
    case "pullRequest/createDraft":
    case "pullRequest/updateDraft":
    case "pullRequest/approve":
      return PullRequestDraftSchema.parse(value);
    case "pullRequest/create":
    case "pullRequest/confirmExternalCreation":
    case "pullRequest/status":
    case "pullRequest/refresh":
      return value === undefined ? undefined : PullRequestCreationResultSchema.parse(value);
    case "git/remotes":
    case "git/branches":
    case "git/diff":
    case "build/getDiff":
    case "pullRequest/templates":
    case "pullRequest/validate":
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
    case "intelligence/query/cancel":
    case "build/cancelValidation":
    case "build/cancelHandoff":
    case "handoff/cancel":
    case "delegation/openCopilot":
    case "delegation/copyPrompt":
    case "validation/cancel":
    case "request/cancel":
      return undefined;
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
              : compatibilityRoute(request.payload.section);
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
  const stageStates = WorkbenchStageStateSchema.array()
    .length(6)
    .parse([
      {
        stage: "define",
        status: "current",
        blockers: [],
        warnings: [],
        primaryAction: {
          id: "generate-specification",
          label: "Generate specification",
          enabled: true,
        },
      },
      ...(["plan", "build", "validate", "review", "complete"] as const).map((stage) => ({
        stage,
        status: "blocked" as const,
        blockers: [
          {
            code: "preview-prerequisite",
            message: "Complete Define first.",
            recoveryAction: "Return to Define.",
          },
        ],
        warnings: [],
      })),
    ]);
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
