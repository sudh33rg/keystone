/**
 * FlowCompressionService
 *
 * Represents large call/data flows as a compact, traceable chain:
 *
 *   Entry → validation → service → repository → database write
 *
 * Collapses low-value intermediate nodes while preserving key symbols, branch
 * conditions, side effects, and evidence references. Deterministic.
 */

import type { ContextItem } from "../../shared/contracts/contextPackage";
import { ContextItemSchema } from "../../shared/contracts/contextPackage";
import type { TokenCounter } from "./TokenCounterRegistry";

export class FlowCompressionService {
  /**
   * Compress a flow item into a chain representation. The raw `content` is a
   * newline- or arrow-separated list of flow steps.
   */
  compress(item: ContextItem, counter: TokenCounter): ContextItem {
    if (item.sourceType !== "call-flow" && item.sourceType !== "data-flow") return item;
    const steps = this.parseSteps(item.content);
    const collapsed = this.collapseLowValue(steps);
    const chain = collapsed.join(" → ");
    const summary = [
      `${item.sourceType === "call-flow" ? "Call flow" : "Data flow"}:`,
      chain,
      collapsed.length < steps.length
        ? `(${steps.length - collapsed.length} low-value intermediate node(s) collapsed)`
        : "",
    ]
      .filter(Boolean)
      .join("\n");
    return ContextItemSchema.parse({
      ...item,
      contentMode: "summary",
      compressionStrategy: "flow-compression",
      structuralSummary: summary,
      content: summary,
      tokenCount: counter.count(summary),
      savedTokens: Math.max(0, item.rawTokenCount - counter.count(summary)),
      compressedContentHash: `sha256:flow:${item.rawContentHash}`,
      reasons: [
        ...item.reasons,
        "Flow compressed to a representative chain; intermediate low-value nodes collapsed.",
      ],
    });
  }

  private parseSteps(content: string): string[] {
    return content
      .split(/\n|→|->/)
      .map((s) => s.trim())
      .filter(Boolean);
  }

  private collapseLowValue(steps: string[]): string[] {
    // Keep nodes that are entry points, validation, persistence, or contain
    // uppercase symbols; drop pure logging/formatting intermediate nodes.
    const keep = (step: string): boolean =>
      /^(entry|start|validate|validation|service|repository|repo|db|database|persist|write|read|return|compute|transform|auth|sanitize)/i.test(
        step,
      ) ||
      /[A-Z]{2,}|[a-z][A-Z]/.test(step) ||
      /[{}();]/.test(step);
    const out: string[] = [];
    for (let i = 0; i < steps.length; i++) {
      const step = steps[i]!;
      if (i === 0 || i === steps.length - 1 || keep(step)) out.push(step);
    }
    return out.length >= 2 ? out : steps;
  }
}
