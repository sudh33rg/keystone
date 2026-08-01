import path from 'node:path';
import { Worker } from 'node:worker_threads';

export type BackgroundWorkerKind = 'qa' | 'security' | 'performance' | 'modernization';
export type BackgroundWorkerEvent = { root: string; kind: BackgroundWorkerKind; status: 'running' | 'complete' | 'failed'; result?: any; error?: string };

export class BackgroundWorkerCoordinator {
  private workers: Worker[] = [];
  private generation = 0;

  start(root: string, onEvent: (event: BackgroundWorkerEvent) => void): void {
    this.dispose();
    const generation = ++this.generation;
    for (const kind of ['qa', 'security', 'performance', 'modernization'] as const) {
      onEvent({ root, kind, status: 'running' });
      const worker = new Worker(path.join(__dirname, '../workers/backgroundAnalysisWorker.js'), { workerData: { kind, root } });
      let settled = false;
      const publish = (event: BackgroundWorkerEvent): void => {
        if (generation !== this.generation || settled) return;
        settled = event.status !== 'running';
        onEvent({ ...event, root });
      };
      worker.on('message', event => publish(event as BackgroundWorkerEvent));
      worker.on('error', error => publish({ root, kind, status: 'failed', error: error instanceof Error ? error.message : String(error) }));
      worker.on('exit', code => {
        if (code !== 0) publish({ root, kind, status: 'failed', error: `${kind} worker exited with code ${code}.` });
      });
      this.workers.push(worker);
    }
  }

  dispose(): void {
    this.generation += 1;
    for (const worker of this.workers) void worker.terminate();
    this.workers = [];
  }
}
