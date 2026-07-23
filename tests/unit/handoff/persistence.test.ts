import { describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { HandoffPersistenceStore } from "../../../src/core/persistence/HandoffPersistenceStore";
import { TaskHandoffSchema, HANDOFF_SCHEMA_VERSION, type TaskHandoff } from "../../../src/shared/contracts/handoff";

function makeHandoff(workflowId: string, status: TaskHandoff["status"] = "draft"): TaskHandoff {
  const now = new Date().toISOString();
  return TaskHandoffSchema.parse({
    schemaVersion: HANDOFF_SCHEMA_VERSION,
    id: randomUUID(),
    workflowId,
    direction: "outgoing",
    status,
    progressSummary: "",
    completedWork: [],
    unresolvedWork: [],
    blockers: [],
    assumptions: [],
    nextAction: null,
    createdAt: now,
    updatedAt: now,
  });
}

describe("HandoffPersistenceStore", () => {
  it("detects an existing active outgoing draft for a workflow", async () => {
    const dir = await mkdtemp(join(tmpdir(), "handoff-"));
    const store = new HandoffPersistenceStore(dir);
    await store.initialize();
    expect(store.hasActiveDraft("00000000-0000-4000-8000-00000000000f")).toBe(false);
    await store.update((s) => ({ ...s, handoffs: [...s.handoffs, makeHandoff("00000000-0000-4000-8000-00000000000f", "draft")] }));
    expect(store.hasActiveDraft("00000000-0000-4000-8000-00000000000f")).toBe(true);
    await store.update((s) => ({ ...s, handoffs: [...s.handoffs, makeHandoff("00000000-0000-4000-8000-00000000000f", "draft")] }));
    expect(store.hasActiveDraft("00000000-0000-4000-8000-00000000000f")).toBe(true);
    await rm(dir, { recursive: true, force: true });
  });

  it("prevents duplicate active handoff drafts", async () => {
    const dir = await mkdtemp(join(tmpdir(), "handoff-"));
    const store = new HandoffPersistenceStore(dir);
    await store.initialize();
    await store.update((s) => ({ ...s, handoffs: [...s.handoffs, makeHandoff("00000000-0000-4000-8000-00000000000f", "draft")] }));
    const existing = store.listForWorkflow("00000000-0000-4000-8000-00000000000f");
    expect(existing.length).toBe(1);
    expect(store.hasActiveDraft("00000000-0000-4000-8000-00000000000f")).toBe(true);
    await rm(dir, { recursive: true, force: true });
  });

  it("persists handoff history across reload (simulated restart)", async () => {
    const dir = await mkdtemp(join(tmpdir(), "handoff-"));
    const store1 = new HandoffPersistenceStore(dir);
    await store1.initialize();
    await store1.update((s) => ({ ...s, handoffs: [...s.handoffs, makeHandoff("00000000-0000-4000-8000-00000000000f", "exported")] }));
    const store2 = new HandoffPersistenceStore(dir);
    await store2.initialize();
    expect(store2.listForWorkflow("00000000-0000-4000-8000-00000000000f").length).toBe(1);
    expect(store2.getHandoff(store1.listForWorkflow("00000000-0000-4000-8000-00000000000f")[0]!.id)).toBeTruthy();
    await rm(dir, { recursive: true, force: true });
  });
});
