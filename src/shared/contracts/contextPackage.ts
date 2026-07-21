/**
 * Canonical context-compression contracts for Keystone Phase 3.
 *
 * This module is the single source of truth for the measured, stage-aware
 * context-compression pipeline. It supersedes the legacy `ContextPackage` model
 * in `domain.ts` and the character-estimate based `TaskContextPackage` in
 * `delegation.ts`. Those older structures are retained only as legacy records
 * (see `markLegacyContextPackage` / migration in `ContextPersistenceStore`).
 *
 * Token counts in this model are *measured* by a `TokenCounter` (see
 * `TokenCounterRegistry`), never derived from raw character ratios alone.
 * Where a count is an approximation of a target model's true BPE tokenizer, the
 * field `measurement` is set to `"estimated"` and a warning is attached.
 */

import { z } from "zod";

export const CONTEXT_PACKAGE_SCHEMA_VERSION = 3 as const;

// ---------------------------------------------------------------------------
// Token measurement
// ---------------------------------------------------------------------------

/**
 * How a token count was obtained. `exact-local` means it was produced by a
 * tokenizer that Keystone ships and trusts; `estimated` means it is an
 * approximation of a target model family for which no exact tokenizer is
 * available. A value is NEVER labelled as an exact Copilot billing count.
 */
export const TokenMeasurementSchema = z.enum(["exact-local", "estimated"]);
export type TokenMeasurement = z.infer<typeof TokenMeasurementSchema>;

export const TokenizerInfoSchema = z
  .object({
    /** Identifier of the tokenizer that produced the counts. */
    id: z.string().min(1).max(200),
    /** Model family the count is meant to approximate, if any. */
    targetFamily: z.string().max(200).optional(),
    /** How the count should be interpreted. */
    measurement: TokenMeasurementSchema,
    /**
     * Confidence in the count relative to the real target-model tokenizer.
     * 1 for `exact-local` when the target is the shipped tokenizer, otherwise a
     * conservative heuristic confidence in (0, 1).
     */
    confidence: z.number().min(0).max(1),
    /** Whether the count is a fallback when no tokenizer could load. */
    fallback: z.boolean().default(false),
    /** Human-readable note, e.g. an explicit approximation warning. */
    note: z.string().max(1000).default(""),
  })
  .strict();
export type TokenizerInfo = z.infer<typeof TokenizerInfoSchema>;

// ---------------------------------------------------------------------------
// Candidate / item model
// ---------------------------------------------------------------------------

export const ContextSourceTypeSchema = z.enum([
  "workflow-intent",
  "specification",
  "acceptance-criterion",
  "repository-file",
  "symbol",
  "call-flow",
  "data-flow",
  "dependency",
  "test",
  "security-finding",
  "performance-finding",
  "validation-evidence",
  "stage-result",
  "instruction",
  "skill",
  "user-note",
]);
export type ContextSourceType = z.infer<typeof ContextSourceTypeSchema>;

export const ContextContentModeSchema = z.enum([
  "full",
  "excerpt",
  "signature",
  "contract",
  "summary",
  "relationship",
  "metadata",
]);
export type ContextContentMode = z.infer<typeof ContextContentModeSchema>;

export const ContextImportanceSchema = z.enum(["required", "supporting", "optional"]);
export type ContextImportance = z.infer<typeof ContextImportanceSchema>;

export const ContextSourceReferenceSchema = z
  .object({
    filePath: z.string().max(1024).optional(),
    symbolId: z.string().max(500).optional(),
    entityId: z.string().max(500).optional(),
    evidenceId: z.string().max(500).optional(),
    revision: z.string().max(200).optional(),
    startLine: z.number().int().nonnegative().optional(),
    endLine: z.number().int().nonnegative().optional(),
  })
  .strict();
export type ContextSourceReference = z.infer<typeof ContextSourceReferenceSchema>;

export const RelevanceFactorSchema = z
  .object({
    name: z.string().min(1).max(120),
    value: z.number(),
    reason: z.string().min(1).max(1000),
  })
  .strict();
export type RelevanceFactor = z.infer<typeof RelevanceFactorSchema>;

export const RelevanceExplanationSchema = z
  .object({
    totalScore: z.number(),
    factors: z.array(RelevanceFactorSchema).max(60),
  })
  .strict();
export type RelevanceExplanation = z.infer<typeof RelevanceExplanationSchema>;

export const ContextItemSchema = z
  .object({
    id: z.string().min(1).max(500),
    title: z.string().min(1).max(500),
    sourceType: ContextSourceTypeSchema,
    sourceReference: ContextSourceReferenceSchema.default({}),
    contentMode: ContextContentModeSchema,
    importance: ContextImportanceSchema,
    relevanceScore: z.number().min(0),
    /** Transparent per-factor relevance explanation. */
    relevance: RelevanceExplanationSchema.optional(),
    confidence: z.number().min(0).max(1),
    /** Tokens after any compression applied to this item. */
    tokenCount: z.number().int().nonnegative(),
    /** Tokens of the raw (pre-compression) content. */
    rawTokenCount: z.number().int().nonnegative(),
    /** Tokens saved versus the raw content of this item. */
    savedTokens: z.number().int().nonnegative().default(0),
    /** Every retained/excluded item must carry at least one reason. */
    reasons: z.array(z.string().min(1).max(1000)).max(50),
    dependencies: z.array(z.string().max(500)).max(100).default([]),
    /** Required-fact ids this item helps satisfy. */
    satisfiesRequiredFacts: z.array(z.string().max(200)).max(100).default([]),
    content: z.string().max(40_000),
    rawContentHash: z.string().min(1).max(256),
    compressedContentHash: z.string().min(1).max(256),
    /** Compressed items only: how compression was applied. */
    compressionStrategy: z.string().max(120).optional(),
    /** Structural summary text for compressed/summarized items. */
    structuralSummary: z.string().max(20_000).optional(),
    /** Whether the user pinned this context (preserved regardless of score). */
    pinned: z.boolean().default(false),
    /** Freshness at build time. */
    freshness: z.enum(["current", "stale", "unknown"]).default("current"),
    /** True once the item is selected for the agent-ready package. */
    included: z.boolean().default(true),
  })
  .strict();
export type ContextItem = z.infer<typeof ContextItemSchema>;

// ---------------------------------------------------------------------------
// Sections, exclusions, warnings
// ---------------------------------------------------------------------------

export const ContextSectionSchema = z
  .object({
    /** Logical group: required | supporting | optional | summarized. */
    group: z.enum(["required", "supporting", "optional", "summarized"]),
    title: z.string().min(1).max(500),
    itemIds: z.array(z.string().max(500)).max(500),
    tokenCount: z.number().int().nonnegative(),
    /** Compression strategy that produced the summary, if summarized. */
    compressionStrategy: z.string().max(120).optional(),
  })
  .strict();
export type ContextSection = z.infer<typeof ContextSectionSchema>;

export const ContextExclusionSchema = z
  .object({
    item: ContextItemSchema,
    reason: z.enum([
      "over-budget",
      "exact-duplicate",
      "structural-duplicate",
      "relationship-duplicate",
      "semantic-duplicate",
      "optional-removed",
      "secret",
      "sensitive",
      "excluded",
      "stale",
      "unsupported",
      "user-removed",
    ]),
    /** Tokens that were removed by this exclusion. */
    tokensRemoved: z.number().int().nonnegative(),
    /** Whether the user may restore this item. */
    restorable: z.boolean(),
    detail: z.string().max(1000).optional(),
  })
  .strict();
export type ContextExclusion = z.infer<typeof ContextExclusionSchema>;

export const ContextWarningSchema = z
  .object({
    code: z.string().min(1).max(100),
    severity: z.enum(["info", "warning", "error"]),
    message: z.string().min(1).max(2000),
    /** Item this warning is attached to, if any. */
    itemId: z.string().max(500).optional(),
  })
  .strict();
export type ContextWarning = z.infer<typeof ContextWarningSchema>;

// ---------------------------------------------------------------------------
// Required facts & completeness
// ---------------------------------------------------------------------------

export const RequiredFactStateSchema = z.enum([
  "satisfied",
  "partially-satisfied",
  "missing",
  "conflicting",
  "low-confidence",
]);
export type RequiredFactState = z.infer<typeof RequiredFactStateSchema>;

export const RequiredFactSchema = z
  .object({
    id: z.string().min(1).max(200),
    description: z.string().min(1).max(2000),
    category: z.enum([
      "target-behaviour",
      "affected-interface",
      "acceptance-criterion",
      "repository-convention",
      "constraint",
      "required-test",
      "known-risk",
      "changed-symbol",
      "output-format",
    ]),
    critical: z.boolean().default(false),
    state: RequiredFactStateSchema,
    /** Context item ids that satisfy this fact. */
    satisfiedBy: z.array(z.string().max(500)).max(100).default([]),
    /** Why this state was assigned. */
    reason: z.string().min(1).max(1000),
  })
  .strict();
export type RequiredFact = z.infer<typeof RequiredFactSchema>;

// ---------------------------------------------------------------------------
// Raw baseline (what would be sent without Keystone compression)
// ---------------------------------------------------------------------------

export const RawContextBaselineSchema = z
  .object({
    /** Number of distinct context candidates discovered. */
    candidateCount: z.number().int().nonnegative(),
    /** Number of distinct source records (files, symbols, entities) considered. */
    sourceCount: z.number().int().nonnegative(),
    /** Measured token count of the raw (uncompressed) candidate set. */
    tokenCount: z.number().int().nonnegative(),
    byteCount: z.number().int().nonnegative(),
    /** Per-source-type raw token counts for auditing (keys are source-type strings). */
    tokensBySourceType: z.record(z.string(), z.number().int().nonnegative()).default({}),
    /** Tokenizer used to measure the baseline. */
    tokenizer: TokenizerInfoSchema,
    /** Human-readable record of what sources were included in the baseline. */
    sources: z.array(z.string().max(500)).max(200).default([]),
  })
  .strict();
export type RawContextBaseline = z.infer<typeof RawContextBaselineSchema>;

// ---------------------------------------------------------------------------
// Budget
// ---------------------------------------------------------------------------

export const ContextBudgetModelSchema = z
  .object({
    /** Requested total prompt budget for the stage. */
    requestedTokens: z.number().int().nonnegative(),
    /** Tokens reserved for mandatory instructions. */
    reservedInstructionTokens: z.number().int().nonnegative(),
    /** Tokens reserved for the agent's output. */
    reservedOutputTokens: z.number().int().nonnegative(),
    /** Tokens available for repository/context content. */
    availableContextTokens: z.number().int().nonnegative(),
    tokenizerId: z.string().min(1).max(200),
  })
  .strict();
export type ContextBudgetModel = z.infer<typeof ContextBudgetModelSchema>;

// ---------------------------------------------------------------------------
// Source snapshot & metadata
// ---------------------------------------------------------------------------

export const ContextSourceSnapshotSchema = z
  .object({
    repositoryRevision: z.string().max(200).optional(),
    workspaceRevision: z.string().max(200).optional(),
    intelligenceRevision: z.string().min(1).max(200),
    specificationRevision: z.string().min(1).max(200),
    instructionRevisionHash: z.string().min(1).max(256),
    createdAt: z.string().datetime(),
  })
  .strict();
export type ContextSourceSnapshot = z.infer<typeof ContextSourceSnapshotSchema>;

export const ContextPackageStatusSchema = z.enum([
  "draft",
  "building",
  "ready",
  "blocked",
  "approved",
  "delegated",
  "stale",
  "superseded",
]);
export type ContextPackageStatus = z.infer<typeof ContextPackageStatusSchema>;

export const ContextPackageMetadataSchema = z
  .object({
    status: ContextPackageStatusSchema,
    createdAt: z.string().datetime(),
    updatedAt: z.string().datetime(),
    approvedAt: z.string().datetime().optional(),
    delegatedAt: z.string().datetime().optional(),
    contentHash: z.string().min(1).max(256),
    version: z.number().int().positive(),
  })
  .strict();
export type ContextPackageMetadata = z.infer<typeof ContextPackageMetadataSchema>;

// ---------------------------------------------------------------------------
// Canonical ContextPackage
// ---------------------------------------------------------------------------

export const ContextPackageSchema = z
  .object({
    schemaVersion: z.literal(CONTEXT_PACKAGE_SCHEMA_VERSION),
    id: z.string().uuid(),
    /** Fingerprint used for delegation staleness checks (equals metadata.contentHash). */
    contentFingerprint: z.string().min(1).max(256),
    workflowId: z.string().min(1).max(200),
    stageId: z.string().min(1).max(200),
    workItemId: z.string().uuid().optional(),
    executionProfileId: z.string().min(1).max(200),
    sourceSnapshot: ContextSourceSnapshotSchema,
    budget: ContextBudgetModelSchema,
    rawBaseline: RawContextBaselineSchema,
    compressed: z
      .object({
        itemCount: z.number().int().nonnegative(),
        tokenCount: z.number().int().nonnegative(),
        byteCount: z.number().int().nonnegative(),
        reductionTokens: z.number().int().nonnegative(),
        /** (rawBaseline.tokens - compressed.tokens) / rawBaseline.tokens * 100. */
        reductionPercentage: z.number().min(0).max(100),
      })
      .strict(),
    coverage: z
      .object({
        requiredFacts: z.number().int().nonnegative(),
        retainedRequiredFacts: z.number().int().nonnegative(),
        unresolvedRequiredFacts: z.array(z.string().max(200)).max(100),
        completenessScore: z.number().min(0).max(1),
        confidence: z.number().min(0).max(1),
      })
      .strict(),
    requiredFacts: z.array(RequiredFactSchema).max(200),
    sections: z.array(ContextSectionSchema).max(100),
    exclusions: z.array(ContextExclusionSchema).max(500),
    warnings: z.array(ContextWarningSchema).max(100),
    items: z.array(ContextItemSchema).max(500),
    /** Full rendered prompt that will be delegated (the Phase 2 package). */
    renderedPrompt: z.string().max(200_000).default(""),
    /** Complete measured prompt tokens (contract + skills + instructions + context + output reservation). */
    completePromptTokens: z.number().int().nonnegative().default(0),
    metrics: z
      .object({
        rawBaselineTokens: z.number().int().nonnegative(),
        compressedContextTokens: z.number().int().nonnegative(),
        completePromptTokens: z.number().int().nonnegative(),
        outputTokenReservation: z.number().int().nonnegative(),
        tokensRemoved: z.number().int().nonnegative(),
        reductionPercentage: z.number().min(0).max(100),
        candidateCount: z.number().int().nonnegative(),
        retainedItemCount: z.number().int().nonnegative(),
        summarizedItemCount: z.number().int().nonnegative(),
        excludedItemCount: z.number().int().nonnegative(),
        duplicateTokensRemoved: z.number().int().nonnegative(),
        structuralCompressionSavings: z.number().int().nonnegative(),
        instructionTokens: z.number().int().nonnegative(),
        skillTokens: z.number().int().nonnegative(),
        specificationTokens: z.number().int().nonnegative(),
        repositoryIntelligenceTokens: z.number().int().nonnegative(),
        completenessScore: z.number().min(0).max(1),
        compressionConfidence: z.number().min(0).max(1),
        tokenizerId: z.string().min(1).max(200),
        tokenizerMeasurement: TokenMeasurementSchema,
        buildDurationMs: z.number().nonnegative(),
      })
      .strict(),
    metadata: ContextPackageMetadataSchema,
  })
  .strict();
export type ContextPackage = z.infer<typeof ContextPackageSchema>;

// ---------------------------------------------------------------------------
// Stage context profiles
// ---------------------------------------------------------------------------

export const StageContextProfileSchema = z
  .object({
    id: z.string().min(1).max(200),
    stageType: z.string().min(1).max(100),
    name: z.string().min(1).max(200),
    description: z.string().max(1000).default(""),
    requiredCategories: z.array(ContextSourceTypeSchema).max(30),
    preferredCategories: z.array(ContextSourceTypeSchema).max(30),
    excludedCategories: z.array(ContextSourceTypeSchema).max(30).default([]),
    relationshipTraversalDepth: z.number().int().min(1).max(6).default(2),
    defaultTokenBudget: z.number().int().min(500).max(1_000_000).default(12_000),
    minimumCompletenessThreshold: z.number().min(0).max(1).default(0.8),
    compressionStrategies: z.array(z.string().max(80)).max(30),
    requiredSafetyEvidence: z.array(ContextSourceTypeSchema).max(20).default([]),
    requiredPriorStageOutputs: z.array(z.string().max(100)).max(20).default([]),
    /** Stage overrides layered on top of a built-in profile. */
    overrides: z.record(z.string(), z.unknown()).default({}),
    source: z.enum(["built-in", "workspace", "user"]).default("built-in"),
    version: z.number().int().positive().default(1),
  })
  .strict();
export type StageContextProfile = z.infer<typeof StageContextProfileSchema>;

// ---------------------------------------------------------------------------
// Build input (orchestration request)
// ---------------------------------------------------------------------------

export const ContextPackageBuildInputSchema = z
  .object({
    workflowId: z.string().min(1).max(200),
    stageId: z.string().min(1).max(200),
    workItemId: z.string().uuid().optional(),
    executionProfileId: z.string().min(1).max(200),
    budgetTokens: z.number().int().min(500).max(1_000_000).optional(),
    profileId: z.string().max(200).optional(),
    pinnedItemIds: z.array(z.string().max(500)).max(100).default([]),
    instructionIds: z.array(z.string().max(200)).max(100).default([]),
    skillIds: z.array(z.string().max(200)).max(100).default([]),
    includeWorkflowIntent: z.boolean().default(true),
    includeSpecification: z.boolean().default(true),
    includeAcceptanceCriteria: z.boolean().default(true),
    includeStageHistory: z.boolean().default(true),
    includeValidationEvidence: z.boolean().default(true),
    includeUserPinnedContext: z.boolean().default(true),
  })
  .strict();
export type ContextPackageBuildInput = z.infer<typeof ContextPackageBuildInputSchema>;

// ---------------------------------------------------------------------------
// Legacy compatibility (Phase 1 / domain.ts) — retained for migration only.
// ---------------------------------------------------------------------------

export const LegacyContextPackageSchema = z.object({
  id: z.string(),
  taskId: z.string(),
  specificationRevision: z.number(),
  repositoryIndexVersion: z.number(),
  baseCommit: z.string().optional(),
  createdAt: z.string(),
  selectionPolicyVersion: z.number(),
  budget: z.number(),
  estimatedTokens: z.number(),
  estimatedBytes: z.number(),
  items: z.array(
    z.object({
      kind: z.string(),
      sourceReference: z.string(),
      sourceFingerprint: z.string(),
      selectionReason: z.string(),
      rankScoreComponents: z.record(z.string(), z.number()),
      compressionForm: z.string(),
      estimatedTokens: z.number(),
      estimatedBytes: z.number(),
      isMandatory: z.boolean(),
      isPinned: z.boolean(),
      included: z.boolean(),
      exclusionReason: z.string().optional(),
    }),
  ),
  excludedCandidates: z.array(z.object({ id: z.string(), reason: z.string() })),
  fingerprint: z.string(),
  reviewStatus: z.enum(["unreviewed", "reviewed", "stale"]),
  reviewedAt: z.string().optional(),
  delegationAttemptId: z.string().optional(),
});
export type LegacyContextPackage = z.infer<typeof LegacyContextPackageSchema>;

/** Marker returned when a legacy record is encountered and cannot be upgraded. */
export interface LegacyContextMarker {
  legacy: true;
  reason: string;
}
