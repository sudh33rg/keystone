import path from "node:path";
import fs from "node:fs/promises";
import { Worker } from "node:worker_threads";
import type { OkfCanonicalEvidenceEnvelope } from "@core/intelligence/okf/types";

export type BackgroundWorkerKind = "qa" | "security" | "performance" | "modernization";
export interface BackgroundWorkerInput {
  root: string;
  snapshotPath: string;
  intelligencePath: string;
  snapshotDigest: string;
  extractionRunId: string;
  canonicalEvidence: Record<BackgroundWorkerKind, OkfCanonicalEvidenceEnvelope>;
  recovery?: Partial<Record<BackgroundWorkerKind, BackgroundWorkerRecovery>>;
}
export interface BackgroundWorkerRecovery {
  nextAttempt: number;
  retryAt?: string;
  previousWorkerId?: string;
  previousStartedAt?: string;
}
export interface BackgroundWorkerCoordinatorOptions {
  maxRetries?: number;
  timeoutMs?: number;
  retryDelayMs?: number;
}
export type BackgroundWorkerEvent = {
  root: string;
  kind: BackgroundWorkerKind;
  status: "running" | "complete" | "failed" | "cancelled" | "stale";
  result?: any;
  error?: string;
  reason?: string;
  workerId?: string;
  snapshotDigest?: string;
  extractionRunId?: string;
  scopePaths?: readonly string[];
  startedAt?: string;
  completedAt?: string;
  durationMs?: number;
  attempt?: number;
  maxAttempts?: number;
  retryCount?: number;
  retryAt?: string;
  retrying?: boolean;
};

export class BackgroundWorkerCoordinator {
  private activeWorkers = new Map<BackgroundWorkerKind, ActiveWorker>();
  private pendingRetries = new Map<BackgroundWorkerKind, PendingRetry>();
  private readonly maxRetries: number;
  private readonly timeoutMs: number;
  private readonly retryDelayMs: number;
  private activeInput?: BackgroundWorkerInput;
  private activeOnEvent?: (event: BackgroundWorkerEvent) => void;
  private generation = 0;

  constructor(options: BackgroundWorkerCoordinatorOptions = {}) {
    this.maxRetries = boundedInteger(options.maxRetries, 2, 0, 5);
    this.timeoutMs = boundedInteger(options.timeoutMs, 120_000, 1_000, 600_000);
    this.retryDelayMs = boundedInteger(options.retryDelayMs, 750, 100, 30_000);
  }

  start(
    root: string,
    onEvent: (event: BackgroundWorkerEvent) => void,
    input: BackgroundWorkerInput
  ): void {
    if (
      this.activeInput &&
      (this.activeWorkers.size > 0 || this.pendingRetries.size > 0) &&
      samePromotedInput(this.activeInput, input)
    )
      return;
    this.stopActive("superseded");
    const generation = ++this.generation;
    this.activeInput = input;
    this.activeOnEvent = onEvent;
    for (const kind of ["qa", "security", "performance", "modernization"] as const) {
      const recovery = input.recovery?.[kind];
      if (recovery) this.resumeWorker(root, onEvent, input, kind, generation, recovery);
      else this.launchWorker(root, onEvent, input, kind, generation, 1);
    }
  }

  dispose(reason: "cancelled" | "superseded" = "cancelled"): void {
    this.stopActive(reason);
  }

  private stopActive(reason: "cancelled" | "superseded"): void {
    if (!this.activeWorkers.size && !this.pendingRetries.size) {
      this.activeInput = undefined;
      this.activeOnEvent = undefined;
      return;
    }
    this.generation += 1;
    const status = reason === "superseded" ? "stale" : "cancelled";
    const message =
      reason === "superseded"
        ? "Worker run superseded by a newer promoted OKF snapshot."
        : "Worker run cancelled before completion.";
    const active = [...this.activeWorkers.values()];
    const pending = [...this.pendingRetries.values()];
    const onEvent = this.activeOnEvent;
    this.activeWorkers.clear();
    for (const item of pending) clearTimeout(item.timer);
    this.pendingRetries.clear();
    this.activeInput = undefined;
    this.activeOnEvent = undefined;
    for (const item of active) {
      item.settled = true;
      if (item.timeout) clearTimeout(item.timeout);
      const completedAt = new Date().toISOString();
      const durationMs = Date.parse(completedAt) - Date.parse(item.metadata.startedAt);
      const event = {
        ...item.metadata,
        status,
        reason: message,
        error: message,
        completedAt,
        durationMs,
        attempt: item.metadata.attempt,
        maxAttempts: item.metadata.maxAttempts,
        retryCount: item.metadata.retryCount
      } as const;
      onEvent?.(event);
      void persistWorkerRecord(item.input, {
        ...item.metadata,
        workerStatus: status,
        reason: message,
        error: message,
        completedAt,
        durationMs,
        attempt: item.metadata.attempt,
        maxAttempts: item.metadata.maxAttempts,
        retryCount: item.metadata.retryCount
      });
      void item.worker.terminate().catch(() => undefined);
    }
    for (const item of pending) {
      const completedAt = new Date().toISOString();
      const durationMs = Date.parse(completedAt) - Date.parse(item.metadata.startedAt);
      const event = {
        ...item.metadata,
        status,
        reason: message,
        error: message,
        completedAt,
        durationMs,
        retryAt: item.retryAt
      } as const;
      onEvent?.(event);
      void persistWorkerRecord(item.input, {
        ...item.metadata,
        workerStatus: status,
        reason: message,
        error: message,
        completedAt,
        durationMs,
        retryAt: item.retryAt
      });
    }
  }

  private launchWorker(
    root: string,
    onEvent: (event: BackgroundWorkerEvent) => void,
    input: BackgroundWorkerInput,
    kind: BackgroundWorkerKind,
    generation: number,
    attempt: number
  ): void {
    if (generation !== this.generation) return;
    const evidence = input.canonicalEvidence[kind];
    const maxAttempts = this.maxRetries + 1;
    const workerId = `${kind}-${generation}-${attempt}`;
    const startedAt = new Date().toISOString();
    const metadata = {
      root,
      kind,
      workerId,
      snapshotDigest: input.snapshotDigest,
      extractionRunId: input.extractionRunId,
      scopePaths: evidence.paths,
      startedAt,
      attempt,
      maxAttempts,
      retryCount: attempt - 1
    } as const;
    onEvent({ ...metadata, status: "running", result: undefined });
    const worker = new Worker(path.join(__dirname, "../workers/backgroundAnalysisWorker.js"), {
      workerData: { ...input, kind, workerId, startedAt, attempt, maxAttempts }
    });
    const active: ActiveWorker = {
      kind,
      worker,
      input,
      metadata,
      generation,
      settled: false,
      timeout: undefined
    };
    this.activeWorkers.set(kind, active);
    const timeout = setTimeout(() => {
      if (generation !== this.generation || active.settled) return;
      this.failWorker(active, `${kind} background worker timed out after ${this.timeoutMs}ms.`);
    }, this.timeoutMs);
    active.timeout = timeout;
    const publish = (event: Omit<BackgroundWorkerEvent, "root" | "kind">): void => {
      if (generation !== this.generation || active.settled) return;
      if (event.status === "failed") {
        this.failWorker(active, event.error ?? `${kind} background worker failed.`);
        return;
      }
      active.settled = event.status !== "running";
      if (active.settled) {
        clearTimeout(timeout);
        this.activeWorkers.delete(kind);
      }
      onEvent({ ...metadata, ...event, root, kind });
    };
    worker.on("message", (event) => publish(event as Omit<BackgroundWorkerEvent, "root" | "kind">));
    worker.on("error", (error) =>
      publish({
        status: "failed",
        error: error instanceof Error ? error.message : String(error)
      })
    );
    worker.on("exit", (code) => {
      if (code !== 0)
        publish({
          status: "failed",
          error: `${kind} worker exited with code ${code}.`
        });
    });
  }

  private resumeWorker(
    root: string,
    onEvent: (event: BackgroundWorkerEvent) => void,
    input: BackgroundWorkerInput,
    kind: BackgroundWorkerKind,
    generation: number,
    recovery: BackgroundWorkerRecovery
  ): void {
    const maxAttempts = this.maxRetries + 1;
    const nextAttempt = Math.max(1, Math.min(maxAttempts, Math.floor(recovery.nextAttempt)));
    const previousAttempt = Math.max(1, nextAttempt - 1);
    const metadata = {
      root,
      kind,
      workerId: recovery.previousWorkerId ?? `${kind}-${generation}-recovery`,
      snapshotDigest: input.snapshotDigest,
      extractionRunId: input.extractionRunId,
      scopePaths: input.canonicalEvidence[kind].paths,
      startedAt: recovery.previousStartedAt ?? new Date().toISOString(),
      attempt: previousAttempt,
      maxAttempts,
      retryCount: previousAttempt - 1
    } as const;
    const retryAt = recovery.retryAt ?? new Date().toISOString();
    const reason = `${kind} worker recovery resumed after host restart (attempt ${nextAttempt}/${maxAttempts}).`;
    onEvent({
      ...metadata,
      status: "failed",
      error: reason,
      reason,
      retryAt,
      retrying: true
    });
    this.scheduleRetry(kind, input, generation, metadata, nextAttempt, retryAt);
  }

  private failWorker(active: ActiveWorker, error: string): void {
    if (active.settled || active.generation !== this.generation) return;
    active.settled = true;
    if (active.timeout) clearTimeout(active.timeout);
    this.activeWorkers.delete(active.kind);
    const completedAt = new Date().toISOString();
    const durationMs = Date.parse(completedAt) - Date.parse(active.metadata.startedAt);
    const canRetry = active.metadata.attempt < active.metadata.maxAttempts;
    const retryAt = canRetry ? new Date(Date.now() + this.retryDelayMs).toISOString() : undefined;
    const reason = canRetry
      ? `${error} Retrying ${active.kind} worker (attempt ${active.metadata.attempt + 1}/${active.metadata.maxAttempts}).`
      : error;
    void persistWorkerRecord(active.input, {
      ...active.metadata,
      workerStatus: "failed",
      completedAt,
      durationMs,
      error,
      reason: canRetry ? reason : undefined,
      retryAt
    });
    this.activeOnEvent?.({
      ...active.metadata,
      completedAt,
      durationMs,
      status: "failed",
      error: reason,
      reason: canRetry ? reason : undefined,
      retryAt,
      retrying: canRetry
    });
    void active.worker.terminate().catch(() => undefined);
    if (!canRetry) return;
    this.scheduleRetry(
      active.kind,
      active.input,
      active.generation,
      active.metadata,
      active.metadata.attempt + 1,
      retryAt!
    );
  }

  private scheduleRetry(
    kind: BackgroundWorkerKind,
    input: BackgroundWorkerInput,
    generation: number,
    metadata: ActiveWorker["metadata"],
    nextAttempt: number,
    retryAt: string
  ): void {
    const delay = Math.max(0, Date.parse(retryAt) - Date.now());
    const pending: PendingRetry = {
      kind,
      input,
      metadata,
      generation,
      nextAttempt,
      retryAt,
      timer: setTimeout(() => {
        this.pendingRetries.delete(kind);
        this.launchWorker(
          metadata.root,
          this.activeOnEvent ?? (() => undefined),
          input,
          kind,
          generation,
          nextAttempt
        );
      }, delay)
    };
    this.pendingRetries.set(kind, pending);
  }
}

interface ActiveWorker {
  kind: BackgroundWorkerKind;
  worker: Worker;
  input: BackgroundWorkerInput;
  metadata: {
    root: string;
    kind: BackgroundWorkerKind;
    workerId: string;
    snapshotDigest: string;
    extractionRunId: string;
    scopePaths: readonly string[];
    startedAt: string;
    attempt: number;
    maxAttempts: number;
    retryCount: number;
  };
  generation: number;
  settled: boolean;
  timeout?: NodeJS.Timeout;
}

interface PendingRetry {
  kind: BackgroundWorkerKind;
  input: BackgroundWorkerInput;
  metadata: ActiveWorker["metadata"];
  generation: number;
  nextAttempt: number;
  retryAt: string;
  timer: NodeJS.Timeout;
}

function boundedInteger(
  value: number | undefined,
  fallback: number,
  minimum: number,
  maximum: number
): number {
  return Number.isFinite(value)
    ? Math.max(minimum, Math.min(maximum, Math.floor(value!)))
    : fallback;
}

function samePromotedInput(left: BackgroundWorkerInput, right: BackgroundWorkerInput): boolean {
  return (
    left.root === right.root &&
    left.snapshotDigest === right.snapshotDigest &&
    left.extractionRunId === right.extractionRunId
  );
}

async function persistWorkerRecord(
  input: BackgroundWorkerInput,
  value: {
    kind: BackgroundWorkerKind;
    workerId: string;
    snapshotDigest: string;
    extractionRunId: string;
    scopePaths: readonly string[];
    startedAt: string;
    completedAt: string;
    durationMs: number;
    workerStatus: "failed" | "cancelled" | "stale";
    error?: string;
    reason?: string;
    attempt: number;
    maxAttempts: number;
    retryCount: number;
    retryAt?: string;
  }
): Promise<void> {
  const target = path.join(input.root, ".keystone", "background", `${value.kind}.json`);
  const temporary = `${target}.${process.pid}.${Date.now()}.tmp`;
  try {
    await fs.mkdir(path.dirname(target), { recursive: true });
    try {
      const existing = JSON.parse(await fs.readFile(target, "utf8")) as {
        snapshotDigest?: string;
        startedAt?: string;
      };
      if (
        existing.snapshotDigest &&
        (existing.snapshotDigest !== value.snapshotDigest ||
          (existing.startedAt && Date.parse(existing.startedAt) > Date.parse(value.startedAt)))
      )
        return;
    } catch {
      // The record may not exist yet; the atomic write below creates it.
    }
    await fs.writeFile(
      temporary,
      `${JSON.stringify(
        {
          kind: value.kind,
          workerStatus: value.workerStatus,
          error: value.error,
          reason: value.reason,
          workerId: value.workerId,
          snapshotDigest: value.snapshotDigest,
          extractionRunId: value.extractionRunId,
          scopePaths: value.scopePaths,
          startedAt: value.startedAt,
          completedAt: value.completedAt,
          durationMs: value.durationMs,
          attempt: value.attempt,
          maxAttempts: value.maxAttempts,
          retryCount: value.retryCount,
          retryAt: value.retryAt,
          generatedAt: value.completedAt
        },
        null,
        2
      )}\n`,
      "utf8"
    );
    await fs.rename(temporary, target);
  } catch {
    await fs.rm(temporary, { force: true }).catch(() => undefined);
  }
}
