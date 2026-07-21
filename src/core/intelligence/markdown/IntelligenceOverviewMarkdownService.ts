// IntelligenceOverviewMarkdownService.ts
// Generates `.keystone/intelligence-overview.md` for GitHub Copilot consumption.

import type { IntelligenceSnapshotReader } from "../../persistence/IntelligenceStore";

export interface IntelligenceOverviewMarkdownOptions {
  /** Maximum number of items per section. Defaults to 20. */
  maxItems?: number;
}

export interface IntelligenceOverviewMarkdownResult {
  generation: number;
  markdown: string;
}

export class IntelligenceOverviewMarkdownService {
  constructor(private readonly store: IntelligenceSnapshotReader) {}

  generate(options: IntelligenceOverviewMarkdownOptions = {}): IntelligenceOverviewMarkdownResult {
    const snapshot = this.store.getSnapshot();
    if (!snapshot) {
      throw new Error("Intelligence snapshot unavailable.");
    }

    const { maxItems = 20 } = options;

    const lines: string[] = [];
    lines.push("# Intelligence Overview");
    lines.push("");
    lines.push(`**Generation:** ${snapshot.manifest.generation}`);
    lines.push(`**Repository:** ${snapshot.repository.displayName}`);
    lines.push(`**Branch:** ${snapshot.repository.branch ?? "unknown"}`);
    lines.push(`**Head Commit:** ${snapshot.repository.headCommit ?? "unknown"}`);
    lines.push(`**Status:** ${snapshot.manifest.status}`);
    lines.push(`**Generated At:** ${new Date().toISOString()}`);
    lines.push("");

    // Counts section
    lines.push("## Counts");
    lines.push("");
    lines.push(`- **Files:** ${snapshot.files.length}`);
    lines.push(`- **Symbols:** ${snapshot.symbols.length}`);
    lines.push(`- **Relationships:** ${snapshot.relationships.length}`);
    lines.push(`- **Evidence:** ${snapshot.evidence.length}`);
    lines.push(`- **Diagnostics:** ${snapshot.diagnostics.length}`);
    lines.push("");

    // Languages section
    const languages = new Map<string, number>();
    for (const file of snapshot.files) {
      languages.set(file.language, (languages.get(file.language) ?? 0) + 1);
    }
    if (languages.size > 0) {
      lines.push("## Languages");
      lines.push("");
      for (const [lang, count] of [...languages.entries()]
        .sort((a, b) => b[1] - a[1])
        .slice(0, maxItems)) {
        lines.push(`- **${lang}:** ${count} files`);
      }
      lines.push("");
    }

    // Categories section
    const categories = new Map<string, number>();
    for (const file of snapshot.files) {
      categories.set(file.category, (categories.get(file.category) ?? 0) + 1);
    }
    if (categories.size > 0) {
      lines.push("## Categories");
      lines.push("");
      for (const [cat, count] of [...categories.entries()]
        .sort((a, b) => b[1] - a[1])
        .slice(0, maxItems)) {
        lines.push(`- **${cat}:** ${count} files`);
      }
      lines.push("");
    }

    // Symbol Types section
    const symbolTypes = new Map<string, number>();
    for (const symbol of snapshot.symbols) {
      symbolTypes.set(symbol.type, (symbolTypes.get(symbol.type) ?? 0) + 1);
    }
    if (symbolTypes.size > 0) {
      lines.push("## Symbol Types");
      lines.push("");
      for (const [type, count] of [...symbolTypes.entries()]
        .sort((a, b) => b[1] - a[1])
        .slice(0, maxItems)) {
        lines.push(`- **${type}:** ${count}`);
      }
      lines.push("");
    }

    // Relationship Types section
    const relationshipTypes = new Map<string, number>();
    for (const rel of snapshot.relationships) {
      relationshipTypes.set(rel.type, (relationshipTypes.get(rel.type) ?? 0) + 1);
    }
    if (relationshipTypes.size > 0) {
      lines.push("## Relationship Types");
      lines.push("");
      for (const [type, count] of [...relationshipTypes.entries()]
        .sort((a, b) => b[1] - a[1])
        .slice(0, maxItems)) {
        lines.push(`- **${type}:** ${count}`);
      }
      lines.push("");
    }

    // Confidence Distribution section
    const confidenceBuckets = new Map<string, number>();
    for (const rel of snapshot.relationships) {
      let bucket: string;
      if (rel.confidence === 1) bucket = "exact";
      else if (rel.confidence >= 0.8) bucket = "high";
      else if (rel.confidence >= 0.5) bucket = "medium";
      else bucket = "candidate";
      confidenceBuckets.set(bucket, (confidenceBuckets.get(bucket) ?? 0) + 1);
    }
    if (confidenceBuckets.size > 0) {
      lines.push("## Confidence Distribution");
      lines.push("");
      for (const [bucket, count] of [...confidenceBuckets.entries()].sort((a, b) => b[1] - a[1])) {
        lines.push(`- **${bucket}:** ${count}`);
      }
      lines.push("");
    }

    // Top Files section
    lines.push("## Top Files (by Symbol Count)");
    lines.push("");
    const fileSymbolCounts = new Map<string, number>();
    for (const symbol of snapshot.symbols) {
      fileSymbolCounts.set(symbol.fileId, (fileSymbolCounts.get(symbol.fileId) ?? 0) + 1);
    }
    const topFiles = [...fileSymbolCounts.entries()].sort((a, b) => b[1] - a[1]).slice(0, maxItems);

    if (topFiles.length > 0) {
      lines.push("| File | Symbols |");
      lines.push("|------|---------|");
      for (const [fileId, count] of topFiles) {
        const file = snapshot.files.find((f) => f.id === fileId);
        if (file) {
          lines.push(`| ${file.relativePath} | ${count} |`);
        }
      }
      lines.push("");
    }

    // Top Symbols section
    lines.push("## Top Symbols (by Confidence)");
    lines.push("");
    const topSymbols = [...snapshot.symbols]
      .sort((a, b) => b.confidence - a.confidence)
      .slice(0, maxItems);

    if (topSymbols.length > 0) {
      lines.push("| Qualified Name | Type | Confidence |");
      lines.push("|---------------|------|------------|");
      for (const symbol of topSymbols) {
        lines.push(
          `| ${symbol.qualifiedName} | ${symbol.type} | ${symbol.confidence.toFixed(2)} |`,
        );
      }
      lines.push("");
    }

    // Diagnostics section
    if (snapshot.diagnostics.length > 0) {
      lines.push("## Diagnostics");
      lines.push("");
      const diagByCode = new Map<string, number>();
      for (const diag of snapshot.diagnostics) {
        diagByCode.set(diag.code, (diagByCode.get(diag.code) ?? 0) + 1);
      }
      for (const [code, count] of [...diagByCode.entries()]
        .sort((a, b) => b[1] - a[1])
        .slice(0, maxItems)) {
        lines.push(`- **${code}:** ${count}`);
      }
      lines.push("");
    }

    const markdown = lines.join("\n");

    return {
      generation: snapshot.manifest.generation,
      markdown,
    };
  }
}
