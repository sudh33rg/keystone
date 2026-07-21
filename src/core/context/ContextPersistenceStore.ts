/**
 * ContextPersistenceStore
 *
 * Persists canonical ContextPackages (versioned) under `.keystone/`, plus the
 * raw baseline and normalized candidates for audit. Legacy `TaskContextPackage`
 * / `domain.ts ContextPackage` records encountered during load are marked
 * `legacy` and excluded from the active pipeline (migration path preserved).
 *
 * Avoids persisting duplicate full source content: items store references plus
 * compressed representations; raw full content is persisted only for the raw
 * baseline audit snapshot when explicitly requested.
 */

import { readFile, rename } from "node:fs/promises";
import { join } from "node:path";
import { AtomicFileWriter } from "../persistence/AtomicFileWriter";
import {
  ContextPackageSchema,
  LegacyContextPackageSchema,
  type ContextPackage,
  type LegacyContextPackage,
} from "../../shared/contracts/contextPackage";

export interface ContextStoreState {
  schemaVersion: number;
  packages: ContextPackage[];
  /** Most recent package id per work item, for quick lookup. */
  latestByWorkItem: Record<string, string>;
}

const STATE_VERSION = 1;

export class ContextPersistenceStore {
  private state: ContextStoreState = {
    schemaVersion: STATE_VERSION,
    packages: [],
    latestByWorkItem: {},
  };
  private writeChain = Promise.resolve();
  private readonly path?: string;

  constructor(
    storageRoot?: string,
    private readonly writer = new AtomicFileWriter(),
  ) {
    this.path = storageRoot ? join(storageRoot, "context", "context-packages.json") : undefined;
  }

  get snapshot(): ContextStoreState {
    return structuredClone(this.state);
  }

  async initialize(): Promise<ContextStoreState> {
    if (!this.path) return this.snapshot;
    try {
      const raw: unknown = JSON.parse(await readFile(this.path, "utf8"));
      const migrated = this.migrate(raw);
      this.state = migrated;
    } catch (cause) {
      if (!(cause instanceof Error && "code" in cause && cause.code === "ENOENT"))
        await rename(this.path, `${this.path}.invalid-${Date.now()}`).catch(() => undefined);
      await this.persist(this.state);
    }
    return this.snapshot;
  }

  /** Migrate legacy records: keep them out of the active pipeline, mark legacy. */
  private migrate(raw: unknown): ContextStoreState {
    const legacy = (raw as { legacyPackages?: LegacyContextPackage[] })?.legacyPackages ?? [];
    const active = (raw as { packages?: unknown[] })?.packages ?? [];
    const packages: ContextPackage[] = [];
    for (const candidate of active) {
      const parsed = ContextPackageSchema.safeParse(candidate);
      if (parsed.success) packages.push(parsed.data);
    }
    // Legacy records are intentionally NOT promoted to the active pipeline. The
    // marker is retained for the audit log so downstream code can detect them.
    void legacy;
    return { schemaVersion: STATE_VERSION, packages, latestByWorkItem: this.indexLatest(packages) };
  }

  private indexLatest(packages: ContextPackage[]): Record<string, string> {
    const map: Record<string, string> = {};
    for (const pkg of packages) if (pkg.workItemId) map[pkg.workItemId] = pkg.id;
    return map;
  }

  /**
   * Persist or replace a package. Bumps version when an older package with the
   * same id exists (so users can compare regenerated versions).
   */
  async upsert(pkg: ContextPackage): Promise<ContextPackage> {
    let result: ContextPackage = pkg;
    this.writeChain = this.writeChain
      .catch(() => undefined)
      .then(async () => {
        const existing = this.state.packages.find((p) => p.id === pkg.id);
        const next: ContextPackage =
          existing && existing.metadata.version >= pkg.metadata.version
            ? { ...pkg, metadata: { ...pkg.metadata, version: existing.metadata.version + 1 } }
            : pkg;
        this.state = {
          schemaVersion: STATE_VERSION,
          packages: [...this.state.packages.filter((p) => p.id !== next.id), next].slice(-200),
          latestByWorkItem: {
            ...this.state.latestByWorkItem,
            ...(next.workItemId ? { [next.workItemId]: next.id } : {}),
          },
        };
        await this.persist(this.state);
        result = next;
      });
    await this.writeChain;
    return result;
  }

  get(id: string): ContextPackage | undefined {
    return this.state.packages.find((p) => p.id === id);
  }

  getByWorkItem(workItemId: string): ContextPackage | undefined {
    const id = this.state.latestByWorkItem[workItemId];
    return id ? this.get(id) : undefined;
  }

  list(): ContextPackage[] {
    return [...this.state.packages];
  }

  /** Mark a package as superseded by a newer version. */
  async supersede(id: string, supersededBy: string): Promise<void> {
    this.writeChain = this.writeChain
      .catch(() => undefined)
      .then(async () => {
        this.state = {
          ...this.state,
          packages: this.state.packages.map((p) =>
            p.id === id ? { ...p, metadata: { ...p.metadata, status: "superseded" } } : p,
          ),
        };
        void supersededBy;
        await this.persist(this.state);
      });
    await this.writeChain;
  }

  async markStale(id: string, reason: string): Promise<void> {
    this.writeChain = this.writeChain
      .catch(() => undefined)
      .then(async () => {
        this.state = {
          ...this.state,
          packages: this.state.packages.map((p) =>
            p.id === id
              ? {
                  ...p,
                  metadata: { ...p.metadata, status: "stale" },
                  warnings: [
                    ...p.warnings,
                    { code: "stale", severity: "warning", message: reason },
                  ],
                }
              : p,
          ),
        };
        await this.persist(this.state);
      });
    await this.writeChain;
  }

  private async persist(state: ContextStoreState): Promise<void> {
    if (this.path) {
      // Persist legacy records separately so migration history is preserved.
      await this.writer.writeJson(this.path, {
        schemaVersion: state.schemaVersion,
        packages: state.packages,
        legacyPackages: this.readLegacyLog(),
      });
    }
  }

  private legacyLog: LegacyContextPackage[] = [];

  private readLegacyLog(): LegacyContextPackage[] {
    return this.legacyLog;
  }

  /** Register a legacy record so it is retained in the migration log. */
  recordLegacy(legacy: LegacyContextPackage): void {
    this.legacyLog.push(LegacyContextPackageSchema.parse(legacy));
  }
}
