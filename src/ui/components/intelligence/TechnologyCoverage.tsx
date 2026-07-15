import { useEffect, useState } from "react";
import type { AdapterDiagnosticsResult, TechnologyCoverageResult } from "../../../shared/contracts/adapters";
import type { HostBridge } from "../../services/HostBridge";

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
    {!coverage ? <p>Loading adapter coverage…</p> : coverage.items.length === 0 ? <p>No adapter-backed technologies detected yet.</p> : <div className="coverage-grid">{coverage.items.map((item) => <article key={`${item.adapterId}:${item.technologyId}`}><div><strong>{item.technologyId}</strong><span className={`capability ${item.capabilityLevel}`}>{item.capabilityLevel}</span></div><small>{item.adapterId}</small><p>{item.filesParsed}/{item.filesDiscovered} files · {item.entitiesExtracted} entities · {item.relationshipsResolved} relationships</p>{(item.filesFailed > 0 || item.unsupportedConstructs > 0) && <p className="coverage-warning">{item.filesFailed} failed · {item.unsupportedConstructs} unsupported</p>}<small>{item.freshness}</small></article>)}</div>}
    {diagnostics && diagnostics.items.length > 0 && <details className="adapter-diagnostics"><summary>Adapter diagnostics ({diagnostics.total})</summary>{diagnostics.items.map((item, index) => <div key={item.id ?? `${item.code}:${index}`}><strong>{item.code}</strong><span>{item.message}</span><small>{item.technologyId ?? item.adapterId}{item.ambiguity ? " · ambiguous" : item.limitation ? " · limitation" : ""}</small></div>)}</details>}
  </section>;
}
