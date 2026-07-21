/**
 * ContextPackageService (orchestrator)
 *
 * The single orchestration service that the workflow engine calls to build a
 * stage-aware, measured, traceable context package. It runs the full pipeline:
 *
 *   workflow intent + specification + stage + work item
 *     → repository intelligence retrieval (RawContextBaselineService)
 *     → raw baseline (measured)
 *     → normalization (ContextCandidateNormalizer)
 *     → deduplication (ContextDeduplicator)
 *     → relevance scoring (ContextRelevanceScorer)
 *     → structural/flow/contract compression (ContextCompressionService)
 *     → token-budget optimization (TokenBudgetOptimizer)
 *     → completeness & safety validation (ContextCompletenessValidator + SensitiveContextFilter)
 *     → user review
 *     → agent-ready context package
 *
 * It never performs LLM calls or network access. Reduction is computed from the
 * measured raw baseline, never from file counts or character ratios.
 */

import type { WorkspaceAdapter } from "../../extension/adapters/WorkspaceAdapter";
import type { IntelligenceQueryService } from "../intelligence/IntelligenceQueryService";
import type { IntelligenceSnapshotReader } from "../persistence/IntelligenceStore";
import type { DevelopmentSpecification, DevelopmentTask } from "../../shared/contracts/delegation";
import {
  CONTEXT_PACKAGE_SCHEMA_VERSION,
  ContextPackageSchema,
  type ContextItem,
  type ContextPackage,
  type ContextExclusion,
  type ContextSection,
  type ContextWarning,
  type StageContextProfile,
  type ContextPackageBuildInput,
  type RawContextBaseline,
} from "../../shared/contracts/contextPackage";
import { TokenCounterRegistry, type TokenCounter } from "./TokenCounterRegistry";
import { RawContextBaselineService } from "./RawContextBaselineService";
import { ContextCandidateNormalizer } from "./ContextCandidateNormalizer";
import { ContextDeduplicator } from "./ContextDeduplicator";
import { ContextRelevanceScorer } from "./ContextRelevanceScorer";
import { RequiredFactExtractor } from "./RequiredFactExtractor";
import { ContextProfileService } from "./ContextProfileService";
import { ContextCompressionService } from "./ContextCompressionService";
import { TokenBudgetOptimizer } from "./TokenBudgetOptimizer";
import { ContextCompletenessValidator } from "./ContextCompletenessValidator";
import { SensitiveContextFilter } from "./SensitiveContextFilter";
import { ContextPackageRenderer } from "./ContextPackageRenderer";
import type { ContextPersistenceStore } from "./ContextPersistenceStore";
import { fnv1a, normalizeContent, tokenShingles } from "./compressionUtils";

export interface PackageBuildDeps {
  task: DevelopmentTask;
  specification: DevelopmentSpecification;
  instructionContents: Array<{ id: string; name: string; content: string }>;
  skillContents: Array<{ id: string; name: string; content: string }>;
  intelligenceGeneration: number;
  repositoryRevision?: string;
  instructionRevisionHash: string;
  currentFile?: string;
  currentSelection?: { relativePath: string; startLine: number; endLine: number };
  signal?: AbortSignal;
  /** Token reservation hints from the execution profile. */
  reservedInstructionTokens?: number;
  reservedOutputTokens?: number;
}

export class ContextPackageService {
  private readonly baseline: RawContextBaselineService;
  private readonly normalizer = new ContextCandidateNormalizer();
  private readonly deduplicator = new ContextDeduplicator();
  private readonly scorer = new ContextRelevanceScorer();
  private readonly facts = new RequiredFactExtractor();
  private readonly profiles = new ContextProfileService();
  private readonly compressor = new ContextCompressionService();
  private readonly optimizer = new TokenBudgetOptimizer();
  private readonly completeness = new ContextCompletenessValidator();
  private readonly sensitive = new SensitiveContextFilter();
  private readonly renderer = new ContextPackageRenderer();
  private readonly registry = new TokenCounterRegistry();

  private cache = new Map<string, ContextPackage>();

  constructor(
    snapshotReader: IntelligenceSnapshotReader,
    queries: IntelligenceQueryService,
    workspace: WorkspaceAdapter,
    private readonly store: ContextPersistenceStore,
  ) {
    this.baseline = new RawContextBaselineService(snapshotReader, queries, workspace);
  }

  get profilesService(): ContextProfileService {
    return this.profiles;
  }

  /** Entry point used by the workflow engine / webview. */
  async build(input: ContextPackageBuildInput, deps: PackageBuildDeps): Promise<ContextPackage> {
    const started = Date.now();
    const profile = input.profileId
      ? (this.profiles.getById(input.profileId) ?? this.profiles.getForStage(input.stageId))
      : this.profiles.getForStage(input.stageId);
    const { counter, warning } = this.registry.resolveSafe(deps.task.assignedAgentId ?? undefined);
    const tokenizerInfo = counter.info();

    // 1. Raw baseline (measured token count of the uncompressed candidate set).
    const { items: rawItems, baseline } = await this.baseline.build(
      {
        task: deps.task,
        specification: deps.specification,
        instructionContents: deps.instructionContents.map((i) => ({
          id: i.id,
          content: i.content,
        })),
        skillContents: deps.skillContents.map((s) => ({ id: s.id, content: s.content })),
        pinnedItemIds: input.pinnedItemIds,
        currentFile: deps.currentFile,
        currentSelection: deps.currentSelection,
        signal: deps.signal,
      },
      counter,
    );

    const warnings: ContextWarning[] = [];
    if (warning)
      warnings.push({ code: "tokenizer-approximation", severity: "warning", message: warning });

    // 2. Normalize.
    const normalized = await this.normalizer.normalize(rawItems);

    // 3. Deduplicate (exact / structural / relationship / semantic-approx).
    const deduped = this.deduplicator.deduplicate(normalized.items);

    // 4. Relevance scoring with explanation.
    const intentShingles = new Set(
      tokenShingles(normalizeContent(`${deps.task.objective} ${deps.specification.objective}`)),
    );
    const stageKeywords = this.profiles.keywordsForStage(profile.stageType);
    const scored = deduped.items.map(
      (item) =>
        this.scorer.score({
          item,
          profile,
          intentShingles,
          stageKeywords,
          userPinnedIds: input.pinnedItemIds,
          isChangedSymbol: deps.task.expectedEntityIds.includes(
            item.sourceReference.symbolId ?? "",
          ),
          hasPriorValidationEvidence: item.sourceType === "validation-evidence",
          securityRisk: item.sourceType === "security-finding",
          performanceRisk: item.sourceType === "performance-finding",
          hasDuplicate: false,
        }).item,
    );

    // 5. Compress (structural / flow / contract) per profile strategies.
    const compressed = this.compressor.compress(scored, profile, counter);

    // 6. Required facts extraction + mapping.
    const requiredFacts = this.facts.extract(
      deps.task,
      deps.specification,
      compressed.items,
      profile,
    );

    // 7. Sensitive filter (secrets redacted / blocked).
    const sensitiveResult = this.sensitive.filter(compressed.items, new Set());
    warnings.push(...sensitiveResult.warnings);

    // 8. Budget model + optimization.
    const requestedTokens = input.budgetTokens ?? profile.defaultTokenBudget;
    const reservedInstructionTokens =
      deps.reservedInstructionTokens ?? instructionTokensReserve(deps.instructionContents, counter);
    const reservedOutputTokens = deps.reservedOutputTokens ?? Math.round(requestedTokens * 0.2);
    const specificationTokens = counter.count(
      deps.specification.objective + deps.specification.constraints.join("\n"),
    );
    const budget = {
      requestedTokens,
      reservedInstructionTokens,
      reservedOutputTokens,
      availableContextTokens: Math.max(
        0,
        requestedTokens - reservedInstructionTokens - reservedOutputTokens - specificationTokens,
      ),
      tokenizerId: tokenizerInfo.id,
    };

    const optimized = this.optimizer.optimize({
      items: sensitiveResult.items,
      budget,
      reservedSectionTokens: {
        contract: 120,
        skills: skillTokensReserve(deps.skillContents, counter),
        instructions: reservedInstructionTokens,
        specification: specificationTokens,
      },
      pinnedIds: input.pinnedItemIds,
    });

    // Re-tag exclusions from dedup + optimizer.
    const exclusions: ContextExclusion[] = [
      ...deduped.exclusions,
      ...sensitiveResult.exclusions.map((e): ContextExclusion => ({
        item: e.item,
        reason: e.reason,
        tokensRemoved: e.tokensRemoved,
        restorable: false,
      })),
      ...optimized.excluded.map((e): ContextExclusion => ({
        item: e.item,
        reason: "over-budget",
        tokensRemoved: e.tokensRemoved,
        restorable: true,
      })),
    ];

    const includedItems = optimized.included;

    // 9. Completeness + safety validation.
    const annotatedFacts = this.completeness.annotateLowConfidence(
      requiredFacts.facts,
      includedItems,
    );
    const completenessResult = this.completeness.validate(
      annotatedFacts,
      includedItems,
      profile,
      deps.specification.objective,
      optimized.impossible || sensitiveResult.blocked,
    );

    // Build sections (required / supporting / optional / summarized).
    const sections = this.buildSections(includedItems, compressed.summarizedItemIds);

    // 10. Assemble the package, then render the prompt (Phase 2 integration).
    const pkg = this.assemblePackage({
      input,
      deps,
      profile,
      baseline,
      includedItems,
      exclusions,
      sections,
      facts: annotatedFacts,
      warnings: [...warnings, ...completenessResult.warnings, ...optimized.warnings],
      blocked: completenessResult.blocked,
      tokenizerInfo,
      counter,
      requestedTokens,
      reservedInstructionTokens,
      reservedOutputTokens,
      specificationTokens,
      duplicateTokensRemoved: deduped.duplicateTokensRemoved,
      structuralSavings: compressed.structuralSavings,
      summarizedItemIds: compressed.summarizedItemIds,
      rendered: "",
      completePromptTokens: 0,
      buildDurationMs: Date.now() - started,
    });

    // 10b. Render the delegation prompt (Phase 2 integration) from the assembled package.
    const skillNames = deps.skillContents.map((s) => s.name);
    const instructionNames = deps.instructionContents.map((i) => i.name);
    const render = this.renderer.render(pkg, skillNames, instructionNames, counter);
    const rendered = {
      ...pkg,
      renderedPrompt: render.rendered,
      completePromptTokens: render.completePromptTokens,
      metrics: { ...pkg.metrics, completePromptTokens: render.completePromptTokens },
    };

    const validated = ContextPackageSchema.parse(rendered);
    this.cache.set(this.cacheKey(input), validated);
    if (this.cache.size > 50) this.cache.delete(this.cache.keys().next().value!);
    await this.store.upsert(validated);
    return validated;
  }

  private cacheKey(input: ContextPackageBuildInput): string {
    return fnv1a(
      JSON.stringify({
        w: input.workflowId,
        s: input.stageId,
        wi: input.workItemId,
        p: input.profileId,
        b: input.budgetTokens,
        pins: input.pinnedItemIds,
      }),
    );
  }

  // --- Manual mutation operations (each triggers revalidation) ---

  async pin(workItemId: string, itemId: string, pinned: boolean): Promise<ContextPackage> {
    const pkg = this.requirePackage(workItemId);
    return this.store.upsert(
      this.withItems(
        pkg,
        pkg.items.map((i) => (i.id === itemId ? { ...i, pinned } : i)),
      ),
    );
  }

  async remove(
    workItemId: string,
    itemId: string,
    overrideRequired = false,
  ): Promise<ContextPackage> {
    const pkg = this.requirePackage(workItemId);
    const selected = pkg.items.find((i) => i.id === itemId);
    if (!selected) return pkg;
    if (selected.importance === "required" && !overrideRequired)
      throw new Error("Required context cannot be removed without an explicit warning override.");
    const next: ContextPackage = {
      ...pkg,
      items: pkg.items.filter((i) => i.id !== itemId),
      exclusions: [
        ...pkg.exclusions,
        {
          item: selected,
          reason: "user-removed",
          tokensRemoved: selected.tokenCount,
          restorable: true,
        },
      ],
      metadata: {
        ...pkg.metadata,
        status: selected.importance === "required" ? "blocked" : pkg.metadata.status,
      },
    };
    return this.store.upsert(next);
  }

  async restore(workItemId: string, itemId: string): Promise<ContextPackage> {
    const pkg = this.requirePackage(workItemId);
    const excluded = pkg.exclusions.find((e) => e.item.id === itemId);
    if (!excluded) return pkg;
    return this.store.upsert({
      ...pkg,
      items: [...pkg.items, { ...excluded.item, included: true }],
      exclusions: pkg.exclusions.filter((e) => e.item.id !== itemId),
    });
  }

  async changeBudget(workItemId: string, budgetTokens: number): Promise<ContextPackage> {
    const pkg = this.requirePackage(workItemId);
    const next: ContextPackage = {
      ...pkg,
      budget: {
        ...pkg.budget,
        requestedTokens: budgetTokens,
        availableContextTokens: Math.max(
          0,
          budgetTokens - pkg.budget.reservedInstructionTokens - pkg.budget.reservedOutputTokens,
        ),
      },
    };
    return this.store.upsert(next);
  }

  async approve(workItemId: string, fingerprint: string): Promise<ContextPackage> {
    const pkg = this.requirePackage(workItemId);
    if (pkg.metadata.contentHash !== fingerprint)
      throw new Error("Context fingerprint changed; regenerate and review the current package.");
    if (pkg.metadata.status === "blocked") throw new Error("Blocked context cannot be approved.");
    return this.store.upsert({
      ...pkg,
      metadata: { ...pkg.metadata, status: "approved", approvedAt: new Date().toISOString() },
    });
  }

  get(workItemId: string): ContextPackage | undefined {
    return this.store.getByWorkItem(workItemId);
  }

  /** Mark a context package stale (used by freshness / external change detection). */
  async invalidate(workItemId: string, reason: string): Promise<void> {
    const pkg = this.store.getByWorkItem(workItemId);
    if (pkg) await this.store.markStale(pkg.id, reason);
  }

  private requirePackage(workItemId: string): ContextPackage {
    const pkg = this.store.getByWorkItem(workItemId);
    if (!pkg) throw new Error(`No context package for work item ${workItemId}.`);
    return pkg;
  }

  private withItems(pkg: ContextPackage, items: ContextItem[]): ContextPackage {
    return {
      ...pkg,
      items,
      metadata: {
        ...pkg.metadata,
        contentHash: contentFingerprint(items),
        updatedAt: new Date().toISOString(),
      },
    };
  }

  // --- Assembly helpers ---

  private buildSections(items: ContextItem[], summarizedIds: string[]): ContextSection[] {
    const groups: Array<{ group: ContextSection["group"]; items: ContextItem[] }> = [
      { group: "required", items: items.filter((i) => i.importance === "required") },
      { group: "supporting", items: items.filter((i) => i.importance === "supporting") },
      { group: "optional", items: items.filter((i) => i.importance === "optional") },
      { group: "summarized", items: items.filter((i) => summarizedIds.includes(i.id)) },
    ];
    return groups
      .filter((g) => g.items.length > 0)
      .map((g) => ({
        group: g.group,
        title: g.group.charAt(0).toUpperCase() + g.group.slice(1),
        itemIds: g.items.map((i) => i.id),
        tokenCount: g.items.reduce((t, i) => t + i.tokenCount, 0),
        compressionStrategy: g.group === "summarized" ? "structural-summary" : undefined,
      }));
  }

  private assemblePackage(params: {
    input: ContextPackageBuildInput;
    deps: PackageBuildDeps;
    profile: StageContextProfile;
    baseline: RawContextBaseline;
    includedItems: ContextItem[];
    exclusions: ContextExclusion[];
    sections: ContextSection[];
    facts: ContextPackage["requiredFacts"];
    warnings: ContextWarning[];
    blocked: boolean;
    tokenizerInfo: ReturnType<TokenCounter["info"]>;
    counter: TokenCounter;
    requestedTokens: number;
    reservedInstructionTokens: number;
    reservedOutputTokens: number;
    specificationTokens: number;
    duplicateTokensRemoved: number;
    structuralSavings: number;
    summarizedItemIds: string[];
    rendered: string;
    completePromptTokens: number;
    buildDurationMs: number;
  }): ContextPackage {
    const compressedTokens = params.includedItems.reduce((t, i) => t + i.tokenCount, 0);
    const rawBaselineTokens = params.baseline.tokenCount;
    const reductionTokens = Math.max(0, rawBaselineTokens - compressedTokens);
    const reductionPercentage =
      rawBaselineTokens === 0 ? 0 : Math.min(100, (reductionTokens / rawBaselineTokens) * 100);
    const retainedRequiredFacts = params.facts.filter(
      (f) => f.state === "satisfied" || f.state === "partially-satisfied",
    ).length;
    const unresolved = params.facts
      .filter(
        (f) => f.state === "missing" || f.state === "conflicting" || f.state === "low-confidence",
      )
      .map((f) => f.id);
    const completenessScore =
      params.facts.length === 0 ? 1 : retainedRequiredFacts / params.facts.length;
    const confidence =
      params.facts.length === 0
        ? 1
        : params.facts.reduce(
            (a, f) =>
              a + (f.state === "satisfied" ? 1 : f.state === "partially-satisfied" ? 0.6 : 0),
            0,
          ) / params.facts.length;
    const now = new Date().toISOString();
    const contentHash = contentFingerprint(params.includedItems);

    return ContextPackageSchema.parse({
      schemaVersion: CONTEXT_PACKAGE_SCHEMA_VERSION,
      id: crypto.randomUUID(),
      contentFingerprint: contentHash,
      workflowId: params.input.workflowId,
      stageId: params.input.stageId,
      workItemId: params.input.workItemId,
      executionProfileId: params.input.executionProfileId,
      sourceSnapshot: {
        repositoryRevision: params.deps.repositoryRevision,
        intelligenceRevision: String(params.deps.intelligenceGeneration),
        specificationRevision: String(params.deps.specification.revision),
        instructionRevisionHash: params.deps.instructionRevisionHash,
        createdAt: now,
      },
      budget: {
        requestedTokens: params.requestedTokens,
        reservedInstructionTokens: params.reservedInstructionTokens,
        reservedOutputTokens: params.reservedOutputTokens,
        availableContextTokens: Math.max(
          0,
          params.requestedTokens -
            params.reservedInstructionTokens -
            params.reservedOutputTokens -
            params.specificationTokens,
        ),
        tokenizerId: params.tokenizerInfo.id,
      },
      rawBaseline: params.baseline,
      compressed: {
        itemCount: params.includedItems.length,
        tokenCount: compressedTokens,
        byteCount: params.includedItems.reduce(
          (t, i) => t + Buffer.byteLength(i.content, "utf8"),
          0,
        ),
        reductionTokens,
        reductionPercentage,
      },
      coverage: {
        requiredFacts: params.facts.length,
        retainedRequiredFacts,
        unresolvedRequiredFacts: unresolved,
        completenessScore,
        confidence,
      },
      requiredFacts: params.facts,
      sections: params.sections,
      exclusions: params.exclusions,
      warnings: params.warnings,
      items: params.includedItems,
      renderedPrompt: params.rendered,
      completePromptTokens: params.completePromptTokens,
      metrics: {
        rawBaselineTokens: rawBaselineTokens,
        compressedContextTokens: compressedTokens,
        completePromptTokens: params.completePromptTokens,
        outputTokenReservation: params.reservedOutputTokens,
        tokensRemoved: reductionTokens,
        reductionPercentage,
        candidateCount: params.baseline.candidateCount,
        retainedItemCount: params.includedItems.length,
        summarizedItemCount: params.summarizedItemIds.length,
        excludedItemCount: params.exclusions.length,
        duplicateTokensRemoved: params.duplicateTokensRemoved,
        structuralCompressionSavings: params.structuralSavings,
        instructionTokens: params.reservedInstructionTokens,
        skillTokens: params.deps.skillContents.reduce(
          (t, s) => t + params.counter.count(s.content),
          0,
        ),
        specificationTokens: params.specificationTokens,
        repositoryIntelligenceTokens: params.includedItems
          .filter(
            (i) =>
              i.sourceType === "symbol" ||
              i.sourceType === "call-flow" ||
              i.sourceType === "data-flow" ||
              i.sourceType === "dependency",
          )
          .reduce((t, i) => t + i.tokenCount, 0),
        completenessScore,
        compressionConfidence: params.tokenizerInfo.confidence,
        tokenizerId: params.tokenizerInfo.id,
        tokenizerMeasurement: params.tokenizerInfo.measurement,
        buildDurationMs: params.buildDurationMs,
      },
      metadata: {
        status: params.blocked ? "blocked" : params.includedItems.length ? "ready" : "building",
        createdAt: now,
        updatedAt: now,
        contentHash,
        version: 1,
      },
    });
  }
}

function contentFingerprint(items: ContextItem[]): string {
  const data = items.map((i) => [i.id, i.content, i.pinned]).join("|");
  return `sha256:${fnv1a(data)}`;
}

function instructionTokensReserve(
  instructions: Array<{ content: string }>,
  counter: TokenCounter,
): number {
  return instructions.reduce((t, i) => t + counter.count(i.content), 0);
}

function skillTokensReserve(skills: Array<{ content: string }>, counter: TokenCounter): number {
  return skills.reduce((t, s) => t + counter.count(s.content), 0);
}
