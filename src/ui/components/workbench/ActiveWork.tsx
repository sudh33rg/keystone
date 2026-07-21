import { useCallback, useEffect, useRef, useState } from "react";
import type { DevelopmentWorkflowSnapshot, DevelopmentSpecification, DevelopmentTask } from "../../../shared/contracts/delegation";
import type { WorkflowWorkType } from "../../../shared/contracts/workflow";
import type { HostBridge } from "../services/HostBridge";
import { Icon } from "../Icon";
import { toUiError, UiErrorState, type KeystoneUiError } from "../UiState";
import type { AppRoute } from "../../../shared/contracts/domain";

// ============================================================================
// Workflow creation form (Phase 1)
// ============================================================================

function StartNewWork({
  bridge,
  navigate,
}: {
  bridge: HostBridge;
  navigate: (route: AppRoute) => void;
}): React.JSX.Element {
  const [intent, setIntent] = useState("");
  const [workType, setWorkType] = useState<WorkflowWorkType>("feature");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();

  const EXAMPLES: Record<WorkflowWorkType, string> = {
    feature: "Add order cancellation with authorization checks and audit history.",
    "bug-fix": "Orders remain in pending status when payment confirmation arrives after a retry.",
    refactoring: "Separate payment-provider logic from CheckoutService without changing behavior.",
    test: "Add regression coverage for retry ordering and duplicate payment confirmations.",
    investigation: "Determine why payment confirmation processing occasionally stalls after a retry.",
  };

  const start = async (): Promise<void> => {
    setBusy(true);
    setError(undefined);
    try {
      const workflow = await bridge.request("workflow/capture", {
        text: intent.trim(),
        mode: "guided",
        workType: workType as string,
      });
      navigate(workbenchRoute(workflow.id, "define"));
    } catch (_cause) {
      setError("Keystone could not create a workflow from your intent.");
    } finally {
      setBusy(false);
    }
  };

  const canStart = Boolean(intent.trim());

  return (
    <section className="page active-work-page">
      <div className="empty-state">
        <h1>Start new work</h1>
        <p>Describe what you want to build. Keystone will analyze the repository and create a workflow.</p>
        {error && (
          <div className="error-banner" role="alert">
            {error}
            <p>Your entered intent has not been discarded. Correct the issue and retry.</p>
          </div>
        )}
        <label className="field-stack">
          <strong>Intent</strong>
          <textarea
            aria-label="Work intent"
            value={intent}
            onChange={(event) => setIntent(event.target.value)}
            placeholder={EXAMPLES[workType]}
            maxLength={50_000}
          />
          <small>Example: {EXAMPLES[workType]}</small>
        </label>
        <label className="field-stack">
          <strong>Work type</strong>
          <select value={workType} onChange={(event) => setWorkType(event.target.value as WorkflowWorkType)}>
            <option value="feature">Feature</option>
            <option value="bug-fix">Bug Fix</option>
            <option value="refactoring">Refactoring</option>
            <option value="test">Test</option>
            <option value="investigation">Investigation</option>
          </select>
        </label>
        <button className="primary-button" disabled={busy || !canStart} onClick={() => void start()}>
          {busy ? "Starting…" : "Start workflow"}
        </button>
      </div>
    </section>
  );
}

// ============================================================================
// Development stage content (Phase 1)
// ============================================================================

function DevelopmentStageContent({
  snapshot,
  bridge,
  navigate,
}: {
  snapshot: DevelopmentWorkflowSnapshot;
  bridge: HostBridge;
  navigate: (route: AppRoute) => void;
}): React.JSX.Element {
  const intent = snapshot.intent;
  const spec = snapshot.specification;
  const tasks = snapshot.tasks;
  const sourceScope = intent.repositoryScope;

  return (
    <section className="stage-content" aria-label="Development stage">
      {/* Intent */}
      <div className="stage-objective">
        <h3>Objective</h3>
        <p><strong>Work type:</strong> {workTypeLabel(snapshot.intent.workType)}</p>
        <p><strong>Risk:</strong> {intent.risk}</p>
        <p><strong>Intent:</strong> {intent.originalText}</p>
        <p><strong>Normalized:</strong> {intent.normalizedObjective}</p>
        {intent.constraints.length > 0 && (
          <details>
            <summary>Constraints ({intent.constraints.length})</summary>
            {intent.constraints.map((c: { description: string; provenance: string }) => (
              <p key={c.description}>
                {c.description} · {c.provenance}
              </p>
            ))}
          </details>
        )}
        {intent.ambiguities.length > 0 && (
          <details>
            <summary>Ambiguities ({intent.ambiguities.length})</summary>
            {intent.ambiguities.map((a: { question: string; impact: string; blocking: boolean }) => (
              <p key={a.question}>
                <strong>Q:</strong> {a.question} · <strong>Impact:</strong> {a.impact} · <strong>Blocking:</strong> {a.blocking}
              </p>
            ))}
          </details>
        )}
      </div>

      {/* Specification */}
      {spec && (
        <div className="stage-inputs">
          <h3>Specification</h3>
          <p><strong>Revision:</strong> {spec.revision} · <strong>Status:</strong> {spec.status}</p>
          <p><strong>Objective:</strong> {spec.objective}</p>
          <details>
            <summary>Scope</summary>
            <p>
              Included: {spec.scope.included.join(", ") || "None"}
              {" · "}Excluded: {spec.scope.excluded.join(", ") || "None"}
              {" · "}Expected files: {spec.scope.expectedFiles.join(", ") || "None"}
            </p>
          </details>
          <details>
            <summary>Requirements ({spec.requirements.length})</summary>
            {spec.requirements.map((r: { id: string; description: string }) => (
              <p key={r.id}>{r.id}: {r.description}</p>
            ))}
          </details>
          <details>
            <summary>Acceptance criteria ({spec.acceptanceCriteria.length})</summary>
            {spec.acceptanceCriteria.map((c: DevelopmentSpecification["acceptanceCriteria"][number]) => (
              <p key={c.id}>
                {c.id} · {c.category ?? "behavior"} · {c.blocking === false ? "non-blocking" : "blocking"}: {c.description}
              </p>
            ))}
          </details>
          {spec.decisions.length > 0 && (
            <details>
              <summary>Decisions ({spec.decisions.length})</summary>
              {spec.decisions.map((d: DevelopmentSpecification["decisions"][number]) => (
                <p key={d.id}>
                  <strong>{d.question}</strong> → {d.resolution ?? "No resolution"}
                  {" · "}Blocking: {d.blocking}
                </p>
              ))}
            </details>
          )}
        </div>
      )}

      {/* Tasks */}
      <div className="stage-context">
        <h3>Tasks ({tasks.length})</h3>
        {tasks.length > 0 ? (
          <ul>
            {tasks.map((task: DevelopmentTask) => (
              <li key={task.id}>
                <strong>{task.title}</strong>
                <p>{task.description}</p>
                <small>
                  {task.status} · {task.category} · {task.risk ?? "medium"} risk · {(task.executionRoute ?? "repository-only") as string}
                  {task.expectedFiles.length > 0 && ` · files: ${task.expectedFiles.join(", ")}`}
                </small>
              </li>
            ))}
          </ul>
        ) : (
          <p>No tasks have been generated yet. Generate a task plan in the Plan stage.</p>
        )}
      </div>

      {/* Source Scope */}
      <div className="stage-execution">
        <h3>Source scope</h3>
        {sourceScope ? (
          <p>
            Kind: {sourceScope.kind}
            {sourceScope.kind === "paths" && sourceScope.paths.length > 0 && (
              <> · Paths: {sourceScope.paths.join(", ")}</>
            )}
          </p>
        ) : (
          <p>Entire repository.</p>
        )}
      </div>

      {/* Status */}
      <div className="stage-progress">
        <h3>Status</h3>
        <p>Workflow: {snapshot.status}</p>
        <p>
          Updated: {new Date(snapshot.updatedAt).toLocaleString()}
        </p>
      </div>

      {/* Manual result capture (Phase 1) */}
      <div className="stage-results">
        <h3>Manual result capture</h3>
        <p>
          Record the result of manual or clipboard handoff. This is a user assertion, not an inferred outcome.
        </p>
        <button
          className="ghost-button"
          onClick={() => {
            void bridge.request("execution/captureResult", {
              sessionId: "",
              mode: "manual",
              notes: "Result captured manually by user.",
            }).catch(() => {});
          }}
        >
          <Icon name="check" size={15} />
          Capture result
        </button>
      </div>

      {/* Cancellation (Phase 1) */}
      <div className="stage-controls">
        <h3>Cancel workflow</h3>
        <p>
          Cancel functionality will be available once the cancellation message is added to HostBridge.
        </p>
      </div>
    </section>
  );
}

// ============================================================================
// Helper: workbenchRoute (simple version)
// ============================================================================

function workbenchRoute(workflowId: string, stage: string): AppRoute {
  return `/workbench/${workflowId}/${stage}` as AppRoute;
}

// ============================================================================
// Main component (Phase 1)
// ============================================================================

export function ActiveWork({
  bridge,
  workflowId,
  navigate,
}: {
  bridge: HostBridge;
  workflowId?: string;
  navigate: (route: AppRoute) => void;
}): React.JSX.Element {
  const [snapshot, setSnapshot] = useState<DevelopmentWorkflowSnapshot | undefined>();
  const [error, setError] = useState<KeystoneUiError | undefined>();
  const [isLoading, setIsLoading] = useState<boolean>(true);

  const loadRef = useRef<() => void>(() => undefined);
  const load = useCallback(async (): Promise<void> => {
    setIsLoading(true);
    setError(undefined);
    try {
      let result: DevelopmentWorkflowSnapshot | undefined;
      if (workflowId) {
        result = await bridge.request("workflow/get", { workflowId });
      } else {
        // Get active workflow
        const workflows = await bridge.request("workflow/list", {});
        const activeWorkflow = workflows.find(
          (w) => ![ "completed", "cancelled" ].includes(w.status)
        );
        result = activeWorkflow ?? workflows.at(-1); // fallback to latest
      }
      if (result) {
        setSnapshot(result);
      } else {
        setSnapshot(undefined);
      }
    } catch (cause) {
      setError(
        toUiError(cause, {
          category: "active-work-load",
          title: "Active Work is temporarily unavailable",
          fallbackMessage: "Keystone could not load the current workflow.",
          retry: () => loadRef.current(),
          dismiss: () => setError(undefined),
        })
      );
    } finally {
      setIsLoading(false);
    }
  }, [bridge, workflowId]);

  useEffect(() => {
    loadRef.current = load;
    queueMicrotask(() => void load());
  }, [load]);

  if (isLoading) {
    return (
      <section className="page active-work-page">
        <div className="loading-view">
          <div className="loader" />
        </div>
      </section>
    );
  }

  if (error) {
    return <UiErrorState error={error} />;
  }

  // Empty state with workflow creation form (Phase 1)
  if (!snapshot) {
    return <StartNewWork bridge={bridge} navigate={navigate} />;
  }

  const intent = snapshot.intent;
  const spec = snapshot.specification;
  const tasks = snapshot.tasks;

  return (
    <section className="page active-work-page">
      {/* Workflow Header */}
      <div className="workflow-header">
        <div className="header-left">
          <span className="eyebrow">
            {workTypeLabel(snapshot.intent.workType)}
          </span>
          <h1>{snapshot.specification?.title ?? intent.normalizedObjective}</h1>
          <p>
            {intent.originalText.slice(0, 120)}{intent.originalText.length > 120 ? "…" : ""}
          </p>
        </div>
        <div className="header-actions">
          <button
            className="ghost-button"
            onClick={() => navigate("/intelligence")}
            title="Ask repository intelligence"
          >
            <Icon name="intelligence" size={15} />
            Ask repository
          </button>
          <button
            className="ghost-button"
            onClick={() => navigate("/support/diagnostics")}
            title="Workspace health"
          >
            <Icon name="pulse" size={15} />
            Diagnostics
          </button>
          <button
            className="ghost-button"
            onClick={() => navigate("/history")}
            title="View history"
          >
            <Icon name="check" size={15} />
            History
          </button>
        </div>
      </div>

      {/* Workflow Meta */}
      <div className="workflow-meta">
        <span className="meta-item">{snapshot.repositoryId}</span>
        <span className="meta-divider">·</span>
        <span className="meta-item">Branch {snapshot.branch ?? "unspecified"}</span>
        <span className="meta-divider">·</span>
        <span className="meta-item status-badge">
          {snapshot.status.replace("-", " ")}
        </span>
        <span className="meta-divider">·</span>
        <span className="meta-item">
          Saved {new Date(
            snapshot.updatedAt
          ).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
        </span>
      </div>

      {/* Development stage content */}
      <section className="stage-workspace">
        <div className="stage-header">
          <h2>Development</h2>
          <div className="stage-meta">
            <span>Status: {snapshot.status}</span>
          </div>
        </div>

        <DevelopmentStageContent
          snapshot={snapshot}
          bridge={bridge}
          navigate={navigate}
        />
      </section>
    </section>
  );
}

// ============================================================================
// Helper functions
// ============================================================================

function workTypeLabel(value: WorkflowWorkType | DevelopmentWorkflowSnapshot["intent"]["workType"]): string {
  const mapping: Record<string, string> = {
    feature: "Feature",
    "bug-fix": "Bug Fix",
    bug: "Bug Fix",
    refactoring: "Refactoring",
    refactor: "Refactoring",
    test: "Test",
    investigation: "Investigation",
    modernization: "Modernization",
  };
  return mapping[value as string] ?? value as string;
}
