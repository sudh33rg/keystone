import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";

import { JsonStorage } from "../platform/storage/jsonStorage";
import { ContextReservoir } from "./contextReservoir";
import type {
  CodeSymbol,
  ContextPack,
  DeveloperIntent,
  RepoFile,
  RepoIntelligence,
  RepoSkill,
  RouteDecision,
  ServiceNode,
  TestMapping
} from "../domain/types";
import { buildIntentContextPack, type ContextBuildOptions } from "./intentContextBuilder";
import { estimateTokens, type TokenEstimatorCapability } from "./tokenEstimator";
import { selectCanonicalContext } from "../intelligence/okf/canonicalContext";
import {
  compressConversationHistory,
  compressDiagnostics,
  compressDiff,
  compressDocumentation,
  compressSourceCode,
  compressStructuredData
} from "./taskAwareCompression";
import type { IntentState } from "../intent/intentState";

export type ContextOperation =
  | "UNDERSTAND_INTENT"
  | "ANSWER_QUESTION"
  | "PLAN_CHANGE"
  | "IMPLEMENT"
  | "DEBUG"
  | "REVIEW_CHANGE"
  | "SECURITY_ANALYSIS"
  | "PERFORMANCE_ANALYSIS"
  | "EXPLAIN";

/** Public aliases are kept for the existing UI; L0–L4 are the reservoir model. */
export type ContextExpansionLevel =
  "L0" | "L1" | "L2" | "L3" | "L4" | "summary" | "standard" | "full";

export type ContextSourceCategory =
  "intent" | "decisions" | "intelligence" | "workspace" | "changes" | "diagnostics" | "history";

export type ContextPriorityBand = "P0" | "P1" | "P2" | "P3" | "P4";

export type ContextPackageSectionName =
  | "INTENT"
  | "CURRENT OBJECTIVE"
  | "CONSTRAINTS"
  | "ACCEPTED DECISIONS"
  | "RELEVANT REPOSITORY FACTS"
  | "EXISTING PATTERNS"
  | "ACTIVE CHANGES"
  | "DIAGNOSTICS"
  | "KNOWN RISKS"
  | "AVAILABLE CONTEXT EXPANSIONS";

export type ContextCandidateSourceType =
  | "intent"
  | "decision"
  | "repository-file"
  | "symbol"
  | "test"
  | "api"
  | "service"
  | "intelligence-unit"
  | "intelligence-relationship"
  | "intelligence-flow"
  | "workspace"
  | "change"
  | "diagnostic"
  | "history"
  | "user-context"
  | "bounded-intelligence";

export interface ContextEvidenceReference {
  readonly id?: string;
  readonly entityId?: string;
  readonly relationshipId?: string;
  readonly flowId?: string;
  readonly evidenceId?: string;
  readonly kind: string;
  readonly label: string;
  readonly path?: string;
  readonly startLine?: number;
  readonly endLine?: number;
}

export interface ContextSourceRevision {
  readonly value: string;
  readonly capturedAt: string;
  readonly source: "okf" | "intelligence" | "file";
}

export interface ContextProvenance {
  readonly origin:
    | "intent"
    | "decision"
    | "intelligence"
    | "workspace"
    | "change"
    | "diagnostic"
    | "history"
    | "file";
  readonly authoritativePath?: string;
  readonly sourceHash?: string;
  readonly sourceRevision: string;
  readonly capturedAt: string;
  readonly ranges: readonly ContextEvidenceReference[];
}

/** A retrievable unit of context known to Keystone. Bodies are only retained when selected. */
export interface ContextCandidate {
  readonly id: string;
  readonly category: ContextSourceCategory;
  readonly sourceType: ContextCandidateSourceType;
  readonly content?: string;
  readonly payload: Readonly<Record<string, unknown>>;
  readonly priority: number;
  readonly relevance: number;
  readonly estimatedTokenCost: number;
  readonly sourceRevision: ContextSourceRevision;
  readonly confidence?: number;
  readonly evidence: readonly ContextEvidenceReference[];
  /** Provenance survives compression and points back to the original evidence. */
  readonly provenance: ContextProvenance;
  /** Deterministic task-aware compression receipt; source evidence remains authoritative. */
  readonly compression?: ContextCompressionMetadata;
  readonly stale?: boolean;
  readonly currentSourceHash?: string;
  readonly expandable: boolean;
}

export interface ContextReference {
  readonly candidateId: string;
  readonly sourceType: ContextCandidateSourceType;
  readonly label: string;
  readonly path?: string;
  readonly reason: string;
  readonly estimatedTokenCost: number;
  readonly sourceRevision: ContextSourceRevision;
  readonly contextId?: string;
  readonly provenance?: ContextProvenance;
  readonly stale?: boolean;
}

export interface ContextInventory {
  readonly candidateCount: number;
  readonly candidateIds: readonly string[];
}

export interface ContextPackage {
  readonly id: string;
  readonly intent: DeveloperIntent;
  readonly objective: string;
  readonly operation: ContextOperation;
  readonly tokenBudget: number;
  readonly estimatedTransmittedTokens: number;
  /** Stable inventory of everything known to this preparation operation. */
  readonly knownContext: ContextInventory;
  /** Context relevant to the operation before the transmission budget is applied. */
  readonly selectedContext: readonly ContextCandidate[];
  /** Context represented in the generated Copilot prompt/packet. */
  readonly transmittedContext: readonly ContextCandidate[];
  /** Known context retained locally for later retrieval or expansion. */
  readonly retainedContext: readonly ContextCandidate[];
  readonly omittedContext: readonly ContextReference[];
  /** Context known during retrieval but intentionally not retained for expansion. */
  readonly excludedContext: readonly ContextReference[];
  readonly sourceRevision: ContextSourceRevision;
  readonly evidence: readonly ContextEvidenceReference[];
  readonly allCandidateCount: number;
  readonly createdAt: string;
  readonly contextPackId: string;
  readonly sections: readonly ContextPackageSection[];
  readonly content: string;
  readonly metadata: ContextPackageMetadata;
}

export interface ContextPackageSection {
  readonly name: ContextPackageSectionName;
  readonly content: string;
  readonly estimatedTokens: number;
  readonly candidateIds: readonly string[];
  readonly references: readonly ContextReference[];
}

export interface ContextCompressionDecision {
  readonly candidateId: string;
  readonly priority: ContextPriorityBand;
  readonly action: "full" | "compressed" | "reference-only" | "omitted";
  readonly reason: string;
  readonly originalTokens: number;
  readonly transmittedTokens: number;
  readonly strategy?: string;
}

export interface ContextPackageMetadata {
  readonly estimatedOriginalCandidateTokens: number;
  readonly estimatedTransmittedTokens: number;
  readonly estimatedOmittedRetrievableTokens: number;
  readonly selectedContextIds: readonly string[];
  readonly evidenceReferences: readonly ContextEvidenceReference[];
  readonly sourceRevision: ContextSourceRevision;
  readonly compressionDecisions: readonly ContextCompressionDecision[];
  readonly estimator: "character-four" | "capability-adjusted";
  readonly model?: string;
  readonly contextWindowTokens?: number;
}

export interface ContextPackageSummary {
  readonly id: string;
  readonly operation: ContextOperation;
  readonly tokenBudget: number;
  readonly estimatedTransmittedTokens: number;
  readonly allCandidateCount: number;
  readonly selectedCandidateCount: number;
  readonly transmittedCandidateCount: number;
  readonly retainedCandidateCount: number;
  readonly omittedContextCount: number;
  readonly sourceRevision: string;
  readonly sourceCounts: readonly ContextSourceCount[];
  readonly candidates: readonly ContextCandidateSummary[];
  readonly retainedCandidates: readonly ContextCandidateSummary[];
  readonly inspector: ContextInspectorSummary;
}

export interface ContextSourceCount {
  readonly category: ContextSourceCategory;
  readonly label: string;
  readonly count: number;
  readonly included: boolean;
}

export interface ContextCandidateSummary {
  readonly id: string;
  readonly category: ContextSourceCategory;
  readonly sourceType: ContextCandidateSourceType;
  readonly label: string;
  readonly path?: string;
  readonly relevance: number;
  readonly estimatedTokenCost: number;
  readonly evidence: readonly ContextEvidenceReference[];
  readonly expandable: boolean;
  readonly compressed: boolean;
  readonly contextReference: string;
  readonly provenance: ContextProvenance;
  readonly reason: string;
}

export interface ContextInspectorSummary {
  readonly estimatedPreparedTokens: number;
  readonly estimatedAvoidedTokens: number;
  readonly mustPreserve: readonly ContextCandidateSummary[];
  readonly included: readonly ContextCandidateSummary[];
  readonly availableOnDemand: readonly ContextCandidateSummary[];
  readonly excluded: readonly ContextCandidateSummary[];
}

export interface ContextFragment {
  readonly contextId: string;
  readonly reference?: string;
  readonly focus: string;
  readonly level: ContextExpansionLevel;
  readonly candidates: readonly ContextCandidate[];
  readonly estimatedTokens: number;
  readonly content: string;
  readonly stale: boolean;
  readonly staleSources: readonly ContextStaleSource[];
}

export interface ContextStaleSource {
  readonly path: string;
  readonly expectedHash?: string;
  readonly currentHash?: string;
  readonly message: string;
}

export interface ContextPreparationRequest {
  readonly intent: DeveloperIntent;
  readonly objective: string;
  readonly operation: ContextOperation;
  readonly tokenBudget: number;
  readonly intelligence: RepoIntelligence;
  readonly routeDecision: RouteDecision;
  readonly skills: readonly RepoSkill[];
  readonly buildOptions?: ContextBuildOptions;
  readonly sourceRevision?: string;
  readonly decisions?: readonly string[];
  /** Durable Intent state is authoritative for accepted decisions and constraints. */
  readonly intentState?: IntentState;
  readonly workspace?: ContextWorkspaceState;
  readonly changes?: ContextChangesState;
  readonly diagnostics?: readonly ContextDiagnostic[];
  readonly logs?: readonly ContextLogEntry[];
  readonly userContext?: readonly ContextUserContext[];
  readonly contextCapability?: ContextCapability;
}

export interface ContextCapability extends TokenEstimatorCapability {
  readonly model?: string;
  readonly contextWindowTokens?: number;
}

export interface ContextWorkspaceState {
  readonly currentFile?: string;
  readonly languageId?: string;
  readonly selection?: { readonly startLine: number; readonly endLine: number };
  readonly branch?: string;
  readonly statusEntries?: number;
}

export interface ContextChangesState {
  readonly branch?: string;
  readonly status?: string;
  readonly diff?: string;
}

export interface ContextDiagnostic {
  readonly path: string;
  readonly code?: string | number;
  readonly message: string;
  readonly source?: string;
  readonly severity?: string;
  readonly startLine?: number;
  readonly startColumn?: number;
  readonly endLine?: number;
  readonly endColumn?: number;
  readonly command?: string;
  readonly outcome?: string;
}

export interface ContextLogEntry {
  readonly message: string;
  readonly code?: string | number;
  readonly path?: string;
  readonly severity?: string;
  readonly startLine?: number;
  readonly startColumn?: number;
  readonly command?: string;
  readonly outcome?: string;
}

export interface ContextCompressionEvidence {
  readonly label: string;
  readonly path?: string;
  readonly startLine?: number;
  readonly endLine?: number;
}

export interface ContextCompressionMetadata {
  readonly type:
    | "source-code"
    | "intelligence"
    | "conversation-history"
    | "diff"
    | "diagnostics"
    | "documentation"
    | "structured-data";
  readonly strategy: string;
  readonly deterministic: boolean;
  readonly derived: boolean;
  readonly originalBytes: number;
  readonly compressedBytes: number;
  readonly originalHash: string;
  readonly evidence: readonly ContextCompressionEvidence[];
  readonly preserved: readonly string[];
}

export interface ContextUserContext {
  readonly label: string;
  readonly content: string;
  readonly path?: string;
  readonly source?: string;
}

export interface ContextEngineLogEvent {
  readonly phase: "request" | "candidates-collected" | "package-created" | "expanded";
  readonly message: string;
}

export type ContextEngineLogger = (event: ContextEngineLogEvent) => void;

export interface ContextPreparation {
  readonly contextPack: ContextPack;
  readonly contextPackage: ContextPackage;
}

const PACKAGE_DIRECTORY = ".keystone/context/packages";

/**
 * Orchestrates context preparation over Keystone's existing repository retrieval and
 * ContextPack builder. It does not reason autonomously or call a model.
 */
export class ContextEngine {
  private readonly packages = new Map<string, ContextPackage>();
  private readonly reservoir: ContextReservoir;

  constructor(
    private readonly workspaceRoot: string,
    private readonly logger?: ContextEngineLogger
  ) {
    this.reservoir = new ContextReservoir(workspaceRoot);
  }

  async prepareContext(request: ContextPreparationRequest): Promise<ContextPreparation> {
    this.log(
      "request",
      `Context request intent=${request.intent.id} operation=${request.operation} tokenBudget=${request.tokenBudget}.`
    );
    const contextPack = await buildIntentContextPack(
      request.intent,
      request.intelligence,
      request.routeDecision,
      [...request.skills],
      {
        ...request.buildOptions,
        // Collection is intentionally wider than transmission. The final
        // planner below owns the request budget and must see enough candidates
        // to make a relevance-based choice at every budget size.
        delegationTokenBudget: Math.max(24_000, request.tokenBudget)
      }
    );
    const candidates = await collectCandidates(
      request,
      contextPack,
      sourceRevisionFor(request, contextPack)
    );
    const contextPackage = this.createPackage(request, contextPack, candidates);
    const finalContextPack = applyPackageToContextPack(contextPack, contextPackage);
    this.packages.set(contextPackage.id, contextPackage);
    await this.reservoir.save(contextPackage.id, request.intent.id, candidates);
    await this.packageStorage(contextPackage.id).write(contextPackage);
    this.log(
      "candidates-collected",
      `Collected ${contextPackage.allCandidateCount} context candidate(s); ${contextPackage.selectedContext.length} relevant and ${contextPackage.retainedContext.length} retained.`
    );
    this.log(
      "package-created",
      `Context package ${contextPackage.id} created with ${contextPackage.estimatedTransmittedTokens} estimated transmitted token(s).`
    );
    return { contextPack: finalContextPack, contextPackage };
  }

  async expandContext(input: {
    /** Package id, or a stable reservoir reference in the form package#candidate. */
    contextId?: string;
    contextReference?: string;
    focus: string;
    level: ContextExpansionLevel;
  }): Promise<ContextFragment> {
    const reference = input.contextReference ?? input.contextId;
    if (!reference) throw new Error("A context reference is required for expansion.");
    const parsed = parseContextReference(reference);
    const packageValue = await this.loadPackage(parsed.contextId);
    if (!packageValue) throw new Error(`Context package ${parsed.contextId} is not available.`);
    const reservoir = await this.reservoir.read(parsed.contextId);
    const reservoirCandidates = reservoir
      ? reservoir.entries.map((entry) =>
          entry.compressedContent
            ? { ...entry.candidate, content: entry.compressedContent }
            : entry.candidate
        )
      : packageValue.retainedContext;
    const hydratedReservoirCandidates = reservoirCandidates.map(hydrateCandidate);
    const candidatesById = new Map(
      [
        ...packageValue.selectedContext.map(hydrateCandidate),
        ...packageValue.retainedContext.map(hydrateCandidate),
        ...hydratedReservoirCandidates
      ].map((candidate) => [candidate.id, candidate])
    );
    const reservoirCandidatesForExpansion = hydratedReservoirCandidates.filter((candidate) =>
      packageValue.knownContext.candidateIds.includes(candidate.id)
    );
    const scoped = parsed.candidateId
      ? [candidatesById.get(parsed.candidateId)].filter(
          (candidate): candidate is ContextCandidate => Boolean(candidate)
        )
      : reservoirCandidatesForExpansion;
    const terms = new Set(
      input.focus
        .toLowerCase()
        .match(/[a-z0-9_./-]+/g)
        ?.filter((term) => term.length > 1) ?? []
    );
    const focused = scoped
      .filter((candidate) => !terms.size || matchesFocus(candidate, terms))
      .sort((left, right) => scoreFocus(right, terms) - scoreFocus(left, terms))
      .slice(0, expansionLimit(input.level));
    const expanded = await Promise.all(
      focused.map((candidate) => this.expandCandidate(candidate, input.level, input.focus))
    );
    const materialized = expanded.map((result) => result.candidate);
    const staleSources = expanded.flatMap((result) => (result.stale ? [result.stale] : []));
    const content = materialized
      .map((candidate) => formatCandidate(candidate, input.level))
      .join("\n\n");
    const fragment: ContextFragment = Object.freeze({
      contextId: packageValue.id,
      reference,
      focus: input.focus,
      level: input.level,
      candidates: Object.freeze(materialized),
      estimatedTokens: estimateTokens(content),
      content,
      stale: staleSources.length > 0,
      staleSources: Object.freeze(staleSources)
    });
    this.log(
      "expanded",
      `Expanded context package ${packageValue.id} reference=${reference} level=${input.level} focus=${input.focus || "all retained context"} with ${materialized.length} candidate(s).`
    );
    return fragment;
  }

  /** Returns the exact package captured for a delegation, including its retained reservoir. */
  async getContextPackage(contextId: string): Promise<ContextPackage | undefined> {
    return this.loadPackage(contextId.split(":packet:")[0]);
  }

  /** Delegation is fail-closed when any transmitted source has changed since capture. */
  async getFreshDelegationPrompt(contextId: string): Promise<string> {
    const contextPackage = await this.getContextPackage(contextId);
    if (!contextPackage) throw new Error(`Context package ${contextId} is not available.`);
    const stale = await this.getContextStaleSources(contextPackage.id);
    if (stale.length) {
      throw new Error(
        `Context package ${contextPackage.id} is stale for ${stale.map((item) => item.path).join(", ")}. Regenerate the intent context before delegating.`
      );
    }
    return contextPackage.content;
  }

  async getContextStaleSources(contextId: string): Promise<ContextStaleSource[]> {
    const contextPackage = await this.getContextPackage(contextId);
    if (!contextPackage) throw new Error(`Context package ${contextId} is not available.`);
    return staleSourcesForCandidates(this.workspaceRoot, contextPackage.transmittedContext);
  }

  summarize(contextPackage: ContextPackage): ContextPackageSummary {
    return summarizeContextPackage(contextPackage);
  }

  private createPackage(
    request: ContextPreparationRequest,
    contextPack: ContextPack,
    candidates: readonly ContextCandidate[]
  ): ContextPackage {
    const sourceRevision = makeRevision(
      request.sourceRevision ??
        contextPack.contextManifest?.snapshotDigest ??
        request.intelligence.indexedAt,
      contextPack.contextManifest?.snapshotDigest ? "okf" : "intelligence"
    );
    const assembly = assemblePackage(
      request,
      contextPack,
      candidates.map(freezeCandidate),
      sourceRevision
    );
    return Object.freeze({
      id: contextPack.id,
      intent: Object.freeze({ ...request.intent }),
      objective: request.objective,
      operation: request.operation,
      tokenBudget: request.tokenBudget,
      estimatedTransmittedTokens: assembly.estimatedTransmittedTokens,
      knownContext: Object.freeze({
        candidateCount: candidates.length,
        candidateIds: Object.freeze(candidates.map((candidate) => candidate.id))
      }),
      selectedContext: Object.freeze(assembly.selectedContext),
      transmittedContext: Object.freeze(assembly.transmittedContext),
      retainedContext: Object.freeze(assembly.retainedContext),
      omittedContext: Object.freeze(
        assembly.omittedContext.map((reference) => Object.freeze(reference))
      ),
      excludedContext: Object.freeze(
        assembly.excludedContext.map((reference) => Object.freeze(reference))
      ),
      sourceRevision: Object.freeze(sourceRevision),
      evidence: Object.freeze(assembly.evidence),
      allCandidateCount: candidates.length,
      createdAt: new Date().toISOString(),
      contextPackId: contextPack.id,
      sections: Object.freeze(assembly.sections),
      content: assembly.content,
      metadata: Object.freeze(assembly.metadata)
    });
  }

  private async loadPackage(contextId: string): Promise<ContextPackage | undefined> {
    const packageId = contextId.split(":packet:")[0];
    const inMemory = this.packages.get(packageId);
    if (inMemory) return inMemory;
    const value = await this.packageStorage(packageId).read();
    if (value) this.packages.set(packageId, value);
    return value;
  }

  private async expandCandidate(
    candidate: ContextCandidate,
    level: ContextExpansionLevel,
    focus: string
  ): Promise<{ candidate: ContextCandidate; stale?: ContextStaleSource }> {
    const normalized = normalizeExpansionLevel(level);
    const pathValue = candidate.provenance.authoritativePath ?? candidate.payload.path;
    if (typeof pathValue !== "string") return { candidate: trimCandidate(candidate, normalized) };

    const source = await readAuthoritativeSource(this.workspaceRoot, pathValue);
    const content = source.content;
    const currentHash = content !== undefined ? hashContent(content) : undefined;
    const expectedHash = candidate.provenance.sourceHash;
    const stale = Boolean(expectedHash && (!source.exists || currentHash !== expectedHash));
    const staleSource = stale
      ? {
          path: pathValue,
          expectedHash,
          currentHash,
          message: source.exists
            ? "The authoritative source changed after this context was captured. Review the current source before relying on this expansion."
            : "The authoritative source is no longer available. The captured context is stale and cannot be treated as current."
        }
      : undefined;
    const withStatus: ContextCandidate = stale
      ? { ...candidate, stale: true, currentSourceHash: currentHash }
      : candidate;

    if (normalized < 3)
      return { candidate: trimCandidate(withStatus, normalized), stale: staleSource };
    if (content === undefined) return { candidate: withStatus, stale: staleSource };
    const excerpt = normalized === 4 ? content : targetedExcerpt(content, withStatus, focus);
    return {
      candidate: trimCandidate({ ...withStatus, content: excerpt }, normalized),
      stale: staleSource
    };
  }

  private packageStorage(id: string): JsonStorage<ContextPackage | undefined> {
    return new JsonStorage<ContextPackage | undefined>(
      this.workspaceRoot,
      `${PACKAGE_DIRECTORY}/${safeId(id)}.json`,
      undefined
    );
  }

  private log(phase: ContextEngineLogEvent["phase"], message: string): void {
    this.logger?.({ phase, message });
  }
}

interface PackageAssembly {
  readonly selectedContext: ContextCandidate[];
  readonly transmittedContext: ContextCandidate[];
  readonly retainedContext: ContextCandidate[];
  readonly omittedContext: ContextReference[];
  readonly excludedContext: ContextReference[];
  readonly evidence: ContextEvidenceReference[];
  readonly sections: ContextPackageSection[];
  readonly content: string;
  readonly estimatedTransmittedTokens: number;
  readonly metadata: ContextPackageMetadata;
}

/**
 * Selects and renders the final package. Priority is the first ordering key;
 * relevance density is only used to order candidates within a priority band.
 * Source-family caps are a guardrail for noisy material, not the allocation
 * algorithm: every candidate competes on useful information per token first.
 */
function assemblePackage(
  request: ContextPreparationRequest,
  contextPack: ContextPack,
  candidates: readonly ContextCandidate[],
  sourceRevision: ContextSourceRevision
): PackageAssembly {
  const capability = request.contextCapability;
  const budget = Math.max(
    1,
    Math.min(
      request.tokenBudget,
      request.contextCapability?.contextWindowTokens ?? Number.MAX_SAFE_INTEGER
    )
  );
  // The planner must see reference-only candidates too. Relevance and budget
  // decide whether they are transmitted; collection-time file selection must
  // not silently turn a retrievable candidate into an unavailable one.
  const relevant = candidates.filter((candidate) => priorityBand(candidate) !== "P4");
  const bands = new Map<ContextCandidate, ContextPriorityBand>(
    relevant.map((candidate) => [candidate, priorityBand(candidate)])
  );
  const referencesFor = (values: readonly ContextCandidate[]): ContextReference[] =>
    values.map((candidate) => contextReferenceFor(candidate, contextPack.id));

  const p3Candidates = relevant.filter((candidate) => bands.get(candidate) === "P3");
  const p3References = referencesFor(p3Candidates).slice(0, 48);
  const p0Candidates = orderedCandidates(
    relevant.filter((candidate) => bands.get(candidate) === "P0")
  );
  const transmitted: ContextCandidate[] = [];
  const decisions = new Map<string, ContextCompressionDecision>();

  // P0 is materialized first and is never traded for supporting context. A
  // compact fact projection is used if several critical requirements are
  // present, keeping each requirement visible at small but usable budgets.
  for (const candidate of p0Candidates) {
    const perCriticalBudget = Math.max(
      6,
      Math.floor(budget / Math.max(1, p0Candidates.length * 3))
    );
    const materialized = materializeCandidate(
      candidate,
      candidate.content && estimateTokens(candidate.content, capability) <= perCriticalBudget
        ? perCriticalBudget
        : perCriticalBudget,
      capability,
      true
    );
    transmitted.push(materialized);
    decisions.set(
      candidate.id,
      compressionDecision(
        candidate,
        materialized,
        bands.get(candidate)!,
        "P0 is mandatory.",
        capability
      )
    );
  }

  const noisyFamilies = new Set(["source", "documentation", "diagnostics"]);
  const familyUsage = new Map<string, number>();
  for (const candidate of transmitted)
    familyUsage.set(
      candidateFamily(candidate),
      (familyUsage.get(candidateFamily(candidate)) ?? 0) + transmittedCost(candidate, capability)
    );
  const noisyFamilyCap = Math.max(120, Math.floor(budget * 0.45));
  const supporting = orderedCandidates(
    relevant.filter((candidate) => bands.get(candidate) === "P1" || bands.get(candidate) === "P2")
  );

  for (const candidate of supporting) {
    const family = candidateFamily(candidate);
    const familyLimit = noisyFamilies.has(family) ? noisyFamilyCap : Number.MAX_SAFE_INTEGER;
    const familyRemaining = Math.max(0, familyLimit - (familyUsage.get(family) ?? 0));
    const withoutCandidate = renderSemanticSections(transmitted, p3References, capability).content;
    const remaining = Math.max(0, budget - estimateTokens(withoutCandidate, capability));
    const target = Math.min(remaining, familyRemaining);
    if (target < 12) {
      decisions.set(
        candidate.id,
        omittedDecision(
          candidate,
          bands.get(candidate)!,
          "Budget or noisy-source guardrail.",
          capability
        )
      );
      continue;
    }
    const materialized = materializeCandidate(candidate, target, capability, false);
    const trial = [...transmitted, materialized];
    const trialContent = renderSemanticSections(trial, p3References, capability).content;
    const trialTokens = estimateTokens(trialContent, capability);
    if (trialTokens <= budget && transmittedCost(materialized, capability) <= familyRemaining) {
      transmitted.push(materialized);
      familyUsage.set(
        family,
        (familyUsage.get(family) ?? 0) + transmittedCost(materialized, capability)
      );
      decisions.set(
        candidate.id,
        compressionDecision(
          candidate,
          materialized,
          bands.get(candidate)!,
          "Selected by priority and relevance density.",
          capability
        )
      );
    } else {
      decisions.set(
        candidate.id,
        omittedDecision(
          candidate,
          bands.get(candidate)!,
          "Supporting context did not fit after mandatory context and expansions.",
          capability
        )
      );
    }
  }

  const selectedContext = relevant.map(freezeCandidate);
  const transmittedContext = transmitted.map(freezeCandidate);
  const retainedContext = relevant.filter(
    (candidate) => !transmitted.some((item) => item.id === candidate.id)
  );
  const omittedContext = retainedContext.map((candidate) =>
    contextReferenceFor(candidate, contextPack.id)
  );
  const p4 = candidates.filter((candidate) => !relevant.some((item) => item.id === candidate.id));
  for (const candidate of p4)
    decisions.set(
      candidate.id,
      omittedDecision(candidate, "P4", "Excluded low-value context.", capability)
    );

  for (const candidate of retainedContext) {
    if (!decisions.has(candidate.id)) {
      decisions.set(candidate.id, {
        candidateId: candidate.id,
        priority: bands.get(candidate) ?? "P3",
        action: "reference-only",
        reason: "Retained for explicit context expansion.",
        originalTokens: originalCandidateTokens(candidate, capability),
        transmittedTokens: 0
      });
    }
  }
  const expansionReferences = fitExpansionReferences(
    transmitted,
    referencesFor(retainedContext),
    budget,
    capability
  );
  const rendered = ensureExpansionSection(
    renderSemanticSections(transmitted, expansionReferences, capability),
    retainedContext,
    referencesFor(retainedContext),
    budget,
    capability
  );
  const evidence = dedupeEvidence(transmitted.flatMap((candidate) => candidate.evidence));
  const metadata: ContextPackageMetadata = {
    estimatedOriginalCandidateTokens: candidates.reduce(
      (sum, candidate) => sum + originalCandidateTokens(candidate, capability),
      0
    ),
    estimatedTransmittedTokens: estimateTokens(rendered.content, capability),
    estimatedOmittedRetrievableTokens: retainedContext.reduce(
      (sum, candidate) => sum + candidate.estimatedTokenCost,
      0
    ),
    selectedContextIds: Object.freeze(transmitted.map((candidate) => candidate.id)),
    evidenceReferences: Object.freeze(evidence),
    sourceRevision: Object.freeze(sourceRevision),
    compressionDecisions: Object.freeze(
      candidates.map(
        (candidate) =>
          decisions.get(candidate.id) ??
          omittedDecision(
            candidate,
            priorityBand(candidate),
            "Not selected for this operation.",
            capability
          )
      )
    ),
    estimator: capability?.charactersPerToken ? "capability-adjusted" : "character-four",
    ...(capability?.model ? { model: capability.model } : {}),
    ...(capability?.contextWindowTokens
      ? { contextWindowTokens: capability.contextWindowTokens }
      : {})
  };
  return {
    selectedContext,
    transmittedContext,
    retainedContext: retainedContext.map(freezeCandidate),
    omittedContext,
    excludedContext: p4.map((candidate) =>
      contextReferenceFor(candidate, contextPack.id, "Unrelated to the current operation.")
    ),
    evidence,
    sections: rendered.sections,
    content: rendered.content,
    estimatedTransmittedTokens: metadata.estimatedTransmittedTokens,
    metadata
  };
}

function priorityBand(candidate: ContextCandidate): ContextPriorityBand {
  const label = String(candidate.payload.label ?? "").toLowerCase();
  if (candidate.category === "history") return "P4";
  if (candidate.category === "intent")
    return label.includes("open question") ? "P2" : label.includes("blocker") ? "P1" : "P0";
  if (candidate.category === "decisions") return label.includes("risk") ? "P1" : "P0";
  if (candidate.category === "changes" || candidate.category === "diagnostics") return "P1";
  if (candidate.sourceType === "bounded-intelligence" || candidate.sourceType === "repository-file")
    return candidate.relevance >= 0.45 ? "P1" : "P2";
  if (
    candidate.sourceType === "intelligence-relationship" ||
    candidate.sourceType === "intelligence-flow"
  )
    return candidate.relevance >= 0.55 ? "P1" : "P2";
  if (candidate.relevance < 0.3) return "P3";
  return "P2";
}

function fitExpansionReferences(
  transmitted: readonly ContextCandidate[],
  references: readonly ContextReference[],
  budget: number,
  capability?: ContextCapability
): ContextReference[] {
  const fitted: ContextReference[] = [];
  for (const reference of references.slice(0, 48)) {
    const content = renderSemanticSections(transmitted, [...fitted, reference], capability).content;
    if (estimateTokens(content, capability) <= budget) fitted.push(reference);
  }
  return fitted;
}

function ensureExpansionSection(
  rendered: { sections: ContextPackageSection[]; content: string },
  retained: readonly ContextCandidate[],
  references: readonly ContextReference[],
  budget: number,
  capability?: ContextCapability
): { sections: ContextPackageSection[]; content: string } {
  if (
    !retained.length ||
    rendered.sections.some((section) => section.name === "AVAILABLE CONTEXT EXPANSIONS")
  )
    return rendered;
  const section: ContextPackageSection = {
    name: "AVAILABLE CONTEXT EXPANSIONS",
    content: `- ${retained.length} expandable context candidate(s) retained; use the stable references below to retrieve them.`,
    estimatedTokens: estimateTokens(
      `- ${retained.length} expandable context candidate(s) retained; use the stable references below to retrieve them.`,
      capability
    ),
    candidateIds: Object.freeze([]),
    references: Object.freeze(references.slice(0, 8))
  };
  const sections = [...rendered.sections, section];
  const content = sections.map((item) => `## ${item.name}\n${item.content}`).join("\n\n");
  return estimateTokens(content, capability) <= budget ? { sections, content } : rendered;
}

function orderedCandidates(candidates: readonly ContextCandidate[]): ContextCandidate[] {
  return [...candidates].sort(
    (left, right) =>
      right.relevance / Math.max(1, right.estimatedTokenCost) -
        left.relevance / Math.max(1, left.estimatedTokenCost) ||
      right.relevance - left.relevance ||
      right.priority - left.priority ||
      left.id.localeCompare(right.id)
  );
}

function candidateFamily(candidate: ContextCandidate): string {
  if (candidate.category === "diagnostics" || candidate.sourceType === "diagnostic")
    return "diagnostics";
  if (
    candidate.compression?.type === "documentation" ||
    (candidate.sourceType === "user-context" &&
      typeof candidate.payload.path === "string" &&
      /\.(?:md|mdx|rst|txt)$/i.test(candidate.payload.path))
  )
    return "documentation";
  if (candidate.sourceType === "repository-file") return "source";
  return candidate.category;
}

function materializeCandidate(
  candidate: ContextCandidate,
  tokenLimit: number,
  capability: ContextCapability | undefined,
  critical: boolean
): ContextCandidate {
  const source = candidate.content ?? compactFact(candidate);
  const compact = critical ? compactFact(candidate) : source;
  const content = compressCandidateContent(candidate, compact, Math.max(4, tokenLimit), capability);
  return {
    ...candidate,
    content,
    estimatedTokenCost: estimateTokens(content, capability)
  };
}

function compressCandidateContent(
  candidate: ContextCandidate,
  content: string,
  tokenLimit: number,
  capability: ContextCapability | undefined
): string {
  if (estimateTokens(content, capability) <= tokenLimit) return content;
  if (candidate.sourceType === "repository-file") {
    const projected = compressSourceCode(content, {
      tokenBudget: tokenLimit,
      query: String(candidate.payload.label ?? "")
    }).content;
    return estimateTokens(projected, capability) <= tokenLimit
      ? projected
      : truncateToTokens(projected, tokenLimit, capability);
  }
  if (candidateFamily(candidate) === "documentation") {
    const projected = compressDocumentation(content, tokenLimit).content;
    return estimateTokens(projected, capability) <= tokenLimit
      ? projected
      : truncateToTokens(projected, tokenLimit, capability);
  }
  if (candidate.category === "diagnostics")
    return truncateToTokens(content, tokenLimit, capability);
  return truncateToTokens(content, tokenLimit, capability);
}

function truncateToTokens(
  value: string,
  tokenLimit: number,
  capability?: ContextCapability
): string {
  if (estimateTokens(value, capability) <= tokenLimit) return value;
  const characterLimit = Math.max(
    8,
    Math.floor(tokenLimit * (capability?.charactersPerToken ?? 4))
  );
  const suffix = tokenLimit >= 12 ? "\n… context compressed …" : "";
  return `${value.slice(0, characterLimit).trim()}${suffix}`;
}

function transmittedCost(candidate: ContextCandidate, capability?: ContextCapability): number {
  return estimateTokens(candidate.content ?? compactFact(candidate), capability);
}

function originalCandidateTokens(
  candidate: ContextCandidate,
  capability?: ContextCapability
): number {
  if (candidate.compression?.originalBytes)
    return Math.max(
      candidate.estimatedTokenCost,
      Math.ceil(candidate.compression.originalBytes / (capability?.charactersPerToken ?? 4))
    );
  return candidate.estimatedTokenCost;
}

function compressionDecision(
  original: ContextCandidate,
  transmitted: ContextCandidate,
  priority: ContextPriorityBand,
  reason: string,
  capability?: ContextCapability
): ContextCompressionDecision {
  const compressed = transmitted.content !== original.content || Boolean(original.compression);
  return {
    candidateId: original.id,
    priority,
    action: compressed ? "compressed" : "full",
    reason,
    originalTokens: originalCandidateTokens(original, capability),
    transmittedTokens: estimateTokens(transmitted.content ?? "", capability),
    ...(compressed
      ? { strategy: transmitted.compression?.strategy ?? "bounded candidate projection" }
      : {})
  };
}

function omittedDecision(
  candidate: ContextCandidate,
  priority: ContextPriorityBand,
  reason: string,
  capability?: ContextCapability
): ContextCompressionDecision {
  return {
    candidateId: candidate.id,
    priority,
    action: priority === "P3" ? "reference-only" : "omitted",
    reason,
    originalTokens: originalCandidateTokens(candidate, capability),
    transmittedTokens: 0
  };
}

function contextReferenceFor(
  candidate: ContextCandidate,
  contextId: string,
  reasonOverride?: string
): ContextReference {
  const pathValue = candidate.payload.path ? String(candidate.payload.path) : undefined;
  return {
    candidateId: candidate.id,
    sourceType: candidate.sourceType,
    label: pathValue ?? String(candidate.payload.label ?? candidate.id),
    ...(pathValue ? { path: pathValue } : {}),
    reason:
      reasonOverride ??
      (priorityBand(candidate) === "P3"
        ? "Expandable supporting context retained outside the transmission budget."
        : "Relevant context retained for later retrieval after budget selection."),
    estimatedTokenCost: candidate.estimatedTokenCost,
    sourceRevision: candidate.sourceRevision,
    contextId,
    provenance: candidate.provenance,
    ...(candidate.stale ? { stale: true } : {})
  };
}

function renderSemanticSections(
  transmitted: readonly ContextCandidate[],
  expansionReferences: readonly ContextReference[],
  capability?: ContextCapability
): { sections: ContextPackageSection[]; content: string } {
  const order: ContextPackageSectionName[] = [
    "INTENT",
    "CURRENT OBJECTIVE",
    "CONSTRAINTS",
    "ACCEPTED DECISIONS",
    "RELEVANT REPOSITORY FACTS",
    "EXISTING PATTERNS",
    "ACTIVE CHANGES",
    "DIAGNOSTICS",
    "KNOWN RISKS",
    "AVAILABLE CONTEXT EXPANSIONS"
  ];
  const grouped = new Map<ContextPackageSectionName, ContextCandidate[]>();
  for (const candidate of transmitted) {
    const section = sectionForCandidate(candidate);
    const values = grouped.get(section) ?? [];
    values.push(candidate);
    grouped.set(section, values);
  }
  const sections: ContextPackageSection[] = [];
  for (const name of order) {
    const values = grouped.get(name) ?? [];
    const references = name === "AVAILABLE CONTEXT EXPANSIONS" ? expansionReferences : [];
    if (!values.length && !references.length) continue;
    const body = [
      ...values.map((candidate) => formatSemanticCandidate(candidate)),
      ...references.map((reference) => formatExpansionReference(reference))
    ].join("\n\n");
    sections.push({
      name,
      content: body,
      estimatedTokens: estimateTokens(body, capability),
      candidateIds: Object.freeze(values.map((candidate) => candidate.id)),
      references: Object.freeze(references)
    });
  }
  const content = sections.map((section) => `## ${section.name}\n${section.content}`).join("\n\n");
  return { sections, content };
}

function sectionForCandidate(candidate: ContextCandidate): ContextPackageSectionName {
  const label = String(candidate.payload.label ?? "").toLowerCase();
  const kind = String(candidate.payload.kind ?? "").toLowerCase();
  if (
    candidate.category === "intent" &&
    (kind.includes("objective") || label.includes("objective"))
  )
    return "CURRENT OBJECTIVE";
  if (
    candidate.category === "intent" &&
    (kind.includes("requirement") || kind.includes("constraint"))
  )
    return "CONSTRAINTS";
  if (candidate.category === "intent") return "INTENT";
  if (candidate.category === "decisions" && label.includes("risk")) return "KNOWN RISKS";
  if (candidate.category === "decisions") return "ACCEPTED DECISIONS";
  if (candidate.category === "changes") return "ACTIVE CHANGES";
  if (candidate.category === "diagnostics") return "DIAGNOSTICS";
  if (
    candidate.sourceType === "intelligence-relationship" ||
    candidate.sourceType === "intelligence-flow" ||
    candidate.sourceType === "symbol" ||
    candidate.sourceType === "api" ||
    candidate.sourceType === "service" ||
    candidate.sourceType === "test"
  )
    return "EXISTING PATTERNS";
  if (candidate.category === "workspace" && candidate.sourceType !== "workspace")
    return "CONSTRAINTS";
  return "RELEVANT REPOSITORY FACTS";
}

function formatSemanticCandidate(candidate: ContextCandidate): string {
  const kind = String(candidate.payload.kind ?? "").toLowerCase();
  const label = kind.includes("requirement")
    ? "Requirement"
    : kind.includes("objective")
      ? "Current objective"
      : kind.includes("accepted decision")
        ? "Accepted decision"
        : kind.includes("known risk")
          ? "Known risk"
          : String(candidate.payload.label ?? candidate.payload.path ?? candidate.id);
  const source = candidate.provenance.authoritativePath
    ? ` [${candidate.provenance.authoritativePath}]`
    : "";
  return `${label}${source}\n${candidate.content ?? compactFact(candidate)}`;
}

function formatExpansionReference(reference: ContextReference): string {
  // The rich label/path remains in the structured reference. The transmitted
  // form is intentionally just the stable handle so even a very small budget
  // can keep at least one expansion discoverable.
  return `- ${reference.contextId ?? "context"}#${reference.candidateId}`;
}

function applyPackageToContextPack(
  contextPack: ContextPack,
  contextPackage: ContextPackage
): ContextPack {
  const selectedSections = contextPackage.transmittedContext
    .filter((candidate) => candidate.sourceType === "repository-file" && candidate.content)
    .map((candidate) => ({
      path: String(candidate.payload.path ?? candidate.id),
      reason: "Final budget-aware context selection",
      content: candidate.content!,
      estimatedTokens: estimateTokens(candidate.content!),
      sourceHash: candidate.provenance.sourceHash,
      score: candidate.relevance,
      evidence: candidate.evidence.map((reference) => ({
        kind: reference.kind,
        label: reference.label,
        startLine: reference.startLine,
        endLine: reference.endLine
      }))
    }));
  const packet = {
    id: `${contextPackage.id}:packet:1`,
    sequence: 1,
    total: 1,
    segmentKinds: ["summary"] as ["summary"],
    paths: selectedSections.map((section) => section.path),
    estimatedTokens: contextPackage.estimatedTransmittedTokens
  };
  const packetPayload = {
    ...packet,
    segments: [
      {
        kind: "summary" as const,
        content: contextPackage.content,
        estimatedTokens: contextPackage.estimatedTransmittedTokens
      }
    ],
    content: contextPackage.content
  };
  return {
    ...contextPack,
    copilotPrompt: contextPackage.content,
    estimatedPackedTokens: contextPackage.estimatedTransmittedTokens,
    selectedContextTokens: contextPackage.estimatedTransmittedTokens,
    estimatedReductionPercent: Math.max(
      0,
      Math.round(
        (1 -
          contextPackage.estimatedTransmittedTokens / Math.max(contextPack.estimatedRawTokens, 1)) *
          100
      )
    ),
    contextSections: selectedSections,
    contextPackets: [packet],
    contextPacketPayloads: [packetPayload],
    contextManifest: contextPack.contextManifest
      ? {
          ...contextPack.contextManifest,
          usedTokens: contextPackage.estimatedTransmittedTokens,
          selectedFiles: selectedSections.length,
          omittedFiles: contextPackage.retainedContext.filter(
            (candidate) => candidate.sourceType === "repository-file"
          ).length,
          packetCount: 1,
          packetIds: [packet.id]
        }
      : contextPack.contextManifest
  };
}

export function summarizeContextPackage(contextPackage: ContextPackage): ContextPackageSummary {
  const labels: Record<ContextSourceCategory, string> = {
    intent: "Intent",
    decisions: "Decisions",
    intelligence: "Intelligence",
    workspace: "Workspace",
    changes: "Changes",
    diagnostics: "Diagnostics",
    history: "History"
  };
  const sourceCounts = (Object.keys(labels) as ContextSourceCategory[]).map((category) => {
    const count = contextPackage.knownContext.candidateIds.filter((id) =>
      contextPackage.selectedContext.some(
        (candidate) => candidate.id === id && candidate.category === category
      )
    ).length;
    return {
      category,
      label: labels[category],
      count,
      included: count > 0
    } satisfies ContextSourceCount;
  });
  const decisionReasons = new Map(
    contextPackage.metadata.compressionDecisions.map((decision) => [
      decision.candidateId,
      userFacingContextReason(decision.reason)
    ])
  );
  const mustPreserve = contextPackage.transmittedContext.filter(
    (candidate) => candidate.category === "intent" || candidate.category === "decisions"
  );
  const included = contextPackage.transmittedContext.filter(
    (candidate) => candidate.category !== "intent" && candidate.category !== "decisions"
  );
  const inspector = {
    estimatedPreparedTokens: contextPackage.metadata.estimatedTransmittedTokens,
    estimatedAvoidedTokens: Math.max(
      0,
      contextPackage.metadata.estimatedOriginalCandidateTokens -
        contextPackage.metadata.estimatedTransmittedTokens
    ),
    mustPreserve: mustPreserve.map((candidate) =>
      summarizeCandidate(
        candidate,
        contextPackage.id,
        candidateReason(candidate, decisionReasons.get(candidate.id), "must-preserve")
      )
    ),
    included: included.map((candidate) =>
      summarizeCandidate(
        candidate,
        contextPackage.id,
        candidateReason(candidate, decisionReasons.get(candidate.id), "included")
      )
    ),
    availableOnDemand: contextPackage.retainedContext
      .filter((candidate) => candidate.expandable)
      .map((candidate) =>
        summarizeCandidate(
          candidate,
          contextPackage.id,
          candidateReason(candidate, decisionReasons.get(candidate.id), "available")
        )
      ),
    excluded: (contextPackage.excludedContext ?? []).map((reference) =>
      summarizeReference(reference, contextPackage.sourceRevision)
    )
  } satisfies ContextInspectorSummary;
  return {
    id: contextPackage.id,
    operation: contextPackage.operation,
    tokenBudget: contextPackage.tokenBudget,
    estimatedTransmittedTokens: contextPackage.estimatedTransmittedTokens,
    allCandidateCount: contextPackage.allCandidateCount,
    selectedCandidateCount: contextPackage.selectedContext.length,
    transmittedCandidateCount: contextPackage.transmittedContext.length,
    retainedCandidateCount: contextPackage.retainedContext.length,
    omittedContextCount: contextPackage.omittedContext.length,
    sourceRevision: contextPackage.sourceRevision.value,
    sourceCounts,
    candidates: contextPackage.selectedContext
      .slice(0, 32)
      .map((candidate) =>
        summarizeCandidate(
          candidate,
          contextPackage.id,
          candidateReason(candidate, decisionReasons.get(candidate.id), "included")
        )
      ),
    retainedCandidates: contextPackage.retainedContext
      .filter((candidate) => candidate.expandable)
      .slice(0, 48)
      .map((candidate) =>
        summarizeCandidate(
          candidate,
          contextPackage.id,
          candidateReason(candidate, decisionReasons.get(candidate.id), "available")
        )
      ),
    inspector
  };
}

function summarizeCandidate(
  candidate: ContextCandidate,
  contextId: string,
  reason: string
): ContextCandidateSummary {
  return {
    id: candidate.id,
    category: candidate.category,
    sourceType: candidate.sourceType,
    label: String(candidate.payload.label ?? candidate.payload.path ?? candidate.id),
    ...(typeof candidate.payload.path === "string" ? { path: candidate.payload.path } : {}),
    relevance: candidate.relevance,
    estimatedTokenCost: candidate.estimatedTokenCost,
    evidence: candidate.evidence.slice(0, 6),
    expandable: candidate.expandable,
    compressed: !candidate.content || candidate.content.length < candidate.estimatedTokenCost * 4,
    contextReference: `${contextId}#${candidate.id}`,
    provenance: candidate.provenance,
    reason
  };
}

function summarizeReference(
  reference: ContextReference,
  sourceRevision: ContextSourceRevision
): ContextCandidateSummary {
  return {
    id: reference.candidateId,
    category: categoryForSourceType(reference.sourceType),
    sourceType: reference.sourceType,
    label: reference.label,
    ...(reference.path ? { path: reference.path } : {}),
    relevance: 0,
    estimatedTokenCost: reference.estimatedTokenCost,
    evidence: [],
    expandable: false,
    compressed: false,
    contextReference: `${reference.contextId ?? ""}#${reference.candidateId}`,
    provenance: reference.provenance ?? {
      origin: "file",
      sourceRevision: sourceRevision.value,
      capturedAt: new Date(0).toISOString(),
      ranges: []
    },
    reason: userFacingContextReason(reference.reason)
  };
}

function categoryForSourceType(sourceType: ContextCandidateSourceType): ContextSourceCategory {
  if (sourceType === "intent") return "intent";
  if (sourceType === "decision") return "decisions";
  if (sourceType === "change") return "changes";
  if (sourceType === "diagnostic") return "diagnostics";
  if (sourceType === "history") return "history";
  if (sourceType === "workspace" || sourceType === "user-context") return "workspace";
  return "intelligence";
}

function candidateReason(
  candidate: ContextCandidate,
  decisionReason: string | undefined,
  group: "must-preserve" | "included" | "available"
): string {
  if (candidate.category === "intent") {
    const kind = String(candidate.payload.kind ?? "").toLowerCase();
    if (kind.includes("requirement") || kind.includes("constraint"))
      return "Explicit user constraint.";
    if (kind.includes("objective")) return "Current objective.";
    return "The active intent being worked on.";
  }
  if (candidate.category === "decisions") {
    const label = String(candidate.payload.label ?? "").toLowerCase();
    return label.includes("risk") ? "Known risk to keep visible." : "Accepted decision.";
  }
  if (group === "available") return "Retained for expansion.";
  if (candidate.sourceType === "repository-file" || candidate.category === "intelligence")
    return "Selected because it affects the current objective or shows an existing implementation pattern.";
  return decisionReason ?? "Selected because it affects the current objective.";
}

function userFacingContextReason(reason: string): string {
  const normalized = reason.toLowerCase();
  if (normalized.includes("retained")) return "Retained for expansion.";
  if (normalized.includes("duplicate")) return "Duplicate of an included fact.";
  if (normalized.includes("stale")) return "Stale source; kept out until reviewed.";
  if (normalized.includes("unrelated") || normalized.includes("low-value"))
    return "Unrelated to the current operation.";
  if (normalized.includes("fit") || normalized.includes("budget"))
    return "Relevant, but left available on demand to keep the prompt focused.";
  return "Selected because it affects the current objective.";
}

export function operationForIntentType(intentType: string): ContextOperation {
  switch (intentType) {
    case "feature":
    case "test":
      return "IMPLEMENT";
    case "bugfix":
      return "DEBUG";
    case "refactor":
    case "modernization":
      return "PLAN_CHANGE";
    case "security-review":
      return "SECURITY_ANALYSIS";
    case "performance-review":
      return "PERFORMANCE_ANALYSIS";
    case "pr-summary":
      return "REVIEW_CHANGE";
    case "qa-analysis":
      return "ANSWER_QUESTION";
    case "explain":
      return "EXPLAIN";
    default:
      return "UNDERSTAND_INTENT";
  }
}

async function collectCandidates(
  request: ContextPreparationRequest,
  contextPack: ContextPack,
  sourceRevision: ContextSourceRevision
): Promise<ContextCandidate[]> {
  const { intelligence } = request;
  const fileHashes = new Map(intelligence.files.map((file) => [file.path, file.contentHash]));
  const candidates = new Map<string, ContextCandidate>();
  const add = (candidate: ContextCandidate): void => {
    const enriched = enrichProvenance(candidate, fileHashes);
    const existing = candidates.get(enriched.id);
    if (!existing || enriched.content || enriched.relevance > existing.relevance)
      candidates.set(enriched.id, enriched);
  };
  const selectedSections = new Map(
    (contextPack.contextSections ?? []).map((section) => [section.path, section])
  );
  for (const candidate of intentCandidates(request, contextPack, sourceRevision)) add(candidate);
  for (const candidate of decisionCandidates(request, sourceRevision)) add(candidate);
  for (const candidate of durableIntentCandidates(request, sourceRevision)) add(candidate);
  for (const candidate of riskCandidates(request, sourceRevision)) add(candidate);
  for (const candidate of workspaceCandidates(request, sourceRevision)) add(candidate);
  for (const candidate of changeCandidates(request, sourceRevision)) add(candidate);
  for (const candidate of diagnosticCandidates(request, sourceRevision)) add(candidate);
  for (const candidate of userContextCandidates(request, contextPack, sourceRevision))
    add(candidate);
  const selectedPaths = new Set(contextPack.relevantFiles.map((file) => file.path));
  const selectedFiles = intelligence.files.filter((file) => selectedPaths.has(file.path));
  for (const file of selectedFiles) {
    const section = selectedSections.get(file.path);
    add(fileCandidate(file, sourceRevision, section));
  }
  // Keep a reference-only reservoir entry for budget-omitted files. This is
  // deliberately metadata plus provenance: the file itself remains owned by
  // the workspace and is read only when a user asks for L3/L4 expansion.
  const omittedPaths = new Set((contextPack.omittedContext ?? []).map((item) => item.path));
  for (const file of intelligence.files.filter((candidate) => omittedPaths.has(candidate.path))) {
    add(fileCandidate(file, sourceRevision));
  }
  for (const symbol of contextPack.relevantSymbols)
    add(symbolCandidate(symbol, sourceRevision, fileHashes.get(symbol.filePath)));
  for (const test of contextPack.relatedTests)
    add(testCandidate(test, sourceRevision, fileHashes.get(test.testFile)));
  for (const api of contextPack.relatedApis)
    add(apiCandidate(api, sourceRevision, fileHashes.get(api.filePath)));
  for (const service of contextPack.impactedServices)
    add(serviceCandidate(service, sourceRevision, fileHashes.get(service.filePath)));
  for (const candidate of intelligenceCandidates(request, contextPack, sourceRevision))
    add(candidate);
  if (contextPack.boundedIntelligence)
    add({
      id: stableId("bounded-intelligence", contextPack.id),
      category: "intelligence",
      sourceType: "bounded-intelligence",
      content: contextPack.boundedIntelligence,
      payload: { label: "Bounded OKF and graph intelligence" },
      priority: 1,
      relevance: 1,
      estimatedTokenCost: estimateTokens(contextPack.boundedIntelligence),
      sourceRevision,
      confidence: 1,
      evidence: [],
      provenance: makeProvenance("intelligence", undefined, undefined, sourceRevision.value, []),
      expandable: true
    });
  for (const candidate of await historyCandidates(request.intent.workspaceRoot, sourceRevision))
    add(candidate);
  const enriched = await Promise.all(
    [...candidates.values()].map(async (candidate) => {
      if (candidate.provenance.sourceHash || !candidate.provenance.authoritativePath)
        return candidate;
      const source = await readAuthoritativeSource(
        request.intent.workspaceRoot,
        candidate.provenance.authoritativePath
      );
      return source.content === undefined
        ? candidate
        : {
            ...candidate,
            provenance: {
              ...candidate.provenance,
              sourceHash: hashContent(source.content)
            }
          };
    })
  );
  return deduplicateCandidates(enriched);
}

function enrichProvenance(
  candidate: ContextCandidate,
  fileHashes: ReadonlyMap<string, string | undefined>
): ContextCandidate {
  const authoritativePath = candidate.provenance.authoritativePath;
  const sourceHash = authoritativePath ? fileHashes.get(authoritativePath) : undefined;
  if (!authoritativePath || candidate.provenance.sourceHash || !sourceHash) return candidate;
  return {
    ...candidate,
    provenance: { ...candidate.provenance, sourceHash }
  };
}

function intentCandidates(
  request: ContextPreparationRequest,
  contextPack: ContextPack,
  sourceRevision: ContextSourceRevision
): ContextCandidate[] {
  const result: ContextCandidate[] = [
    basicCandidate(
      "intent",
      "intent",
      request.intent.id,
      "Intent",
      request.intent.text,
      request.intent.text,
      sourceRevision,
      1,
      1
    ),
    basicCandidate(
      "intent",
      "objective",
      request.objective,
      "Objective",
      request.objective,
      request.objective,
      sourceRevision,
      0.98,
      0.98
    )
  ];
  const requirements = [
    ...contextPack.acceptanceCriteria,
    ...contextPack.architectureConstraints,
    ...contextPack.securityConstraints,
    ...contextPack.performanceConstraints,
    ...contextPack.modernizationConstraints,
    ...contextPack.thingsToAvoid,
    request.buildOptions?.codingStandards,
    request.buildOptions?.thingsToAvoid
  ].filter((value): value is string => Boolean(value?.trim()));
  requirements.forEach((content, index) =>
    result.push(
      basicCandidate(
        "intent",
        `requirement-${index}`,
        content,
        "Requirement",
        content,
        content,
        sourceRevision,
        0.9,
        0.85
      )
    )
  );
  return result;
}

function decisionCandidates(
  request: ContextPreparationRequest,
  sourceRevision: ContextSourceRevision
): ContextCandidate[] {
  return (request.decisions ?? [])
    .filter((decision) => decision.trim())
    .map((decision, index) =>
      basicCandidate(
        "decisions",
        `decision-${index}`,
        decision,
        "Accepted decision",
        decision,
        decision,
        sourceRevision,
        0.86,
        0.8
      )
    );
}

function durableIntentCandidates(
  request: ContextPreparationRequest,
  sourceRevision: ContextSourceRevision
): ContextCandidate[] {
  const state = request.intentState;
  if (!state) return [];
  const result: ContextCandidate[] = [];
  const addIntent = (seed: string, label: string, value: string, relevance: number): void => {
    if (!value.trim()) return;
    const candidate = basicCandidate(
      "intent",
      `durable-${seed}`,
      label,
      "intent",
      value,
      value,
      sourceRevision,
      1,
      relevance
    );
    result.push({
      ...candidate,
      payload: {
        ...candidate.payload,
        provenance: provenanceFor(state, label, value)
      }
    });
  };
  addIntent("objective", "Current objective", state.currentObjective, 1);
  for (const value of state.constraints)
    addIntent(`constraint-${value}`, "Intent constraint", value, 0.99);
  for (const decision of state.decisions.filter((item) => item.status === "ACCEPTED"))
    result.push({
      ...basicCandidate(
        "decisions",
        `accepted-${decision.id}`,
        "Accepted decision",
        "decision",
        `${decision.title}: ${decision.recommendation}`,
        `${decision.title}: ${decision.recommendation}${decision.reason ? ` (${decision.reason})` : ""}`,
        sourceRevision,
        1,
        1
      ),
      payload: {
        label: "Accepted decision",
        kind: "accepted decision",
        value: `${decision.title}: ${decision.recommendation}`,
        provenance: decision.provenance,
        decisionId: decision.id
      }
    });
  for (const value of state.scope.excluded)
    addIntent(`excluded-${value}`, "Scope exclusion", value, 0.98);
  for (const blocker of state.blockers.filter((item) => !item.resolvedAt))
    result.push({
      ...basicCandidate(
        "decisions",
        `blocker-${blocker.id}`,
        "Active Intent blocker",
        "decision",
        blocker.summary,
        blocker.summary,
        sourceRevision,
        0.95,
        0.95
      ),
      payload: {
        label: "Active Intent blocker",
        kind: "blocker",
        value: blocker.summary,
        provenance: blocker.provenance,
        blockerId: blocker.id
      }
    });
  return result;
}

function provenanceFor(state: IntentState, label: string, value: string): string {
  const record = [...state.provenance]
    .reverse()
    .find(
      (item) =>
        item.value === value &&
        (label.toLowerCase().includes(item.field.toLowerCase()) ||
          item.field === "currentObjective")
    );
  return record?.provenance ?? "derived-keystone-state";
}

function riskCandidates(
  request: ContextPreparationRequest,
  sourceRevision: ContextSourceRevision
): ContextCandidate[] {
  return request.routeDecision.risks
    .filter((risk) => risk.trim())
    .map((risk, index) =>
      basicCandidate(
        "decisions",
        `risk-${index}`,
        "Known risk",
        "Known risk",
        risk,
        risk,
        sourceRevision,
        0.78,
        0.78
      )
    );
}

function workspaceCandidates(
  request: ContextPreparationRequest,
  sourceRevision: ContextSourceRevision
): ContextCandidate[] {
  const workspace = request.workspace;
  if (!workspace) return [];
  const label = workspace.currentFile ? `Active file: ${workspace.currentFile}` : "Workspace state";
  const compact = compressStructuredData(workspace);
  return [
    basicCandidate(
      "workspace",
      "workspace-state",
      label,
      "Workspace state",
      compact.content,
      JSON.stringify(workspace),
      sourceRevision,
      0.78,
      0.65,
      workspace.currentFile,
      undefined,
      compact.metadata
    )
  ];
}

function changeCandidates(
  request: ContextPreparationRequest,
  sourceRevision: ContextSourceRevision
): ContextCandidate[] {
  const changes = request.changes;
  if (!changes) return [];
  const paths = parseChangedPaths(changes.status ?? "", changes.diff ?? "");
  if (!paths.length && !changes.branch) return [];
  const summary = {
    branch: changes.branch,
    changedPaths: paths,
    diffBytes: changes.diff ? Buffer.byteLength(changes.diff, "utf8") : 0,
    diffHash: changes.diff
      ? crypto.createHash("sha256").update(changes.diff).digest("hex")
      : undefined
  };
  const diffCompression = changes.diff ? compressDiff(changes.diff, 1_000) : undefined;
  const compactSummary = compressStructuredData(summary);
  return [
    basicCandidate(
      "changes",
      "workspace-changes",
      "Current workspace changes",
      "Workspace changes",
      diffCompression?.content ?? compactSummary.content,
      diffCompression?.content ?? compactSummary.content,
      sourceRevision,
      0.8,
      0.7,
      undefined,
      undefined,
      diffCompression?.metadata ?? compactSummary.metadata
    ),
    ...paths
      .slice(0, 24)
      .map((filePath) =>
        basicCandidate(
          "changes",
          `change-${filePath}`,
          filePath,
          "Changed file",
          undefined,
          compactSummary.content,
          sourceRevision,
          0.74,
          0.62,
          filePath,
          undefined,
          compactSummary.metadata
        )
      )
  ];
}

function diagnosticCandidates(
  request: ContextPreparationRequest,
  sourceRevision: ContextSourceRevision
): ContextCandidate[] {
  const entries = [...(request.diagnostics ?? []), ...(request.logs ?? [])];
  if (!entries.length) return [];
  const compact = compressDiagnostics(entries, 1_200);
  return [
    basicCandidate(
      "diagnostics",
      "diagnostics-and-logs",
      "Diagnostics and logs",
      "Diagnostic",
      compact.content,
      compact.content,
      sourceRevision,
      0.88,
      0.76,
      undefined,
      undefined,
      compact.metadata
    )
  ];
}

function userContextCandidates(
  request: ContextPreparationRequest,
  contextPack: ContextPack,
  sourceRevision: ContextSourceRevision
): ContextCandidate[] {
  const supplied = request.userContext ?? [];
  const skills = contextPack.repoSkills.flatMap((skill) =>
    skill.guidance.map((guidance) => ({ label: skill.name, content: guidance }))
  );
  return [...supplied, ...skills]
    .filter((value) => value.content.trim())
    .slice(0, 40)
    .map((value, index) => {
      const pathValue = "path" in value ? value.path : undefined;
      const isDocumentation = Boolean(
        pathValue &&
        /(?:^|\/)(?:docs?|documentation)(?:\/|$)|\.(?:md|mdx|rst|txt)$/i.test(pathValue)
      );
      const compact = isDocumentation
        ? compressDocumentation(value.content, 900)
        : compressStructuredData(value.content, 900);
      return basicCandidate(
        "workspace",
        `user-context-${index}`,
        value.label,
        isDocumentation ? "Documentation" : "Repository guidance",
        compact.content,
        JSON.stringify(value),
        sourceRevision,
        0.72,
        0.62,
        pathValue,
        undefined,
        compact.metadata
      );
    });
}

function intelligenceCandidates(
  request: ContextPreparationRequest,
  contextPack: ContextPack,
  sourceRevision: ContextSourceRevision
): ContextCandidate[] {
  const paths = new Set(contextPack.relevantFiles.map((file) => file.path));
  const fileHashes = new Map(
    request.intelligence.files.map((file) => [file.path, file.contentHash])
  );
  const canonical = request.buildOptions?.okfSnapshot
    ? selectCanonicalContext(
        request.buildOptions.okfSnapshot,
        `${request.intent.text}\n${request.objective}`,
        {
          preferredPaths: [...paths].slice(0, 24)
        }
      )
    : undefined;
  const result: ContextCandidate[] = [];
  for (const item of canonical?.query.items ?? []) {
    if (!item.path || !paths.has(item.path)) continue;
    result.push({
      id: stableId("intelligence-unit", item.id),
      category: "intelligence",
      sourceType: "intelligence-unit",
      payload: {
        label: item.label,
        path: item.path,
        entityId: item.id,
        kind: item.kind,
        summary: item.summary
      },
      priority: 0.76,
      relevance: 0.68,
      estimatedTokenCost: estimateTokens(item.summary ?? item.label),
      sourceRevision,
      confidence: item.score,
      evidence: [
        {
          kind: item.kind,
          label: item.label,
          path: item.path,
          entityId: item.id,
          evidenceId: item.id
        }
      ],
      provenance: makeProvenance(
        "intelligence",
        item.path,
        item.path ? fileHashes.get(item.path) : undefined,
        sourceRevision.value,
        [
          {
            kind: item.kind,
            label: item.label,
            path: item.path,
            ...(item.line !== undefined ? { startLine: item.line, endLine: item.line } : {}),
            entityId: item.id,
            evidenceId: item.id
          }
        ]
      ),
      expandable: true
    });
  }
  if (canonical) {
    const nodes = new Map(canonical.graph.nodes.map((node) => [node.id, node]));
    for (const edge of canonical.graph.edges) {
      const source = nodes.get(edge.sourceId);
      const target = nodes.get(edge.targetId);
      const edgePaths = [source?.path, target?.path].filter((value): value is string =>
        Boolean(value)
      );
      if (!edgePaths.some((value) => paths.has(value))) continue;
      const isFlow =
        canonical.graph.mode === "flows" || /flow|call|read|write|map/i.test(edge.kind);
      const sourcePath = source?.path && paths.has(source.path) ? source.path : undefined;
      const targetPath = target?.path && paths.has(target.path) ? target.path : undefined;
      const authoritativePath = sourcePath ?? targetPath;
      const authoritativeHash = authoritativePath ? fileHashes.get(authoritativePath) : undefined;
      const relationshipLabel = `${edge.kind}: ${source?.label ?? edge.sourceId} → ${target?.label ?? edge.targetId}`;
      const evidencePath = sourcePath ?? targetPath;
      const evidenceLine = source?.line ?? target?.line;
      const relationshipEvidence = edge.evidenceIds.map((evidenceId) => ({
        kind: isFlow ? "flow" : "relationship",
        label: relationshipLabel,
        ...(evidencePath
          ? {
              path: evidencePath,
              ...(evidenceLine !== undefined
                ? { startLine: evidenceLine, endLine: evidenceLine }
                : {})
            }
          : {}),
        relationshipId: edge.id,
        evidenceId
      }));
      result.push({
        id: stableId(isFlow ? "intelligence-flow" : "intelligence-relationship", edge.id),
        category: "intelligence",
        sourceType: isFlow ? "intelligence-flow" : "intelligence-relationship",
        payload: {
          label: relationshipLabel,
          kind: edge.kind,
          relationshipId: edge.id,
          sourceId: edge.sourceId,
          targetId: edge.targetId,
          sourceLabel: source?.label,
          targetLabel: target?.label,
          sourcePath: source?.path,
          targetPath: target?.path
        },
        priority: isFlow ? 0.74 : 0.7,
        relevance: isFlow ? 0.66 : 0.6,
        estimatedTokenCost: estimateTokens(JSON.stringify(edge)),
        sourceRevision,
        confidence: edge.confidence,
        evidence: relationshipEvidence,
        provenance: makeProvenance(
          "intelligence",
          authoritativePath,
          authoritativeHash,
          sourceRevision.value,
          relationshipEvidence
        ),
        expandable: true
      });
    }
  }
  const selectedPaths = new Set(paths);
  for (const relation of request.intelligence.semanticRelationships ?? []) {
    const relationPaths = [relation.sourcePath, relation.targetPath].filter(
      (value): value is string => Boolean(value)
    );
    if (!relationPaths.some((value) => selectedPaths.has(value))) continue;
    const relationshipId = stableId("relationship", JSON.stringify(relation));
    result.push({
      id: relationshipId,
      category: "intelligence",
      sourceType: "intelligence-relationship",
      payload: {
        label: relation.kind,
        relationshipId,
        sourcePath: relation.sourcePath,
        targetPath: relation.targetPath,
        summary: `${relation.sourceName} ${relation.kind} ${relation.targetName}`
      },
      priority: 0.68,
      relevance: 0.58,
      estimatedTokenCost: estimateTokens(JSON.stringify(relation)),
      sourceRevision,
      confidence: relation.confidence,
      evidence: [
        {
          kind: "relationship",
          label: relation.kind,
          ...(relation.sourcePath
            ? { path: relation.sourcePath }
            : relation.targetPath
              ? { path: relation.targetPath }
              : {}),
          relationshipId
        }
      ],
      provenance: makeProvenance(
        "intelligence",
        relation.sourcePath ?? relation.targetPath,
        (relation.sourcePath ?? relation.targetPath)
          ? fileHashes.get(relation.sourcePath ?? relation.targetPath!)
          : undefined,
        sourceRevision.value,
        [
          {
            kind: "relationship",
            label: relation.kind,
            ...(relation.sourcePath
              ? { path: relation.sourcePath }
              : relation.targetPath
                ? { path: relation.targetPath }
                : {}),
            relationshipId
          }
        ]
      ),
      expandable: true
    });
  }
  return result.slice(0, 80);
}

function basicCandidate(
  category: ContextSourceCategory,
  seed: string,
  label: string,
  sourceType: string,
  content: string | undefined,
  payloadText: string,
  sourceRevision: ContextSourceRevision,
  priority: number,
  relevance: number,
  pathValue?: string,
  diagnostic?: ContextDiagnostic,
  compression?: ContextCompressionMetadata
): ContextCandidate {
  const source =
    category === "intent"
      ? "intent"
      : category === "decisions"
        ? "decision"
        : category === "workspace"
          ? sourceType === "Repository guidance"
            ? "user-context"
            : "workspace"
          : category === "changes"
            ? "change"
            : category === "diagnostics"
              ? "diagnostic"
              : "history";
  const evidence: ContextEvidenceReference[] = [
    { kind: sourceType, label, ...(pathValue ? { path: pathValue } : {}) }
  ];
  if (diagnostic?.code !== undefined)
    evidence[0] = {
      ...evidence[0],
      id: String(diagnostic.code),
      startLine: diagnostic.startLine,
      endLine: diagnostic.endLine
    };
  return {
    id: stableId(source, seed),
    category,
    sourceType: source as ContextCandidateSourceType,
    ...(content ? { content } : {}),
    payload: {
      label,
      kind: sourceType,
      value: payloadText,
      ...(pathValue ? { path: pathValue } : {}),
      ...(diagnostic ? { diagnostic } : {})
    },
    priority,
    relevance,
    estimatedTokenCost: estimateTokens(content ?? payloadText),
    sourceRevision,
    confidence: 1,
    evidence,
    ...(compression ? { compression } : {}),
    provenance: makeProvenance(
      source === "user-context" ? "workspace" : source,
      pathValue,
      undefined,
      sourceRevision.value,
      evidence
    ),
    expandable: Boolean(pathValue)
  };
}

function fileCandidate(
  file: RepoFile,
  sourceRevision: ContextSourceRevision,
  section?: NonNullable<ContextPack["contextSections"]>[number]
): ContextCandidate {
  const sectionScore = section?.score ?? 0;
  const sectionEvidence: ContextEvidenceReference[] = (section?.evidence ?? []).map((item) => ({
    ...(item.okfId ? { id: item.okfId, entityId: item.okfId } : {}),
    kind: item.kind,
    label: item.label,
    path: file.path,
    ...(item.startLine !== undefined ? { startLine: item.startLine } : {}),
    ...(item.endLine !== undefined ? { endLine: item.endLine } : {})
  }));
  const fileEvidence: ContextEvidenceReference[] = file.evidence
    ? [
        {
          kind: file.evidence.source,
          label: file.path,
          path: file.path,
          ...(file.evidence.evidenceLine ? { startLine: file.evidence.evidenceLine } : {})
        },
        ...sectionEvidence
      ]
    : sectionEvidence.length
      ? sectionEvidence
      : [{ kind: "file", label: file.path, path: file.path }];
  return {
    id: stableId("repository-file", file.path),
    category: "intelligence",
    sourceType: "repository-file",
    ...(section ? { content: section.content } : {}),
    payload: {
      path: file.path,
      language: file.language,
      summary: file.summary,
      sizeBytes: file.sizeBytes,
      lineCount: file.lineCount
    },
    priority: file.isTest ? 0.55 : file.isGenerated ? 0.15 : 0.65,
    relevance: section ? Math.min(1, 0.55 + Math.max(0, sectionScore) / 20) : 0,
    estimatedTokenCost: section?.estimatedTokens ?? Math.max(1, estimateTokens(file.summary)),
    sourceRevision: file.contentHash ? makeRevision(file.contentHash, "file") : sourceRevision,
    confidence: file.evidence?.confidence,
    evidence: fileEvidence,
    ...(section?.compression ? { compression: section.compression } : {}),
    provenance: makeProvenance(
      "file",
      file.path,
      file.contentHash,
      file.contentHash ?? sourceRevision.value,
      fileEvidence
    ),
    expandable: true
  };
}

function symbolCandidate(
  symbol: CodeSymbol,
  sourceRevision: ContextSourceRevision,
  sourceHash?: string
): ContextCandidate {
  const evidence = [
    { kind: symbol.kind, label: symbol.name, path: symbol.filePath, startLine: symbol.line }
  ];
  return {
    id: stableId("symbol", `${symbol.filePath}:${symbol.line}:${symbol.name}`),
    category: "intelligence",
    sourceType: "symbol",
    payload: { label: symbol.name, path: symbol.filePath, line: symbol.line, kind: symbol.kind },
    priority: 0.7,
    relevance: 0.35,
    estimatedTokenCost: estimateTokens(JSON.stringify(symbol)),
    sourceRevision,
    confidence: symbol.evidence?.confidence,
    evidence,
    provenance: makeProvenance(
      "file",
      symbol.filePath,
      sourceHash,
      sourceHash ?? sourceRevision.value,
      evidence
    ),
    expandable: true
  };
}

function testCandidate(
  test: TestMapping,
  sourceRevision: ContextSourceRevision,
  sourceHash?: string
): ContextCandidate {
  const evidence = [{ kind: "test", label: test.testFile, path: test.testFile }];
  return {
    id: stableId("test", `${test.testFile}:${test.targetFile ?? ""}`),
    category: "intelligence",
    sourceType: "test",
    payload: {
      label: test.testFile,
      path: test.testFile,
      targetFile: test.targetFile,
      reason: test.reason
    },
    priority: 0.6,
    relevance: test.targetFile ? 0.55 : 0.25,
    estimatedTokenCost: estimateTokens(JSON.stringify(test)),
    sourceRevision,
    confidence: test.confidence,
    evidence,
    provenance: makeProvenance(
      "file",
      test.testFile,
      sourceHash,
      sourceHash ?? sourceRevision.value,
      evidence
    ),
    expandable: true
  };
}

function apiCandidate(
  api: RepoIntelligence["apis"][number],
  sourceRevision: ContextSourceRevision,
  sourceHash?: string
): ContextCandidate {
  const evidence = [
    { kind: "api", label: `${api.method} ${api.path}`, path: api.filePath, startLine: api.line }
  ];
  return {
    id: stableId("api", `${api.filePath}:${api.line}:${api.method}:${api.path}`),
    category: "intelligence",
    sourceType: "api",
    payload: { label: `${api.method} ${api.path}`, path: api.filePath, line: api.line },
    priority: 0.65,
    relevance: 0.45,
    estimatedTokenCost: estimateTokens(JSON.stringify(api)),
    sourceRevision,
    evidence,
    provenance: makeProvenance(
      "file",
      api.filePath,
      sourceHash,
      sourceHash ?? sourceRevision.value,
      evidence
    ),
    expandable: true
  };
}

function serviceCandidate(
  service: ServiceNode,
  sourceRevision: ContextSourceRevision,
  sourceHash?: string
): ContextCandidate {
  const evidence = [{ kind: "service", label: service.name, path: service.filePath }];
  return {
    id: stableId("service", `${service.filePath}:${service.name}`),
    category: "intelligence",
    sourceType: "service",
    payload: { label: service.name, path: service.filePath, hints: service.hints },
    priority: 0.6,
    relevance: 0.4,
    estimatedTokenCost: estimateTokens(JSON.stringify(service)),
    sourceRevision,
    evidence,
    provenance: makeProvenance(
      "file",
      service.filePath,
      sourceHash,
      sourceHash ?? sourceRevision.value,
      evidence
    ),
    expandable: true
  };
}

function matchesFocus(candidate: ContextCandidate, terms: ReadonlySet<string>): boolean {
  if (!terms.size) return true;
  const searchable = [
    candidate.id,
    candidate.sourceType,
    candidate.content ?? "",
    ...Object.values(candidate.payload).map((value) => String(value))
  ]
    .join(" ")
    .toLowerCase();
  return [...terms].some((term) => searchable.includes(term));
}

function scoreFocus(candidate: ContextCandidate, terms: ReadonlySet<string>): number {
  if (!terms.size) return candidate.relevance;
  const searchable = [
    candidate.id,
    candidate.sourceType,
    candidate.provenance.authoritativePath ?? "",
    candidate.payload.label ?? "",
    candidate.content ?? ""
  ]
    .join(" ")
    .toLowerCase();
  const matches = [...terms].filter((term) => searchable.includes(term)).length;
  return matches * 10 + candidate.relevance;
}

type NormalizedExpansionLevel = 0 | 1 | 2 | 3 | 4;

function normalizeExpansionLevel(level: ContextExpansionLevel): NormalizedExpansionLevel {
  switch (level) {
    case "L0":
      return 0;
    case "L1":
    case "summary":
      return 1;
    case "L2":
      return 2;
    case "L3":
    case "standard":
      return 3;
    case "L4":
    case "full":
      return 4;
  }
}

function trimCandidate(
  candidate: ContextCandidate,
  level: NormalizedExpansionLevel
): ContextCandidate {
  if (level === 0) {
    const { content: _content, ...referenceOnly } = candidate;
    return referenceOnly;
  }
  if (level === 1) return { ...candidate, content: compactFact(candidate) };
  if (level === 2) {
    return {
      ...candidate,
      content: JSON.stringify(
        {
          payload: candidate.payload,
          evidence: candidate.evidence,
          provenance: candidate.provenance
        },
        null,
        2
      )
    };
  }
  if (!candidate.content) return candidate;
  const limit = level === 3 ? 8_000 : Number.MAX_SAFE_INTEGER;
  return { ...candidate, content: truncate(candidate.content, limit) };
}

function compactFact(candidate: ContextCandidate): string {
  const label = String(candidate.payload.label ?? candidate.payload.path ?? candidate.id);
  const summary =
    candidate.payload.summary ?? candidate.payload.value ?? candidate.content ?? label;
  const source = candidate.provenance.authoritativePath
    ? ` Source: ${candidate.provenance.authoritativePath}.`
    : "";
  return `${label}: ${truncate(String(summary), 600)}${source}`;
}

function formatCandidate(candidate: ContextCandidate, level: ContextExpansionLevel): string {
  const label = String(candidate.payload.path ?? candidate.payload.label ?? candidate.id);
  const stale = candidate.stale
    ? "\nStatus: STALE — authoritative source changed since capture."
    : "";
  const evidence = candidate.provenance.ranges.length
    ? `\nEvidence: ${candidate.provenance.ranges
        .map(
          (range) =>
            `${range.label}${range.path ? ` @ ${range.path}` : ""}${range.startLine !== undefined ? `:${range.startLine + 1}` : ""}`
        )
        .join("; ")}`
    : "";
  const compression = candidate.compression
    ? `\nCompression: ${candidate.compression.type}; ${candidate.compression.strategy}; ${candidate.compression.originalBytes} → ${candidate.compression.compressedBytes} bytes; derived=${candidate.compression.derived}`
    : "";
  const normalized = normalizeExpansionLevel(level);
  const body =
    normalized === 0
      ? JSON.stringify(candidate.payload, null, 2)
      : (candidate.content ??
        (normalized === 2
          ? JSON.stringify({ payload: candidate.payload, evidence: candidate.evidence }, null, 2)
          : JSON.stringify(candidate.payload, null, 2)));
  return `## ${label}\nSource: ${candidate.sourceType}${stale}${compression}${evidence}\n\n${body}`;
}

function expansionLimit(level: ContextExpansionLevel): number {
  switch (normalizeExpansionLevel(level)) {
    case 0:
      return 1;
    case 1:
      return 2;
    case 2:
      return 4;
    case 3:
      return 6;
    case 4:
      return 8;
  }
}

function makeProvenance(
  origin: ContextProvenance["origin"],
  authoritativePath: string | undefined,
  sourceHash: string | undefined,
  sourceRevision: string,
  ranges: readonly ContextEvidenceReference[]
): ContextProvenance {
  return {
    origin,
    ...(authoritativePath ? { authoritativePath } : {}),
    ...(sourceHash ? { sourceHash } : {}),
    sourceRevision,
    capturedAt: new Date().toISOString(),
    ranges: Object.freeze(ranges.map((range) => Object.freeze({ ...range })))
  };
}

function targetedExcerpt(content: string, candidate: ContextCandidate, focus: string): string {
  const lines = content.split(/\r?\n/);
  const ranges = candidate.provenance.ranges.filter(
    (range) => range.startLine !== undefined || range.endLine !== undefined
  );
  const windows = ranges.slice(0, 4).map((range) => {
    const startLine = range.startLine ?? range.endLine ?? 1;
    const endLine = range.endLine ?? range.startLine ?? startLine;
    // Intelligence line locations are one-based. Add a small surrounding
    // window, but keep separate evidence ranges separate so unrelated code is
    // not pulled into an expansion.
    return [Math.max(0, startLine - 1 - 12), Math.min(lines.length - 1, endLine - 1 + 12)] as const;
  });
  if (!windows.length) {
    const terms =
      focus
        .toLowerCase()
        .match(/[a-z0-9_]+/g)
        ?.filter((term) => term.length > 2) ?? [];
    const lineIndex = lines.findIndex((line) =>
      terms.some((term) => line.toLowerCase().includes(term))
    );
    windows.push([
      Math.max(0, lineIndex >= 0 ? lineIndex - 12 : 0),
      Math.min(lines.length - 1, lineIndex >= 0 ? lineIndex + 36 : 48)
    ]);
  }
  const merged: Array<readonly [number, number]> = [];
  for (const [start, end] of windows.sort((left, right) => left[0] - right[0])) {
    const previous = merged.at(-1);
    if (previous && start <= previous[1] + 2) {
      merged[merged.length - 1] = [previous[0], Math.max(previous[1], end)];
    } else {
      merged.push([start, end]);
    }
  }
  return merged
    .map(([start, end]) =>
      lines
        .slice(start, end + 1)
        .map((line, index) => `${String(start + index + 1).padStart(5, " ")} | ${line}`)
        .join("\n")
    )
    .join("\n… unrelated source omitted …\n")
    .slice(0, 12_000);
}

function hashContent(content: string): string {
  return crypto.createHash("sha256").update(content).digest("hex");
}

function parseContextReference(reference: string): { contextId: string; candidateId?: string } {
  const separator = reference.lastIndexOf("#");
  if (separator > 0 && reference.slice(separator + 1).startsWith("ctx-")) {
    return {
      contextId: reference.slice(0, separator),
      candidateId: reference.slice(separator + 1)
    };
  }
  return { contextId: reference.split(":packet:")[0] };
}

function hydrateCandidate(candidate: ContextCandidate): ContextCandidate {
  if (candidate.provenance) return candidate;
  const pathValue = typeof candidate.payload.path === "string" ? candidate.payload.path : undefined;
  const origin: ContextProvenance["origin"] = pathValue
    ? "file"
    : candidate.category === "intelligence"
      ? "intelligence"
      : candidate.category === "decisions"
        ? "decision"
        : candidate.category === "changes"
          ? "change"
          : candidate.category === "diagnostics"
            ? "diagnostic"
            : candidate.category;
  return {
    ...candidate,
    provenance: makeProvenance(
      origin,
      pathValue,
      candidate.sourceRevision.source === "file" ? candidate.sourceRevision.value : undefined,
      candidate.sourceRevision.value,
      candidate.evidence
    )
  };
}

function makeRevision(
  value: string,
  source: ContextSourceRevision["source"]
): ContextSourceRevision {
  return { value, source, capturedAt: new Date().toISOString() };
}

function summarizeEvidence(reference: ContextEvidenceReference): string {
  return `${reference.id ?? ""}|${reference.kind}|${reference.label}|${reference.path ?? ""}|${reference.startLine ?? ""}`;
}

function dedupeEvidence(values: readonly ContextEvidenceReference[]): ContextEvidenceReference[] {
  const seen = new Set<string>();
  return values.filter((value) => {
    const key = summarizeEvidence(value);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function deduplicateCandidates(values: readonly ContextCandidate[]): ContextCandidate[] {
  const deduplicated = new Map<string, ContextCandidate>();
  for (const candidate of values) {
    const evidenceKey = candidate.evidence
      .map(
        (reference) =>
          `${reference.kind}|${reference.label}|${reference.path ?? ""}|${reference.startLine ?? ""}|${reference.endLine ?? ""}`
      )
      .sort()
      .join(";");
    const key = evidenceKey || `${candidate.sourceType}|${candidate.id}`;
    const existing = deduplicated.get(key);
    if (!existing) {
      deduplicated.set(key, candidate);
      continue;
    }
    const mergedEvidence = dedupeEvidence([...existing.evidence, ...candidate.evidence]);
    const preferred = candidate.content && !existing.content ? candidate : existing;
    deduplicated.set(key, {
      ...preferred,
      priority: Math.max(existing.priority, candidate.priority),
      relevance: Math.max(existing.relevance, candidate.relevance),
      estimatedTokenCost: Math.min(existing.estimatedTokenCost, candidate.estimatedTokenCost),
      evidence: mergedEvidence,
      expandable: existing.expandable || candidate.expandable
    });
  }
  return [...deduplicated.values()];
}

function sourceRevisionFor(
  request: ContextPreparationRequest,
  contextPack: ContextPack
): ContextSourceRevision {
  return makeRevision(
    request.sourceRevision ??
      contextPack.contextManifest?.snapshotDigest ??
      request.intelligence.indexedAt,
    contextPack.contextManifest?.snapshotDigest ? "okf" : "intelligence"
  );
}

function parseChangedPaths(status: string, diff: string): string[] {
  const statusPaths = status
    .split(/\r?\n/)
    .map((line) => line.slice(2).trim())
    .filter(Boolean)
    .map((value) => (value.includes(" -> ") ? value.split(" -> ").at(-1)! : value));
  const diffPaths = diff
    .split(/\r?\n/)
    .filter((line) => line.startsWith("+++ b/"))
    .map((line) => line.slice(6).trim())
    .filter((value) => value && value !== "/dev/null");
  return [...new Set([...statusPaths, ...diffPaths])].slice(0, 48);
}

async function historyCandidates(
  workspaceRoot: string,
  sourceRevision: ContextSourceRevision
): Promise<ContextCandidate[]> {
  const history: Array<{ artifact: string; value: unknown }> = [];
  const evaluations = await readJsonSafe(workspaceRoot, ".keystone/context/evaluations.json");
  if (Array.isArray(evaluations))
    history.push({ artifact: ".keystone/context/evaluations.json", value: evaluations.slice(-5) });
  const resultRoot = path.join(workspaceRoot, ".keystone", "copilot", "results");
  for (const file of (await fs.readdir(resultRoot).catch(() => [])).slice(-3)) {
    if (!file.endsWith(".json")) continue;
    const value = await readJsonSafe(workspaceRoot, `.keystone/copilot/results/${file}`);
    if (value && typeof value === "object")
      history.push({ artifact: `.keystone/copilot/results/${file}`, value });
  }
  const activity = await readJsonSafe(workspaceRoot, ".keystone/intelligence/activity.json");
  if (Array.isArray(activity))
    history.push({ artifact: ".keystone/intelligence/activity.json", value: activity.slice(-8) });
  const taskRoot = path.join(workspaceRoot, ".keystone", "tasks");
  for (const taskDirectory of (await fs.readdir(taskRoot).catch(() => [])).slice(-3)) {
    const taskPath = path.join(taskRoot, taskDirectory);
    const taskContext = await readJsonSafe(
      workspaceRoot,
      `.keystone/tasks/${taskDirectory}/context.json`
    );
    const taskProgress = await readJsonSafe(
      workspaceRoot,
      `.keystone/tasks/${taskDirectory}/progress.json`
    );
    if (taskContext)
      history.push({
        artifact: `.keystone/tasks/${taskDirectory}/context.json`,
        value: taskContext
      });
    if (taskProgress)
      history.push({
        artifact: `.keystone/tasks/${taskDirectory}/progress.json`,
        value: taskProgress
      });
    const specification = await fs
      .readFile(path.join(taskPath, "specification.md"), "utf8")
      .catch(() => "");
    if (specification.trim())
      history.push({
        artifact: `.keystone/tasks/${taskDirectory}/specification.md`,
        value: specification
      });
  }
  if (!history.length) return [];
  const compact = compressConversationHistory(
    history.map((entry) => ({
      artifact: entry.artifact,
      history: entry.value
    })),
    1_200
  );
  return [
    basicCandidate(
      "history",
      "durable-task-state",
      "Durable task work state",
      "History",
      compact.content,
      JSON.stringify(history),
      sourceRevision,
      0.42,
      0.3,
      undefined,
      undefined,
      compact.metadata
    )
  ];
}

async function readJsonSafe(root: string, relative: string): Promise<unknown> {
  try {
    return JSON.parse(await fs.readFile(path.join(root, relative), "utf8")) as unknown;
  } catch {
    return undefined;
  }
}

function stableId(type: string, value: string): string {
  return `ctx-${type}-${crypto.createHash("sha256").update(value).digest("hex").slice(0, 20)}`;
}

function safeId(value: string): string {
  return value.replace(/[^a-zA-Z0-9._-]/g, "_");
}

async function readAuthoritativeSource(
  root: string,
  relative: string
): Promise<{ exists: boolean; content?: string }> {
  try {
    const target = path.resolve(root, relative);
    const safeRoot = `${path.resolve(root)}${path.sep}`;
    if (!target.startsWith(safeRoot)) return { exists: false };
    const [realRoot, realTarget] = await Promise.all([fs.realpath(root), fs.realpath(target)]);
    if (realTarget !== realRoot && !realTarget.startsWith(`${realRoot}${path.sep}`)) {
      return { exists: false };
    }
    return { exists: true, content: await fs.readFile(realTarget, "utf8") };
  } catch {
    return { exists: false };
  }
}

async function staleSourcesForCandidates(
  root: string,
  candidates: readonly ContextCandidate[]
): Promise<ContextStaleSource[]> {
  const stale: ContextStaleSource[] = [];
  const seen = new Set<string>();
  for (const candidate of candidates) {
    const sourcePath = candidate.provenance.authoritativePath;
    const expectedHash = candidate.provenance.sourceHash;
    if (!sourcePath || !expectedHash || seen.has(sourcePath)) continue;
    seen.add(sourcePath);
    const source = await readAuthoritativeSource(root, sourcePath);
    const currentHash = source.content === undefined ? undefined : hashContent(source.content);
    if (!source.exists || currentHash !== expectedHash) {
      stale.push({
        path: sourcePath,
        expectedHash,
        currentHash,
        message: source.exists
          ? "The authoritative source changed after this package was prepared."
          : "The authoritative source is no longer available."
      });
    }
  }
  return stale;
}

function truncate(value: string, maxCharacters: number): string {
  if (value.length <= maxCharacters) return value;
  return `${value.slice(0, maxCharacters).trim()}\n… context fragment truncated …`;
}

function freezeCandidate(candidate: ContextCandidate): ContextCandidate {
  return Object.freeze({
    ...candidate,
    payload: Object.freeze({ ...candidate.payload }),
    evidence: Object.freeze(candidate.evidence.map((reference) => Object.freeze({ ...reference }))),
    sourceRevision: Object.freeze({ ...candidate.sourceRevision })
  });
}
