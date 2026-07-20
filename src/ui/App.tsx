import { lazy, Suspense, useEffect, useMemo, useRef, useState } from "react";
import type {
  Activity,
  AppRoute,
  BootstrapSnapshot,
  PersistedFoundationState,
} from "../shared/contracts/domain";
import { PRIMARY_NAVIGATION, sectionForRoute } from "../shared/navigation";
import type { IntelligenceOverview as IntelligenceOverviewModel } from "../shared/contracts/intelligence";
import { Icon } from "./components/Icon";
import type { HostBridge } from "./services/HostBridge";
import { HomeDashboard } from "./components/home/HomeDashboard";
import { toUiError, UiErrorState, type KeystoneUiError } from "./components/UiState";
import type {
  KeystoneInitialization,
  LaunchRecovery,
} from "../shared/contracts/nativeShell";

interface AppProps {
  bridge: HostBridge;
}

const IntelligenceOverviewRoute = lazy(async () => {
  const module = await import("./components/intelligence/IntelligenceOverview");
  return { default: module.IntelligenceOverview };
});
const ActiveWorkRoute = lazy(async () => {
  const module = await import("./components/workbench/ActiveWork");
  return { default: module.ActiveWork };
});
const WorkbenchRoute = lazy(async () => {
  const module = await import("./components/workbench/SDLCWorkbench");
  return { default: module.SDLCWorkbench };
});
const HistoryRoute = lazy(async () => {
  const module = await import("./components/history/HistoryWorkspace");
  return { default: module.HistoryWorkspace };
});

export function App({ bridge }: AppProps): React.JSX.Element {
  const [bootstrap, setBootstrap] = useState<BootstrapSnapshot>();
  const [state, setState] = useState<PersistedFoundationState>();
  const [activity, setActivity] = useState<Activity>();
  const [overview, setOverview] = useState<IntelligenceOverviewModel>();
  const [error, setError] = useState<KeystoneUiError>();
  const [recovery, setRecovery] = useState<LaunchRecovery>();
  const [intelligenceQuery, setIntelligenceQuery] = useState<string>();
  const [intelligenceEntityId, setIntelligenceEntityId] = useState<string>();
  const instanceId = useMemo(() => crypto.randomUUID(), []);
  const mainRef = useRef<HTMLElement>(null);
  const initializationRef = useRef<KeystoneInitialization | undefined>(
    undefined,
  );

  useEffect(() => {
    const unsubscribe = bridge.subscribe((message) => {
      if (message.type === "bootstrap/ready") {
        setBootstrap(message.payload);
        const route =
          initializationRef.current?.pendingNavigation?.route ??
          initializationRef.current?.restoredRoute ??
          message.payload.state.activeRoute;
        setState({
          ...message.payload.state,
          activeRoute: route,
          activeSection: sectionForRoute(route),
        });
        setActivity(message.payload.activity);
      }
      if (message.type === "state/updated") setState(message.payload);
      if (message.type === "activity/updated") setActivity(message.payload);
      if (message.type === "intelligence/updated") setOverview(message.payload);
      if (message.type === "intelligence/runtime")
        setOverview((current) =>
          current
            ? {
                ...current,
                status: message.payload.status,
                pendingUpdate: message.payload.pendingUpdate,
                runtime: message.payload,
              }
            : current,
        );
      if (message.type === "keystone/initialize") {
        initializationRef.current = message.payload;
        setRecovery(message.payload.recovery);
        setIntelligenceQuery(
          message.payload.pendingNavigation?.query ??
            message.payload.restoredContext?.intelligenceQuery,
        );
        setIntelligenceEntityId(
          message.payload.pendingNavigation?.entityId ??
            message.payload.restoredContext?.entityId,
        );
        const route =
          message.payload.pendingNavigation?.route ??
          message.payload.restoredRoute;
        setState((current) =>
          current
            ? {
                ...current,
                activeRoute: route,
                activeSection: sectionForRoute(route),
              }
            : current,
        );
        void bridge
          .request("keystone/initializationAcknowledged", { instanceId, route })
          .catch(showError(setError));
      }
      if (message.type === "keystone/navigationRequest") {
        setRecovery(message.payload.recovery);
        setIntelligenceQuery(message.payload.query);
        setIntelligenceEntityId(message.payload.entityId);
        setState((current) =>
          current
            ? {
                ...current,
                activeRoute: message.payload.route,
                activeSection: sectionForRoute(message.payload.route),
              }
            : current,
        );
        window.history.pushState({ route: message.payload.route }, "", "");
        void bridge
          .request("keystone/navigationAcknowledged", {
            instanceId,
            sequence: message.payload.sequence,
            route: message.payload.route,
          })
          .catch(showError(setError));
        if (message.payload.request.destination.type === "import-handoff")
          void bridge
            .request("handoff/import", { source: "file" })
            .catch(showError(setError));
        window.setTimeout(() => mainRef.current?.focus(), 0);
      }
    });
    void bridge
      .request("keystone/webviewReady", { instanceId, protocolVersion: 1 })
      .then((value) => {
        initializationRef.current = value;
        setRecovery(value.recovery);
        setIntelligenceQuery(
          value.pendingNavigation?.query ??
            value.restoredContext?.intelligenceQuery,
        );
        setIntelligenceEntityId(
          value.pendingNavigation?.entityId ?? value.restoredContext?.entityId,
        );
        const route = value.pendingNavigation?.route ?? value.restoredRoute;
        setState((current) =>
          current
            ? {
                ...current,
                activeRoute: route,
                activeSection: sectionForRoute(route),
              }
            : current,
        );
        void bridge
          .request("keystone/initializationAcknowledged", { instanceId, route })
          .catch(showError(setError));
      })
      .catch(showError(setError));
    void bridge
      .request("app/bootstrap", {})
      .catch(showError(setError));
    return unsubscribe;
  }, [bridge, instanceId]);

  useEffect(() => {
    const pop = (event: PopStateEvent): void => {
      const historyState: unknown = event.state;
      const route =
        historyState &&
        typeof historyState === "object" &&
        "route" in historyState &&
        typeof historyState.route === "string"
          ? historyState.route
          : "/";
      setState((current) =>
        current
          ? {
              ...current,
              activeRoute: route,
              activeSection: sectionForRoute(route),
            }
          : current,
      );
      void bridge
        .request("keystone/webviewStateChanged", { route })
        .catch(showError(setError));
    };
    window.addEventListener("popstate", pop);
    return () => window.removeEventListener("popstate", pop);
  }, [bridge]);

  useEffect(() => {
    if (!["/", "/intelligence"].includes(state?.activeRoute ?? "")) return;
    const controller = new AbortController();
    void bridge
      .request("intelligence/overview", {}, { signal: controller.signal })
      .then((value) => {
        if (value) setOverview(value);
      })
      .catch((cause: unknown) => {
        if (!(cause instanceof DOMException && cause.name === "AbortError"))
          showError(setError)(cause);
      });
    return () => controller.abort();
  }, [bridge, state?.activeRoute]);

  const activeRoute = state?.activeRoute ?? "/";
  const implementationProgress = useMemo(
    () =>
      bootstrap
        ? `${bootstrap.implementation.completedTasks.length} milestone capabilities complete`
        : "Connecting to Extension Host",
    [bootstrap],
  );

  const navigate = (route: AppRoute): void => {
    if (state)
      setState({
        ...state,
        activeRoute: route,
        activeSection: sectionForRoute(route),
      });
    window.history.pushState({ route }, "", "");
    void bridge
      .request("navigation/set", { route })
      .catch(showError(setError));
    void bridge
      .request("keystone/webviewStateChanged", { route })
      .catch(showError(setError));
    window.setTimeout(() => mainRef.current?.focus(), 0);
  };

  return (
    <div className="app-shell">
      <header className="brand-bar">
        <div className="brand-mark" aria-hidden="true">
          <span />
          <span />
          <span />
        </div>
        <div className="brand-copy">
          <strong>Keystone</strong>
          <span>Engineering control center</span>
        </div>
        <div className="header-actions">
          <button
            className="ghost-button"
            onClick={() => navigate("/support/diagnostics")}
          >
            <Icon name="pulse" size={15} />
            <span>Workspace health</span>
          </button>
          <button
            className="ghost-button"
            onClick={() => navigate("/settings")}
          >
            <Icon name="settings" size={15} />
            <span>Settings</span>
          </button>
          <span className="version-pill">
            v{bootstrap?.extensionVersion ?? "—"}
          </span>
        </div>
      </header>

      <nav className="navigation" aria-label="Keystone sections">
        {PRIMARY_NAVIGATION.map((item) => {
          const active =
            item.id === "active-work"
              ? activeRoute.startsWith("/workbench/")
              : activeRoute === item.route;
          return (
            <button
              key={item.id}
              className={active ? "nav-item active" : "nav-item"}
              onClick={() => navigate(item.route)}
              aria-current={active ? "page" : undefined}
            >
              <Icon name={item.icon} />
              <span>{item.label}</span>
            </button>
          );
        })}
      </nav>

      <main className="main-content" ref={mainRef} tabIndex={-1}>
        {error && (
          <UiErrorState error={error} />
        )}
        {recovery && (
          <div className="error-banner recovery-banner" role="status">
            <span>
              <strong>{recovery.title}</strong> {recovery.message}
            </span>
            <button
              onClick={() => {
                setRecovery(undefined);
                navigate(recovery.fallbackRoute);
              }}
            >
              Continue
            </button>
          </div>
        )}
        {!bootstrap ? (
          <LoadingView />
        ) : activeRoute === "/" ? (
          <HomeDashboard
            bootstrap={bootstrap}
            overview={overview}
            bridge={bridge}
            navigate={navigate}
          />
        ) : activeRoute === "/settings" ? (
          <Settings bridge={bridge} />
        ) : activeRoute === "/intelligence" ? (
          <Suspense fallback={<RouteLoadingView label="Repository Intelligence" />}>
          <IntelligenceOverviewRoute
            bridge={bridge}
            overview={overview}
            initialQuery={intelligenceQuery}
            initialEntityId={intelligenceEntityId}
            onStart={() => {
              void bridge
                .request("intelligence/scan/start", {})
                .catch(showError(setError));
            }}
            onCancel={() => {
              void bridge
                .request("intelligence/scan/cancel", {})
                .catch(showError(setError));
            }}
            onPause={() => {
              void bridge
                .request("intelligence/runtime/pause", {})
                .catch(showError(setError));
            }}
            onResume={() => {
              void bridge
                .request("intelligence/runtime/resume", {})
                .catch(showError(setError));
            }}
            onRefresh={() => {
              void bridge
                .request("intelligence/overview", {})
                .then(setOverview)
                .catch(showError(setError));
            }}
          />
          </Suspense>
        ) : activeRoute === "/active-work" ? (
          <Suspense fallback={<RouteLoadingView label="Active Work" />}>
          <ActiveWorkRoute
            bridge={bridge}
            workflowId={undefined}
            navigate={navigate}
          />
          </Suspense>
        ) : activeRoute.startsWith("/workbench/") ? (
          <Suspense fallback={<RouteLoadingView label="SDLC Workbench" />}>
          <WorkbenchRoute
            bridge={bridge}
            route={activeRoute}
            navigate={navigate}
          />
          </Suspense>
        ) : activeRoute === "/history" ? (
          <Suspense fallback={<RouteLoadingView label="History" />}>
            <HistoryRoute bridge={bridge} navigate={navigate} />
          </Suspense>
        ) : activeRoute === "/support/diagnostics" ? (
          <Diagnostics
            bootstrap={bootstrap}
            overview={overview}
            activity={activity}
          />
        ) : (
          <HomeDashboard
            bootstrap={bootstrap}
            overview={overview}
            bridge={bridge}
            navigate={navigate}
          />
        )}
      </main>

      <aside
        className={`activity-panel ${activity?.status ?? "idle"}`}
        aria-label="Current activity"
      >
        <div className="activity-icon">
          <Icon name={activity?.status === "completed" ? "check" : "pulse"} />
        </div>
        <div className="activity-copy">
          <strong>{activity?.operation ?? "Connecting"}</strong>
          <span>{activity?.detail ?? "Restoring Keystone state…"}</span>
        </div>
        <span className="activity-meta">{implementationProgress}</span>
      </aside>
    </div>
  );
}

function Diagnostics({
  bootstrap,
  overview,
  activity,
}: {
  bootstrap: BootstrapSnapshot;
  overview?: IntelligenceOverviewModel;
  activity?: Activity;
}): React.JSX.Element {
  return (
    <section className="page settings-page">
      <div className="eyebrow">Bounded product health</div>
      <h1>Diagnostics</h1>
      <p>
        Current Extension Host, repository, Intelligence, and operation state.
        No credentials or repository source are included.
      </p>
      <div className="settings-list">
        <div>
          <span>
            <strong>Workspace trust</strong>
            <small>
              Executable and mutating actions require a trusted workspace
            </small>
          </span>
          <span className="setting-value">{bootstrap.workspace.trust}</span>
        </div>
        <div>
          <span>
            <strong>Intelligence</strong>
            <small>Canonical local generation</small>
          </span>
          <span className="setting-value">
            {overview?.status ?? bootstrap.workspace.indexStatus} · generation{" "}
            {overview?.generation ?? 0}
          </span>
        </div>
        <div>
          <span>
            <strong>Current operation</strong>
            <small>{activity?.detail ?? "No active operation"}</small>
          </span>
          <span className="setting-value">{activity?.status ?? "idle"}</span>
        </div>
        <div>
          <span>
            <strong>Persistence</strong>
            <small>
              Extension-managed files; no external database or backend
            </small>
          </span>
          <span className="setting-value">Local</span>
        </div>
      </div>
    </section>
  );
}

function LoadingView(): React.JSX.Element {
  return (
    <section className="loading-view">
      <div className="loader" />
      <p>Restoring the Keystone workspace…</p>
    </section>
  );
}

function RouteLoadingView({ label }: { label: string }): React.JSX.Element {
  return (
    <section className="loading-view" aria-live="polite" aria-busy="true">
      <div className="loader" />
      <p>Opening {label}…</p>
    </section>
  );
}

function showError(
  setError: (error: KeystoneUiError) => void,
): (cause: unknown) => void {
  return (cause) =>
    setError(toUiError(cause, {
      category: "host-request",
      title: "Keystone could not complete that action",
      fallbackMessage: "The Extension Host did not complete the request.",
      preservedState: true,
    }));
}

function Settings({ bridge }: { bridge: HostBridge }): React.JSX.Element {
  return (
    <section className="page settings-page">
      <div className="eyebrow">Extension preferences</div>
      <h1>Settings</h1>
      <p>
        Keystone settings live in VS Code so workspace and user scopes remain
        explicit.
      </p>
      <div className="settings-list">
        <div>
          <span>
            <strong>Specification approvals</strong>
            <small>Required before implementation by default</small>
          </span>
          <span className="setting-value">Required</span>
        </div>
        <div>
          <span>
            <strong>Agent selection</strong>
            <small>
              Recommend an available agent and wait for confirmation
            </small>
          </span>
          <span className="setting-value">Recommended</span>
        </div>
        <div>
          <span>
            <strong>Context budget</strong>
            <small>Maximum estimated tokens per task package</small>
          </span>
          <span className="setting-value">12,000</span>
        </div>
      </div>
      <button
        className="primary-button"
        onClick={() => {
          void bridge.request("settings/open", {});
        }}
      >
        Open VS Code settings <Icon name="arrow" size={16} />
      </button>
    </section>
  );
}
