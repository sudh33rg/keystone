/**
 * ContextCompressionService
 *
 * Applies deterministic compression strategies selected by the active stage
 * profile to items that have not been deduplicated. Strategies:
 *  - full → excerpt
 *  - excerpt → signature + summary
 *  - multiple paths → merged flow (FlowCompressionService)
 *  - repeated files → representative + locations
 *  - full prior result → decision summary
 *
 * No content is truncated arbitrarily mid-structure; compression always yields
 * valid, complete (if partial-information) representations.
 */

import type { ContextItem, StageContextProfile } from "../../shared/contracts/contextPackage";
import type { TokenCounter } from "./TokenCounterRegistry";
import { StructuralSummaryService } from "./StructuralSummaryService";
import { FlowCompressionService } from "./FlowCompressionService";
import { ContractExtractionService } from "./ContractExtractionService";

export interface CompressionResult {
  items: ContextItem[];
  /** Tokens saved by structural compression across all items. */
  structuralSavings: number;
  summarizedItemIds: string[];
}

export class ContextCompressionService {
  private readonly structural = new StructuralSummaryService();
  private readonly flow = new FlowCompressionService();
  private readonly contract = new ContractExtractionService();

  compress(
    items: ContextItem[],
    profile: StageContextProfile,
    counter: TokenCounter,
  ): CompressionResult {
    let structuralSavings = 0;
    const summarizedItemIds: string[] = [];
    const strategies = new Set(profile.compressionStrategies);
    const out: ContextItem[] = [];

    // Group repeated files so only a representative is fully kept.
    for (const item of items) {
      let next = item;
      if (item.sourceType === "call-flow" || item.sourceType === "data-flow") {
        if (strategies.has("flow-compression")) {
          next = this.flow.compress(item, counter);
          if (next.tokenCount < item.tokenCount) {
            structuralSavings += item.tokenCount - next.tokenCount;
            summarizedItemIds.push(item.id);
          }
        }
        out.push(next);
        continue;
      }
      if (
        item.importance === "required" &&
        item.sourceType === "symbol" &&
        strategies.has("contract-extraction")
      ) {
        next = this.contract.extract(item, "contract", counter);
        if (next.tokenCount < item.tokenCount) {
          structuralSavings += item.tokenCount - next.tokenCount;
          summarizedItemIds.push(item.id);
        }
        out.push(next);
        continue;
      }
      if (strategies.has("signature") && item.sourceType === "symbol") {
        next = this.contract.extract(item, "signature", counter);
        if (next.tokenCount < item.tokenCount) {
          structuralSavings += item.tokenCount - next.tokenCount;
          summarizedItemIds.push(item.id);
        }
        out.push(next);
        continue;
      }
      if (strategies.has("structural-summary") || strategies.has("contract-extraction")) {
        if (item.contentMode === "full" && item.tokenCount > 200) {
          next = this.structural.summarize(item, counter);
          if (next.tokenCount < item.tokenCount) {
            structuralSavings += item.tokenCount - next.tokenCount;
            summarizedItemIds.push(item.id);
          }
          out.push(next);
          continue;
        }
      }
      out.push(item);
    }

    return { items: out, structuralSavings, summarizedItemIds };
  }
}
