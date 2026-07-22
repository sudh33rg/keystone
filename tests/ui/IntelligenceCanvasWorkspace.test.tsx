// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { IntelligenceCanvasWorkspace } from "../../src/ui/components/intelligence/IntelligenceCanvasWorkspace";
import type { HostBridge } from "../../src/ui/services/HostBridge";

afterEach(cleanup);
const candidate = { id: "entity:orders:create", label: "create", qualifiedLabel: "OrderService.create", kind: "method", filePath: "src/orders.ts", range: { startLine: 10, endLine: 12 }, matchScore: 1, context: "method · src/orders.ts:11" };
const graph = { rootEntityIds: [candidate.id], nodes: [{ id: candidate.id, label: "create", qualifiedLabel: "OrderService.create", kind: "method", filePath: "src/orders.ts", range: { startLine: 10, endLine: 12 }, confidence: 1, inferred: false, expandable: { inbound: true, outbound: true } }, { id: "entity:repo:save", label: "save", qualifiedLabel: "OrderRepository.save", kind: "method", filePath: "src/repository.ts", confidence: 1, inferred: false, expandable: { inbound: true, outbound: false } }], edges: [{ id: "relationship:create-save", sourceId: candidate.id, targetId: "entity:repo:save", relationshipType: "calls", label: "calls", confidence: 1, inferred: false, evidenceIds: ["evidence:create-save"] }], request: { mode: "calls", direction: "both", depth: 1, relationshipTypes: ["calls"], maxNodes: 75, maxEdges: 150, minimumConfidence: 0 }, truncation: { truncated: false, nodeLimitReached: false, edgeLimitReached: false, expandableEntityIds: [] }, intelligenceRevision: "7" };

describe("IntelligenceCanvasWorkspace", () => {
  it("opens with a useful visual empty state and no primary raw JSON", () => {
    render(<IntelligenceCanvasWorkspace bridge={{ request: vi.fn() } as unknown as HostBridge} intelligenceRevision="7" />);
    expect(screen.getByText(/Search for a real repository symbol/i)).toBeTruthy();
    expect(screen.getByPlaceholderText("Ask about callers, dependencies, flows, or tests…")).toBeTruthy();
    expect(screen.queryByText(/compiled query json/i)).toBeNull();
  });

  it("searches, selects a candidate, renders graph nodes/edges, and opens node and evidence inspectors", async () => {
    const request = vi.fn((type: string) => type === "intelligence.canvas.search" ? Promise.resolve({ items: [candidate], intelligenceRevision: "7", stale: false }) : type === "intelligence.canvas.graph" ? Promise.resolve(graph) : type === "intelligence.canvas.evidence" ? Promise.resolve({ items: [{ id: "evidence:create-save", filePath: "src/orders.ts", range: { startLine: 11, endLine: 12 }, provider: "fixture-parser", evidenceType: "source-file", excerpt: "repository.save(order)", confidence: 1 }], intelligenceRevision: "7" }) : Promise.resolve(undefined));
    render(<IntelligenceCanvasWorkspace bridge={{ request } as unknown as HostBridge} intelligenceRevision="7" />);
    fireEvent.change(screen.getByLabelText("Search or ask Intelligence"), { target: { value: "create" } });
    fireEvent.click(screen.getByRole("button", { name: "Search" }));
    fireEvent.click(await screen.findByRole("button", { name: /OrderService.create/ }));
    expect(await screen.findByRole("button", { name: /create · method/ })).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: /save · method/ }));
    expect(screen.getByText("Selected entity")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: /calls edge/i }));
    expect(await screen.findByText("repository.save(order)")).toBeTruthy();
  });

  it("supports modes, relationship filters, depth, expand/collapse, accessible list, source, scope, context, truncation and stale warnings", async () => {
    const truncated = { ...graph, truncation: { truncated: true, nodeLimitReached: true, edgeLimitReached: false, expandableEntityIds: [candidate.id] } };
    const request = vi.fn((type: string) => type === "intelligence.canvas.graph" || type === "intelligence.canvas.expand" ? Promise.resolve(truncated) : type === "intelligence.canvas.query" ? Promise.resolve({ status: "unsupported", summary: "Supported questions cover callers, callees, dependencies, dependents, tests, flows, and relationships.", subjectCandidates: [], targetCandidates: [], intelligenceRevision: "7" }) : Promise.resolve(undefined));
    render(<IntelligenceCanvasWorkspace bridge={{ request } as unknown as HostBridge} intelligenceRevision="7" initialEntityId={candidate.id} />);
    expect(await screen.findByText(/result is truncated/i)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Dependencies" }));
    fireEvent.change(screen.getByLabelText("Graph depth"), { target: { value: "2" } });
    fireEvent.click(screen.getByLabelText("imports relationship"));
    fireEvent.click(screen.getByRole("button", { name: "Relationship list" }));
    expect(screen.getByRole("list", { name: "Accessible relationships" })).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: /create · method/ }));
    for (const action of ["Expand inbound", "Expand outbound", "Collapse branch", "Open Source", "Add to Development Scope", "Add to Context"]) expect(screen.getByRole("button", { name: action })).toBeTruthy();
    fireEvent.change(screen.getByLabelText("Search or ask Intelligence"), { target: { value: "Refactor everything" } });
    fireEvent.click(screen.getByRole("button", { name: "Ask" }));
    expect(await screen.findByText(/Supported questions cover callers/i)).toBeTruthy();
    await waitFor(() => expect(request).toHaveBeenCalledWith("intelligence.canvas.graph", expect.objectContaining({ mode: "dependencies", depth: 2 })));
  });
});
