import { createHash, randomUUID } from "node:crypto";
import {
  CONTEXT_PACKAGE_SCHEMA_VERSION,
  ContextPackageSchema,
  type ContextExclusion,
  type ContextItem,
  type ContextPackage,
  type ContextSection,
  type RequiredFact,
  type StageContextProfile,
} from "../../shared/contracts/contextPackage";
import { TokenCounterRegistry } from "../context/TokenCounterRegistry";
import { ContextDeduplicator } from "../context/ContextDeduplicator";
import { ContextCompressionService } from "../context/ContextCompressionService";
import { TokenBudgetOptimizer } from "../context/TokenBudgetOptimizer";
import type { TestScenario } from "../../shared/contracts/qaTestIntelligence";

export interface GenerationContextInput {
  workflowId: string;
  stageId: string;
  workItemId: string;
  executionProfileId: string;
  generationRequestId: string;
  coverageGapReason: string;
  /** Approved scenarios for this generation request. */
  scenarios: TestScenario[];
  /** Detected target production code (path -> content). */
  targetProduction: Array<{ path: string; content: string }>;
  /** Affected flow description texts. */
  affectedFlows: string[];
  /** Acceptance criteria texts. */
  acceptanceCriteria: string[];
  /** Representative existing test files (path -> content). */
  existingTests: Array<{ path: string; content: string }>;
  /** Test framework configuration text. */
  frameworkConfig: string;
  /** Fixture / mock convention text. */
  fixtureConventions: string;
  /** Selected Test Generation skill fragment. */
  skillFragment: string;
  /** Selected instruction texts. */
  instructions: string[];
  /** Allowed output paths (relative). */
  allowedOutputPaths: string[];
  /** Unrelated repository files that MUST be excluded. */
  excludedSources: string[];
  budgetTokens: number;
}

/**
 * Builds the test-generation context package by reusing the Phase 5
 * compression primitives (measured token counting, deduplication, structural
 * compression, budget optimization). Produces a real ContextPackage with a
 * package id, revision, and content hash, exactly as the Development stage.
 */
export class TestGenerationContextService {
  private readonly registry = new TokenCounterRegistry();
  private readonly deduplicator = new ContextDeduplicator();
  private readonly compressor = new ContextCompressionService();
  private readonly optimizer = new TokenBudgetOptimizer();
  private readonly now: () => string;
  private readonly createId: () => string;

  constructor(now: () => string = () => new Date().toISOString(), createId: () => string = randomUUID) {
    this.now = now;
    this.createId = createId;
  }

  build(input: GenerationContextInput): ContextPackage {
    const started = Date.now();
    const { counter, warning } = this.registry.resolveSafe();
    const tokenizer = counter.info();

    const rawItems = this.rawItems(input, counter);
    const rawBaselineTokens = counter.countSections(rawItems.map((item) => item.content));
    const deduped = this.deduplicator.deduplicate(rawItems);
    const compressed = this.compressor.compress(deduped.items, generationProfile(input.budgetTokens), counter);

    const skillTokens = counter.count(input.skillFragment);
    const instructionTokens = counter.countSections(input.instructions);
    const reservedOutputTokens = Math.min(2_000, Math.max(400, Math.round(input.budgetTokens * 0.2)));
    const budget = {
      requestedTokens: input.budgetTokens,
      reservedInstructionTokens: instructionTokens,
      reservedOutputTokens,
      availableContextTokens: Math.max(0, input.budgetTokens - instructionTokens - reservedOutputTokens - skillTokens),
      tokenizerId: tokenizer.id,
    };

    const optimized = this.optimizer.optimize({
      items: compressed.items,
      budget,
      reservedSectionTokens: { contract: 80, skills: skillTokens, instructions: instructionTokens, specification: 0 },
      pinnedIds: rawItems.filter((i) => i.pinned).map((i) => i.id),
      counter,
    });

    const exclusions: ContextExclusion[] = [
      ...deduped.exclusions,
      ...optimized.excluded.map((entry) => ({ ...entry, reason: "over-budget" as const })),
    ];
    const facts = this.requiredFacts(input, optimized.included);
    const criticalMissing = facts.some((fact) => fact.critical && fact.state !== "satisfied");
    const blocked = optimized.impossible || criticalMissing;
    const compressedTokens = optimized.included.reduce((sum, item) => sum + item.tokenCount, 0);
    const reductionTokens = Math.max(0, rawBaselineTokens - compressedTokens);
    const reductionPercentage = rawBaselineTokens ? Math.min(100, (reductionTokens / rawBaselineTokens) * 100) : 0;
    const timestamp = this.now();
    const contentHash = hash({
      items: optimized.included.map((item) => [item.id, item.compressedContentHash, item.pinned]),
      exclusions: exclusions.map((item) => [item.item.id, item.reason]),
      budget,
      allowed: input.allowedOutputPaths,
    });
    const sections = buildSections(optimized.included, compressed.summarizedItemIds);
    const satisfied = facts.filter((fact) => fact.state === "satisfied").length;

    return ContextPackageSchema.parse({
      schemaVersion: CONTEXT_PACKAGE_SCHEMA_VERSION,
      id: this.createId(),
      contentFingerprint: contentHash,
      workflowId: input.workflowId,
      stageId: input.stageId,
      workItemId: input.workItemId,
      executionProfileId: input.executionProfileId,
      sourceSnapshot: {
        workspaceRevision: hash(input),
        intelligenceRevision: `generation-context:${input.generationRequestId}`,
        specificationRevision: String(input.scenarios.length),
        instructionRevisionHash: hash(input.instructions),
        createdAt: timestamp,
      },
      budget,
      rawBaseline: {
        candidateCount: rawItems.length,
        sourceCount: rawItems.length,
        tokenCount: rawBaselineTokens,
        byteCount: rawItems.reduce((sum, item) => sum + Buffer.byteLength(item.content), 0),
        tokensBySourceType: tokenGroups(rawItems),
        tokenizer,
        sources: rawSources(input),
      },
      compressed: {
        itemCount: optimized.included.length,
        tokenCount: compressedTokens,
        byteCount: optimized.included.reduce((sum, item) => sum + Buffer.byteLength(item.content), 0),
        reductionTokens,
        reductionPercentage,
      },
      coverage: {
        requiredFacts: facts.length,
        retainedRequiredFacts: satisfied,
        unresolvedRequiredFacts: facts.filter((fact) => fact.state !== "satisfied").map((fact) => fact.id),
        completenessScore: facts.length ? satisfied / facts.length : 1,
        confidence: facts.length ? satisfied / facts.length : 1,
      },
      requiredFacts: facts,
      sections,
      exclusions,
      warnings: [
        ...(warning ? [{ code: "tokenizer-approximation", severity: "warning" as const, message: warning }] : []),
        ...optimized.warnings,
        ...(criticalMissing ? [{ code: "context-incomplete", severity: "error" as const, message: "Critical required context is missing. Approval is blocked." }] : []),
      ],
      items: optimized.included,
      renderedPrompt: "",
      completePromptTokens: compressedTokens + instructionTokens + skillTokens,
      metrics: {
        rawBaselineTokens,
        compressedContextTokens: compressedTokens,
        completePromptTokens: compressedTokens + instructionTokens + skillTokens,
        outputTokenReservation: reservedOutputTokens,
        tokensRemoved: reductionTokens,
        reductionPercentage,
        candidateCount: rawItems.length,
        retainedItemCount: optimized.included.length,
        summarizedItemCount: compressed.summarizedItemIds.length,
        excludedItemCount: exclusions.length,
        duplicateTokensRemoved: deduped.duplicateTokensRemoved,
        structuralCompressionSavings: compressed.structuralSavings,
        instructionTokens,
        skillTokens,
        specificationTokens: 0,
        repositoryIntelligenceTokens: optimized.included
          .filter((item) => item.sourceType === "repository-file" || item.sourceType === "symbol")
          .reduce((sum, item) => sum + item.tokenCount, 0),
        completenessScore: facts.length ? satisfied / facts.length : 1,
        compressionConfidence: tokenizer.confidence,
        tokenizerId: tokenizer.id,
        tokenizerMeasurement: tokenizer.measurement,
        buildDurationMs: Date.now() - started,
      },
      metadata: {
        status: blocked ? "blocked" : "ready",
        createdAt: timestamp,
        updatedAt: timestamp,
        contentHash,
        version: 1,
      },
    });
  }

  private rawItems(input: GenerationContextInput, counter: ReturnType<TokenCounterRegistry["resolveSafe"]>["counter"]): ContextItem[] {
    const specs: Array<{ id: string; title: string; type: ContextItem["sourceType"]; content: string; importance: ContextItem["importance"] }> = [
      { id: "gen:coverage-gap", title: "Coverage gap", type: "acceptance-criterion", content: input.coverageGapReason, importance: "required" },
      ...input.scenarios.map((scenario) => ({ id: `gen:scenario:${scenario.id}`, title: scenario.title, type: "acceptance-criterion" as const, content: `${scenario.title}\n${scenario.behaviour}\nAction: ${scenario.action}\nExpected: ${scenario.expectedOutcome.join("\n")}`, importance: scenario.importance === "required" ? ("required" as const) : ("supporting" as const) })),
      ...input.targetProduction.map((item) => ({ id: `gen:target:${item.path}`, title: item.path, type: "repository-file" as const, content: item.content, importance: "required" as const })),
      ...input.affectedFlows.map((flow, index) => ({ id: `gen:flow:${index}`, title: "Affected flow", type: "call-flow" as const, content: flow, importance: "supporting" as const })),
      ...input.acceptanceCriteria.map((ac, index) => ({ id: `gen:ac:${index}`, title: "Acceptance criterion", type: "acceptance-criterion" as const, content: ac, importance: "required" as const })),
      ...input.existingTests.map((item) => ({ id: `gen:existing-test:${item.path}`, title: item.path, type: "test" as const, content: item.content, importance: "supporting" as const })),
      { id: "gen:framework", title: "Test framework configuration", type: "instruction", content: input.frameworkConfig, importance: "required" },
      { id: "gen:fixtures", title: "Fixture / mock conventions", type: "instruction", content: input.fixtureConventions, importance: "supporting" },
      { id: "gen:skill", title: "Test Generation skill", type: "skill", content: input.skillFragment, importance: "required" },
      ...input.instructions.map((text, index) => ({ id: `gen:instruction:${index}`, title: "Instruction", type: "instruction" as const, content: text, importance: "required" as const })),
      ...input.excludedSources.map((text, index) => ({ id: `gen:excluded:${index}`, title: "Excluded unrelated source", type: "repository-file" as const, content: text, importance: "optional" as const })),
    ];
    return specs.map((item) => {
      const tokens = counter.count(item.content);
      const contentHash = hash(item.content);
      return {
        id: item.id,
        title: item.title,
        sourceType: item.type,
        sourceReference: {},
        contentMode: "full" as const,
        importance: item.importance,
        relevanceScore: item.importance === "required" ? 100 : 50,
        confidence: 1,
        tokenCount: tokens,
        rawTokenCount: tokens,
        savedTokens: 0,
        reasons: [item.importance === "required" ? "Required generation input." : "Supporting generation context."],
        dependencies: [],
        satisfiesRequiredFacts: [],
        content: item.content,
        rawContentHash: contentHash,
        compressedContentHash: contentHash,
        pinned: false,
        freshness: "current" as const,
        included: true,
      };
    });
  }

  private requiredFacts(input: GenerationContextInput, items: ContextItem[]): RequiredFact[] {
    const present = new Set(items.map((item) => item.id));
    const facts: Array<[string, string, RequiredFact["category"], string[]]> = [
      ["coverage-gap", "Coverage gap", "required-test", ["gen:coverage-gap"]],
      ["scenarios", "Approved scenarios", "acceptance-criterion", input.scenarios.map((s) => `gen:scenario:${s.id}`)],
      ["target-production", "Target production code", "target-behaviour", input.targetProduction.map((t) => `gen:target:${t.path}`)],
      ["framework", "Test framework configuration", "repository-convention", ["gen:framework"]],
      ["skill", "Test Generation skill", "output-format", ["gen:skill"]],
    ];
    return facts.map(([id, description, category, candidates]) => {
      const satisfiedBy = candidates.filter((c) => present.has(c));
      const satisfied = candidates.length > 0 && satisfiedBy.length === candidates.length;
      return {
        id,
        description,
        category,
        critical: true,
        state: satisfied ? ("satisfied" as const) : satisfiedBy.length ? ("partially-satisfied" as const) : ("missing" as const),
        satisfiedBy,
        reason: satisfied ? "All required generation inputs are retained." : "Required generation input is absent from the compressed package.",
      };
    });
  }
}

function generationProfile(budget: number): StageContextProfile {
  return {
    id: "generation-context-v1",
    stageType: "qa",
    name: "Test generation context",
    description: "Bounded test-generation inputs",
    requiredCategories: ["acceptance-criterion", "repository-file", "skill", "instruction"],
    preferredCategories: ["test", "call-flow"],
    excludedCategories: [],
    relationshipTraversalDepth: 1,
    defaultTokenBudget: budget,
    minimumCompletenessThreshold: 1,
    compressionStrategies: ["structural-summary", "signature", "contract-extraction"],
    requiredSafetyEvidence: [],
    requiredPriorStageOutputs: [],
    overrides: {},
    source: "built-in",
    version: 1,
  };
}

function buildSections(items: ContextItem[], summarized: string[]): ContextSection[] {
  const sections: ContextSection[] = (["required", "supporting", "optional"] as const).flatMap((importance) => {
    const selected = items.filter((item) => item.importance === importance);
    return selected.length ? [{ group: importance, title: `${importance[0]!.toUpperCase()}${importance.slice(1)}`, itemIds: selected.map((item) => item.id), tokenCount: selected.reduce((sum, item) => sum + item.tokenCount, 0) }] : [];
  });
  if (summarized.length) sections.push({ group: "summarized", title: "Summarized", itemIds: summarized, tokenCount: items.filter((item) => summarized.includes(item.id)).reduce((sum, item) => sum + item.tokenCount, 0), compressionStrategy: "deterministic-structural-summary" });
  return sections;
}

function tokenGroups(items: ContextItem[]): Record<string, number> {
  return items.reduce<Record<string, number>>((groups, item) => ({ ...groups, [item.sourceType]: (groups[item.sourceType] ?? 0) + item.rawTokenCount }), {});
}

function rawSources(input: GenerationContextInput): string[] {
  return [
    "coverage gap",
    ...input.scenarios.map((s) => s.title),
    ...input.targetProduction.map((t) => t.path),
    ...input.affectedFlows.map(() => "affected flow"),
    "test framework configuration",
    ...input.existingTests.map((t) => t.path),
    "Test Generation skill",
    ...input.instructions.map(() => "instruction"),
    ...input.excludedSources.map(() => "excluded unrelated source"),
  ];
}

function hash(value: unknown): string {
  return createHash("sha256").update(typeof value === "string" ? value : JSON.stringify(value)).digest("hex");
}
