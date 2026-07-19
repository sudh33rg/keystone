// WildcardSearchService.ts
// Provides wildcard/pattern‑based search across the knowledge graph.
// Supports glob‑style patterns (e.g. "*.ts", "**/test/*", "Foo*") against names,
// qualified names, file paths, types, and languages.

import type { IntelligenceSnapshotReader } from "../../persistence/IntelligenceStore";

export interface WildcardSearchOptions {
  /** Glob‑style pattern to match against. Supports *, ?, and ** segments. */
  pattern: string;
  /** Match against these fields. Defaults to all. */
  fields?: ("name" | "qualifiedName" | "relativePath" | "type" | "language")[];
  /** Maximum results. Defaults to 100. */
  limit?: number;
  /** Filter by entity type prefix (e.g. "keystone.core.Function"). */
  entityTypeFilter?: string;
  /** Filter by language. */
  languageFilter?: string;
}

export interface WildcardSearchResult {
  generation: number;
  pattern: string;
  matches: WildcardMatch[];
  total: number;
}

export interface WildcardMatch {
  id: string;
  type: string;
  kind: "symbol" | "file";
  name: string;
  qualifiedName: string;
  relativePath: string;
  matchedField: string;
  matchedText: string;
}

export class WildcardSearchService {
  constructor(private readonly store: IntelligenceSnapshotReader) {}

  async search(
    options: WildcardSearchOptions,
    signal?: AbortSignal,
  ): Promise<WildcardSearchResult> {
    const snapshot = this.store.getSnapshot();
    if (!snapshot) {
      throw new Error("Intelligence snapshot unavailable.");
    }

    const {
      pattern,
      fields = ["name", "qualifiedName", "relativePath", "type", "language"],
      limit = 100,
      entityTypeFilter,
      languageFilter,
    } = options;

    const regex = globToRegex(pattern);
    const matches: WildcardMatch[] = [];

    // Search symbols
    for (let index = 0; index < snapshot.symbols.length; index++) {
      const symbol = snapshot.symbols[index];
      if (!symbol) continue;
      if ((index + 1) % 500 === 0) {
        if (signal?.aborted) {
          const error = new Error("Cancelled.");
          error.name = "AbortError";
          throw error;
        }
        await new Promise<void>((resolve) => setImmediate(resolve));
      }
      if (matches.length >= limit) break;

      if (entityTypeFilter && !symbol.type.startsWith(entityTypeFilter)) continue;
      if (languageFilter && symbol.language !== languageFilter) continue;

      const file = snapshot.files.find((f) => f.id === symbol.fileId);
      const filePath = file?.relativePath ?? "";

      for (const field of fields) {
        let value: string;
        let matchedText: string;
        switch (field) {
          case "name":
            value = symbol.name;
            matchedText = symbol.name;
            break;
          case "qualifiedName":
            value = symbol.qualifiedName;
            matchedText = symbol.qualifiedName;
            break;
          case "relativePath":
            value = filePath;
            matchedText = filePath;
            break;
          case "type":
            value = symbol.type;
            matchedText = symbol.type;
            break;
          case "language":
            value = symbol.language;
            matchedText = symbol.language;
            break;
          default:
            continue;
        }
        if (regex.test(value)) {
          matches.push({
            id: symbol.id,
            type: symbol.type,
            kind: "symbol",
            name: symbol.name,
            qualifiedName: symbol.qualifiedName,
            relativePath: filePath,
            matchedField: field,
            matchedText,
          });
          break;
        }
      }
    }

    // Search files
    for (let index = 0; index < snapshot.files.length; index++) {
      const file = snapshot.files[index];
      if (!file) continue;
      if ((index + 1) % 500 === 0) {
        if (signal?.aborted) {
          const error = new Error("Cancelled.");
          error.name = "AbortError";
          throw error;
        }
        await new Promise<void>((resolve) => setImmediate(resolve));
      }
      if (matches.length >= limit) break;

      for (const field of fields) {
        let value: string;
        let matchedText: string;
        switch (field) {
          case "name":
            value = file.relativePath.split("/").at(-1) ?? file.relativePath;
            matchedText = value;
            break;
          case "qualifiedName":
            value = file.relativePath;
            matchedText = file.relativePath;
            break;
          case "relativePath":
            value = file.relativePath;
            matchedText = file.relativePath;
            break;
          case "type":
            value = "keystone.core.File";
            matchedText = value;
            break;
          case "language":
            value = file.language;
            matchedText = file.language;
            break;
          default:
            continue;
        }
        if (regex.test(value)) {
          matches.push({
            id: file.id,
            type: "keystone.core.File",
            kind: "file",
            name: file.relativePath.split("/").at(-1) ?? file.relativePath,
            qualifiedName: file.relativePath,
            relativePath: file.relativePath,
            matchedField: field,
            matchedText,
          });
          break;
        }
      }
    }

    // Sort by qualified name
    matches.sort((a, b) => a.qualifiedName.localeCompare(b.qualifiedName));

    return {
      generation: snapshot.manifest.generation,
      pattern,
      matches: matches.slice(0, limit),
      total: matches.length,
    };
  }
}

/**
 * Converts a simple glob pattern to a regex.
 * Supports: * (any chars), ? (single char), ** (any path segments).
 */
function globToRegex(pattern: string): RegExp {
  const escaped = pattern
    .replace(/[.+^${}()|[\]\\]/g, "\\$&")
    .replace(/\*\*/g, "{{GLOBSTAR}}")
    .replace(/\*/g, "[^/]*")
    .replace(/\?/g, "[^/]")
    .replace(/\{\{GLOBSTAR\}\}/g, ".*");
  return new RegExp(`^${escaped}$`, "i");
}
