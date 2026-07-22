import { useCallback, useEffect, useState } from "react";
import { canonicalWorkTypeLabel, type CanonicalWorkflow } from "../../../shared/contracts/canonicalWorkflow";
import type { AppRoute } from "../../../shared/contracts/domain";
import type { HostBridge } from "../../services/HostBridge";
import { EmptyState, toUiError, UiErrorState, type KeystoneUiError } from "../UiState";

export function HistoryWorkspace({ bridge, navigate }: { bridge: HostBridge; navigate: (route: AppRoute) => void }): React.JSX.Element {
  const [workflows, setWorkflows] = useState<CanonicalWorkflow[]>([]);
  const [error, setError] = useState<KeystoneUiError>();
  const [loading, setLoading] = useState(true);
  const [refreshKey, setRefreshKey] = useState(0);
  const load = useCallback(async () => {
    setLoading(true);
    try { setWorkflows(await bridge.request("workflow.listCanonical", {})); setError(undefined); }
    catch (cause) { setError(toUiError(cause, { category: "history-load", title: "History could not be loaded", fallbackMessage: "Keystone could not read persisted workflows.", retry: () => setRefreshKey((value) => value + 1), dismiss: () => setError(undefined) })); }
    finally { setLoading(false); }
  }, [bridge]);
  useEffect(() => { queueMicrotask(() => void load()); }, [load, refreshKey]);

  const open = async (workflow: CanonicalWorkflow): Promise<void> => {
    try {
      if (workflow.status === "active") await bridge.request("workflow.setActiveCanonical", { workflowId: workflow.id });
      const current = bridge.getWebviewState?.();
      bridge.setWebviewState?.({ ...(current && typeof current === "object" ? current : {}), keystoneSelectedWorkflowId: workflow.id });
      navigate("/active-work");
    } catch (cause) {
      setError(toUiError(cause, { category: "history-open", title: "Workflow could not be opened", fallbackMessage: "Keystone could not load the selected persisted workflow.", dismiss: () => setError(undefined) }));
    }
  };

  return <section className="page"><div className="eyebrow">Persisted workflows</div><h1>History</h1><p>Open real workflow records retained by Keystone.</p>
    {error && <UiErrorState error={error} />}{loading && !workflows.length && <p role="status">Loading persisted workflows…</p>}
    <div className="query-items">{workflows.map((workflow) => <article key={workflow.id}><strong>{workflow.intent.text}</strong><p>{canonicalWorkTypeLabel(workflow.intent.workType)} · {workflow.status}</p><p>Created {formatDate(workflow.createdAt)} · Updated {formatDate(workflow.updatedAt)}</p><button className="ghost-button" onClick={() => void open(workflow)}>{workflow.status === "active" ? "Resume workflow" : "Open read-only"}</button></article>)}
      {!loading && !error && !workflows.length && <EmptyState title="No workflow history yet" message="Create a workflow from Home to retain it here." action={{ id: "start", label: "Start Work", kind: "primary", run: () => navigate("/workflow/new") }} />}
    </div>
  </section>;
}

function formatDate(value: string): string { return new Date(value).toLocaleString(); }
