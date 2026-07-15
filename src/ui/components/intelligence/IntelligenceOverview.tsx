import type { IntelligenceOverview as IntelligenceOverviewModel } from "../../../shared/contracts/intelligence";
import type { HostBridge } from "../../services/HostBridge";
import { SemanticBrowser } from "./SemanticBrowser";

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
  if (!overview) {
    return <section className="page intelligence-page"><div className="loader"/><p>Loading local repository intelligence…</p></section>;
  }

  const canStart = overview.status === "not-indexed" || overview.status === "failed" || overview.status === "ready" || overview.status === "partial";
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
        </article>
      )}

      <div className="metric-grid" aria-label="Intelligence counts">
        <Metric label="Files" value={overview.counts.files}/>
        <Metric label="Symbols" value={overview.counts.symbols}/>
        <Metric label="Relationships" value={overview.counts.relationships}/>
        <Metric label="Evidence" value={overview.counts.evidence}/>
        <Metric label="Packages" value={overview.counts.packages}/>
        <Metric label="Tests" value={overview.counts.tests}/>
        <Metric label="Routes" value={overview.counts.routes}/>
        <Metric label="Dependencies" value={overview.counts.externalDependencies}/>
        <Metric label="Parse failures" value={overview.counts.parseFailures}/>
        <Metric label="Unresolved" value={overview.counts.unresolvedReferences}/>
        <Metric label="Excluded" value={overview.counts.excluded}/>
        <Metric label="Sensitive metadata" value={overview.counts.sensitive}/>
      </div>

      <div className="breakdown-grid">
        <Breakdown title="Languages" items={overview.languages}/>
        <Breakdown title="File categories" items={overview.categories}/>
        <Breakdown title="Symbol types" items={overview.symbolTypes}/>
        <Breakdown title="Relationship types" items={overview.relationshipTypes}/>
        <Breakdown title="Confidence" items={overview.confidence}/>
      </div>

      {overview.cpg && <article className="runtime-summary" aria-label="Progressive code analysis metrics"><div><small>CPG SCOPES</small><strong>{overview.cpg.scopes}</strong></div><div><small>BUILT / REUSED</small><strong>{overview.cpg.scopesBuilt} / {overview.cpg.scopesReused}</strong></div><div><small>BUILD TIME</small><strong>{Math.round(overview.cpg.buildTimeMs)} ms</strong></div><div><small>SHARD SIZE</small><strong>{Math.round(overview.cpg.shardBytes / 1024)} KiB</strong></div><div><small>APPROXIMATE</small><strong>{overview.cpg.approximateResults}</strong></div><div><small>FAILURES</small><strong>{overview.cpg.analysisFailures}</strong></div></article>}

      {overview.generation > 0 && <SemanticBrowser key={overview.generation} bridge={bridge}/>} 

      {overview.diagnostics.total > 0 && (
        <section className="diagnostic-list" aria-label="Intelligence diagnostics">
          <h2>Diagnostics <span>{overview.diagnostics.total}</span></h2>
          {overview.diagnostics.items.map((item, index) => (
            <div key={`${item.code}-${item.relativePath ?? "repository"}-${index}`} className={`diagnostic ${item.severity}`}>
              <strong>{item.code}</strong><span>{item.message}</span>{item.relativePath && <small>{item.relativePath}</small>}
            </div>
          ))}
          {overview.diagnostics.truncated && <p>Additional diagnostics are available in the local intelligence snapshot.</p>}
        </section>
      )}
    </section>
  );
}

function Metric({ label, value }: { label: string; value: number }): React.JSX.Element {
  return <article className="metric"><strong>{value.toLocaleString()}</strong><span>{label}</span></article>;
}

function Breakdown({ title, items }: { title: string; items: Array<{ key: string; count: number }> }): React.JSX.Element {
  return (
    <section className="breakdown"><h2>{title}</h2>{items.length === 0 ? <p>No data yet.</p> : <dl>{items.map((item) => <div key={item.key}><dt>{displayKey(item.key)}</dt><dd>{item.count}</dd></div>)}</dl>}</section>
  );
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
