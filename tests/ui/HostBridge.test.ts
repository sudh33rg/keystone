// @vitest-environment jsdom

import { describe, expect, it, vi } from "vitest";
import { HostBridge } from "../../src/ui/services/HostBridge";
import { hostMessage } from "../../src/shared/contracts/messages";
import { emptyIntelligenceOverview } from "../../src/shared/contracts/intelligence";

describe("HostBridge", () => {
  it("validates and resolves a typed overview response", async () => {
    const postMessage = vi.fn();
    const bridge = new HostBridge({ postMessage, getState: () => undefined, setState: vi.fn() });
    const pending = bridge.request("intelligence/overview", {});
    const request = postMessage.mock.calls[0]?.[0] as { requestId: string };
    const overview = emptyIntelligenceOverview("ready");
    window.dispatchEvent(
      new MessageEvent("message", {
        data: hostMessage("response/success", { requestId: request.requestId, data: overview }),
      }),
    );
    await expect(pending).resolves.toEqual(overview);
    bridge.dispose();
  });

  it("rejects an aborted request and notifies the host", async () => {
    const postMessage = vi.fn();
    const bridge = new HostBridge({ postMessage, getState: () => undefined, setState: vi.fn() });
    const controller = new AbortController();
    const pending = bridge.request("intelligence/overview", {}, { signal: controller.signal });
    controller.abort();
    await expect(pending).rejects.toMatchObject({ name: "AbortError" });
    expect(postMessage.mock.calls.at(-1)?.[0]).toMatchObject({ type: "request/cancel" });
    bridge.dispose();
  });

  it("validates bounded semantic search responses", async () => {
    const postMessage = vi.fn();
    const bridge = new HostBridge({ postMessage, getState: () => undefined, setState: vi.fn() });
    const pending = bridge.request("intelligence/search", { query: "handler", limit: 10 });
    const request = postMessage.mock.calls[0]?.[0] as { requestId: string };
    const result = {
      generation: 2,
      total: 1,
      items: [
        {
          id: "entity:handler",
          fileId: "file:routes",
          type: "keystone.core.Function",
          name: "handler",
          qualifiedName: "handler",
          language: "typescript",
          relativePath: "src/routes.ts",
          confidence: 1,
          generation: 2,
        },
      ],
    };
    window.dispatchEvent(
      new MessageEvent("message", {
        data: hostMessage("response/success", { requestId: request.requestId, data: result }),
      }),
    );
    await expect(pending).resolves.toEqual(result);
    bridge.dispose();
  });

  it("preserves typed universal-adapter coverage responses", async () => {
    const postMessage = vi.fn();
    const bridge = new HostBridge({ postMessage, getState: () => undefined, setState: vi.fn() });
    const coverage = {
      generation: 2,
      total: 1,
      items: [
        {
          technologyId: "typescript",
          adapterId: "keystone.typescript",
          adapterVersion: "1.0.0",
          capabilityLevel: "semantic",
          filesDiscovered: 1,
          filesParsed: 1,
          filesFailed: 0,
          filesMetadataOnly: 0,
          entitiesExtracted: 3,
          relationshipsResolved: 2,
          unresolvedReferences: 0,
          unsupportedConstructs: 0,
          lastSuccessfulUpdate: "2026-07-15T00:00:00.000Z",
          freshness: "current",
        },
      ],
      detections: [],
    };
    const coveragePending = bridge.request("intelligence/technologies", { limit: 10 });
    const coverageRequest = postMessage.mock.calls.at(-1)?.[0] as { requestId: string };
    window.dispatchEvent(
      new MessageEvent("message", {
        data: hostMessage("response/success", {
          requestId: coverageRequest.requestId,
          data: coverage,
        }),
      }),
    );

    const diagnostics = {
      generation: 2,
      total: 1,
      items: [
        {
          code: "partial-support",
          severity: "info",
          message: "Structural extraction only.",
          adapterId: "keystone.adapter.contract",
          limitation: true,
        },
      ],
    };
    const diagnosticsPending = bridge.request("intelligence/adapter-diagnostics", { limit: 10 });
    const diagnosticsRequest = postMessage.mock.calls.at(-1)?.[0] as { requestId: string };
    window.dispatchEvent(
      new MessageEvent("message", {
        data: hostMessage("response/success", {
          requestId: diagnosticsRequest.requestId,
          data: diagnostics,
        }),
      }),
    );

    await expect(coveragePending).resolves.toEqual(coverage);
    await expect(diagnosticsPending).resolves.toEqual(diagnostics);
    bridge.dispose();
  });
});
