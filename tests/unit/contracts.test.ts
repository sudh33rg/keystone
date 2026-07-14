import { describe, expect, it } from "vitest";
import { WebviewRequestSchema } from "../../src/shared/contracts/messages";

const validBase = {
  requestId: "d9428888-122b-11e1-b85c-61cd3cbb3210",
  timestamp: "2026-07-14T12:00:00.000Z",
  schemaVersion: 1
};

describe("WebviewRequestSchema", () => {
  it("accepts a valid, versioned navigation request", () => {
    const result = WebviewRequestSchema.safeParse({ ...validBase, type: "navigation/set", payload: { section: "tasks" } });
    expect(result.success).toBe(true);
  });

  it("rejects unknown message types", () => {
    const result = WebviewRequestSchema.safeParse({ ...validBase, type: "terminal/run-anything", payload: {} });
    expect(result.success).toBe(false);
  });

  it("rejects unsupported schema versions", () => {
    const result = WebviewRequestSchema.safeParse({ ...validBase, schemaVersion: 2, type: "app/bootstrap", payload: {} });
    expect(result.success).toBe(false);
  });

  it("rejects extra payload fields", () => {
    const result = WebviewRequestSchema.safeParse({ ...validBase, type: "settings/open", payload: { query: "keystone", injected: true } });
    expect(result.success).toBe(false);
  });
});

