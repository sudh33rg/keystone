import {
  PersistedFoundationStateSchema,
  SCHEMA_VERSION,
  type NavigationSection,
  type PersistedFoundationState
} from "../../shared/contracts/domain";
import { KeystoneError } from "../../shared/errors/KeystoneError";

export interface MementoLike {
  get<T>(key: string): T | undefined;
  update(key: string, value: unknown): PromiseLike<void>;
}

const STATE_KEY = "keystone.workspaceState";
const RECOVERY_PREFIX = "keystone.recovery.corruptState";

export class WorkspaceStateStore {
  private state = createDefaultState();

  constructor(private readonly memento: MementoLike) {}

  get snapshot(): PersistedFoundationState {
    return { ...this.state };
  }

  async initialize(): Promise<PersistedFoundationState> {
    const raw = this.memento.get<unknown>(STATE_KEY);
    if (raw === undefined) {
      await this.persist(this.state);
      return this.snapshot;
    }

    const parsed = PersistedFoundationStateSchema.safeParse(raw);
    if (parsed.success) {
      this.state = parsed.data;
      return this.snapshot;
    }

    const migrated = migrateLegacyState(raw);
    if (migrated) {
      await this.persist(migrated);
      return this.snapshot;
    }

    try {
      await this.memento.update(`${RECOVERY_PREFIX}.${Date.now()}`, raw);
      await this.persist(createDefaultState());
      return this.snapshot;
    } catch (error) {
      throw new KeystoneError({
        code: "PERSISTENCE_RECOVERY_FAILED",
        category: "PERSISTENCE",
        message: "Keystone could not recover its workspace state.",
        technicalDetails: error instanceof Error ? error.message : String(error),
        operation: "persistence.initialize",
        recoverable: false,
        recommendedAction: "Open the Keystone logs and reload the VS Code window.",
        cause: error
      });
    }
  }

  async setActiveSection(section: NavigationSection): Promise<PersistedFoundationState> {
    const next: PersistedFoundationState = {
      ...this.state,
      activeSection: section,
      revision: this.state.revision + 1,
      updatedAt: new Date().toISOString()
    };
    await this.persist(next);
    return this.snapshot;
  }

  private async persist(next: PersistedFoundationState): Promise<void> {
    const validated = PersistedFoundationStateSchema.parse(next);
    try {
      await this.memento.update(STATE_KEY, validated);
      this.state = validated;
    } catch (error) {
      throw new KeystoneError({
        code: "PERSISTENCE_WRITE_FAILED",
        category: "PERSISTENCE",
        message: "Keystone could not save the workspace state.",
        technicalDetails: error instanceof Error ? error.message : String(error),
        operation: "persistence.write",
        recoverable: true,
        recommendedAction: "Check that VS Code can write extension workspace storage, then retry.",
        retryable: true,
        cause: error
      });
    }
  }
}

export function createDefaultState(): PersistedFoundationState {
  return {
    schemaVersion: SCHEMA_VERSION,
    revision: 0,
    activeSection: "home",
    workflowCount: 0,
    updatedAt: new Date().toISOString()
  };
}

function migrateLegacyState(raw: unknown): PersistedFoundationState | undefined {
  if (!raw || typeof raw !== "object") return undefined;
  const candidate = raw as Record<string, unknown>;
  if (candidate.schemaVersion !== 0) return undefined;
  const activeSection = typeof candidate.activeSection === "string" ? candidate.activeSection : "home";
  const result = PersistedFoundationStateSchema.safeParse({
    ...createDefaultState(),
    activeSection,
    workflowCount: typeof candidate.workflowCount === "number" ? candidate.workflowCount : 0
  });
  return result.success ? result.data : undefined;
}

