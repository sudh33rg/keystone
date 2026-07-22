import { describe, expect, it } from "vitest";
import { WebviewRequestSchema } from "../../src/shared/contracts/messages";

describe("home protocol", () => {
  it("accepts the single bounded home/getState request", () => {
    expect(WebviewRequestSchema.safeParse({ requestId: crypto.randomUUID(), type: "home/getState", timestamp: new Date().toISOString(), schemaVersion: 1, payload: {} }).success).toBe(true);
  });
});
