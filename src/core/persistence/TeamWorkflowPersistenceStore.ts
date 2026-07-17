import { readFile, rename } from "node:fs/promises";
import { join } from "node:path";
import {
  TEAM_SCHEMA_VERSION,
  TeamPersistentStateSchema,
  type TeamPersistentState,
} from "../../shared/contracts/team";
import { AtomicFileWriter } from "./AtomicFileWriter";

export class TeamWorkflowPersistenceStore {
  private state = emptyState();
  private chain = Promise.resolve();
  private readonly path?: string;

  constructor(
    storageRoot?: string,
    private readonly writer = new AtomicFileWriter(),
  ) {
    this.path = storageRoot
      ? join(storageRoot, "workflow", "team-state.json")
      : undefined;
  }

  get snapshot(): TeamPersistentState {
    return structuredClone(this.state);
  }

  async initialize(): Promise<TeamPersistentState> {
    if (!this.path) return this.snapshot;
    try {
      const persisted = JSON.parse(await readFile(this.path, "utf8")) as {
        settings?: { repositoryArtifactPath?: string };
      };
      // Milestone 15 migration: accept the previous product-branded path only
      // while loading, then persist the canonical Keystone-owned path.
      const migrated = persisted.settings?.repositoryArtifactPath === ".buildwise/handoffs";
      if (migrated && persisted.settings) {
        persisted.settings.repositoryArtifactPath = ".keystone/handoffs";
      }
      const parsed = TeamPersistentStateSchema.parse(persisted);
      this.state = recoverInterruptedImports(parsed);
      if (migrated || this.state !== parsed) await this.persist(this.state);
    } catch (cause) {
      if (!(cause instanceof Error && "code" in cause && cause.code === "ENOENT")) {
        await rename(this.path, `${this.path}.invalid-${Date.now()}`);
      }
      await this.persist(this.state);
    }
    return this.snapshot;
  }

  async update(
    mutate: (state: TeamPersistentState) => TeamPersistentState,
  ): Promise<TeamPersistentState> {
    let output: TeamPersistentState | undefined;
    this.chain = this.chain.catch(() => undefined).then(async () => {
      const next = TeamPersistentStateSchema.parse({
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

  private persist(value: TeamPersistentState): Promise<void> {
    return this.path ? this.writer.writeJson(this.path, value) : Promise.resolve();
  }
}

function recoverInterruptedImports(
  value: TeamPersistentState,
): TeamPersistentState {
  if (!value.imports.some((entry) => entry.status === "validating")) return value;
  const now = new Date().toISOString();
  return TeamPersistentStateSchema.parse({
    ...value,
    revision: value.revision + 1,
    imports: value.imports.map((entry) =>
      entry.status === "validating"
        ? {
            ...entry,
            status: "interrupted" as const,
            reason:
              "Import validation was interrupted. Review and import the artifact again.",
            updatedAt: now,
          }
        : entry,
    ),
    updatedAt: now,
  });
}

function emptyState(): TeamPersistentState {
  return {
    schemaVersion: TEAM_SCHEMA_VERSION,
    revision: 0,
    participants: [],
    assignments: [],
    ownership: [],
    packages: [],
    imports: [],
    exports: [],
    reconciliations: [],
    acceptances: [],
    reassignments: [],
    progress: [],
    audit: [],
    settings: {
      repositoryArtifactsEnabled: false,
      repositoryArtifactPath: ".keystone/handoffs",
      allowAssignmentBeforeDependencies: false,
      maxPackageBytes: 1_000_000,
      maxAttachmentBytes: 5_000_000,
      maxAttachments: 50,
      retainAuditEntries: 2_000,
    },
    diagnostics: [],
    updatedAt: new Date().toISOString(),
  };
}
