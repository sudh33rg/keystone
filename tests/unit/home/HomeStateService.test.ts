import { describe, expect, it } from "vitest";
import { HomeStateService } from "../../../src/core/home/HomeStateService";

describe("HomeStateService", () => {
  it("projects only repository, one persisted active workflow, and real activity", async () => {
    const service = new HomeStateService(
      () => ({ name: "keystone", rootCount: 1, trust: "trusted", indexStatus: "ready" }),
      { overview: async () => ({ status: "ready", generation: 4, repository: { name: "keystone" } }) } as never,
      { listWorkflows: () => [], getActiveWorkflow: () => ({ id: "w1", status: "active", updatedAt: "2026-07-22T00:00:00.000Z", intent: { text: "Ship shell", workType: "feature" } }) } as never,
      () => [{ id: "a1", title: "Repository indexed", status: "completed", updatedAt: "2026-07-22T00:00:00.000Z" }] as never,
    );
    const state = await service.getState();
    expect(Object.keys(state)).toEqual(["repository", "activeWorkflow", "recentActivities"]);
    expect(state.repository.generation).toBe(4);
    expect(state.activeWorkflow?.intent).toBe("Ship shell");
    expect(state.recentActivities[0]?.title).toBe("Repository indexed");
  });
});
