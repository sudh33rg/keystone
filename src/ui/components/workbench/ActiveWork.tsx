import { useCallback, useEffect, useRef, useState } from "react";
import type { AppRoute } from "../../../shared/contracts/domain";
import { canonicalWorkTypeLabel, type CanonicalWorkflow } from "../../../shared/contracts/canonicalWorkflow";
import type { LaunchRecovery } from "../../../shared/contracts/nativeShell";
import type { HostBridge } from "../../services/HostBridge";
import { RecoveryNotice, toUiError, UiErrorState, type KeystoneUiError } from "../UiState";
import { DevelopmentStage } from "./DevelopmentStage";
import { ImpactAnalysisStage } from "./ImpactAnalysisStage";
import { QaStage } from "./QaStage";
import { TaskHandoffWorkspace } from "./TaskHandoffWorkspace";

export function ActiveWork({ bridge, workflowId, navigate, recovery }: { bridge: HostBridge; workflowId?: string; navigate: (route: AppRoute) => void; recovery?: LaunchRecovery }): React.JSX.Element {
  const selectedWorkflowId = workflowId ?? readSelectedWorkflowId(bridge);
  const [workflow, setWorkflow] = useState<CanonicalWorkflow | null>();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<KeystoneUiError>();
  const [selectedStageId, setSelectedStageId] = useState<string>();
  const [showHandoff, setShowHandoff] = useState(false);
  const loadRef = useRef<() => void>(() => undefined);
  const load = useCallback(async () => {
    setLoading(true);
    try {
      const result = selectedWorkflowId
        ? await bridge.request("workflow.getCanonical", { workflowId: selectedWorkflowId }) ?? null
        : await bridge.request("workflow.loadActive", {});
      setWorkflow(result); setSelectedStageId((selected) => selected && result?.stages.some((stage) => stage.id === selected) ? selected : result?.currentStageId ?? undefined); setError(undefined);
    } catch (cause) {
      setError(toUiError(cause, { category: "active-work-load", title: "Active Work is temporarily unavailable", fallbackMessage: "Keystone could not load the persisted workflow.", retry: () => loadRef.current(), dismiss: () => setError(undefined) }));
    } finally { setLoading(false); }
  }, [bridge, selectedWorkflowId]);
  useEffect(() => { loadRef.current = () => void load(); queueMicrotask(() => void load()); }, [load]);
  const handleWorkflowChange = useCallback((updated: CanonicalWorkflow): void => { setWorkflow(updated); setSelectedStageId(updated.currentStageId ?? undefined); }, []);

  if (loading) return <section className="page active-work-page"><div className="loading-view"><div className="loader" /><p>Loading persisted workflow…</p></div></section>;
  if (error) return <section className="page active-work-page"><UiErrorState error={error} /><button className="ghost-button" onClick={() => navigate("/")}>Return Home</button></section>;
  if (!workflow) return <section className="page active-work-page"><div className="empty-state"><h1>{selectedWorkflowId ? "Workflow not found" : "No active workflow"}</h1><p>{selectedWorkflowId ? "The selected persisted workflow is unavailable or corrupted." : "Start new work from Home to create a persisted workflow."}</p><button className="primary-button" onClick={() => navigate("/")}>Return Home</button></div></section>;

  const current = workflow.stages.find((stage) => stage.id === workflow.currentStageId);
  const selected = workflow.stages.find((stage) => stage.id === selectedStageId) ?? current;
  return <section className="page active-work-page">
    <header className="workflow-header"><div className="header-left"><span className="eyebrow">{canonicalWorkTypeLabel(workflow.intent.workType)}</span><h1>{workflow.intent.text}</h1><p>Status: {workflow.status}</p></div></header>
    <div className="workflow-meta"><span>Created: {formatDate(workflow.createdAt)}</span><span className="meta-divider">·</span><span>Updated: {formatDate(workflow.updatedAt)}</span></div>
    {recovery && <RecoveryNotice recovery={recovery} />}
    <section className="stage-inputs" aria-labelledby="workflow-specification"><h2 id="workflow-specification">Specification</h2>{workflow.specification ? <><p>{workflow.specification.text}</p><small>Revision {workflow.specification.revision}</small></> : <p>No specification was added.</p>}</section>
    <section className="stage-inputs" aria-labelledby="stage-overview"><h2 id="stage-overview">Stage overview</h2><ol className="stage-summary-list stage-rail">{workflow.stages.map((stage) => { const openable = stage.type === "development" || stage.status === "completed" || stage.id === workflow.currentStageId; return <li key={stage.id} className={`${stage.id === workflow.currentStageId ? "current " : ""}${stage.id === selected?.id ? "selected" : ""}`} aria-current={stage.id === workflow.currentStageId ? "step" : undefined}><button disabled={!openable} onClick={() => setSelectedStageId(stage.id)}><strong>{stage.displayName}</strong><span>Order {stage.order} · {stage.status} · {stage.required ? "Required" : "Optional"}</span></button></li>; })}</ol></section>
    {selected?.type === "development" ? <DevelopmentStage bridge={bridge} workflowId={workflow.id} onWorkflowChange={handleWorkflowChange} /> : selected?.type === "impact-analysis" ? <ImpactAnalysisStage bridge={bridge} workflowId={workflow.id} onWorkflowChange={handleWorkflowChange} /> : selected?.type === "qa" ? <QaStage bridge={bridge} workflowId={workflow.id} onWorkflowChange={handleWorkflowChange} /> : selected && <section className="honesty-note" aria-labelledby="selected-stage"><h2 id="selected-stage">{selected.id === workflow.currentStageId ? "Current stage" : "Stage"}: {selected.displayName}</h2><p>Status: {selected.status}</p><p>This persisted stage remains a compact read-only summary in Phase 3.</p>{workflow.status === "active" && workflow.stages.some((stage) => stage.type === "development") && <button className="primary-button" onClick={() => setSelectedStageId(workflow.stages.find((stage) => stage.type === "development")!.id)}>Open Development</button>}</section>}
    <div className="button-row"><button className="ghost-button" onClick={() => navigate("/")}>Return Home</button><button className="ghost-button" onClick={() => navigate("/intelligence")}>View Intelligence</button>{workflow.status === "active" && <button className="secondary-button" onClick={() => setShowHandoff((v) => !v)}>Task Handoff</button>}<button className="primary-button" onClick={() => void load()}>Refresh Workflow</button></div>
    {showHandoff && <TaskHandoffWorkspace bridge={bridge} workflowId={workflow.id} onClose={() => setShowHandoff(false)} />}
  </section>;
}

function formatDate(value: string): string { return new Date(value).toLocaleString(); }

function readSelectedWorkflowId(bridge: HostBridge): string | undefined {
  const state = bridge.getWebviewState?.();
  if (!state || typeof state !== "object") return undefined;
  const value = (state as Record<string, unknown>).keystoneSelectedWorkflowId;
  return typeof value === "string" ? value : undefined;
}
