/**
 * Phase 5 — Canonical engineering-query model (spec §4, §5, §11, §12, §15, §18, §30).
 *
 * Deterministic, LLM-free. Every query flows through:
 *   parse -> resolve -> plan -> execute -> visualize -> evidence -> explain.
 * No relationship is invented: builders read the existing IntelligenceSnapshot only.
 */
import { z } from "zod";

/* ------------------------------------------------------------------ */
/* §5 — Bounded intent taxonomy                                        */
/* ------------------------------------------------------------------ */

export const EngineeringQueryIntentSchema = z.enum([
  "find-entity",
  "describe-entity",
  "show-callers",
  "show-callees",
  "show-usages",
  "show-references",
  "show-dependencies",
  "show-dependents",
  "show-implementations",
  "show-inheritance",
  "show-related-tests",
  "show-covered-code",
  "show-impact",
  "show-flow",
  "show-path",
  "show-data-reads",
  "show-data-writes",
  "show-data-flow",
  "show-entry-points",
  "show-side-effects",
  "show-architecture",
  "show-evidence",
  "show-configuration-usage",
  "show-event-handlers",
  "show-api-storage-path",
  "compare-entities",
]);
export type EngineeringQueryIntent = z.infer<typeof EngineeringQueryIntentSchema>;

export const GuidedQueryTypeSchema = z.enum([
  "architecture",
  "describe",
  "dependencies",
  "dependents",
  "callers",
  "callees",
  "usages",
  "implementations",
  "related-tests",
  "covered-code",
  "impact",
  "data-reads",
  "data-writes",
  "flow",
  "path",
  "evidence",
  "compare",
]);
export type GuidedQueryType = z.infer<typeof GuidedQueryTypeSchema>;

/* ------------------------------------------------------------------ */
/* §4 — Resolved entity candidate (entity resolution output)             */
/* ------------------------------------------------------------------ */

export const ResolvedEntityCandidateSchema = z.object({
  entityId: z.string().min(1).max(512),
  displayName: z.string().min(1).max(512),
  qualifiedName: z.string().max(1024),
  kind: z.string().max(128),
  location: z
    .object({
      relativePath: z.string().max(1024),
      startLine: z.number().int().nonnegative().optional(),
      startColumn: z.number().int().nonnegative().optional(),
      endLine: z.number().int().nonnegative().optional(),
      endColumn: z.number().int().nonnegative().optional(),
    })
    .strict()
    .optional(),
  confidence: z.number().min(0).max(1),
  reason: z.string().max(1024),
  repositoryScope: z.string().max(200),
  supportingAliases: z.array(z.string().max(512)).max(40),
});
export type ResolvedEntityCandidate = z.infer<typeof ResolvedEntityCandidateSchema>;

export const ResolvedEntitySummarySchema = z.object({
  entityId: z.string().min(1).max(512),
  displayName: z.string().min(1).max(512),
  kind: z.string().max(128),
  relativePath: z.string().max(1024),
});
export type ResolvedEntitySummary = z.infer<typeof ResolvedEntitySummarySchema>;

/* ------------------------------------------------------------------ */
/* §11 / §4 — Modifiers + scope                                      */
/* ------------------------------------------------------------------ */

export const QueryModifierSchema = z.enum([
  "direct-only",
  "transitive",
  "one-level",
  "up-to-n-levels",
  "production-only",
  "tests-only",
  "include-tests",
  "exclude-tests",
  "include-external",
  "exclude-generated",
  "high-confidence-only",
  "changed-code-only",
  "current-module-only",
  "current-package-only",
  "all-implementations",
  "shortest-path",
  "all-paths",
  "writes-only",
  "reads-only",
]);
export type QueryModifier = z.infer<typeof QueryModifierSchema>;

export const EngineeringQueryScopeSchema = z.object({
  repositoryId: z.string().min(1).max(200),
  packageIds: z.array(z.string().min(1).max(200)).max(30).optional(),
  moduleIds: z.array(z.string().min(1).max(200)).max(30).optional(),
  filePatterns: z.array(z.string().min(1).max(200)).max(30).optional(),
  includeProduction: z.boolean().default(true),
  includeTests: z.boolean().default(false),
  includeGenerated: z.boolean().default(false),
  includeExternal: z.boolean().default(false),
  traversalDirection: z.enum(["inbound", "outbound", "both"]).optional(),
  traversalDepth: z.number().int().min(1).max(12).optional(),
  confidenceThreshold: z.number().min(0).max(1).optional(),
});
export type EngineeringQueryScope = z.infer<typeof EngineeringQueryScopeSchema>;

/* ------------------------------------------------------------------ */
/* §12 — Plan                                                          */
/* ------------------------------------------------------------------ */

export const QueryPlanStepSchema = z.object({
  id: z.string().min(1).max(100),
  operation: z.enum([
    "resolve-entity",
    "load-neighbors",
    "traverse-graph",
    "find-path",
    "find-tests",
    "find-covered-code",
    "find-data-access",
    "build-flow",
    "build-impact",
    "load-evidence",
    "group-results",
    "rank-results",
  ]),
  inputs: z.record(z.string(), z.unknown()).default({}),
  dependsOn: z.array(z.string().min(1).max(100)).max(20).default([]),
  optional: z.boolean().optional().default(false),
});
export type QueryPlanStep = z.infer<typeof QueryPlanStepSchema>;

export const EngineeringQueryPlanSchema = z.object({
  intent: EngineeringQueryIntentSchema,
  steps: z.array(QueryPlanStepSchema).max(40),
  expectedView: z.enum([
    "list",
    "tree",
    "architecture",
    "dependencies",
    "calls",
    "flow",
    "data",
    "tests",
    "impact",
    "evidence",
  ]),
  limits: z.object({
    maximumNodes: z.number().int().min(1).max(5000),
    maximumEdges: z.number().int().min(1).max(8000),
    maximumPaths: z.number().int().min(1).max(200),
    maximumDepth: z.number().int().min(1).max(12),
  }),
});
export type EngineeringQueryPlan = z.infer<typeof EngineeringQueryPlanSchema>;

/* ------------------------------------------------------------------ */
/* §4 — Top-level EngineeringQuery record (persisted)                   */
/* ------------------------------------------------------------------ */

export const EngineeringQueryExecutionStatusSchema = z.enum([
  "draft",
  "ready",
  "running",
  "completed",
  "partial",
  "failed",
  "cancelled",
]);
export type EngineeringQueryExecutionStatus = z.infer<typeof EngineeringQueryExecutionStatusSchema>;

export const EngineeringQueryAmbiguityStateSchema = z.enum([
  "resolved",
  "needs-selection",
  "partially-resolved",
  "unresolved",
]);
export type EngineeringQueryAmbiguityState = z.infer<typeof EngineeringQueryAmbiguityStateSchema>;

export const EngineeringQuerySchema = z.object({
  id: z.string().min(1).max(100),
  input: z.object({
    originalText: z.string().min(1).max(2000).optional(),
    guidedQueryType: GuidedQueryTypeSchema.optional(),
    contextualAction: z.string().max(200).optional(),
  }),
  interpretation: z.object({
    intent: EngineeringQueryIntentSchema,
    subjectCandidates: z.array(ResolvedEntityCandidateSchema).max(20),
    selectedSubjectIds: z.array(z.string().min(1).max(512)).max(20),
    targetCandidates: z.array(ResolvedEntityCandidateSchema).max(20).optional(),
    selectedTargetIds: z.array(z.string().min(1).max(512)).max(20).optional(),
    modifiers: z.array(QueryModifierSchema).max(20).default([]),
    confidence: z.number().min(0).max(1),
    ambiguityState: EngineeringQueryAmbiguityStateSchema,
  }),
  scope: EngineeringQueryScopeSchema,
  plan: EngineeringQueryPlanSchema,
  execution: z.object({
    status: EngineeringQueryExecutionStatusSchema,
    startedAt: z.string().datetime().optional(),
    completedAt: z.string().datetime().optional(),
    resultId: z.string().max(100).optional(),
    error: z
      .object({
        code: z.string().min(1).max(100),
        message: z.string().min(1).max(1000),
        technicalDetails: z.string().max(4000).optional(),
        recoverable: z.boolean().default(true),
        suggestedAction: z.string().max(1000).optional(),
        affectedStep: z.string().max(100).optional(),
      })
      .strict()
      .optional(),
  }),
  metadata: z.object({
    workflowId: z.string().max(200).optional(),
    stageId: z.string().max(200).optional(),
    workItemId: z.string().max(200).optional(),
    createdAt: z.string().datetime(),
    updatedAt: z.string().datetime(),
    intelligenceRevision: z.string().max(200),
  }),
});
export type EngineeringQuery = z.infer<typeof EngineeringQuerySchema>;

/* ------------------------------------------------------------------ */
/* §15 — Result model                                                  */
/* ------------------------------------------------------------------ */

export const EngineeringQueryResultItemSchema = z.object({
  entityId: z.string().min(1).max(512),
  displayName: z.string().min(1).max(512),
  kind: z.string().max(128),
  relativePath: z.string().max(1024),
  relationship: z.string().max(128).optional(),
  confidenceCategory: z.enum(["proven", "derived", "inferred", "unresolved"]).optional(),
  reason: z.string().max(1024).optional(),
  isSubject: z.boolean().default(false),
  isTarget: z.boolean().default(false),
});
export type EngineeringQueryResultItem = z.infer<typeof EngineeringQueryResultItemSchema>;

export const QueryRefinementSuggestionSchema = z.object({
  id: z.string().min(1).max(100),
  label: z.string().min(1).max(200),
  kind: z.enum([
    "change-subject",
    "change-target",
    "change-scope",
    "change-depth",
    "change-direction",
    "include-tests",
    "exclude-tests",
    "include-external",
    "exclude-external",
    "change-confidence",
    "switch-direct-transitive",
    "switch-path-mode",
    "add-to-workflow-context",
  ]),
  // A partial override applied to the original query to create a new version.
  patch: z
    .object({
      intent: EngineeringQueryIntentSchema.optional(),
      modifiers: z.array(QueryModifierSchema).optional(),
      traversalDepth: z.number().int().min(1).max(12).optional(),
      traversalDirection: z.enum(["inbound", "outbound", "both"]).optional(),
      includeTests: z.boolean().optional(),
      includeExternal: z.boolean().optional(),
      confidenceThreshold: z.number().min(0).max(1).optional(),
      subjectOverrideId: z.string().min(1).max(512).optional(),
    })
    .strict()
    .optional(),
});
export type QueryRefinementSuggestion = z.infer<typeof QueryRefinementSuggestionSchema>;

export const EngineeringQueryResultSchema = z.object({
  id: z.string().min(1).max(100),
  queryId: z.string().min(1).max(100),
  interpretationSummary: z.object({
    intent: EngineeringQueryIntentSchema,
    subjects: z.array(ResolvedEntitySummarySchema).max(20),
    targets: z.array(ResolvedEntitySummarySchema).max(20).optional(),
    scopeDescription: z.string().min(1).max(1000),
    confidence: z.number().min(0).max(1),
  }),
  summary: z.object({
    title: z.string().min(1).max(500),
    description: z.string().min(1).max(2000),
    findingCount: z.number().int().nonnegative(),
    warningCount: z.number().int().nonnegative(),
    truncated: z.boolean(),
  }),
  items: z.array(EngineeringQueryResultItemSchema).max(5000),
  visualization: z.unknown().optional(), // IntelligenceVisualization
  evidence: z.object({
    evidenceIds: z.array(z.string().min(1).max(500)).max(2000),
    unresolvedCount: z.number().int().nonnegative(),
    lowConfidenceCount: z.number().int().nonnegative(),
  }),
  refinements: z.array(QueryRefinementSuggestionSchema).max(30),
  metadata: z.object({
    executedAt: z.string().datetime(),
    durationMs: z.number().nonnegative(),
    intelligenceRevision: z.string().max(200),
    contentHash: z.string().max(200),
  }),
});
export type EngineeringQueryResult = z.infer<typeof EngineeringQueryResultSchema>;

/* ------------------------------------------------------------------ */
/* §22 — Saved parameterized query                                      */
/* ------------------------------------------------------------------ */

export const SavedQuerySchema = z.object({
  id: z.string().min(1).max(100),
  name: z.string().min(1).max(200),
  intent: EngineeringQueryIntentSchema,
  fixedScope: EngineeringQueryScopeSchema.optional(),
  placeholders: z
    .array(z.enum(["entity", "changedFiles", "entryPoint", "databaseEntity", "module"]))
    .max(5)
    .default([]),
  defaultModifiers: z.array(QueryModifierSchema).max(20).default([]),
  expectedView: EngineeringQueryPlanSchema.shape.expectedView,
  workflowStageApplicability: z.array(z.string().max(100)).max(20).optional(),
  isBuiltIn: z.boolean().default(false),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
});
export type SavedQuery = z.infer<typeof SavedQuerySchema>;

/* ------------------------------------------------------------------ */
/* §21 — History record                                                */
/* ------------------------------------------------------------------ */

export const QueryHistoryEntrySchema = z.object({
  id: z.string().min(1).max(100),
  queryId: z.string().min(1).max(100),
  originalText: z.string().min(1).max(2000).optional(),
  guidedQueryType: GuidedQueryTypeSchema.optional(),
  intent: EngineeringQueryIntentSchema,
  resolvedSubjects: z.array(ResolvedEntitySummarySchema).max(20),
  scope: EngineeringQueryScopeSchema,
  resultSummary: z.string().min(1).max(2000),
  executionTimeMs: z.number().nonnegative(),
  workflowId: z.string().max(200).optional(),
  intelligenceRevision: z.string().max(200),
  pinned: z.boolean().default(false),
  stale: z.boolean().default(false),
  createdAt: z.string().datetime(),
});
export type QueryHistoryEntry = z.infer<typeof QueryHistoryEntrySchema>;

/* ------------------------------------------------------------------ */
/* §27 — Local feedback                                                */
/* ------------------------------------------------------------------ */

export const QueryFeedbackSchema = z.object({
  id: z.string().min(1).max(100),
  queryId: z.string().min(1).max(100),
  rating: z.enum([
    "correct-interpretation",
    "wrong-subject",
    "wrong-intent",
    "useful-result",
    "missing-result",
    "incorrect-relationship",
    "too-broad",
    "too-narrow",
  ]),
  note: z.string().max(2000).optional(),
  createdAt: z.string().datetime(),
});
export type QueryFeedback = z.infer<typeof QueryFeedbackSchema>;

/* ------------------------------------------------------------------ */
/* §7 — Phrase dictionary entry (centralized, extensible)              */
/* ------------------------------------------------------------------ */

export const PhraseEntrySchema = z.object({
  patterns: z.array(z.string().min(1).max(200)).max(40),
  intent: EngineeringQueryIntentSchema,
  direction: z.enum(["inbound", "outbound", "both"]).optional(),
  // Optional entity-type hint to bias resolution (spec §6).
  subjectTypeHint: z.string().max(128).optional(),
  targetTypeHint: z.string().max(128).optional(),
});
export type PhraseEntry = z.infer<typeof PhraseEntrySchema>;

export const QueryPhraseDictionarySchema = z.object({
  source: z.enum(["built-in", "project"]).default("built-in"),
  entries: z.array(PhraseEntrySchema).max(400),
  aliases: z
    .array(
      z.object({
        alias: z.string().min(1).max(200),
        canonical: z.string().min(1).max(512),
      }),
    )
    .max(400)
    .default([]),
});
export type QueryPhraseDictionary = z.infer<typeof QueryPhraseDictionarySchema>;
