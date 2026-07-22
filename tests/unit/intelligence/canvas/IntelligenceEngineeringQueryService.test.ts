import { describe, expect, it } from "vitest";
import { IntelligenceEngineeringQueryService } from "../../../../src/core/intelligence/canvas/IntelligenceEngineeringQueryService";
import { IntelligenceGraphSliceService } from "../../../../src/core/intelligence/canvas/IntelligenceGraphSliceService";
import { canvasSnapshot } from "./fixtures";

const make = () => { const reader = { getSnapshot: () => canvasSnapshot(), isStorageAvailable: () => true, getLoadError: () => undefined }; return new IntelligenceEngineeringQueryService(new IntelligenceGraphSliceService(reader)); };

describe("IntelligenceEngineeringQueryService", () => {
  it.each([
    ["Show callers of create", "callers"], ["Who calls create?", "callers"],
    ["Show callees of OrderService.create", "callees"], ["What does OrderService.create call?", "callees"],
    ["Show dependencies of orders.ts", "dependencies"], ["What depends on orders.ts?", "dependents"],
    ["Which tests cover OrderService.create?", "tests"],
    ["Show flow from POST /orders to OrderRepository.save", "flow"],
    ["How are POST /orders and OrderRepository.save connected?", "relationship"],
    ["Explain relationship between POST /orders and OrderRepository.save", "relationship"],
    ["How does POST /orders reach OrderRepository.save?", "flow"],
  ])("parses %s", (text, intent) => expect(make().parse(text)).toMatchObject({ intent, status: "parsed" }));

  it("reports missing subjects and unsupported questions without inventing IDs", () => {
    expect(make().parse("Show callers")).toMatchObject({ status: "needs-subject-selection" });
    expect(make().parse("Refactor this repository for me")).toMatchObject({ status: "unsupported" });
  });

  it("requires explicit selection for ambiguous subjects", () => {
    const result = make().execute({ text: "Show callers of create", intelligenceRevision: "7", limits: { maxNodes: 20, maxEdges: 30, depth: 1 } });
    expect(result.status).toBe("needs-subject-selection");
    expect(result.subjectCandidates).toHaveLength(2);
    expect(result.graph).toBeUndefined();
  });

  it("executes callers, callees, dependencies, dependents, tests and evidence-backed flow as bounded graphs", () => {
    const service = make();
    const callers = service.execute({ text: "Show callers of OrderService.create", intelligenceRevision: "7", limits: { maxNodes: 20, maxEdges: 30, depth: 1 } });
    expect(callers.graph?.edges.map((edge) => edge.relationshipType)).toEqual(["routes-to"]);
    const callees = service.execute({ text: "Show callees of OrderService.create", intelligenceRevision: "7", limits: { maxNodes: 20, maxEdges: 30, depth: 1 } });
    expect(callees.graph?.edges.map((edge) => edge.relationshipType)).toEqual(["calls"]);
    expect(service.execute({ text: "Show dependencies of orders.ts", intelligenceRevision: "7", limits: { maxNodes: 20, maxEdges: 30, depth: 1 } }).graph?.edges[0]?.relationshipType).toBe("imports");
    expect(service.execute({ text: "Show dependents of repository.ts", intelligenceRevision: "7", limits: { maxNodes: 20, maxEdges: 30, depth: 1 } }).graph?.edges[0]?.relationshipType).toBe("imports");
    const tests = service.execute({ text: "Show tests for OrderService.create", intelligenceRevision: "7", limits: { maxNodes: 20, maxEdges: 30, depth: 1 } });
    expect(tests.summary).toMatch(/static intelligence mapping/i);
    expect(tests.graph?.edges[0]?.relationshipType).toBe("tested-by");
    const flow = service.execute({ text: "Show flow from POST /orders to OrderRepository.save", intelligenceRevision: "7", limits: { maxNodes: 20, maxEdges: 30, depth: 3 } });
    expect(flow.status).toBe("completed");
    expect(flow.path?.entityIds).toEqual(["entity:route:orders", "entity:orders:create", "entity:repo:save"]);
    expect(flow.path?.evidenceIds).toEqual(["evidence:route-create", "evidence:create-save"]);
  });

  it("returns a truthful empty result when no evidence-backed path exists", () => {
    const result = make().execute({ text: "Show flow from POST /orders to UserService.create", intelligenceRevision: "7", resolvedTargetId: "entity:users:create", limits: { maxNodes: 10, maxEdges: 10, depth: 3 } });
    expect(result).toMatchObject({ status: "no-result", graph: undefined });
    expect(result.summary).toMatch(/no evidence-backed path/i);
  });
});
