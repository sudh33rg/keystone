import { useCallback, useEffect, useRef, useState } from "react";
import type { AppRoute } from "../../../shared/contracts/domain";
import { canonicalWorkTypeLabel, type CanonicalWorkflow, type CanonicalWorkflowStageSummary } from "../../../shared/contracts/canonicalWorkflow";
import type { LaunchRecovery } from "../../../shared/contracts/nativeShell";
import type { HostBridge } from "../../services/HostBridge";
import { RecoveryNotice, toUiError, UiErrorState, type KeystoneUiError } from "../UiState";
import { DevelopmentStage } from "./DevelopmentStage";
import { ImpactAnalysisStage } from "./ImpactAnalysisStage";
import { QaStage } from "./QaStage";
import { UnderstandStage } from "./UnderstandStage";
import { InvestigationStage } from "./InvestigationStage";
import { PlanStage } from "./PlanStage";
import { CompleteStage } from "./CompleteStage";
import { TaskHandoffWorkspace } from "./TaskHandoffWorkspace";

interface StageComponentProps {
  bridge: HostBridge;
  workflowId: string;
  navigate: (route: AppRoute) => void;
  onWorkflowChange: (workflow: CanonicalWorkflow) => void;
}

/** Stage registry: maps persisted stage types to their workspace components. */
const STAGE_REGISTRY: Record<string, (props: StageComponentProps) => React.JSX.Element> = {
  understand: (props) => <UnderstandStage bridge={props.bridge} workflowId={props.workflowId} onWorkflowChange={props.onWorkflowChange} />,
  investigation: (props) => <InvestigationStage bridge={props.bridge} workflowId={props.workflowId} onWorkflowChange={props.onWorkflowChange} />,
  plan: (props) => <PlanStage bridge={props.bridge} workflowId={props.workflowId} onWorkflowChange={props.onWorkflowChange} />,
  complete: (props) => <CompleteStage bridge={props.bridge} workflowId={props.workflowId} navigate={props.navigate} onWorkflowChange={props.onWorkflowChange} />,
  development: (props) => <DevelopmentStage bridge={props.bridge} workflowId={props.workflowId} onWorkflowChange={props.onWorkflowChange} />,
  "impact-analysis": (props) => <ImpactAnalysisStage bridge={props.bridge} workflowId={props.workflowId} onWorkflowChange={props.onWorkflowChange} />,
  qa: (props) => <QaStage bridge={props.bridge} workflowId={props.workflowId} onWorkflowChange={props.onWorkflowChange} />,
};

export function ActiveWork({ bridge, workflowId, navigate, recovery }: { bridge: HostBridge; workflowId?: string; navigate: (route: AppRoute) => void; recovery?: LaunchRecovery }): React.JSX.Element {
  const selectedWorkflowId = workflowId ?? readSelectedWorkflowId(bridge);
  const [workflow, setWorkflow] = useState<CanonicalWorkflow | null>();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<KeystoneUiError>();
  const [selectedStageId, setSelectedStageId] = useState<string>();
  const [showHandoff, setShowHandoff] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const loadRef = useRef<() => void>(() => undefined);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const result = selectedWorkflowId
        ? await bridge.request("workflow.getCanonical", { workflowId: selectedWorkflowId }) ?? null
        : await bridge.request("workflow.loadActive", {});
      setWorkflow(result);
      setSelectedStageId((selected) => selected && result?.stages.some((stage) => stage.id === selected) ? selected : firstOpenStageId(result));
      setError(undefined);
    } catch (cause) {
      setError(toUiError(cause, { category: "active-work-load", title: "Active Work is temporarily unavailable", fallbackMessage: "Keystone could not load the persisted workflow.", retry: () => loadRef.current(), dismiss: () => setError(undefined) }));
    } finally { setLoading(false); }
  }, [bridge, selectedWorkflowId]);
  useEffect(() => { loadRef.current = () => void load(); queueMicrotask(() => void load()); }, [load]);

  // Auto-advance: when a stage workspace completes its stage, follow the workflow's new current stage.
  const handleWorkflowChange = useCallback((updated: CanonicalWorkflow): void => {
    setWorkflow(updated);
    setSelectedStageId(firstOpenStageId(updated));
  }, []);

  if (loading) return <section className="page active-work-page"><div className="loading-view"><div className="loader" /><p>Loading your work…</p></div></section>;
  if (error) return <section className="page active-work-page"><UiErrorState error={error} /><button className="ghost-button" onClick={() => navigate("/")}>Return Home</button></section>;
  if (!workflow) return <section className="page active-work-page"><div className="empty-state"><h1>{selectedWorkflowId ? "Workflow not found" : "No active workflow"}</h1><p>{selectedWorkflowId ? "The selected workflow is unavailable or corrupted." : "Start new work to create a workflow."}</p><button className="primary-button" onClick={() => navigate("/workflow/new")}>Start New Work</button></div></section>;

  const selected = workflow.stages.find((stage) => stage.id === selectedStageId)
    ?? workflow.stages.find((stage) => stage.id === workflow.currentStageId)
    ?? workflow.stages[0];
  const StageComponent = selected ? STAGE_REGISTRY[selected.type] : undefined;

  return <section className="page active-work-page">
    {recovery && <RecoveryNotice recovery={recovery} />}
    <header className="workflow-header">
      <div className="header-left">
        <h1 title={workflow.intent.text}>{workflow.intent.text}</h1>
        <p className="workflow-subline">
          {canonicalWorkTypeLabel(workflow.intent.workType)} · {stateLabel(workflow.status)} · Updated {relativeTime(workflow.updatedAt)}
        </p>
      </div>
      <div className="header-right">
        {workflow.status === "active" && <button className="secondary-button" onClick={() => setShowHandoff((value) => !value)}>Task Handoff</button>}
        <div className="overflow-menu">
          <button className="ghost-button" aria-haspopup="menu" aria-expanded={menuOpen} onClick={() => setMenuOpen((value) => !value)}>More…</button>
          {menuOpen && (
            <div className="overflow-menu-items" role="menu">
              <button role="menuitem" onClick={() => { setMenuOpen(false); void load(); }}>Refresh Stage (recovery)</button>
              <button role="menuitem" onClick={() => { setMenuOpen(false); navigate("/intelligence"); }}>Open Intelligence</button>
              <button role="menuitem" onClick={() => { setMenuOpen(false); navigate("/history"); }}>View History</button>
            </div>
          )}
        </div>
      </div>
    </header>

    <ol className="stage-rail" aria-label="Workflow stages">
      {workflow.stages.map((stage) => {
        const visual = stageVisualState(stage, workflow);
        const openable = visual !== "unavailable";
        return (
          <li key={stage.id} className={`stage-rail-item ${visual}${stage.id === selected?.id ? " selected" : ""}`} aria-current={stage.id === workflow.currentStageId ? "step" : undefined}>
            <button disabled={!openable} onClick={() => setSelectedStageId(stage.id)}>
              <span className="stage-rail-marker" aria-hidden="true" />
              <span className="stage-rail-name">{stage.displayName}</span>
              <span className="stage-rail-state">{visualLabel(visual)}</span>
            </button>
          </li>
        );
      })}
    </ol>

    {StageComponent && selected
      ? <StageComponent bridge={bridge} workflowId={workflow.id} navigate={navigate} onWorkflowChange={handleWorkflowChange} />
      : selected && (
          <section className="stage-workspace" aria-label={selected.displayName}>
            <div className="stage-guidance">
              <div>
                <h2>{selected.displayName}</h2>
                <p>This stage opens once the earlier stages are completed.</p>
              </div>
            </div>
          </section>
        )}

    {showHandoff && <TaskHandoffWorkspace bridge={bridge} workflowId={workflow.id} onClose={() => setShowHandoff(false)} />}
  </section>;
}

type StageVisualState = "completed" | "active" | "ready" | "blocked" | "failed" | "unavailable";

function stageVisualState(stage: CanonicalWorkflowStageSummary, workflow: CanonicalWorkflow): StageVisualState {
  if (stage.status === "completed") return "completed";
  if (stage.id === workflow.currentStageId) return "active";
  if (stage.status === "ready") return "ready";
  return "unavailable";
}

function visualLabel(state: StageVisualState): string {
  return { completed: "Completed", active: "Active", ready: "Ready", blocked: "Blocked", failed: "Failed", unavailable: "Not yet available" }[state];
}

function firstOpenStageId(workflow: CanonicalWorkflow | null | undefined): string | undefined {
  if (!workflow) return undefined;
  const current = workflow.stages.find((stage) => stage.id === workflow.currentStageId);
  if (current && current.status !== "completed") return current.id;
  const nextOpen = workflow.stages.find((stage) => stage.status !== "completed");
  return nextOpen?.id ?? workflow.stages[workflow.stages.length - 1]?.id;
}

function stateLabel(status: string): string {
  return status === "active" ? "In progress" : status === "completed" ? "Completed" : status.charAt(0).toUpperCase() + status.slice(1);
}

function relativeTime(value: string): string {
  const then = new Date(value).getTime();
  const minutes = Math.round((Date.now() - then) / 60_000);
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes} minute${minutes === 1 ? "" : "s"} ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours} hour${hours === 1 ? "" : "s"} ago`;
  const days = Math.round(hours / 24);
  if (days < 7) return `${days} day${days === 1 ? "" : "s"} ago`;
  return new Date(value).toLocaleDateString();
}

function readSelectedWorkflowId(bridge: HostBridge): string | undefined {
  const state = bridge.getWebviewState?.();
  if (!state || typeof state !== "object") return undefined;
  const value = (state as Record<string, unknown>).keystoneSelectedWorkflowId;
  return typeof value === "string" ? value : undefined;
}
