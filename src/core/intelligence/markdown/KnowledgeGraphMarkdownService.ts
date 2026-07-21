// KnowledgeGraphMarkdownService.ts
// Generates `.keystone/knowledge-graph.md` for GitHub Copilot consumption.

import type { IntelligenceSnapshotReader } from "../../persistence/IntelligenceStore";

export interface KnowledgeGraphMarkdownOptions {
  /** Maximum number of symbols to include. Defaults to 100. */
  maxSymbols?: number;
  /** Maximum number of relationships to include. Defaults to 200. */
  maxRelationships?: number;
  /** Filter by entity type. Empty means all. */
  entityTypeFilter?: string;
  /** Filter by language. Empty means all. */
  languageFilter?: string;
}

export interface KnowledgeGraphMarkdownResult {
  generation: number;
  markdown: string;
  symbolCount: number;
  relationshipCount: number;
  fileCount: number;
}

export class KnowledgeGraphMarkdownService {
  constructor(private readonly store: IntelligenceSnapshotReader) {}

  generate(options: KnowledgeGraphMarkdownOptions = {}): KnowledgeGraphMarkdownResult {
    const snapshot = this.store.getSnapshot();
    if (!snapshot) {
      throw new Error("Intelligence snapshot unavailable.");
    }

    const { maxSymbols = 100, maxRelationships = 200, entityTypeFilter, languageFilter } = options;

    const lines: string[] = [];
    lines.push("# Repository Knowledge Graph");
    lines.push("");
    lines.push(`**Generation:** ${snapshot.manifest.generation}`);
    lines.push(`**Repository:** ${snapshot.repository.displayName}`);
    lines.push(`**Branch:** ${snapshot.repository.branch ?? "unknown"}`);
    lines.push(`**Head Commit:** ${snapshot.repository.headCommit ?? "unknown"}`);
    lines.push(`**Generated At:** ${new Date().toISOString()}`);
    lines.push("");

    // Files section
    lines.push("## Files");
    lines.push("");
    lines.push("| Path | Language | Category | Symbols |");
    lines.push("|------|----------|----------|---------|");

    const fileSymbols = new Map<string, number>();
    for (const symbol of snapshot.symbols) {
      fileSymbols.set(symbol.fileId, (fileSymbols.get(symbol.fileId) ?? 0) + 1);
    }

    for (const file of snapshot.files.slice(0, maxSymbols)) {
      if (languageFilter && file.language !== languageFilter) continue;
      const symbolCount = fileSymbols.get(file.id) ?? 0;
      lines.push(`| ${file.relativePath} | ${file.language} | ${file.category} | ${symbolCount} |`);
    }
    lines.push("");

    // Symbols section
    lines.push("## Symbols");
    lines.push("");
    lines.push("| Qualified Name | Type | Language | File | Confidence |");
    lines.push("|---------------|------|----------|------|------------|");

    let symbolIndex = 0;
    for (const symbol of snapshot.symbols) {
      if (symbolIndex >= maxSymbols) break;
      if (entityTypeFilter && !symbol.type.startsWith(entityTypeFilter)) continue;
      if (languageFilter && symbol.language !== languageFilter) continue;

      const file = snapshot.files.find((f) => f.id === symbol.fileId);
      lines.push(
        `| ${symbol.qualifiedName} | ${symbol.type} | ${symbol.language} | ${file?.relativePath ?? "unknown"} | ${symbol.confidence.toFixed(2)} |`,
      );
      symbolIndex++;
    }
    lines.push("");

    // Relationships section
    lines.push("## Relationships");
    lines.push("");
    lines.push("| Source | Target | Type | Confidence |");
    lines.push("|--------|--------|------|------------|");

    let relIndex = 0;
    for (const rel of snapshot.relationships) {
      if (relIndex >= maxRelationships) break;

      const sourceEntity = this.findEntity(snapshot, rel.sourceId);
      const targetEntity = this.findEntity(snapshot, rel.targetId);

      lines.push(
        `| ${sourceEntity?.qualifiedName ?? rel.sourceId} | ${targetEntity?.qualifiedName ?? rel.targetId} | ${rel.type} | ${rel.confidence.toFixed(2)} |`,
      );
      relIndex++;
    }
    lines.push("");

    // Summary section
    lines.push("## Summary");
    lines.push("");
    lines.push(`- **Total Files:** ${snapshot.files.length}`);
    lines.push(`- **Total Symbols:** ${snapshot.symbols.length}`);
    lines.push(`- **Total Relationships:** ${snapshot.relationships.length}`);
    lines.push(`- **Total Evidence:** ${snapshot.evidence.length}`);

    const markdown = lines.join("\n");

    return {
      generation: snapshot.manifest.generation,
      markdown,
      symbolCount: snapshot.symbols.length,
      relationshipCount: snapshot.relationships.length,
      fileCount: snapshot.files.length,
    };
  }

  private findEntity(
    snapshot: ReturnType<IntelligenceSnapshotReader["getSnapshot"]>,
    id: string,
  ): { qualifiedName: string; type: string } | undefined {
    if (!snapshot) return undefined;
    const symbol = snapshot.symbols.find((s) => s.id === id);
    if (symbol) return { qualifiedName: symbol.qualifiedName, type: symbol.type };
    const file = snapshot.files.find((f) => f.id === id);
    if (file) return { qualifiedName: file.relativePath, type: "keystone.core.File" };
    return undefined;
  }
}
