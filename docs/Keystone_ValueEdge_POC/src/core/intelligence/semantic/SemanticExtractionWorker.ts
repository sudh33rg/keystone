import { join } from "node:path";
import { Worker } from "node:worker_threads";
import type { WorkerPoolStatus } from "../runtime/WorkerPoolManager";
import type { SemanticProjectRequest, SemanticProjectResult } from "./SemanticModel";

interface PendingRequest {
  resolve(value: SemanticProjectResult): void;
  reject(cause: Error): void;
  signal?: AbortSignal;
  abort?: () => void;
}

export interface SemanticExtractor {
  extract(request: SemanticProjectRequest, signal?: AbortSignal): Promise<SemanticProjectResult>;
  getStatus(): WorkerPoolStatus;
  onDidChange(listener: () => void): { dispose(): void };
  dispose(): Promise<void>;
}

export class SemanticExtractionWorker implements SemanticExtractor {
  private worker: Worker;
  private readonly pending = new Map<number, PendingRequest>();
  private readonly listeners = new Set<() => void>();
  private sequence = 0;
  private restarts = 0;
  private disposed = false;

  constructor(private readonly workerPath = join(__dirname, "semantic-worker.js")) {
    this.worker = this.createWorker(workerPath);
  }

  extract(request: SemanticProjectRequest, signal?: AbortSignal): Promise<SemanticProjectResult> {
    if (this.disposed)
      return Promise.reject(new Error("The semantic extraction worker is disposed."));
    if (signal?.aborted) return Promise.reject(abortError());
    const id = ++this.sequence;
    return new Promise((resolve, reject) => {
      const pending: PendingRequest = { resolve, reject, ...(signal ? { signal } : {}) };
      if (signal) {
        pending.abort = () => {
          this.pending.delete(id);
          pending.reject(abortError());
          // The worker keeps its project context and finishes the already-running
          // extraction off-thread. Its late result is ignored, and the next request
          // is processed afterwards. Restarting here turns every preemption into an
          // expensive full rebuild because the incremental compiler context is lost.
          this.emit();
        };
        signal.addEventListener("abort", pending.abort, { once: true });
      }
      this.pending.set(id, pending);
      this.worker.postMessage({ type: "extract", id, request });
      this.emit();
    });
  }

  getStatus(): WorkerPoolStatus {
    return {
      active: this.pending.size > 0 ? 1 : 0,
      queued: Math.max(0, this.pending.size - 1),
      capacity: 1,
      failedRestarts: this.restarts,
      operations: this.pending.size > 0 ? ["typescript-semantic"] : [],
    };
  }

  onDidChange(listener: () => void): { dispose(): void } {
    this.listeners.add(listener);
    return { dispose: () => this.listeners.delete(listener) };
  }

  async dispose(): Promise<void> {
    if (this.disposed) return;
    this.disposed = true;
    for (const pending of this.pending.values())
      pending.reject(new Error("The semantic extraction worker was disposed."));
    this.pending.clear();
    await this.worker.terminate();
    this.listeners.clear();
  }

  private createWorker(path: string): Worker {
    const worker = new Worker(path);
    worker.on("message", (message: unknown) => this.complete(message));
    worker.on("error", (cause) =>
      this.restart(path, cause instanceof Error ? cause : new Error(String(cause))),
    );
    worker.on("exit", (code) => {
      if (!this.disposed && code !== 0 && worker === this.worker)
        this.restart(path, new Error(`Semantic worker exited with code ${code}.`));
    });
    return worker;
  }

  private complete(message: unknown): void {
    if (
      !message ||
      typeof message !== "object" ||
      !("id" in message) ||
      typeof message.id !== "number"
    )
      return;
    const pending = this.pending.get(message.id);
    if (!pending) return;
    this.pending.delete(message.id);
    if (pending.signal && pending.abort) pending.signal.removeEventListener("abort", pending.abort);
    if ("ok" in message && message.ok === true && "result" in message)
      pending.resolve(message.result as SemanticProjectResult);
    else
      pending.reject(
        new Error(
          "error" in message && typeof message.error === "string"
            ? message.error
            : "Semantic extraction failed.",
        ),
      );
    this.emit();
  }

  private restart(path: string, cause: Error, failed = true): void {
    if (this.disposed) return;
    if (failed) this.restarts += 1;
    for (const pending of this.pending.values()) pending.reject(cause);
    this.pending.clear();
    void this.worker.terminate();
    this.worker = this.createWorker(path);
    this.emit();
  }

  private emit(): void {
    for (const listener of this.listeners) listener();
  }
}

function abortError(): Error {
  const error = new Error("Semantic extraction was cancelled.");
  error.name = "AbortError";
  return error;
}
