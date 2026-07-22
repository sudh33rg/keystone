import { describe, expect, it } from "vitest";
import { WorkflowService, type WorkflowPersistence } from "../../../src/core/workflow/WorkflowService";

describe("workflow persistence", () => {
  it("survives service recreation and restores list and active workflow", async () => {
    let stored: unknown;
    const persistence: WorkflowPersistence = { read: () => Promise.resolve(stored), write: (value) => { stored = structuredClone(value); return Promise.resolve(); } };
    const first = new WorkflowService(persistence); await first.initialize();
    const created = await first.createWorkflow({ intent: "Persist me", workType: "refactor", specification: "Keep behavior." }, "persist");
    const restarted = new WorkflowService(persistence); await restarted.initialize();
    expect(restarted.getWorkflow(created.id)).toEqual(created);
    expect(restarted.getActiveWorkflow()?.id).toBe(created.id);
    expect(restarted.listWorkflows()).toEqual([created]);
  });

  it("handles malformed stored records safely without inventing workflows", async () => {
    const persistence: WorkflowPersistence = { read: () => Promise.resolve({ schemaVersion: 1, workflows: [{ id: "bad" }], activeWorkflowId: "bad" }), write: () => Promise.resolve() };
    const service = new WorkflowService(persistence); await service.initialize();
    expect(service.listWorkflows()).toEqual([]);
    expect(service.getActiveWorkflow()).toBeNull();
    expect(service.diagnostics).toContain("Stored workflow state is malformed and was not loaded.");
  });
});
