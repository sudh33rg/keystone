import { lazy, Suspense, useEffect, useMemo, useRef, useState } from "react";
import type {
  AppRoute,
  BootstrapSnapshot,
  PersistedFoundationState,
} from "../shared/contracts/domain";
import { PRIMARY_NAVIGATION, sectionForRoute } from "../shared/navigation";
import type { IntelligenceOverview as IntelligenceOverviewModel } from "../shared/contracts/intelligence";
import { Icon } from "./components/Icon";
import { HomeDashboard } from "./components/home/HomeDashboard";
import { StartWorkDraft } from "./components/workflow/StartWorkDraft";
import { toUiError, UiErrorState, type KeystoneUiError } from "./components/UiState";
import type { KeystoneInitialization, LaunchRecovery } from "../shared/contracts/nativeShell";

interface AppProps {
  bridge: import("./services/HostBridge").HostBridge;
}

const IntelligenceOverviewRoute = lazy(async () => {
  const module = await import("./components/intelligence/IntelligenceOverview");
  return { default: module.IntelligenceOverview };
});
const GuidedIntelligenceRoute = lazy(async () => {
  const module = await import("./components/intelligence/GuidedIntelligence");
  return { default: module.GuidedIntelligence };
});
const ActiveWorkRoute = lazy(async () => {
  const module = await import("./components/workbench/ActiveWork");
  return { default: module.ActiveWork };
});
const HistoryRoute = lazy(async () => {
  const module = await import("./components/history/HistoryWorkspace");
  return { default: module.HistoryWorkspace };
});

export function App({ bridge }: AppProps): React.JSX.Element {
  const [bootstrap, setBootstrap] = useState<BootstrapSnapshot>();
  const [state, setState] = useState<PersistedFoundationState>();
  const [overview, setOverview] = useState<IntelligenceOverviewModel>();
  const [error, setError] = useState<KeystoneUiError>();
  const [recovery, setRecovery] = useState<LaunchRecovery>();
  const [intelligenceQuery, setIntelligenceQuery] = useState<string>();
  const [intelligenceEntityId, setIntelligenceEntityId] = useState<string>();
  const instanceId = useMemo(() => crypto.randomUUID(), []);
  const mainRef = useRef<HTMLElement>(null);
  const initializationRef = useRef<KeystoneInitialization | undefined>(undefined);

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
      }
      if (message.type === "state/updated") setState(message.payload);
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
          message.payload.pendingNavigation?.entityId ?? message.payload.restoredContext?.entityId,
        );
        const route = message.payload.pendingNavigation?.route ?? message.payload.restoredRoute;
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
        window.setTimeout(() => mainRef.current?.focus(), 0);
      }
    });
    void bridge
      .request("keystone/webviewReady", { instanceId, protocolVersion: 1 })
      .then((value) => {
        initializationRef.current = value;
        setRecovery(value.recovery);
        setIntelligenceQuery(
          value.pendingNavigation?.query ?? value.restoredContext?.intelligenceQuery,
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
    void bridge.request("app/bootstrap", {}).catch(showError(setError));
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
      void bridge.request("keystone/webviewStateChanged", { route }).catch(showError(setError));
    };
    window.addEventListener("popstate", pop);
    return () => window.removeEventListener("popstate", pop);
  }, [bridge]);

  useEffect(() => {
    if (state?.activeRoute !== "/intelligence") return;
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

  const navigate = (route: AppRoute): void => {
    if (state)
      setState({
        ...state,
        activeRoute: route,
        activeSection: sectionForRoute(route),
      });
    window.history.pushState({ route }, "", "");
    void bridge.request("navigation/set", { route }).catch(showError(setError));
    void bridge.request("keystone/webviewStateChanged", { route }).catch(showError(setError));
    window.setTimeout(() => mainRef.current?.focus(), 0);
  };

  return (
    <div className="app-shell top-nav-shell">
      <header className="top-bar">
        <div className="brand-copy">
          <strong>Keystone</strong>
        </div>
        <nav className="top-navigation" aria-label="Keystone sections">
          {PRIMARY_NAVIGATION.map((item) => {
            const active =
              item.id === "active-work"
                ? activeRoute === "/active-work"
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
        <div className="header-actions">
          <button className="primary-button new-work-button" onClick={() => navigate("/workflow/new")}>
            New Work
          </button>
        </div>
      </header>

      <main className="main-content" ref={mainRef} tabIndex={-1}>
        {error && <UiErrorState error={error} />}
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
          <HomeDashboard bridge={bridge} navigate={navigate} />
        ) : activeRoute === "/workflow/new" ? (
          <StartWorkDraft bridge={bridge} navigate={navigate} />
        ) : activeRoute === "/intelligence" ? (
          <Suspense fallback={<RouteLoadingView label="Repository Intelligence" />}>
            <IntelligenceOverviewRoute
              bridge={bridge}
              overview={overview}
              initialQuery={intelligenceQuery}
              initialEntityId={intelligenceEntityId}
              onStart={() => {
                void bridge.request("intelligence/scan/start", {}).catch(showError(setError));
              }}
              onCancel={() => {
                void bridge.request("intelligence/scan/cancel", {}).catch(showError(setError));
              }}
              onPause={() => {
                void bridge.request("intelligence/runtime/pause", {}).catch(showError(setError));
              }}
              onResume={() => {
                void bridge.request("intelligence/runtime/resume", {}).catch(showError(setError));
              }}
              onRefresh={() => {
                void bridge
                  .request("intelligence/overview", {})
                  .then(setOverview)
                  .catch(showError(setError));
              }}
            />
          </Suspense>
        ) : activeRoute === "/intelligence-guided" ? (
          <Suspense fallback={<RouteLoadingView label="Guided Intelligence" />}>
            <GuidedIntelligenceRoute bridge={bridge} />
          </Suspense>
        ) : activeRoute === "/active-work" ? (
          <Suspense fallback={<RouteLoadingView label="Active Work" />}>
            <ActiveWorkRoute bridge={bridge} navigate={navigate} recovery={recovery} />
          </Suspense>
        ) : activeRoute === "/history" ? (
          <Suspense fallback={<RouteLoadingView label="History" />}>
            <HistoryRoute bridge={bridge} navigate={navigate} />
          </Suspense>
        ) : (
          <HomeDashboard bridge={bridge} navigate={navigate} />
        )}
      </main>
    </div>
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

function showError(setError: (error: KeystoneUiError) => void): (cause: unknown) => void {
  return (cause) =>
    setError(
      toUiError(cause, {
        category: "host-request",
        title: "Keystone could not complete that action",
        fallbackMessage: "The Extension Host did not complete the request.",
        preservedState: true,
      }),
    );
}
