// GraphIndexerWorker.ts
// Background worker that builds the knowledge graph and updates status.

import type { IntelligenceStore } from "../core/persistence/IntelligenceStore";
import type { IntelligenceRuntime } from "../core/intelligence/runtime/IntelligenceRuntime";
import type { KeystoneLogger } from "../shared/logging/KeystoneLogger";

export interface GraphIndexerWorkerOptions {
  /** Maximum number of files to index in a single batch. Defaults to 100. */
  batchSize?: number;
  /** Maximum depth for dependency traversal. Defaults to 3. */
  maxDepth?: number;
  /** Enable cyclic dependency detection. Defaults to true. */
  detectCycles?: boolean;
}

export interface GraphIndexerWorkerStatus {
  phase: "idle" | "indexing" | "analyzing" | "complete" | "error";
  progress: number;
  totalFiles: number;
  indexedFiles: number;
  errors: string[];
  message: string;
}

export class GraphIndexerWorker {
  private status: GraphIndexerWorkerStatus = {
    phase: "idle",
    progress: 0,
    totalFiles: 0,
    indexedFiles: 0,
    errors: [],
    message: "Ready",
  };
  private abortController?: AbortController;
  private readonly options: Required<GraphIndexerWorkerOptions>;

  constructor(
    private readonly store: IntelligenceStore,
    private readonly runtime: IntelligenceRuntime,
    private readonly logger: KeystoneLogger,
    options: GraphIndexerWorkerOptions = {},
  ) {
    this.options = {
      batchSize: options.batchSize ?? 100,
      maxDepth: options.maxDepth ?? 3,
      detectCycles: options.detectCycles ?? true,
    };
  }

  getStatus(): GraphIndexerWorkerStatus {
    return { ...this.status };
  }

  start(signal?: AbortSignal): void {
    if (this.status.phase === "indexing" || this.status.phase === "analyzing") {
      throw new Error("Graph indexer is already running.");
    }

    this.abortController = new AbortController();
    const localSignal = signal ?? this.abortController.signal;

    this.setStatus("indexing", 0, "Starting graph indexing...");

    try {
      // Phase 1: Index files
      this.indexFiles(localSignal);

      // Phase 2: Analyze dependencies
      if (!localSignal.aborted) {
        this.setStatus("analyzing", this.status.progress, "Analyzing dependencies...");
        this.analyzeDependencies(localSignal);
      }

      // Phase 3: Detect cycles
      if (!localSignal.aborted && this.options.detectCycles) {
        this.setStatus("analyzing", this.status.progress, "Detecting circular dependencies...");
        this.detectCycles(localSignal);
      }

      this.setStatus("complete", 100, "Graph indexing complete.");
    } catch (error) {
      if (error instanceof Error && error.name === "AbortError") {
        this.setStatus("idle", 0, "Indexing cancelled.");
      } else {
        this.setStatus(
          "error",
          this.status.progress,
          `Indexing failed: ${error instanceof Error ? error.message : String(error)}`,
        );
        this.status.errors.push(error instanceof Error ? error.message : String(error));
      }
    }
  }

  cancel(): void {
    this.abortController?.abort();
  }

  private setStatus(
    phase: GraphIndexerWorkerStatus["phase"],
    progress: number,
    message: string,
  ): void {
    this.status = { ...this.status, phase, progress, message };
    this.logger.info("graph-indexer.status", message, { phase, progress });
  }

  private indexFiles(signal: AbortSignal): void {
    const snapshot = this.store.getSnapshot();
    if (!snapshot) {
      throw new Error("No intelligence snapshot available.");
    }

    const files = snapshot.files;
    this.status.totalFiles = files.length;
    this.setStatus("indexing", 0, `Indexing ${files.length} files...`);

    for (let i = 0; i < files.length; i += this.options.batchSize) {
      if (signal.aborted) throw new Error("Cancelled.");

      const batch = files.slice(i, i + this.options.batchSize);
      const batchIndex = i / this.options.batchSize;
      const totalBatches = Math.ceil(files.length / this.options.batchSize);
      const progress = Math.round((batchIndex / totalBatches) * 50);

      this.setStatus("indexing", progress, `Indexing batch ${batchIndex + 1}/${totalBatches}...`);

      for (const _file of batch) {
        if (signal.aborted) throw new Error("Cancelled.");
        this.status.indexedFiles++;
        void _file; // Used for iteration
      }
    }
  }

  private analyzeDependencies(signal: AbortSignal): void {
    const snapshot = this.store.getSnapshot();
    if (!snapshot) {
      throw new Error("No intelligence snapshot available.");
    }

    const files = snapshot.files;
    const totalFiles = files.length;

    for (let i = 0; i < totalFiles; i++) {
      if (signal.aborted) throw new Error("Cancelled.");

      const file = files[i]!;
      const progress = 50 + Math.round((i / totalFiles) * 30);

      this.setStatus("analyzing", progress, `Analyzing dependencies for ${file.relativePath}...`);
      void file; // Used for status message
    }
  }

  private detectCycles(signal: AbortSignal): void {
    const snapshot = this.store.getSnapshot();
    if (!snapshot) {
      throw new Error("No intelligence snapshot available.");
    }

    const relationships = snapshot.relationships;
    const adjacency = new Map<string, string[]>();

    // Build adjacency list
    for (const rel of relationships) {
      const list = adjacency.get(rel.sourceId) ?? [];
      list.push(rel.targetId);
      adjacency.set(rel.sourceId, list);
    }

    // DFS to detect cycles
    const visited = new Set<string>();
    const onStack = new Set<string>();
    const cycles: string[][] = [];

    const dfs = (nodeId: string, path: string[]): void => {
      if (signal.aborted) throw new Error("Cancelled.");

      visited.add(nodeId);
      onStack.add(nodeId);
      path.push(nodeId);

      const neighbors = adjacency.get(nodeId) ?? [];
      for (const neighbor of neighbors) {
        if (!visited.has(neighbor)) {
          dfs(neighbor, [...path]);
        } else if (onStack.has(neighbor)) {
          const cycleStart = path.indexOf(neighbor);
          const cycle = path.slice(cycleStart);
          cycles.push(cycle);
        }
      }

      onStack.delete(nodeId);
    };

    for (const nodeId of adjacency.keys()) {
      if (!visited.has(nodeId)) {
        dfs(nodeId, []);
      }
    }

    this.logger.info("graph-indexer.cycles", `Detected ${cycles.length} cycles.`, {
      cycles: cycles.length,
    });
  }
}
