import { describe, expect, it } from "vitest";
import {
  normalizeRelativePath,
  normalizeSignature,
  stableId,
} from "../../../src/core/intelligence/StableId";

describe("stable intelligence identifiers", () => {
  it("normalizes paths and signatures", () => {
    expect(normalizeRelativePath("./src\\feature/../index.ts")).toBe("src/index.ts");
    expect(normalizeSignature("  function  value ( x: string ) ")).toBe(
      "function value ( x: string )",
    );
  });

  it("is deterministic and namespace-sensitive", async () => {
    const first = await stableId("file", "repository", "src/index.ts");
    expect(await stableId("file", "repository", "src/index.ts")).toBe(first);
    expect(await stableId("symbol", "repository", "src/index.ts")).not.toBe(first);
  });
});
