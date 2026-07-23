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
import type { FailureCategory } from "../../shared/contracts/qaTestIntelligence";

export interface HealingContextInput {
  workflowId: string;
  stageId: string;
  workItemId: string;
  executionProfileId: string;
  failureAnalysisId: string;
  category: FailureCategory;
  /** Failed test name and file. */
  testName: string;
  testFilePath: string;
  /** Raw failure output. */
  failureOutput: string;
  /** Failure signature. */
  failureSignature: string;
  /** Relevant stack frames. */
  stackFrames: string[];
  /** Related production code (path -> content). */
  relatedProduction: Array<{ path: string; content: string }>;
  /** Related fixture / mock code (path -> content). */
  relatedFixtureOrMock: Array<{ path: string; content: string }>;
  /** Approved specification text. */
  approvedSpecification: string;
  /** Representative neighbouring tests (path -> content). */
  neighbouringTests: Array<{ path: string; content: string }>;
  /** Test framework configuration text. */
  frameworkConfig: string;
  /** Healing policy text. */
  healingPolicy: string;
  /** Allowed output paths (relative). */
  allowedOutputPaths: string[];
  budgetTokens: number;
}

/**
 * Builds the test-healing context package, reusing the Phase 5 compression
 * primitives. Prioritizes the failed test, its output, the accepted failure
 * classification, and the allowed output paths. Excludes the complete repo,
 * unrelated failures, full historical logs, and secret environment values.
 */
export class TestHealingContextService {
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

  build(input: HealingContextInput): ContextPackage {
    const started = Date.now();
    const { counter, warning } = this.registry.resolveSafe();
    const tokenizer = counter.info();

    const rawItems = this.rawItems(input, counter);
    const rawBaselineTokens = counter.countSections(rawItems.map((item) => item.content));
    const deduped = this.deduplicator.deduplicate(rawItems);
    const compressed = this.compressor.compress(deduped.items, healingProfile(input.budgetTokens), counter);

    const policyTokens = counter.count(input.healingPolicy);
    const skillTokens = 0;
    const instructionTokens = counter.count(input.frameworkConfig);
    const reservedOutputTokens = Math.min(2_000, Math.max(400, Math.round(input.budgetTokens * 0.2)));
    const budget = {
      requestedTokens: input.budgetTokens,
      reservedInstructionTokens: instructionTokens,
      reservedOutputTokens,
      availableContextTokens: Math.max(0, input.budgetTokens - instructionTokens - reservedOutputTokens - skillTokens - policyTokens),
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
        intelligenceRevision: `healing-context:${input.failureAnalysisId}`,
        specificationRevision: "1",
        instructionRevisionHash: hash([input.frameworkConfig, input.healingPolicy]),
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
        ...(criticalMissing ? [{ code: "context-incomplete", severity: "error" as const, message: "Critical required healing context is missing. Approval is blocked." }] : []),
      ],
      items: optimized.included,
      renderedPrompt: "",
      completePromptTokens: compressedTokens + instructionTokens + policyTokens,
      metrics: {
        rawBaselineTokens,
        compressedContextTokens: compressedTokens,
        completePromptTokens: compressedTokens + instructionTokens + policyTokens,
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

  private rawItems(input: HealingContextInput, counter: ReturnType<TokenCounterRegistry["resolveSafe"]>["counter"]): ContextItem[] {
    const specs: Array<{ id: string; title: string; type: ContextItem["sourceType"]; content: string; importance: ContextItem["importance"] }> = [
      { id: "heal:failed-test", title: `Failed test: ${input.testName}`, type: "test", content: `${input.testFilePath}\n${input.testName}`, importance: "required" },
      { id: "heal:failure-output", title: "Failure output", type: "validation-evidence", content: input.failureOutput, importance: "required" },
      { id: "heal:signature", title: "Failure signature", type: "validation-evidence", content: input.failureSignature, importance: "required" },
      { id: "heal:stack", title: "Relevant stack frames", type: "validation-evidence", content: input.stackFrames.join("\n"), importance: "supporting" },
      { id: "heal:classification", title: "Accepted classification", type: "stage-result", content: input.category, importance: "required" },
      ...input.relatedProduction.map((item) => ({ id: `heal:prod:${item.path}`, title: item.path, type: "repository-file" as const, content: item.content, importance: "supporting" as const })),
      ...input.relatedFixtureOrMock.map((item) => ({ id: `heal:fx:${item.path}`, title: item.path, type: "test" as const, content: item.content, importance: "required" as const })),
      { id: "heal:spec", title: "Approved specification", type: "specification", content: input.approvedSpecification, importance: "required" },
      ...input.neighbouringTests.map((item) => ({ id: `heal:neighbour:${item.path}`, title: item.path, type: "test" as const, content: item.content, importance: "supporting" as const })),
      { id: "heal:framework", title: "Test framework configuration", type: "instruction", content: input.frameworkConfig, importance: "required" },
      { id: "heal:policy", title: "Healing policy", type: "instruction", content: input.healingPolicy, importance: "required" },
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
        reasons: [item.importance === "required" ? "Required healing input." : "Supporting healing context."],
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

  private requiredFacts(input: HealingContextInput, items: ContextItem[]): RequiredFact[] {
    const present = new Set(items.map((item) => item.id));
    const facts: Array<[string, string, RequiredFact["category"], string[]]> = [
      ["failed-test", "Failed test", "required-test", ["heal:failed-test"]],
      ["failure-output", "Failure output", "validation-evidence", ["heal:failure-output"]],
      ["classification", "Accepted classification", "known-risk", ["heal:classification"]],
      ["fixture-or-mock", "Related fixture or mock", "target-behaviour", input.relatedFixtureOrMock.map((t) => `heal:fx:${t.path}`)],
      ["framework", "Test framework configuration", "repository-convention", ["heal:framework"]],
      ["policy", "Healing policy", "output-format", ["heal:policy"]],
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
        reason: satisfied ? "All required healing inputs are retained." : "Required healing input is absent from the compressed package.",
      };
    });
  }
}

function healingProfile(budget: number): StageContextProfile {
  return {
    id: "healing-context-v1",
    stageType: "qa",
    name: "Test healing context",
    description: "Bounded test-healing inputs",
    requiredCategories: ["test", "validation-evidence", "stage-result", "instruction", "specification"],
    preferredCategories: ["repository-file"],
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

function rawSources(input: HealingContextInput): string[] {
  return [
    `failed test ${input.testName}`,
    "failure output",
    "failure signature",
    "stack frames",
    input.category,
    ...input.relatedProduction.map((t) => t.path),
    ...input.relatedFixtureOrMock.map((t) => t.path),
    "approved specification",
    ...input.neighbouringTests.map((t) => t.path),
    "test framework configuration",
    "healing policy",
  ];
}

function hash(value: unknown): string {
  return createHash("sha256").update(typeof value === "string" ? value : JSON.stringify(value)).digest("hex");
}
