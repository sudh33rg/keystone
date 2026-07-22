import { describe, expect, it } from "vitest";
import { WebviewRequestSchema } from "../../src/shared/contracts/messages";

describe("execution configuration protocol", () => {
  it.each(["executionConfiguration.load", "executionConfiguration.refresh", "executionConfiguration.discoverInstructions", "executionConfiguration.listSkills", "executionConfiguration.detectConflicts"])("accepts correlated %s requests", (type) => {
    expect(WebviewRequestSchema.parse({ requestId: crypto.randomUUID(), type, payload: { correlationId: crypto.randomUUID(), workflowId: crypto.randomUUID(), workItemId: crypto.randomUUID(), ...(type === "executionConfiguration.detectConflicts" ? { instructionIds: [] } : {}) }, timestamp: new Date().toISOString(), schemaVersion: 1 }).type).toBe(type);
  });
  it("accepts authoritative profile save input", () => {
    const parsed = WebviewRequestSchema.parse({ requestId: crypto.randomUUID(), type: "executionConfiguration.saveProfile", payload: { correlationId: crypto.randomUUID(), workflowId: crypto.randomUUID(), workItemId: crypto.randomUUID(), executionCapabilityId: "clipboard", skillId: "development", instructionIds: [] }, timestamp: new Date().toISOString(), schemaVersion: 1 });
    expect(parsed.type).toBe("executionConfiguration.saveProfile");
  });
  it("rejects uncorrelated configuration input", () => {
    expect(() => WebviewRequestSchema.parse({ requestId: crypto.randomUUID(), type: "executionConfiguration.load", payload: {}, timestamp: new Date().toISOString(), schemaVersion: 1 })).toThrow();
  });
});
