import fs from "node:fs/promises";
import path from "node:path";
import { createHash } from "node:crypto";
import type { LanguageAnalysisResult } from "../languages/languageAnalysis";

export const STRUCTURAL_EXTRACTION_CACHE_VERSION = "deterministic-file-extraction-v2";

interface ExtractionCacheEntry {
  version: 1;
  extractorVersion: string;
  filePath: string;
  contentHash: string;
  analysis: LanguageAnalysisResult;
}

export class ExtractionCache {
  private readonly root: string;

  constructor(workspaceRoot: string) {
    this.root = path.join(workspaceRoot, ".keystone", "cache", "extractions");
  }

  async read(filePath: string, contentHash: string): Promise<LanguageAnalysisResult | undefined> {
    const entry = await this.readEntry(filePath, contentHash);
    if (
      !entry ||
      entry.version !== 1 ||
      entry.extractorVersion !== STRUCTURAL_EXTRACTION_CACHE_VERSION ||
      entry.filePath !== filePath ||
      entry.contentHash !== contentHash
    )
      return undefined;
    return entry.analysis;
  }

  async write(
    filePath: string,
    contentHash: string,
    analysis: LanguageAnalysisResult
  ): Promise<void> {
    const target = this.entryPath(filePath, contentHash);
    const temporary = `${target}.${process.pid}.${Date.now()}.tmp`;
    await fs.mkdir(this.root, { recursive: true });
    const entry: ExtractionCacheEntry = {
      version: 1,
      extractorVersion: STRUCTURAL_EXTRACTION_CACHE_VERSION,
      filePath,
      contentHash,
      analysis
    };
    try {
      await fs.writeFile(temporary, `${JSON.stringify(entry)}\n`, "utf8");
      await fs.rename(temporary, target);
    } finally {
      await fs.rm(temporary, { force: true }).catch(() => undefined);
    }
  }

  private async readEntry(
    filePath: string,
    contentHash: string
  ): Promise<ExtractionCacheEntry | undefined> {
    try {
      return JSON.parse(
        await fs.readFile(this.entryPath(filePath, contentHash), "utf8")
      ) as ExtractionCacheEntry;
    } catch {
      return undefined;
    }
  }

  private entryPath(filePath: string, contentHash: string): string {
    const key = createHash("sha256")
      .update(`${STRUCTURAL_EXTRACTION_CACHE_VERSION}\0${filePath}\0${contentHash}`)
      .digest("hex");
    return path.join(this.root, `${key}.json`);
  }
}
