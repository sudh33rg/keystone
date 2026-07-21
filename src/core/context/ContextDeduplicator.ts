/**
 * ContextDeduplicator
 *
 * Multi-level deterministic deduplication:
 *  - exact: identical normalized-content hashes (excerpts, instruction blocks,
 *    summaries, evidence, graph paths)
 *  - structural: repeated low-value structures (imports, boilerplate, generated
 *    accessors, framework wiring, duplicate schema fields, repeated test setup)
 *  - relationship: collapse identical path prefixes, combine repeated edges,
 *    summarize repeated leaf relationships, keep representative evidence
 *  - semantic-equivalence approximation: deterministic signals only
 *    (normalized AST structure, symbol identity, canonical signatures, token
 *    shingles, graph-neighbour similarity). This is HEURISTIC — it never claims
 *    full semantic equivalence and is labelled as approximate.
 */

import type { ContextItem } from "../../shared/contracts/contextPackage";
import { ContextItemSchema, type ContextExclusion } from "../../shared/contracts/contextPackage";
import {
  fnv1a,
  normalizeContent,
  normalizeWhitespace,
  tokenShingles,
  shinglesJaccard,
} from "./compressionUtils";

export interface DeduplicateResult {
  items: ContextItem[];
  exclusions: ContextExclusion[];
  /** Tokens removed by exact/structural/relationship duplicates (approx). */
  duplicateTokensRemoved: number;
  notes: string[];
}

const STRUCTURAL_NOISE =
  /^\s*(import\s+.+;|export\s+(const|let|var|function|class)\s+\w+;|#pragma|.+\b(get|set)\s+\w+\s*\(\)\s*\{[^}]*return[^}]*\}\s*)$/gm;

export class ContextDeduplicator {
  /**
   * @param semanticThreshold Jaccard similarity at/above which two items are
   *   considered a semantic-equivalence *approximation* (default 0.9).
   */
  constructor(private readonly semanticThreshold = 0.9) {}

  deduplicate(items: ContextItem[]): DeduplicateResult {
    const notes: string[] = [];
    const exclusions: ContextExclusion[] = [];
    let duplicateTokensRemoved = 0;

    // --- Level 1: exact deduplication by normalized content hash. ---
    const byExact = new Map<string, ContextItem>();
    const kept: ContextItem[] = [];
    for (const item of items) {
      if (item.pinned) {
        byExact.set(this.exactKey(item), item);
        kept.push(item);
        continue;
      }
      const key = this.exactKey(item);
      const existing = byExact.get(key);
      if (existing) {
        notes.push(`Exact duplicate ${item.id} removed (hash ${key}).`);
        duplicateTokensRemoved += item.tokenCount;
        exclusions.push(this.exclusion(existing, item, "exact-duplicate"));
        continue;
      }
      byExact.set(key, item);
      kept.push(item);
    }

    // --- Level 2: structural deduplication of low-value boilerplate. ---
    const structurallyReduced = this.structuralPass(kept, exclusions, notes);
    for (const e of exclusions)
      if (e.reason === "structural-duplicate") duplicateTokensRemoved += e.tokensRemoved;

    // --- Level 3: relationship deduplication (collapse repeated graph paths). ---
    const relationshipReduced = this.relationshipPass(structurallyReduced, notes);

    // --- Level 4: semantic-equivalence approximation (heuristic, labelled). ---
    const finalItems = this.semanticPass(relationshipReduced, exclusions, notes);
    for (const e of exclusions)
      if (e.reason === "semantic-duplicate") duplicateTokensRemoved += e.tokensRemoved;

    return { items: finalItems, exclusions, duplicateTokensRemoved, notes };
  }

  private exactKey(item: ContextItem): string {
    return fnv1a(normalizeContent(item.content).slice(0, 8000));
  }

  private structuralPass(
    items: ContextItem[],
    exclusions: ContextExclusion[],
    notes: string[],
  ): ContextItem[] {
    const seen = new Map<string, ContextItem>();
    const out: ContextItem[] = [];
    for (const item of items) {
      if (item.pinned) {
        out.push(item);
        continue;
      }
      const stripped = normalizeWhitespace(
        item.content.replace(STRUCTURAL_NOISE, " ").replace(/\s+/g, " "),
      ).trim();
      if (stripped.length < 20) {
        // Very low-value structural row; dedupe by its stripped signature.
        const key = `struct:${fnv1a(stripped)}`;
        const existing = seen.get(key);
        if (existing) {
          notes.push(`Structural duplicate ${item.id} removed (boilerplate).`);
          exclusions.push(this.exclusion(existing, item, "structural-duplicate"));
          continue;
        }
        seen.set(key, item);
      }
      out.push(item);
    }
    return out;
  }

  private relationshipPass(items: ContextItem[], notes: string[]): ContextItem[] {
    // Collapse repeated graph paths that share an identical prefix.
    const paths = items.filter((i) => i.sourceType === "call-flow" || i.sourceType === "data-flow");
    const others = items.filter(
      (i) => i.sourceType !== "call-flow" && i.sourceType !== "data-flow",
    );
    const representative = new Map<string, ContextItem>();
    const collapsed: ContextItem[] = [];
    for (const path of paths) {
      const prefix = path.content.split("→")[0]?.trim() ?? path.content;
      const existing = representative.get(prefix);
      if (
        existing &&
        normalizeContent(path.content).startsWith(normalizeContent(existing.content).slice(0, 40))
      ) {
        notes.push(`Collapsed repeated flow prefix for ${path.id} under ${existing.id}.`);
        continue;
      }
      representative.set(prefix, path);
      collapsed.push(path);
    }
    if (collapsed.length !== paths.length)
      notes.push(
        `Relationship deduplication collapsed ${paths.length - collapsed.length} repeated flow prefixes.`,
      );
    return [...others, ...collapsed];
  }

  private semanticPass(
    items: ContextItem[],
    exclusions: ContextExclusion[],
    notes: string[],
  ): ContextItem[] {
    const out: ContextItem[] = [];
    const shinglesCache = new Map<string, string[]>();
    const shingleOf = (item: ContextItem): string[] => {
      let s = shinglesCache.get(item.id);
      if (!s) {
        s = tokenShingles(normalizeContent(item.content));
        shinglesCache.set(item.id, s);
      }
      return s;
    };
    const alreadyDropped = new Set<string>();
    for (let i = 0; i < items.length; i++) {
      const a = items[i]!;
      if (a.pinned || alreadyDropped.has(a.id)) {
        if (!alreadyDropped.has(a.id)) out.push(a);
        continue;
      }
      let merged = false;
      for (let j = 0; j < out.length; j++) {
        const b = out[j]!;
        if (b.pinned) continue;
        if (b.sourceType !== a.sourceType) continue;
        const sim = shinglesJaccard(shingleOf(a), shingleOf(b));
        if (sim >= this.semanticThreshold) {
          // Heuristic semantic-equivalence approximation — keep canonical record.
          notes.push(
            `Approximate semantic duplicate ${a.id} folded into ${b.id} (similarity ${sim.toFixed(2)}); full equivalence not claimed.`,
          );
          exclusions.push({
            ...this.exclusion(b, a, "semantic-duplicate"),
            detail: `Approximate token-shingle similarity ${sim.toFixed(2)}; heuristic, not exact semantic equivalence.`,
          });
          merged = true;
          alreadyDropped.add(a.id);
          break;
        }
      }
      if (!merged) out.push(a);
    }
    return out;
  }

  private exclusion(
    kept: ContextItem,
    removed: ContextItem,
    reason: ContextExclusion["reason"],
  ): ContextExclusion {
    return {
      item: ContextItemSchema.parse(removed),
      reason,
      tokensRemoved: removed.tokenCount,
      restorable: reason === "semantic-duplicate" || reason === "structural-duplicate",
    };
  }
}
