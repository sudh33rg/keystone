import { useState } from "react";
import type { IntelligenceDiagnosticsResult, IntelligenceOverview as IntelligenceOverviewModel } from "../../../shared/contracts/intelligence";
import type { HostBridge } from "../../services/HostBridge";
import { SemanticBrowser } from "./SemanticBrowser";
import { DiagnosticDetails } from "./DiagnosticDetails";

interface IntelligenceOverviewProps {
  overview: IntelligenceOverviewModel | undefined;
  onStart: () => void;
  onCancel: () => void;
  onPause: () => void;
  onResume: () => void;
  onRefresh: () => void;
  bridge: HostBridge;
}

export function IntelligenceOverview({ overview, onStart, onCancel, onPause, onResume, onRefresh, bridge }: IntelligenceOverviewProps): React.JSX.Element {
  const [insight, setInsight] = useState<Insight>();
  const [error, setError] = useState<string>();
  const [diagnostics, setDiagnostics] = useState<IntelligenceDiagnosticsResult>();
  if (!overview) {
    return <section className="page intelligence-page"><div className="loader"/><p>Loading local repository intelligence…</p></section>;
  }

  const canStart = overview.status === "not-indexed" || overview.status === "failed" || overview.status === "ready" || overview.status === "partial";
  const loadDiagnostics = (cursor?: string): void => { void bridge.request("intelligence/diagnostics", { limit: 50, ...(cursor ? { cursor } : {}) }).then((value) => setDiagnostics((previous) => cursor && previous ? { ...value, items: [...previous.items, ...value.items] } : value)).catch((cause: unknown) => setError(cause instanceof Error ? cause.message : String(cause))); };
  return (
    <section className="page intelligence-page">
      <div className="intelligence-heading">
        <div>
          <div className="eyebrow">Evidence-backed repository model</div>
          <h1>Intelligence</h1>
          <p>{statusDescription(overview)}</p>
        </div>
        <span className={`intelligence-status ${overview.status}`}>{overview.runtime.phase.replace("-", " ")}</span>
      </div>

      <div className="intelligence-actions">
        {canStart && <button className="primary-button" onClick={onStart}>{overview.generation > 0 ? "Rescan repository" : "Scan repository"}</button>}
        {overview.pendingUpdate && overview.runtime.phase !== "paused" && <button className="ghost-button" onClick={onPause}>Pause ingestion</button>}
        {overview.runtime.phase === "paused" && <button className="primary-button" onClick={onResume}>Resume ingestion</button>}
        {overview.pendingUpdate && <button className="ghost-button" onClick={onCancel}>Cancel scan</button>}
        <button className="ghost-button" onClick={onRefresh}>Refresh overview</button>
      </div>

      {overview.runtime.error && (
        <article className="diagnostic error ingestion-failure" role="alert">
          <strong>Ingestion failed · {overview.runtime.error.code}</strong>
          <span>{overview.runtime.error.technicalDetails ?? overview.runtime.error.message}</span>
          <small>{overview.runtime.error.recommendedAction ?? "Review Keystone logs and retry after correcting the reported cause."}</small>
        </article>
      )}

      <article className="runtime-summary" aria-label="Continuous ingestion runtime">
        <div><small>WORKERS</small><strong>{overview.runtime.activeWorkers} / {overview.runtime.workerCapacity}</strong></div>
        <div><small>QUEUED JOBS</small><strong>{overview.runtime.queueDepth}</strong></div>
        <div><small>PENDING FILES</small><strong>{overview.runtime.pendingFiles}</strong></div>
        <div><small>PROGRESS</small><strong title={overview.runtime.trigger ? `Triggered by ${overview.runtime.trigger}` : undefined}>{formatProgress(overview)}</strong></div>
        <div><small>HEALTH</small><strong title={overview.runtime.healthMessage}>{overview.runtime.health}</strong></div>
        <div><small>COMPLETED JOBS</small><strong>{overview.runtime.completedJobs}</strong></div>
        <div><small>FAILED JOBS</small><strong>{overview.runtime.failedJobs}</strong></div>
        <div><small>STALE DISCARDS</small><strong>{overview.runtime.staleResultsDiscarded}</strong></div>
        <div><small>THROUGHPUT</small><strong>{overview.runtime.throughputFilesPerSecond.toLocaleString()} files/s</strong></div>
      </article>

      {overview.runtime.currentFiles.length > 0 && <p className="processing-files"><strong>Processing</strong> {overview.runtime.currentFiles.join(", ")}</p>}

      {overview.repository && (
        <article className="repository-summary">
          <div><small>REPOSITORY</small><strong>{overview.repository.displayName}</strong></div>
          <div><small>GENERATION</small><strong>{overview.generation}</strong></div>
          <div><small>ROOTS</small><strong>{overview.repository.workspaceRoots.length}</strong></div>
          <div><small>BRANCH</small><strong>{overview.repository.branch ?? "Unknown"}</strong></div>
          <div><small>HEAD</small><strong title={overview.repository.headCommit}>{overview.repository.headCommit?.slice(0, 12) ?? "Unknown"}</strong></div>
          <div><small>LAST UPDATE</small><strong>{overview.updatedAt ? new Date(overview.updatedAt).toLocaleTimeString() : "Never"}</strong></div>
          <div><small>LOCAL STORE</small><strong>.keystone/</strong></div>
        </article>
      )}

      {overview.generation > 0 && <SemanticBrowser key={overview.generation} bridge={bridge}/>}

      <div className="metric-grid" aria-label="Intelligence counts">
        <Metric label="Files" value={overview.counts.files} onClick={() => setInsight(metricInsight("Files", overview.counts.files))}/>
        <Metric label="Symbols" value={overview.counts.symbols} onClick={() => setInsight(metricInsight("Symbols", overview.counts.symbols))}/>
        <Metric label="Relationships" value={overview.counts.relationships} onClick={() => setInsight(metricInsight("Relationships", overview.counts.relationships))}/>
        <Metric label="Evidence" value={overview.counts.evidence} onClick={() => setInsight(metricInsight("Evidence", overview.counts.evidence))}/>
        <Metric label="Packages" value={overview.counts.packages} onClick={() => setInsight(metricInsight("Packages", overview.counts.packages))}/>
        <Metric label="Tests" value={overview.counts.tests} onClick={() => setInsight(metricInsight("Tests", overview.counts.tests))}/>
        <Metric label="Routes" value={overview.counts.routes} onClick={() => setInsight(metricInsight("Routes", overview.counts.routes))}/>
        <Metric label="Dependencies" value={overview.counts.externalDependencies} onClick={() => setInsight(metricInsight("Dependencies", overview.counts.externalDependencies))}/>
        <Metric label="Parse failures" value={overview.counts.parseFailures} onClick={() => setInsight(metricInsight("Parse failures", overview.counts.parseFailures))}/>
        <Metric label="Unresolved" value={overview.counts.unresolvedReferences} onClick={() => setInsight(metricInsight("Unresolved", overview.counts.unresolvedReferences))}/>
        <Metric label="Excluded" value={overview.counts.excluded} onClick={() => setInsight(metricInsight("Excluded", overview.counts.excluded))}/>
        <Metric label="Sensitive metadata" value={overview.counts.sensitive} onClick={() => setInsight(metricInsight("Sensitive metadata", overview.counts.sensitive))}/>
      </div>

      {insight && <InsightPanel insight={insight} bridge={bridge} onClose={() => setInsight(undefined)} onError={setError}/>}
      {error && <p className="semantic-error" role="alert">{error}</p>}

      <div className="breakdown-grid">
        <Breakdown title="Languages" items={overview.languages} onSelect={(item) => setInsight(breakdownInsight("Languages", item.key, item.count))}/>
        <Breakdown title="File categories" items={overview.categories} onSelect={(item) => setInsight(breakdownInsight("File categories", item.key, item.count))}/>
        <Breakdown title="Symbol types" items={overview.symbolTypes} onSelect={(item) => setInsight(breakdownInsight("Symbol types", item.key, item.count))}/>
        <Breakdown title="Relationship types" items={overview.relationshipTypes} onSelect={(item) => setInsight(breakdownInsight("Relationship types", item.key, item.count))}/>
        <Breakdown title="Confidence" items={overview.confidence} onSelect={(item) => setInsight(breakdownInsight("Confidence", item.key, item.count))}/>
      </div>

      {overview.cpg && <article className="runtime-summary actionable-summary" aria-label="Progressive code analysis metrics"><button onClick={() => setInsight(cpgInsight("CPG scopes", overview.cpg!.scopes))}><small>CPG SCOPES</small><strong>{overview.cpg.scopes}</strong></button><button onClick={() => setInsight(cpgInsight("Built / reused", overview.cpg!.scopesBuilt + overview.cpg!.scopesReused))}><small>BUILT / REUSED</small><strong>{overview.cpg.scopesBuilt} / {overview.cpg.scopesReused}</strong></button><button onClick={() => setInsight(cpgInsight("Build time", Math.round(overview.cpg!.buildTimeMs)))}><small>BUILD TIME</small><strong>{Math.round(overview.cpg.buildTimeMs)} ms</strong></button><button onClick={() => setInsight(cpgInsight("Shard size", Math.round(overview.cpg!.shardBytes / 1024)))}><small>SHARD SIZE</small><strong>{Math.round(overview.cpg.shardBytes / 1024)} KiB</strong></button><button onClick={() => setInsight(cpgInsight("Approximate", overview.cpg!.approximateResults))}><small>APPROXIMATE</small><strong>{overview.cpg.approximateResults}</strong></button><button onClick={() => setInsight(cpgInsight("Failures", overview.cpg!.analysisFailures))}><small>FAILURES</small><strong>{overview.cpg.analysisFailures}</strong></button></article>}

      {overview.diagnostics.total > 0 && (
        <section className="diagnostic-list" aria-label="Intelligence diagnostics">
          <h2>Diagnostics <span>{overview.diagnostics.total}</span></h2>
          {(diagnostics?.items ?? overview.diagnostics.items).map((item, index) => <DiagnosticDetails key={`${item.code}-${item.relativePath ?? "repository"}-${index}`} diagnostic={item} bridge={bridge} onError={setError}/>)}
          {!diagnostics && overview.diagnostics.truncated && <button className="ghost-button" onClick={() => loadDiagnostics()}>Browse all diagnostics</button>}
          {diagnostics?.nextCursor && <button className="ghost-button" onClick={() => loadDiagnostics(diagnostics.nextCursor)}>Load 50 more</button>}
          {diagnostics && <p>Showing {diagnostics.items.length.toLocaleString()} of {diagnostics.total.toLocaleString()} diagnostics from generation {diagnostics.generation}.</p>}
        </section>
      )}
    </section>
  );
}

function Metric({ label, value, onClick }: { label: string; value: number; onClick: () => void }): React.JSX.Element {
  return <button className="metric" onClick={onClick} aria-label={`Inspect ${label}`}><strong>{value.toLocaleString()}</strong><span>{label}</span><small>View details</small></button>;
}

function Breakdown({ title, items, onSelect }: { title: string; items: Array<{ key: string; count: number }>; onSelect: (item: { key: string; count: number }) => void }): React.JSX.Element {
  return (
    <section className="breakdown"><h2>{title}</h2>{items.length === 0 ? <p>No data yet.</p> : <div className="breakdown-items">{items.map((item) => <button key={item.key} onClick={() => onSelect(item)}><span>{displayKey(item.key)}</span><strong>{item.count}</strong></button>)}</div>}</section>
  );
}

interface Insight { title: string; value: number; meaning: string; calculation: string; action?: string; browse?: { query?: string; entityTypes?: string[]; languages?: string[] }; settings?: boolean; rescan?: boolean }
function InsightPanel({ insight, bridge, onClose, onError }: { insight: Insight; bridge: HostBridge; onClose: () => void; onError: (message: string) => void }): React.JSX.Element {
  const browse = (): void => { window.dispatchEvent(new CustomEvent("keystone:intelligence-browse", { detail: insight.browse })); };
  return <section className="insight-panel" aria-label={`${insight.title} details`}><header><div><small>Intelligence detail</small><h2>{insight.title} · {insight.value.toLocaleString()}</h2></div><button className="ghost-button" onClick={onClose}>Close</button></header><dl><div><dt>What it means</dt><dd>{insight.meaning}</dd></div><div><dt>How it is calculated</dt><dd>{insight.calculation}</dd></div>{insight.action && <div><dt>Recommended action</dt><dd>{insight.action}</dd></div>}</dl><div className="diagnostic-actions">{insight.browse && <button className="primary-button" onClick={browse}>Browse matching intelligence</button>}{insight.settings && <button className="ghost-button" onClick={() => void bridge.request("settings/open", {}).catch((cause: unknown) => onError(cause instanceof Error ? cause.message : String(cause)))}>Open settings</button>}{insight.rescan && <button className="ghost-button" onClick={() => void bridge.request("intelligence/scan/start", {}).catch((cause: unknown) => onError(cause instanceof Error ? cause.message : String(cause)))}>Rescan repository</button>}</div></section>;
}

function metricInsight(label: string, value: number): Insight {
  const types: Record<string, string[]> = { Files: ["keystone.core.File"], Packages: ["keystone.core.Package"], Tests: ["keystone.core.TestSuite", "keystone.core.TestCase"], Routes: ["keystone.core.Route", "keystone.core.Endpoint", "keystone.core.Command"], Dependencies: ["keystone.core.ExternalDependency"] };
  const meanings: Record<string, string> = { Files: "Canonical files in the promoted generation.", Symbols: "Evidence-backed named entities extracted from included files.", Relationships: "Evidence-backed graph edges between canonical entities.", Evidence: "Trace records that explain where entities and relationships came from.", Packages: "Detected repository packages.", Tests: "Detected test suites and test cases; this is not a coverage percentage.", Routes: "Detected routes, endpoints, and commands.", Dependencies: "External dependency entities used by the repository.", "Parse failures": "Files for which deterministic parsing failed.", Unresolved: "References observed in source whose targets could not be proved.", Excluded: "Inventory files intentionally not deeply ingested by classification rules.", "Sensitive metadata": "Sensitive files recorded without secret values." };
  const diagnostic = label === "Parse failures" || label === "Unresolved";
  return { title: label, value, meaning: meanings[label] ?? "Current-generation intelligence count.", calculation: diagnostic ? "Counted from current-generation diagnostics; unresolved targets are never fabricated." : "Counted from the last atomically promoted local generation in .keystone/.", action: diagnostic && value ? "Expand the Diagnostics section to inspect exact locations and prepare a fix workflow where appropriate." : label === "Excluded" ? "No action is required when exclusions match policy. Unexpected exclusions should be reviewed in settings and rescanned." : undefined, ...(types[label] ? { browse: { query: "", entityTypes: types[label] } } : label === "Symbols" ? { browse: { query: "" } } : {}), ...(label === "Excluded" ? { settings: true, rescan: true } : {}) };
}

function breakdownInsight(group: string, key: string, count: number): Insight {
  if (group === "Languages") return { title: displayKey(key), value: count, meaning: `Included files and entities classified as ${displayKey(key)}.`, calculation: "Language is determined from extension and deterministic provider metadata.", browse: { query: "", languages: [key] } };
  if (group === "Symbol types") return { title: displayKey(key), value: count, meaning: `Canonical entities with ontology type ${key}.`, calculation: "Counted from the symbol type index in the promoted generation.", browse: { query: "", entityTypes: [key] } };
  if (group === "File categories") return { title: displayKey(key), value: count, meaning: `Inventory files classified in the ${displayKey(key)} category.`, calculation: "Category is assigned by deterministic inclusion and classification rules.", browse: { query: "" } };
  if (group === "Relationship types") return { title: displayKey(key), value: count, meaning: `Evidence-backed relationships of ontology type ${key}.`, calculation: "Counted from the persisted relationship-type index; inspect an entity to see edge evidence.", browse: { query: "" } };
  return { title: displayKey(key), value: count, meaning: `Relationships in the ${displayKey(key)} confidence band.`, calculation: "Exact is 1.0, high is at least 0.85, medium is at least 0.6, and lower values are candidates. Confidence never replaces evidence.", browse: { query: "" } };
}

function cpgInsight(label: string, value: number): Insight {
  const text: Record<string, string> = { "CPG scopes": "Executable TypeScript/JavaScript scopes with persisted progressive code-property graphs.", "Built / reused": "Scopes newly compiled or safely reused by structural hash in this generation.", "Build time": "Measured total CPG construction time for the promoted generation.", "Shard size": "Compressed local CPG shard storage under .keystone/.", Approximate: "CPG results that crossed a precision boundary and are explicitly marked approximate.", Failures: "Executable scopes whose deterministic CPG analysis did not complete." };
  return { title: label, value, meaning: text[label] ?? "Progressive code analysis metric.", calculation: "Read from the current generation CPG manifest and its recorded build metrics.", action: label === "Failures" && value ? "Inspect analysis diagnostics on the affected executable entity; do not assume the source code itself is defective." : undefined, browse: { query: "", entityTypes: ["keystone.core.Function", "keystone.core.Method", "keystone.core.Constructor"] } };
}

function displayKey(value: string): string {
  return value.replace(/^keystone\.core\./, "").replace(/[-_]/g, " ");
}

function formatProgress(overview: IntelligenceOverviewModel): string {
  const progress = overview.runtime.progress;
  if (progress) return `${progress.stage} ${progress.fileCount} / ${progress.totalFiles}`;
  return overview.runtime.trigger?.replace("-", " ") ?? "Idle";
}

function statusDescription(overview: IntelligenceOverviewModel): string {
  if (overview.runtime.phase === "paused") return "Continuous ingestion is paused. The last complete generation remains queryable.";
  if (overview.runtime.phase === "recovering") return "Local intelligence storage is being reconstructed while the last in-memory generation remains available.";
  if (overview.status === "storage-unavailable") return "Open a saved local workspace to enable extension-managed intelligence storage.";
  if (overview.status === "not-indexed") return "No local intelligence snapshot exists yet.";
  if (overview.status === "scanning") return overview.generation > 0 ? "Reconciling changes in the background while the last complete generation remains available." : "Building the first local generation in background workers.";
  if (overview.status === "failed") return "The snapshot could not be loaded or built. Review diagnostics and retry.";
  if (overview.status === "partial") return "The snapshot is usable, with unsupported or failed files reported below.";
  return `Local intelligence was updated${overview.updatedAt ? ` at ${new Date(overview.updatedAt).toLocaleString()}` : ""}.`;
}
