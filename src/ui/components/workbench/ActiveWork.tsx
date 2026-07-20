import { useCallback, useEffect, useRef, useState } from "react";
import type {
  Workflow,
  WorkflowStageType,
  WorkflowStatus,
  WorkflowWorkType,
} from "../../../shared/contracts/workflow";
import type { DevelopmentWorkflowSnapshot } from "../../../shared/contracts/delegation";
import type { HostBridge } from "../../services/HostBridge";
import { Icon } from "../Icon";
import { toUiError, UiErrorState, type KeystoneUiError } from "../UiState";

function snapshotToWorkflow(snapshot: DevelopmentWorkflowSnapshot, workType: WorkflowWorkType): Workflow {
  // Minimal inline migration: map snapshot fields to the new Workflow shape
  return {
    id: snapshot.id,
    repositoryId: snapshot.repositoryId,
    branch: snapshot.branch,
    baseCommit: snapshot.headCommit,
    intelligenceGeneration: snapshot.intelligenceGeneration,
    intentId: snapshot.intent.id,
    intentRevision: snapshot.intent.revision,
    specificationId: snapshot.specification?.id ?? "",
    specificationRevision: snapshot.specification?.revision ?? 1,
    workType,
    sdlcFlowConfigId: snapshot.id,
    stages: [],
    workItems: snapshot.tasks.map((task) => ({
      id: task.id,
      stageId: "u1",
      title: task.title,
      description: task.description,
      objective: task.objective,
      category: task.category,
      dependencies: task.dependencies,
      requiredCapabilities: task.requiredCapabilities.map((c) => c),
      executionRoute: task.executionRoute,
      risk: task.risk,
      optional: task.optional,
      staleReasons: task.staleReasons,
      baseEntityFingerprints: task.baseEntityFingerprints,
      originalTaskId: task.id,
      createdAt: task.createdAt,
      updatedAt: task.updatedAt,
    })),
    contextPackages: [],
    delegationRuns: [],
    validationRuns: [],
    reviewFindingIds: [],
    completionRecordId: undefined,
    status: "not-ready",
    currentStageId: undefined,
    blockingStageIds: [],
    createdAt: snapshot.createdAt,
    updatedAt: snapshot.updatedAt,
    startedAt: undefined,
    completedAt: undefined,
  };
}

export function ActiveWork({ bridge, workflowId, navigate }: { bridge: HostBridge; workflowId?: string; navigate: (route: string) => void }): React.JSX.Element {
  const [workflow, setWorkflow] = useState<Workflow | undefined>();
  const [error, setError] = useState<KeystoneUiError>();

  const loadRef = useRef<() => void>(() => undefined);
  const load = useCallback(async (): Promise<void> => {
    if (!workflowId) return;
    try {
      const result = await bridge.request("workflow/get", { workflowId });
      if (result) {
        setWorkflow(snapshotToWorkflow(result, "feature"));
      }
      setError(undefined);
    } catch (cause) {
      setError(toUiError(cause, {
        category: "active-work-load",
        title: "Active Work is temporarily unavailable",
        fallbackMessage: "Keystone could not load the current workflow.",
        retry: () => loadRef.current(),
        dismiss: () => setError(undefined),
      }));
    }
  }, [bridge, workflowId]);

  useEffect(() => {
    loadRef.current = load;
    queueMicrotask(() => void load());
  }, [load]);
  if (!workflow) return <section className="page active-work-page"><div className="loading-view"><div className="loader" /></div></section>;

  const stages = workflow.stages;
  const currentStage = stages.find((s) => s.id === workflow.currentStageId) ?? stages[0];
  const nextStage = currentStage ? stages.find((s) => s.order === currentStage.order + 1) : undefined;
  const blockedStages = stages.filter((s) => s.state === "blocked");
  const blockingStage = blockedStages.find((s) => s.required === "optional");

  const workflowTypeLabel: Record<WorkflowWorkType, string> = {
    feature: "Feature",
    "bug-fix": "Bug Fix",
    refactoring: "Refactoring",
    test: "Test",
    investigation: "Investigation",
  };

  const stageStatusColor: Record<WorkflowStatus, string> = {
    "not-ready": "#e0e0e0",
    ready: "#4caf50",
    "preparing-context": "#2196f3",
    "awaiting-approval": "#ff9800",
    delegating: "#2196f3",
    running: "#f44336",
    "awaiting-result-review": "#9c27b0",
    validating: "#ff9800",
    passed: "#4caf50",
    failed: "#f44336",
    blocked: "#f44336",
    skipped: "#757575",
    cancelled: "#757575",
  };

  return (
    <section className="page active-work-page">
      <div className="page-header">
        <div className="header-row">
          <div className="header-left">
            <span className="eyebrow">Active Work</span>
            <h1>
              {workflowTypeLabel[workflow.workType]} · Specification {workflow.specificationId}
            </h1>
            <p>Intent {workflow.intentId}</p>
          </div>
          <div className="header-actions">
            <button
              className="ghost-button"
              onClick={() => navigate("/intelligence")}
            >
              <Icon name="intelligence" size={15} />
              Ask repository
            </button>
            <button
              className="ghost-button"
              onClick={() => navigate("/support/diagnostics")}
            >
              <Icon name="pulse" size={15} />
              Diagnostics
            </button>
          </div>
        </div>
        <div className="workflow-meta">
          <span className="meta-item">{workflow.repositoryId}</span>
          <span className="meta-divider">·</span>
          <span className="meta-item">Branch {workflow.branch ?? "unspecified"}</span>
          <span className="meta-divider">·</span>
          <span className="meta-item">Intelligence gen {workflow.intelligenceGeneration}</span>
          <span className="meta-divider">·</span>
          <span className="meta-item status-badge">{workflow.status.replace("-", " ")}</span>
        </div>
      </div>

      {error && <UiErrorState error={error} />}

      <div className="sdlc-flow-container">
        <h2>SDLC Flow</h2>
        <div className="flow-stages">
          {stages.map((stage, index) => {
            const stageWorkItems = workflow.workItems.filter((wi) => wi.stageId === stage.id);
            const isCurrent = stage.id === workflow.currentStageId;
            const isNext = stage.id === nextStage?.id;
            const isBlocked = stage.state === "blocked";
            const isSkipped = stage.state === "skipped";
            const isCancelled = stage.state === "cancelled";
            const isPassed = stage.state === "passed";

            const stageTypeLabel: Record<WorkflowStageType, string> = {
              understand: "Understand",
              plan: "Plan",
              development: "Development",
              "impact-analysis": "Impact Analysis",
              "test-generation": "Test Generation",
              "test-execution": "Test Execution",
              "failure-analysis": "Failure Analysis",
              "test-healing": "Test Healing",
              "security-analysis": "Security Analysis",
              "performance-analysis": "Performance Analysis",
              "pr-review": "PR Review",
              complete: "Complete",
            };

            const canAdvance = isPassed || isSkipped || isCancelled;

            return (
              <div
                key={stage.id}
                className={`flow-stage ${isCurrent ? "flow-stage-current" : ""} ${isNext && canAdvance ? "flow-stage-next" : ""} ${isBlocked ? "flow-stage-blocked" : ""} ${isSkipped ? "flow-stage-skipped" : ""} ${isCancelled ? "flow-stage-cancelled" : ""}`}
                aria-current={isCurrent ? "step" : undefined}
              >
                <div className="stage-indicator">
                  <Icon name={isCurrent ? "pulse" : isSkipped ? "check" : isCancelled ? "arrow" : "repo"} size={16} />
                  <span>{index + 1}</span>
                </div>
                <div className="stage-info">
                  <span className="stage-label">{stageTypeLabel[stage.type]}</span>
                  {!canAdvance && (
                    <span className="stage-status" style={{ backgroundColor: stageStatusColor[stage.state] }}>
                      {stage.state.replace("-", " ")}
                    </span>
                  )}
                </div>
                <div className="stage-details">
                  {!canAdvance && (
                    <span className="details-item">{stage.displayName}</span>
                  )}
                  {stage.required === "required" && (
                    <span className="details-item badge">Required</span>
                  )}
                  {stage.required === "optional" && stage.enabled && (
                    <span className="details-item badge">Optional</span>
                  )}
                  <span className="details-item">{stage.executionMode === "approval-required" ? "Approval required" : "Auto"}</span>
                  {stage.retryLimit > 0 && (
                    <span className="details-item">Retry: {stage.retryLimit}</span>
                  )}
                  {stage.tokenBudget > 0 && (
                    <span className="details-item">Tokens: {stage.tokenBudget.toLocaleString()}</span>
                  )}
                </div>
                <div className="stage-metrics">
                  {stageWorkItems.length > 0 && (
                    <span className="metric-item">
                      <Icon name="tasks" size={13} />
                      {stageWorkItems.length} {stageWorkItems.length === 1 ? "task" : "tasks"}
                    </span>
                  )}
                  {(stage.validationRunIds.length + stage.reviewFindingIds.length) > 0 && (
                    <span className="metric-item">
                      <Icon name="context" size={13} />
                      {stage.validationRunIds.length + stage.reviewFindingIds.length} {stage.validationRunIds.length + stage.reviewFindingIds.length === 1 ? "piece" : "pieces"} of evidence
                    </span>
                  )}
                </div>
                {!canAdvance && (
                  <button
                    className="stage-action"
                    onClick={() => navigate(`/workbench/${workflow.id}/understand`)}
                  >
                    Open
                  </button>
                )}
              </div>
            );
          })}
        </div>
      </div>

      {currentStage && (
        <>
          <div className="current-stage-section">
            <h2>Current Stage</h2>
            <div className="stage-detail-card">
              <div className="card-header">
                <h3>{currentStage.displayName}</h3>
                <span className="stage-badge" style={{ backgroundColor: stageStatusColor[currentStage.state] }}>
                  {currentStage.state.replace("-", " ")}
                </span>
              </div>
              <div className="card-row">
                <span className="label">Status</span>
                <span className="value">{currentStage.state.replace("-", " ")}</span>
              </div>
              <div className="card-row">
                <span className="label">Type</span>
                <span className="value">{currentStage.type}</span>
              </div>
              <div className="card-row">
                <span className="label">Order</span>
                <span className="value">{currentStage.order}</span>
              </div>
              <div className="card-row">
                <span className="label">Required</span>
                <span className="value">{currentStage.required === "required" ? "Yes" : "No"}</span>
              </div>
              <div className="card-row">
                <span className="label">Execution mode</span>
                <span className="value">{currentStage.executionMode === "approval-required" ? "Approval required" : "Automatic"}</span>
              </div>
              <div className="card-row">
                <span className="label">Retry limit</span>
                <span className="value">{currentStage.retryLimit}</span>
              </div>
              <div className="card-row">
                <span className="label">Token budget</span>
                <span className="value">{currentStage.tokenBudget.toLocaleString()}</span>
              </div>
              {currentStage.workItemIds.length > 0 && (
                <div className="card-row">
                  <span className="label">Work items</span>
                  <span className="value">{currentStage.workItemIds.length} items</span>
                </div>
              )}
              {currentStage.validationRunIds.length > 0 && (
                <div className="card-row">
                  <span className="label">Validation runs</span>
                  <span className="value">{currentStage.validationRunIds.length} runs</span>
                </div>
              )}
              {currentStage.reviewFindingIds.length > 0 && (
                <div className="card-row">
                  <span className="label">Review findings</span>
                  <span className="value">{currentStage.reviewFindingIds.length} findings</span>
                </div>
              )}
            </div>
          </div>

          <div className="next-stage-section">
            <h2>Next Stage</h2>
            {nextStage ? (
              <div className="stage-preview-card">
                <div className="card-header">
                  <h3>{nextStage.displayName}</h3>
                  <span className="stage-badge" style={{ backgroundColor: stageStatusColor[nextStage.state] }}>
                    {nextStage.state.replace("-", " ")}
                  </span>
                </div>
                <div className="card-row">
                  <span className="label">Type</span>
                  <span className="value">{nextStage.type}</span>
                </div>
                <div className="card-row">
                  <span className="label">Order</span>
                  <span className="value">{nextStage.order}</span>
                </div>
                <div className="card-row">
                  <span className="label">Required</span>
                  <span className="value">{nextStage.required === "required" ? "Yes" : "No"}</span>
                </div>
                <div className="card-row">
                  <span className="label">Execution mode</span>
                  <span className="value">{nextStage.executionMode === "approval-required" ? "Approval required" : "Automatic"}</span>
                </div>
                <div className="card-row">
                  <span className="label">Retry limit</span>
                  <span className="value">{nextStage.retryLimit}</span>
                </div>
                <div className="card-row">
                  <span className="label">Token budget</span>
                  <span className="value">{nextStage.tokenBudget.toLocaleString()}</span>
                </div>
                <button
                  className="primary-button"
                  onClick={() => navigate(`/workbench/${workflow.id}/understand`)}
                >
                  Open {nextStage.displayName}
                </button>
              </div>
            ) : (
              <div className="no-next-stage">
                <Icon name="check" size={24} />
                <p>All stages completed</p>
              </div>
            )}
          </div>
        </>
      )}

      <div className="blockers-section">
        <h2>Blockers</h2>
        {blockingStage ? (
          <div className="blocker-card">
            <div className="blocker-header">
              <Icon name="lock" size={18} />
              <span>Stage not ready</span>
            </div>
            <p>{blockingStage.displayName} cannot proceed.</p>
            <p>
              <small>This stage is blocked because required predecessor stages have not been completed.</small>
            </p>
          </div>
        ) : blockedStages.length > 0 ? (
          <div className="blockers-list">
            {blockedStages.map((stage) => (
              <div key={stage.id} className="blocker-item">
                <Icon name="lock" size={14} />
                <span>{stage.displayName}</span>
              </div>
            ))}
          </div>
        ) : (
          <div className="no-blockers">
            <Icon name="check" size={20} />
            <p>No blockers</p>
          </div>
        )}
      </div>
    </section>
  );
}
