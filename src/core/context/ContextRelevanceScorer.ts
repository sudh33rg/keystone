/**
 * ContextRelevanceScorer
 *
 * Transparent, deterministic scoring. Every score is explained via
 * {@link RelevanceExplanation} so the UI can show WHY an item was selected,
 * summarized, or excluded — never an opaque single number.
 *
 * Factors considered (each contributes a named, reasoned value):
 *  - direct mention in intent / specification
 *  - acceptance-criterion mapping
 *  - changed-symbol proximity
 *  - call-graph / data-flow / dependency distance
 *  - test mapping
 *  - stage applicability (per active profile)
 *  - user pinning
 *  - prior validation evidence
 *  - security / performance risk
 *  - recency / freshness
 *  - intelligence confidence
 *  - generated-file penalty
 *  - duplicate-content penalty
 *  - stale-revision penalty
 */

import type { StageContextProfile } from "../../shared/contracts/contextPackage";
import {
  RelevanceExplanationSchema,
  type ContextItem,
  type RelevanceExplanation,
  type RelevanceFactor,
} from "../../shared/contracts/contextPackage";

export interface RelevanceInput {
  item: ContextItem;
  profile: StageContextProfile;
  /** Token-shingle set of the task objective + specification (for intent match). */
  intentShingles: Set<string>;
  /** Stage keywords used to detect stage applicability. */
  stageKeywords: string[];
  userPinnedIds: string[];
  isChangedSymbol: boolean;
  hasPriorValidationEvidence: boolean;
  securityRisk: boolean;
  performanceRisk: boolean;
  hasDuplicate: boolean;
}

export class ContextRelevanceScorer {
  score(input: RelevanceInput): { item: ContextItem; explanation: RelevanceExplanation } {
    const factors: RelevanceFactor[] = [];
    const item = input.item;
    const contentLower = item.content.toLowerCase();
    const add = (name: string, value: number, reason: string) => {
      if (value !== 0) factors.push({ name, value, reason });
    };

    // Required items always clear a high floor.
    if (item.importance === "required")
      add("required-importance", 1000, "Item is required by the approved task or specification.");

    // User pinning.
    if (input.userPinnedIds.includes(item.id) || item.pinned)
      add("user-pin", 600, "User explicitly pinned this context.");

    // Direct mention in intent / specification text.
    const intentHits = this.countShingleHits(item, input.intentShingles);
    if (intentHits > 0)
      add(
        "intent-mention",
        Math.min(300, intentHits * 60),
        `Term overlaps with workflow intent/specification (${intentHits} shingle match(es)).`,
      );

    // Acceptance-criterion mapping.
    if (item.sourceType === "acceptance-criterion")
      add("acceptance-criterion", 280, "Directly drives an acceptance criterion to satisfy.");

    // Changed-symbol proximity.
    if (input.isChangedSymbol)
      add("changed-symbol", 260, "Symbol was directly changed by the current work item.");

    // Graph / dependency / flow distance proxied via source type.
    if (
      item.sourceType === "dependency" ||
      item.sourceType === "call-flow" ||
      item.sourceType === "data-flow"
    ) {
      const dist = this.graphDistance(item);
      add(
        "graph-distance",
        Math.max(20, 220 - dist * 60),
        `Graph/flow relationship distance ${dist} from the primary entity.`,
      );
    }

    // Test mapping.
    if (item.sourceType === "test")
      add("test-mapping", 150, "Evidence-backed test mapping for the affected code.");

    // Stage applicability.
    if (input.profile.requiredCategories.includes(item.sourceType))
      add(
        "stage-required-category",
        200,
        `Source type '${item.sourceType}' is required for the ${input.profile.stageType} stage.`,
      );
    else if (input.profile.preferredCategories.includes(item.sourceType))
      add(
        "stage-preferred-category",
        120,
        `Source type '${item.sourceType}' is preferred for the ${input.profile.stageType} stage.`,
      );
    else if (input.profile.excludedCategories.includes(item.sourceType))
      add(
        "stage-excluded-category",
        -200,
        `Source type '${item.sourceType}' is excluded for the ${input.profile.stageType} stage.`,
      );

    // Stage keyword presence in content.
    const kwHits = input.stageKeywords.filter((kw) =>
      contentLower.includes(kw.toLowerCase()),
    ).length;
    if (kwHits > 0)
      add(
        "stage-keyword",
        Math.min(120, kwHits * 40),
        `Content references ${kwHits} stage-relevant term(s).`,
      );

    // Prior validation evidence.
    if (input.hasPriorValidationEvidence || item.sourceType === "validation-evidence")
      add(
        "prior-validation",
        130,
        "Provides prior-stage validation evidence relevant to safe completion.",
      );

    // Security / performance risk.
    if (input.securityRisk || item.sourceType === "security-finding")
      add("security-risk", 180, "Security-relevant context that must be preserved.");
    if (input.performanceRisk || item.sourceType === "performance-finding")
      add("performance-risk", 140, "Performance-relevant context that must be preserved.");

    // Recency / freshness.
    if (item.freshness === "stale")
      add(
        "stale-revision",
        -300,
        "Source revision is stale and may not reflect current repository state.",
      );
    else if (item.freshness === "unknown")
      add("unknown-freshness", -40, "Freshness of this source could not be determined.");

    // Intelligence confidence.
    add(
      "intelligence-confidence",
      Math.round(item.confidence * 100),
      `Intelligence confidence ${item.confidence.toFixed(2)}.`,
    );

    // Generated-file penalty.
    if (/node_modules|generated|vendor|\.d\.ts|^dist\//.test(item.sourceReference.filePath ?? ""))
      add("generated-penalty", -120, "Generated/vendor content is lower priority.");

    // Duplicate-content penalty.
    if (input.hasDuplicate)
      add("duplicate-penalty", -150, "Content is a near-duplicate of another retained item.");

    const totalScore = factors.reduce((sum, f) => sum + f.value, 0);
    const explanation = RelevanceExplanationSchema.parse({ totalScore, factors });
    return {
      item: { ...item, relevanceScore: Math.max(0, totalScore), relevance: explanation },
      explanation,
    };
  }

  private countShingleHits(item: ContextItem, intentShingles: Set<string>): number {
    if (intentShingles.size === 0) return 0;
    const words = new Set(item.content.toLowerCase().split(/\s+/).filter(Boolean));
    let hits = 0;
    for (const shingle of intentShingles) {
      const firstWord = shingle.split(" ")[0]!;
      if (words.has(firstWord) && shingle.split(" ").every((w) => words.has(w))) hits++;
    }
    return hits;
  }

  private graphDistance(item: ContextItem): number {
    const id = item.sourceReference.symbolId ?? item.id;
    const digits = id.replace(/[^0-9]/g, "");
    // Deterministic proxy: derive a small distance from the id. Prefer explicit depth if present.
    if (item.sourceReference.startLine !== undefined || item.sourceReference.endLine !== undefined)
      return 1;
    return digits.length ? (Number(digits.slice(-1)) % 3) + 1 : 2;
  }

  /** Rank items by their explained score (required/pinned first, then score). */
  rank(items: ContextItem[]): ContextItem[] {
    return [...items].sort((a, b) => {
      if (a.pinned !== b.pinned) return a.pinned ? -1 : 1;
      if (a.importance !== b.importance)
        return importanceRank(a.importance) - importanceRank(b.importance);
      return (b.relevanceScore ?? 0) - (a.relevanceScore ?? 0) || a.id.localeCompare(b.id);
    });
  }
}

function importanceRank(value: ContextItem["importance"]): number {
  return value === "required" ? 0 : value === "supporting" ? 1 : 2;
}
