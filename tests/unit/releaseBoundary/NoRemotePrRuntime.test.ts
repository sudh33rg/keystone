import { describe, expect, it } from "vitest";
import { readFile } from "node:fs/promises";

describe("NoRemotePrRuntime", () => {
  it("ReviewCompletionService uses only read-only repository injection and no delivery imports", async () => {
    const source = await readFile("src/core/review/ReviewCompletionService.ts", "utf-8");
    expect(source, "must not import from deleted delivery runtime").not.toMatch(
      /from\s+["'][^"']*\/delivery\//,
    );
    expect(source, "constructor fourth arg must be RepositoryReadService").toMatch(
      /constructor\([^)]*repository\s*:\s*RepositoryReadService/,
    );
  });

  it("review exports do not expose remote PR / push artifacts", async () => {
    const reviewSource = await readFile("src/shared/contracts/review.ts", "utf-8");
    expect(reviewSource, "review.ts must not export prUrl or pushReference").not.toMatch(
      /\bprUrl\b|\bparchash\b/,
    );
  });
});
