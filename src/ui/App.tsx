import { useEffect, useMemo, useState } from "react";
import type { Activity, BootstrapSnapshot, NavigationSection, PersistedFoundationState } from "../shared/contracts/domain";
import type { IntelligenceOverview as IntelligenceOverviewModel } from "../shared/contracts/intelligence";
import { Icon } from "./components/Icon";
import { IntelligenceOverview } from "./components/intelligence/IntelligenceOverview";
import type { HostBridge } from "./services/HostBridge";
import { DevelopmentWorkspace } from "./components/delegation/DevelopmentWorkspace";
import { ExecutionValidationWorkspace } from "./components/execution/ExecutionValidationWorkspace";
import { DeliveryWorkspace } from "./components/delivery/DeliveryWorkspace";
import { TeamWorkflowWorkspace } from "./components/team/TeamWorkflowWorkspace";
import { OrchestrationWorkspace } from "./components/orchestration/OrchestrationWorkspace";

interface AppProps {
  bridge: HostBridge;
}

const navigation: { id: NavigationSection; label: string; icon: Parameters<typeof Icon>[0]["name"] }[] = [
  { id: "home", label: "Home", icon: "home" },
  { id: "intelligence", label: "Intelligence", icon: "intelligence" },
  { id: "intent", label: "Intent & Specs", icon: "intent" },
  { id: "tasks", label: "Tasks", icon: "tasks" },
  { id: "orchestration", label: "Active Workflow", icon: "pulse" },
  { id: "validation", label: "Validation & QA", icon: "validation" },
  { id: "delivery", label: "Delivery", icon: "repo" },
  { id: "team", label: "Task Handoff", icon: "tasks" },
  { id: "diagnostics", label: "Diagnostics", icon: "pulse" },
  { id: "settings", label: "Settings", icon: "settings" }
];

const sections: Record<"validation", { eyebrow: string; title: string; description: string; phase: string; icon: Parameters<typeof Icon>[0]["name"] }> = {
  validation: { eyebrow: "Evidence over assumption", title: "Validation", description: "Trace build, lint, tests, changed files, and specification criteria into a completion decision.", phase: "Recommended next milestone · not started", icon: "validation" }
};

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
    if (state?.activeSection !== "intelligence") return;
    const controller = new AbortController();
    void bridge.request("intelligence/overview", {}, { signal: controller.signal }).then(setOverview).catch((cause: unknown) => {
      if (!(cause instanceof DOMException && cause.name === "AbortError")) setError(cause instanceof Error ? cause.message : String(cause));
    });
    return () => controller.abort();
  }, [bridge, state?.activeSection]);

  const activeSection = state?.activeSection ?? "home";
  const intentActive = ["intent", "specifications"].includes(activeSection);
  const tasksActive = ["tasks", "context"].includes(activeSection);
  const implementationProgress = useMemo(() => bootstrap ? `${bootstrap.implementation.completedTasks.length} milestone capabilities complete` : "Connecting to Extension Host", [bootstrap]);

  const navigate = (section: NavigationSection): void => {
    if (state) setState({ ...state, activeSection: section });
    void bridge.request("navigation/set", { section }).catch((cause: unknown) => setError(cause instanceof Error ? cause.message : String(cause)));
  };

  return (
    <div className="app-shell">
      <header className="brand-bar">
        <div className="brand-mark" aria-hidden="true"><span/><span/><span/></div>
        <div className="brand-copy"><strong>Keystone</strong><span>Engineering control center</span></div>
        <span className="version-pill">v{bootstrap?.extensionVersion ?? "—"}</span>
      </header>

      <nav className="navigation" aria-label="Keystone sections">
        {navigation.map((item) => (
          <button key={item.id} className={activeSection === item.id || (item.id === "intent" && intentActive) || (item.id === "tasks" && tasksActive) ? "nav-item active" : "nav-item"} onClick={() => navigate(item.id)} aria-current={activeSection === item.id || (item.id === "intent" && intentActive) || (item.id === "tasks" && tasksActive) ? "page" : undefined}>
            <Icon name={item.icon}/><span>{item.label}</span>
          </button>
        ))}
      </nav>

      <main className="main-content">
        {error && <div className="error-banner" role="alert"><span>{error}</span><button onClick={() => setError(undefined)} aria-label="Dismiss error">×</button></div>}
        {!bootstrap ? <LoadingView/> : activeSection === "home" ? <Home bootstrap={bootstrap} onNavigate={navigate}/> : activeSection === "settings" ? <Settings bridge={bridge}/> : activeSection === "intelligence" ? (
          <IntelligenceOverview
            bridge={bridge}
            overview={overview}
            onStart={() => { void bridge.request("intelligence/scan/start", {}).catch(showError(setError)); }}
            onCancel={() => { void bridge.request("intelligence/scan/cancel", {}).catch(showError(setError)); }}
            onPause={() => { void bridge.request("intelligence/runtime/pause", {}).catch(showError(setError)); }}
            onResume={() => { void bridge.request("intelligence/runtime/resume", {}).catch(showError(setError)); }}
            onRefresh={() => { void bridge.request("intelligence/overview", {}).then(setOverview).catch(showError(setError)); }}
          />
        ) : activeSection === "intent" || activeSection === "specifications" || activeSection === "tasks" || activeSection === "context" ? <><nav className="orchestration-tabs" aria-label="Development workflow views">{(["intent", "specifications", "tasks", "context"] as const).map((section) => <button key={section} className={activeSection === section ? "active" : ""} onClick={() => navigate(section)}>{section === "specifications" ? "Specification" : section[0]!.toUpperCase() + section.slice(1)}</button>)}</nav><DevelopmentWorkspace bridge={bridge} section={activeSection}/></> : activeSection === "validation" ? <ExecutionValidationWorkspace bridge={bridge}/> : activeSection === "delivery" ? <DeliveryWorkspace bridge={bridge}/> : activeSection === "team" ? <TeamWorkflowWorkspace bridge={bridge}/> : activeSection === "orchestration" ? <OrchestrationWorkspace bridge={bridge}/> : activeSection === "diagnostics" ? <Diagnostics bootstrap={bootstrap} overview={overview} activity={activity}/> : <PlannedSection section={sections.validation}/>}
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

function Home({ bootstrap, onNavigate }: { bootstrap: BootstrapSnapshot; onNavigate: (section: NavigationSection) => void }): React.JSX.Element {
  return (
    <section className="page home-page">
      <div className="hero">
        <div className="eyebrow"><Icon name="spark" size={14}/> Phase {bootstrap.implementation.phase} is operational</div>
        <h1>Intent becomes<br/><em>controlled work.</em></h1>
        <p>Keystone maintains a local, evidence-backed repository inventory with restart-safe storage and a bounded overview.</p>
        <button className="primary-button" onClick={() => onNavigate("intelligence")}>View intelligence <Icon name="arrow" size={16}/></button>
      </div>

      <div className="status-grid">
        <article className="status-card repository-card">
          <div className="card-heading"><span className="card-icon"><Icon name="repo"/></span><span><small>WORKSPACE</small><strong>{bootstrap.workspace.name}</strong></span></div>
          <dl>
            <div><dt>Roots</dt><dd>{bootstrap.workspace.rootCount}</dd></div>
            <div><dt>Trust</dt><dd className="good">{bootstrap.workspace.trust}</dd></div>
            <div><dt>Index</dt><dd>{bootstrap.workspace.indexStatus.replace("-", " ")}</dd></div>
          </dl>
        </article>

        <article className="status-card phase-card">
          <div className="phase-number">01</div>
          <small>CURRENT MILESTONE</small>
          <h2>{bootstrap.implementation.phaseName}</h2>
          <ul>{bootstrap.implementation.completedTasks.slice(0, 4).map((task) => <li key={task}><Icon name="check" size={14}/>{task}</li>)}</ul>
        </article>

        <article className="status-card privacy-card">
          <div className="card-heading"><span className="card-icon"><Icon name="lock"/></span><span><small>PRIVACY BASELINE</small><strong>Local by default</strong></span></div>
          <p>Canonical intelligence stays in extension-managed local files. Only an explicitly reviewed and approved task prompt may be handed to Copilot.</p>
        </article>
      </div>

      <div className="next-step">
        <span className="step-line"/>
        <div><small>NEXT ON THE APPROVED PLAN</small><strong>{bootstrap.implementation.nextTask}</strong></div>
        <button className="ghost-button" onClick={() => onNavigate("intelligence")}>Explore</button>
      </div>
    </section>
  );
}

function showError(setError: (message: string) => void): (cause: unknown) => void {
  return (cause) => setError(cause instanceof Error ? cause.message : String(cause));
}

function PlannedSection({ section }: { section: (typeof sections)[keyof typeof sections] }): React.JSX.Element {
  return (
    <section className="page planned-page">
      <div className="planned-visual"><span className="orbit one"/><span className="orbit two"/><span className="planned-icon"><Icon name={section.icon} size={28}/></span></div>
      <div className="eyebrow">{section.eyebrow}</div>
      <h1>{section.title}</h1>
      <p>{section.description}</p>
      <div className="phase-label"><span className="phase-dot"/>{section.phase}</div>
      <div className="honesty-note"><Icon name="lock" size={15}/><span>This capability is intentionally unavailable until its approved implementation phase.</span></div>
    </section>
  );
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
