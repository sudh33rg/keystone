import { readFile, rename } from "node:fs/promises";
import { join } from "node:path";
import {
  HANDOFF_SCHEMA_VERSION,
  TaskHandoffSchema,
  type TaskHandoff,
} from "../../shared/contracts/handoff";
import { AtomicFileWriter } from "./AtomicFileWriter";

export interface HandoffExportRecord {
  id: string;
  workflowId: string;
  handoffId: string;
  packageId: string;
  packagePath: string;
  packageHash: string;
  createdAt: string;
  supersededAt?: string;
}

export interface HandoffImportRecord {
  id: string;
  workflowId: string;
  handoffId: string;
  packageId: string;
  importedAt: string;
  accepted: boolean;
}

export interface HandoffAcceptanceRecord {
  id: string;
  workflowId: string;
  handoffId: string;
  packageId: string;
  acceptedAt: string;
  receiverLabel?: string;
  receiverNotes?: string;
}

export interface HandoffPersistentState {
  schemaVersion: typeof HANDOFF_SCHEMA_VERSION;
  revision: number;
  handoffs: TaskHandoff[];
  exports: HandoffExportRecord[];
  imports: HandoffImportRecord[];
  acceptances: HandoffAcceptanceRecord[];
  updatedAt: string;
}

export class HandoffPersistenceStore {
  private state = emptyState();
  private readonly path?: string;

  constructor(
    storageRoot?: string,
    private readonly writer = new AtomicFileWriter(),
  ) {
    this.path = storageRoot ? join(storageRoot, "workflow", "handoff-state.json") : undefined;
  }

  get snapshot(): HandoffPersistentState {
    return structuredClone(this.state);
  }

  /** Whether a non-superseded active outgoing draft already exists for a workflow. */
  hasActiveDraft(workflowId: string): boolean {
    return this.state.handoffs.some(
      (h) =>
        h.workflowId === workflowId &&
        h.direction === "outgoing" &&
        (h.status === "draft" || h.status === "ready-for-review" || h.status === "exported"),
    );
  }

  getHandoff(id: string): TaskHandoff | undefined {
    return this.state.handoffs.find((h) => h.id === id);
  }

  listForWorkflow(workflowId: string): TaskHandoff[] {
    return this.state.handoffs.filter((h) => h.workflowId === workflowId);
  }

  getExportByPackageId(packageId: string): HandoffExportRecord | undefined {
    return this.state.exports.find((e) => e.packageId === packageId);
  }

  getImportByPackageId(packageId: string): HandoffImportRecord | undefined {
    return this.state.imports.find((i) => i.packageId === packageId);
  }

  async initialize(): Promise<HandoffPersistentState> {
    if (!this.path) return this.snapshot;
    try {
      const parsed = JSON.parse(await readFile(this.path, "utf8"));
      this.state = coalesce(parsed);
    } catch (cause) {
      if (!(cause instanceof Error && "code" in cause && cause.code === "ENOENT")) {
        await rename(this.path, `${this.path}.invalid-${Date.now()}`);
      }
      await this.persist(this.state);
    }
    return this.snapshot;
  }

  /**
   * Update state synchronously (in-memory) so fire-and-forget callers observe
   * the new state immediately, then persist asynchronously.
   */
  async update(
    mutate: (state: HandoffPersistentState) => HandoffPersistentState,
  ): Promise<HandoffPersistentState> {
    const next = coalesce(mutate(this.snapshot));
    this.state = next;
    await this.persist(next);
    return this.snapshot;
  }

  private persist(value: HandoffPersistentState): Promise<void> {
    return this.path ? this.writer.writeJson(this.path, value) : Promise.resolve();
  }
}

function coalesce(value: unknown): HandoffPersistentState {
  const raw = (value ?? {}) as Partial<HandoffPersistentState>;
  return {
    schemaVersion: HANDOFF_SCHEMA_VERSION,
    revision: typeof raw.revision === "number" ? raw.revision + 1 : 1,
    handoffs: (raw.handoffs ?? []).map((h) => TaskHandoffSchema.parse(h)),
    exports: (raw.exports ?? []) as HandoffExportRecord[],
    imports: (raw.imports ?? []) as HandoffImportRecord[],
    acceptances: (raw.acceptances ?? []) as HandoffAcceptanceRecord[],
    updatedAt: new Date().toISOString(),
  };
}

function emptyState(): HandoffPersistentState {
  return {
    schemaVersion: HANDOFF_SCHEMA_VERSION,
    revision: 0,
    handoffs: [],
    exports: [],
    imports: [],
    acceptances: [],
    updatedAt: new Date().toISOString(),
  };
}
