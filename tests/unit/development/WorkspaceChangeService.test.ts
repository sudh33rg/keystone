import { describe, expect, it } from "vitest";
import { WorkspaceChangeService } from "../../../src/core/development/WorkspaceChangeService";

describe("WorkspaceChangeService", () => {
  it("returns real normalized changes without associating them", async () => {
    const service = new WorkspaceChangeService({ detect: async () => [{ path: "src/a.ts", status: "modified", staged: false }, { path: "src/b.ts", status: "added", staged: true }] });
    const result = await service.detect();
    expect(result.available).toBe(true);
    expect(result.changes).toHaveLength(2);
    expect(result.changes.every((change) => change.associated === false)).toBe(true);
  });

  it("returns a structured unavailable result when Git is unavailable", async () => {
    const service = new WorkspaceChangeService({ detect: async () => undefined });
    expect(await service.detect()).toMatchObject({ available: false, message: "Source-control change detection is unavailable. Select changed files manually." });
  });

  it("excludes Keystone's own persisted runtime state", async () => {
    const service = new WorkspaceChangeService({
      detect: async () => [
        { path: ".keystone/workflows/phase-3-development.json", status: "added", staged: false },
        { path: "src/refund.ts", status: "modified", staged: false },
      ],
    });

    expect((await service.detect()).changes.map((change) => change.path)).toEqual(["src/refund.ts"]);
  });
});
