import {
  type Blocker,
  type BlockerCategory,
  type BlockerSeverity,
} from "../../shared/contracts/blocker";
import { WorkspaceStateStore } from "../persistence/WorkspaceStateStore";

/**
 * BlockerStore provides persistence for blocker records.
 */
class BlockerStore {
  constructor(private readonly store: WorkspaceStateStore) {}

  async initialize(): Promise<void> {
    // Records are persisted via the workspace state store
  }

  getBlocker(blockerId: string): Blocker | undefined {
    return this.store.snapshot.blockerRecords?.find((blocker) => blocker.id === blockerId);
  }

  getAllBlockers(): Blocker[] {
    return this.store.snapshot.blockerRecords ?? [];
  }

  async updateBlocker(
    blockerId: string,
    updates: Partial<Blocker>,
    emitUpdate: (blocker: Blocker) => void | Promise<void>,
  ): Promise<Blocker> {
    const current = this.getBlocker(blockerId);
    if (!current) throw new Error(`Blocker ${blockerId} not found.`);

    const next: Blocker = {
      ...current,
      ...updates,
      updatedAt: new Date().toISOString(),
    };

    const records = this.store.snapshot.blockerRecords ?? [];
    const index = records.findIndex((b) => b.id === blockerId);
    if (index >= 0) records[index] = next;
    else records.push(next);

    await this.store.update("blockerRecords", records);

    // Emit the update
    await emitUpdate(next);
    return next;
  }

  async createBlocker(blocker: Omit<Blocker, "id" | "updatedAt" | "createdAt">): Promise<Blocker> {
    const now = new Date().toISOString();
    const blockerWithId: Blocker = {
      ...blocker,
      id: crypto.randomUUID(),
      createdAt: now,
      updatedAt: now,
    };

    const records = this.store.snapshot.blockerRecords ?? [];
    records.push(blockerWithId);
    await this.store.update("blockerRecords", records);

    return blockerWithId;
  }
}

/**
 * BlockerService manages blockers encountered during workflow execution.
 */
export class BlockerService {
  private readonly store: BlockerStore;
  private readonly updates: Array<(blocker: Blocker) => void | Promise<void>> = [];

  constructor(store: WorkspaceStateStore) {
    this.store = new BlockerStore(store);
  }

  async initialize(): Promise<void> {
    await this.store.initialize();
  }

  /**
   * Create a new blocker.
   */
  async create(
    workflowId?: string,
    stageId?: string,
    category: BlockerCategory = "configuration-missing",
    code: string = "",
    title: string = "",
    explanation: string = "",
    severity: BlockerSeverity = "warning",
    recoverability: boolean = false,
    suggestedAction: string = "",
    directAction?: string,
    evidence: string[] = [],
  ): Promise<Blocker> {
    const blocker = await this.store.createBlocker({
      affectedWorkflowId: workflowId,
      affectedStageId: stageId,
      category,
      code,
      title,
      explanation,
      severity,
      recoverability,
      suggestedAction,
      directAction,
      evidence,
    });

    // Notify listeners
    for (const callback of this.updates) {
      void callback(blocker);
    }

    return blocker;
  }

  /**
   * Resolve a blocker.
   */
  async resolve(blockerId: string, reason?: string): Promise<Blocker> {
    void reason;
    return this.update(blockerId, {
      resolvedAt: new Date().toISOString(),
      resolvedBy: "user",
    });
  }

  /**
   * Update a blocker.
   */
  private async update(
    blockerId: string,
    updates: Partial<Blocker>,
  ): Promise<Blocker> {
    return this.store.updateBlocker(blockerId, updates, async (blocker) => {
      for (const callback of this.updates) void callback(blocker);
    });
  }

  /**
   * Get a blocker.
   */
  get(blockerId: string): Blocker | undefined {
    return this.store.getBlocker(blockerId);
  }

  /**
   * Get all blockers.
   */
  getAll(): Blocker[] {
    return this.store.getAllBlockers();
  }

  /**
   * Get blockers by workflow.
   */
  getByWorkflow(workflowId: string): Blocker[] {
    return this.store.getAllBlockers().filter((b) => b.affectedWorkflowId === workflowId);
  }

  /**
   * Get blockers by stage.
   */
  getByStage(stageId: string): Blocker[] {
    return this.store.getAllBlockers().filter((b) => b.affectedStageId === stageId);
  }

  /**
   * Get blockers by category.
   */
  getByCategory(category: BlockerCategory): Blocker[] {
    return this.store.getAllBlockers().filter((b) => b.category === category);
  }

  /**
   * Get blockers by severity.
   */
  getBySeverity(severity: BlockerSeverity): Blocker[] {
    return this.store.getAllBlockers().filter((b) => b.severity === severity);
  }

  /**
   * Get open blockers.
   */
  getOpen(): Blocker[] {
    return this.store.getAllBlockers().filter((b) => !b.resolvedAt);
  }

  /**
   * Get resolved blockers.
   */
  getResolved(): Blocker[] {
    return this.store.getAllBlockers().filter((b) => b.resolvedAt);
  }

  /**
   * Get critical blockers.
   */
  getCritical(): Blocker[] {
    return this.store.getAllBlockers().filter((b) => b.severity === "critical");
  }

  /**
   * Get error-level blockers.
   */
  getErrors(): Blocker[] {
    return this.store.getAllBlockers().filter((b) => b.severity === "error");
  }

  /**
   * Get recoverable blockers.
   */
  getRecoverable(): Blocker[] {
    return this.store.getAllBlockers().filter((b) => b.recoverability);
  }

  /**
   * Add a listener for blocker updates.
   */
  on(
    callback: (blocker: Blocker) => void | Promise<void>,
  ): () => void {
    this.updates.push(callback);
    return () => {
      const index = this.updates.indexOf(callback);
      if (index >= 0) this.updates.splice(index, 1);
    };
  }
}
