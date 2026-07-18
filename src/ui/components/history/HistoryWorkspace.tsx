import { useEffect, useState } from "react";
import type { DevelopmentWorkflowSnapshot } from "../../../shared/contracts/delegation";
import type { AppRoute } from "../../../shared/contracts/domain";
import { workbenchRoute } from "../../../shared/navigation";
import type { HostBridge } from "../../services/HostBridge";

export function HistoryWorkspace({ bridge, navigate }: { bridge: HostBridge; navigate: (route: AppRoute) => void }): React.JSX.Element {
  const [workflows, setWorkflows] = useState<DevelopmentWorkflowSnapshot[]>([]); const [error, setError] = useState<string>();
  useEffect(() => { void bridge.request("workflow/list", {}).then(setWorkflows).catch((cause: unknown) => setError(cause instanceof Error ? cause.message : String(cause))); }, [bridge]);
  return <section className="page"><div className="eyebrow">Durable local workflow history</div><h1>History</h1><p>Review saved workflows and resume them in the Workbench. Orchestration remains coordinating state rather than a second workflow list.</p>{error && <div className="error-banner" role="alert">{error}</div>}<div className="query-items">{workflows.map((workflow) => <article key={workflow.id}><strong>{workflow.specification?.title ?? workflow.intent.normalizedObjective}</strong><p>{workflow.status} · {workflow.tasks.length} Tasks · updated {workflow.updatedAt}</p><button className="ghost-button" onClick={() => navigate(workbenchRoute(workflow.id, workflow.tasks.length ? "build" : workflow.specification?.status === "approved" ? "plan" : "define"))}>Open workflow</button></article>)}{!workflows.length && <p>No saved workflows.</p>}</div></section>;
}
