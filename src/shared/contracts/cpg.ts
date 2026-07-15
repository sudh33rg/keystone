import { z } from "zod";
import { SourceRangeSchema } from "./intelligence";

export const CPG_SCHEMA_VERSION = 1 as const;
export const CPG_PROVIDER_ID = "keystone.typescript-cpg" as const;
export const CPG_PROVIDER_VERSION = "1.0.0" as const;

export const CpgAnalysisLevelSchema = z.enum(["basic", "enriched", "on-demand"]);
export type CpgAnalysisLevel = z.infer<typeof CpgAnalysisLevelSchema>;

export const CpgNodeKindSchema = z.enum([
  "FILE", "NAMESPACE", "TYPE_DECLARATION", "METHOD", "FUNCTION", "PARAMETER", "RETURN", "BLOCK",
  "IDENTIFIER", "LITERAL", "CALL", "CONSTRUCTOR_CALL", "MEMBER_ACCESS", "ELEMENT_ACCESS", "ASSIGNMENT",
  "BINARY_EXPRESSION", "UNARY_EXPRESSION", "CONDITIONAL_EXPRESSION", "OBJECT_LITERAL", "ARRAY_LITERAL",
  "TEMPLATE_EXPRESSION", "AWAIT", "YIELD", "TYPE_ASSERTION", "VARIABLE_DECLARATION", "EXPRESSION_STATEMENT",
  "RETURN_STATEMENT", "THROW_STATEMENT", "IF", "ELSE", "SWITCH", "CASE", "LOOP", "BREAK", "CONTINUE",
  "TRY", "CATCH", "FINALLY", "ENTRY", "EXIT", "MERGE", "UNKNOWN_VALUE", "EXTERNAL_CALL", "UNRESOLVED_TARGET"
]);
export type CpgNodeKind = z.infer<typeof CpgNodeKindSchema>;

export const CpgEdgeTypeSchema = z.enum([
  "AST_CHILD", "AST_PARENT", "EVAL_NEXT", "EVAL_PREVIOUS", "CFG_NEXT", "CFG_TRUE", "CFG_FALSE", "CFG_CASE",
  "CFG_EXCEPTION", "CFG_RETURN", "CFG_BREAK", "CFG_CONTINUE", "DEFINES", "USES", "REACHING_DEFINITION",
  "FLOWS_TO", "ARGUMENT_TO_PARAMETER", "RETURN_TO_CALL", "RECEIVER_TO_CALL", "REPRESENTS_SYMBOL",
  "REFERENCES_SYMBOL", "CALLS_SYMBOL", "INSTANTIATES_SYMBOL", "BELONGS_TO_SCOPE"
]);
export type CpgEdgeType = z.infer<typeof CpgEdgeTypeSchema>;

const CpgPropertyValueSchema = z.union([z.string(), z.number(), z.boolean(), z.array(z.string())]);

export const CpgNodeSchema = z.object({
  id: z.string().min(1),
  fileId: z.string().min(1),
  scopeId: z.string().min(1),
  semanticSymbolId: z.string().min(1).optional(),
  referencedSemanticEntityId: z.string().min(1).optional(),
  kind: CpgNodeKindSchema,
  code: z.string().max(500).optional(),
  range: SourceRangeSchema.optional(),
  typeName: z.string().max(500).optional(),
  evaluationIndex: z.number().int().nonnegative().optional(),
  evidenceIds: z.array(z.string().min(1)).min(1).max(20),
  parserVersion: z.string().min(1),
  generation: z.number().int().positive(),
  properties: z.record(z.string(), CpgPropertyValueSchema).optional()
}).strict();
export type CpgNode = z.infer<typeof CpgNodeSchema>;

export const CpgEdgeSchema = z.object({
  id: z.string().min(1),
  sourceId: z.string().min(1),
  targetId: z.string().min(1),
  type: CpgEdgeTypeSchema,
  derivation: z.enum(["extracted", "resolved", "calculated"]),
  confidence: z.number().min(0).max(1),
  evidenceIds: z.array(z.string().min(1)).min(1).max(20),
  fileId: z.string().min(1),
  scopeId: z.string().min(1),
  generation: z.number().int().positive(),
  properties: z.record(z.string(), CpgPropertyValueSchema).optional()
}).strict();
export type CpgEdge = z.infer<typeof CpgEdgeSchema>;

export const CpgDiagnosticCodeSchema = z.enum([
  "unsupported-syntax", "unresolved-call", "ambiguous-call", "dynamic-property", "unsupported-aliasing",
  "unresolved-type", "approximate-data-flow", "incomplete-exception-model", "analysis-timeout", "truncated-result",
  "stale-cpg", "provider-version-mismatch", "unreachable-code"
]);
export const CpgDiagnosticSchema = z.object({
  id: z.string().min(1),
  code: CpgDiagnosticCodeSchema,
  severity: z.enum(["info", "warning", "error"]),
  message: z.string().min(1),
  fileId: z.string().min(1),
  scopeId: z.string().min(1),
  range: SourceRangeSchema.optional(),
  nodeId: z.string().min(1).optional(),
  confidence: z.number().min(0).max(1).optional()
}).strict();
export type CpgDiagnostic = z.infer<typeof CpgDiagnosticSchema>;

export const CpgScopeSummarySchema = z.object({
  parameters: z.number().int().nonnegative(),
  returns: z.number().int().nonnegative(),
  calls: z.number().int().nonnegative(),
  branches: z.number().int().nonnegative(),
  reads: z.number().int().nonnegative(),
  writes: z.number().int().nonnegative(),
  localVariables: z.number().int().nonnegative(),
  unresolvedCalls: z.number().int().nonnegative(),
  approximateFlows: z.number().int().nonnegative()
}).strict();
export type CpgScopeSummary = z.infer<typeof CpgScopeSummarySchema>;

export const CpgScopeDescriptorSchema = z.object({
  id: z.string().min(1),
  fileId: z.string().min(1),
  semanticSymbolId: z.string().min(1),
  name: z.string().min(1),
  kind: z.enum(["function", "method", "constructor", "getter", "setter", "arrow", "callback", "module"]),
  range: SourceRangeSchema,
  sourceHash: z.string().min(1),
  structuralHash: z.string().min(1),
  providerId: z.string().min(1),
  providerVersion: z.string().min(1),
  schemaVersion: z.literal(CPG_SCHEMA_VERSION),
  analysisLevel: CpgAnalysisLevelSchema,
  generation: z.number().int().positive(),
  nodeCount: z.number().int().nonnegative(),
  edgeCount: z.number().int().nonnegative(),
  summary: CpgScopeSummarySchema,
  shard: z.string().min(1)
}).strict();
export type CpgScopeDescriptor = z.infer<typeof CpgScopeDescriptorSchema>;

export const CpgScopeArtifactSchema = z.object({
  descriptor: CpgScopeDescriptorSchema,
  entryNodeId: z.string().min(1),
  exitNodeId: z.string().min(1),
  nodes: z.array(CpgNodeSchema),
  edges: z.array(CpgEdgeSchema),
  diagnostics: z.array(CpgDiagnosticSchema),
  reused: z.boolean().default(false)
}).strict().superRefine((artifact, context) => {
  const ids = new Set(artifact.nodes.map((node) => node.id));
  if (!ids.has(artifact.entryNodeId)) context.addIssue({ code: "custom", message: "CPG entry node is missing.", path: ["entryNodeId"] });
  if (!ids.has(artifact.exitNodeId)) context.addIssue({ code: "custom", message: "CPG exit node is missing.", path: ["exitNodeId"] });
  artifact.edges.forEach((edge, index) => {
    if (!ids.has(edge.sourceId) || !ids.has(edge.targetId)) context.addIssue({ code: "custom", message: "CPG edge endpoint is missing.", path: ["edges", index] });
  });
});
export type CpgScopeArtifact = z.infer<typeof CpgScopeArtifactSchema>;

export const CpgGenerationManifestSchema = z.object({
  schemaVersion: z.literal(CPG_SCHEMA_VERSION),
  semanticGeneration: z.number().int().positive(),
  providerVersions: z.record(z.string(), z.string()),
  scopes: z.array(CpgScopeDescriptorSchema),
  indexes: z.object({
    scopeBySymbol: z.record(z.string(), z.array(z.string().min(1))),
    calls: z.record(z.string(), z.number().int().nonnegative()), reads: z.record(z.string(), z.number().int().nonnegative()),
    writes: z.record(z.string(), z.number().int().nonnegative()), dataFlow: z.record(z.string(), z.number().int().nonnegative())
  }).strict(),
  metrics: z.object({
    scopesBuilt: z.number().int().nonnegative(),
    scopesReused: z.number().int().nonnegative(),
    buildTimeMs: z.number().nonnegative(),
    shardBytes: z.number().int().nonnegative(),
    analysisFailures: z.number().int().nonnegative(),
    approximateResults: z.number().int().nonnegative(),
    staleJobsDiscarded: z.number().int().nonnegative()
  }).strict()
}).strict();
export type CpgGenerationManifest = z.infer<typeof CpgGenerationManifestSchema>;

export interface CpgDelta {
  semanticGeneration: number;
  providerId: string;
  providerVersion: string;
  scopes: CpgScopeArtifact[];
  removedScopeIds: string[];
  buildTimeMs: number;
}

export const CpgOverlaysSchema = z.array(z.enum(["ast", "evaluation", "control-flow", "data-flow", "calls"])).max(5);
export const CpgScopeQuerySchema = z.object({
  semanticSymbolId: z.string().min(1),
  overlays: CpgOverlaysSchema.default(["control-flow", "data-flow", "calls"]),
  maxNodes: z.number().int().min(1).max(500).default(200),
  includeSource: z.boolean().default(true)
}).strict();
export type CpgScopeQuery = z.input<typeof CpgScopeQuerySchema>;

export const CpgSliceQuerySchema = z.object({
  semanticSymbolId: z.string().min(1),
  nodeId: z.string().min(1).optional(),
  location: SourceRangeSchema.optional(),
  direction: z.enum(["backward", "forward"]),
  includeConditions: z.boolean().default(true),
  maxNodes: z.number().int().min(1).max(300).default(100),
  maxDepth: z.number().int().min(1).max(20).default(8),
  maxPaths: z.number().int().min(1).max(50).default(10),
  timeBudgetMs: z.number().int().min(10).max(5000).default(500)
}).strict().refine((value) => Boolean(value.nodeId || value.location), { message: "A CPG node or source location is required." });
export type CpgSliceQuery = z.input<typeof CpgSliceQuerySchema>;

export const CpgSourceFragmentSchema = z.object({ nodeId: z.string(), range: SourceRangeSchema, code: z.string().max(500), order: z.number().int().nonnegative() }).strict();
export const CpgQueryResultSchema = z.object({
  generation: z.number().int().nonnegative(),
  scope: CpgScopeDescriptorSchema,
  entryNodeId: z.string(),
  exitNodeId: z.string(),
  nodes: z.array(CpgNodeSchema).max(500),
  edges: z.array(CpgEdgeSchema).max(2000),
  diagnostics: z.array(CpgDiagnosticSchema).max(100),
  truncated: z.boolean()
}).strict();
export type CpgQueryResult = z.infer<typeof CpgQueryResultSchema>;

export const CpgSliceResultSchema = z.object({
  generation: z.number().int().nonnegative(),
  scope: CpgScopeDescriptorSchema,
  direction: z.enum(["backward", "forward"]),
  nodes: z.array(CpgNodeSchema).max(300),
  edges: z.array(CpgEdgeSchema).max(1200),
  fragments: z.array(CpgSourceFragmentSchema).max(300),
  paths: z.array(z.array(z.string()).max(300)).max(50),
  conditions: z.array(CpgNodeSchema).max(100),
  diagnostics: z.array(CpgDiagnosticSchema).max(100),
  unsupportedBoundaries: z.array(z.string()).max(100),
  confidence: z.number().min(0).max(1),
  truncated: z.boolean()
}).strict();
export type CpgSliceResult = z.infer<typeof CpgSliceResultSchema>;
