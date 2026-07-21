import { describe, expect, it } from "vitest";
import { WebviewRequestSchema } from "../../src/shared/contracts/messages";

const validBase = {
  requestId: "d9428888-122b-11e1-b85c-61cd3cbb3210",
  timestamp: "2026-07-14T12:00:00.000Z",
  schemaVersion: 1,
};

describe("WebviewRequestSchema", () => {
  it("accepts a valid, versioned navigation request", () => {
    const result = WebviewRequestSchema.safeParse({
      ...validBase,
      type: "navigation/set",
      payload: { section: "tasks" },
    });
    expect(result.success).toBe(true);
    expect(
      WebviewRequestSchema.safeParse({
        ...validBase,
        type: "navigation/set",
        payload: { route: `/workbench/${crypto.randomUUID()}/plan` },
      }).success,
    ).toBe(true);
  });

  it("rejects unknown message types", () => {
    const result = WebviewRequestSchema.safeParse({
      ...validBase,
      type: "terminal/run-anything",
      payload: {},
    });
    expect(result.success).toBe(false);
  });

  it("rejects unsupported schema versions", () => {
    const result = WebviewRequestSchema.safeParse({
      ...validBase,
      schemaVersion: 2,
      type: "app/bootstrap",
      payload: {},
    });
    expect(result.success).toBe(false);
  });

  it("rejects extra payload fields", () => {
    const result = WebviewRequestSchema.safeParse({
      ...validBase,
      type: "settings/open",
      payload: { query: "keystone", injected: true },
    });
    expect(result.success).toBe(false);
  });

  it("accepts typed team assignment requests and rejects unbounded notes", () => {
    const ids = {
      workflowId: crypto.randomUUID(),
      taskId: crypto.randomUUID(),
      assignedBy: crypto.randomUUID(),
      assignedTo: crypto.randomUUID(),
    };
    expect(
      WebviewRequestSchema.safeParse({ ...validBase, type: "assignment/create", payload: ids })
        .success,
    ).toBe(true);
    expect(
      WebviewRequestSchema.safeParse({
        ...validBase,
        type: "assignment/create",
        payload: { ...ids, notes: "x".repeat(20_001) },
      }).success,
    ).toBe(false);
  });

  it("keeps repository-artifact export explicit and typed", () => {
    expect(
      WebviewRequestSchema.safeParse({
        ...validBase,
        type: "handoff/export",
        payload: { packageId: crypto.randomUUID(), mode: "repository-artifact" },
      }).success,
    ).toBe(true);
    expect(
      WebviewRequestSchema.safeParse({
        ...validBase,
        type: "handoff/export",
        payload: { packageId: crypto.randomUUID(), mode: "auto-push" },
      }).success,
    ).toBe(false);
  });

  it("rejects removed future-roadmap request surfaces", () => {
    for (const type of [
      "hub/search",
      "hub/publish",
      "model/list",
      "training/start",
      "routing/decide",
    ]) {
      expect(WebviewRequestSchema.safeParse({ ...validBase, type, payload: {} }).success).toBe(
        false,
      );
    }
  });
});
