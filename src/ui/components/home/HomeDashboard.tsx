import { useCallback, useEffect, useRef, useState } from "react";
import type { AppRoute } from "../../../shared/contracts/domain";
import type { HomeState } from "../../../shared/contracts/home";
import { canonicalWorkTypeLabel } from "../../../shared/contracts/canonicalWorkflow";
import type { HostBridge } from "../../services/HostBridge";
import { toUiError, UiErrorState, type KeystoneUiError } from "../UiState";

export function HomeDashboard({ bridge, navigate }: { bridge: HostBridge; navigate: (route: AppRoute) => void }): React.JSX.Element {
  const [state, setState] = useState<HomeState>();
  const [error, setError] = useState<KeystoneUiError>();
  const [loading, setLoading] = useState(true);
  const loadRef = useRef<() => void>(() => undefined);
  const load = useCallback(async () => {
    setLoading(true);
    try {
      setState(await bridge.request("home/getState", {}));
      setError(undefined);
    } catch (cause) {
      setError(toUiError(cause, {
        category: "home-load",
        title: "Home is temporarily unavailable",
        fallbackMessage: "Keystone could not load the current repository and workflow summary.",
        retry: () => loadRef.current(),
        dismiss: () => setError(undefined),
      }));
    } finally {
      setLoading(false);
    }
  }, [bridge]);
  useEffect(() => { loadRef.current = () => void load(); queueMicrotask(() => void load()); }, [load]);

  if (loading && !state) return <section className="loading-view" aria-live="polite"><div className="loader" /><p>Loading Home…</p></section>;
  if (error && !state) return <UiErrorState error={error} />;
  if (!state) return <UiErrorState error={toUiError(new Error("Home state unavailable"), { category: "home-load", title: "Home is unavailable", fallbackMessage: "Keystone did not return Home state." })} />;
  const repository = state.repository;
  const workflow = state.activeWorkflow;

  return <section className="page home-page">
    {error && <UiErrorState error={error} />}
    <div className="status-grid home-sections">
      <section className="status-card" role="region" aria-labelledby="home-repository">
        <small>REPOSITORY INTELLIGENCE</small>
        <h2 id="home-repository">Repository Intelligence</h2>
        <h3>{repository.name}</h3>
        <p>Status: {repository.status.replaceAll("-", " ")}</p>
        {repository.generation !== undefined && <p>Generation {repository.generation}</p>}
        {repository.lastSuccessfulUpdate && <p>Last successful update: {formatDate(repository.lastSuccessfulUpdate)}</p>}
        {repository.progress && <p>{repository.progress.label}: {repository.progress.completed} / {repository.progress.total}</p>}
        {repository.error && <p role="alert">{repository.error}</p>}
        {repository.refreshSupported && <button className="ghost-button" onClick={() => void bridge.request("intelligence/scan/start", {}).then(load).catch((cause) => setError(toUiError(cause, { category: "intelligence-refresh", title: "Repository Intelligence could not start", fallbackMessage: "Keystone could not start repository intelligence.", dismiss: () => setError(undefined) })))}>Refresh intelligence</button>}
        <button className="card-action" onClick={() => navigate("/intelligence")}>Open Repository Intelligence →</button>
      </section>

      <section className="status-card" role="region" aria-labelledby="home-active-work">
        <small>ACTIVE WORK</small>
        <h2 id="home-active-work">Active Work</h2>
        {workflow ? <>
          <h3>{workflow.title}</h3>
          {workflow.intent !== workflow.title && <p>{workflow.intent}</p>}
          {workflow.workType && <p>Work type: {canonicalWorkTypeLabel(workflow.workType)}</p>}
          <p>Status: {workflow.status}</p>
          {workflow.currentStage && <p>Current stage: {workflow.currentStage} · {workflow.currentStageStatus}</p>}
          {workflow.nextRequiredAction && <p>Next: {workflow.nextRequiredAction}</p>}
          <p>Updated: {formatDate(workflow.updatedAt)}</p>
          <button className="ghost-button" onClick={() => { clearSelectedWorkflow(bridge); navigate("/active-work"); }}>Resume Work</button>
        </> : <p>No active workflow</p>}
      </section>

      <section className="status-card" role="region" aria-labelledby="home-start-work">
        <small>START NEW WORK</small>
        <h2 id="home-start-work">Start New Work</h2>
        {workflow ? <p>Complete or cancel the current workflow before starting another.</p> : <><p>Start from an engineering intent and prepare a controlled Keystone workflow.</p><button className="primary-button" onClick={() => navigate("/workflow/new")}>Start Work</button></>}
      </section>

      <section className="status-card" role="region" aria-labelledby="home-activity">
        <small>RECENT ACTIVITY</small>
        <h2 id="home-activity">Recent Activity</h2>
        {state.recentActivities.length ? <ul>{state.recentActivities.map((activity) => <li key={activity.id}><strong>{activity.title}</strong><span>{activity.status} · {formatDate(activity.updatedAt)}</span></li>)}</ul> : <p>No recent Keystone activity.</p>}
      </section>
    </div>
  </section>;
}

function formatDate(value: string): string {
  return new Date(value).toLocaleString();
}

function clearSelectedWorkflow(bridge: HostBridge): void {
  const current = bridge.getWebviewState?.();
  if (!current || typeof current !== "object") return;
  const next = { ...current } as Record<string, unknown>;
  delete next.keystoneSelectedWorkflowId;
  bridge.setWebviewState?.(next);
}
