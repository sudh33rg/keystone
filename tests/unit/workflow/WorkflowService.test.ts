import { describe, expect, it } from "vitest";
import { WorkflowService, type WorkflowPersistence } from "../../../src/core/workflow/WorkflowService";

class MemoryPersistence implements WorkflowPersistence {
  value: unknown;
  writes = 0;
  fail = false;
  read(): Promise<unknown> { return Promise.resolve(this.value); }
  write(value: unknown): Promise<void> { if (this.fail) return Promise.reject(new Error("disk full")); this.writes += 1; this.value = structuredClone(value); return Promise.resolve(); }
}

describe("WorkflowService", () => {
  it.each([
    ["feature", ["Understand", "Plan", "Development", "Impact Analysis", "QA", "PR Review"]],
    ["bug-fix", ["Understand", "Impact Analysis", "Development", "QA", "PR Review"]],
    ["refactor", ["Understand", "Impact Analysis", "Plan", "Development", "QA", "PR Review"]],
    ["test-work", ["Understand", "Impact Analysis", "Test Work", "QA", "PR Review"]],
    ["investigation", ["Understand", "Investigation", "Complete"]],
  ] as const)("builds the %s read-only stage outline", async (workType, expected) => {
    const service = new WorkflowService(new MemoryPersistence()); await service.initialize();
    const workflow = await service.createWorkflow({ intent: `Create ${workType}`, workType }, `correlation-${workType}`);
    expect(workflow.stages.map((stage) => stage.displayName)).toEqual(expected);
    expect(workflow.specification).toBeUndefined();
  });

  it("creates a bounded active feature workflow with stable host fields", async () => {
    const persistence = new MemoryPersistence();
    const service = new WorkflowService(persistence, () => "2026-07-22T10:00:00.000Z", () => crypto.randomUUID());
    await service.initialize();
    const workflow = await service.createWorkflow({ intent: "Add refunds", workType: "feature", specification: "Refund authorized orders." }, "correlation-1");
    expect(workflow.id).toMatch(/^[0-9a-f-]{36}$/);
    expect(workflow.intent).toEqual({ text: "Add refunds", workType: "feature" });
    expect(workflow.specification).toEqual({ text: "Refund authorized orders.", revision: 1 });
    expect(workflow.status).toBe("active");
    expect(workflow.createdAt).toBe("2026-07-22T10:00:00.000Z");
    expect(workflow.updatedAt).toBe(workflow.createdAt);
    expect(workflow.stages.map((stage) => stage.displayName)).toEqual(["Understand", "Plan", "Development", "Impact Analysis", "QA", "PR Review"]);
    expect(workflow.stages[0]?.status).toBe("ready");
    expect(workflow.stages.slice(1).every((stage) => stage.status === "not-ready")).toBe(true);
    expect(workflow.currentStageId).toBe(workflow.stages[0]?.id);
  });

  it("rejects blank intent and blocks a second active workflow", async () => {
    const service = new WorkflowService(new MemoryPersistence());
    await service.initialize();
    await expect(service.createWorkflow({ intent: " ", workType: "feature" }, "blank")).rejects.toMatchObject({ code: "WORKFLOW_INTENT_INVALID" });
    await service.createWorkflow({ intent: "First", workType: "bug-fix" }, "first");
    await expect(service.createWorkflow({ intent: "Second", workType: "refactor" }, "second")).rejects.toMatchObject({ code: "ACTIVE_WORKFLOW_EXISTS" });
    expect(service.listWorkflows()).toHaveLength(1);
  });

  it("uses correlation idempotency and never reports a failed write as success", async () => {
    const persistence = new MemoryPersistence();
    const service = new WorkflowService(persistence);
    await service.initialize();
    const first = await service.createWorkflow({ intent: "Investigate retries", workType: "investigation" }, "same");
    const duplicate = await service.createWorkflow({ intent: "Investigate retries", workType: "investigation" }, "same");
    expect(duplicate.id).toBe(first.id);
    expect(persistence.writes).toBe(1);
    const failedPersistence = new MemoryPersistence(); failedPersistence.fail = true;
    const failing = new WorkflowService(failedPersistence); await failing.initialize();
    await expect(failing.createWorkflow({ intent: "Will fail", workType: "test-work" }, "fail")).rejects.toThrow("disk full");
    expect(failing.listWorkflows()).toEqual([]);
  });
});
