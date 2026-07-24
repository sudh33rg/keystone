// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { QueryWorkspace } from "../../src/ui/components/intelligence/QueryWorkspace";
import type { HostBridge } from "../../src/ui/services/HostBridge";

afterEach(cleanup);

function okfResult(): unknown {
  return {
    queryId: "00000000-0000-0000-0000-000000000000",
    operation: "OKF_CONCEPT",
    generation: 1,
    repositoryState: { repositoryId: "repo:test", generation: 1 },
    executionTimeMs: 12,
    resolvedSeeds: [],
    plan: {
      operation: "OKF_CONCEPT",
      resolvedSeedIds: [],
      ambiguousCandidateIds: [],
      indexesSelected: [],
      relationshipFamilies: [],
      traversalDirection: "both",
      maximumDepth: 2,
      confidenceThreshold: 0,
      capabilityThresholds: [],
      cpgRequired: false,
      resultLimits: { results: 20, nodes: 100, edges: 150, depth: 2, timeBudgetMs: 1000 },
      evidenceRequired: false,
      timeBudgetMs: 1000,
    },
    data: {
      kind: "okf-concepts",
      items: [
        {
          id: "entity:svc",
          type: "keystone.core.Class",
          name: "OrderService",
          qualifiedName: "OrderService",
          relativePath: "src/OrderService.ts",
          score: 980,
          confidence: 1,
          classification: "resolved",
          rankingReasons: ["exact qualified name"],
          okfConcept: {
            description: "Coordinates order lifecycle and payment capture.",
            methods: [
              { id: "entity:svc:create", name: "create", line: 12 },
              { id: "entity:svc:cancel", name: "cancel", line: 40 },
            ],
            calls: [{ id: "entity:repo:save", name: "OrderRepository.save" }],
            calledBy: [{ id: "entity:route:create", name: "OrderController.create" }],
            imports: [{ id: "entity:payment", name: "PaymentClient" }],
            evidenceIds: ["evidence:1", "evidence:2"],
          },
        },
      ],
      nodes: [],
      relationships: [],
      paths: [],
      sections: {},
      metrics: { concepts: 1 },
    },
    evidence: [],
    diagnostics: [],
    explanation: { steps: ["Resolved OKF concept."], rankingRules: [], capabilityBoundaries: [] },
    truncated: false,
    cacheState: "miss",
  };
}

describe("QueryWorkspace OKF concept card", () => {
  it("renders an OKF concept card with method/call/calledBy/import groups and evidence count", async () => {
    const request = vi.fn((type: string) =>
      type === "intelligence/query/compile"
        ? Promise.resolve({
            parsed: true,
            rule: "okf",
            query: { operation: "OKF_CONCEPT" },
            diagnostics: [],
          })
        : type === "intelligence/query"
          ? Promise.resolve(okfResult())
          : Promise.resolve(undefined),
    );
    render(<QueryWorkspace bridge={{ request } as unknown as HostBridge} initialInput="okf OrderService" />);
    fireEvent.click(screen.getByRole("button", { name: /Run query/i }));
    expect(await screen.findByText(/Coordinates order lifecycle/i)).toBeTruthy();
    expect(screen.getByRole("button", { name: "create" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "OrderRepository.save" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "OrderController.create" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "PaymentClient" })).toBeTruthy();
    expect(screen.getByText(/2 supporting evidence records/i)).toBeTruthy();
  });
});
