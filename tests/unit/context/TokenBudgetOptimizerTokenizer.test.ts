import { describe, expect, it } from "vitest";
import { TokenBudgetOptimizer } from "../../../src/core/context/TokenBudgetOptimizer";
import { KeystoneGptApproxTokenizer } from "../../../src/core/context/TokenCounterRegistry";
import type { ContextItem } from "../../../src/shared/contracts/contextPackage";

describe("TokenBudgetOptimizer tokenizer consistency", () => {
  it("uses the selected counter for summary-fit token counts", () => {
    const counter = new KeystoneGptApproxTokenizer();
    const content = Array.from({ length: 120 }, (_, index) => `value${index}`).join(" ");
    const item: ContextItem = { id: "support", title: "Supporting source", sourceType: "repository-file", sourceReference: {}, contentMode: "full", importance: "supporting", relevanceScore: 1, confidence: 1, tokenCount: counter.count(content), rawTokenCount: counter.count(content), savedTokens: 0, reasons: ["selected source"], dependencies: [], satisfiesRequiredFacts: [], content, rawContentHash: "raw", compressedContentHash: "raw", pinned: false, freshness: "current", included: true };
    const result = new TokenBudgetOptimizer().optimize({ items: [item], budget: { requestedTokens: 80, reservedInstructionTokens: 0, reservedOutputTokens: 0, availableContextTokens: 80, tokenizerId: counter.id }, reservedSectionTokens: { contract: 10, skills: 0, instructions: 0, specification: 0 }, pinnedIds: [], counter });
    expect(result.included[0]?.tokenCount).toBe(counter.count(result.included[0]?.content ?? ""));
  });
});
