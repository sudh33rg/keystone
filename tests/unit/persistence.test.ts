import { mkdtemp, readFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { describe, expect, it } from "vitest";
import { FileMemento, WorkspaceStateStore, type MementoLike } from "../../src/core/persistence/WorkspaceStateStore";

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
  it("persists workspace state in a repository-local JSON memento", async () => {
    const directory = await mkdtemp(join(tmpdir(), "keystone-workspace-state-"));
    const path = join(directory, ".keystone", "state", "workspace.json");
    const store = new WorkspaceStateStore(await FileMemento.open(path));
    await store.initialize();
    await store.setActiveSection("intelligence");

    const restored = new WorkspaceStateStore(await FileMemento.open(path));

    expect((await restored.initialize()).activeSection).toBe("intelligence");
    expect(JSON.parse(await readFile(path, "utf8"))).toHaveProperty(["keystone.workspaceState", "activeSection"], "intelligence");
  });

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
    expect(await restored.initialize()).toMatchObject({ activeSection: "workbench", activeRoute: "/workbench/new" });
  });

  it("persists a workflow route as the canonical navigation state", async () => {
    const memento = new MemoryMemento();
    const store = new WorkspaceStateStore(memento);
    await store.initialize();
    const workflowId = crypto.randomUUID();

    const state = await store.setActiveRoute(`/workbench/${workflowId}/review`);

    expect(state).toMatchObject({ activeSection: "workbench", activeRoute: `/workbench/${workflowId}/review` });
  });

  it("migrates the supported legacy state", async () => {
    const memento = new MemoryMemento();
    memento.values.set("keystone.workspaceState", { schemaVersion: 0, activeSection: "tasks", workflowCount: 3 });

    const state = await new WorkspaceStateStore(memento).initialize();

    expect(state).toMatchObject({ schemaVersion: 1, activeSection: "workbench", activeRoute: "/workbench/new", workflowCount: 3 });
  });

  it("migrates removed roadmap navigation without discarding valid state", async () => {
    const memento = new MemoryMemento();
    memento.values.set("keystone.workspaceState", { schemaVersion: 1, revision: 7, activeSection: "hub", workflowCount: 4, updatedAt: "2026-07-16T00:00:00.000Z" });

    const state = await new WorkspaceStateStore(memento).initialize();

    expect(state).toMatchObject({ schemaVersion: 1, revision: 8, activeSection: "intelligence", activeRoute: "/intelligence", workflowCount: 4 });
  });

  it("migrates a persisted legacy section into a canonical route", async () => {
    const memento = new MemoryMemento();
    memento.values.set("keystone.workspaceState", { schemaVersion: 1, revision: 2, activeSection: "delivery", workflowCount: 1, updatedAt: "2026-07-16T00:00:00.000Z" });

    const state = await new WorkspaceStateStore(memento).initialize();

    expect(state).toMatchObject({ revision: 3, activeSection: "workbench", activeRoute: "/workbench/new" });
  });

  it("preserves invalid data under a recovery key before resetting", async () => {
    const memento = new MemoryMemento();
    memento.values.set("keystone.workspaceState", { schemaVersion: 99, credential: "must-not-be-lost" });

    const state = await new WorkspaceStateStore(memento).initialize();

    expect(state.activeSection).toBe("home");
    expect([...memento.values.keys()].some((key) => key.startsWith("keystone.recovery.corruptState."))).toBe(true);
  });
});
