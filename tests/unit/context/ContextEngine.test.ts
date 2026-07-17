import { describe, expect, it } from "vitest";
import { ContextBudgetService, ContextCompressor, ContextRanker } from "../../../src/core/context/ContextEngine";
import { ContextItemSchema } from "../../../src/shared/contracts/delegation";

function candidate(id: string, content: string, options: { required?: boolean; pinned?: boolean; priority?: number } = {}) {
  return ContextItemSchema.parse({
    id,
    kind: "symbol",
    title: id,
    content,
    reason: "Evidence-backed task relationship.",
    relationshipToTask: "direct",
    tier: options.required ? "required" : "optional",
    required: options.required ?? false,
    pinned: options.pinned ?? false,
    included: true,
    priority: options.priority ?? 0,
    confidence: 1,
    evidenceIds: [],
    estimatedCharacters: content.length,
    estimatedTokens: Math.ceil(content.length / 4),
    freshness: "current",
    compression: "structured-summary"
  });
}

describe("deterministic context ranking and compression", () => {
  it("keeps mandatory task context ahead of optional candidates", () => {
    const ranked = new ContextRanker().rank([candidate("optional", "source", { priority: 900 }), candidate("required", "objective", { required: true })]);
    expect(ranked[0]?.id).toBe("required");
  });

  it("protects required items and removes optional items first at the budget", () => {
    const budget = new ContextBudgetService().resolve({ maxEstimatedTokens: 500, maxCharacters: 2_000 });
    const result = new ContextCompressor().compress([candidate("required", "required", { required: true }), candidate("optional", "x".repeat(2_100))], budget);
    expect(result.included.map((item) => item.id)).toEqual(["required"]);
    expect(result.excluded).toMatchObject([{ item: { id: "optional" }, reason: "over-budget" }]);
  });

  it("deduplicates identical repository evidence deterministically", () => {
    const budget = new ContextBudgetService().resolve();
    const result = new ContextCompressor().compress([candidate("a", "same"), candidate("b", "same")], budget);
    expect(result.included).toHaveLength(1);
    expect(result.excluded[0]?.reason).toBe("duplicate");
  });
});
