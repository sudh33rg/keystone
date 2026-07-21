import { useEffect, useState } from "react";
import type { DevelopmentWorkflowSnapshot } from "../../../shared/contracts/delegation";
import type {
  WorkflowDefinition,
  WorkflowInstance,
  WorkflowPolicy,
} from "../../../shared/contracts/orchestration";
import type { HostBridge } from "../../services/HostBridge";

export function OrchestrationWorkspace({ bridge }: { bridge: HostBridge }): React.JSX.Element {
  const [instances, setInstances] = useState<WorkflowInstance[]>([]);
  const [workflows, setWorkflows] = useState<DevelopmentWorkflowSnapshot[]>([]);
  const [definitions, setDefinitions] = useState<WorkflowDefinition[]>([]);
  const [policies, setPolicies] = useState<WorkflowPolicy[]>([]);
  const [selected, setSelected] = useState<string>();
  const [error, setError] = useState<string>();
  const [busy, setBusy] = useState(false);
  const active = instances.find((item) => item.id === selected) ?? instances.at(-1);
  const refresh = async (): Promise<void> => {
    const [next, sources, defs, policy] = await Promise.all([
      bridge.request("orchestration/list", {}),
      bridge.request("workflow/list", {}),
      bridge.request("orchestration/definitions", {}),
      bridge.request("orchestration/policies", {}),
    ]);
    setInstances(next);
    setWorkflows(sources);
    setDefinitions(defs);
    setPolicies(policy);
    if (!selected && next.length) setSelected(next.at(-1)!.id);
  };
  useEffect(() => {
    void Promise.all([
      bridge.request("orchestration/list", {}),
      bridge.request("workflow/list", {}),
      bridge.request("orchestration/definitions", {}),
      bridge.request("orchestration/policies", {}),
    ])
      .then(([next, sources, defs, policy]) => {
        setInstances(next);
        setWorkflows(sources);
        setDefinitions(defs);
        setPolicies(policy);
        if (next.length) setSelected(next.at(-1)!.id);
      })
      .catch(show(setError));
  }, [bridge]);
  const act = async (operation: () => Promise<WorkflowInstance>): Promise<void> => {
    setBusy(true);
    setError(undefined);
    try {
      const value = await operation();
      setInstances((current) => [...current.filter((item) => item.id !== value.id), value]);
      setSelected(value.id);
    } catch (cause) {
      show(setError)(cause);
    } finally {
      setBusy(false);
    }
  };
  const create = (): void => {
    const source = workflows.find(
      (item) => item.specification?.status === "approved" && item.taskGraph?.ready,
    );
    if (!source) {
      setError("Approve a specification and generate its task plan before creating orchestration.");
      return;
    }
    void act(() =>
      bridge.request("orchestration/create", { workflowId: source.id, policyProfileId: "guided" }),
    );
  };
  return (
    <section className="page orchestration-page">
      <div className="eyebrow">Milestone 14 · controlled coordination</div>
      <h1>SDLC Orchestration</h1>
      <p>
        Coordinate approved workflow state through deterministic readiness, explicit Copilot
        delegation, evidence-backed validation, and separately approved delivery.
      </p>
      {error && (
        <div className="error-banner" role="alert">
          {error}
        </div>
      )}
      <div className="orchestration-toolbar">
        <button className="primary-button" disabled={busy} onClick={create}>
          Create from approved workflow
        </button>
        <button
          className="ghost-button"
          disabled={busy}
          onClick={() => void refresh().catch(show(setError))}
        >
          Refresh
        </button>
        <select
          aria-label="Orchestration instance"
          value={active?.id ?? ""}
          onChange={(event) => setSelected(event.target.value)}
        >
          <option value="">No instance</option>
          {instances.map((item) => (
            <option key={item.id} value={item.id}>
              {item.definitionId} · {item.status}
            </option>
          ))}
        </select>
      </div>
      {!active ? (
        <div className="empty-state">
          <h2>No orchestration instance</h2>
          <p>
            {workflows.length} development workflow(s) are available. Only an approved specification
            and ready task plan can be orchestrated.
          </p>
        </div>
      ) : (
        <>
          <div className="orchestration-summary">
            <article>
              <small>STATUS</small>
              <strong>{active.status}</strong>
              <span>{active.currentStage ?? "No active stage"}</span>
            </article>
            <article>
              <small>PROGRESS</small>
              <strong>{active.progress.percentage}%</strong>
              <span>{active.progress.calculation}</span>
            </article>
            <article>
              <small>REPOSITORY</small>
              <strong>{active.branch}</strong>
              <span>Generation {active.intelligenceGeneration}</span>
            </article>
            <article>
              <small>APPROVALS</small>
              <strong>{active.progress.pendingApprovals}</strong>
              <span>pending gates</span>
            </article>
          </div>
          <div className="orchestration-actions">
            {active.status === "draft" && (
              <button
                className="primary-button"
                disabled={busy}
                onClick={() =>
                  void act(() =>
                    bridge.request("orchestration/plan", { orchestrationId: active.id }),
                  )
                }
              >
                Generate plan
              </button>
            )}
            {active.status === "ready" && (
              <button
                className="primary-button"
                disabled={busy}
                onClick={() =>
                  void act(() =>
                    bridge.request("orchestration/start", { orchestrationId: active.id }),
                  )
                }
              >
                Start guided workflow
              </button>
            )}
            {active.status === "running" && (
              <button
                className="ghost-button"
                disabled={busy}
                onClick={() =>
                  void act(() =>
                    bridge.request("orchestration/pause", { orchestrationId: active.id }),
                  )
                }
              >
                Pause
              </button>
            )}
            {!["cancelled", "completed", "completed-with-warnings", "superseded"].includes(
              active.status,
            ) && (
              <button
                className="ghost-button"
                disabled={busy}
                onClick={() =>
                  void act(() =>
                    bridge.request("orchestration/cancel", { orchestrationId: active.id }),
                  )
                }
              >
                Cancel
              </button>
            )}
          </div>
          <nav className="orchestration-tabs" aria-label="Orchestration views">
            {[
              "Overview",
              "Plan",
              "Task Graph",
              "Active Work",
              "QA",
              "Security",
              "Performance",
              "Validation",
              "Findings",
              "Approvals",
              "Delivery",
              "History",
              "Diagnostics",
              "Settings",
            ].map((label) => (
              <span key={label}>{label}</span>
            ))}
          </nav>
          <div className="orchestration-grid">
            <article>
              <h2>Plan and stages</h2>
              {active.plan ? (
                <ol>
                  {active.plan.stages.map((stage) => (
                    <li key={stage.stage} className={stage.omitted ? "muted" : ""}>
                      <strong>{stage.stage}</strong>
                      <span>
                        {stage.omitted
                          ? `Omitted: ${stage.omissionReason}`
                          : stage.optional
                            ? "Conditional"
                            : "Required"}
                      </span>
                    </li>
                  ))}
                </ol>
              ) : (
                <p>Generate and approve a plan before execution.</p>
              )}
            </article>
            <article>
              <h2>Task graph</h2>
              <div role="list" aria-label="Accessible orchestration task graph">
                {active.taskStates.map((task) => (
                  <div role="listitem" className="orchestration-task" key={task.taskId}>
                    <strong>{task.title}</strong>
                    <span>
                      {task.status} · {task.route} · {task.risk} risk
                    </span>
                    <small>
                      {task.dependencies.length
                        ? `Depends on ${task.dependencies.length} task(s)`
                        : "No dependencies"}
                    </small>
                  </div>
                ))}
              </div>
            </article>
          </div>
          <div className="orchestration-grid">
            <article>
              <h2>Pending approvals</h2>
              {active.approvalGates
                .filter((gate) => gate.status === "pending")
                .map((gate) => (
                  <div className="approval-card" key={gate.id}>
                    <strong>{gate.kind}</strong>
                    <p>{gate.requestedAction}</p>
                    <small>{gate.risks.join(" ")}</small>
                    <button
                      disabled={busy}
                      onClick={() =>
                        void act(() =>
                          bridge.request("orchestration/approve", {
                            orchestrationId: active.id,
                            gateId: gate.id,
                            decision: "approved",
                            reason: "Approved in the Orchestration workspace",
                            riskAcknowledged: false,
                          }),
                        )
                      }
                    >
                      Approve
                    </button>
                    <button
                      disabled={busy}
                      onClick={() =>
                        void act(() =>
                          bridge.request("orchestration/reject", {
                            orchestrationId: active.id,
                            gateId: gate.id,
                            decision: "rejected",
                            reason: "Rejected in the Orchestration workspace",
                            riskAcknowledged: false,
                          }),
                        )
                      }
                    >
                      Reject
                    </button>
                  </div>
                ))}
              {!active.approvalGates.some((gate) => gate.status === "pending") && (
                <p>No pending approvals.</p>
              )}
            </article>
            <article>
              <h2>Findings and diagnostics</h2>
              {active.findings.map((finding) => (
                <p key={finding.id}>
                  {finding.severity} · {finding.category}: {finding.message}
                </p>
              ))}
              {active.diagnostics.map((diagnostic, index) => (
                <p key={`${diagnostic.code}-${index}`}>
                  {diagnostic.severity}: {diagnostic.message}
                </p>
              ))}
              {!active.findings.length && !active.diagnostics.length && (
                <p>No findings or diagnostics.</p>
              )}
            </article>
          </div>
          <details>
            <summary>Definitions and policies</summary>
            <p>{definitions.map((item) => item.name).join(" · ")}</p>
            <p>{policies.map((item) => `${item.name}: ${item.executionMode}`).join(" · ")}</p>
          </details>
        </>
      )}
    </section>
  );
}
function show(setter: (value: string) => void): (cause: unknown) => void {
  return (cause) => setter(cause instanceof Error ? cause.message : String(cause));
}
