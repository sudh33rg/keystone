import { Worker } from "node:worker_threads";
import type { SerializedStageContext, StageProjection } from "./pipeline";

export function runStageInWorker(
  workerPath: string,
  stageId: string,
  context: SerializedStageContext,
  signal?: AbortSignal
): Promise<StageProjection> {
  return new Promise<StageProjection>((resolve, reject) => {
    const worker = new Worker(workerPath);
    let settled = false;
    const cleanup = (): void => signal?.removeEventListener("abort", onAbort);
    const finish = (callback: () => void): void => {
      if (settled) return;
      settled = true;
      cleanup();
      void worker.terminate().finally(callback);
    };
    const onAbort = (): void =>
      finish(() => reject(new Error(`Intelligence stage ${stageId} was cancelled.`)));
    signal?.addEventListener("abort", onAbort, { once: true });
    worker.once(
      "message",
      (message: { ok: true; result: StageProjection } | { ok: false; error: string }) => {
        if (message.ok) finish(() => resolve(message.result));
        else finish(() => reject(new Error(message.error)));
      }
    );
    worker.once("error", (error) =>
      finish(() => reject(error instanceof Error ? error : new Error(String(error))))
    );
    worker.once("exit", (code) => {
      if (settled) return;
      finish(() =>
        reject(new Error(`Intelligence stage ${stageId} worker exited with code ${code}.`))
      );
    });
    worker.postMessage({ stageId, context });
  });
}
