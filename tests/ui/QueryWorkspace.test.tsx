// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { QueryWorkspace } from "../../src/ui/components/intelligence/QueryWorkspace";
import type { HostBridge } from "../../src/ui/services/HostBridge";

describe("QueryWorkspace", () => {
  afterEach(() => { cleanup(); localStorage.clear(); });
  it("shows templates, compiled query preview, bounded results, and explanation", async () => {
    const request = vi.fn((type: string, _payload?: unknown, _options?: { signal?: AbortSignal }) => {
      void _payload; void _options;
      if (type === "intelligence/query/templates") return Promise.resolve({ templates: [{ id: "path", label: "Find path", template: "path from <entity> to <entity>", operation: "PATH" }] });
      if (type === "intelligence/query/suggestions") return Promise.resolve({ generation: 3, items: [{ value: "OrderService.create", label: "create", kind: "entity", detail: "Method · service.ts", entityId: "entity:service" }] });
      if (type === "intelligence/query/compile") return Promise.resolve({ input: "dependencies of OrderService.create", parsed: true, rule: "dependencies", query: structuredQuery(), diagnostics: [], suggestedTemplates: [] });
      if (type === "intelligence/query") return Promise.resolve(queryResult());
      return Promise.resolve(undefined);
    });
    render(<QueryWorkspace bridge={{ request } as unknown as HostBridge}/>);
    expect(await screen.findByText("path from <entity> to <entity>")).toBeTruthy();
    fireEvent.change(screen.getByLabelText("Global intelligence query"), { target: { value: "dependencies of OrderService.create" } });
    fireEvent.click(screen.getByRole("button", { name: "Run query" }));
    expect(await screen.findByText("DEPENDENCIES · dependencies")).toBeTruthy();
    expect(await screen.findByText("save")).toBeTruthy();
    expect(screen.getByText(/cache miss/)).toBeTruthy();
    fireEvent.click(screen.getByText("Explain this query"));
    expect(screen.getByText(/Executed dependencies/)).toBeTruthy();
    const queryCall = request.mock.calls.find(([type]) => type === "intelligence/query"); expect(queryCall?.[1]).toEqual({ text: "dependencies of OrderService.create" }); expect(queryCall?.[2]?.signal).toBeInstanceOf(AbortSignal);
  });

  it("cancels an active query through the request abort signal", async () => {
    let signal: AbortSignal | undefined;
    const request = vi.fn((type: string, _payload: unknown, options?: { signal?: AbortSignal }) => {
      if (type === "intelligence/query/templates") return Promise.resolve({ templates: [] });
      if (type === "intelligence/query/compile") return Promise.resolve({ input: "show dependency cycles", parsed: true, rule: "cycles", query: { ...structuredQuery(), operation: "CYCLES", seeds: undefined }, diagnostics: [], suggestedTemplates: [] });
      if (type === "intelligence/query") { signal = options?.signal; return new Promise(() => undefined); }
      return Promise.resolve({ generation: 3, items: [] });
    });
    render(<QueryWorkspace bridge={{ request } as unknown as HostBridge}/>);
    fireEvent.change(screen.getByLabelText("Global intelligence query"), { target: { value: "show dependency cycles" } }); fireEvent.click(screen.getByRole("button", { name: "Run query" }));
    expect(await screen.findByRole("button", { name: "Cancel" })).toBeTruthy(); fireEvent.click(screen.getByRole("button", { name: "Cancel" })); expect(signal?.aborted).toBe(true);
  });
});

function structuredQuery() { return { operation: "DEPENDENCIES", seeds: [{ value: "OrderService.create", kind: "name" }], filters: { confidenceAtLeast: 0 }, traversal: { direction: "both", maxDepth: 3, pathMode: "shortest" }, include: { source: false, evidence: true, relationships: true, diagnostics: true, explanation: true, cpg: false }, ranking: { strategy: "relevance", descending: true }, limits: { results: 25, nodes: 100, edges: 300, paths: 5, depth: 3, evidence: 30, timeBudgetMs: 1000 } }; }
function queryResult() { return { queryId: "123e4567-e89b-42d3-a456-426614174000", operation: "DEPENDENCIES", generation: 3, repositoryState: { repositoryId: "repository:test", branch: "main", headCommit: "head", generation: 3 }, executionTimeMs: 2.5, resolvedSeeds: [{ selector: { value: "OrderService.create", kind: "name" }, selected: { id: "entity:service", type: "keystone.core.Method", name: "create", qualifiedName: "OrderService.create", relativePath: "service.ts", confidence: 1, score: 1000, reasons: ["exact qualified name"] }, candidates: [], ambiguous: false, requiresSelection: false, reasons: ["exact qualified name"] }], data: { kind: "dependencies", items: [{ id: "entity:repo", type: "keystone.core.Method", name: "save", qualifiedName: "OrderRepository.save", relativePath: "repo.ts", score: 900, confidence: 1, classification: "exact", rankingReasons: ["graph distance 1"] }], nodes: [], relationships: [], paths: [], sections: {}, metrics: {} }, evidence: [], diagnostics: [], explanation: { parsedAs: "DEPENDENCIES", parserRule: "dependencies", indexesUsed: ["outgoing"], relationshipFamilies: ["keystone.core.CALLS"], confidenceThreshold: 0, rankingRules: ["exactName=900"], truncationReasons: [], capabilityBoundaries: [], steps: ["Executed dependencies against immutable generation 3."] }, truncated: false, cacheState: "miss" }; }
