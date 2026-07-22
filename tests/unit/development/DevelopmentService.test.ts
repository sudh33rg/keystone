import { describe, expect, it } from "vitest";
import { DevelopmentService, DevelopmentServiceError, type DevelopmentPersistence } from "../../../src/core/development/DevelopmentService";
import { WorkflowService, type WorkflowPersistence } from "../../../src/core/workflow/WorkflowService";

function memoryPersistence<T>() {
  let value: T | undefined;
  return { adapter: { read: async () => value, write: async (next: T) => { value = structuredClone(next); } }, read: () => value };
}

async function fixture() {
  const workflows = memoryPersistence<never>();
  const workflowService = new WorkflowService(workflows.adapter as WorkflowPersistence);
  await workflowService.initialize();
  const workflow = await workflowService.createWorkflow({ intent: "Add refund safeguards", workType: "feature", specification: "Keep an audit record." }, "workflow-create");
  const development = memoryPersistence<never>();
  const service = new DevelopmentService(development.adapter as DevelopmentPersistence, workflowService, () => "2026-07-22T12:00:00.000Z", (() => { let id = 0; return () => `00000000-0000-4000-8000-${String(++id).padStart(12, "0")}`; })());
  await service.initialize();
  return { service, workflow, workflowService, stored: development.read };
}

describe("DevelopmentService", () => {
  it("creates one stable work item from the persisted Development stage and intent", async () => {
    const { service, workflow } = await fixture();
    const first = await service.initializeStage(workflow.id, "init-1");
    const second = await service.initializeStage(workflow.id, "init-2");
    expect(first.workItem.id).toBe(second.workItem.id);
    expect(first.workItem.stageId).toBe(workflow.stages.find((stage) => stage.type === "development")?.id);
    expect(first.workItem.objective).toBe("Add refund safeguards");
    expect(first.workItem.status).toBe("ready");
  });

  it("persists trimmed objective edits, rejects blank edits, and supersedes prepared prompts", async () => {
    const { service, workflow } = await fixture();
    const initialized = await service.initializeStage(workflow.id, "init");
    await service.addScopeItem(workflow.id, initialized.workItem.id, scopeFixture(workflow.id, initialized.workItem.id), "scope");
    const prepared = await service.preparePrompt(workflow.id, initialized.workItem.id, "fixture", undefined, "prompt");
    expect(prepared.promptPreparation).not.toBeNull();
    await service.updateObjective(workflow.id, initialized.workItem.id, "  Implement guarded refund transitions  ", "objective-1");
    expect((await service.load(workflow.id))).toMatchObject({ workItem: { objective: "Implement guarded refund transitions" }, promptPreparation: null });
    await expect(service.updateObjective(workflow.id, initialized.workItem.id, "   ", "objective-2")).rejects.toMatchObject({ code: "invalid-objective" });
  });

  it("survives service recreation with stable work-item, stage, objective, and source-scope IDs", async () => {
    const workflows = memoryPersistence<never>(); const workflowService = new WorkflowService(workflows.adapter as WorkflowPersistence); await workflowService.initialize();
    const workflow = await workflowService.createWorkflow({ intent: "Persist Development", workType: "bug-fix" }, "workflow");
    const development = memoryPersistence<never>(); const first = new DevelopmentService(development.adapter as DevelopmentPersistence, workflowService); await first.initialize();
    const initialized = await first.initializeStage(workflow.id, "init"); const scope = scopeFixture(workflow.id, initialized.workItem.id); await first.addScopeItem(workflow.id, initialized.workItem.id, scope, "scope");
    await first.updateObjective(workflow.id, initialized.workItem.id, "Persisted objective", "objective");
    const restarted = new DevelopmentService(development.adapter as DevelopmentPersistence, workflowService); await restarted.initialize(); const restored = await restarted.load(workflow.id);
    expect(restored.workItem).toMatchObject({ id: initialized.workItem.id, stageId: initialized.workItem.stageId, objective: "Persisted objective" });
    expect(restored.scopeItems[0]?.id).toBe(scope.id);
  });

  it("associates only selected changes, preserves exclusions, and completes after accepted review", async () => {
    const { service, workflow, workflowService } = await fixture(); const initialized = await service.initializeStage(workflow.id, "init");
    await service.addScopeItem(workflow.id, initialized.workItem.id, scopeFixture(workflow.id, initialized.workItem.id), "scope");
    await service.preparePrompt(workflow.id, initialized.workItem.id, "fixture", undefined, "prompt"); await service.recordManualOrigin(workflow.id, initialized.workItem.id, "manual");
    const result = await service.recordResult(workflow.id, initialized.workItem.id, { summary: "Changed one file", testsRun: "npm test" }, "result");
    await service.associateChangedFiles(workflow.id, initialized.workItem.id, result.id, ["src/refund.ts"], [{ path: "README.md", reason: "Pre-existing documentation edit" }], "associate");
    const reviewed = await service.reviewResult(workflow.id, initialized.workItem.id, result.id, "accepted", "review");
    expect(reviewed.result).toMatchObject({ associatedChangedFiles: ["src/refund.ts"], excludedChangedFiles: [{ path: "README.md", reason: "Pre-existing documentation edit" }], reviewStatus: "accepted" });
    await service.completeDevelopment(workflow.id, initialized.workItem.id, "complete");
    expect(workflowService.getWorkflow(workflow.id)?.stages.find((stage) => stage.type === "development")?.status).toBe("completed");
  });

  it("allows explicitly manual work to complete without preparing or handing off a prompt", async () => {
    const { service, workflow } = await fixture();
    const initialized = await service.initializeStage(workflow.id, "init");
    await service.addScopeItem(workflow.id, initialized.workItem.id, scopeFixture(workflow.id, initialized.workItem.id), "scope");
    await service.recordManualOrigin(workflow.id, initialized.workItem.id, "manual");
    const result = await service.recordResult(workflow.id, initialized.workItem.id, { summary: "Completed manually." }, "result");
    await service.associateChangedFiles(workflow.id, initialized.workItem.id, result.id, ["src/refund.ts"], [], "associate");
    await service.reviewResult(workflow.id, initialized.workItem.id, result.id, "accepted", "review");

    expect((await service.load(workflow.id)).completion).toMatchObject({ allowed: true, unmet: [] });
    await expect(service.completeDevelopment(workflow.id, initialized.workItem.id, "complete")).resolves.toMatchObject({ workItem: { status: "completed" } });
  });

  it("rejects invalid work-item transitions", async () => {
    const { service, workflow } = await fixture();
    const initialized = await service.initializeStage(workflow.id, "init");
    await expect(service.transitionStatus(workflow.id, initialized.workItem.id, "completed", "invalid-transition")).rejects.toBeInstanceOf(DevelopmentServiceError);
  });

  it("requires an accepted result and associated change or confirmed no-code outcome before completion", async () => {
    const { service, workflow, workflowService } = await fixture();
    const initialized = await service.initializeStage(workflow.id, "init");
    await service.addScopeItem(workflow.id, initialized.workItem.id, { id: crypto.randomUUID(), workflowId: workflow.id, workItemId: initialized.workItem.id, kind: "file", fileUri: "file:///workspace/src/refund.ts", workspaceRelativePath: "src/refund.ts", source: "file-picker", availability: "available", createdAt: "2026-07-22T12:00:00.000Z" }, "scope");
    await service.preparePrompt(workflow.id, initialized.workItem.id, "fixture", undefined, "prompt");
    await expect(service.completeDevelopment(workflow.id, initialized.workItem.id, "complete-early")).rejects.toMatchObject({ code: "result-not-reviewed" });
    await service.recordManualOrigin(workflow.id, initialized.workItem.id, "manual-origin");
    const result = await service.recordResult(workflow.id, initialized.workItem.id, { summary: "Implemented locally." }, "result");
    await expect(service.completeDevelopment(workflow.id, initialized.workItem.id, "complete-unreviewed")).rejects.toMatchObject({ code: "result-not-reviewed" });
    await service.reviewResult(workflow.id, initialized.workItem.id, result.id, "accepted", "review");
    await expect(service.completeDevelopment(workflow.id, initialized.workItem.id, "complete-no-files")).rejects.toMatchObject({ code: "completion-gate-failed" });
    await service.confirmNoCode(workflow.id, initialized.workItem.id, result.id, "Design-only outcome", true, "no-code");
    await expect(service.completeDevelopment(workflow.id, initialized.workItem.id, "complete-no-code-unreviewed")).rejects.toMatchObject({ code: "result-not-reviewed" });
    await service.reviewResult(workflow.id, initialized.workItem.id, result.id, "accepted", "review-no-code");
    await service.completeDevelopment(workflow.id, initialized.workItem.id, "complete");
    expect((await service.load(workflow.id)).workItem.status).toBe("completed");
    const persisted = workflowService.getWorkflow(workflow.id)!;
    expect(persisted.stages.find((stage) => stage.type === "development")?.status).toBe("completed");
    expect(persisted.stages.find((stage) => stage.id === persisted.currentStageId)?.status).toBe("ready");
  });
});

function scopeFixture(workflowId: string, workItemId: string) {
  return { id: crypto.randomUUID(), workflowId, workItemId, kind: "file" as const, fileUri: "file:///workspace/src/refund.ts", workspaceRelativePath: "src/refund.ts", source: "file-picker" as const, availability: "available" as const, createdAt: "2026-07-22T12:00:00.000Z" };
}
