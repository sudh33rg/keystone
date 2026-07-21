// MarkdownExportService.ts
// Generates and writes knowledge-graph.md and intelligence-overview.md to .keystone/.

import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { IntelligenceSnapshotReader } from "../../persistence/IntelligenceStore";
import { KnowledgeGraphMarkdownService } from "./KnowledgeGraphMarkdownService";
import { IntelligenceOverviewMarkdownService } from "./IntelligenceOverviewMarkdownService";
import type { CopilotToggleService } from "./CopilotToggleService";

export interface MarkdownExportOptions {
  /** Output directory. Defaults to .keystone/exports/. */
  outputDir?: string;
  /** Maximum symbols to include. Defaults to 100. */
  maxSymbols?: number;
  /** Maximum relationships to include. Defaults to 200. */
  maxRelationships?: number;
}

export interface MarkdownExportResult {
  knowledgeGraphPath: string | undefined;
  intelligenceOverviewPath: string | undefined;
  knowledgeGraphGenerated: boolean;
  intelligenceOverviewGenerated: boolean;
  error?: string;
}

export class MarkdownExportService {
  constructor(
    private readonly store: IntelligenceSnapshotReader,
    private readonly copilotToggle: CopilotToggleService,
    private readonly storageRoot: string | undefined,
  ) {}

  async export(options: MarkdownExportOptions = {}): Promise<MarkdownExportResult> {
    const {
      outputDir = this.storageRoot ? join(this.storageRoot, "exports") : undefined,
      maxSymbols = 100,
      maxRelationships = 200,
    } = options;

    if (!outputDir) {
      return {
        knowledgeGraphPath: undefined,
        intelligenceOverviewPath: undefined,
        knowledgeGraphGenerated: false,
        intelligenceOverviewGenerated: false,
        error: "No storage root configured for markdown export.",
      };
    }

    const knowledgeGraphPath = join(outputDir, "knowledge-graph.md");
    const intelligenceOverviewPath = join(outputDir, "intelligence-overview.md");

    try {
      await mkdir(outputDir, { recursive: true });
    } catch (cause) {
      return {
        knowledgeGraphPath: undefined,
        intelligenceOverviewPath: undefined,
        knowledgeGraphGenerated: false,
        intelligenceOverviewGenerated: false,
        error: `Failed to create output directory: ${cause instanceof Error ? cause.message : String(cause)}`,
      };
    }

    let knowledgeGraphGenerated = false;
    let intelligenceOverviewGenerated = false;

    // Generate knowledge-graph.md only if Copilot toggle is enabled
    if (this.copilotToggle.isEnabled()) {
      try {
        const kgService = new KnowledgeGraphMarkdownService(this.store);
        const result = kgService.generate({
          maxSymbols,
          maxRelationships,
        });
        await writeFile(knowledgeGraphPath, result.markdown, "utf-8");
        knowledgeGraphGenerated = true;
      } catch {
        // Continue even if one fails
      }
    }

    // Always generate intelligence-overview.md
    try {
      const overviewService = new IntelligenceOverviewMarkdownService(this.store);
      const result = overviewService.generate();
      await writeFile(intelligenceOverviewPath, result.markdown, "utf-8");
      intelligenceOverviewGenerated = true;
    } catch {
      // Continue even if one fails
    }

    return {
      knowledgeGraphPath: knowledgeGraphGenerated ? knowledgeGraphPath : undefined,
      intelligenceOverviewPath: intelligenceOverviewGenerated
        ? intelligenceOverviewPath
        : undefined,
      knowledgeGraphGenerated,
      intelligenceOverviewGenerated,
    };
  }
}
