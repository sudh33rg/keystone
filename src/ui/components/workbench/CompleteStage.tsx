import { useCallback, useEffect, useState } from "react";
import type { CanonicalWorkflow } from "../../../shared/contracts/canonicalWorkflow";
import type { CompleteState } from "../../../shared/contracts/stageWorkspace";
import type { AppRoute } from "../../../shared/contracts/domain";
import type { HostBridge } from "../../services/HostBridge";

interface CompleteStageProps {
  bridge: HostBridge;
  workflowId: string;
  navigate: (route: AppRoute) => void;
  onWorkflowChange: (workflow: CanonicalWorkflow) => void;
}

export function CompleteStage({ bridge, workflowId, navigate, onWorkflowChange }: CompleteStageProps): React.JSX.Element {
  const [state, setState] = useState<CompleteState>();
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<string>();
  const [error, setError] = useState<string>();

  useEffect(() => {
    let cancelled = false;
    void bridge
      .request("stage.complete.load", { workflowId })
      .then((value) => { if (!cancelled) setState(value); })
      .catch((cause: unknown) => { if (!cancelled) setError(cause instanceof Error ? cause.message : "The completion summary could not be loaded."); });
    return () => { cancelled = true; };
  }, [bridge, workflowId]);

  const copySummary = useCallback(async (): Promise<void> => {
    if (!state) return;
    const summary = [
      `Intent: ${state.intentText}`,
      `Work type: ${state.workTypeLabel}`,
      `Outcome: ${state.outcome}`,
      state.limitations.length ? `Limitations: ${state.limitations.join("; ")}` : "",
    ].filter(Boolean).join("\n");
    try {
      await navigator.clipboard.writeText(summary);
      setNotice("Final summary copied to the clipboard.");
    } catch {
      setError("The summary could not be copied. Select the text manually instead.");
    }
  }, [state]);

  const archive = useCallback(async (): Promise<void> => {
    setBusy(true);
    setError(undefined);
    try {
      const workflow = await bridge.request("stage.complete.archive", { workflowId });
      onWorkflowChange(workflow);
      setNotice("Workflow archived.");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "The workflow could not be archived.");
    } finally {
      setBusy(false);
    }
  }, [bridge, onWorkflowChange, workflowId]);

  if (error && !state) return <section className="stage-workspace" aria-label="Complete stage"><div className="error-banner" role="alert">{error}</div></section>;
  if (!state) return <section className="stage-workspace" aria-label="Complete stage"><div className="loading-view"><div className="loader" /><p>Loading the completion summary…</p></div></section>;

  return (
    <section className="stage-workspace" aria-label="Complete stage">
      {error && <div className="error-banner" role="alert">{error}</div>}
      {notice && <div className="success-banner" role="status">{notice}</div>}

      <div className="stage-guidance">
        <div>
          <h2>Final outcome</h2>
          <p>{state.intentText} — {state.workTypeLabel}</p>
        </div>
        <div className="button-row">
          <button className="secondary-button" onClick={() => void copySummary()}>Copy Final Summary</button>
          <button className="primary-button" disabled={busy || state.completedStages.every((stage) => stage.completed)} onClick={() => void archive()}>Archive Workflow</button>
        </div>
      </div>

      <details className="stage-panel" open>
        <summary>Result</summary>
        <pre className="prompt-preview" tabIndex={0}>{state.outcome}</pre>
      </details>

      <details className="stage-panel" open>
        <summary>Completed stages</summary>
        <ul>{state.completedStages.map((stage) => <li key={stage.displayName}>{stage.displayName} — {stage.completed ? "completed" : "not completed"}</li>)}</ul>
      </details>

      {state.evidence.length > 0 && (
        <details className="stage-panel">
          <summary>Evidence ({state.evidence.length})</summary>
          <ul className="evidence-list">
            {state.evidence.slice(0, 60).map((item) => (
              <li key={`${item.kind}-${item.reference}`}>
                <button className="link-button" onClick={() => void bridge.request("intelligence/source/open", { relativePath: item.reference }).catch((cause: unknown) => setError(cause instanceof Error ? cause.message : "The source could not be opened."))}>{item.label}</button>
                <small> {item.kind}</small>
              </li>
            ))}
          </ul>
        </details>
      )}

      {state.limitations.length > 0 && (
        <details className="stage-panel"><summary>Unresolved limitations ({state.limitations.length})</summary><ul>{state.limitations.map((item) => <li key={item}>{item}</li>)}</ul></details>
      )}

      {state.tokenMetrics && (
        <details className="stage-panel">
          <summary>Context token metrics</summary>
          <dl className="config-grid">
            <div><dt>Candidate tokens</dt><dd>{state.tokenMetrics.candidateTokens.toLocaleString()} ({state.tokenMetrics.tokenMeasurement})</dd></div>
            <div><dt>Compressed tokens</dt><dd>{state.tokenMetrics.compressedTokens.toLocaleString()} ({state.tokenMetrics.tokenMeasurement})</dd></div>
            <div><dt>Reduction</dt><dd>{state.tokenMetrics.reductionPercent}%</dd></div>
          </dl>
        </details>
      )}

      {state.delegationHistory.length > 0 && (
        <details className="stage-panel">
          <summary>Delegation history ({state.delegationHistory.length})</summary>
          <ul>{state.delegationHistory.map((record) => <li key={record.id}>{new Date(record.createdAt).toLocaleString()} — {record.capabilityUsed} — {record.statusDetail}</li>)}</ul>
        </details>
      )}

      <div className="button-row">
        <button className="ghost-button" onClick={() => navigate("/workflow/new")}>Start Related Work</button>
        <button className="ghost-button" onClick={() => navigate("/history")}>View History</button>
      </div>
    </section>
  );
}
