import { useCallback, useEffect, useState } from "react";
import type { DevelopmentWorkflowSnapshot } from "../../../shared/contracts/delegation";
import type { AppRoute } from "../../../shared/contracts/domain";
import type { WorkflowCompletionRecord } from "../../../shared/contracts/review";
import { workbenchRoute } from "../../../shared/navigation";
import type { HostBridge } from "../../services/HostBridge";
import { EmptyState, toUiError, UiErrorState, type KeystoneUiError } from "../UiState";

export function HistoryWorkspace({ bridge, navigate }: { bridge: HostBridge; navigate: (route: AppRoute) => void }): React.JSX.Element {
  const [workflows, setWorkflows] = useState<Array<{ workflow: DevelopmentWorkflowSnapshot; completion?: WorkflowCompletionRecord }>>([]);
  const [error, setError] = useState<KeystoneUiError>();
  const [loading, setLoading] = useState(true);
  const [refreshKey, setRefreshKey] = useState(0);
  const load = useCallback(async (): Promise<void> => {
    setLoading(true);
    try {
      const items = await bridge.request("workflow/list", {});
      setWorkflows(await Promise.all(items.map(async (workflow) => ({ workflow, completion: await bridge.request("complete/getReport", { workflowId: workflow.id }) }))));
      setError(undefined);
    } catch (cause) {
      setError(toUiError(cause, { category: "history-load", title: "History could not be loaded", fallbackMessage: "Keystone could not read the retained workflow reports.", retry: () => setRefreshKey((value) => value + 1), dismiss: () => setError(undefined) }));
    } finally {
      setLoading(false);
    }
  }, [bridge]);
  useEffect(() => { queueMicrotask(() => void load()); }, [load, refreshKey]);
  return <section className="page"><div className="eyebrow">Durable local workflow history</div><h1>History</h1><p>Review completion state, delivery references, warnings, and retained reports. Completion does not imply Git or a pull request.</p>
    {error && <UiErrorState error={error}/>} {loading && !workflows.length && <p role="status" aria-live="polite">Loading retained workflows…</p>}
    <div className="query-items">{workflows.map(({ workflow, completion }) => <article key={workflow.id}><strong>{workflow.specification?.title ?? workflow.intent.normalizedObjective}</strong><p>{completion ? `${completion.status} · ${completion.mode} · ${completion.completedAt}` : `${workflow.status} · ${workflow.tasks.length} tasks · updated ${workflow.updatedAt}`}</p>{completion && <><p>{completion.prUrl ? `PR ${completion.prUrl}` : completion.commitHashes.length ? `Commit ${completion.commitHashes.at(-1)}` : "No Git delivery recorded"} · {completion.remainingWarnings.length} warnings</p><details><summary>Open completion report</summary><pre className="completion-report">{completion.report}</pre></details></>}<button className="ghost-button" onClick={() => navigate(workbenchRoute(workflow.id, completion ? "complete" : workflow.tasks.length ? "build" : workflow.specification?.status === "approved" ? "plan" : "define"))}>{completion ? "Open completion" : "Open workflow"}</button></article>)}
      {!loading && !error && !workflows.length && (
        <EmptyState title="No workflow history yet" message="Start a workflow from an intent. Keystone will retain its lifecycle and completion report here." action={{ id: "start", label: "Start new work", kind: "primary", run: () => navigate("/workbench/new") }}/>
      )}
    </div>
  </section>;
}
