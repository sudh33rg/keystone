import { readFile, rename } from "node:fs/promises";
import { join } from "node:path";
import { AtomicFileWriter } from "./AtomicFileWriter";
import {
  DELIVERY_SCHEMA_VERSION,
  DeliveryPersistentStateSchema,
  type DeliveryPersistentState,
} from "../../shared/contracts/delivery";

export class DeliveryPersistenceStore {
  private state = emptyState();
  private chain = Promise.resolve();
  private readonly path?: string;
  constructor(
    storageRoot?: string,
    private readonly writer = new AtomicFileWriter(),
  ) {
    this.path = storageRoot ? join(storageRoot, "workflow", "delivery-state.json") : undefined;
  }
  get snapshot(): DeliveryPersistentState {
    return structuredClone(this.state);
  }
  async initialize(): Promise<DeliveryPersistentState> {
    if (!this.path) return this.snapshot;
    try {
      this.state = DeliveryPersistentStateSchema.parse(
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
    mutate: (state: DeliveryPersistentState) => DeliveryPersistentState,
  ): Promise<DeliveryPersistentState> {
    let output: DeliveryPersistentState | undefined;
    this.chain = this.chain
      .catch(() => undefined)
      .then(async () => {
        const next = DeliveryPersistentStateSchema.parse({
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
  private persist(value: DeliveryPersistentState): Promise<void> {
    return this.path ? this.writer.writeJson(this.path, value) : Promise.resolve();
  }
}

function emptyState(): DeliveryPersistentState {
  return {
    schemaVersion: DELIVERY_SCHEMA_VERSION,
    revision: 0,
    capabilities: [],
    repositoryStates: [],
    changeSets: [],
    commitPlans: [],
    approvals: [],
    actionResults: [],
    pullRequestDrafts: [],
    pullRequestResults: [],
    reports: [],
    diagnostics: [],
    updatedAt: new Date().toISOString(),
  };
}
