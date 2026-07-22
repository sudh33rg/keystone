import { describe, expect, it } from "vitest";
import { WebviewRequestSchema } from "../../src/shared/contracts/messages";

describe("Development protocol", () => {
  it.each([
    ["development.initialize", { correlationId: crypto.randomUUID(), workflowId: crypto.randomUUID() }],
    ["development.updateObjective", { correlationId: crypto.randomUUID(), workflowId: crypto.randomUUID(), workItemId: crypto.randomUUID(), objective: "Implement refunds" }],
    ["development.addCurrentFile", { correlationId: crypto.randomUUID(), workflowId: crypto.randomUUID(), workItemId: crypto.randomUUID() }],
    ["development.addSelectedFiles", { correlationId: crypto.randomUUID(), workflowId: crypto.randomUUID(), workItemId: crypto.randomUUID() }],
    ["development.addCurrentSelection", { correlationId: crypto.randomUUID(), workflowId: crypto.randomUUID(), workItemId: crypto.randomUUID() }],
    ["development.addIntelligenceSymbol", { correlationId: crypto.randomUUID(), workflowId: crypto.randomUUID(), workItemId: crypto.randomUUID(), entityId: "entity-1" }],
    ["development.removeScopeItem", { correlationId: crypto.randomUUID(), workflowId: crypto.randomUUID(), workItemId: crypto.randomUUID(), scopeItemId: crypto.randomUUID() }],
    ["development.preparePrompt", { correlationId: crypto.randomUUID(), workflowId: crypto.randomUUID(), workItemId: crypto.randomUUID(), notes: "Keep compatibility" }],
    ["development.copyPrompt", { correlationId: crypto.randomUUID(), workflowId: crypto.randomUUID(), workItemId: crypto.randomUUID() }],
    ["development.confirmHandoff", { correlationId: crypto.randomUUID(), workflowId: crypto.randomUUID(), workItemId: crypto.randomUUID() }],
    ["development.recordManualOrigin", { correlationId: crypto.randomUUID(), workflowId: crypto.randomUUID(), workItemId: crypto.randomUUID() }],
    ["development.loadChanges", { correlationId: crypto.randomUUID(), workflowId: crypto.randomUUID(), workItemId: crypto.randomUUID() }],
    ["development.recordResult", { correlationId: crypto.randomUUID(), workflowId: crypto.randomUUID(), workItemId: crypto.randomUUID(), summary: "Implemented" }],
    ["development.associateChangedFiles", { correlationId: crypto.randomUUID(), workflowId: crypto.randomUUID(), workItemId: crypto.randomUUID(), resultId: crypto.randomUUID(), associated: ["src/a.ts"], excluded: [{ path: "src/b.ts", reason: "Unrelated" }] }],
    ["development.confirmNoCode", { correlationId: crypto.randomUUID(), workflowId: crypto.randomUUID(), workItemId: crypto.randomUUID(), resultId: crypto.randomUUID(), explanation: "Design only", confirmed: true }],
    ["development.reviewResult", { correlationId: crypto.randomUUID(), workflowId: crypto.randomUUID(), workItemId: crypto.randomUUID(), resultId: crypto.randomUUID(), decision: "accepted" }],
    ["development.complete", { correlationId: crypto.randomUUID(), workflowId: crypto.randomUUID(), workItemId: crypto.randomUUID() }],
  ])("validates %s", (type, payload) => {
    expect(WebviewRequestSchema.safeParse({ requestId: crypto.randomUUID(), type, payload, timestamp: new Date().toISOString(), schemaVersion: 1 }).success).toBe(true);
  });

  it("rejects mismatched or uncorrelated Development requests at the boundary", () => {
    expect(WebviewRequestSchema.safeParse({ requestId: crypto.randomUUID(), type: "development.updateObjective", payload: { workflowId: crypto.randomUUID(), workItemId: crypto.randomUUID(), objective: "x" }, timestamp: new Date().toISOString(), schemaVersion: 1 }).success).toBe(false);
  });
});
