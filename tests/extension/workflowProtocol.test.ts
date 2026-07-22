import { describe, expect, it, vi } from "vitest";
import { WebviewRequestSchema } from "../../src/shared/contracts/messages";
import { WebviewMessageRouter } from "../../src/extension/webview/WebviewMessageRouter";
import { WorkflowService, type WorkflowPersistence } from "../../src/core/workflow/WorkflowService";

describe("Phase 2 workflow protocol", () => {
  it("validates workflow.create and rejects host-owned or unsupported fields", () => {
    const envelope = { requestId: crypto.randomUUID(), type: "workflow.create", timestamp: new Date().toISOString(), schemaVersion: 1 };
    expect(WebviewRequestSchema.safeParse({ ...envelope, payload: { correlationId: crypto.randomUUID(), intent: "Add refunds", workType: "feature", specification: "Refund settled orders." } }).success).toBe(true);
    expect(WebviewRequestSchema.safeParse({ ...envelope, payload: { correlationId: crypto.randomUUID(), intent: "Add refunds", workType: "feature", id: crypto.randomUUID() } }).success).toBe(false);
    expect(WebviewRequestSchema.safeParse({ ...envelope, payload: { correlationId: crypto.randomUUID(), intent: "", workType: "feature" } }).success).toBe(false);
  });

  it("validates active, list, and get requests", () => {
    const base = { requestId: crypto.randomUUID(), timestamp: new Date().toISOString(), schemaVersion: 1 };
    expect(WebviewRequestSchema.safeParse({ ...base, type: "workflow.loadActive", payload: {} }).success).toBe(true);
    expect(WebviewRequestSchema.safeParse({ ...base, type: "workflow.listCanonical", payload: {} }).success).toBe(true);
    expect(WebviewRequestSchema.safeParse({ ...base, type: "workflow.getCanonical", payload: { workflowId: crypto.randomUUID() } }).success).toBe(true);
  });

  it("returns typed creation success, active workflow, and idempotent duplicate responses", async () => {
    let stored: unknown;
    const persistence: WorkflowPersistence = { read: () => Promise.resolve(stored), write: (value) => { stored = structuredClone(value); return Promise.resolve(); } };
    const service = new WorkflowService(persistence); await service.initialize();
    const { router, posted } = createRouter(service);
    const request = { requestId: crypto.randomUUID(), type: "workflow.create", timestamp: new Date().toISOString(), schemaVersion: 1, payload: { correlationId: crypto.randomUUID(), intent: "Persist protocol", workType: "feature" } };
    await router.handle(request);
    await router.handle(request);
    expect(service.listWorkflows()).toHaveLength(1);
    expect(posted.filter((message) => message.type === "response/success")).toHaveLength(2);
    expect(posted[0]).toMatchObject({ payload: { data: { type: "workflow.created", workflow: { intent: { text: "Persist protocol" } } } } });
    const activeId = crypto.randomUUID();
    await router.handle({ requestId: activeId, type: "workflow.loadActive", timestamp: new Date().toISOString(), schemaVersion: 1, payload: {} });
    expect(posted.at(-1)).toMatchObject({ payload: { requestId: activeId, data: { id: service.getActiveWorkflow()?.id } } });
    router.dispose();
  });

  it("returns structured creation failure and null when no active workflow exists", async () => {
    const persistence: WorkflowPersistence = { read: () => Promise.resolve(undefined), write: () => Promise.reject(new Error("read-only storage")) };
    const service = new WorkflowService(persistence); await service.initialize();
    const { router, posted } = createRouter(service);
    await router.handle({ requestId: crypto.randomUUID(), type: "workflow.create", timestamp: new Date().toISOString(), schemaVersion: 1, payload: { correlationId: crypto.randomUUID(), intent: "Cannot persist", workType: "bug-fix" } });
    expect(posted[0]).toMatchObject({ payload: { data: { type: "workflow.creationFailed", error: { code: "WORKFLOW_PERSISTENCE_FAILED", message: "Keystone could not persist the workflow. Check repository write access, then try again.", recoverable: true } } } });
    await router.handle({ requestId: crypto.randomUUID(), type: "workflow.loadActive", timestamp: new Date().toISOString(), schemaVersion: 1, payload: {} });
    expect(posted.at(-1)).toMatchObject({ payload: { data: null } });
    router.dispose();
  });
});

function createRouter(canonicalWorkflow: WorkflowService) {
  const posted: Array<{ type: string; payload: unknown }> = [];
  const store = {
    snapshot: { activityRecords: [] as unknown[] },
    update: vi.fn(async function (this: { snapshot: Record<string, unknown> }, key: string, value: unknown) { this.snapshot = { ...this.snapshot, [key]: value }; return this.snapshot; }),
  };
  const router = new WebviewMessageRouter(
    store as never,
    {} as never,
    { error: vi.fn() } as never,
    "0.1.0",
    () => ({ name: "fixture", rootCount: 1, trust: "trusted", indexStatus: "ready" }),
    (message) => { posted.push(message as never); return Promise.resolve(true); },
    { canonicalWorkflow, intelligenceRuntime: { onDidChange: () => ({ dispose: vi.fn() }) }, intelligenceQuery: {}, workflow: { list: () => [] }, cpgQuery: {}, openSource: vi.fn() } as never,
  );
  return { router, posted };
}
