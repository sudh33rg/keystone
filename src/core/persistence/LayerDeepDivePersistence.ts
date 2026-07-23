import * as fs from "node:fs";
import { join } from "node:path";
import type { LayerDeepDivePersistentState } from "../../shared/contracts/layerDeepDive";
import { LayerDeepDivePersistentStateSchema } from "../../shared/contracts/layerDeepDive";

export interface LayerDeepDivePersistence {
  readonly snapshot: LayerDeepDivePersistentState;
  initialize(): Promise<void>;
  update(updater: (state: LayerDeepDivePersistentState) => LayerDeepDivePersistentState): Promise<unknown>;
}

export class FileLayerDeepDivePersistence implements LayerDeepDivePersistence {
  private readonly path: string;
  private _snapshot: LayerDeepDivePersistentState = {
    schemaVersion: 1,
    revision: 0,
    requests: [],
    responses: [],
    updatedAt: new Date().toISOString(),
  };

  constructor(root: string) {
    this.path = join(root, "layer-deep-dive", "state.json");
  }

  get snapshot(): LayerDeepDivePersistentState {
    return this._snapshot;
  }

  async initialize(): Promise<void> {
    await fs.promises.mkdir(join(this.path, ".."), { recursive: true });
    try {
      const raw = await fs.promises.readFile(this.path, "utf8");
      this._snapshot = LayerDeepDivePersistentStateSchema.parse(JSON.parse(raw));
    } catch {
      await this.persist(this._snapshot);
    }
  }

  async update(
    updater: (state: LayerDeepDivePersistentState) => LayerDeepDivePersistentState,
  ): Promise<unknown> {
    const next = updater({ ...this._snapshot, revision: this._snapshot.revision + 1, updatedAt: new Date().toISOString() });
    this._snapshot = LayerDeepDivePersistentStateSchema.parse(next);
    return this.persist(this._snapshot);
  }

  private persist(state: LayerDeepDivePersistentState): Promise<void> {
    return fs.promises.writeFile(this.path, JSON.stringify(state, null, 2), "utf8");
  }
}
