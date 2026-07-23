import { useEffect, useRef, useState } from "react";
import type { AppRoute } from "../../../shared/contracts/domain";
import { canonicalStageOutline, canonicalWorkTypeLabel, type CanonicalWorkflowWorkType } from "../../../shared/contracts/canonicalWorkflow";
import type { HostBridge } from "../../services/HostBridge";

interface WorkDraft { intent: string; workType: CanonicalWorkflowWorkType; specification: string; step: "define" | "review"; correlationId: string; }
const DRAFT_KEY = "keystoneStartWorkDraft";

export function StartWorkDraft({ bridge, navigate }: { bridge: HostBridge; navigate: (route: AppRoute) => void }): React.JSX.Element {
  const [restored] = useState(() => readDraft(bridge));
  const [intent, setIntent] = useState(restored.intent);
  const [workType, setWorkType] = useState<CanonicalWorkflowWorkType>(restored.workType);
  const [specification, setSpecification] = useState(restored.specification);
  const [step, setStep] = useState<"define" | "review">(restored.step);
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState<string>();
  const creatingRef = useRef(false);

  useEffect(() => { persistDraft(bridge, { intent, workType, specification, step, correlationId: restored.correlationId }); }, [bridge, intent, workType, specification, step, restored.correlationId]);
  const intentError = !intent.trim() ? "Intent is required." : intent.trim().length > 10_000 ? "Intent must be 10,000 characters or fewer." : undefined;
  const specificationError = specification.trim().length > 50_000 ? "Specification must be 50,000 characters or fewer." : undefined;
  const valid = !intentError && !specificationError;

  const continueToReview = (): void => {
    if (!valid) { setError(intentError ?? specificationError); return; }
    setError(undefined); setStep("review");
  };
  const create = async (): Promise<void> => {
    if (!valid || creatingRef.current) return;
    creatingRef.current = true; setCreating(true); setError(undefined);
    try {
      const response = await bridge.request("workflow.create", {
        correlationId: restored.correlationId,
        intent: intent.trim(),
        workType,
        ...(specification.trim() ? { specification: specification.trim() } : {}),
      });
      if (response.type === "workflow.creationFailed") { setError(response.error.message); return; }
      clearDraft(bridge);
      // Make the new workflow the active canonical workflow so Active Work opens it directly.
      await bridge.request("workflow.setActiveCanonical", { workflowId: response.workflowId }).catch(() => undefined);
      navigate("/active-work");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Keystone could not create the workflow.");
    } finally {
      creatingRef.current = false; setCreating(false);
    }
  };

  if (step === "review") return <section className="page active-work-page"><div className="workflow-setup">
    <div className="eyebrow">Step 2 of 2</div><h1>Review Workflow</h1><p>Review the persisted values Keystone will create.</p>
    {error && <div className="error-banner" role="alert">{error}<details><summary>Technical details</summary><p>The Extension Host did not persist this workflow. Your setup values remain available.</p></details></div>}
    <dl className="workflow-review"><div><dt>Intent</dt><dd>{intent.trim()}</dd></div><div><dt>Work type</dt><dd>{canonicalWorkTypeLabel(workType)}</dd></div>{specification.trim() && <div><dt>Specification</dt><dd>{specification.trim()}</dd></div>}</dl>
    <section aria-labelledby="recommended-stages"><h2 id="recommended-stages">Recommended stages</h2><ol className="stage-summary-list">{canonicalStageOutline(workType).map((stage) => <li key={stage.type}>{stage.displayName}</li>)}</ol></section>
    <div className="button-row"><button className="ghost-button" disabled={creating} onClick={() => setStep("define")}>Back</button><button className="ghost-button" disabled={creating} onClick={() => navigate("/")}>Cancel</button><button className="primary-button" disabled={creating || !valid} onClick={() => void create()}>{creating ? "Creating…" : "Create Workflow"}</button></div>
  </div></section>;

  return <section className="page active-work-page"><div className="workflow-setup">
    <div className="eyebrow">Step 1 of 2</div><h1>Define Workflow</h1><p>Enter the bounded workflow setup Keystone should persist.</p>
    {error && <div className="error-banner" role="alert">{error}</div>}
    <label className="field-stack"><strong>Intent</strong><textarea aria-label="Intent" value={intent} onChange={(event) => { setIntent(event.target.value); setError(undefined); }} maxLength={10_001} aria-invalid={Boolean(intentError)} /><small>Required · maximum 10,000 characters</small>{intent.trim().length > 10_000 && <span className="field-error" role="alert">{intentError}</span>}</label>
    <label className="field-stack"><strong>Work type</strong><select aria-label="Work type" value={workType} onChange={(event) => setWorkType(event.target.value as CanonicalWorkflowWorkType)}><option value="feature">Feature</option><option value="bug-fix">Bug Fix</option><option value="refactor">Refactor</option><option value="test-work">Test Work</option><option value="investigation">Investigation</option></select></label>
    <label className="field-stack"><strong>Optional specification</strong><textarea aria-label="Optional specification" value={specification} onChange={(event) => { setSpecification(event.target.value); setError(undefined); }} maxLength={50_001} aria-invalid={Boolean(specificationError)} /><small>Optional · maximum 50,000 characters</small>{specificationError && <span className="field-error" role="alert">{specificationError}</span>}</label>
    <div className="button-row"><button className="ghost-button" onClick={() => navigate("/")}>Cancel</button><button className="primary-button" disabled={!valid} onClick={continueToReview}>Continue</button></div>
  </div></section>;
}

function readDraft(bridge: HostBridge): WorkDraft {
  const fallback: WorkDraft = { intent: "", workType: "feature", specification: "", step: "define", correlationId: crypto.randomUUID() };
  const state = bridge.getWebviewState?.();
  if (!state || typeof state !== "object" || !(DRAFT_KEY in state)) return fallback;
  const value = (state as Record<string, unknown>)[DRAFT_KEY];
  if (!value || typeof value !== "object") return fallback;
  const draft = value as Partial<WorkDraft>;
  const knownWorkTypes = new Set(["feature", "bug-fix", "refactor", "test-work", "investigation"]);
  return { intent: typeof draft.intent === "string" ? draft.intent : "", workType: knownWorkTypes.has(draft.workType ?? "") ? draft.workType! : "feature", specification: typeof draft.specification === "string" ? draft.specification : "", step: draft.step === "review" ? "review" : "define", correlationId: typeof draft.correlationId === "string" ? draft.correlationId : crypto.randomUUID() };
}

function persistDraft(bridge: HostBridge, draft: WorkDraft): void {
  const current = bridge.getWebviewState?.();
  bridge.setWebviewState?.({ ...(current && typeof current === "object" ? current : {}), [DRAFT_KEY]: draft });
}

function clearDraft(bridge: HostBridge): void {
  const current = bridge.getWebviewState?.();
  if (!current || typeof current !== "object") return;
  const next = { ...current } as Record<string, unknown>; delete next[DRAFT_KEY]; delete next.keystoneSelectedWorkflowId; bridge.setWebviewState?.(next);
}
