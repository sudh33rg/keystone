import type { GitAdapter } from "../../../extension/adapters/GitAdapter";
import type { WorkspaceAdapter } from "../../../extension/adapters/WorkspaceAdapter";
import type { RepositoryMonitor } from "../../../extension/intelligence/VsCodeRepositoryMonitor";
import type { IntelligenceStore } from "../../persistence/IntelligenceStore";
import type { KeystoneLogger } from "../../../shared/logging/KeystoneLogger";
import { KeystoneError } from "../../../shared/errors/KeystoneError";
import type {
  IntelligenceRuntimeOverview,
  IntelligenceRuntimePhase,
  IntelligenceStatus,
} from "../../../shared/contracts/intelligence";
import type { RepositoryIndexService } from "../RepositoryIndexService";
import {
  ChangeCollector,
  type RepositoryChangeBatch,
  type RepositoryChangeReason,
} from "./ChangeCollector";
import { IngestionScheduler, ingestionPriority } from "./IngestionScheduler";
import type { WorkerPoolManager } from "./WorkerPoolManager";
import { StartupReconciler } from "./StartupReconciler";
import { IntelligenceHealthService } from "./IntelligenceHealthService";

export interface ContinuousIntelligenceState extends IntelligenceRuntimeOverview {
  status: IntelligenceStatus;
  pendingUpdate: boolean;
  scanRevision: number;
  error?: { code: string; message: string; technicalDetails?: string; recommendedAction?: string };
}

type RuntimeListener = (state: ContinuousIntelligenceState) => void;

export class IntelligenceRuntime {
  private readonly listeners = new Set<RuntimeListener>();
  private readonly disposables: Array<{ dispose(): void }> = [];
  private readonly scheduler: IngestionScheduler;
  private readonly collector: ChangeCollector;
  private readonly startup: StartupReconciler;
  private readonly health: IntelligenceHealthService;
  private pendingFiles = 0;
  private staleResultsDiscarded = 0;
  private processedFiles = 0;
  private throughputStartedAt: number | undefined;
  private phase: IntelligenceRuntimePhase = "ready";
  private initialized = false;
  private disposed = false;

  constructor(
    private readonly workspace: WorkspaceAdapter,
    git: GitAdapter,
    private readonly store: IntelligenceStore,
    private readonly index: RepositoryIndexService,
    private readonly workers: WorkerPoolManager,
    private readonly monitor: RepositoryMonitor,
    private readonly logger: KeystoneLogger,
    startup?: StartupReconciler,
    health?: IntelligenceHealthService,
  ) {
    this.startup = startup ?? new StartupReconciler(workspace, git, store);
    this.health = health ?? new IntelligenceHealthService(store);
    this.scheduler = new IngestionScheduler((cause, job) => {
      const error = KeystoneError.fromUnknown(cause, `intelligence.job.${job.reason}`);
      if (
        error.code !== "INTELLIGENCE_SCAN_STALE" &&
        error.code !== "INTELLIGENCE_SOURCE_STALE" &&
        error.code !== "INTELLIGENCE_SEMANTIC_STALE"
      ) {
        this.phase = "failed";
        this.logger.error(error);
      }
      if (job.reason === "storage-recovery") this.health.markRecoveryFailed(error.message);
      this.emit();
    });
    this.collector = new ChangeCollector((batch) => this.enqueueBatch(batch));
  }

  async initialize(): Promise<void> {
    if (this.initialized) return;
    this.initialized = true;
    this.emit();
    await this.index.initialize();
    this.emit();
    await this.health.refresh();
    this.registerDisposables();
    await this.monitor.start();
    this.maybeEnqueueStartupWork();
    this.emit();
  }

  private registerDisposables(): void {
    this.disposables.push(
      this.index.onDidChange(() => this.emit()),
      this.scheduler.onDidChange((state) => {
        if (state.activeJob && this.phase === "failed")
          this.phase = state.activeJob.reason === "storage-recovery" ? "recovering" : "reconciling";
        this.emit();
      }),
      this.workers.onDidChange(() => this.emit()),
      this.health.onDidChange((state) => {
        if (
          state.status !== "healthy" &&
          state.status !== "recovering" &&
          (this.phase === "ready" || this.phase === "stale") &&
          !this.disposed
        )
          this.enqueueFull("storage-recovery");
        this.emit();
      }),
      this.monitor.onDidChange((change) => this.collector.add(change)),
      this.monitor.onDidGitChange((event) => {
        if (event.fullRebuild) this.enqueueFull("git");
        else if (event.changes.length > 0)
          this.enqueueBatch({
            changes: event.changes,
            reason: "git",
            createdAt: new Date().toISOString(),
          });
      }),
      this.monitor.onDidChangeWorkspaceRoots(() => this.enqueueFull("workspace")),
    );
  }

  private maybeEnqueueStartupWork(): void {
    const configuration = this.workspace.getIndexingConfiguration();
    if (!configuration.enabled || !configuration.onWorkspaceOpen || !this.workspace.isTrusted()) return;
    void (async () => {
      try {
        const reconciliation = await this.startup.reconcile();
        this.phase = reconciliation.phase;
        this.logger.info("intelligence.startup.reconcile", reconciliation.message, {
          action: reconciliation.action,
          changedFiles: reconciliation.changes.length,
        });
        if (reconciliation.action === "incremental")
          this.enqueueBatch({
            changes: reconciliation.changes,
            reason: reconciliation.reason,
            createdAt: new Date().toISOString(),
          });
        else if (reconciliation.action === "rebuild" || reconciliation.action === "recover")
          this.enqueueFull(reconciliation.reason);
      } catch (cause) {
        this.phase = "stale";
        this.logger.warning("intelligence.startup.reconcile", String(cause));
      } finally {
        this.emit();
      }
    })();
  }

  start(): { scanRevision: number } {
    return { scanRevision: this.enqueueFull("manual") };
  }

  cancel(): void {
    this.collector.flush();
    this.scheduler.cancelAll();
    this.index.cancel();
    this.pendingFiles = 0;
    this.phase = this.store.getSnapshot() ? "ready" : "stale";
    this.emit();
  }

  pause(): void {
    this.scheduler.pause();
    this.index.cancel();
    this.phase = "paused";
    this.emit();
  }

  resume(): void {
    this.scheduler.resume();
    this.phase = this.scheduler.getStatus().queueDepth > 0 ? "reconciling" : "ready";
    this.emit();
  }

  getState(): ContinuousIntelligenceState {
    const indexing = this.index.getState();
    const scheduler = this.scheduler.getStatus();
    const workers = this.workers.getStatus();
    const health = this.health.getState();
    const snapshot = this.store.getSnapshot();
    const schedulerIdle =
      scheduler.queueDepth === 0 && scheduler.activeJob === undefined && workers.active === 0;
    const generationIdle =
      schedulerIdle && health.status === "healthy" && snapshot !== undefined && !indexing.error;
    const effectivePhase: IntelligenceRuntimePhase = scheduler.paused
      ? "paused"
      : generationIdle
        ? "ready"
        : this.phase === "rebuilding" ||
            this.phase === "recovering" ||
            this.phase === "failed" ||
            this.phase === "stale"
          ? this.phase
          : "reconciling";
    const currentFiles = generationIdle
      ? []
      : indexing.progress?.currentFiles.length
        ? indexing.progress.currentFiles
        : scheduler.currentFiles;
    const isFirstBuild = !this.store.getSnapshot() && health.status === "missing";
    const displayHealth =
      isFirstBuild && ["rebuilding", "reconciling"].includes(this.phase)
        ? "building"
        : isFirstBuild && this.phase === "failed"
          ? "failed"
          : health.status;
    return {
      ...indexing,
      status: generationIdle ? snapshot.manifest.status : indexing.status,
      phase: effectivePhase,
      pendingUpdate: generationIdle
        ? false
        : indexing.pendingUpdate || scheduler.queueDepth > 0 || scheduler.activeJob !== undefined,
      queueDepth: scheduler.queueDepth,
      activeWorkers: workers.active,
      workerCapacity: workers.capacity,
      pendingFiles: generationIdle ? 0 : this.pendingFiles,
      completedJobs: scheduler.completedJobs,
      failedJobs: scheduler.failedJobs,
      staleResultsDiscarded: this.staleResultsDiscarded,
      workerRestarts: workers.failedRestarts,
      throughputFilesPerSecond: this.throughput(),
      currentFiles: currentFiles.slice(0, 20),
      health: displayHealth,
      ...(indexing.error ? { error: indexing.error } : {}),
      ...(isFirstBuild && displayHealth === "building"
        ? { healthMessage: "Creating the first complete local generation." }
        : health.message
          ? { healthMessage: health.message }
          : {}),
      ...(scheduler.activeJob && !indexing.trigger ? { trigger: scheduler.activeJob.reason } : {}),
      ...(generationIdle ? { progress: undefined, trigger: undefined } : {}),
    };
  }

  onDidChange(listener: RuntimeListener): { dispose(): void } {
    this.listeners.add(listener);
    return { dispose: () => this.listeners.delete(listener) };
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.collector.dispose();
    this.scheduler.dispose();
    this.monitor.dispose();
    for (const disposable of this.disposables.splice(0)) disposable.dispose();
    this.health.dispose();
    this.index.dispose();
    this.store.dispose();
    void this.workers.dispose();
    this.listeners.clear();
  }

  private enqueueBatch(batch: RepositoryChangeBatch): number {
    if (this.disposed || batch.changes.length === 0) return 0;
    this.phase = "reconciling";
    this.throughputStartedAt ??= performance.now();
    this.pendingFiles += batch.changes.length;
    const key = `repository:${batch.createdAt}:${batch.reason}`;
    return this.scheduler.enqueue({
      key,
      reason: batch.reason,
      priority: ingestionPriority(batch.reason),
      paths: batch.changes.map((change) => change.relativePath).slice(0, 100),
      baseGeneration: this.store.getSnapshot()?.manifest.generation ?? 0,
      run: async ({ signal }) => {
        try {
          await this.index.reconcile(batch.changes, batch.reason, signal);
          this.processedFiles += batch.changes.length;
          this.phase = "ready";
          await this.health.refresh();
        } catch (cause) {
          const error = KeystoneError.fromUnknown(cause, "intelligence.reconcile");
          if (
            !signal.aborted &&
            (error.code === "INTELLIGENCE_SOURCE_STALE" ||
              error.code === "INTELLIGENCE_SEMANTIC_STALE")
          ) {
            this.staleResultsDiscarded += 1;
            this.phase = "stale";
            this.collector.addAll(batch.changes);
          }
          if (!signal.aborted && error.code === "INTELLIGENCE_SEMANTIC_CONTEXT_MISSING") {
            this.staleResultsDiscarded += 1;
            this.enqueueFull(batch.reason);
          }
          throw cause;
        } finally {
          if (!signal.aborted)
            this.pendingFiles = Math.max(0, this.pendingFiles - batch.changes.length);
          this.emit();
        }
      },
    });
  }

  private enqueueFull(reason: RepositoryChangeReason | "manual"): number {
    if (this.disposed) return 0;
    this.collector.dispose();
    this.scheduler.cancelAll();
    this.index.cancel();
    this.pendingFiles = 0;
    this.phase = reason === "storage-recovery" ? "recovering" : "rebuilding";
    this.throughputStartedAt ??= performance.now();
    if (reason === "storage-recovery") this.health.markRecovering();
    return this.scheduler.enqueue({
      key: `repository:full:${Date.now()}`,
      reason,
      priority: ingestionPriority(reason),
      paths: [],
      baseGeneration: this.store.getSnapshot()?.manifest.generation ?? 0,
      run: async ({ signal }) => {
        await this.index.rebuild(reason, signal);
        this.processedFiles += this.store.getSnapshot()?.files.length ?? 0;
        this.pendingFiles = 0;
        await this.health.refresh();
        this.phase = "ready";
      },
    });
  }

  private emit(): void {
    const state = this.getState();
    for (const listener of this.listeners) listener(state);
  }

  private throughput(): number {
    if (!this.throughputStartedAt || this.processedFiles === 0) return 0;
    const seconds = Math.max(0.001, (performance.now() - this.throughputStartedAt) / 1_000);
    return Math.round((this.processedFiles / seconds) * 100) / 100;
  }
}
