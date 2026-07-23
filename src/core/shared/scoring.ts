/**
 * Lightweight weighted-score utilities borrowed from reference implementations.
 * No runtime dependencies. Deterministic from inputs.
 */

export interface ScoreStrategy {
  id: string;
  weight: number;
  confidence: number;
}

export type WeightedScoreInput = {
  readonly strategies: readonly ScoreStrategy[];
  readonly confidenceWeight?: number;
};

export type Tier = "high" | "medium" | "low";

const DEFAULT_CONFIDENCE_WEIGHT = 0.3;

export function weightedScoreOf(input: WeightedScoreInput): number {
  const confidenceWeight =
    typeof input.confidenceWeight === "number"
      ? Math.max(0, Math.min(1, input.confidenceWeight))
      : DEFAULT_CONFIDENCE_WEIGHT;

  return input.strategies.reduce((total, strategy) => {
    const blended = (1 - confidenceWeight) * strategy.weight + confidenceWeight * strategy.confidence;
    return total + blended;
  }, 0);
}

export function tierOf(score: number): Tier {
  if (score >= 0.66) return "high";
  if (score >= 0.33) return "medium";
  return "low";
}

export function bestStrategyId(
  input: WeightedScoreInput & { readonly idsByIndex?: readonly string[] },
): string | undefined {
  const idsByIndex = input.idsByIndex ?? input.strategies.map((strategy) => strategy.id);
  let bestIndex = 0;
  let bestScore = -Infinity;
  input.strategies.forEach((strategy, index) => {
    const candidate = (1 - (input.confidenceWeight ?? DEFAULT_CONFIDENCE_WEIGHT)) * strategy.weight +
      (input.confidenceWeight ?? DEFAULT_CONFIDENCE_WEIGHT) * strategy.confidence;
    if (candidate > bestScore) {
      bestScore = candidate;
      bestIndex = index;
    }
  });
  return idsByIndex[bestIndex];
}
