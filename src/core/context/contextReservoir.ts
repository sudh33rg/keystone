import { JsonStorage } from "../platform/storage/jsonStorage";
import type { ContextCandidate, ContextProvenance } from "./contextEngine";
import type { IntentState } from "../intent/intentState";
import type { CopilotResponseEnvelope } from "../copilot/responseContract";

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
  readonly originalReference?: string;
}

export interface ContextReservoirRecord {
  readonly version: 1;
  readonly contextId: string;
  readonly intentId: string;
  readonly createdAt: string;
  readonly entries: readonly ContextReservoirEntry[];
}

/** A local, append-only ledger for comparing context across an Intent's turns. */
export interface ContextObservation {
  readonly packageId: string;
  readonly observedAt: string;
  readonly estimatedTransmittedTokens: number;
  readonly estimatedOriginalCandidateTokens: number;
  readonly allCandidateCount: number;
  readonly transmittedCandidateCount: number;
  readonly retainedCandidateCount: number;
  readonly omittedContextCount: number;
  readonly transmittedHistoryTokens: number;
  readonly retainedHistoryCandidates: number;
  readonly savingsEvents: readonly ContextSavingsEvent[];
}

export type ContextSavingsCategory =
  | "Repository Exploration"
  | "Tool/Runtime Output"
  | "Conversation/Intent History"
  | "Semantic Compression"
  | "Deduplication";

export interface ContextSavingsEvent {
  readonly category: ContextSavingsCategory;
  readonly originalEstimatedTokens: number;
  readonly transmittedEstimatedTokens: number;
  readonly avoidedEstimatedTokens: number;
  readonly reductionStrategy: string;
  readonly contextPackageId: string;
  readonly operation: string;
  readonly timestamp: string;
  readonly candidateIds: readonly string[];
}

export interface ContextInteractionRecord {
  readonly interaction: number;
  readonly packageId?: string;
  readonly recordedAt: string;
  readonly structuredStatus: CopilotResponseEnvelope["structuredStatus"];
  readonly summary?: string;
  readonly acceptedDecisionIds: readonly string[];
  readonly durableState: {
    readonly currentObjective: string;
    readonly constraintCount: number;
    readonly completedWorkCount: number;
    readonly openBlockerCount: number;
  };
  readonly rawHistory: readonly string[];
}

export interface ContextReservoirObservabilityRecord {
  readonly version: 1;
  readonly intentId: string;
  readonly observations: readonly ContextObservation[];
  readonly interactions: readonly ContextInteractionRecord[];
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

  /** Persist staleness as soon as a watched source changes. Hash validation remains
   * authoritative, but this prevents a retained reservoir entry from appearing
   * current between the edit and the next Context Lens expansion. */
  async markStaleForPaths(contextId: string, paths: readonly string[]): Promise<void> {
    const record = await this.read(contextId);
    if (!record || !paths.length) return;
    const changed = new Set(paths.map(normalizePath));
    let touched = false;
    const entries = record.entries.map((entry) => {
      const sourcePath = entry.provenance.authoritativePath;
      if (!sourcePath || !changed.has(normalizePath(sourcePath)) || entry.candidate.stale) return entry;
      touched = true;
      return {
        ...entry,
        candidate: { ...entry.candidate, stale: true }
      };
    });
    if (touched) await this.storage(contextId).write({ ...record, entries });
  }

  async recordObservation(intentId: string, observation: ContextObservation): Promise<void> {
    const current = await this.observability(intentId).read();
    const observations = [
      ...(current?.observations ?? []).filter((item) => item.packageId !== observation.packageId),
      observation
    ].slice(-100);
    await this.observability(intentId).write({
      version: 1,
      intentId,
      observations,
      interactions: current?.interactions ?? []
    });
  }

  async recordInteraction(
    intentId: string,
    interaction: {
      packageId?: string;
      recordedAt: string;
      structuredStatus: CopilotResponseEnvelope["structuredStatus"];
      summary?: string;
      acceptedDecisionIds: readonly string[];
      rawHistory?: readonly string[];
    },
    state: IntentState
  ): Promise<void> {
    const current = await this.observability(intentId).read();
    const next = {
      interaction: (current?.interactions.length ?? 0) + 1,
      ...interaction,
      rawHistory: interaction.rawHistory ?? [],
      durableState: {
        currentObjective: state.currentObjective,
        constraintCount: state.constraints.length,
        completedWorkCount: state.completedWork.length,
        openBlockerCount: state.blockers.filter((item) => !item.resolvedAt).length
      }
    } satisfies ContextInteractionRecord;
    await this.observability(intentId).write({
      version: 1,
      intentId,
      observations: current?.observations ?? [],
      interactions: [...(current?.interactions ?? []), next].slice(-100)
    });
  }

  async readObservability(intentId: string): Promise<ContextReservoirObservabilityRecord | undefined> {
    return this.observability(intentId).read();
  }

  private storage(contextId: string): JsonStorage<ContextReservoirRecord | undefined> {
    return new JsonStorage<ContextReservoirRecord | undefined>(
      this.workspaceRoot,
      `${RESERVOIR_DIRECTORY}/${safeId(contextId)}.json`,
      undefined
    );
  }

  private observability(intentId: string): JsonStorage<ContextReservoirObservabilityRecord | undefined> {
    return new JsonStorage<ContextReservoirObservabilityRecord | undefined>(
      this.workspaceRoot,
      `${RESERVOIR_DIRECTORY}/observability/${safeId(intentId)}.json`,
      undefined
    );
  }
}

function normalizePath(value: string): string {
  return value.replace(/\\/g, "/").replace(/^\.\//, "");
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
    provenance: candidate.provenance,
    ...(candidate.compression?.originalReference ? { originalReference: candidate.compression.originalReference } : {})
  });
}

function truncateInline(value: string): string {
  if (value.length <= MAX_INLINE_COMPRESSED_CONTENT) return value;
  return `${value.slice(0, MAX_INLINE_COMPRESSED_CONTENT).trim()}\n… reservoir representation truncated; expand from its authoritative evidence …`;
}

function safeId(value: string): string {
  return value.replace(/[^a-zA-Z0-9._-]/g, "_");
}
