import type { RepositoryChangeReason } from "./ChangeCollector";
import { KeystoneError } from "../../../shared/errors/KeystoneError";

const DEFAULT_INGESTION_TIME_BUDGET_MS = 5 * 60 * 1_000;

export interface IngestionJobContext {
  revision: number;
  signal: AbortSignal;
}

export interface IngestionJob {
  key: string;
  reason: RepositoryChangeReason | "manual";
  priority: number;
  paths: string[];
  baseGeneration: number;
  run(context: IngestionJobContext): Promise<void>;
}

export interface IngestionSchedulerStatus {
  queueDepth: number;
  paused: boolean;
  completedJobs: number;
  failedJobs: number;
  activeJob?: { key: string; reason: IngestionJob["reason"]; revision: number };
  currentFiles: string[];
}

interface QueuedJob extends IngestionJob {
  sequence: number;
  revision: number;
}

export class IngestionScheduler {
  private readonly listeners = new Set<(status: IngestionSchedulerStatus) => void>();
  private readonly queue: QueuedJob[] = [];
  private active: { job: QueuedJob; controller: AbortController } | undefined;
  private sequence = 0;
  private revision = 0;
  private disposed = false;
  private paused = false;
  private completedJobs = 0;
  private failedJobs = 0;

  constructor(
    private readonly onError: (cause: unknown, job: IngestionJob) => void = () => undefined,
    private readonly timeBudgetMs = DEFAULT_INGESTION_TIME_BUDGET_MS
  ) {}

  enqueue(job: IngestionJob): number {
    if (this.disposed) throw new Error("The intelligence ingestion scheduler is disposed.");
    const revision = ++this.revision;
    if (this.active && !this.active.controller.signal.aborted && job.priority < this.active.job.priority) {
      this.queue.push({ ...this.active.job, sequence: ++this.sequence });
      this.active.controller.abort();
    }
    this.queue.push({ ...job, sequence: ++this.sequence, revision });
    this.queue.sort((left, right) => left.priority - right.priority || left.sequence - right.sequence);
    this.emit();
    void this.drain();
    return revision;
  }

  cancelAll(): void {
    this.queue.length = 0;
    this.active?.controller.abort();
    this.emit();
  }

  pause(): void {
    if (this.disposed || this.paused) return;
    this.paused = true;
    if (this.active && !this.active.controller.signal.aborted) {
      this.queue.push({ ...this.active.job, sequence: ++this.sequence });
      this.queue.sort((left, right) => left.priority - right.priority || left.sequence - right.sequence);
      this.active.controller.abort();
    }
    this.emit();
  }

  resume(): void {
    if (this.disposed || !this.paused) return;
    this.paused = false;
    this.emit();
    void this.drain();
  }

  getStatus(): IngestionSchedulerStatus {
    return {
      queueDepth: this.queue.length,
      paused: this.paused,
      completedJobs: this.completedJobs,
      failedJobs: this.failedJobs,
      currentFiles: this.active?.job.paths.slice(0, 20) ?? [],
      ...(this.active ? { activeJob: { key: this.active.job.key, reason: this.active.job.reason, revision: this.active.job.revision } } : {})
    };
  }

  onDidChange(listener: (status: IngestionSchedulerStatus) => void): { dispose(): void } {
    this.listeners.add(listener);
    return { dispose: () => this.listeners.delete(listener) };
  }

  dispose(): void {
    this.disposed = true;
    this.cancelAll();
    this.listeners.clear();
  }

  private async drain(): Promise<void> {
    if (this.active || this.disposed || this.paused) return;
    const job = this.queue.shift();
    if (!job) { this.emit(); return; }
    const controller = new AbortController();
    this.active = { job, controller };
    this.emit();
    let timedOut = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      const timeBudget = new Promise<never>((_resolve, reject) => {
        timer = setTimeout(() => {
          timedOut = true;
          controller.abort();
          reject(new KeystoneError({
            code: "INTELLIGENCE_INGESTION_TIMEOUT",
            category: "INDEXING",
            message: "Repository ingestion exceeded its bounded time budget.",
            technicalDetails: `The ${job.reason} ingestion job exceeded ${this.timeBudgetMs} ms.`,
            operation: "intelligence.scheduler.run",
            recoverable: true,
            recommendedAction: "Review the Keystone logs for the stalled phase, reduce repository scope if necessary, and retry.",
            retryable: true
          }));
        }, this.timeBudgetMs);
      });
      await Promise.race([job.run({ revision: job.revision, signal: controller.signal }), timeBudget]);
      if (!controller.signal.aborted) this.completedJobs += 1;
    } catch (cause) {
      if (timedOut || !controller.signal.aborted) {
        this.failedJobs += 1;
        this.onError(cause, job);
      }
    } finally {
      if (timer) clearTimeout(timer);
      if (this.active?.job === job) this.active = undefined;
      this.emit();
      void this.drain();
    }
  }

  private emit(): void {
    const status = this.getStatus();
    for (const listener of this.listeners) listener(status);
  }
}

export const ingestionPriority = (reason: IngestionJob["reason"]): number => {
  switch (reason) {
    case "manual": return 0;
    case "active-editor": return 1;
    case "git": return 2;
    case "file": return 3;
    case "workspace": return 4;
    case "startup": return 5;
    case "storage-recovery": return 1;
  }
};
