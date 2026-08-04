import { JsonStorage } from "../platform/storage/jsonStorage";
import type { ContextCandidate, ContextProvenance } from "./contextEngine";

/**
 * The reservoir is the durable boundary between context preparation and
 * transmission. It keeps compact representations and retrieval metadata even
 * when a candidate was not sent to Copilot. Source-backed candidates retain a
 * path/hash/range reference; they do not copy the authoritative file.
 */
export interface ContextReservoirEntry {
  readonly candidate: Omit<ContextCandidate, "content">;
  readonly compressedContent?: string;
  readonly provenance: ContextProvenance;
}

export interface ContextReservoirRecord {
  readonly version: 1;
  readonly contextId: string;
  readonly intentId: string;
  readonly createdAt: string;
  readonly entries: readonly ContextReservoirEntry[];
}

const RESERVOIR_DIRECTORY = ".keystone/context/reservoir";
const MAX_INLINE_COMPRESSED_CONTENT = 12_000;

export class ContextReservoir {
  constructor(private readonly workspaceRoot: string) {}

  async save(
    contextId: string,
    intentId: string,
    candidates: readonly ContextCandidate[]
  ): Promise<ContextReservoirRecord> {
    const record: ContextReservoirRecord = Object.freeze({
      version: 1,
      contextId,
      intentId,
      createdAt: new Date().toISOString(),
      entries: Object.freeze(candidates.map(toEntry))
    });
    await this.storage(contextId).write(record);
    return record;
  }

  async read(contextId: string): Promise<ContextReservoirRecord | undefined> {
    return this.storage(contextId).read();
  }

  private storage(contextId: string): JsonStorage<ContextReservoirRecord | undefined> {
    return new JsonStorage<ContextReservoirRecord | undefined>(
      this.workspaceRoot,
      `${RESERVOIR_DIRECTORY}/${safeId(contextId)}.json`,
      undefined
    );
  }
}

function toEntry(candidate: ContextCandidate): ContextReservoirEntry {
  const { content, ...withoutContent } = candidate;
  const sourceBacked = Boolean(candidate.provenance.authoritativePath);
  // Workspace files remain authoritative. Keeping their body here would make
  // the reservoir a second repository cache and could surface an old copy.
  // Non-source-backed context still needs a bounded representation so it can
  // be recovered after the in-memory package is gone.
  const compressedContent = sourceBacked
    ? undefined
    : content
      ? truncateInline(content)
      : undefined;
  return Object.freeze({
    candidate: Object.freeze(withoutContent),
    ...(compressedContent ? { compressedContent } : {}),
    provenance: candidate.provenance
  });
}

function truncateInline(value: string): string {
  if (value.length <= MAX_INLINE_COMPRESSED_CONTENT) return value;
  return `${value.slice(0, MAX_INLINE_COMPRESSED_CONTENT).trim()}\n… reservoir representation truncated; expand from its authoritative evidence …`;
}

function safeId(value: string): string {
  return value.replace(/[^a-zA-Z0-9._-]/g, "_");
}
