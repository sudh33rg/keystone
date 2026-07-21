import { useCallback, useEffect, useRef, useState } from "react";
import type {
  Workflow,
  WorkflowStageType,
  WorkflowStatus,
  WorkflowWorkType,
} from "../../../shared/contracts/workflow";
import type { DevelopmentWorkflowSnapshot } from "../../../shared/contracts/delegation";
import type { HostBridge } from "../../../services/HostBridge";
import { Icon } from "../Icon";
import { toUiError, UiErrorState, type KeystoneUiError } from "../UiState";
import type { AppRoute } from "../../../shared/contracts/domain";
import { workbenchRoute } from "../../../shared/navigation";

// Define the standard SDLC stages as per the corrective phase
const SDLC_STAGES: Array<{
  id: string;
  displayName: string;
  type: WorkflowStageType;
  required: "required" | "optional";
}> = [
  { id: "understand", displayName: "Understand", type: "understand", required: "required" },
  { id: "plan", displayName: "Plan", type: "plan", required: "required" },
  { id: "development", displayName: "Development", type: "development", required: "required" },
  { id: "impact-analysis", displayName: "Impact Analysis", type: "impact-analysis", required: "required" },
  { id: "test-generation", displayName: "Test Generation", type: "test-generation", required: "required" },
  { id: "test-execution", displayName: "Test Execution", type: "test-execution", required: "required" },
  { id: "failure-analysis", displayName: "Failure Analysis", type: "failure-analysis", required: "required" },
  { id: "test-healing", displayName: "Test Healing", type: "test-healing", required: "required" },
  { id: "security-analysis", displayName: "Security Analysis", type: "security-analysis", required: "required" },
  { id: "performance-analysis", displayName: "Performance Analysis", type: "performance-analysis", required: "required" },
  { id: "pr-review", displayName: "PR Review", type: "pr-review", required: "required" },
  { id: "complete", displayName: "Complete", type: "complete", required: "required" },
];

// Helper to find stage by id
function findStageById(id: string) {
  return SDLC_STAGES.find((stage) => stage.id === id);
}

// Helper to get stage status based on workflow's current stage
function getStageStatus(
  stageId: string,
  currentStageId: string | undefined,
  completedStageIds: string[]
): WorkflowStatus {
  if (stageId === currentStageId) return "current";
  if (completedStageIds.includes(stageId)) return "completed";
  return "pending";
}

// Helper to get blocked stages (simplified)
function getBlockedStages(
  stageId: string,
  currentStageId: string | undefined,
  completedStageIds: string[]
): string[] {
  if (!currentStageId) return [];
  const currentIndex = SDLC_STAGES.findIndex((s) => s.id === currentStageId);
  const stageIndex = SDLC_STAGES.findIndex((s) => s.id === stageId);
  // Block stages that are not yet reachable (i.e., previous stages not completed)
  if (stageIndex > currentIndex + 1) {
    return ["Prerequisite stages not completed"];
  }
  // Block if previous stage is not completed (for sequential flow)
  if (stageIndex > 0 && !completedStageIds.includes(SDLC_STAGES[stageIndex - 1].id)) {
    return ["Previous stage not completed"];
  }
  return [];
}

function snapshotToWorkflow(
  snapshot: DevelopmentWorkflowSnapshot,
  workType: WorkflowWorkType
): Workflow {
  // Map tasks to their stages (assuming task has stageId; fallback to first stage)
  const tasksByStage: Record<string, Array<any>> = {};
  SDLC_STAGES.forEach((stage) => {
    tasksByStage[stage.id] = [];
  });

  snapshot.tasks.forEach((task) => {
    const stageId = task.stageId ?? SDLC_STAGES[0].id; // fallback to first stage
    if (tasksByStage[stageId]) {
      tasksByStage[stageId].push({
        id: task.id,
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
      });
    }
  });

  // Determine completed stages (simplified: stages before current stage are considered complete)
  const completedStageIds: string[] = [];
  if (snapshot.currentStageId) {
    const currentIndex = SDLC_STAGES.findIndex((s) => s.id === snapshot.currentStageId);
    for (let i = 0; i < currentIndex; i++) {
      completedStageIds.push(SDLC_STAGES[i].id);
    }
  }

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
    stages: SDLC_STAGES.map((stage) => ({
      ...stage,
      status: getStageStatus(stage.id, snapshot.currentStageId, completedStageIds),
      blockedReasons: getBlockedStages(stage.id, snapshot.currentStageId, completedStageIds),
      executionMode: "approval-required", // placeholder
      evidenceCount: 0, // placeholder
      warningCount: 0, // placeholder
      blockerCount: getBlockedStages(stage.id, snapshot.currentStageId, completedStageIds).length,
      latestExecutionState: "pending", // placeholder
    })),
    workItems: snapshot.tasks.flatMap((task) => {
      const stageId = task.stageId ?? SDLC_STAGES[0].id;
      return tasksByStage[stageId] || [];
    }),
    contextPackages: [], // placeholder
    delegationRuns: [], // placeholder
    validationRuns: [], // placeholder
    reviewFindingIds: [], // placeholder
    completionRecordId: undefined,
    status: snapshot.status as WorkflowStatus,
    currentStageId: snapshot.currentStageId,
    blockingStageIds: [], // placeholder
    createdAt: snapshot.createdAt,
    updatedAt: snapshot.updatedAt,
    startedAt: snapshot.startedAt,
    completedAt: snapshot.completedAt,
  };
}

export function ActiveWork({
  bridge,
  workflowId,
  navigate,
}: {
  bridge: HostBridge;
  workflowId?: string;
  navigate: (route: AppRoute) => void;
}): React.JSX.Element {
  const [workflow, setWorkflow] = useState<Workflow | undefined>();
  const [error, setError] = useState<KeystoneUiError | undefined>();
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [currentStageId, setCurrentStageId] = useState<string | undefined>(undefined);
  const [activeTab, setActiveTab] = useState<string>(\'Objective\');

  const loadRef = useRef<() => void>(() => undefined);
  const load = useCallback(async (): Promise<void> => {
    setIsLoading(true);
    setError(undefined);
    try {
      let result: DevelopmentWorkflowSnapshot | undefined;
      if (workflowId) {
        result = await bridge.request("workflow/get", { workflowId });
      } else {
        // Get active workflow
        const workflows = await bridge.request("workflow/list", {});
        const activeWorkflow = workflows.find(
          (w) => ![ "completed", "cancelled" ].includes(w.status)
        );
        result = activeWorkflow ?? workflows.at(-1); // fallback to latest
      }
      if (result) {
        // Determine work type from intent (fallback to feature)
        const workType: WorkflowWorkType = result.intent.workType ?? "feature";
        setWorkflow(snapshotToWorkflow(result, workType));
        setCurrentStageId(result.currentStageId);
      } else {
        setWorkflow(undefined);
      }
    } catch (cause) {
      setError(
        toUiError(cause, {
          category: "active-work-load",
          title: "Active Work is temporarily unavailable",
          fallbackMessage: "Keystone could not load the current workflow.",
          retry: () => loadRef.current(),
          dismiss: () => setError(undefined),
        })
      );
    } finally {
      setIsLoading(false);
    }
  }, [bridge, workflowId]);

  useEffect(() => {
    loadRef.current = load;
    queueMicrotask(() => void load());
  }, [load]);

  // Handle stage change from UI
  const handleStageSelect = useCallback(
    async (stageId: string) => {
      if (!workflow) return;
      // Update workflow's current stage (optimistically)
      const updatedWorkflow = { ...workflow, currentStageId: stageId };
      setWorkflow(updatedWorkflow);
      setCurrentStageId(stageId);
      // Persist change via backend (fire and forget)
      void bridge
        .request("workflow/updateStage", { workflowId: workflow.id, stageId })
        .catch((cause) => {
          // Revert optimistically on error
          setWorkflow(workflow);
          setCurrentStageId(workflow.currentStageId);
          console.error("Failed to update stage:", cause);
        });
    },
    [bridge, workflow]
  );

  if (isLoading) {
    return (
      <section className="page active-work-page">
        <div className="loading-view">
          <div className="loader" />
        </div>
      </section>
    );
  }

  if (error) {
    return <UiErrorState error={error} />;
  }

  if (!workflow) {
    return (
      <section className="page active-work-page">
        <div className="empty-state">
          <h1>No active workflow</h1>
          <p>
            Start a new workflow to begin working on your engineering goals.
          </p>
          <button
            className="primary-button"
            onClick={() => navigate("/workbench/new")}
          >
            Start new work
          </button>
        </div>
      </section>
    );
  }

  // Get current stage object
  const currentStage = workflow.stages.find(
    (s) => s.id === workflow.currentStageId
  ) ?? workflow.stages[0];

  // Get work items for current stage
  const stageWorkItems = workflow.workItems.filter(
    (item) => item.stageId === workflow.currentStageId
  );

  // Determine if there are blockers
  const hasBlockers = workflow.blockingStageIds.length > 0;

  return (
    <section className="page active-work-page">
      {/* Workflow Header */}
      <div className="workflow-header">
        <div className="header-left">
          <span className="eyebrow">
            {workTypeLabel(workflow.workType)} ·
            Specification {workflow.specificationId}
          </span>
          <h1>{workflow.specification?.title ?? workflow.intent.normalizedObjective}</h1>
          <p>Intent {workflow.intentId}</p>
        </div>
        <div className="header-actions">
          <button
            className="ghost-button"
            onClick={() => navigate("/intelligence")}
            title="Ask repository intelligence"
          >
            <Icon name="intelligence" size={15} />
            Ask repository
          </button>
          <button
            className="ghost-button"
            onClick={() => navigate("/support/diagnostics")}
            title="Workspace health"
          >
            <Icon name="pulse" size={15} />
            Diagnostics
          </button>
          <button
            className="ghost-button"
            onClick={() => {
              // TODO: Implement handoff
              alert("Task Handoff not yet implemented");
            }}
            title="Hand off current workflow"
          >
            <Icon name="cloud-download" size={15} />
            Hand off
          </button>
          <button
            className="ghost-button"
            onClick={() => {
              // TODO: Implement pause/cancel
              alert("Pause/Cancel not yet implemented");
            }}
            title={workflow.currentStageId ? "Pause workflow" : "Cancel workflow"}
          >
            {workflow.currentStageId ? (
              <Icon name="pause" size={15} />
            ) : (
              <Icon name="stop" size={15} />
            )}
            <span>{workflow.currentStageId ? "Pause" : "Cancel"}</span>
          </button>
        </div>
      </div>

      {/* Workflow Meta */}
      <div className="workflow-meta">
        <span className="meta-item">{workflow.repositoryId}</span>
        <span className="meta-divider">·</span>
        <span className="meta-item">Branch {workflow.branch ?? "unspecified"}</span>
        <span className="meta-divider">·</span>
        <span className="meta-item">
          Intelligence gen {workflow.intelligenceGeneration}
        </span>
        <span className="meta-divider">·</span>
        <span className="meta-item status-badge">
          {workflow.status.replace("-", " ")}
        </span>
        <span className="meta-divider">·</span>
        <span className="meta-item">
          Saved {new Date(
            workflow.updatedAt
          ).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
        </span>
      </div>

      {/* Blockers Alert if there are blockers */}
      {hasBlockers && (
        <div className="honesty-note" role="alert">
          <strong>Workflow blocked:</strong> {workflow.blockingStageIds
            .map((id) => {
              const stage = workflow.stages.find((s) => s.id === id);
              return stage ? stage.displayName : id;
            })
            .join(", ")} await resolution.
        </div>
      )}

      {/* SDLC Stage Rail */}
      <nav className="workflow-stage-rail" aria-label="SDLC workflow stages">
        {workflow.stages.map((stage, index) => {
          const isCurrent = stage.id === workflow.currentStageId;
          const isCompleted =
            stage.status === "completed" || stage.status === "passed";
          const isBlocked = stage.blockerCount > 0;
          const canNavigate =
            !isBlocked &&
            (isCompleted ||
              stage.id === workflow.stages[0].id ||
              workflow.stages.some(
                (s) =>
                  s.id === stage.id &&
                  s.status === "ready" &&
                  workflow.stages
                    .slice(
                      0,
                      workflow.stages.findIndex((st) => st.id === stage.id)
                    )
                    .every((s) => s.status === "completed")
              ));

          return (
            <button
              key={stage.id}
              className={`stage-tab ${isCurrent ? "active" : ""} ${
                isCompleted ? "completed" : ""
              } ${isBlocked ? "blocked" : ""} ${!canNavigate ? "disabled" : ""}`}
              aria-current={isCurrent ? "step" : undefined}
              disabled={!canNavigate}
              onClick={() => {
                if (canNavigate) {
                  handleStageSelect(stage.id);
                }
              }}
            >
              <div className="stage-icon">
                <Icon
                  name={
                    isCurrent
                      ? "pulse"
                      : isCompleted
                        ? "check"
                        : isBlocked
                          ? "alert"
                          : "circle"
                  }
                  size={16}
                />
              </div>
              <div className="stage-label">
                <span className="stage-number">{index + 1}</span>
                <strong>{stage.displayName}</strong>
              </div>
              <div className="stage-status">
                {isBlocked ? (
                  <span className="status-blocked">{stage.status}</span>
                ) : (
                  <span className={statusToClass(stage.status)}>
                    {stage.status.replace("-", " ")}
                  </span>
                )}
              </div>
              <div className="stage-metrics">
                {stage.evidenceCount > 0 && (
                  <span className="metric-item">
                    <Icon name="context" size={12} />
                    {stage.evidenceCount} evidence
                  </span>
                )}
                {stage.warningCount > 0 && (
                  <span className="metric-item">
                    <Icon name="alert-triangle" size={12} />
                    {stage.warningCount} warnings
                  </span>
                )}
                {stage.blockerCount > 0 && (
                  <span className="metric-item">
                    <Icon name="circle-x" size={12} />
                    {stage.blockerCount} blockers
                  </span>
                )}
              </div>
              {!isCurrent && canNavigate && (
                <span className="stage-hint">Select to view</span>
              )}
            </button>
          );
        })}
      </nav>

      {/* Current Stage Workspace */}
      <section className="stage-workspace">
        <div className="stage-header">
          <h2>
            {currentStage.displayName} <span className="stage-type">{currentStage.type}</span>
          </h2>
          <div className="stage-meta">
            <span>Status: {currentStage.status.replace("-", " ")}</span>
            <span>Mode: {currentStage.executionMode}</span>
            {currentStage.blockerCount > 0 && (
              <span className="blocker-indicator">
                {currentStage.blockerCount} blocker{
                  currentStage.blockerCount === 1 ? "" : "s"
                }
              </span>
            )}
          </div>
        </div>

        {/* Stage Tabs: Objective, Inputs, Context, Execution, Progress, Results, Evidence, Findings, Controls, Completion Gates */}
        <div className="stage-tabs">
      <button
        className={`tab ${activeTab === 'Objective' ? 'tab-active' : ''}`}
        onClick={() => setActiveTab('Objective')}
      >
        Objective
      </button>
      <button
        className={`tab ${activeTab === 'Inputs' ? 'tab-active' : ''}`}
        onClick={() => setActiveTab('Inputs')}
      >
        Inputs
      </button>
      <button
        className={`tab ${activeTab === 'Context' ? 'tab-active' : ''}`}
        onClick={() => setActiveTab('Context')}
      >
        Context
      </button>
      <button
        className={`tab ${activeTab === 'Execution' ? 'tab-active' : ''}`}
        onClick={() => setActiveTab('Execution')}
      >
        Execution
      </button>
      <button
        className={`tab ${activeTab === 'Progress' ? 'tab-active' : ''}`}
        onClick={() => setActiveTab('Progress')}
      >
        Progress
      </button>
      <button
        className={`tab ${activeTab === 'Results' ? 'tab-active' : ''}`}
        onClick={() => setActiveTab('Results')}
      >
        Results
      </button>
      <button
        className={`tab ${activeTab === 'Evidence' ? 'tab-active' : ''}`}
        onClick={() => setActiveTab('Evidence')}
      >
        Evidence
      </button>
      <button
        className={`tab ${activeTab === 'Findings' ? 'tab-active' : ''}`}
        onClick={() => setActiveTab('Findings')}
      >
        Findings
      </button>
      <button
        className={`tab ${activeTab === 'Controls' ? 'tab-active' : ''}`}
        onClick={() => setActiveTab('Controls')}
      >
        Controls
      </button>
      <button
        className={`tab ${activeTab === 'Completion Gates' ? 'tab-active' : ''}`}
        onClick={() => setActiveTab('Completion Gates')}
      >
        Completion Gates
      </button>
    </div>

        {/* Stage Content - placeholder for now */}
        <div className="stage-content">
          <div className="stage-objective">
            <h3>Objective</h3>
            <p>
              {currentStage.displayName} stage objectives go here.
              This is where you would define what needs to be accomplished in this stage.
            </p>
          </div>

          <div className="stage-inputs">
            <h3>Inputs</h3>
            <p>Inputs from previous stages and specification would appear here.</p>
          </div>

          <div className="stage-context">
            <h3>Context</h3>
            <p>
              Context package for this stage, including token reduction metrics.
            </p>
            {stageWorkItems.length > 0 && (
              <div className="work-items">
                <h4>Work Items ({stageWorkItems.length})</h4>
                <ul>
                  {stageWorkItems.map((item) => (
                    <li key={item.id}>
                      <strong>{item.title}</strong>
                      <p>{item.description}</p>
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </div>

          <div className="stage-execution">
            <hecution">
            <h3>Execution</h3>
            <p>
              Execution controls for this stage would appear here.
              This includes delegation, approvals, and execution monitoring.
            </p>
          </div>

          <div className="stage-progress">
            <h3>Progress</h3>
            <p>Progress indicators for this stage would be shown here.</p>
          </div>

          <div className="stage-results">
            <h3>Results</h3>
            <p>Results from stage execution would appear here.</p>
          </div>

          <div className="stage-evidence">
            <h3>Evidence</h3>
            <p>Evidence collected during this stage would be displayed here.</p>
          </div>

          <div className="stage-findings">
            <h3>Findings</h3>
            <p>Findings from analysis would be listed here.</p>
          </div>

          <div className="stage-controls">
            <h3>Controls</h3>
            <p>Stage-specific controls and actions would be available here.</p>
          </div>

          <div className="stage-completion-gates">
            <h3>Completion Gates</h3>
            <p>Criteria that must be met to complete this stage.</p>
          </div>
        </div>
      </section>
    </section>
  );
}

// Helper functions
function workTypeLabel(value: WorkflowWorkType): string {
  return (
    {
      feature: "Feature",
      "bug-fix": "Bug Fix",
      refactoring: "Refactoring",
      test: "Test",
      investigation: "Investigation",
    } as const
  )[value];
}

function statusToClass(status: WorkflowStatus): string {
  switch (status) {
    case "completed":
    case "passed":
      return "status-completed";
    case "current":
      return "status-current";
    case "pending":
    case "ready":
      return "status-pending";
    case "blocked":
      return "status-blocked";
    case "failed":
      return "status-failed";
    case "cancelled":
      return "status-cancelled";
    case "not-ready":
    default:
      return "status-default";
  }
}