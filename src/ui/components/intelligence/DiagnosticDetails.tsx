import { useState } from "react";
import type { IntelligenceDiagnostic } from "../../../shared/contracts/intelligence";
import type { HostBridge } from "../../services/HostBridge";

interface DiagnosticGuidance {
  classification: "repository finding" | "capability limitation" | "ambiguous evidence" | "runtime/configuration" | "information";
  meaning: string;
  action: string;
  canPrepare: boolean;
  openSettings?: boolean;
}

export function DiagnosticDetails({ diagnostic, bridge, onError }: { diagnostic: IntelligenceDiagnostic; bridge: HostBridge; onError?: (message: string) => void }): React.JSX.Element {
  const [preparing, setPreparing] = useState(false);
  const [created, setCreated] = useState<string>();
  const guidance = diagnosticGuidance(diagnostic);
  const location = diagnostic.relativePath ? `${diagnostic.relativePath}${diagnostic.range ? `:${diagnostic.range.startLine + 1}:${diagnostic.range.startColumn + 1}` : ""}` : "Repository-wide";
  const objective = `Investigate and resolve Keystone intelligence diagnostic ${diagnostic.code}.\n\nFinding: ${diagnostic.message}\nLocation: ${location}\nClassification: ${guidance.classification}.\nRequired outcome: ${guidance.action}\n\nPreserve evidence-backed intelligence behavior. Verify the source before changing code, add focused tests, and do not suppress the diagnostic unless the underlying cause or deterministic extractor limitation is addressed.`;

  const fail = (cause: unknown): void => onError?.(cause instanceof Error ? cause.message : String(cause));
  const createWorkflow = (): void => {
    void bridge.request("workflow/capture", { text: objective, mode: "quick", title: `Resolve intelligence diagnostic: ${diagnostic.code}` })
      .then((workflow) => { setCreated(workflow.id); setPreparing(false); })
      .catch(fail);
  };

  return <details className={`diagnostic-details ${diagnostic.severity}`}>
    <summary><strong>{diagnostic.code}</strong><span>{diagnostic.message}</span><small>{guidance.classification}</small></summary>
    <div className="diagnostic-body">
      <dl>
        <div><dt>What this means</dt><dd>{guidance.meaning}</dd></div>
        <div><dt>Recommended action</dt><dd>{guidance.action}</dd></div>
        <div><dt>Location</dt><dd>{location}</dd></div>
        <div><dt>Severity</dt><dd>{diagnostic.severity}</dd></div>
        {(diagnostic.extractorId || diagnostic.adapterId) && <div><dt>Producer</dt><dd>{diagnostic.extractorId ?? diagnostic.adapterId}</dd></div>}
        {diagnostic.technologyId && <div><dt>Technology</dt><dd>{diagnostic.technologyId}</dd></div>}
        {diagnostic.entityId && <div><dt>Entity ID</dt><dd><code>{diagnostic.entityId}</code></dd></div>}
      </dl>
      <div className="diagnostic-actions">
        {diagnostic.relativePath && <button className="primary-button" onClick={() => void bridge.request("intelligence/source/open", { relativePath: diagnostic.relativePath!, ...(diagnostic.range ? { range: diagnostic.range } : {}) }).catch(fail)}>Open source</button>}
        {guidance.openSettings && <button className="ghost-button" onClick={() => void bridge.request("settings/open", {}).catch(fail)}>Open settings</button>}
        {guidance.canPrepare && !preparing && !created && <button className="ghost-button" onClick={() => setPreparing(true)}>Prepare fix workflow</button>}
      </div>
      {preparing && <section className="prepared-fix" aria-label="Prepared fix workflow"><h4>Prepared action</h4><pre>{objective}</pre><p>Creating this workflow records an investigation intent. It does not edit source or suppress the diagnostic.</p><div className="diagnostic-actions"><button className="primary-button" onClick={createWorkflow}>Create workflow</button><button className="ghost-button" onClick={() => setPreparing(false)}>Discard</button></div></section>}
      {created && <p className="prepared-success">Fix workflow prepared: <code>{created}</code>. Open Intent &amp; Specs to review it.</p>}
    </div>
  </details>;
}

export function diagnosticGuidance(diagnostic: IntelligenceDiagnostic): DiagnosticGuidance {
  const code = diagnostic.code.toLowerCase();
  if (diagnostic.limitation || code.startsWith("unsupported-") || code.includes("unsupported") || code.startsWith("dynamic-")) return {
    classification: "capability limitation",
    meaning: "The adapter or compiler cannot prove this construct with its current deterministic capability. This is not evidence that the repository code is broken.",
    action: "Inspect the source and adapter evidence. Extend the deterministic adapter only if this construct must become queryable; otherwise retain the limitation explicitly.",
    canPrepare: false
  };
  if (diagnostic.ambiguity || code.includes("ambiguous")) return {
    classification: "ambiguous evidence",
    meaning: "More than one evidence-backed target is plausible, so Keystone refused to invent a single relationship.",
    action: "Inspect the candidates or qualify the symbol/path. Change source only if the ambiguity is unintended.",
    canPrepare: true
  };
  if (code.includes("max-files") || code.includes("limit") || code.includes("storage") || code.includes("worker") || code.includes("runtime")) return {
    classification: "runtime/configuration",
    meaning: "A configured bound or local runtime condition prevented complete processing.",
    action: "Review Keystone settings and runtime health, then rescan after correcting the bound or local condition.",
    canPrepare: false,
    openSettings: true
  };
  if (code === "parse-failure" || code.startsWith("unresolved-") || code.includes("extraction") || code.includes("failed")) return {
    classification: "repository finding",
    meaning: code.startsWith("unresolved-") ? "Keystone found the reference but could not prove its target, so no canonical relationship was fabricated." : "Deterministic analysis could not complete for this source location.",
    action: "Open the source, verify syntax and resolution context, then repair the source or extractor with a focused regression test.",
    canPrepare: true
  };
  return {
    classification: "information",
    meaning: "This is analysis metadata recorded to explain the limits or outcome of the current generation.",
    action: "Inspect the location and evidence. No repository change is required unless the reported behavior is unexpected.",
    canPrepare: false
  };
}
