import { z } from "zod";

export const LAYER_DEEP_DIVE_SCHEMA_VERSION = 1 as const;
const Id = z.string().uuid();
const Timestamp = z.string().datetime();
const Text = z.string().max(40_000);

export const LayerDeepDiveLayerSchema = z.enum([
  "qa",
  "pr-review",
  "security",
  "performance",
  "modernization",
]);
export type LayerDeepDiveLayer = z.infer<typeof LayerDeepDiveLayerSchema>;

export const DeepDiveStatusSchema = z.enum(["queued", "running", "complete", "failed", "cancelled"]);
export type DeepDiveStatus = z.infer<typeof DeepDiveStatusSchema>;

export const LayerDeepDiveRequestSchema = z.object({
  schemaVersion: z.literal(LAYER_DEEP_DIVE_SCHEMA_VERSION),
  id: Id,
  workflowId: z.string().min(1).max(200),
  layer: LayerDeepDiveLayerSchema,
  prompt: z.string().min(1).max(20_000),
  contextFocus: z.array(z.string().max(500)).max(20).default([]),
  boundedTokenCeiling: z.number().int().nonnegative().max(200_000).default(80_000),
  delegateToCopilot: z.boolean().default(true),
  relatedFindingIds: z.array(z.string().max(200)).max(200).default([]),
  correlationId: z.string().min(1).max(200),
});
export type LayerDeepDiveRequest = z.infer<typeof LayerDeepDiveRequestSchema>;

export const LayerDeepDiveResponseSchema = z.object({
  schemaVersion: z.literal(LAYER_DEEP_DIVE_SCHEMA_VERSION),
  id: Id,
  requestId: Id,
  workflowId: z.string().min(1).max(200),
  layer: LayerDeepDiveLayerSchema,
  status: DeepDiveStatusSchema,
  prompt: z.string().max(20_000),
  contextSummary: z.string().max(40_000).optional(),
  recommendation: z.string().max(40_000).optional(),
  structuredFindings: z.array(z.any()).max(500).default([]),
  evidenceIds: z.array(z.string().max(200)).max(200).default([]),
  confidence: z.number().min(0).max(1).optional(),
  delegationMode: z.enum(["direct", "assisted", "clipboard", "local"]).optional(),
  copilotResponse: z.string().max(100_000).optional(),
  errors: z.array(z.string().max(2000)).max(100).default([]),
  startedAt: Timestamp.optional(),
  finishedAt: Timestamp.optional(),
  createdAt: Timestamp,
  updatedAt: Timestamp,
  contentHash: z.string().min(1).max(200),
});
export type LayerDeepDiveResponse = z.infer<typeof LayerDeepDiveResponseSchema>;

export const LayerDeepDivePersistentStateSchema = z.object({
  schemaVersion: z.literal(LAYER_DEEP_DIVE_SCHEMA_VERSION),
  revision: z.number().int().nonnegative(),
  requests: z.array(LayerDeepDiveRequestSchema).max(1000).default([]),
  responses: z.array(LayerDeepDiveResponseSchema).max(1000).default([]),
  updatedAt: Timestamp,
});
export type LayerDeepDivePersistentState = z.infer<typeof LayerDeepDivePersistentStateSchema>;
