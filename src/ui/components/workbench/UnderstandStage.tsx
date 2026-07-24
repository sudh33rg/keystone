import { useCallback, useEffect, useRef, useState } from "react";
import type { CanonicalWorkflow } from "../../../shared/contracts/canonicalWorkflow";
import type {
  StageDelegationMode,
  StageResultSource,
  UnderstandPrimaryAction,
  UnderstandState,
} from "../../../shared/contracts/stageWorkspace";
import type { HostBridge } from "../../services/HostBridge";

interface UnderstandStageProps {
  bridge: HostBridge;
  workflowId: string;
  onWorkflowChange: (workflow: CanonicalWorkflow) => void;
}

const PRIMARY_LABELS: Record<UnderstandPrimaryAction, string> = {
  "initialize-intelligence": "Initialize Repository Intelligence",
  "analyze-intent": "Analyze Intent",
  "approve-analysis": "Approve Analysis",
  "generate-context": "Generate Context",
  "review-approve-context": "Review and Approve Context",
  delegate: "Delegate to Copilot",
  "capture-result": "Capture Result",
  "validate-result": "Validate Result",
  "complete-stage": "Complete Understand",
  "stage-completed": "Understand Completed",
};

const VALIDATION_LABELS: Record<string, string> = {
  sufficient: "Sufficient",
  "sufficient-with-warnings": "Sufficient with Warnings",
  incomplete: "Incomplete",
  contradicted: "Contradicted by Repository Evidence",
  stale: "Stale",
};

export function UnderstandStage({ bridge, workflowId, onWorkflowChange }: UnderstandStageProps): React.JSX.Element {
  const [state, setState] = useState<UnderstandState>();
  const [busy, setBusy] = useState<string>();
  const [error, setError] = useState<{ message: string; action: string }>();
  const [resultDraft, setResultDraft] = useState({ content: "", notes: "", source: "pasted" as StageResultSource });
  const [showResultForm, setShowResultForm] = useState(false);
  const [excludeDraft, setExcludeDraft] = useState<{ itemId: string; reason: string }>();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [draftAgentId, setDraftAgentId] = useState(state?.configuration.agentId ?? "");
  const [draftSkill, setDraftSkill] = useState(state?.configuration.skill ?? "");

  const perform = useCallback(
    async (label: string, operation: () => Promise<UnderstandState>): Promise<UnderstandState | undefined> => {
      setBusy(label);
      setError(undefined);
      try {
        const next = await operation();
        setState(next);
        return next;
      } catch (cause) {
        setError({ message: cause instanceof Error ? cause.message : "The stage action failed.", action: label });
        return undefined;
      } finally {
        setBusy(undefined);
      }
    },
    [],
  );

  useEffect(() => {
    queueMicrotask(() => void perform("load", () => bridge.request("stage.understand.load", { workflowId })));
  }, [bridge, perform, workflowId]);

  useEffect(() => {
    if (state) {
      queueMicrotask(() => {
        setDraftAgentId(state.configuration.agentId);
        setDraftSkill(state.configuration.skill);
      });
    }
  }, [state?.configuration.agentId, state?.configuration.skill]);

  const runPrimary = useCallback(async (): Promise<void> => {
    if (!state) return;
    const action = state.primaryAction;
    if (action === "initialize-intelligence") await perform("initialize", () => bridge.request("stage.understand.initializeIntelligence", { workflowId }));
    else if (action === "analyze-intent") await perform("analyze", () => bridge.request("stage.understand.analyzeIntent", { workflowId }));
    else if (action === "approve-analysis") await perform("approve-analysis", () => bridge.request("stage.understand.approveAnalysis", { workflowId }));
    else if (action === "generate-context") await perform("generate-context", () => bridge.request("stage.understand.generateContext", { workflowId }));
    else if (action === "review-approve-context") {
      const pkg = state.contextPackage;
      if (pkg) await perform("approve-context", () => bridge.request("stage.understand.approveContext", { workflowId, packageId: pkg.id, revision: pkg.revision }));
    } else if (action === "delegate") await perform("delegate", () => bridge.request("stage.understand.delegate", { workflowId }));
    else if (action === "capture-result") setShowResultForm(true);
    else if (action === "validate-result") await perform("validate", () => bridge.request("stage.understand.validateResult", { workflowId }));
    else if (action === "complete-stage") {
      setBusy("complete");
      setError(undefined);
      try {
        const outcome = await bridge.request("stage.understand.complete", { workflowId });
        setState(outcome.state);
        onWorkflowChange(outcome.workflow);
      } catch (cause) {
        setError({ message: cause instanceof Error ? cause.message : "Understand could not be completed.", action: "complete" });
      } finally {
        setBusy(undefined);
      }
    }
  }, [bridge, onWorkflowChange, perform, state, workflowId]);

  const captureResult = useCallback(async (): Promise<void> => {
    if (!resultDraft.content.trim()) {
      setError({ message: "Result content is required.", action: "capture-result" });
      return;
    }
    const captured = await perform("capture-result", () =>
      bridge.request("stage.understand.captureResult", {
        workflowId,
        source: resultDraft.source,
        content: resultDraft.content,
        ...(resultDraft.notes.trim() ? { notes: resultDraft.notes } : {}),
      }),
    );
    if (captured) {
      setShowResultForm(false);
      setResultDraft({ content: "", notes: "", source: "pasted" });
    }
  }, [bridge, perform, resultDraft, workflowId]);

  const importFile = useCallback((file: File): void => {
    const reader = new FileReader();
    reader.onload = () => {
      setResultDraft((draft) => ({ ...draft, content: typeof reader.result === "string" ? reader.result.slice(0, 500_000) : draft.content, source: "file-import" }));
      setShowResultForm(true);
    };
    reader.onerror = () => setError({ message: "The selected file could not be read.", action: "file-import" });
    reader.readAsText(file);
  }, []);

  if (!state)
    return (
      <section className="stage-workspace" aria-label="Understand stage">
        {error ? <StageError error={error} /> : <div className="loading-view"><div className="loader" /><p>Loading the Understand stage…</p></div>}
      </section>
    );

  const analysis = state.analysis;
  const pkg = state.contextPackage;
  const primaryLabel = PRIMARY_LABELS[state.primaryAction];
  const primaryDisabled = Boolean(busy) || state.primaryAction === "stage-completed";
  const latestDelegation = state.delegations[state.delegations.length - 1];

  return (
    <section className="stage-workspace" aria-label="Understand stage">
      {error && <StageError error={error} />}
      {state.completedAt && <div className="success-banner" role="status">Understand is completed. This record is read-only.</div>}

      <div className="stage-guidance">
        <div>
          <h2>What should I do now?</h2>
          <p>{guidance(state)}</p>
        </div>
        <button className="primary-button stage-primary-action" disabled={primaryDisabled} onClick={() => void runPrimary()}>
          {busy ? "Working…" : primaryLabel}
        </button>
      </div>

      <details className="stage-panel" open={state.intelligence.status !== "ready"}>
        <summary>Repository Intelligence — {state.intelligence.status === "ready" ? "Ready" : "Not available"}</summary>
        <p>{state.intelligence.message}</p>
      </details>

      {analysis && (
        <>
          <details className="stage-panel" open={!analysis.approved}>
            <summary>Repository understanding — {analysis.approved ? "Approved" : "Awaiting approval"}</summary>
            <p className="objective-line"><strong>Interpreted objective:</strong> {analysis.objective}</p>
            <ul className="understanding-list">
              {analysis.sections.map((item) => (
                <li key={item.title}>
                  <strong>{item.title}</strong> <span className={`confidence-pill ${item.confidence}`}>{item.confidence}</span>
                  <p>{item.statement}</p>
                  {item.evidence.length > 0 && (
                    <span className="evidence-links">
                      {item.evidence.map((evidence) => (
                        <button key={`${item.title}-${evidence.reference}`} className="link-button" onClick={() => void bridge.request("intelligence/source/open", { relativePath: evidence.reference }).catch((cause: unknown) => setError({ message: cause instanceof Error ? cause.message : "The source could not be opened.", action: "open-source" }))}>
                          {evidence.label}
                        </button>
                      ))}
                    </span>
                  )}
                </li>
              ))}
            </ul>
            {analysis.ambiguities.length > 0 && (
              <div className="ambiguity-list">
                <strong>Unresolved ambiguities</strong>
                <ul>
                  {analysis.ambiguities.map((item) => (
                    <li key={item.id}>
                      {item.text} {item.resolved ? <em>Resolved: {item.resolution}</em> : (
                        <AmbiguityResolver disabled={Boolean(busy)} onResolve={(resolution) => void perform("resolve-ambiguity", () => bridge.request("stage.understand.resolveAmbiguity", { workflowId, ambiguityId: item.id, resolution }))} />
                      )}
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </details>

          <details className="stage-panel">
            <summary>Relevant repository scope — {analysis.scope.filter((item) => item.included).length} items selected</summary>
            <ul className="scope-list">
              {analysis.scope.map((item) => (
                <li key={item.id} className={item.included ? undefined : "unavailable"}>
                  <div>
                    <strong>{item.label}</strong>
                    <small>{item.kind} · {item.confidence}{item.included ? "" : ` · excluded — ${item.exclusionReason ?? ""}`}</small>
                  </div>
                  <div className="button-row">
                    <button className="ghost-button" onClick={() => void bridge.request("intelligence/source/open", { relativePath: item.reference }).catch((cause: unknown) => setError({ message: cause instanceof Error ? cause.message : "The source could not be opened.", action: "open-source" }))}>Open Source</button>
                    {item.included ? (
                      excludeDraft?.itemId === item.id ? (
                        <span className="exclude-form">
                          <input aria-label={`Exclusion reason for ${item.label}`} placeholder="Reason" value={excludeDraft.reason} onChange={(event) => setExcludeDraft({ itemId: item.id, reason: event.target.value })} />
                          <button className="ghost-button danger" disabled={Boolean(busy)} onClick={() => { void perform("exclude-scope", () => bridge.request("stage.understand.setScopeItem", { workflowId, itemId: item.id, included: false, ...(excludeDraft.reason.trim() ? { reason: excludeDraft.reason } : {}) })); setExcludeDraft(undefined); }}>Exclude</button>
                          <button className="ghost-button" onClick={() => setExcludeDraft(undefined)}>Cancel</button>
                        </span>
                      ) : (
                        <button className="ghost-button" disabled={Boolean(busy)} onClick={() => setExcludeDraft({ itemId: item.id, reason: "" })}>Exclude…</button>
                      )
                    ) : (
                      <button className="ghost-button" disabled={Boolean(busy)} onClick={() => void perform("include-scope", () => bridge.request("stage.understand.setScopeItem", { workflowId, itemId: item.id, included: true }))}>Include</button>
                    )}
                  </div>
                </li>
              ))}
            </ul>
          </details>
        </>
      )}

      <details className="stage-panel">
        <summary>Copilot configuration — {state.configuration.agentAvailable ? state.configuration.agentLabel : "Copilot unavailable"}</summary>
        {state.configuration.discoveryNotice && <p className="warning-line" role="status">{state.configuration.discoveryNotice}</p>}
        <dl className="config-grid">
          <div><dt>Delegation mode</dt><dd>{modeLabel(state.configuration.mode)}</dd></div>
          <div><dt>Agent</dt><dd>{state.configuration.agentLabel}{state.configuration.agentAvailable ? "" : " (unavailable)"}</dd></div>
          <div><dt>Skill</dt><dd>{state.configuration.skill}</dd></div>
        </dl>
        <div className="capability-list">
          {state.configuration.capabilities.map((capability) => (
            <label key={capability.id} className={capability.available ? "capability" : "capability unavailable"}>
              <input type="radio" name="delegation-mode" disabled={!capability.available || Boolean(busy)} checked={state.configuration.mode === capability.id} onChange={() => void perform("set-mode", () => bridge.request("stage.understand.setConfiguration", { workflowId, mode: capability.id as StageDelegationMode }))} />
              <span><strong>{capability.label}</strong> {capability.available ? "" : "— unavailable"}<small>{capability.detail}</small></span>
            </label>
          ))}
        </div>

        <fieldset className="exec-config" disabled={Boolean(busy)}>
          <legend>Execution configuration</legend>
          <div className="field">
            <label htmlFor="understand-agent">Agent (discovered or manual)</label>
            <select
              id="understand-agent"
              value={draftAgentId}
              onChange={(event) => setDraftAgentId(event.target.value)}
            >
              <option value="">— none selected —</option>
              {state.configuration.agentOptions.map((agent) => {
                const a = agent as { id: string; displayName?: string; availability?: string };
                return (
                  <option key={a.id} value={a.id}>
                    {a.displayName ?? a.id}
                    {a.availability && a.availability !== "available" ? " (unavailable)" : ""}
                  </option>
                );
              })}
            </select>
          </div>
          <div className="field">
            <label htmlFor="understand-skill">Skill</label>
            <select
              id="understand-skill"
              value={draftSkill}
              onChange={(event) => setDraftSkill(event.target.value)}
            >
              <option value="">— none selected —</option>
              {state.configuration.skillOptions.map((option) => (
                <option key={option.id} value={option.id}>{option.name}</option>
              ))}
            </select>
            {state.configuration.skillOptions.length === 0 && (
              <small className="field-hint">No skills available for this stage.</small>
            )}
          </div>
        </fieldset>

        {state.configuration.conflicts.length > 0 && (
          <div className="conflict-list" role="status">
            <strong>Instruction conflicts</strong>
            <ul>
              {state.configuration.conflicts.map((conflict) => (
                <li key={conflict.id} className={`conflict-${conflict.severity}`}>
                  <span className="conflict-category">{conflict.category}</span> — {conflict.recommendedResolution}
                  {conflict.state === "conflict" || conflict.severity === "error" ? " (blocking)" : ""}
                </li>
              ))}
            </ul>
          </div>
        )}

        <details className="instructions-block">
          <summary>Repository instructions ({state.configuration.instructions.length})</summary>
          <ul>{state.configuration.instructions.map((line) => <li key={line}>{line}</li>)}</ul>
        </details>

        <div className="button-row">
          <button
            className="primary-button"
            disabled={Boolean(busy) || (draftAgentId === state.configuration.agentId && draftSkill === state.configuration.skill)}
            onClick={() => void perform("save-config", () => bridge.request("stage.understand.setConfiguration", { workflowId, agentId: draftAgentId, skill: draftSkill }))}
          >
            Save execution configuration
          </button>
        </div>
      </details>

      {pkg && (
        <details className="stage-panel" open={pkg.status !== "approved"}>
          <summary>Context package — {pkg.status === "approved" ? `Approved (revision ${pkg.revision})` : pkg.status === "stale" ? "Stale — regenerate" : `Generated (revision ${pkg.revision})`}</summary>
          <dl className="config-grid">
            <div><dt>Candidate tokens</dt><dd>{pkg.candidateTokens.toLocaleString()} (estimated)</dd></div>
            <div><dt>Compressed tokens</dt><dd>{pkg.compressedTokens.toLocaleString()} (estimated)</dd></div>
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
          {!state.completedAt && <button className="ghost-button" disabled={Boolean(busy)} onClick={() => setShowResultForm(true)}>Record Result…</button>}
        </details>
      )}

      {(showResultForm && !state.completedAt) && (
        <div className="stage-panel result-form" role="form" aria-label="Capture result">
          <h3>Capture result</h3>
          <label className="field-stack">
            <strong>Source</strong>
            <select aria-label="Result source" value={resultDraft.source} onChange={(event) => setResultDraft((draft) => ({ ...draft, source: event.target.value as StageResultSource }))}>
              <option value="pasted">Pasted from Copilot Chat</option>
              <option value="file-import">Imported from a text file</option>
              <option value="manual">Manual work summary</option>
            </select>
          </label>
          <div className="button-row">
            <button className="ghost-button" onClick={() => fileInputRef.current?.click()}>Import from file…</button>
            <input ref={fileInputRef} type="file" accept=".txt,.md,text/plain,text/markdown" hidden onChange={(event) => { const file = event.target.files?.[0]; if (file) importFile(file); event.target.value = ""; }} />
          </div>
          <label className="field-stack"><strong>Result content</strong><textarea aria-label="Result content" rows={10} value={resultDraft.content} onChange={(event) => setResultDraft((draft) => ({ ...draft, content: event.target.value }))} /></label>
          <label className="field-stack"><strong>Notes (optional)</strong><textarea aria-label="Result notes" rows={2} value={resultDraft.notes} onChange={(event) => setResultDraft((draft) => ({ ...draft, notes: event.target.value }))} /></label>
          <div className="button-row">
            <button className="ghost-button" onClick={() => setShowResultForm(false)}>Cancel</button>
            <button className="primary-button" disabled={!resultDraft.content.trim() || Boolean(busy)} onClick={() => void captureResult()}>Save Result</button>
          </div>
        </div>
      )}

      {state.result && (
        <details className="stage-panel" open={!state.validation}>
          <summary>Captured result — {sourceLabel(state.result.source)} · {new Date(state.result.capturedAt).toLocaleString()}</summary>
          <pre className="prompt-preview" tabIndex={0}>{state.result.content.slice(0, 12_000)}</pre>
          {state.result.referencedFiles.length > 0 && <p><small>Referenced files: {state.result.referencedFiles.slice(0, 15).join(", ")}</small></p>}
          {state.result.notes && <p><small>Notes: {state.result.notes}</small></p>}
          {!state.completedAt && <button className="ghost-button" disabled={Boolean(busy)} onClick={() => { setResultDraft({ content: state.result?.content ?? "", notes: state.result?.notes ?? "", source: state.result?.source ?? "pasted" }); setShowResultForm(true); }}>Edit Result</button>}
        </details>
      )}

      {state.validation && (
        <details className="stage-panel" open>
          <summary>Validation — {VALIDATION_LABELS[state.validation.status] ?? state.validation.status}</summary>
          <p>Covered: {state.validation.coveredAreas.join(", ") || "none"}</p>
          {state.validation.missingAreas.length > 0 && <p className="field-error">Missing areas: {state.validation.missingAreas.join(", ")}</p>}
          {state.validation.warnings.map((warning) => <p key={warning} className="warning-line">{warning}</p>)}
          {state.validation.contradictions.map((item) => <p key={item.statement} className="field-error">{item.statement}</p>)}
          {state.validation.status === "sufficient-with-warnings" && !state.validation.warningsAccepted && !state.completedAt && (
            <button className="secondary-button" disabled={Boolean(busy)} onClick={() => void perform("accept-warnings", () => bridge.request("stage.understand.acceptWarnings", { workflowId }))}>Accept Warnings</button>
          )}
        </details>
      )}

      {!state.completion.allowed && state.completion.unmet.length > 0 && (
        <details className="stage-panel"><summary>Remaining before completion ({state.completion.unmet.length})</summary><ul>{state.completion.unmet.map((item) => <li key={item}>{item}</li>)}</ul></details>
      )}
    </section>
  );
}

function AmbiguityResolver({ disabled, onResolve }: { disabled: boolean; onResolve: (resolution: string) => void }): React.JSX.Element {
  const [open, setOpen] = useState(false);
  const [text, setText] = useState("");
  if (!open) return <button className="link-button" disabled={disabled} onClick={() => setOpen(true)}>Resolve…</button>;
  return (
    <span className="exclude-form">
      <input aria-label="Ambiguity resolution" placeholder="How was this resolved?" value={text} onChange={(event) => setText(event.target.value)} />
      <button className="ghost-button" disabled={disabled || !text.trim()} onClick={() => { onResolve(text.trim()); setOpen(false); }}>Save</button>
      <button className="ghost-button" onClick={() => setOpen(false)}>Cancel</button>
    </span>
  );
}

function StageError({ error }: { error: { message: string; action: string } }): React.JSX.Element {
  return (
    <div className="error-banner" role="alert">
      <strong>The action “{error.action}” failed.</strong> {error.message} You can correct the input or retry the action.
    </div>
  );
}

function guidance(state: UnderstandState): string {
  switch (state.primaryAction) {
    case "initialize-intelligence": return "Repository Intelligence has not indexed this repository. Initialize it to enable evidence-backed analysis.";
    case "analyze-intent": return "Intelligence is ready. Analyze the intent to build a repository understanding and select the relevant scope.";
    case "approve-analysis": return "Review the repository understanding and scope below, then approve the analysis.";
    case "generate-context": return "The analysis is approved. Generate a compressed context package from the selected scope.";
    case "review-approve-context": return "Review the generated context package — items, token estimates, and required facts — then approve it.";
    case "delegate": return "The context and configuration are valid. Review the exact prepared prompt, then delegate to Copilot.";
    case "capture-result": return "The prompt was handed to Copilot. Paste or import the result when it is available.";
    case "validate-result": return "A result is captured. Validate it against the stage objective.";
    case "complete-stage": return "All requirements are satisfied. Complete Understand to advance to the next stage.";
    case "stage-completed": return "Understand is complete. The next stage is open.";
  }
}

function modeLabel(mode: StageDelegationMode): string {
  return mode === "chat-open" ? "Open Copilot Chat with prompt" : mode === "clipboard" ? "Copy prompt to clipboard" : "Manual work";
}

function delegationLabel(status: string): string {
  return ({ "chat-opened": "Copilot Chat opened", "copied-chat-opened": "Prompt copied. Copilot Chat opened.", copied: "Prompt copied", manual: "Manual work", failed: "Failed" } as Record<string, string>)[status] ?? status;
}

function sourceLabel(source: StageResultSource): string {
  return ({ integration: "Returned by integration", pasted: "Pasted", "file-import": "Imported from file", manual: "Manual" } as Record<StageResultSource, string>)[source];
}
