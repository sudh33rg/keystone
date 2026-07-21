import { z } from "zod";

export const INTEGRATION_SCHEMA_VERSION = 1 as const;
export const RepositoryStateRefSchema = z
  .object({
    repositoryId: z.string().min(1).max(1000),
    rootPathIdentity: z.string().min(1).max(1000),
    branch: z.string().max(500).optional(),
    head: z.string().max(500).optional(),
    intelligenceGeneration: z.number().int().nonnegative().optional(),
    stagedFingerprint: z.string().max(500).optional(),
    workingTreeFingerprint: z.string().max(500).optional(),
    capturedAt: z.string().datetime(),
  })
  .strict();
export type RepositoryStateRef = z.infer<typeof RepositoryStateRefSchema>;

export const StalenessReasonSchema = z.enum([
  "specification-revised",
  "task-updated",
  "branch-changed",
  "head-changed",
  "relevant-files-changed",
  "intelligence-generation-changed",
  "context-invalidated",
  "validation-invalidated",
  "agent-unavailable",
  "repository-unavailable",
  "imported-state-incompatible",
  "delivery-change-set-changed",
]);
export const StalenessRecordSchema = z
  .object({
    id: z.string().uuid(),
    reason: StalenessReasonSchema,
    previousFingerprint: z.string().max(1000).optional(),
    currentFingerprint: z.string().max(1000).optional(),
    affectedType: z.enum([
      "workflow",
      "specification",
      "task",
      "context",
      "delegation",
      "execution",
      "validation",
      "delivery",
      "handoff",
    ]),
    affectedId: z.string().min(1).max(1000),
    automaticRegenerationSafe: z.boolean(),
    requiredUserAction: z.string().min(1).max(2000),
    detectedAt: z.string().datetime(),
  })
  .strict();
export type StalenessRecord = z.infer<typeof StalenessRecordSchema>;

export const OperationContextSchema = z
  .object({
    schemaVersion: z.literal(INTEGRATION_SCHEMA_VERSION),
    operationId: z.string().uuid(),
    correlationId: z.string().uuid(),
    repositoryId: z.string().max(1000).optional(),
    workflowId: z.string().uuid().optional(),
    taskId: z.string().uuid().optional(),
    startedAt: z.string().datetime(),
  })
  .strict();
export type OperationContext = z.infer<typeof OperationContextSchema>;

export const StartupStageSchema = z.enum([
  "extension-activated",
  "workspace-detecting",
  "repository-detecting",
  "persistence-restoring",
  "intelligence-checking",
  "intelligence-building",
  "feature-services-ready",
  "ready",
  "degraded",
  "failed",
]);
export const StartupStateSchema = z
  .object({
    schemaVersion: z.literal(INTEGRATION_SCHEMA_VERSION),
    stage: StartupStageSchema,
    status: z.enum(["pending", "running", "ready", "degraded", "failed"]),
    message: z.string().max(2000),
    startedAt: z.string().datetime(),
    updatedAt: z.string().datetime(),
    durationMs: z.number().nonnegative(),
    diagnostics: z
      .array(
        z
          .object({
            id: z.string().uuid(),
            category: z.enum([
              "configuration",
              "workspace",
              "repository",
              "intelligence",
              "persistence",
              "copilot",
              "context",
              "delegation",
              "execution",
              "validation",
              "git",
              "handoff",
              "security",
              "internal",
            ]),
            message: z.string().max(2000),
            dataPreserved: z.boolean(),
            retrySafe: z.boolean(),
            suggestedRecovery: z.string().max(2000),
          })
          .strict(),
      )
      .max(100),
  })
  .strict();
export type StartupState = z.infer<typeof StartupStateSchema>;

export const SCHEMA_VERSION_REGISTRY = Object.freeze({
  integration: INTEGRATION_SCHEMA_VERSION,
  foundation: 1,
  intelligence: 1,
  cpg: 1,
  adapters: 1,
  delegation: 1,
  execution: 1,
  delivery: 1,
  team: 1,
  orchestration: 1,
});
