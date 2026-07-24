import { useCallback, useEffect, useState } from "react";
import type { CanonicalWorkflow } from "../../../shared/contracts/canonicalWorkflow";
import type {
  PlanPrimaryAction,
  PlanState,
  PlanTask,
  StageDelegationMode,
} from "../../../shared/contracts/stageWorkspace";
import type { HostBridge } from "../../services/HostBridge";

interface PlanStageProps {
  bridge: HostBridge;
  workflowId: string;
  onWorkflowChange: (workflow: CanonicalWorkflow) => void;
}

const PRIMARY_LABELS: Record<PlanPrimaryAction, string> = {
  "generate-context": "Generate Planning Context",
  "review-approve-context": "Review and Approve Context",
  delegate: "Delegate to Copilot",
  "capture-plan": "Capture Plan",
  "approve-plan": "Approve Plan",
  "complete-plan": "Complete Plan",
  "stage-completed": "Plan Completed",
};

function guidance(state: PlanState): string {
  switch (state.primaryAction) {
    case "generate-context": return "Generate a compressed planning context package from the approved Understand scope.";
    case "review-approve-context": return "Review the generated planning context — items, token estimates, and required facts — then approve it.";
    case "delegate": return "The planning context and configuration are valid. Review the exact prepared prompt, then delegate to Copilot.";
    case "capture-plan": return "Capture the implementation plan: the plan summary plus the proposed tasks with dependencies and acceptance criteria.";
    case "approve-plan": return "Review the captured plan and its proposed tasks, then approve it.";
    case "complete-plan": return "All requirements are satisfied. Complete Plan to mark Development ready.";
    case "stage-completed": return "Plan is complete. The Development stage is open.";
  }
}

function modeLabel(mode: StageDelegationMode): string {
  return mode === "chat-open" ? "Open Copilot Chat with prompt" : mode === "clipboard" ? "Copy prompt to clipboard" : "Manual work";
}

function delegationLabel(status: string): string {
  return ({ "chat-opened": "Copilot Chat opened", "copied-chat-opened": "Prompt copied. Copilot Chat opened.", copied: "Prompt copied", manual: "Manual work", failed: "Failed" } as Record<string, string>)[status] ?? status;
}

/** Parse the tasks textarea. Each task is a block; lines: title, then `- ` detail/criteria. */
function parseTasks(raw: string): { tasks: PlanTask[]; error?: string } {
  const trimmed = raw.trim();
  if (!trimmed) return { tasks: [] };
  try {
    const parsed = JSON.parse(trimmed) as unknown;
    if (!Array.isArray(parsed)) return { tasks: [], error: "Tasks must be a JSON array." };
    const tasks: PlanTask[] = parsed.map((entry, index) => {
      const item = entry as Record<string, unknown>;
      return {
        id: typeof item.id === "string" && item.id ? item.id : `task-${index + 1}`,
        title: typeof item.title === "string" ? item.title.slice(0, 500) : "",
        detail: typeof item.detail === "string" ? item.detail.slice(0, 4_000) : "",
        dependencies: Array.isArray(item.dependencies) ? item.dependencies.map(String).slice(0, 30) : [],
        affectedAreas: Array.isArray(item.affectedAreas) ? item.affectedAreas.map(String).slice(0, 60) : [],
        acceptanceCriteria: Array.isArray(item.acceptanceCriteria) ? item.acceptanceCriteria.map(String).slice(0, 30) : [],
        evidence: [],
      };
    }).filter((task) => task.title.trim());
    if (tasks.length === 0) return { tasks: [], error: "At least one task with a title is required." };
    return { tasks };
  } catch {
    return { tasks: [], error: "Tasks must be valid JSON (an array of { title, detail, dependencies, affectedAreas, acceptanceCriteria })." };
  }
}

export function PlanStage({ bridge, workflowId, onWorkflowChange }: PlanStageProps): React.JSX.Element {
  const [state, setState] = useState<PlanState>();
  const [busy, setBusy] = useState<string>();
  const [error, setError] = useState<{ message: string; action: string }>();
  const [planResult, setPlanResult] = useState("");
  const [tasksRaw, setTasksRaw] = useState("");
  const [validationRaw, setValidationRaw] = useState("");
  const [showCapture, setShowCapture] = useState(false);

  const perform = useCallback(
    async (label: string, operation: () => Promise<PlanState>): Promise<PlanState | undefined> => {
      setBusy(label);
      setError(undefined);
      try {
        const next = await operation();
        setState(next);
        return next;
      } catch (cause) {
        setError({ message: cause instanceof Error ? cause.message : "The plan action failed.", action: label });
        return undefined;
      } finally {
        setBusy(undefined);
      }
    },
    [],
  );

  useEffect(() => {
    queueMicrotask(() =>
      void perform("load", () => bridge.request("stage.plan.load", { workflowId })).then((loaded) => {
        if (loaded) {
          setPlanResult(loaded.planResult);
          setTasksRaw(loaded.tasks.length ? JSON.stringify(loaded.tasks.map(({ evidence: _evidence, ...rest }) => rest), null, 2) : "");
          setValidationRaw(loaded.validationExpectations.join("\n"));
        }
      }),
    );
  }, [bridge, perform, workflowId]);

  const capturePlan = useCallback(async (): Promise<void> => {
    if (!planResult.trim()) { setError({ message: "A captured plan is required.", action: "capture-plan" }); return; }
    const { tasks, error: taskError } = parseTasks(tasksRaw);
    if (taskError) { setError({ message: taskError, action: "capture-plan" }); return; }
    const validationExpectations = validationRaw.split(/\n+/).map((line) => line.trim()).filter(Boolean);
    const captured = await perform("capture-plan", () =>
      bridge.request("stage.plan.capturePlan", { workflowId, planResult, tasks, ...(validationExpectations.length ? { validationExpectations } : {}) }),
    );
    if (captured) setShowCapture(false);
  }, [bridge, perform, planResult, tasksRaw, validationRaw, workflowId]);

  const runPrimary = useCallback(async (): Promise<void> => {
    if (!state) return;
    const action = state.primaryAction;
    if (action === "generate-context") await perform("generate-context", () => bridge.request("stage.plan.generateContext", { workflowId }));
    else if (action === "review-approve-context") {
      const pkg = state.contextPackage;
      if (pkg) await perform("approve-context", () => bridge.request("stage.plan.approveContext", { workflowId, packageId: pkg.id, revision: pkg.revision }));
    } else if (action === "delegate") await perform("delegate", () => bridge.request("stage.plan.delegate", { workflowId }));
    else if (action === "capture-plan") setShowCapture(true);
    else if (action === "approve-plan") await perform("approve-plan", () => bridge.request("stage.plan.approvePlan", { workflowId }));
    else if (action === "complete-plan") {
      setBusy("complete");
      setError(undefined);
      try {
        const outcome = await bridge.request("stage.plan.complete", { workflowId });
        setState(outcome.state);
        onWorkflowChange(outcome.workflow);
      } catch (cause) {
        setError({ message: cause instanceof Error ? cause.message : "Plan could not be completed.", action: "complete" });
      } finally {
        setBusy(undefined);
      }
    }
  }, [bridge, onWorkflowChange, perform, state, workflowId]);

  if (!state)
    return (
      <section className="stage-workspace" aria-label="Plan stage">
        {error ? <div className="error-banner" role="alert"><strong>The action “{error.action}” failed.</strong> {error.message}</div> : <div className="loading-view"><div className="loader" /><p>Loading the Plan stage…</p></div>}
      </section>
    );

  const pkg = state.contextPackage;
  const readOnly = Boolean(state.completedAt);
  const primaryLabel = PRIMARY_LABELS[state.primaryAction];
  const latestDelegation = state.delegations[state.delegations.length - 1];

  return (
    <section className="stage-workspace" aria-label="Plan stage">
      {error && <div className="error-banner" role="alert"><strong>The action “{error.action}” failed.</strong> {error.message} You can correct the input or retry.</div>}
      {readOnly && <div className="success-banner" role="status">Plan is completed. Development is ready.</div>}

      <div className="stage-guidance">
        <div>
          <h2>What should I do now?</h2>
          <p>{guidance(state)}</p>
        </div>
        <button className="primary-button stage-primary-action" disabled={Boolean(busy) || state.primaryAction === "stage-completed"} onClick={() => void runPrimary()}>
          {busy ? "Working…" : primaryLabel}
        </button>
      </div>

      <details className="stage-panel" open>
        <summary>Objective</summary>
        <p>{state.objective}</p>
      </details>

      {state.understanding.length > 0 && (
        <details className="stage-panel">
          <summary>Repository understanding ({state.understanding.length})</summary>
          <ul className="understanding-list">
            {state.understanding.map((item) => (
              <li key={item.title}><strong>{item.title}</strong> <span className={`confidence-pill ${item.confidence}`}>{item.confidence}</span><p>{item.statement}</p></li>
            ))}
          </ul>
        </details>
      )}

      <details className="stage-panel">
        <summary>Copilot configuration — {state.configuration.agentAvailable ? state.configuration.agentLabel : "Copilot unavailable"}</summary>
        <dl className="config-grid">
          <div><dt>Delegation mode</dt><dd>{modeLabel(state.configuration.mode)}</dd></div>
          <div><dt>Agent</dt><dd>{state.configuration.agentLabel}{state.configuration.agentAvailable ? "" : " (unavailable)"}</dd></div>
          <div><dt>Skill</dt><dd>{state.configuration.skill}</dd></div>
        </dl>
        <div className="capability-list">
          {state.configuration.capabilities.map((capability) => (
            <label key={capability.id} className={capability.available ? "capability" : "capability unavailable"}>
              <input type="radio" name="plan-delegation-mode" disabled={!capability.available || Boolean(busy) || readOnly} checked={state.configuration.mode === capability.id} onChange={() => void perform("set-mode", () => bridge.request("stage.plan.setConfiguration", { workflowId, mode: capability.id as StageDelegationMode }))} />
              <span><strong>{capability.label}</strong> {capability.available ? "" : "— unavailable"}<small>{capability.detail}</small></span>
            </label>
          ))}
        </div>
        <details className="instructions-block"><summary>Repository instructions ({state.configuration.instructions.length})</summary><ul>{state.configuration.instructions.map((line) => <li key={line}>{line}</li>)}</ul></details>
      </details>

      {pkg && (
        <details className="stage-panel" open={pkg.status !== "approved"}>
          <summary>Planning context package — {pkg.status === "approved" ? `Approved (revision ${pkg.revision})` : pkg.status === "stale" ? "Stale — regenerate" : `Generated (revision ${pkg.revision})`}</summary>
          <dl className="config-grid">
            <div><dt>Candidate tokens</dt><dd>{pkg.candidateTokens.toLocaleString()} ({pkg.tokenMeasurement})</dd></div>
            <div><dt>Compressed tokens</dt><dd>{pkg.compressedTokens.toLocaleString()} ({pkg.tokenMeasurement})</dd></div>
            <div><dt>Reduction</dt><dd>{pkg.reductionPercent}%</dd></div>
            <div><dt>Required facts covered</dt><dd>{pkg.requiredFacts.filter((fact) => fact.covered).length} of {pkg.requiredFacts.length}</dd></div>
          </dl>
          {pkg.requiredFacts.some((fact) => !fact.covered) && <p className="field-error">Missing facts: {pkg.requiredFacts.filter((fact) => !fact.covered).map((fact) => fact.fact).join(", ")}</p>}
          <details><summary>Included items ({pkg.items.length})</summary><ul className="context-item-list">{pkg.items.map((item) => <li key={item.id}>{item.label} <small>{item.kind} · ~{item.tokens} tokens</small></li>)}</ul></details>
          <details><summary>Package content preview</summary><pre className="prompt-preview" tabIndex={0}>{pkg.content.slice(0, 8_000)}</pre></details>
        </details>
      )}

      {state.prompt && (
        <details className="stage-panel" open={state.delegations.length === 0}>
          <summary>Prepared prompt — revision {state.prompt.revision}</summary>
          <p><small>SHA-256 {state.prompt.contentHash.slice(0, 12)}… · prepared from context revision {state.prompt.contextPackageRevision}</small></p>
          <pre className="prompt-preview" tabIndex={0}>{state.prompt.content}</pre>
        </details>
      )}

      {state.delegations.length > 0 && (
        <details className="stage-panel" open>
          <summary>Delegation — {latestDelegation ? delegationLabel(latestDelegation.status) : ""}</summary>
          <ul className="delegation-list">
            {state.delegations.map((record) => (
              <li key={record.id}>
                <strong>{delegationLabel(record.status)}</strong> <small>{new Date(record.createdAt).toLocaleString()} · {record.capabilityUsed}</small>
                <p>{record.statusDetail}</p>
                {record.failureReason && <p className="field-error">{record.failureReason}</p>}
              </li>
            ))}
          </ul>
          {!readOnly && <button className="ghost-button" disabled={Boolean(busy)} onClick={() => setShowCapture(true)}>Capture Plan…</button>}
        </details>
      )}

      {(showCapture && !readOnly) && (
        <div className="stage-panel result-form" role="form" aria-label="Capture plan">
          <h3>Capture plan</h3>
          <label className="field-stack"><strong>Plan summary</strong><textarea aria-label="Plan summary" rows={6} value={planResult} onChange={(event) => setPlanResult(event.target.value)} /></label>
          <label className="field-stack"><strong>Proposed tasks (JSON array of {"{ title, detail, dependencies, affectedAreas, acceptanceCriteria }"})</strong><textarea aria-label="Proposed tasks" rows={10} value={tasksRaw} onChange={(event) => setTasksRaw(event.target.value)} /></label>
          <label className="field-stack"><strong>Validation expectations (one per line)</strong><textarea aria-label="Validation expectations" rows={3} value={validationRaw} onChange={(event) => setValidationRaw(event.target.value)} /></label>
          <div className="button-row">
            <button className="ghost-button" onClick={() => setShowCapture(false)}>Cancel</button>
            <button className="primary-button" disabled={!planResult.trim() || Boolean(busy)} onClick={() => void capturePlan()}>Save Plan</button>
          </div>
        </div>
      )}

      {state.tasks.length > 0 && (
        <details className="stage-panel" open={!state.planApproved}>
          <summary>Proposed implementation tasks ({state.tasks.length}) — {state.planApproved ? "Approved" : "Awaiting approval"}</summary>
          <ol className="plan-task-list">
            {state.tasks.map((task) => (
              <li key={task.id}>
                <strong>{task.title}</strong>
                {task.detail && <p>{task.detail}</p>}
                {task.dependencies.length > 0 && <small>Depends on: {task.dependencies.join(", ")}</small>}
                {task.affectedAreas.length > 0 && <p><small>Affected: {task.affectedAreas.join(", ")}</small></p>}
                {task.acceptanceCriteria.length > 0 && <ul>{task.acceptanceCriteria.map((c) => <li key={c}>{c}</li>)}</ul>}
              </li>
            ))}
          </ol>
          {state.validationExpectations.length > 0 && <p><small>Validation: {state.validationExpectations.join("; ")}</small></p>}
          {!readOnly && !state.completedAt && <button className="ghost-button" disabled={Boolean(busy)} onClick={() => { setShowCapture(true); }}>Edit Plan</button>}
        </details>
      )}

      {!state.completion.allowed && state.completion.unmet.length > 0 && (
        <details className="stage-panel"><summary>Remaining before completion ({state.completion.unmet.length})</summary><ul>{state.completion.unmet.map((item) => <li key={item}>{item}</li>)}</ul></details>
      )}
    </section>
  );
}
