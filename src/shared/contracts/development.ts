import { z } from "zod";
import { CanonicalWorkflowSchema } from "./canonicalWorkflow";

export const DEVELOPMENT_SCHEMA_VERSION = 1 as const;
export const DevelopmentWorkItemStatusSchema = z.enum(["ready", "editing", "prompt-prepared", "handed-off", "awaiting-result", "result-recorded", "awaiting-review", "completed", "failed"]);
export const DevelopmentScopeSourceSchema = z.enum(["file-picker", "current-editor", "current-selection", "intelligence"]);
export const DevelopmentScopeAvailabilitySchema = z.enum(["available", "missing", "unresolved"]);
export const DevelopmentChangeStatusSchema = z.enum(["added", "modified", "deleted", "renamed"]);

export const DevelopmentWorkItemSchema = z.object({
  id: z.string().uuid(), workflowId: z.string().uuid(), stageId: z.string().uuid(),
  objective: z.string().trim().min(1).max(10_000), status: DevelopmentWorkItemStatusSchema,
  sourceScopeIds: z.array(z.string().uuid()).max(500), promptPreparationId: z.string().uuid().optional(),
  handoffId: z.string().uuid().optional(), resultId: z.string().uuid().optional(),
  createdAt: z.string().datetime(), updatedAt: z.string().datetime(),
}).strict();

export const DevelopmentScopeItemSchema = z.object({
  id: z.string().uuid(), workflowId: z.string().uuid(), workItemId: z.string().uuid(),
  kind: z.enum(["file", "symbol"]), fileUri: z.string().min(1).max(20_000), workspaceRelativePath: z.string().min(1).max(10_000),
  symbol: z.object({ entityId: z.string().min(1).max(500), name: z.string().min(1).max(500), kind: z.string().min(1).max(100), range: z.object({ startLine: z.number().int().nonnegative(), endLine: z.number().int().nonnegative() }).strict().optional() }).strict().optional(),
  source: DevelopmentScopeSourceSchema, availability: DevelopmentScopeAvailabilitySchema, createdAt: z.string().datetime(),
}).strict();

export const DevelopmentPromptPreparationSchema = z.object({
  id: z.string().uuid(), workflowId: z.string().uuid(), workItemId: z.string().uuid(), content: z.string().min(1).max(200_000), contentHash: z.string().regex(/^[a-f0-9]{64}$/),
  sourceScopeIds: z.array(z.string().uuid()).max(500), objectiveRevision: z.number().int().positive(), specificationRevision: z.number().int().positive().optional(),
  executionProfileId: z.string().uuid().optional(), executionProfileHash: z.string().regex(/^[a-f0-9]{64}$/).optional(),
  status: z.enum(["prepared", "superseded", "handed-off"]), createdAt: z.string().datetime(),
}).strict();

export const DevelopmentHandoffSchema = z.object({
  id: z.string().uuid(), workflowId: z.string().uuid(), workItemId: z.string().uuid(), promptPreparationId: z.string().uuid(),
  mode: z.enum(["clipboard", "supported-chat-command"]), status: z.enum(["prepared", "handed-off", "failed"]),
  handedOffAt: z.string().datetime().optional(), error: z.object({ code: z.string().min(1), message: z.string().min(1) }).strict().optional(),
}).strict();

export const DevelopmentResultSchema = z.object({
  id: z.string().uuid(), workflowId: z.string().uuid(), workItemId: z.string().uuid(), handoffId: z.string().uuid().optional(),
  executionOrigin: z.enum(["keystone-handoff", "manual"]), summary: z.string().trim().min(1).max(20_000), decisions: z.string().trim().max(20_000).optional(),
  assumptions: z.string().trim().max(20_000).optional(), testsRun: z.string().trim().max(20_000).optional(), unresolvedIssues: z.string().trim().max(20_000).optional(),
  associatedChangedFiles: z.array(z.string().min(1).max(10_000)).max(1000), excludedChangedFiles: z.array(z.object({ path: z.string().min(1).max(10_000), reason: z.string().trim().min(1).max(2000) }).strict()).max(1000),
  noCode: z.object({ explanation: z.string().trim().min(1).max(5000), confirmed: z.literal(true) }).strict().optional(),
  reviewStatus: z.enum(["not-reviewed", "accepted", "changes-requested"]), createdAt: z.string().datetime(), updatedAt: z.string().datetime(),
}).strict();

export const DevelopmentChangedFileSchema = z.object({
  path: z.string().min(1).max(10_000), status: DevelopmentChangeStatusSchema, staged: z.boolean().optional(), previousPath: z.string().min(1).max(10_000).optional(),
  associated: z.boolean(), inSourceScope: z.boolean().optional(), exclusionReason: z.string().max(2000).optional(),
}).strict();

export const DevelopmentChangeDetectionSchema = z.object({ available: z.boolean(), message: z.string().optional(), changes: z.array(DevelopmentChangedFileSchema).max(2000) }).strict();
export const DevelopmentCompletionSchema = z.object({ allowed: z.boolean(), unmet: z.array(z.string().min(1)).max(20) }).strict();

export const DevelopmentPersistentStateSchema = z.object({
  schemaVersion: z.literal(DEVELOPMENT_SCHEMA_VERSION), revision: z.number().int().nonnegative(),
  workItems: z.array(DevelopmentWorkItemSchema).max(1000), scopeItems: z.array(DevelopmentScopeItemSchema).max(10_000),
  promptPreparations: z.array(DevelopmentPromptPreparationSchema).max(5000), handoffs: z.array(DevelopmentHandoffSchema).max(5000), results: z.array(DevelopmentResultSchema).max(5000),
  objectiveRevisions: z.record(z.string().uuid(), z.number().int().positive()), manualOrigins: z.array(z.string().uuid()).max(1000), correlations: z.record(z.string().min(1).max(200), z.string().min(1).max(500)), updatedAt: z.string().datetime(),
}).strict();

export const DevelopmentAggregateSchema = z.object({
  workflow: CanonicalWorkflowSchema, workItem: DevelopmentWorkItemSchema, scopeItems: z.array(DevelopmentScopeItemSchema),
  promptPreparation: DevelopmentPromptPreparationSchema.nullable(), handoff: DevelopmentHandoffSchema.nullable(), result: DevelopmentResultSchema.nullable(),
  changeDetection: DevelopmentChangeDetectionSchema, completion: DevelopmentCompletionSchema,
}).strict();

export type DevelopmentWorkItem = z.infer<typeof DevelopmentWorkItemSchema>;
export type DevelopmentWorkItemStatus = z.infer<typeof DevelopmentWorkItemStatusSchema>;
export type DevelopmentScopeItem = z.infer<typeof DevelopmentScopeItemSchema>;
export type DevelopmentPromptPreparation = z.infer<typeof DevelopmentPromptPreparationSchema>;
export type DevelopmentHandoff = z.infer<typeof DevelopmentHandoffSchema>;
export type DevelopmentResult = z.infer<typeof DevelopmentResultSchema>;
export type DevelopmentChangedFile = z.infer<typeof DevelopmentChangedFileSchema>;
export type DevelopmentChangeDetection = z.infer<typeof DevelopmentChangeDetectionSchema>;
export type DevelopmentPersistentState = z.infer<typeof DevelopmentPersistentStateSchema>;
export type DevelopmentAggregate = z.infer<typeof DevelopmentAggregateSchema>;
