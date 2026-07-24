import { useCallback, useEffect, useState } from "react";
import type { CanonicalWorkflow } from "../../../shared/contracts/canonicalWorkflow";
import type { InvestigationState } from "../../../shared/contracts/stageWorkspace";
import type { StageEvidence } from "../../../shared/contracts/stageWorkspace";
import type { HostBridge } from "../../services/HostBridge";

interface InvestigationStageProps {
  bridge: HostBridge;
  workflowId: string;
  onWorkflowChange: (workflow: CanonicalWorkflow) => void;
}

export function InvestigationStage({ bridge, workflowId, onWorkflowChange }: InvestigationStageProps): React.JSX.Element {
  const [state, setState] = useState<InvestigationState>();
  const [busy, setBusy] = useState<string>();
  const [error, setError] = useState<{ message: string; action: string }>();
  const [answerDrafts, setAnswerDrafts] = useState<Record<string, string>>({});
  const [evidenceDrafts, setEvidenceDrafts] = useState<Record<string, StageEvidence[]>>({});
  const [newQuestion, setNewQuestion] = useState("");
  const [conclusion, setConclusion] = useState("");
  const [limitations, setLimitations] = useState("");

  const perform = useCallback(
    async (label: string, operation: () => Promise<InvestigationState>): Promise<InvestigationState | undefined> => {
      setBusy(label);
      setError(undefined);
      try {
        const next = await operation();
        setState(next);
        return next;
      } catch (cause) {
        setError({ message: cause instanceof Error ? cause.message : "The investigation action failed.", action: label });
        return undefined;
      } finally {
        setBusy(undefined);
      }
    },
    [],
  );

  useEffect(() => {
    queueMicrotask(() =>
      void perform("load", () => bridge.request("stage.investigation.load", { workflowId })).then((loaded) => {
        if (loaded) {
          setConclusion(loaded.conclusion);
          setLimitations(loaded.limitations.join("\n"));
        }
      }),
    );
  }, [bridge, perform, workflowId]);

  const saveAnswer = useCallback(
    async (questionId: string): Promise<void> => {
      const answer = answerDrafts[questionId] ?? "";
      const evidence = (evidenceDrafts[questionId] ?? []).slice(0, 30);
      await perform("save-answer", () =>
        bridge.request("stage.investigation.upsertQuestion", { workflowId, questionId, answer, ...(evidence.length ? { evidence } : {}) }),
      );
    },
    [answerDrafts, bridge, evidenceDrafts, perform, workflowId],
  );

  const completeStage = useCallback(async (): Promise<void> => {
    setBusy("complete");
    setError(undefined);
    try {
      const outcome = await bridge.request("stage.investigation.complete", { workflowId });
      setState(outcome.state);
      onWorkflowChange(outcome.workflow);
    } catch (cause) {
      setError({ message: cause instanceof Error ? cause.message : "Investigation could not be completed.", action: "complete" });
    } finally {
      setBusy(undefined);
    }
  }, [bridge, onWorkflowChange, workflowId]);

  if (!state)
    return (
      <section className="stage-workspace" aria-label="Investigation stage">
        {error ? <div className="error-banner" role="alert"><strong>The action “{error.action}” failed.</strong> {error.message}</div> : <div className="loading-view"><div className="loader" /><p>Loading the Investigation stage…</p></div>}
      </section>
    );

  const answered = state.questions.filter((question) => question.status === "answered").length;
  const readOnly = Boolean(state.completedAt);

  return (
    <section className="stage-workspace" aria-label="Investigation stage">
      {error && <div className="error-banner" role="alert"><strong>The action “{error.action}” failed.</strong> {error.message} You can correct the input or retry.</div>}
      {readOnly && <div className="success-banner" role="status">Investigation is completed. This record is read-only.</div>}

      <div className="stage-guidance">
        <div>
          <h2>What should I do now?</h2>
          <p>
            {state.completion.allowed
              ? "All requirements are satisfied. Complete Investigation to open the final stage."
              : `Answer the required questions with evidence (${answered} of ${state.questions.length} answered), then record and accept a conclusion.`}
          </p>
        </div>
        <button className="primary-button stage-primary-action" disabled={!state.completion.allowed || Boolean(busy) || readOnly} onClick={() => void completeStage()}>
          {readOnly ? "Investigation Completed" : busy === "complete" ? "Working…" : "Complete Investigation"}
        </button>
      </div>

      <details className="stage-panel" open>
        <summary>Objective</summary>
        <p>{state.objective}</p>
      </details>

      <details className="stage-panel" open>
        <summary>Investigation questions — {answered} of {state.questions.length} answered</summary>
        <ul className="question-list">
          {state.questions.map((question) => (
            <li key={question.id} className={question.status === "answered" ? "answered" : undefined}>
              <div className="question-head">
                <strong>{question.text}</strong>
                <span className="status-pill">{question.required ? "Required" : "Optional"} · {question.status === "answered" ? "Answered" : "Open"}</span>
              </div>
              {question.answer && <p className="question-answer">{question.answer}</p>}
              {question.evidence.length > 0 && <small>Evidence: {question.evidence.map((item) => item.label).join(", ")}</small>}
              {!readOnly && (
                <div className="answer-form">
                  <label className="field-stack"><small>Answer</small><textarea aria-label={`Answer for ${question.text}`} rows={2} value={answerDrafts[question.id] ?? question.answer} onChange={(event) => setAnswerDrafts((drafts) => ({ ...drafts, [question.id]: event.target.value }))} /></label>
                  <EvidencePicker
                    label={`Evidence for ${question.text}`}
                    selected={evidenceDrafts[question.id] ?? question.evidence}
                    onChange={(next) => setEvidenceDrafts((drafts) => ({ ...drafts, [question.id]: next }))}
                    onOpen={(reference) => { void bridge.request("intelligence/source/open", { relativePath: reference }); }}
                    onSearch={async (searchQuery) => {
                      const result = await bridge.request("intelligence/search", { query: searchQuery, limit: 30 });
                      return result.items.map((item) => ({ id: item.id, name: item.qualifiedName, relativePath: item.relativePath, kind: item.type }));
                    }}
                  />
                  <button className="ghost-button" disabled={Boolean(busy)} onClick={() => void saveAnswer(question.id)}>Save Answer</button>
                </div>
              )}
            </li>
          ))}
        </ul>
        {!readOnly && (
          <div className="add-question">
            <input aria-label="New investigation question" placeholder="Add a question…" value={newQuestion} onChange={(event) => setNewQuestion(event.target.value)} />
            <button className="ghost-button" disabled={!newQuestion.trim() || Boolean(busy)} onClick={() => { void perform("add-question", () => bridge.request("stage.investigation.upsertQuestion", { workflowId, text: newQuestion.trim() })); setNewQuestion(""); }}>Add Question</button>
          </div>
        )}
      </details>

      <details className="stage-panel" open={!state.conclusionAccepted}>
        <summary>Conclusion — {state.conclusionAccepted ? "Accepted" : "Not accepted"}</summary>
        {readOnly ? (
          <>
            <p>{state.conclusion}</p>
            {state.limitations.length > 0 && <p><small>Limitations: {state.limitations.join("; ")}</small></p>}
          </>
        ) : (
          <>
            <label className="field-stack"><strong>Conclusion</strong><textarea aria-label="Investigation conclusion" rows={5} value={conclusion} onChange={(event) => setConclusion(event.target.value)} /></label>
            <label className="field-stack"><strong>Unresolved limitations (one per line)</strong><textarea aria-label="Investigation limitations" rows={2} value={limitations} onChange={(event) => setLimitations(event.target.value)} /></label>
            <div className="button-row">
              <button className="ghost-button" disabled={Boolean(busy)} onClick={() => void perform("save-conclusion", () => bridge.request("stage.investigation.setConclusion", { workflowId, conclusion, limitations: limitations.split(/\n+/).filter((line) => line.trim()), accepted: false }))}>Save Draft</button>
              <button className="secondary-button" disabled={!conclusion.trim() || Boolean(busy)} onClick={() => void perform("accept-conclusion", () => bridge.request("stage.investigation.setConclusion", { workflowId, conclusion, limitations: limitations.split(/\n+/).filter((line) => line.trim()), accepted: true }))}>Accept Conclusion</button>
            </div>
          </>
        )}
      </details>

      {!state.completion.allowed && state.completion.unmet.length > 0 && (
        <details className="stage-panel"><summary>Remaining before completion ({state.completion.unmet.length})</summary><ul>{state.completion.unmet.map((item) => <li key={item}>{item}</li>)}</ul></details>
      )}
    </section>
  );
}

interface EvidencePickerProps {
  label: string;
  selected: StageEvidence[];
  onChange: (next: StageEvidence[]) => void;
  onOpen: (reference: string) => void;
  onSearch: (query: string) => Promise<Array<{ id: string; name: string; relativePath: string; kind: string }>>;
}

function EvidencePicker({ label, selected, onChange, onOpen, onSearch }: EvidencePickerProps): React.JSX.Element {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<Array<{ id: string; name: string; relativePath: string; kind: string }>>([]);
  const [busy, setBusy] = useState(false);

  const search = useCallback(async (): Promise<void> => {
    if (!query.trim()) return;
    setBusy(true);
    try {
      setResults(await onSearch(query.trim()));
    } catch {
      setResults([]);
    } finally {
      setBusy(false);
    }
  }, [onSearch, query]);

  const toggle = (item: { id: string; name: string; relativePath: string; kind: string }): void => {
    const exists = selected.some((entry) => entry.reference === item.relativePath);
    if (exists) {
      onChange(selected.filter((entry) => entry.reference !== item.relativePath));
    } else {
      const kind: StageEvidence["kind"] = item.kind === "file" || item.kind === "document" || item.kind === "test" || item.kind === "module" || item.kind === "flow" || item.kind === "graph-entity" || item.kind === "symbol" ? item.kind : "file";
      onChange([...selected, { kind, reference: item.relativePath, label: item.name }].slice(0, 30));
    }
  };

  return (
    <div className="evidence-picker">
      <small>{label}</small>
      <div className="evidence-search">
        <input aria-label={`Search intelligence for ${label}`} placeholder="Search symbols and files…" value={query} onChange={(event) => setQuery(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter") void search(); }} />
        <button className="ghost-button" type="button" disabled={busy || !query.trim()} onClick={() => void search()}>Search</button>
      </div>
      {results.length > 0 && (
        <ul className="evidence-results">
          {results.map((item) => (
            <li key={item.id}>
              <label>
                <input type="checkbox" checked={selected.some((entry) => entry.reference === item.relativePath)} onChange={() => toggle(item)} />
                <span>{item.name}</span>
                <small>{item.relativePath}</small>
              </label>
            </li>
          ))}
        </ul>
      )}
      {selected.length > 0 && (
        <ul className="evidence-selected">
          {selected.map((entry) => (
            <li key={entry.reference}>
              <button className="link-button" type="button" onClick={() => onOpen(entry.reference)}>{entry.label}</button>
              <button className="ghost-button" type="button" onClick={() => onChange(selected.filter((item) => item.reference !== entry.reference))}>Remove</button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}


