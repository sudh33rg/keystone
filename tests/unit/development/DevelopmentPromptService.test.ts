import { describe, expect, it } from "vitest";
import { DevelopmentPromptService } from "../../../src/core/development/DevelopmentPromptService";

describe("DevelopmentPromptService", () => {
  it("uses only real workflow, objective, specification, repository, file, and symbol inputs", () => {
    const service = new DevelopmentPromptService(() => "2026-07-22T12:00:00.000Z", () => "00000000-0000-4000-8000-000000000001");
    const input = { workflowId: crypto.randomUUID(), workItemId: crypto.randomUUID(), intent: "Add refunds", workType: "feature" as const, specification: "Audit every refund.", objective: "Implement refund guard", objectiveRevision: 2, repositoryName: "payments", notes: "Preserve compatibility.", scope: [{ id: crypto.randomUUID(), kind: "file" as const, workspaceRelativePath: "src/refund.ts" }, { id: crypto.randomUUID(), kind: "symbol" as const, workspaceRelativePath: "src/order.ts", symbol: { entityId: "e1", name: "Order.refund", kind: "method" } }] };
    const prepared = service.prepare(input);
    expect(prepared.content).toContain("Intent:\nAdd refunds");
    expect(prepared.content).toContain("Specification:\nAudit every refund.");
    expect(prepared.content).toContain("src/refund.ts");
    expect(prepared.content).toContain("Order.refund (method) — src/order.ts");
    expect(prepared.content).not.toMatch(/agent identity|context compression|token optimization/i);
    expect(service.prepare(input).contentHash).toBe(prepared.contentHash);
    expect(service.prepare({ ...input, objective: "Different objective" }).contentHash).not.toBe(prepared.contentHash);
  });
});
