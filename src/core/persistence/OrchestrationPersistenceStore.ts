import { readFile, rename } from "node:fs/promises";
import { join } from "node:path";
import { AtomicFileWriter } from "./AtomicFileWriter";
import {
  ORCHESTRATION_SCHEMA_VERSION,
  OrchestrationPersistentStateSchema,
  type OrchestrationPersistentState,
} from "../../shared/contracts/orchestration";

export class OrchestrationPersistenceStore {
  private state: OrchestrationPersistentState = empty();
  private chain = Promise.resolve();
  private readonly path?: string;

  constructor(
    storageRoot?: string,
    private readonly writer = new AtomicFileWriter(),
  ) {
    this.path = storageRoot ? join(storageRoot, "workflow", "orchestration-state.json") : undefined;
  }

  get snapshot(): OrchestrationPersistentState {
    return structuredClone(this.state);
  }

  async initialize(): Promise<OrchestrationPersistentState> {
    if (!this.path) return this.snapshot;
    try {
      const raw = JSON.parse(await readFile(this.path, "utf8")) as Record<string, unknown>;
      this.state = OrchestrationPersistentStateSchema.parse(migrate(raw));
    } catch (cause) {
      if (!(cause instanceof Error && "code" in cause && cause.code === "ENOENT"))
        await rename(this.path, `${this.path}.invalid-${Date.now()}`);
      await this.persist(this.state);
    }
    return this.snapshot;
  }

  async update(
    mutate: (state: OrchestrationPersistentState) => OrchestrationPersistentState,
  ): Promise<OrchestrationPersistentState> {
    let result: OrchestrationPersistentState | undefined;
    this.chain = this.chain
      .catch(() => undefined)
      .then(async () => {
        const next = OrchestrationPersistentStateSchema.parse({
          ...mutate(this.snapshot),
          revision: this.state.revision + 1,
          updatedAt: new Date().toISOString(),
        });
        await this.persist(next);
        this.state = next;
        result = this.snapshot;
      });
    await this.chain;
    return result!;
  }

  private persist(value: OrchestrationPersistentState): Promise<void> {
    return this.path ? this.writer.writeJson(this.path, value) : Promise.resolve();
  }
}

function empty(): OrchestrationPersistentState {
  return {
    schemaVersion: ORCHESTRATION_SCHEMA_VERSION,
    revision: 0,
    instances: [],
    updatedAt: new Date().toISOString(),
  };
}
function migrate(value: Record<string, unknown>): unknown {
  const copy = structuredClone(value);
  delete copy.hubId;
  delete copy.hubArtifactIds;
  delete copy.localModelId;
  delete copy.modelAdapterId;
  delete copy.trainingJobId;
  return copy;
}
