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
};

export class BackgroundWorkerCoordinator {
  private activeWorkers = new Map<BackgroundWorkerKind, ActiveWorker>();
  private activeInput?: BackgroundWorkerInput;
  private activeOnEvent?: (event: BackgroundWorkerEvent) => void;
  private generation = 0;

  start(
    root: string,
    onEvent: (event: BackgroundWorkerEvent) => void,
    input: BackgroundWorkerInput
  ): void {
    if (
      this.activeInput &&
      this.activeWorkers.size > 0 &&
      samePromotedInput(this.activeInput, input)
    )
      return;
    this.stopActive("superseded");
    const generation = ++this.generation;
    this.activeInput = input;
    this.activeOnEvent = onEvent;
    for (const kind of ["qa", "security", "performance", "modernization"] as const) {
      const evidence = input.canonicalEvidence[kind];
      const workerId = `${kind}-${generation}`;
      const startedAt = new Date().toISOString();
      const metadata = {
        root,
        kind,
        workerId,
        snapshotDigest: input.snapshotDigest,
        extractionRunId: input.extractionRunId,
        scopePaths: evidence.paths,
        startedAt
      } as const;
      onEvent({ ...metadata, status: "running", result: undefined });
      const worker = new Worker(path.join(__dirname, "../workers/backgroundAnalysisWorker.js"), {
        workerData: { ...input, kind, workerId, startedAt }
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
        active.settled = true;
        this.activeWorkers.delete(kind);
        const completedAt = new Date().toISOString();
        const durationMs = Date.parse(completedAt) - Date.parse(startedAt);
        const error = `${kind} background worker timed out after 120000ms; other workers continue.`;
        void persistWorkerRecord(input, {
          ...metadata,
          workerStatus: "failed",
          completedAt,
          durationMs,
          error
        });
        onEvent({ ...metadata, completedAt, durationMs, status: "failed", error });
        void worker
          .terminate()
          .catch(() => undefined)
          .catch(() => undefined);
      }, 120_000);
      active.timeout = timeout;
      const publish = (event: Omit<BackgroundWorkerEvent, "root" | "kind">): void => {
        if (generation !== this.generation || active.settled) return;
        active.settled = event.status !== "running";
        if (active.settled) {
          clearTimeout(timeout);
          this.activeWorkers.delete(kind);
        }
        onEvent({ ...metadata, ...event, root, kind });
      };
      worker.on("message", (event) =>
        publish(event as Omit<BackgroundWorkerEvent, "root" | "kind">)
      );
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
  }

  dispose(reason: "cancelled" | "superseded" = "cancelled"): void {
    this.stopActive(reason);
  }

  private stopActive(reason: "cancelled" | "superseded"): void {
    if (!this.activeWorkers.size) {
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
    const onEvent = this.activeOnEvent;
    this.activeWorkers.clear();
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
        durationMs
      } as const;
      onEvent?.(event);
      void persistWorkerRecord(item.input, {
        ...item.metadata,
        workerStatus: status,
        reason: message,
        error: message,
        completedAt,
        durationMs
      });
      void item.worker.terminate().catch(() => undefined);
    }
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
  };
  generation: number;
  settled: boolean;
  timeout?: NodeJS.Timeout;
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
