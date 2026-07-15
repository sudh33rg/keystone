// @vitest-environment jsdom

import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { SemanticBrowser } from "../../src/ui/components/intelligence/SemanticBrowser";
import type { HostBridge } from "../../src/ui/services/HostBridge";

describe("SemanticBrowser", () => {
  it("uses bounded typed search, inspector, source, and neighborhood requests", async () => {
    const request = vi.fn((type: string, _payload?: unknown, _options?: unknown) => {
      void _payload; void _options;
      if (type === "intelligence/search") return Promise.resolve({ generation: 3, total: 1, items: [{ id: "entity:run", type: "keystone.core.Function", name: "run", qualifiedName: "Service.run", language: "typescript", relativePath: "src/service.ts", signature: "(): void", confidence: 1, generation: 3 }] });
      if (type === "intelligence/entity") return Promise.resolve({ generation: 3, entity: { id: "entity:run", type: "keystone.core.Function", name: "run", qualifiedName: "Service.run", language: "typescript", relativePath: "src/service.ts", signature: "(): void", confidence: 1, generation: 3, sourceRange: { startLine: 4, startColumn: 2, endLine: 6, endColumn: 3 } }, incoming: [], outgoing: [{ id: "relationship:calls", type: "keystone.core.CALLS", direction: "outgoing", entityId: "entity:target", entityName: "target", confidence: 1, derivation: "resolved", evidenceIds: ["evidence:calls"] }], evidence: [{ id: "evidence:run", subjectId: "entity:run", ownerFileId: "file:service", sourceKind: "typescript-compiler", workspaceRootId: "root", relativePath: "src/service.ts", extractorId: "keystone.typescript", extractorVersion: "1", derivation: "extracted", generation: 3, confidence: 1, statement: "Compiler declaration." }], diagnostics: [], truncated: false });
      if (type === "intelligence/neighborhood") return Promise.resolve({ generation: 3, nodes: [{ id: "entity:run", type: "keystone.core.Function", name: "run", qualifiedName: "Service.run", language: "typescript", relativePath: "src/service.ts", confidence: 1, generation: 3 }], relationships: [], truncated: false });
      if (type === "intelligence/cpg/scope") return Promise.resolve(cpgResult());
      if (type === "intelligence/technologies") return Promise.resolve({ generation: 3, total: 1, items: [{ technologyId: "openapi", adapterId: "keystone.adapter.contract", adapterVersion: "1.0.0", capabilityLevel: "structural", filesDiscovered: 1, filesParsed: 1, filesFailed: 0, filesMetadataOnly: 0, entitiesExtracted: 3, relationshipsResolved: 2, unresolvedReferences: 0, unsupportedConstructs: 0, lastSuccessfulUpdate: "2026-07-15T00:00:00.000Z", freshness: "current" }], detections: [] });
      if (type === "intelligence/adapter-diagnostics") return Promise.resolve({ generation: 3, total: 1, items: [{ code: "partial-support", severity: "info", message: "Only structural contract parsing is available.", adapterId: "keystone.adapter.contract", technologyId: "openapi", limitation: true }] });
      return Promise.resolve(undefined);
    });
    render(<SemanticBrowser bridge={{ request } as unknown as HostBridge}/>);
    expect(await screen.findByText("openapi")).toBeTruthy();
    expect(screen.getByText("structural")).toBeTruthy();
    expect(screen.getByText("Adapter diagnostics (1)")).toBeTruthy();
    fireEvent.change(screen.getByLabelText("Search semantic intelligence"), { target: { value: "run" } });
    fireEvent.click(screen.getByRole("button", { name: "Search" }));
    const resultButton = await screen.findByRole("button", { name: /Service\.run/ });
    expect(resultButton).toBeTruthy();
    expect(request).toHaveBeenCalledWith("intelligence/search", { query: "run", limit: 20 });

    fireEvent.click(resultButton);
    expect(await screen.findByText("Compiler declaration.")).toBeTruthy();
    expect(screen.getByText("CALLS")).toBeTruthy();
    expect(await screen.findByRole("heading", { name: "Code analysis" })).toBeTruthy();
    expect(screen.getByText("Control flow")).toBeTruthy();
    const cpgCall = request.mock.calls.find(([type]) => type === "intelligence/cpg/scope");
    expect(cpgCall?.[1]).toMatchObject({ semanticSymbolId: "entity:run", maxNodes: 250 });
    expect((cpgCall?.[2] as { signal?: unknown } | undefined)?.signal).toBeInstanceOf(AbortSignal);
    fireEvent.click(screen.getByRole("button", { name: "Show neighborhood" }));
    expect(await screen.findByText(/1 nodes/)).toBeTruthy();
    expect(request).toHaveBeenCalledWith("intelligence/neighborhood", { ids: ["entity:run"], direction: "both", maxDepth: 1, maxNodes: 30, minimumConfidence: 0 });
    fireEvent.click(screen.getByRole("button", { name: "Open in VS Code" }));
    expect(request).toHaveBeenCalledWith("intelligence/source/open", { relativePath: "src/service.ts", range: { startLine: 4, startColumn: 2, endLine: 6, endColumn: 3 } });
  });
});

function cpgResult() {
  const range = { startLine: 4, startColumn: 2, endLine: 6, endColumn: 3 };
  const node = (id: string, kind: "ENTRY" | "EXIT" | "PARAMETER", code?: string) => ({ id, fileId: "file:service", scopeId: "cpg-scope:run", semanticSymbolId: "entity:run", kind, ...(code ? { code, range } : {}), evidenceIds: ["evidence:run"], parserVersion: "1", generation: 3, ...(kind === "PARAMETER" ? { properties: { variable: "input", read: true } } : {}) });
  const scope = { id: "cpg-scope:run", fileId: "file:service", semanticSymbolId: "entity:run", name: "Service.run", kind: "method" as const, range, sourceHash: "sha256:run", structuralHash: "sha256:scope", providerId: "keystone.typescript-cpg", providerVersion: "1", schemaVersion: 1 as const, analysisLevel: "basic" as const, generation: 3, nodeCount: 3, edgeCount: 2, summary: { parameters: 1, returns: 0, calls: 0, branches: 0, reads: 1, writes: 0, localVariables: 0, unresolvedCalls: 0, approximateFlows: 0 }, shard: "cpg/scopes/run.json.gz" };
  const edge = (id: string, sourceId: string, targetId: string) => ({ id, sourceId, targetId, type: "CFG_NEXT" as const, derivation: "calculated" as const, confidence: 1, evidenceIds: ["evidence:run"], fileId: "file:service", scopeId: "cpg-scope:run", generation: 3 });
  return { generation: 3, scope, entryNodeId: "node:entry", exitNodeId: "node:exit", nodes: [node("node:entry", "ENTRY"), node("node:param", "PARAMETER", "input"), node("node:exit", "EXIT")], edges: [edge("edge:one", "node:entry", "node:param"), edge("edge:two", "node:param", "node:exit")], diagnostics: [], truncated: false };
}
