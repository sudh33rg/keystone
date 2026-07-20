import { describe, expect, it } from "vitest";
import { COMPATIBILITY_REDIRECTS, PRIMARY_NAVIGATION, compatibilityRoute, parseWorkbenchRoute, sectionForRoute, workbenchRoute } from "../../src/shared/navigation";

describe("product navigation", () => {
  it("exposes only the four workflow-oriented primary destinations", () => {
    expect(PRIMARY_NAVIGATION.map((item) => item.label)).toEqual(["Home", "Active Work", "Intelligence", "History"]);
  });

  it("parses all canonical Workbench stages", () => {
    const workflowId = crypto.randomUUID();
    for (const stage of ["define", "plan", "build", "validate", "review", "complete"] as const) {
      const route = workbenchRoute(workflowId, stage);
      expect(parseWorkbenchRoute(route)).toEqual({ kind: "workflow", workflowId, stage });
      expect(sectionForRoute(route)).toBe("active-work");
    }
  });

  it("maps legacy sections and routes without discarding persisted workflows", () => {
    const workflowId = crypto.randomUUID();
    expect(compatibilityRoute("intent", workflowId)).toBe(`/workbench/${workflowId}/define`);
    expect(compatibilityRoute("tasks", workflowId)).toBe(`/workbench/${workflowId}/plan`);
    expect(compatibilityRoute("orchestration", workflowId)).toBe(`/workbench/${workflowId}/build`);
    expect(compatibilityRoute("delivery", workflowId)).toBe(`/workbench/${workflowId}/complete`);
    expect(COMPATIBILITY_REDIRECTS).toMatchObject({ "/intent": "/workbench/new", "/tasks": "/workbench/new", "/active-workflow": "/workbench/new", "/delivery": "/workbench/new", "/handoff": "/" });
  });
});
