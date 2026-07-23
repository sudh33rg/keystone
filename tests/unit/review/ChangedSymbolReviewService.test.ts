import { describe, expect, it } from "vitest";
import { ChangedSymbolReviewService } from "../../../src/core/review/ChangedSymbolReviewService";

const workflowId = "00000000-0000-4000-8000-000000000001";

describe("ChangedSymbolReviewService", () => {
  it("maps changed ranges to real intelligence entities when available", () => {
    const service = new ChangedSymbolReviewService();
    const result = service.build({
      workflowId,
      changedFiles: [
        {
          path: "src/order/OrderService.ts",
          changeType: "modified",
          changedRanges: [{ startLine: 2, endLine: 8 }],
        },
      ],
      symbolsByFile: {
        "src/order/OrderService.ts": [
          {
            filePath: "src/order/OrderService.ts",
            name: "createOrder",
            kind: "function",
            range: { startLine: 2, endLine: 8 },
            visibility: "public",
            exported: true,
            defaultExport: false,
          },
        ],
      },
    });

    expect(result.some((s) => s.name === "createOrder")).toBe(true);
    expect(result[0]?.resolved).toBe(true);
  });

  it("identifies added/removed/signature-changed symbols", () => {
    const service = new ChangedSymbolReviewService();
    const result = service.build({
      workflowId,
      changedFiles: [
        { path: "src/new.ts", changeType: "added" },
        { path: "src/old.ts", changeType: "deleted" },
        {
          path: "src/modified.ts",
          changeType: "modified",
          changedRanges: [{ startLine: 1, endLine: 1 }],
        },
      ],
      symbolsByFile: {
        "src/new.ts": [
          {
            filePath: "src/new.ts",
            name: "newFn",
            kind: "function",
            range: { startLine: 1, endLine: 5 },
            visibility: "public",
            exported: true,
            defaultExport: false,
          },
        ],
        "src/old.ts": [
          {
            filePath: "src/old.ts",
            name: "oldFn",
            kind: "function",
            range: { startLine: 1, endLine: 5 },
            visibility: "public",
            exported: true,
            defaultExport: false,
          },
        ],
        "src/modified.ts": [
          {
            filePath: "src/modified.ts",
            name: "modFn",
            kind: "function",
            range: { startLine: 1, endLine: 10 },
            visibility: "public",
            exported: true,
            defaultExport: false,
          },
        ],
      },
    });

    expect(result.some((s) => s.changeType === "added" && s.name === "newFn")).toBe(true);
    expect(result.some((s) => s.changeType === "removed" && s.name === "oldFn")).toBe(true);
    expect(result.some((s) => s.changeType === "modified" && s.name === "modFn")).toBe(true);
  });

  it("marks public symbols and entry points", () => {
    const service = new ChangedSymbolReviewService();
    const result = service.build({
      workflowId,
      changedFiles: [{ path: "src/api.ts", changeType: "modified" }],
      symbolsByFile: {
        "src/api.ts": [
          {
            filePath: "src/api.ts",
            name: "publicFn",
            kind: "function",
            range: { startLine: 1, endLine: 10 },
            visibility: "public",
            exported: true,
            defaultExport: false,
          },
        ],
      },
      entryPointSymbolIds: new Set(["publicFn"]),
      publicContractSymbolIds: new Set(["publicFn"]),
    });

    expect(result[0]?.publicContract).toBe(true);
    expect(result[0]?.entryPoint).toBe(true);
  });

  it("falls back to file-level review for unresolved symbols", () => {
    const service = new ChangedSymbolReviewService();
    const result = service.build({
      workflowId,
      changedFiles: [
        { path: "src/unknown.bin", changeType: "modified" },
      ],
      symbolsByFile: {},
    });

    expect(result).toHaveLength(1);
    expect(result[0]?.resolved).toBe(false);
    expect(result[0]?.name).toBe("src/unknown.bin");
  });

  it("does not fabricate symbols", () => {
    const service = new ChangedSymbolReviewService();
    const result = service.build({
      workflowId,
      changedFiles: [
        { path: "src/a.ts", changeType: "modified" },
      ],
      symbolsByFile: {
        "src/a.ts": [
          {
            filePath: "src/a.ts",
            name: "realSymbol",
            kind: "function",
            range: { startLine: 1, endLine: 5 },
            visibility: "private",
            exported: false,
            defaultExport: false,
          },
        ],
      },
    });

    expect(result).toHaveLength(1);
    expect(result[0]?.name).toBe("realSymbol");
    const extra = result.filter((s) => s.name !== "realSymbol");
    expect(extra).toHaveLength(0);
  });
});
