import * as fs from "node:fs";
import { join } from "node:path";
import { z } from "zod";
import type { ModernizationPersistentState, ModernizationAssessment } from "../../shared/contracts/modernization";
import { ModernizationPersistentStateSchema } from "../../shared/contracts/modernization";

export interface ModernizationPersistence {
  readonly snapshot: ModernizationPersistentState;
  initialize(): Promise<void>;
  update(updater: (state: ModernizationPersistentState) => ModernizationPersistentState): Promise<unknown>;
}

export class FileModernizationPersistence implements ModernizationPersistence {
  private readonly path: string;
  private _snapshot: ModernizationPersistentState = {
    schemaVersion: 1,
    revision: 0,
    assessments: [],
    updatedAt: new Date().toISOString(),
  };

  constructor(root: string) {
    this.path = join(root, "modernization", "state.json");
  }

  get snapshot(): ModernizationPersistentState {
    return this._snapshot;
  }

  async initialize(): Promise<void> {
    await fs.promises.mkdir(join(this.path, ".."), { recursive: true });
    try {
      const raw = await fs.promises.readFile(this.path, "utf8");
      this._snapshot = ModernizationPersistentStateSchema.parse(JSON.parse(raw));
    } catch {
      await this.persist(this._snapshot);
    }
  }

  async update(
    updater: (state: ModernizationPersistentState) => ModernizationPersistentState,
  ): Promise<unknown> {
    const next = updater({ ...this._snapshot, revision: this._snapshot.revision + 1, updatedAt: new Date().toISOString() });
    this._snapshot = ModernizationPersistentStateSchema.parse(next);
    return this.persist(this._snapshot);
  }

  private async persist(state: ModernizationPersistentState): Promise<void> {
    await fs.promises.writeFile(this.path, JSON.stringify(state, null, 2), "utf8");
  }
}
