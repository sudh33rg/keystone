import { describe, expect, it } from "vitest";
import { parseWebviewRequest } from "../../src/shared/contracts/messages";

describe("execution configuration protocol", () => {
  it.each(["executionConfiguration.load", "executionConfiguration.refresh", "executionConfiguration.discoverInstructions", "executionConfiguration.listSkills", "executionConfiguration.detectConflicts"])("accepts correlated %s requests", (type) => {
    expect(parseWebviewRequest({ requestId: crypto.randomUUID(), type, payload: { correlationId: crypto.randomUUID(), workflowId: crypto.randomUUID(), workItemId: crypto.randomUUID() } }).type).toBe(type);
  });
  it("accepts authoritative profile save input", () => {
    const parsed = parseWebviewRequest({ requestId: crypto.randomUUID(), type: "executionConfiguration.saveProfile", payload: { correlationId: crypto.randomUUID(), workflowId: crypto.randomUUID(), workItemId: crypto.randomUUID(), executionCapabilityId: "clipboard", skillId: "development", instructionIds: [] } });
    expect(parsed.type).toBe("executionConfiguration.saveProfile");
  });
  it("rejects uncorrelated configuration input", () => {
    expect(() => parseWebviewRequest({ requestId: crypto.randomUUID(), type: "executionConfiguration.load", payload: {} })).toThrow();
  });
});
