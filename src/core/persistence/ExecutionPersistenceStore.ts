import { readFile, rename } from "node:fs/promises";
import { join } from "node:path";
import { AtomicFileWriter } from "./AtomicFileWriter";
import {
  EXECUTION_SCHEMA_VERSION,
  ExecutionPersistentStateSchema,
  type ExecutionPersistentState,
} from "../../shared/contracts/execution";

export class ExecutionPersistenceStore {
  private state = empty();
  private chain = Promise.resolve();
  private readonly path?: string;
  constructor(
    storageRoot?: string,
    private readonly writer = new AtomicFileWriter(),
  ) {
    this.path = storageRoot ? join(storageRoot, "workflow", "execution-state.json") : undefined;
  }
  get snapshot(): ExecutionPersistentState {
    return structuredClone(this.state);
  }
  async initialize(): Promise<ExecutionPersistentState> {
    if (!this.path) return this.snapshot;
    try {
      this.state = ExecutionPersistentStateSchema.parse(
        JSON.parse(await readFile(this.path, "utf8")),
      );
    } catch (cause) {
      if (!(cause instanceof Error && "code" in cause && cause.code === "ENOENT"))
        await rename(this.path, `${this.path}.invalid-${Date.now()}`);
      await this.persist(this.state);
    }
    return this.snapshot;
  }
  async update(
    mutate: (state: ExecutionPersistentState) => ExecutionPersistentState,
  ): Promise<ExecutionPersistentState> {
    let output: ExecutionPersistentState | undefined;
    this.chain = this.chain
      .catch(() => undefined)
      .then(async () => {
        const next = ExecutionPersistentStateSchema.parse({
          ...mutate(this.snapshot),
          revision: this.state.revision + 1,
          updatedAt: new Date().toISOString(),
        });
        await this.persist(next);
        this.state = next;
        output = this.snapshot;
      });
    await this.chain;
    return output!;
  }
  private persist(value: ExecutionPersistentState): Promise<void> {
    return this.path ? this.writer.writeJson(this.path, value) : Promise.resolve();
  }
}
function empty(): ExecutionPersistentState {
  return {
    schemaVersion: EXECUTION_SCHEMA_VERSION,
    revision: 0,
    sessions: [],
    plans: [],
    runs: [],
    retries: [],
    overrides: [],
    decisions: [],
    reports: [],
    updatedAt: new Date().toISOString(),
  };
}
