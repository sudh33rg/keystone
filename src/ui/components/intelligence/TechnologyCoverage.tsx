import { useEffect, useState } from "react";
import type { AdapterDiagnosticsResult, TechnologyCoverageResult } from "../../../shared/contracts/adapters";
import type { HostBridge } from "../../services/HostBridge";
import { DiagnosticDetails } from "./DiagnosticDetails";

export function TechnologyCoverage({ bridge }: { bridge: HostBridge }): React.JSX.Element {
  const [coverage, setCoverage] = useState<TechnologyCoverageResult>();
  const [diagnostics, setDiagnostics] = useState<AdapterDiagnosticsResult>();
  const [error, setError] = useState<string>();
  useEffect(() => {
    const controller = new AbortController();
    void Promise.all([
      bridge.request("intelligence/technologies", { limit: 50 }, { signal: controller.signal }),
      bridge.request("intelligence/adapter-diagnostics", { limit: 20 }, { signal: controller.signal })
    ]).then(([nextCoverage, nextDiagnostics]) => { setCoverage(nextCoverage); setDiagnostics(nextDiagnostics); }).catch((cause: unknown) => { if (!controller.signal.aborted) setError(cause instanceof Error ? cause.message : String(cause)); });
    return () => controller.abort();
  }, [bridge]);

  if (error) return <section className="technology-coverage"><h2>Technology coverage</h2><p role="alert">{error}</p></section>;
  return <section className="technology-coverage" aria-label="Technology coverage">
    <div className="coverage-heading"><div><small>Universal adapters</small><h2>Technology coverage</h2></div><span>{coverage?.total ?? 0} detected</span></div>
    {!coverage ? <p>Loading adapter coverage…</p> : coverage.items.length === 0 ? <p>No adapter-backed technologies detected yet.</p> : <div className="coverage-grid">{coverage.items.map((item) => {
      const detections = coverage.detections.filter((detection) => detection.technologyId === item.technologyId && detection.adapterId === item.adapterId);
      return <details key={`${item.adapterId}:${item.technologyId}`}><summary><strong>{item.technologyId}</strong><span className={`capability ${item.capabilityLevel}`}>{item.capabilityLevel}</span><small>{item.filesParsed}/{item.filesDiscovered} files</small></summary><div className="coverage-details"><p><strong>Capability:</strong> {capabilityMeaning(item.capabilityLevel)}</p><dl><div><dt>Entities extracted</dt><dd>{item.entitiesExtracted}</dd></div><div><dt>Relationships resolved</dt><dd>{item.relationshipsResolved}</dd></div><div><dt>Unresolved references</dt><dd>{item.unresolvedReferences}</dd></div><div><dt>Files failed</dt><dd>{item.filesFailed}</dd></div><div><dt>Metadata-only files</dt><dd>{item.filesMetadataOnly}</dd></div><div><dt>Unsupported constructs</dt><dd>{item.unsupportedConstructs}</dd></div></dl><p><small>{item.adapterId}@{item.adapterVersion} · {item.freshness}</small></p>{detections.map((detection, index) => <section className="detection-evidence" key={`${detection.technologyId}:${index}`}><h4>Detection evidence · {Math.round(detection.confidence * 100)}%</h4>{detection.evidence.map((evidence, evidenceIndex) => <button key={`${evidence.relativePath}:${evidenceIndex}`} onClick={() => void bridge.request("intelligence/source/open", { relativePath: evidence.relativePath, ...(evidence.range ? { range: evidence.range } : {}) }).catch((cause: unknown) => setError(cause instanceof Error ? cause.message : String(cause)))}><strong>{evidence.statement}</strong><small>{evidence.kind} · {evidence.relativePath}</small></button>)}{detection.unsupportedFeatures.length > 0 && <p className="coverage-warning"><strong>Unsupported:</strong> {detection.unsupportedFeatures.join(" · ")}</p>}{detection.conflicts.length > 0 && <p className="coverage-warning"><strong>Conflicts:</strong> {detection.conflicts.join(" · ")}</p>}</section>)}</div></details>;
    })}</div>}
    {diagnostics && diagnostics.items.length > 0 && <details className="adapter-diagnostics"><summary>Adapter diagnostics ({diagnostics.total})</summary>{diagnostics.items.map((item, index) => <DiagnosticDetails key={item.id ?? `${item.code}:${index}`} diagnostic={item} bridge={bridge} onError={setError}/>)}</details>}
  </section>;
}

function capabilityMeaning(level: string): string {
  if (level === "deep") return "semantic extraction plus precise language-specific analysis is available.";
  if (level === "semantic") return "named entities and evidence-backed relationships are available; some language details may remain unresolved.";
  if (level === "structural") return "files and deterministic structural facts are available; call or data semantics are not promised.";
  if (level === "metadata-only") return "only manifest or inventory metadata is available.";
  return "this technology was detected but is not analyzed by the current adapter set.";
}
