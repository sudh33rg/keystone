import { describe, expect, it } from "vitest";
import { ContextPersistenceStore } from "../../../src/core/context/ContextPersistenceStore";
import { DevelopmentContextPackageService } from "../../../src/core/context/DevelopmentContextPackageService";
import { DevelopmentPromptService } from "../../../src/core/development/DevelopmentPromptService";

const workflowId = "10000000-0000-4000-8000-000000000001";
const stageId = "10000000-0000-4000-8000-000000000002";
const workItemId = "10000000-0000-4000-8000-000000000003";
const executionProfileId = "10000000-0000-4000-8000-000000000004";

function input() {
  return {
    workflowId, stageId, workItemId, executionProfileId,
    intent: "Add safe refund support", workType: "feature", specification: "Refunds require an audit entry.",
    objective: "Implement the refund guard", objectiveRevision: 1, specificationRevision: 2,
    budgetTokens: 4_000, pinnedItemIds: [] as string[], notes: "Preserve compatibility.",
    scope: [
      { id: "10000000-0000-4000-8000-000000000005", kind: "file" as const, workspaceRelativePath: "src/refund.ts", content: "export function refund(orderId: string) {\n  return audit(orderId);\n}\n" },
      { id: "10000000-0000-4000-8000-000000000006", kind: "symbol" as const, workspaceRelativePath: "src/order.ts", symbol: { entityId: "order-refund", name: "Order.refund", kind: "method", range: { startLine: 20, endLine: 28 } }, content: "refund(reason: string): Promise<Refund>" },
    ],
    skill: { id: "development", name: "Development", content: "Return changed files and tests run.", contentHash: "a".repeat(64) },
    instructions: [{ id: "instruction:repo", name: "Repository instructions", path: ".github/copilot-instructions.md", content: "Always run focused tests.", contentHash: "b".repeat(64) }],
  };
}

describe("DevelopmentContextPackageService", () => {
  it("builds a bounded measured baseline, persists dispositions, and approves by revision", async () => {
    const store = new ContextPersistenceStore();
    const service = new DevelopmentContextPackageService(store, () => "2026-07-22T12:00:00.000Z", () => "20000000-0000-4000-8000-000000000001");
    const pkg = await service.build(input());
    expect(pkg.rawBaseline.sources).toEqual(expect.arrayContaining(["workflow intent", "work type", "development objective", "src/refund.ts", "src/order.ts:20-28", "Development", ".github/copilot-instructions.md", "user notes"]));
    expect(pkg.rawBaseline.tokenizer.id).toBe(pkg.metrics.tokenizerId);
    expect(pkg.rawBaseline.tokenCount).toBeGreaterThan(pkg.compressed.tokenCount);
    expect(pkg.compressed.reductionTokens).toBe(pkg.rawBaseline.tokenCount - pkg.compressed.tokenCount);
    expect(pkg.compressed.reductionPercentage).toBeCloseTo((pkg.compressed.reductionTokens / pkg.rawBaseline.tokenCount) * 100);
    expect(pkg.items.some((item) => item.sourceReference.filePath === "src/refund.ts")).toBe(true);
    expect(pkg.items.some((item) => item.sourceReference.symbolId === "order-refund" && item.sourceReference.startLine === 20)).toBe(true);
    expect(pkg.requiredFacts.some((fact) => fact.critical && fact.state === "satisfied")).toBe(true);
    if (process.env.KEYSTONE_PHASE5_METRICS === "1") console.info("PHASE5_METRICS", JSON.stringify({ rawTokens: pkg.rawBaseline.tokenCount, compressedTokens: pkg.compressed.tokenCount, removedTokens: pkg.compressed.reductionTokens, reductionPercentage: pkg.compressed.reductionPercentage, criticalFactsCovered: pkg.requiredFacts.filter((fact) => fact.critical && fact.state === "satisfied").length, criticalFactsTotal: pkg.requiredFacts.filter((fact) => fact.critical).length, packageHash: pkg.metadata.contentHash, tokenizer: pkg.metrics.tokenizerId, measurement: pkg.metrics.tokenizerMeasurement }));
    const approved = await service.approve(workItemId, pkg.id, pkg.metadata.version, pkg.metadata.contentHash);
    expect(approved.metadata.status).toBe("approved");
    const prompt = new DevelopmentPromptService().prepare({ workflowId, workItemId, intent: "Add safe refund support", workType: "feature", objective: "Implement the refund guard", objectiveRevision: 1, repositoryName: "payments", scope: [], contextPackage: approved });
    expect(prompt).toMatchObject({ contextPackageId: approved.id, contextPackageRevision: approved.metadata.version, contextPackageHash: approved.metadata.contentHash, tokenMeasurement: approved.metrics.tokenizerMeasurement });
    expect(prompt.content).toContain(`Package: ${approved.id}`);
    for (const exclusion of approved.exclusions) expect(prompt.content).not.toContain(exclusion.item.content);
    await expect(service.approve(workItemId, pkg.id, pkg.metadata.version, pkg.metadata.contentHash)).rejects.toThrow(/revision conflict/i);
  });

  it("preserves an approved revision and creates a new package when budget changes", async () => {
    const store = new ContextPersistenceStore();
    const service = new DevelopmentContextPackageService(store);
    const first = await service.build(input());
    const approved = await service.approve(workItemId, first.id, first.metadata.version, first.metadata.contentHash);
    const regenerated = await service.changeBudget(input(), approved.id, approved.metadata.version, 2_500);
    expect(regenerated.id).not.toBe(approved.id);
    expect(store.get(approved.id)?.metadata.status).toBe("superseded");
    expect(regenerated.budget.requestedTokens).toBe(2_500);
  });

  it("blocks impossible budgets and stale package approval", async () => {
    const service = new DevelopmentContextPackageService(new ContextPersistenceStore());
    const blocked = await service.build({ ...input(), budgetTokens: 500 });
    expect(blocked.metadata.status).toBe("blocked");
    await expect(service.approve(workItemId, blocked.id, blocked.metadata.version, blocked.metadata.contentHash)).rejects.toThrow(/blocked context cannot be approved/i);
    await service.invalidate(workItemId, "Objective changed.");
    expect(service.get(workItemId)?.metadata.status).toBe("stale");
  });

  it("detects changed persisted inputs and blocks approval after required removal", async () => {
    const service = new DevelopmentContextPackageService(new ContextPersistenceStore());
    await service.build(input());
    expect(await service.ensureFresh(input())).toBe(true);
    expect(await service.ensureFresh({ ...input(), objective: "Changed objective" })).toBe(false);
    const regenerated = await service.build(input());
    const required = regenerated.items.find((item) => item.sourceReference.filePath === "src/refund.ts")!;
    const removed = await service.remove(workItemId, regenerated.id, regenerated.metadata.version, required.id, true);
    expect(removed.metadata.status).toBe("blocked");
    expect(removed.exclusions.find((entry) => entry.item.id === required.id)?.reason).toBe("user-removed");
    const restored = await service.restore(workItemId, removed.id, removed.metadata.version, required.id);
    expect(restored.metadata.status).toBe("ready");
  });

  it("merges overlapping symbol ranges while preserving the second source reference as an exclusion", async () => {
    const service = new DevelopmentContextPackageService(new ContextPersistenceStore());
    const overlapping = { id: "10000000-0000-4000-8000-000000000007", kind: "symbol" as const, workspaceRelativePath: "src/order.ts", symbol: { entityId: "order-refund-overlap", name: "Order.refund body", kind: "selection", range: { startLine: 24, endLine: 32 } }, content: "return audit(reason);\nreturn receipt;" };
    const pkg = await service.build({ ...input(), scope: [...input().scope, overlapping] });
    expect(pkg.items.filter((item) => item.sourceType === "symbol")).toHaveLength(1);
    const mergedExclusion = pkg.exclusions.find((entry) => entry.item.sourceReference.symbolId === "order-refund-overlap");
    expect(mergedExclusion?.reason).toBe("relationship-duplicate");
  });

  it("renders a persisted bounded Intelligence flow as readable call-flow context", async () => {
    const service = new DevelopmentContextPackageService(new ContextPersistenceStore());
    const flow = { id: "10000000-0000-4000-8000-000000000008", kind: "call-flow" as const, label: "Flow: POST /orders → OrderService.create → OrderRepository.save", entityIds: ["route:orders", "service:create", "repo:save"], edgeIds: ["edge:route-service", "edge:service-repo"], evidenceIds: ["evidence:route", "evidence:call"], intelligenceRevision: "7", content: "Flow: POST /orders → OrderService.create → OrderRepository.save\n\nSteps:\n1. POST /orders routes-to OrderService.create\n2. OrderService.create calls OrderRepository.save\n\nEvidence:\n- src/orders.ts:2–3\n- src/repository.ts:20–21\n\nStatic Intelligence path at revision 7; runtime order is not claimed." };
    const pkg = await service.build({ ...input(), intelligenceSelections: [flow] });
    const item = pkg.items.find((candidate) => candidate.sourceType === "call-flow");
    expect(item).toMatchObject({ title: flow.label, content: flow.content, importance: "supporting" });
    expect(pkg.rawBaseline.sources).toContain(`${flow.label} @ Intelligence 7`);
    expect(pkg.rawBaseline.sources).not.toContain(JSON.stringify(flow));
  });
});
