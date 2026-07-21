import {
  PersistedFoundationStateSchema,
  SCHEMA_VERSION,
  type AppRoute,
  type NavigationSection,
  type PersistedFoundationState,
} from "../../shared/contracts/domain";
import { compatibilityRoute, sectionForRoute } from "../../shared/navigation";
import { KeystoneError } from "../../shared/errors/KeystoneError";
import { readFile, rename } from "node:fs/promises";
import { AtomicFileWriter } from "./AtomicFileWriter";

export interface MementoLike {
  get<T>(key: string): T | undefined;
  update(key: string, value: unknown): PromiseLike<void>;
}

/** Repository-local replacement for VS Code's opaque workspace memento. */
export class FileMemento implements MementoLike {
  private values: Record<string, unknown> = Object.create(null) as Record<string, unknown>;
  private writeChain = Promise.resolve();

  private constructor(
    private readonly path: string,
    private readonly writer = new AtomicFileWriter(),
  ) {}

  static async open(path: string): Promise<FileMemento> {
    const memento = new FileMemento(path);
    try {
      const parsed = JSON.parse(await readFile(path, "utf8")) as unknown;
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed))
        memento.values = parsed as Record<string, unknown>;
    } catch (cause) {
      if (!(cause instanceof Error && "code" in cause && cause.code === "ENOENT")) {
        await rename(path, `${path}.invalid-${Date.now()}`).catch(() => undefined);
      }
    }
    return memento;
  }

  get<T>(key: string): T | undefined {
    return this.values[key] as T | undefined;
  }

  update(key: string, value: unknown): PromiseLike<void> {
    this.values = { ...this.values, [key]: value };
    const snapshot = structuredClone(this.values);
    this.writeChain = this.writeChain
      .catch(() => undefined)
      .then(() => this.writer.writeJson(this.path, snapshot));
    return this.writeChain;
  }
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
        cause: error,
      });
    }
  }

  async setActiveSection(section: NavigationSection): Promise<PersistedFoundationState> {
    return this.setActiveRoute(compatibilityRoute(section));
  }

  async setActiveRoute(route: AppRoute): Promise<PersistedFoundationState> {
    const next: PersistedFoundationState = {
      ...this.state,
      activeSection: sectionForRoute(route),
      activeRoute: route,
      revision: this.state.revision + 1,
      updatedAt: new Date().toISOString(),
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
        cause: error,
      });
    }
  }
}

export function createDefaultState(): PersistedFoundationState {
  return {
    schemaVersion: SCHEMA_VERSION,
    revision: 0,
    activeSection: "home",
    activeRoute: "/",
    workflowCount: 0,
    updatedAt: new Date().toISOString(),
  };
}

function migrateLegacyState(raw: unknown): PersistedFoundationState | undefined {
  if (!raw || typeof raw !== "object") return undefined;
  const candidate = raw as Record<string, unknown>;
  if (
    candidate.schemaVersion === SCHEMA_VERSION &&
    (candidate.activeSection === "hub" || candidate.activeSection === "models")
  ) {
    const result = PersistedFoundationStateSchema.safeParse({
      ...candidate,
      activeSection: "intelligence",
      activeRoute: "/intelligence",
      revision: typeof candidate.revision === "number" ? candidate.revision + 1 : 1,
      updatedAt: new Date().toISOString(),
    });
    return result.success ? result.data : undefined;
  }
  if (
    candidate.schemaVersion === SCHEMA_VERSION &&
    typeof candidate.activeSection === "string" &&
    candidate.activeRoute === undefined
  ) {
    const section = candidate.activeSection as NavigationSection;
    const activeRoute = compatibilityRoute(section);
    const result = PersistedFoundationStateSchema.safeParse({
      ...candidate,
      activeSection: sectionForRoute(activeRoute),
      activeRoute,
      revision: typeof candidate.revision === "number" ? candidate.revision + 1 : 1,
      updatedAt: new Date().toISOString(),
    });
    return result.success ? result.data : undefined;
  }
  if (candidate.schemaVersion !== 0) return undefined;
  const activeSection =
    typeof candidate.activeSection === "string" ? candidate.activeSection : "home";
  const route = compatibilityRoute(activeSection as NavigationSection);
  const result = PersistedFoundationStateSchema.safeParse({
    ...createDefaultState(),
    activeSection: sectionForRoute(route),
    activeRoute: route,
    workflowCount: typeof candidate.workflowCount === "number" ? candidate.workflowCount : 0,
  });
  return result.success ? result.data : undefined;
}
