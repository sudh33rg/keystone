import { availableParallelism } from "node:os";
import { Worker } from "node:worker_threads";

export type WorkerTaskPriority = 0 | 1 | 2 | 3;

export interface WorkerTaskOptions {
  priority?: WorkerTaskPriority;
  signal?: AbortSignal;
}

export interface WorkerPoolStatus {
  active: number;
  queued: number;
  capacity: number;
  failedRestarts: number;
  operations: string[];
}

type WorkerOperation =
  | { operation: "sha256"; value: ArrayBuffer }
  | { operation: "parse-json"; value: string }
  | { operation: "stringify-json"; value: unknown }
  | { operation: "gzip"; value: ArrayBuffer }
  | { operation: "gunzip-json"; value: ArrayBuffer }
  | { operation: "test-delay"; value: number }
  | { operation: "test-crash" };

interface PendingTask {
  id: number;
  operation: WorkerOperation;
  transfer: ArrayBuffer[];
  priority: WorkerTaskPriority;
  sequence: number;
  signal?: AbortSignal;
  abortListener?: () => void;
  settled: boolean;
  resolve(value: unknown): void;
  reject(cause: Error): void;
}

interface PoolWorker {
  id: number;
  worker: Worker;
  task?: PendingTask;
}

const WORKER_SOURCE = `
const { createHash } = require("node:crypto");
const { gzipSync, gunzipSync } = require("node:zlib");
const { parentPort } = require("node:worker_threads");
parentPort.on("message", (message) => {
  try {
    let value;
    if (message.operation === "sha256") {
      value = "sha256:" + createHash("sha256").update(Buffer.from(message.value)).digest("hex");
    } else if (message.operation === "parse-json") {
      value = JSON.parse(message.value);
    } else if (message.operation === "stringify-json") {
      value = JSON.stringify(message.value);
    } else if (message.operation === "gzip") {
      value = Uint8Array.from(gzipSync(Buffer.from(message.value))).buffer;
    } else if (message.operation === "gunzip-json") {
      value = JSON.parse(gunzipSync(Buffer.from(message.value)).toString("utf8"));
    } else if (message.operation === "test-delay") {
      setTimeout(() => parentPort.postMessage({ id: message.id, ok: true, value: null }), message.value);
      return;
    } else if (message.operation === "test-crash") {
      process.exit(73);
    } else {
      throw new Error("Unsupported intelligence worker operation.");
    }
    parentPort.postMessage({ id: message.id, ok: true, value }, value instanceof ArrayBuffer ? [value] : []);
  } catch (error) {
    parentPort.postMessage({ id: message.id, ok: false, error: error instanceof Error ? error.message : String(error) });
  }
});`;

class PersistentWorkerPool {
  private readonly workers: PoolWorker[] = [];
  private readonly queue: PendingTask[] = [];
  private nextTaskId = 0;
  private nextWorkerId = 0;
  private sequence = 0;
  private disposed = false;

  constructor(
    capacity: number,
    private readonly onStatus: (failed: boolean) => void,
  ) {
    for (let index = 0; index < capacity; index++) this.workers.push(this.createWorker());
  }

  get status(): Omit<WorkerPoolStatus, "failedRestarts"> {
    return {
      active: this.workers.filter((item) => item.task !== undefined).length,
      queued: this.queue.length,
      capacity: this.workers.length,
      operations: this.workers.flatMap((item) =>
        item.task ? [item.task.operation.operation] : [],
      ),
    };
  }

  run(
    operation: WorkerOperation,
    transfer: ArrayBuffer[] = [],
    options: WorkerTaskOptions = {},
  ): Promise<unknown> {
    if (this.disposed)
      return Promise.reject(new Error("The intelligence worker pool is disposed."));
    if (options.signal?.aborted) return Promise.reject(abortError());
    return new Promise((resolve, reject) => {
      const task: PendingTask = {
        id: ++this.nextTaskId,
        operation,
        transfer,
        priority: options.priority ?? 2,
        sequence: ++this.sequence,
        ...(options.signal ? { signal: options.signal } : {}),
        settled: false,
        resolve,
        reject,
      };
      if (options.signal) {
        task.abortListener = () => this.cancelTask(task);
        options.signal.addEventListener("abort", task.abortListener, { once: true });
      }
      this.queue.push(task);
      this.queue.sort(
        (left, right) => left.priority - right.priority || left.sequence - right.sequence,
      );
      this.dispatch();
    });
  }

  async dispose(): Promise<void> {
    if (this.disposed) return;
    this.disposed = true;
    for (const task of this.queue.splice(0))
      this.rejectTask(task, new Error("The intelligence worker pool was disposed."));
    for (const item of this.workers) {
      if (item.task)
        this.rejectTask(item.task, new Error("The intelligence worker pool was disposed."));
      item.task = undefined;
    }
    await Promise.all(this.workers.map((item) => item.worker.terminate()));
    this.workers.length = 0;
    this.onStatus(false);
  }

  private createWorker(): PoolWorker {
    const item: PoolWorker = {
      id: ++this.nextWorkerId,
      worker: new Worker(WORKER_SOURCE, { eval: true }),
    };
    item.worker.on("message", (message: unknown) => this.complete(item, message));
    item.worker.on("error", (cause) =>
      this.failWorker(item, cause instanceof Error ? cause : new Error(String(cause))),
    );
    item.worker.on("exit", (code) => {
      if (!this.disposed && code !== 0 && this.workers.includes(item))
        this.failWorker(item, new Error(`Intelligence worker exited with code ${code}.`));
    });
    return item;
  }

  private dispatch(): void {
    for (const item of this.workers) {
      if (item.task) continue;
      const task = this.queue.shift();
      if (!task) break;
      if (
        task.priority === 3 &&
        this.workers.length > 1 &&
        this.workers.filter((worker) => worker.task !== undefined).length >= this.workers.length - 1
      ) {
        this.queue.unshift(task);
        break;
      }
      if (task.signal?.aborted) {
        this.rejectTask(task, abortError());
        continue;
      }
      item.task = task;
      item.worker.postMessage({ id: task.id, ...task.operation }, task.transfer);
    }
    this.onStatus(false);
  }

  private complete(item: PoolWorker, message: unknown): void {
    const task = item.task;
    if (!task) return;
    item.task = undefined;
    if (
      message &&
      typeof message === "object" &&
      "id" in message &&
      message.id === task.id &&
      "ok" in message &&
      message.ok === true &&
      "value" in message
    ) {
      this.resolveTask(task, message.value);
    } else {
      const error =
        message &&
        typeof message === "object" &&
        "error" in message &&
        typeof message.error === "string"
          ? message.error
          : "Intelligence worker task failed.";
      this.rejectTask(task, new Error(error));
    }
    this.dispatch();
  }

  private cancelTask(task: PendingTask): void {
    const queuedIndex = this.queue.indexOf(task);
    if (queuedIndex >= 0) {
      this.queue.splice(queuedIndex, 1);
      this.rejectTask(task, abortError());
      this.onStatus(false);
      return;
    }
    const item = this.workers.find((candidate) => candidate.task === task);
    if (!item) return;
    item.task = undefined;
    this.rejectTask(task, abortError());
    this.replaceWorker(item, false);
  }

  private failWorker(item: PoolWorker, cause: Error): void {
    if (item.task) this.rejectTask(item.task, cause);
    item.task = undefined;
    this.replaceWorker(item, true);
  }

  private replaceWorker(item: PoolWorker, failed: boolean): void {
    const index = this.workers.indexOf(item);
    if (index < 0 || this.disposed) return;
    this.workers[index] = this.createWorker();
    void item.worker.terminate();
    this.onStatus(failed);
    this.dispatch();
  }

  private resolveTask(task: PendingTask, value: unknown): void {
    if (task.settled) return;
    task.settled = true;
    this.detachAbort(task);
    task.resolve(value);
  }

  private rejectTask(task: PendingTask, cause: Error): void {
    if (task.settled) return;
    task.settled = true;
    this.detachAbort(task);
    task.reject(cause);
  }

  private detachAbort(task: PendingTask): void {
    if (task.signal && task.abortListener)
      task.signal.removeEventListener("abort", task.abortListener);
  }
}

export class WorkerPoolManager {
  private readonly listeners = new Set<(status: WorkerPoolStatus) => void>();
  private readonly fastPool: PersistentWorkerPool;
  private readonly storagePool: PersistentWorkerPool;
  private failedRestarts = 0;
  private readonly externalWorkers = new Set<{
    getStatus(): WorkerPoolStatus;
    onDidChange(listener: () => void): { dispose(): void };
  }>();
  private readonly externalDisposables: Array<{ dispose(): void }> = [];

  constructor(requestedWorkerCount = 0, legacyStorageCapacity?: number) {
    const processors = availableParallelism();
    const total =
      legacyStorageCapacity === undefined
        ? requestedWorkerCount > 0
          ? Math.max(2, Math.min(requestedWorkerCount, Math.max(2, processors - 1)))
          : 2
        : Math.max(2, requestedWorkerCount + legacyStorageCapacity);
    const storageCapacity = legacyStorageCapacity ?? 1;
    this.fastPool = new PersistentWorkerPool(
      Math.max(1, total - storageCapacity),
      this.handleStatus,
    );
    this.storagePool = new PersistentWorkerPool(Math.max(1, storageCapacity), this.handleStatus);
  }

  getStatus(): WorkerPoolStatus {
    const fast = this.fastPool.status;
    const storage = this.storagePool.status;
    const external = [...this.externalWorkers].map((item) => item.getStatus());
    return {
      active: fast.active + storage.active + external.reduce((sum, item) => sum + item.active, 0),
      queued: fast.queued + storage.queued + external.reduce((sum, item) => sum + item.queued, 0),
      capacity:
        fast.capacity + storage.capacity + external.reduce((sum, item) => sum + item.capacity, 0),
      failedRestarts:
        this.failedRestarts + external.reduce((sum, item) => sum + item.failedRestarts, 0),
      operations: [
        ...fast.operations,
        ...storage.operations,
        ...external.flatMap((item) => item.operations),
      ].slice(0, 20),
    };
  }

  attach(worker: {
    getStatus(): WorkerPoolStatus;
    onDidChange(listener: () => void): { dispose(): void };
  }): { dispose(): void } {
    this.externalWorkers.add(worker);
    const subscription = worker.onDidChange(() => this.handleStatus(false));
    this.externalDisposables.push(subscription);
    this.handleStatus(false);
    return {
      dispose: () => {
        subscription.dispose();
        this.externalWorkers.delete(worker);
        this.handleStatus(false);
      },
    };
  }

  onDidChange(listener: (status: WorkerPoolStatus) => void): { dispose(): void } {
    this.listeners.add(listener);
    return { dispose: () => this.listeners.delete(listener) };
  }

  async sha256(value: Uint8Array, options: WorkerTaskOptions = {}): Promise<string> {
    const transferable = Uint8Array.from(value).buffer;
    const result = await this.fastPool.run(
      { operation: "sha256", value: transferable },
      [transferable],
      options,
    );
    if (typeof result !== "string")
      throw new Error("Intelligence hash worker returned an invalid result.");
    return result;
  }

  parseJson(value: string, options: WorkerTaskOptions = {}): Promise<unknown> {
    return this.storagePool.run({ operation: "parse-json", value }, [], options);
  }

  async stringifyJson(value: unknown, options: WorkerTaskOptions = {}): Promise<string> {
    const result = await this.storagePool.run({ operation: "stringify-json", value }, [], options);
    if (typeof result !== "string")
      throw new Error("Intelligence serialization worker returned an invalid result.");
    return result;
  }

  async gzip(value: Uint8Array, options: WorkerTaskOptions = {}): Promise<Uint8Array> {
    const transferable = Uint8Array.from(value).buffer;
    const result = await this.storagePool.run(
      { operation: "gzip", value: transferable },
      [transferable],
      options,
    );
    if (!(result instanceof ArrayBuffer))
      throw new Error("Intelligence compression worker returned an invalid result.");
    return new Uint8Array(result);
  }

  parseGzipJson(value: Uint8Array, options: WorkerTaskOptions = {}): Promise<unknown> {
    const transferable = Uint8Array.from(value).buffer;
    return this.storagePool.run(
      { operation: "gunzip-json", value: transferable },
      [transferable],
      options,
    );
  }

  async simulateFailureForTest(): Promise<void> {
    await this.fastPool.run({ operation: "test-crash" });
  }

  async delayForTest(milliseconds: number, options: WorkerTaskOptions = {}): Promise<void> {
    await this.fastPool.run({ operation: "test-delay", value: milliseconds }, [], options);
  }

  async dispose(): Promise<void> {
    for (const disposable of this.externalDisposables.splice(0)) disposable.dispose();
    this.externalWorkers.clear();
    await Promise.all([this.fastPool.dispose(), this.storagePool.dispose()]);
    this.listeners.clear();
  }

  private readonly handleStatus = (failed: boolean): void => {
    if (failed) this.failedRestarts += 1;
    const status = this.getStatus();
    for (const listener of this.listeners) listener(status);
  };
}

function abortError(): Error {
  const error = new Error("The intelligence worker task was cancelled.");
  error.name = "AbortError";
  return error;
}
