/**
 * TokenBudgetOptimizer
 *
 * Deterministic budget allocation across prompt sections:
 *   1. reserve mandatory sections (execution contract, skills, instructions,
 *      specification, output reservation)
 *   2. include ALL required context
 *   3. include supporting context by score
 *   4. compress oversized items
 *   5. include optional context only when budget remains
 *   6. reject impossible budgets
 *   7. preserve user-pinned context where safe
 *
 * Strategies applied when over budget:
 *   full → excerpt, excerpt → signature + summary, multiple paths → merged flow,
 *   repeated files → representative + locations, full prior result → decision summary.
 */

import type {
  ContextItem,
  ContextBudgetModel,
  ContextWarning,
} from "../../shared/contracts/contextPackage";
import { ContextWarningSchema } from "../../shared/contracts/contextPackage";
import type { TokenCounter } from "./TokenCounterRegistry";

export interface OptimizerInput {
  items: ContextItem[];
  budget: ContextBudgetModel;
  /** Measured tokens already reserved for the non-context sections. */
  reservedSectionTokens: {
    contract: number;
    skills: number;
    instructions: number;
    specification: number;
  };
  pinnedIds: string[];
  /** Counter used for both raw and compressed measurements. */
  counter?: TokenCounter;
}

export interface OptimizerExclusion {
  item: ContextItem;
  reason: "over-budget";
  tokensRemoved: number;
  restorable: boolean;
}

export interface OptimizerResult {
  included: ContextItem[];
  excluded: OptimizerExclusion[];
  warnings: ContextWarning[];
  /** True if the requested budget is too small even for mandatory content. */
  impossible: boolean;
}

export class TokenBudgetOptimizer {
  optimize(input: OptimizerInput): OptimizerResult {
    const warnings: ContextWarning[] = [];
    const reservedTotal =
      input.budget.reservedInstructionTokens +
      input.budget.reservedOutputTokens +
      input.reservedSectionTokens.contract +
      input.reservedSectionTokens.skills +
      input.reservedSectionTokens.specification;

    const available = Math.max(0, input.budget.requestedTokens - reservedTotal);
    if (available <= 0) {
      warnings.push(
        this.warning(
          "budget-too-small",
          "error",
          `Requested budget ${input.budget.requestedTokens} is smaller than reserved mandatory sections (${reservedTotal} tokens). Delegation is blocked.`,
        ),
      );
      return {
        included: [],
        excluded: input.items.map((item) => ({
          item,
          reason: "over-budget" as const,
          tokensRemoved: item.tokenCount,
          restorable: true,
        })),
        warnings,
        impossible: true,
      };
    }

    // 1. Mandatory: required + pinned context always included.
    const required = input.items.filter(
      (i) => i.importance === "required" || input.pinnedIds.includes(i.id),
    );
    const included = [...required];
    let used = sumTokens(included);
    if (used > available) {
      warnings.push(
        this.warning(
          "required-over-budget",
          "error",
          `Required and pinned context needs ${used} tokens, but only ${available} context tokens are available. Increase the budget or remove a non-critical pin.`,
        ),
      );
      return { included, excluded: input.items.filter((item) => !included.includes(item)).map((item) => ({ item, reason: "over-budget" as const, tokensRemoved: item.tokenCount, restorable: true })), warnings, impossible: true };
    }

    // 2. Supporting by score.
    const supporting = input.items
      .filter((i) => i.importance === "supporting" && !included.includes(i))
      .sort((a, b) => (b.relevanceScore ?? 0) - (a.relevanceScore ?? 0));
    for (const item of supporting) {
      if (used + item.tokenCount <= available) {
        included.push(item);
        used += item.tokenCount;
      } else {
        const compressed = this.tryCompressFit(item, available - used, input.counter);
        if (compressed) {
          included.push(compressed);
          used += compressed.tokenCount;
        }
      }
    }

    // 3. Optional only when budget remains.
    const optional = input.items
      .filter((i) => i.importance === "optional" && !included.includes(i))
      .sort((a, b) => (b.relevanceScore ?? 0) - (a.relevanceScore ?? 0));
    for (const item of optional) {
      if (used + item.tokenCount <= available) {
        included.push(item);
        used += item.tokenCount;
      }
    }

    const excluded: OptimizerExclusion[] = input.items
      .filter((i) => !included.includes(i))
      .map((item) => ({
        item,
        reason: "over-budget" as const,
        tokensRemoved: item.tokenCount,
        restorable: true,
      }));

    const requiredMissing = required.filter((i) => !included.includes(i));
    if (requiredMissing.length > 0) {
      warnings.push(
        this.warning(
          "required-over-budget",
          "error",
          `${requiredMissing.length} required/pinned item(s) could not fit; the token budget is too small to preserve critical context.`,
        ),
      );
      return { included, excluded, warnings, impossible: true };
    }

    if (excluded.length > 0)
      warnings.push(
        this.warning(
          "optional-trimmed",
          "info",
          `${excluded.length} optional context item(s) excluded to fit the token budget.`,
        ),
      );

    return { included, excluded, warnings, impossible: false };
  }

  /** Attempt to compress an oversized item into a summary that fits. */
  private tryCompressFit(item: ContextItem, room: number, counter?: TokenCounter): ContextItem | undefined {
    const summary = `Summary of ${item.title}: ${item.content
      .slice(0, Math.max(0, room * 3))
      .split("\n")
      .slice(0, 4)
      .join(" ")}`;
    const approxTokens = counter?.count(summary) ?? Math.ceil(summary.length / 4);
    if (approxTokens <= room) {
      return {
        ...item,
        content: summary,
        title: item.title,
        contentMode: "summary",
        tokenCount: approxTokens,
        savedTokens: Math.max(0, item.rawTokenCount - approxTokens),
        compressionStrategy: "summary-fit",
      };
    }
    return undefined;
  }

  private warning(
    code: string,
    severity: ContextWarning["severity"],
    message: string,
  ): ContextWarning {
    return ContextWarningSchema.parse({ code, severity, message });
  }
}

function sumTokens(items: ContextItem[]): number {
  return items.reduce((total, i) => total + i.tokenCount, 0);
}
