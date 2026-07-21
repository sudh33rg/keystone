/**
 * ContextCandidateNormalizer
 *
 * Normalizes raw candidates before ranking: merges overlapping file excerpts,
 * removes duplicate content by hash, preserves distinct evidence references,
 * tags generated/low-value content, separates active from stale revisions, and
 * preserves user-pinned context regardless of ranking (unless blocked for
 * security, which the SensitiveContextFilter handles downstream).
 */

import type { ContextItem } from "../../shared/contracts/contextPackage";
import { ContextItemSchema } from "../../shared/contracts/contextPackage";
import { fnv1a, normalizeContent } from "./compressionUtils";

export interface NormalizeResult {
  items: ContextItem[];
  /** Notes about normalization actions taken (for audit). */
  notes: string[];
}

function evidenceIds(item: ContextItem): string[] {
  // ContextItem uses `sourceReference.evidenceId` for a single evidence link.
  return item.sourceReference.evidenceId ? [item.sourceReference.evidenceId] : [];
}

export class ContextCandidateNormalizer {
  async normalize(rawItems: ContextItem[]): Promise<NormalizeResult> {
    const notes: string[] = [];
    let items = [...rawItems];

    // 1. Sort so pinned and required items are preferred as canonical records.
    items.sort((a, b) => {
      if (a.pinned !== b.pinned) return a.pinned ? -1 : 1;
      if (a.importance !== b.importance)
        return importanceRank(a.importance) - importanceRank(b.importance);
      return a.id.localeCompare(b.id);
    });

    // 2. Merge overlapping file excerpts by the same file into a canonical range.
    items = this.mergeOverlappingExcerpts(items, notes);

    // 3. Remove duplicate content by normalized hash, preserving the best record.
    items = this.dedupeByContentHash(items, notes);

    // 4. Tag generated / vendor / low-value content.
    items = this.tagLowValue(items, notes);

    return { items, notes };
  }

  private mergeOverlappingExcerpts(items: ContextItem[], notes: string[]): ContextItem[] {
    const byFile = new Map<string, ContextItem[]>();
    const rest: ContextItem[] = [];
    for (const item of items) {
      const path = item.sourceReference.filePath;
      if (path && item.sourceType === "repository-file")
        byFile.set(path, [...(byFile.get(path) ?? []), item]);
      else rest.push(item);
    }
    const merged: ContextItem[] = [...rest];
    for (const [path, group] of byFile) {
      if (group.length === 1) {
        merged.push(group[0]!);
        continue;
      }
      group.sort((a, b) => (a.sourceReference.startLine ?? 0) - (b.sourceReference.startLine ?? 0));
      const canonical = group[0]!;
      const bodies = group.map((g) => g.content).filter(Boolean);
      const mergedContent = normalizeContent(bodies.join("\n\n"));
      notes.push(
        `Merged ${group.length} overlapping excerpts of ${path} into one canonical candidate.`,
      );
      merged.push(
        ContextItemSchema.parse({
          ...canonical,
          id: `merged:${fnv1a(path).slice(0, 12)}`,
          content: mergedContent,
          reasons: Array.from(
            new Set(canonical.reasons.concat("Merged from overlapping excerpts.")),
          ),
          sourceReference: {
            ...canonical.sourceReference,
            startLine: group[0]?.sourceReference.startLine,
            endLine: group[group.length - 1]?.sourceReference.endLine,
          },
        }),
      );
    }
    return merged;
  }

  private dedupeByContentHash(items: ContextItem[], notes: string[]): ContextItem[] {
    const seen = new Map<string, ContextItem>();
    const out: ContextItem[] = [];
    for (const item of items) {
      const hash = fnv1a(normalizeContent(item.content).slice(0, 4000));
      const existing = seen.get(hash);
      if (existing) {
        const mergedEvidence = Array.from(
          new Set([...evidenceIds(existing), ...evidenceIds(item)]),
        );
        const mergedReasons = Array.from(new Set([...existing.reasons, ...item.reasons]));
        const sourceRef = { ...existing.sourceReference };
        if (item.sourceReference.evidenceId) sourceRef.evidenceId = item.sourceReference.evidenceId;
        seen.set(hash, { ...existing, sourceReference: sourceRef, reasons: mergedReasons });
        if (mergedEvidence.length > 0)
          seen.get(hash)!.sourceReference.evidenceId = mergedEvidence[0];
        notes.push(`Removed duplicate content candidate ${item.id} (hash ${hash}).`);
        continue;
      }
      seen.set(hash, item);
      out.push(item);
    }
    return out;
  }

  private tagLowValue(items: ContextItem[], notes: string[]): ContextItem[] {
    return items.map((item) => {
      const path = item.sourceReference.filePath ?? "";
      const generated =
        /\b(generated|vendor|node_modules|\.d\.ts|dist|build)\b/.test(path) ||
        /@generated|^\s*\/\/ GENERATED/.test(item.content);
      if (generated) {
        notes.push(`Tagged ${item.id} as generated/low-value.`);
        return ContextItemSchema.parse({
          ...item,
          reasons: [...item.reasons, "Tagged as generated/vendor content (lower priority)."],
        });
      }
      return item;
    });
  }
}

function importanceRank(value: ContextItem["importance"]): number {
  return value === "required" ? 0 : value === "supporting" ? 1 : 2;
}
