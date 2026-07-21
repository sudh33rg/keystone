import { z } from "zod";
import {
  EvidenceRecordSchema,
  IntelligenceDiagnosticSchema,
  RelationshipRecordSchema,
  SourceRangeSchema,
  SymbolRecordSchema,
} from "./intelligence";

export const ADAPTER_SCHEMA_VERSION = 1 as const;
export const AdapterTierSchema = z.enum([
  "tier-0",
  "tier-1",
  "tier-2",
  "tier-3",
  "tier-4",
  "tier-5",
]);
export const AdapterCapabilityLevelSchema = z.enum([
  "deep",
  "semantic",
  "structural",
  "metadata-only",
  "unsupported",
]);
export const AdapterOutputKindSchema = z.enum([
  "structural",
  "semantic",
  "calculated",
  "metadata-only",
]);
export const AdapterFamilySchema = z.enum([
  "language",
  "framework",
  "test",
  "documentation",
  "database",
  "orm",
  "contract",
  "build",
  "package-manager",
  "infrastructure",
  "configuration",
  "fallback",
]);

export const AdapterCapabilitySchema = z
  .object({
    adapterId: z.string().min(1),
    version: z.string().min(1),
    family: AdapterFamilySchema,
    technologies: z.array(z.string().min(1)).min(1),
    filePatterns: z.array(z.string()),
    manifestIndicators: z.array(z.string()),
    dependencyIndicators: z.array(z.string()),
    syntaxIndicators: z.array(z.string()),
    tier: AdapterTierSchema,
    level: AdapterCapabilityLevelSchema,
    entityTypes: z.array(z.string()),
    relationshipTypes: z.array(z.string()),
    outputKind: AdapterOutputKindSchema,
    incremental: z.boolean(),
    threadSafe: z.boolean(),
    maxInputBytes: z.number().int().positive(),
    limitations: z.array(z.string()),
  })
  .strict();
export type AdapterCapability = z.infer<typeof AdapterCapabilitySchema>;

export const AdapterDetectionEvidenceSchema = z
  .object({
    kind: z.enum([
      "extension",
      "manifest",
      "dependency",
      "import",
      "syntax",
      "format",
      "configuration",
    ]),
    relativePath: z.string(),
    range: SourceRangeSchema.optional(),
    statement: z.string().min(1),
  })
  .strict();

export const AdapterDetectionSchema = z
  .object({
    technologyId: z.string().min(1),
    confidence: z.number().min(0).max(1),
    adapterId: z.string().min(1),
    capabilityLevel: AdapterCapabilityLevelSchema,
    evidence: z.array(AdapterDetectionEvidenceSchema).min(1),
    conflicts: z.array(z.string()),
    unsupportedFeatures: z.array(z.string()),
    fileIds: z.array(z.string().min(1)),
  })
  .strict();
export type AdapterDetection = z.infer<typeof AdapterDetectionSchema>;

export const AdapterDiagnosticSchema = IntelligenceDiagnosticSchema.refine(
  (value) => Boolean(value.adapterId),
  { message: "Adapter diagnostics require an adapter ID." },
).transform((value) => ({ ...value, adapterId: value.adapterId! }));
export type AdapterDiagnostic = z.infer<typeof AdapterDiagnosticSchema>;

export const AdapterExecutionMetricsSchema = z
  .object({
    adapterId: z.string().min(1),
    executionTimeMs: z.number().nonnegative(),
    filesConsidered: z.number().int().nonnegative(),
    filesParsed: z.number().int().nonnegative(),
    filesFailed: z.number().int().nonnegative(),
    cacheReused: z.number().int().nonnegative(),
    entitiesExtracted: z.number().int().nonnegative(),
    relationshipsResolved: z.number().int().nonnegative(),
    crossLinksResolved: z.number().int().nonnegative(),
    unsupportedFiles: z.number().int().nonnegative(),
    memoryWarning: z.boolean(),
  })
  .strict();

export const AdapterCoverageSchema = z
  .object({
    technologyId: z.string().min(1),
    adapterId: z.string().min(1),
    adapterVersion: z.string().min(1),
    capabilityLevel: AdapterCapabilityLevelSchema,
    filesDiscovered: z.number().int().nonnegative(),
    filesParsed: z.number().int().nonnegative(),
    filesFailed: z.number().int().nonnegative(),
    filesMetadataOnly: z.number().int().nonnegative(),
    entitiesExtracted: z.number().int().nonnegative(),
    relationshipsResolved: z.number().int().nonnegative(),
    unresolvedReferences: z.number().int().nonnegative(),
    unsupportedConstructs: z.number().int().nonnegative(),
    lastSuccessfulUpdate: z.string().datetime().optional(),
    freshness: z.enum(["current", "stale", "failed", "unsupported"]),
  })
  .strict();
export type AdapterCoverage = z.infer<typeof AdapterCoverageSchema>;

export const AdapterRegistryStateSchema = z
  .object({
    schemaVersion: z.literal(ADAPTER_SCHEMA_VERSION),
    generation: z.number().int().positive(),
    updatedAt: z.string().datetime(),
    capabilities: z.array(AdapterCapabilitySchema),
    detections: z.array(AdapterDetectionSchema),
    coverage: z.array(AdapterCoverageSchema),
    metrics: z.array(AdapterExecutionMetricsSchema),
  })
  .strict();
export type AdapterRegistryState = z.infer<typeof AdapterRegistryStateSchema>;

export const AdapterOutputSchema = z
  .object({
    adapterId: z.string().min(1),
    adapterVersion: z.string().min(1),
    sourceContentHashes: z.record(z.string(), z.string()),
    jobRevision: z.number().int().positive(),
    generationCompatibility: z.number().int().positive(),
    detections: z.array(AdapterDetectionSchema),
    entities: z.array(SymbolRecordSchema),
    relationships: z.array(RelationshipRecordSchema),
    evidence: z.array(EvidenceRecordSchema),
    diagnostics: z.array(AdapterDiagnosticSchema),
    exclusions: z.array(z.string()),
    invalidations: z.array(z.string()),
    indexUpdates: z.array(z.string()),
    okfProjectionHints: z.array(z.string()),
    metrics: AdapterExecutionMetricsSchema,
  })
  .strict();
export type AdapterOutput = z.infer<typeof AdapterOutputSchema>;

export const TechnologyCoverageRequestSchema = z
  .object({
    technologyIds: z.array(z.string().min(1)).max(50).optional(),
    levels: z.array(AdapterCapabilityLevelSchema).max(5).optional(),
    limit: z.number().int().min(1).max(100).default(50),
    cursor: z.string().optional(),
  })
  .strict();
export type TechnologyCoverageRequest = z.infer<typeof TechnologyCoverageRequestSchema>;

export const TechnologyCoverageResultSchema = z
  .object({
    generation: z.number().int().nonnegative(),
    items: z.array(AdapterCoverageSchema),
    detections: z.array(AdapterDetectionSchema),
    total: z.number().int().nonnegative(),
    nextCursor: z.string().optional(),
  })
  .strict();
export type TechnologyCoverageResult = z.infer<typeof TechnologyCoverageResultSchema>;

export const AdapterDiagnosticsRequestSchema = z
  .object({
    adapterIds: z.array(z.string().min(1)).max(50).optional(),
    technologyIds: z.array(z.string().min(1)).max(50).optional(),
    limit: z.number().int().min(1).max(100).default(50),
    cursor: z.string().optional(),
  })
  .strict();

export const AdapterDiagnosticsResultSchema = z
  .object({
    generation: z.number().int().nonnegative(),
    items: z.array(AdapterDiagnosticSchema),
    total: z.number().int().nonnegative(),
    nextCursor: z.string().optional(),
  })
  .strict();
export type AdapterDiagnosticsResult = z.infer<typeof AdapterDiagnosticsResultSchema>;
