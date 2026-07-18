import { readFile, rename } from "node:fs/promises";
import { join } from "node:path";
import { AtomicFileWriter } from "./AtomicFileWriter";
import { DELEGATION_SCHEMA_VERSION, DelegationPersistentStateSchema, type DelegationPersistentState } from "../../shared/contracts/delegation";

export class DelegationPersistenceStore {
  private state = emptyState();
  private writeChain = Promise.resolve();
  private readonly path?: string;

  constructor(storageRoot?: string, private readonly writer = new AtomicFileWriter()) {
    this.path = storageRoot ? join(storageRoot, "workflow", "delegation-state.json") : undefined;
  }

  get snapshot(): DelegationPersistentState { return structuredClone(this.state); }

  async initialize(): Promise<DelegationPersistentState> {
    if (!this.path) return this.snapshot;
    try {
      this.state = DelegationPersistentStateSchema.parse(JSON.parse(await readFile(this.path, "utf8")));
    } catch (cause) {
      if (!(cause instanceof Error && "code" in cause && cause.code === "ENOENT")) await rename(this.path, `${this.path}.invalid-${Date.now()}`);
      await this.persist(this.state);
    }
    return this.snapshot;
  }

  async update(mutator: (current: DelegationPersistentState) => DelegationPersistentState): Promise<DelegationPersistentState> {
    let result: DelegationPersistentState | undefined;
    this.writeChain = this.writeChain.catch(() => undefined).then(async () => {
      const next = DelegationPersistentStateSchema.parse({ ...mutator(this.snapshot), revision: this.state.revision + 1, updatedAt: new Date().toISOString() });
      await this.persist(next);
      this.state = next;
      result = this.snapshot;
    });
    await this.writeChain;
    return result!;
  }

  private async persist(state: DelegationPersistentState): Promise<void> {
    if (this.path) await this.writer.writeJson(this.path, state);
  }
}

function emptyState(): DelegationPersistentState {
  return { schemaVersion: DELEGATION_SCHEMA_VERSION, revision: 0, workflows: [], agents: [], selections: {}, customizationSelections: {}, selectedTaskByWorkflow: {}, buildPanelByWorkflow: {}, buildBaselines: {}, contexts: [], prepared: [], sessions: [], updatedAt: new Date().toISOString() };
}
