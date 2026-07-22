import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { DevelopmentAggregate } from "../../../shared/contracts/development";
import type { CanonicalWorkflow } from "../../../shared/contracts/canonicalWorkflow";
import type { HostBridge } from "../../services/HostBridge";

export function DevelopmentStage({ bridge, workflowId, onWorkflowChange }: { bridge: HostBridge; workflowId: string; onWorkflowChange?: (workflow: CanonicalWorkflow) => void }): React.JSX.Element {
  const [state, setState] = useState<DevelopmentAggregate>();
  const [objective, setObjective] = useState("");
  const [promptNotes, setPromptNotes] = useState("");
  const [result, setResult] = useState({ summary: "", decisions: "", assumptions: "", testsRun: "", unresolvedIssues: "" });
  const [selectedChanges, setSelectedChanges] = useState<string[]>([]);
  const [excludedChanges, setExcludedChanges] = useState<Record<string, string>>({});
  const [manualChangedPath, setManualChangedPath] = useState("");
  const [noCode, setNoCode] = useState({ selected: false, explanation: "" });
  const [error, setError] = useState<{ message: string; detail: string }>();
  const [notice, setNotice] = useState<string>();
  const [busy, setBusy] = useState<string>();
  const loaded = useRef(false);

  const accept = useCallback((next: DevelopmentAggregate): void => {
    setState(next); setObjective(next.workItem.objective); onWorkflowChange?.(next.workflow);
    if (!loaded.current || next.result) {
      setResult({ summary: next.result?.summary ?? "", decisions: next.result?.decisions ?? "", assumptions: next.result?.assumptions ?? "", testsRun: next.result?.testsRun ?? "", unresolvedIssues: next.result?.unresolvedIssues ?? "" });
      setSelectedChanges(next.result?.associatedChangedFiles ?? []);
      setExcludedChanges(Object.fromEntries((next.result?.excludedChangedFiles ?? []).map((item) => [item.path, item.reason])));
      setNoCode({ selected: Boolean(next.result?.noCode), explanation: next.result?.noCode?.explanation ?? "" });
    }
    loaded.current = true; setError(undefined);
  }, [onWorkflowChange]);

  const perform = useCallback(async (label: string, operation: () => Promise<DevelopmentAggregate>, success?: string): Promise<void> => {
    setBusy(label); setError(undefined); setNotice(undefined);
    try { accept(await operation()); if (success) setNotice(success); }
    catch (cause) { setError({ message: cause instanceof Error ? cause.message : "Keystone could not update Development.", detail: cause instanceof Error ? cause.stack ?? cause.message : String(cause) }); }
    finally { setBusy(undefined); }
  }, [accept]);

  useEffect(() => { queueMicrotask(() => void perform("initialize", () => bridge.request("development.initialize", { correlationId: crypto.randomUUID(), workflowId }))); }, [bridge, perform, workflowId]);
  const dirtyObjective = state ? objective !== state.workItem.objective : false;
  const objectiveError = !objective.trim() ? "Objective is required." : objective.trim().length > 10_000 ? "Objective must be 10,000 characters or fewer." : undefined;
  const resultError = result.summary.trim() ? undefined : "Summary of work completed is required.";
  const excluded = useMemo(() => Object.entries(excludedChanges).filter(([, reason]) => reason.trim()).map(([path, reason]) => ({ path, reason: reason.trim() })), [excludedChanges]);

  if (!state) return <section className="development-workspace"><div className="loading-view"><div className="loader" /><p>Initializing Development…</p></div>{error && <DevelopmentError error={error} />}</section>;
  const ids = { workflowId, workItemId: state.workItem.id };
  return <section className="development-workspace" aria-label="Development workspace">
    {error && <DevelopmentError error={error} />}
    {notice && <div className="success-banner" role="status">{notice}</div>}
    {state.workItem.status === "completed" && <div className="success-banner" role="status">Development is completed. This persisted record is read-only.</div>}
    <fieldset className="development-controls" disabled={state.workItem.status === "completed"}>

    <section className="development-section" aria-labelledby="development-objective"><header><div><span className="eyebrow">1</span><h2 id="development-objective">Objective</h2></div><span className="status-pill">{state.workItem.status}</span></header>
      <label className="field-stack"><strong>Development objective</strong><textarea aria-label="Development objective" value={objective} aria-invalid={Boolean(objectiveError)} onChange={(event) => setObjective(event.target.value)} maxLength={10_001} />{dirtyObjective && <small className="dirty-indicator">Unsaved changes</small>}{objectiveError && <span className="field-error" role="alert">{objectiveError}</span>}</label>
      {state.workflow.specification && <div className="read-only-spec"><strong>Specification</strong><p>{state.workflow.specification.text}</p><small>Revision {state.workflow.specification.revision}</small></div>}
      <button className="primary-button" disabled={!dirtyObjective || Boolean(objectiveError) || Boolean(busy)} onClick={() => void perform("objective", () => bridge.request("development.updateObjective", { correlationId: crypto.randomUUID(), ...ids, objective }), "Objective saved.")}>Save Objective</button>
    </section>

    <section className="development-section" aria-labelledby="development-scope"><header><div><span className="eyebrow">2</span><h2 id="development-scope">Source Scope</h2></div><span>{state.scopeItems.length} selected</span></header>
      <div className="button-row"><button className="ghost-button" disabled={Boolean(busy)} onClick={() => void perform("current-file", () => bridge.request("development.addCurrentFile", { correlationId: crypto.randomUUID(), ...ids }))}>Add Current File</button><button className="ghost-button" disabled={Boolean(busy)} onClick={() => void perform("file-picker", () => bridge.request("development.addSelectedFiles", { correlationId: crypto.randomUUID(), ...ids }))}>Add File</button><button className="ghost-button" disabled={Boolean(busy)} onClick={() => void perform("selection", () => bridge.request("development.addCurrentSelection", { correlationId: crypto.randomUUID(), ...ids }))}>Add Current Selection</button></div>
      {state.scopeItems.length ? <ul className="scope-list">{state.scopeItems.map((item) => <li key={item.id} className={item.availability !== "available" ? "unavailable" : undefined}><div><strong>{item.symbol?.name ?? fileName(item.workspaceRelativePath)}</strong><span>{item.workspaceRelativePath}</span><small>{item.kind}{item.symbol ? ` · ${item.symbol.kind}` : ""} · {sourceLabel(item.source)} · {item.availability}</small></div><div className="button-row"><button className="ghost-button" onClick={() => void bridge.request("intelligence/source/open", { relativePath: item.workspaceRelativePath, ...(item.symbol?.range ? { range: { startLine: item.symbol.range.startLine, startColumn: 0, endLine: item.symbol.range.endLine, endColumn: 0 } } : {}) }).catch((cause) => setError({ message: cause instanceof Error ? cause.message : "Could not open source.", detail: String(cause) }))}>Open Source</button><button className="ghost-button danger" onClick={() => void perform("remove-scope", () => bridge.request("development.removeScopeItem", { correlationId: crypto.randomUUID(), ...ids, scopeItemId: item.id }))}>Remove</button></div></li>)}</ul> : <p className="bounded-empty">No source scope selected. Add real workspace files before preparing the prompt.</p>}
    </section>

    <section className="development-section" aria-labelledby="development-prompt"><header><div><span className="eyebrow">3</span><h2 id="development-prompt">Prompt Preparation</h2></div><span>{state.promptPreparation?.status ?? "not prepared"}</span></header>
      <label className="field-stack"><strong>Optional user notes</strong><textarea aria-label="Prompt notes" value={promptNotes} onChange={(event) => setPromptNotes(event.target.value)} maxLength={10_000} /></label>
      <button className="primary-button" disabled={!state.scopeItems.some((item) => item.availability === "available") || dirtyObjective || Boolean(busy)} onClick={() => void perform("prepare", () => bridge.request("development.preparePrompt", { correlationId: crypto.randomUUID(), ...ids, ...(promptNotes.trim() ? { notes: promptNotes.trim() } : {}) }), "Development prompt prepared.")}>Prepare Prompt</button>
      {state.promptPreparation ? <><div className="prompt-meta"><span>Preparation {shortId(state.promptPreparation.id)}</span><span>SHA-256 {state.promptPreparation.contentHash.slice(0, 12)}…</span></div><pre className="prompt-preview" tabIndex={0}>{state.promptPreparation.content}</pre></> : <p className="bounded-empty">No current prompt. Changes to the objective or source scope require preparation again.</p>}
      <div className="button-row"><button className="ghost-button" disabled={!state.promptPreparation || Boolean(busy)} onClick={() => void perform("copy", () => bridge.request("development.copyPrompt", { correlationId: crypto.randomUUID(), ...ids }), "Prompt copied. It is prepared, not executed.")}>Copy Prompt</button><button className="primary-button" disabled={state.handoff?.status !== "prepared" || Boolean(busy)} onClick={() => void perform("handoff", () => bridge.request("development.confirmHandoff", { correlationId: crypto.randomUUID(), ...ids }), "Keystone prepared and handed off the development prompt. External execution remains outside Keystone until you record the result.")}>Confirm Handed Off</button><button className="ghost-button" disabled={Boolean(busy)} onClick={() => void perform("manual", () => bridge.request("development.recordManualOrigin", { correlationId: crypto.randomUUID(), ...ids }), "Work origin recorded as manual.")}>I completed this work manually</button></div>
      {state.handoff && <p className="handoff-state">Handoff: {state.handoff.status}{state.handoff.handedOffAt ? ` · ${new Date(state.handoff.handedOffAt).toLocaleString()}` : ""}. Keystone has not marked external execution complete.</p>}
    </section>

    <section className="development-section" aria-labelledby="development-result"><header><div><span className="eyebrow">4</span><h2 id="development-result">Development Result</h2></div><span>{state.result?.reviewStatus ?? "not recorded"}</span></header>
      <label className="field-stack"><strong>Summary of work completed</strong><textarea aria-label="Summary of work completed" value={result.summary} onChange={(event) => setResult((value) => ({ ...value, summary: event.target.value }))} maxLength={20_001} />{resultError && <span className="field-error">{resultError}</span>}</label>
      <div className="result-grid">{([ ["Decisions made", "decisions"], ["Assumptions", "assumptions"], ["Tests run", "testsRun"], ["Notes or unresolved issues", "unresolvedIssues"] ] as const).map(([label, key]) => <label className="field-stack" key={key}><strong>{label}</strong><textarea aria-label={label} value={result[key]} onChange={(event) => setResult((value) => ({ ...value, [key]: event.target.value }))} maxLength={20_000} /></label>)}</div>
      <button className="primary-button" disabled={Boolean(resultError) || Boolean(busy)} onClick={() => void perform("result", async () => { await bridge.request("development.recordResult", { correlationId: crypto.randomUUID(), ...ids, summary: result.summary, ...(result.decisions.trim() ? { decisions: result.decisions } : {}), ...(result.assumptions.trim() ? { assumptions: result.assumptions } : {}), ...(result.testsRun.trim() ? { testsRun: result.testsRun } : {}), ...(result.unresolvedIssues.trim() ? { unresolvedIssues: result.unresolvedIssues } : {}) }); return bridge.request("development.load", { correlationId: crypto.randomUUID(), workflowId }); }, "Development result recorded for review.")}>Save Result</button>
    </section>

    <section className="development-section" aria-labelledby="development-changes"><header><div><span className="eyebrow">5</span><h2 id="development-changes">Changed Files</h2></div><span>{state.changeDetection.available ? `${state.changeDetection.changes.length} detected` : "unavailable"}</span></header>
      <button className="ghost-button" disabled={Boolean(busy)} onClick={() => void perform("changes", () => bridge.request("development.loadChanges", { correlationId: crypto.randomUUID(), ...ids }))}>Detect Changes</button>
      {state.changeDetection.message && <p className="bounded-empty">{state.changeDetection.message}</p>}
      {state.changeDetection.changes.length > 0 && <ul className="change-review-list">{state.changeDetection.changes.map((change) => <li key={change.path}><label><input type="checkbox" checked={selectedChanges.includes(change.path)} onChange={(event) => setSelectedChanges((items) => event.target.checked ? [...new Set([...items, change.path])] : items.filter((path) => path !== change.path))} /><strong>{change.path}</strong></label><span>{change.status}{change.staged !== undefined ? ` · ${change.staged ? "staged" : "unstaged"}` : ""}{change.inSourceScope ? " · in source scope" : ""}</span>{!selectedChanges.includes(change.path) && <label className="field-stack"><small>Exclusion reason</small><input aria-label={`Exclusion reason for ${change.path}`} value={excludedChanges[change.path] ?? ""} onChange={(event) => setExcludedChanges((items) => ({ ...items, [change.path]: event.target.value }))} /></label>}</li>)}</ul>}
      {!state.changeDetection.available && <div className="manual-change"><label className="field-stack"><strong>Select changed file manually</strong><input aria-label="Manual changed file path" placeholder="src/example.ts" value={manualChangedPath} onChange={(event) => setManualChangedPath(event.target.value)} /></label><button className="ghost-button" disabled={!manualChangedPath.trim()} onClick={() => { setSelectedChanges((items) => [...new Set([...items, manualChangedPath.trim()])]); setManualChangedPath(""); }}>Add changed path</button></div>}
      {selectedChanges.length > 0 && <ul className="selected-change-summary">{selectedChanges.map((path) => <li key={path}>{path}</li>)}</ul>}
      <label className="check-row"><input type="checkbox" checked={noCode.selected} onChange={(event) => setNoCode((value) => ({ ...value, selected: event.target.checked }))} />This work produced no code changes.</label>
      {noCode.selected && <label className="field-stack"><strong>No-code explanation</strong><textarea aria-label="No-code explanation" value={noCode.explanation} onChange={(event) => setNoCode((value) => ({ ...value, explanation: event.target.value }))} /></label>}
      <div className="button-row"><button className="primary-button" disabled={!state.result || Boolean(busy) || (!selectedChanges.length && !excluded.length)} onClick={() => state.result && void perform("associate", () => bridge.request("development.associateChangedFiles", { correlationId: crypto.randomUUID(), ...ids, resultId: state.result!.id, associated: selectedChanges, excluded }), "Changed-file decisions saved.")}>Save Changed Files</button><button className="ghost-button" disabled={!state.result || !noCode.selected || !noCode.explanation.trim() || Boolean(busy)} onClick={() => state.result && void perform("no-code", () => bridge.request("development.confirmNoCode", { correlationId: crypto.randomUUID(), ...ids, resultId: state.result!.id, explanation: noCode.explanation, confirmed: true }), "No-code outcome confirmed; review is required again.")}>Confirm No-Code Outcome</button></div>
    </section>

    <section className="development-section completion-section" aria-labelledby="development-completion"><header><div><span className="eyebrow">6</span><h2 id="development-completion">Completion</h2></div><span>{state.workItem.status === "completed" ? "completed" : state.completion.allowed ? "ready" : "gated"}</span></header>
      <div className="completion-review"><p><strong>Objective:</strong> {state.workItem.objective}</p><p><strong>Source scope:</strong> {state.scopeItems.map((item) => item.workspaceRelativePath).join(", ") || "None"}</p><p><strong>Prompt:</strong> {state.promptPreparation?.status ?? "Not prepared"}</p><p><strong>Handoff:</strong> {state.handoff?.status ?? (state.result?.executionOrigin === "manual" ? "Manual work" : "Not confirmed")}</p><p><strong>Result:</strong> {state.result?.summary ?? "Not recorded"}</p><p><strong>Associated changed files:</strong> {state.result?.associatedChangedFiles.join(", ") || "None"}</p><p><strong>Excluded changed files:</strong> {state.result?.excludedChangedFiles.map((item) => `${item.path} — ${item.reason}`).join(", ") || "None"}</p><p><strong>Tests reported:</strong> {state.result?.testsRun || "None reported"}</p><p><strong>Unresolved issues:</strong> {state.result?.unresolvedIssues || "None reported"}</p>{state.result?.noCode && <p><strong>No-code outcome:</strong> {state.result.noCode.explanation}</p>}</div>
      {state.result && <div className="button-row"><button className="ghost-button danger" disabled={Boolean(busy)} onClick={() => void perform("request-changes", () => bridge.request("development.reviewResult", { correlationId: crypto.randomUUID(), ...ids, resultId: state.result!.id, decision: "changes-requested" }), "Changes requested; record a revised result.")}>Request Changes</button><button className="primary-button" disabled={Boolean(busy) || state.result.reviewStatus === "accepted"} onClick={() => void perform("accept-result", () => bridge.request("development.reviewResult", { correlationId: crypto.randomUUID(), ...ids, resultId: state.result!.id, decision: "accepted" }), "Development result accepted.")}>Accept Result</button></div>}
      {!state.completion.allowed && <ul className="completion-gates">{state.completion.unmet.map((item) => <li key={item}>{item}</li>)}</ul>}
      <button className="primary-button complete-development" disabled={state.workItem.status === "completed" || !state.completion.allowed || Boolean(busy)} onClick={() => void perform("complete", () => bridge.request("development.complete", { correlationId: crypto.randomUUID(), ...ids }), "Development completed. The next persisted stage is ready.")}>{state.workItem.status === "completed" ? "Development Completed" : "Complete Development"}</button>
    </section>
    </fieldset>
  </section>;
}

function DevelopmentError({ error }: { error: { message: string; detail: string } }): React.JSX.Element { return <div className="error-banner" role="alert"><strong>{error.message}</strong><details><summary>Technical details</summary><pre>{error.detail}</pre></details></div>; }
function fileName(path: string): string { return path.split("/").at(-1) ?? path; }
function shortId(id: string): string { return id.slice(0, 8); }
function sourceLabel(source: string): string { return source.replaceAll("-", " "); }
