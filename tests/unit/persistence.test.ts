import { describe, expect, it } from "vitest";
import { WorkspaceStateStore, type MementoLike } from "../../src/core/persistence/WorkspaceStateStore";

class MemoryMemento implements MementoLike {
  readonly values = new Map<string, unknown>();

  get<T>(key: string): T | undefined {
    return this.values.get(key) as T | undefined;
  }

  update(key: string, value: unknown): PromiseLike<void> {
    this.values.set(key, value);
    return Promise.resolve();
  }
}

describe("WorkspaceStateStore", () => {
  it("initializes and persists a default state", async () => {
    const memento = new MemoryMemento();
    const store = new WorkspaceStateStore(memento);

    const state = await store.initialize();

    expect(state.activeSection).toBe("home");
    expect(state.schemaVersion).toBe(1);
    expect(memento.values.has("keystone.workspaceState")).toBe(true);
  });

  it("persists navigation before returning the next revision", async () => {
    const memento = new MemoryMemento();
    const store = new WorkspaceStateStore(memento);
    await store.initialize();

    const state = await store.setActiveSection("validation");
    const restored = new WorkspaceStateStore(memento);

    expect(state.revision).toBe(1);
    expect((await restored.initialize()).activeSection).toBe("validation");
  });

  it("migrates the supported legacy state", async () => {
    const memento = new MemoryMemento();
    memento.values.set("keystone.workspaceState", { schemaVersion: 0, activeSection: "tasks", workflowCount: 3 });

    const state = await new WorkspaceStateStore(memento).initialize();

    expect(state).toMatchObject({ schemaVersion: 1, activeSection: "tasks", workflowCount: 3 });
  });

  it("preserves invalid data under a recovery key before resetting", async () => {
    const memento = new MemoryMemento();
    memento.values.set("keystone.workspaceState", { schemaVersion: 99, credential: "must-not-be-lost" });

    const state = await new WorkspaceStateStore(memento).initialize();

    expect(state.activeSection).toBe("home");
    expect([...memento.values.keys()].some((key) => key.startsWith("keystone.recovery.corruptState."))).toBe(true);
  });
});

