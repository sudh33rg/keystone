import { useCallback, useEffect, useState } from "react";
import type { HostBridge } from "../../services/HostBridge";
import type { TaskHandoff, TaskHandoffPackage, HandoffCompatibilityReport, HandoffPrivacyReport } from "../../../shared/contracts/handoff";

/**
 * Task Handoff — an action on an ONGOING workflow (not a top-level destination).
 * Lets the user review exactly what will transfer, add progress + next action,
 * redact sensitive data, export a portable local package, import a package on
 * another machine, review compatibility, and accept/reject the handoff.
 *
 * No Git writes, no accounts/SSO/cloud/tokens/remote sync occur here. The host
 * performs all file I/O; this component only drives the protocol.
 */
export function TaskHandoffWorkspace({
  bridge,
  workflowId,
  onClose,
}: {
  bridge: HostBridge;
  workflowId: string;
  onClose: () => void;
}): React.JSX.Element {
  const [eligibility, setEligibility] = useState<{ eligible: boolean; reason?: string }>();
  const [draft, setDraft] = useState<TaskHandoff>();
  const [history, setHistory] = useState<TaskHandoff[]>([]);
  const [progressSummary, setProgressSummary] = useState("");
  const [nextActionTitle, setNextActionTitle] = useState("");
  const [nextActionDescription, setNextActionDescription] = useState("");
  const [privacy, setPrivacy] = useState<HandoffPrivacyReport>();
  const [exportPath, setExportPath] = useState("");
  const [exported, setExported] = useState<{ pkg: TaskHandoffPackage; savedUri: string }>();
  const [importContent, setImportContent] = useState("");
  const [preview, setPreview] = useState<{ pkg: TaskHandoffPackage; compatibility: HandoffCompatibilityReport; blocking: boolean }>();
  const [accepted, setAccepted] = useState<TaskHandoff>();
  const [error, setError] = useState<string>();

  const refresh = useCallback(async () => {
    try {
      const elig = await bridge.request("taskHandoff/checkEligibility", { workflowId });
      setEligibility(elig);
      const hist = await bridge.request("taskHandoff/listHistory", { workflowId });
      setHistory(hist);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    }
  }, [bridge, workflowId]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const createDraft = async () => {
    setError(undefined);
    try {
      const d = await bridge.request("taskHandoff/createDraft", { workflowId });
      setDraft(d);
      setProgressSummary(d.progressSummary);
      setNextActionTitle(d.nextAction?.title ?? "");
      setNextActionDescription(d.nextAction?.description ?? "");
      await refresh();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    }
  };

  const saveDraft = async () => {
    if (!draft) return;
    try {
      const updated = await bridge.request("taskHandoff/updateDraft", {
        workflowId,
        handoffId: draft.id,
        progressSummary,
        nextActionTitle,
        nextActionDescription,
      });
      setDraft(updated);
      await runScan(updated.id);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    }
  };

  const runScan = async (handoffId: string) => {
    try {
      const report = await bridge.request("taskHandoff/runPrivacyScan", { handoffId });
      setPrivacy(report);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    }
  };

  const markRedacted = async (findingId: string) => {
    if (!draft) return;
    try {
      const report = await bridge.request("taskHandoff/markRedacted", { handoffId: draft.id, findingId });
      setPrivacy(report);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    }
  };

  const doExport = async () => {
    if (!draft) return;
    try {
      const result = await bridge.request("taskHandoff/export", {
        handoffId: draft.id,
        expectedRevision: 0,
        targetPath: exportPath || `${workflowId}.keystone-handoff`,
      });
      setExported(result);
      await refresh();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    }
  };

  const previewImport = async () => {
    setError(undefined);
    try {
      const p = await bridge.request("taskHandoff/previewImport", { rawContent: importContent });
      setPreview(p);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    }
  };

  const acceptImport = async () => {
    try {
      const a = await bridge.request("taskHandoff/acceptImport", { rawContent: importContent });
      setAccepted(a);
      await refresh();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    }
  };

  const rejectImport = async () => {
    try {
      await bridge.request("taskHandoff/rejectImport", { rawContent: importContent });
      setPreview(undefined);
      setImportContent("");
      await refresh();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    }
  };

  return (
    <section className="task-handoff-panel" aria-labelledby="task-handoff-title">
      <header className="panel-header">
        <h2 id="task-handoff-title">Task Handoff</h2>
        <button className="ghost-button" onClick={onClose}>Close</button>
      </header>

      {error && <p className="error-state" role="alert">{error}</p>}

      <section aria-labelledby="handoff-eligibility">
        <h3 id="handoff-eligibility">Eligibility</h3>
        {eligibility?.eligible === false && <p className="warning">{eligibility.reason}</p>}
        {eligibility?.eligible && !draft && (
          <button className="primary-button" onClick={() => void createDraft()}>Create Handoff Draft</button>
        )}
      </section>

      {draft && (
        <section aria-labelledby="handoff-draft">
          <h3 id="handoff-draft">Prepare Handoff</h3>
          <label>
            Progress summary
            <textarea value={progressSummary} onChange={(e) => setProgressSummary(e.target.value)} />
          </label>
          <label>
            Next action title
            <input value={nextActionTitle} onChange={(e) => setNextActionTitle(e.target.value)} />
          </label>
          <label>
            Next action description
            <textarea value={nextActionDescription} onChange={(e) => setNextActionDescription(e.target.value)} />
          </label>
          <button className="primary-button" onClick={() => void saveDraft()}>Save Draft</button>

          {privacy && (
            <section aria-labelledby="handoff-privacy">
              <h4 id="handoff-privacy">Privacy scan</h4>
              <p>{privacy.scanPassed ? "No unresolved sensitive-content findings." : `${privacy.findings.filter((f) => f.status === "open").length} open finding(s).`}</p>
              <ul>
                {privacy.findings.map((f) => (
                  <li key={f.id}>
                    <code>{f.maskedPreview}</code> — {f.category} ({f.severity}/{f.confidence})
                    {f.status === "open" && f.recommendedAction === "redact" && (
                      <button className="ghost-button" onClick={() => void markRedacted(f.id)}>Mark Redacted</button>
                    )}
                  </li>
                ))}
              </ul>
            </section>
          )}

          <section aria-labelledby="handoff-export">
            <h4 id="handoff-export">Export package</h4>
            <label>
              Destination path
              <input value={exportPath} onChange={(e) => setExportPath(e.target.value)} placeholder={`${workflowId}.keystone-handoff`} />
            </label>
            <button className="primary-button" onClick={() => void doExport()} disabled={!privacy?.scanPassed}>Export</button>
            {exported && <p className="success">Exported to {exported.savedUri}</p>}
          </section>
        </section>
      )}

      <section aria-labelledby="handoff-import">
        <h3 id="handoff-import">Import Handoff</h3>
        <label>
          Paste handoff package content
          <textarea value={importContent} onChange={(e) => setImportContent(e.target.value)} />
        </label>
        <button className="secondary-button" onClick={() => void previewImport()} disabled={!importContent.trim()}>Preview Import</button>
        {preview && (
          <div className="import-preview">
            <p>Repository compatibility: <strong>{preview.compatibility.repository}</strong></p>
            <p>Blocking: {preview.blocking ? "Yes" : "No"}</p>
            {preview.blocking && <ul>{preview.compatibility.blockingIssues.map((i) => <li key={i.code}>{i.message}</li>)}</ul>}
            <div className="button-row">
              <button className="primary-button" onClick={() => void acceptImport()} disabled={preview.blocking}>Accept Handoff</button>
              <button className="ghost-button" onClick={() => void rejectImport()}>Reject</button>
            </div>
          </div>
        )}
        {accepted && <p className="success">Handoff accepted from {accepted.senderLabel ?? "another developer"}. Resume from: {accepted.nextAction?.title}</p>}
      </section>

      {history.length > 0 && (
        <section aria-labelledby="handoff-history">
          <h3 id="handoff-history">Handoff history</h3>
          <ul>
            {history.map((h) => (
              <li key={h.id}>{h.direction} · {h.status} · {h.updatedAt}</li>
            ))}
          </ul>
        </section>
      )}
    </section>
  );
}
