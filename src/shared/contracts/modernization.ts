import { z } from "zod";

export const MODERNIZATION_SCHEMA_VERSION = 1 as const;
const Id = z.string().uuid();
const Timestamp = z.string().datetime();
const Path = z.string().min(1).max(1024);
const Text = z.string().max(40_000);

export const ModernizationCategorySchema = z.enum([
  "framework-upgrade",
  "runtime-upgrade",
  "database-migration",
  "orm-replacement",
  "architecture",
  "observability",
  "ci-cd",
  "dependency",
  "build-system",
  "testing",
  "security-hardening",
  "performance",
  "deployment",
  "api-contract",
  "modularity",
  "platform",
  "other",
]);
export type ModernizationCategory = z.infer<typeof ModernizationCategorySchema>;

export const ModernizationEffortSchema = z.enum(["trivial", "small", "medium", "large", "extra-large"]);
export type ModernizationEffort = z.infer<typeof ModernizationEffortSchema>;

export const ModernizationRiskSchema = z.enum(["low", "medium", "high", "critical"]);
export type ModernizationRisk = z.infer<typeof ModernizationRiskSchema>;

export const ModernizationRecommendationSchema = z.object({
  id: Id,
  workflowId: Id.optional(),
  category: ModernizationCategorySchema,
  title: z.string().min(1).max(500),
  summary: z.string().max(20_000),
  rationale: z.string().max(20_000).optional(),
  affectedAreas: z.array(z.string().max(500)).max(200).default([]),
  affectedFiles: z.array(Path).max(2000).default([]),
  currentState: z.string().max(20_000).optional(),
  proposedState: z.string().max(20_000).optional(),
  migrationSteps: z.array(z.string().max(5000)).max(100).default([]),
  breakingChangeRisk: ModernizationRiskSchema.default("medium"),
  estimatedEffort: ModernizationEffortSchema.default("medium"),
  dependencies: z.array(Id).max(100).default([]),
  relatedFindings: z.array(z.string().max(200)).max(200).default([]),
  recommendationSource: z.enum(["deterministic", "agent", "user"]).default("deterministic"),
  evidence: z.array(z.string().max(2000)).max(100).default([]),
  references: z.array(z.string().url().max(1000)).max(50).default([]),
  confidence: z.number().min(0).max(1).default(0.7),
  status: z.enum(["proposed", "accepted", "rejected", "deferred", "in-progress", "completed"]).default("proposed"),
  createdAt: Timestamp,
  updatedAt: Timestamp,
  contentHash: z.string().min(1).max(200),
});
export type ModernizationRecommendation = z.infer<typeof ModernizationRecommendationSchema>;

export const ModernizationAssessmentSchema = z.object({
  schemaVersion: z.literal(MODERNIZATION_SCHEMA_VERSION),
  id: Id,
  workflowId: Id.optional(),
  summary: z.string().max(40_000),
  stackInventory: z
    .object({
      languages: z.array(z.string().max(100)).max(200).default([]),
      frameworks: z.array(z.string().max(200)).max(200).default([]),
      databases: z.array(z.string().max(200)).max(100).default([]),
      orms: z.array(z.string().max(200)).max(100).default([]),
      buildSystems: z.array(z.string().max(200)).max(100).default([]),
      testFrameworks: z.array(z.string().max(200)).max(100).default([]),
      services: z.array(z.string().max(200)).max(500).default([]),
      architectureStyle: z.string().max(500).optional(),
      modularitySignals: z.array(z.string().max(1000)).max(200).default([]),
    })
    .optional(),
  recommendations: z.array(ModernizationRecommendationSchema).max(500).default([]),
  prompts: z
    .array(
      z.object({
        id: Id,
        title: z.string().max(500),
        prompt: z.string().max(20_000),
        expectedOutput: z.string().max(5000).optional(),
      }),
    )
    .max(50)
    .default([]),
  createdAt: Timestamp,
  updatedAt: Timestamp,
  contentHash: z.string().min(1).max(200),
});
export type ModernizationAssessment = z.infer<typeof ModernizationAssessmentSchema>;

export const ModernizationPersistentStateSchema = z.object({
  schemaVersion: z.literal(MODERNIZATION_SCHEMA_VERSION),
  revision: z.number().int().nonnegative(),
  assessments: z.array(ModernizationAssessmentSchema).max(200).default([]),
  updatedAt: Timestamp,
});
export type ModernizationPersistentState = z.infer<typeof ModernizationPersistentStateSchema>;
