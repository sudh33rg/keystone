import { useEffect, useMemo, useState } from "react";
import type { Activity, AppRoute, BootstrapSnapshot, PersistedFoundationState } from "../shared/contracts/domain";
import { PRIMARY_NAVIGATION, sectionForRoute } from "../shared/navigation";
import type { IntelligenceOverview as IntelligenceOverviewModel } from "../shared/contracts/intelligence";
import { Icon } from "./components/Icon";
import { IntelligenceOverview } from "./components/intelligence/IntelligenceOverview";
import type { HostBridge } from "./services/HostBridge";
import { SDLCWorkbench } from "./components/workbench/SDLCWorkbench";
import { HomeDashboard } from "./components/home/HomeDashboard";
import { HistoryWorkspace } from "./components/history/HistoryWorkspace";

interface AppProps {
  bridge: HostBridge;
}

export function App({ bridge }: AppProps): React.JSX.Element {
  const [bootstrap, setBootstrap] = useState<BootstrapSnapshot>();
  const [state, setState] = useState<PersistedFoundationState>();
  const [activity, setActivity] = useState<Activity>();
  const [overview, setOverview] = useState<IntelligenceOverviewModel>();
  const [error, setError] = useState<string>();

  useEffect(() => {
    const unsubscribe = bridge.subscribe((message) => {
      if (message.type === "bootstrap/ready") {
        setBootstrap(message.payload);
        setState(message.payload.state);
        setActivity(message.payload.activity);
      }
      if (message.type === "state/updated") setState(message.payload);
      if (message.type === "activity/updated") setActivity(message.payload);
      if (message.type === "intelligence/updated") setOverview(message.payload);
      if (message.type === "intelligence/runtime") setOverview((current) => current ? { ...current, status: message.payload.status, pendingUpdate: message.payload.pendingUpdate, runtime: message.payload } : current);
    });
    void bridge.request("app/bootstrap", {}).catch((cause: unknown) => setError(cause instanceof Error ? cause.message : String(cause)));
    return unsubscribe;
  }, [bridge]);

  useEffect(() => {
    if (state?.activeRoute !== "/intelligence") return;
    const controller = new AbortController();
    void bridge.request("intelligence/overview", {}, { signal: controller.signal }).then(setOverview).catch((cause: unknown) => {
      if (!(cause instanceof DOMException && cause.name === "AbortError")) setError(cause instanceof Error ? cause.message : String(cause));
    });
    return () => controller.abort();
  }, [bridge, state?.activeRoute]);

  const activeRoute = state?.activeRoute ?? "/";
  const implementationProgress = useMemo(() => bootstrap ? `${bootstrap.implementation.completedTasks.length} milestone capabilities complete` : "Connecting to Extension Host", [bootstrap]);

  const navigate = (route: AppRoute): void => {
    if (state) setState({ ...state, activeRoute: route, activeSection: sectionForRoute(route) });
    void bridge.request("navigation/set", { route }).catch((cause: unknown) => setError(cause instanceof Error ? cause.message : String(cause)));
  };

  return (
    <div className="app-shell">
      <header className="brand-bar">
        <div className="brand-mark" aria-hidden="true"><span/><span/><span/></div>
        <div className="brand-copy"><strong>Keystone</strong><span>Engineering control center</span></div>
        <div className="header-actions"><button className="ghost-button" onClick={() => navigate("/support/diagnostics")}>Workspace health</button><button className="ghost-button" onClick={() => navigate("/settings")}>Settings</button><span className="version-pill">v{bootstrap?.extensionVersion ?? "—"}</span></div>
      </header>

      <nav className="navigation" aria-label="Keystone sections">
        {PRIMARY_NAVIGATION.map((item) => { const active = item.id === "workbench" ? activeRoute.startsWith("/workbench/") : activeRoute === item.route; return (
          <button key={item.id} className={active ? "nav-item active" : "nav-item"} onClick={() => navigate(item.route)} aria-current={active ? "page" : undefined}>
            <Icon name={item.icon}/><span>{item.label}</span>
          </button>
        ); })}
      </nav>

      <main className="main-content">
        {error && <div className="error-banner" role="alert"><span>{error}</span><button onClick={() => setError(undefined)} aria-label="Dismiss error">×</button></div>}
        {!bootstrap ? <LoadingView/> : activeRoute === "/" ? <HomeDashboard bootstrap={bootstrap} bridge={bridge} navigate={navigate}/> : activeRoute === "/settings" ? <Settings bridge={bridge}/> : activeRoute === "/intelligence" ? (
          <IntelligenceOverview
            bridge={bridge}
            overview={overview}
            onStart={() => { void bridge.request("intelligence/scan/start", {}).catch(showError(setError)); }}
            onCancel={() => { void bridge.request("intelligence/scan/cancel", {}).catch(showError(setError)); }}
            onPause={() => { void bridge.request("intelligence/runtime/pause", {}).catch(showError(setError)); }}
            onResume={() => { void bridge.request("intelligence/runtime/resume", {}).catch(showError(setError)); }}
            onRefresh={() => { void bridge.request("intelligence/overview", {}).then(setOverview).catch(showError(setError)); }}
          />
        ) : activeRoute.startsWith("/workbench/") ? <SDLCWorkbench bridge={bridge} route={activeRoute} navigate={navigate}/> : activeRoute === "/history" ? <HistoryWorkspace bridge={bridge} navigate={navigate}/> : activeRoute === "/support/diagnostics" ? <Diagnostics bootstrap={bootstrap} overview={overview} activity={activity}/> : <HomeDashboard bootstrap={bootstrap} bridge={bridge} navigate={navigate}/>}
      </main>

      <aside className={`activity-panel ${activity?.status ?? "idle"}`} aria-label="Current activity">
        <div className="activity-icon"><Icon name={activity?.status === "completed" ? "check" : "pulse"}/></div>
        <div className="activity-copy"><strong>{activity?.operation ?? "Connecting"}</strong><span>{activity?.detail ?? "Restoring Keystone state…"}</span></div>
        <span className="activity-meta">{implementationProgress}</span>
      </aside>
    </div>
  );
}

function Diagnostics({ bootstrap, overview, activity }: { bootstrap: BootstrapSnapshot; overview?: IntelligenceOverviewModel; activity?: Activity }): React.JSX.Element {
  return <section className="page settings-page"><div className="eyebrow">Bounded product health</div><h1>Diagnostics</h1><p>Current Extension Host, repository, Intelligence, and operation state. No credentials or repository source are included.</p><div className="settings-list"><div><span><strong>Workspace trust</strong><small>Executable and mutating actions require a trusted workspace</small></span><span className="setting-value">{bootstrap.workspace.trust}</span></div><div><span><strong>Intelligence</strong><small>Canonical local generation</small></span><span className="setting-value">{overview?.status ?? bootstrap.workspace.indexStatus} · generation {overview?.generation ?? 0}</span></div><div><span><strong>Current operation</strong><small>{activity?.detail ?? "No active operation"}</small></span><span className="setting-value">{activity?.status ?? "idle"}</span></div><div><span><strong>Persistence</strong><small>Extension-managed files; no external database or backend</small></span><span className="setting-value">Local</span></div></div></section>;
}

function LoadingView(): React.JSX.Element {
  return <section className="loading-view"><div className="loader"/><p>Restoring the Keystone workspace…</p></section>;
}

function showError(setError: (message: string) => void): (cause: unknown) => void {
  return (cause) => setError(cause instanceof Error ? cause.message : String(cause));
}

function Settings({ bridge }: { bridge: HostBridge }): React.JSX.Element {
  return (
    <section className="page settings-page">
      <div className="eyebrow">Extension preferences</div>
      <h1>Settings</h1>
      <p>Keystone settings live in VS Code so workspace and user scopes remain explicit.</p>
      <div className="settings-list">
        <div><span><strong>Specification approvals</strong><small>Required before implementation by default</small></span><span className="setting-value">Required</span></div>
        <div><span><strong>Agent selection</strong><small>Recommend an available agent and wait for confirmation</small></span><span className="setting-value">Recommended</span></div>
        <div><span><strong>Context budget</strong><small>Maximum estimated tokens per task package</small></span><span className="setting-value">12,000</span></div>
      </div>
      <button className="primary-button" onClick={() => { void bridge.request("settings/open", {}); }}>Open VS Code settings <Icon name="arrow" size={16}/></button>
    </section>
  );
}
