import { z } from "zod";
import { CpgQueryResultSchema, CpgSliceResultSchema } from "./cpg";
import { EvidenceRecordSchema, RelationshipRecordSchema } from "./intelligence";

export const QueryOperationSchema = z.enum([
  "SEARCH", "ENTITY", "NEIGHBORHOOD", "USAGES", "DEPENDENCIES", "DEPENDENTS", "PATH", "IMPACT", "FLOW",
  "TESTS_FOR", "UNTESTED", "ARCHITECTURE", "CYCLES", "DATA_USAGE", "CONFIGURATION_USAGE", "CHANGES_TO",
  "DIFFERENCE_BETWEEN", "CPG_SCOPE", "CONTROL_FLOW", "DATA_FLOW", "BACKWARD_SLICE", "FORWARD_SLICE",
  "CONDITIONS_FOR", "OKF_CONCEPT"
]);
export type QueryOperation = z.infer<typeof QueryOperationSchema>;

export const QueryDirectionSchema = z.enum(["incoming", "outgoing", "both"]);
export const EntitySelectorSchema = z.object({
  id: z.string().min(1).optional(), value: z.string().min(1).max(512).optional(),
  kind: z.enum(["stable-id", "qualified-name", "name", "path", "route", "configuration", "database", "package", "alias", "cpg-node"]).default("name"),
  entityTypes: z.array(z.string().min(1)).max(20).optional(), language: z.string().min(1).optional(), packageId: z.string().min(1).optional(), moduleId: z.string().min(1).optional()
}).strict().refine((value) => Boolean(value.id || value.value), { message: "An entity selector requires an ID or value." });
export type EntitySelector = z.input<typeof EntitySelectorSchema>;

export const QueryFiltersSchema = z.object({
  entityTypes: z.array(z.string().min(1)).max(50).optional(), relationshipTypes: z.array(z.string().min(1)).max(50).optional(),
  modules: z.array(z.string().min(1)).max(30).optional(), packages: z.array(z.string().min(1)).max(30).optional(), languages: z.array(z.string().min(1)).max(30).optional(),
  confidenceAtLeast: z.number().min(0).max(1).default(0), capabilityLevels: z.array(z.enum(["deep", "semantic", "structural", "metadata-only", "unsupported"])).max(5).optional(),
  derivations: z.array(z.string().min(1)).max(20).optional(), branch: z.string().min(1).optional(), commit: z.string().min(1).optional(), compareTo: z.string().min(1).optional(),
  currentFile: z.string().max(1024).optional(), pinnedEntityIds: z.array(z.string().min(1)).max(50).optional(), publicOnly: z.boolean().optional()
}).strict();

export const TraversalSpecSchema = z.object({
  direction: QueryDirectionSchema.default("both"), maxDepth: z.number().int().min(1).max(20).default(3),
  stopEntityTypes: z.array(z.string().min(1)).max(30).optional(), stopRelationshipTypes: z.array(z.string().min(1)).max(30).optional(),
  pathMode: z.enum(["shortest", "shortest-typed", "all-bounded", "highest-confidence", "lowest-risk"]).default("shortest")
}).strict();

export const IncludeSpecSchema = z.object({ source: z.boolean().default(false), evidence: z.boolean().default(true), relationships: z.boolean().default(true), diagnostics: z.boolean().default(true), explanation: z.boolean().default(true), cpg: z.boolean().default(false) }).strict();
export const RankingSpecSchema = z.object({ strategy: z.enum(["relevance", "distance", "confidence", "risk", "recent-change", "test-relevance", "centrality"]).default("relevance"), descending: z.boolean().default(true) }).strict();
export const QueryLimitsSchema = z.object({
  results: z.number().int().min(1).max(100).default(25), nodes: z.number().int().min(1).max(500).default(100), edges: z.number().int().min(1).max(1500).default(300),
  paths: z.number().int().min(1).max(20).default(5), depth: z.number().int().min(1).max(20).default(3), evidence: z.number().int().min(0).max(100).default(30),
  timeBudgetMs: z.number().int().min(10).max(5000).default(1000), cursor: z.string().max(512).optional()
}).strict();
export type QueryLimits = z.infer<typeof QueryLimitsSchema>;

export const IntelligenceQuerySchema = z.object({
  operation: QueryOperationSchema, seeds: z.array(EntitySelectorSchema).max(10).optional(), filters: QueryFiltersSchema.default({ confidenceAtLeast: 0 }),
  traversal: TraversalSpecSchema.default({ direction: "both", maxDepth: 3, pathMode: "shortest" }), include: IncludeSpecSchema.default({ source: false, evidence: true, relationships: true, diagnostics: true, explanation: true, cpg: false }),
  ranking: RankingSpecSchema.default({ strategy: "relevance", descending: true }), limits: QueryLimitsSchema.default({ results: 25, nodes: 100, edges: 300, paths: 5, depth: 3, evidence: 30, timeBudgetMs: 1000 }),
  generation: z.number().int().positive().optional(), branch: z.string().min(1).optional()
}).strict();
export type IntelligenceQuery = z.input<typeof IntelligenceQuerySchema>;
export type CompiledIntelligenceQuery = z.output<typeof IntelligenceQuerySchema>;

export const QueryDiagnosticSchema = z.object({ code: z.string().min(1), severity: z.enum(["info", "warning", "error"]), message: z.string().min(1), template: z.string().optional(), selectorIndex: z.number().int().nonnegative().optional(), limitation: z.boolean().optional() }).strict();
export type QueryDiagnostic = z.infer<typeof QueryDiagnosticSchema>;
export const ResolutionCandidateSchema = z.object({ id: z.string(), type: z.string(), name: z.string(), qualifiedName: z.string(), relativePath: z.string(), confidence: z.number().min(0).max(1), score: z.number(), reasons: z.array(z.string()).max(20) }).strict();
export const ResolvedEntitySchema = z.object({ selector: EntitySelectorSchema, selected: ResolutionCandidateSchema.optional(), candidates: z.array(ResolutionCandidateSchema).max(20), ambiguous: z.boolean(), requiresSelection: z.boolean(), reasons: z.array(z.string()).max(20) }).strict();
export type ResolvedEntity = z.infer<typeof ResolvedEntitySchema>;

const PrimitiveSchema = z.union([z.string(), z.number(), z.boolean(), z.array(z.string())]);
export const QueryResultItemSchema = z.object({
  id: z.string(), type: z.string(), name: z.string(), qualifiedName: z.string().optional(), relativePath: z.string().optional(), score: z.number(), confidence: z.number().min(0).max(1),
  classification: z.enum(["exact", "resolved", "structurally-inferred", "convention-based", "cpg-assisted", "candidate", "unresolved"]), rankingReasons: z.array(z.string()).max(20), group: z.string().optional(), details: z.record(z.string(), PrimitiveSchema).optional()
}).strict();
export type QueryResultItem = z.infer<typeof QueryResultItemSchema>;
export const QueryPathStepSchema = z.object({ entityId: z.string(), entityName: z.string(), entityType: z.string(), relationshipId: z.string().optional(), relationshipType: z.string().optional(), confidence: z.number().min(0).max(1), classification: QueryResultItemSchema.shape.classification, evidenceIds: z.array(z.string()).max(20), capabilityBoundary: z.string().optional() }).strict();
export type QueryPathStep = z.infer<typeof QueryPathStepSchema>;
export const QueryPathSchema = z.object({ steps: z.array(QueryPathStepSchema).max(50), confidence: z.number().min(0).max(1), risk: z.number().nonnegative(), unsupportedBoundaries: z.array(z.string()).max(20), truncated: z.boolean() }).strict();

export const QueryDataSchema = z.object({
  kind: z.string().min(1), items: z.array(QueryResultItemSchema).max(100).default([]), nodes: z.array(QueryResultItemSchema).max(500).default([]), relationships: z.array(RelationshipRecordSchema).max(1500).default([]),
  paths: z.array(QueryPathSchema).max(20).default([]), sections: z.record(z.string(), z.array(QueryResultItemSchema).max(100)).default({}), metrics: z.record(z.string(), z.number()).default({}),
  cpg: z.union([CpgQueryResultSchema, CpgSliceResultSchema]).optional()
}).strict();
export type QueryData = z.infer<typeof QueryDataSchema>;

export const QueryExplanationSchema = z.object({
  parsedAs: z.string(), parserRule: z.string(), indexesUsed: z.array(z.string()).max(30), relationshipFamilies: z.array(z.string()).max(50), confidenceThreshold: z.number().min(0).max(1),
  rankingRules: z.array(z.string()).max(30), truncationReasons: z.array(z.string()).max(20), capabilityBoundaries: z.array(z.string()).max(50), steps: z.array(z.string()).max(50)
}).strict();
export type QueryExplanation = z.infer<typeof QueryExplanationSchema>;
export const QueryPlanSchema = z.object({
  operation: QueryOperationSchema,
  resolvedSeedIds: z.array(z.string()).max(10),
  ambiguousCandidateIds: z.array(z.string()).max(200),
  indexesSelected: z.array(z.string()).max(30),
  relationshipFamilies: z.array(z.string()).max(50),
  traversalDirection: QueryDirectionSchema,
  maximumDepth: z.number().int().min(0).max(20),
  confidenceThreshold: z.number().min(0).max(1),
  capabilityThresholds: z.array(z.enum(["deep", "semantic", "structural", "metadata-only", "unsupported"])).max(5),
  cpgRequired: z.boolean(),
  resultLimits: QueryLimitsSchema,
  evidenceRequired: z.boolean(),
  timeBudgetMs: z.number().int().min(10).max(5000)
}).strict();
export type QueryPlan = z.infer<typeof QueryPlanSchema>;
export const EvidenceSummarySchema = EvidenceRecordSchema.pick({ id: true, subjectId: true, relativePath: true, range: true, extractorId: true, extractorVersion: true, derivation: true, confidence: true, statement: true });

export const IntelligenceQueryResultSchema = z.object({
  queryId: z.string().uuid(), operation: QueryOperationSchema, generation: z.number().int().nonnegative(), repositoryState: z.object({ repositoryId: z.string(), branch: z.string().optional(), headCommit: z.string().optional(), generation: z.number().int().nonnegative() }).strict(),
  executionTimeMs: z.number().nonnegative(), resolvedSeeds: z.array(ResolvedEntitySchema).max(10), plan: QueryPlanSchema, data: QueryDataSchema, evidence: z.array(EvidenceSummarySchema).max(100), diagnostics: z.array(QueryDiagnosticSchema).max(100), explanation: QueryExplanationSchema,
  truncated: z.boolean(), continuationToken: z.string().optional(), cacheState: z.enum(["hit", "miss", "bypassed", "invalidated"])
}).strict();
export type IntelligenceQueryResult = z.infer<typeof IntelligenceQueryResultSchema>;

export const QueryCompileRequestSchema = z.object({ text: z.string().min(1).max(1000), generation: z.number().int().positive().optional(), branch: z.string().optional(), currentFile: z.string().max(1024).optional(), limits: QueryLimitsSchema.partial().optional() }).strict();
export const UnifiedQueryRequestSchema = z.object({ text: z.string().min(1).max(1000).optional(), query: IntelligenceQuerySchema.optional(), currentFile: z.string().max(1024).optional() }).strict().refine((value) => Boolean(value.text || value.query), { message: "A structured query or deterministic query text is required." });
export type UnifiedQueryRequest = z.input<typeof UnifiedQueryRequestSchema>;
export const QueryCancelRequestSchema = z.object({ queryId: z.string().uuid() }).strict();
export const QueryExplanationRequestSchema = z.object({ queryId: z.string().uuid() }).strict();
export const QueryCompilationSchema = z.object({ input: z.string(), parsed: z.boolean(), rule: z.string(), query: IntelligenceQuerySchema.optional(), diagnostics: z.array(QueryDiagnosticSchema).max(20), suggestedTemplates: z.array(z.string()).max(20) }).strict();
export type QueryCompilation = z.infer<typeof QueryCompilationSchema>;
export const QuerySuggestionRequestSchema = z.object({ input: z.string().max(512), limit: z.number().int().min(1).max(20).default(10), entityTypes: z.array(z.string()).max(20).optional() }).strict();
export const QuerySuggestionSchema = z.object({ value: z.string(), label: z.string(), kind: z.enum(["entity", "template", "relationship", "operation"]), detail: z.string(), entityId: z.string().optional() }).strict();
export const QuerySuggestionsResultSchema = z.object({ generation: z.number().int().nonnegative(), items: z.array(QuerySuggestionSchema).max(20) }).strict();
export const QueryTemplatesResultSchema = z.object({ templates: z.array(z.object({ id: z.string(), label: z.string(), template: z.string(), operation: QueryOperationSchema }).strict()).max(50) }).strict();
export type QuerySuggestionsResult = z.infer<typeof QuerySuggestionsResultSchema>;
export type QueryTemplatesResult = z.infer<typeof QueryTemplatesResultSchema>;

export const QueryLifecycleEventSchema = z.object({ queryId: z.string().uuid(), operation: QueryOperationSchema.optional(), generation: z.number().int().nonnegative().optional(), progress: z.number().min(0).max(100).optional(), message: z.string().max(500), diagnostic: QueryDiagnosticSchema.optional() }).strict();
