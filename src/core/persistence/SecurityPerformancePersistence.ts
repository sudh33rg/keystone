import * as fs from "node:fs";
import { join } from "node:path";
import type {
  SecurityPerformancePersistentState,
} from "../../shared/contracts/securityPerformanceWorker";
import { SecurityPerformancePersistentStateSchema } from "../../shared/contracts/securityPerformanceWorker";

export interface SecurityPerformancePersistence {
  readonly snapshot: SecurityPerformancePersistentState;
  initialize(): Promise<void>;
  update(updater: (state: SecurityPerformancePersistentState) => SecurityPerformancePersistentState): Promise<unknown>;
}

export class FileSecurityPerformancePersistence implements SecurityPerformancePersistence {
  private readonly path: string;
  private _snapshot: SecurityPerformancePersistentState = {
    schemaVersion: 1,
    revision: 0,
    securityRuns: [],
    performanceRuns: [],
    updatedAt: new Date().toISOString(),
  };

  constructor(root: string) {
    this.path = join(root, "security-performance", "state.json");
  }

  get snapshot(): SecurityPerformancePersistentState {
    return this._snapshot;
  }

  async initialize(): Promise<void> {
    await fs.promises.mkdir(join(this.path, ".."), { recursive: true });
    try {
      const raw = await fs.promises.readFile(this.path, "utf8");
      this._snapshot = SecurityPerformancePersistentStateSchema.parse(JSON.parse(raw));
    } catch {
      await this.persist(this._snapshot);
    }
  }

  async update(
    updater: (state: SecurityPerformancePersistentState) => SecurityPerformancePersistentState,
  ): Promise<unknown> {
    const next = updater({ ...this._snapshot, revision: this._snapshot.revision + 1, updatedAt: new Date().toISOString() });
    this._snapshot = SecurityPerformancePersistentStateSchema.parse(next);
    return this.persist(this._snapshot);
  }

  private async persist(state: SecurityPerformancePersistentState): Promise<void> {
    await fs.promises.writeFile(this.path, JSON.stringify(state, null, 2), "utf8");
  }
}
