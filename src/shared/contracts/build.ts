import { z } from "zod";
import {
  CopilotAgentDescriptorSchema,
  CopilotCapabilitiesSchema,
  DelegationSessionSchema,
  DevelopmentTaskSchema,
  DevelopmentWorkflowSnapshotSchema,
  PreparedDelegationSchema,
  TaskContextPackageSchema,
} from "./delegation";
import {
  CompletionDecisionSchema,
  RetryPlanSchema,
  TaskExecutionSessionSchema,
  ValidationPlanSchema,
  ValidationRunSchemaV2,
} from "./execution";

export const BUILD_SCHEMA_VERSION = 1 as const;
const Id = z.string().uuid();
const Scope = z.object({ workflowId: Id, taskId: Id }).strict();
export const BuildTaskPayloadSchema = Scope;
export const BuildSelectTaskPayloadSchema = Scope.extend({
  specificationRevision: z.number().int().positive(),
  intelligenceGeneration: z.number().int().nonnegative(),
}).strict();
export const BuildBlockTaskPayloadSchema = Scope.extend({
  reason: z.string().min(1).max(2000),
  category: z.enum(["decision", "dependency", "external", "repository", "validation", "other"]),
  requiredDecision: z.string().max(2000).optional(),
  suggestedAction: z.string().max(2000),
}).strict();
export const BuildCustomizationSelectionPayloadSchema = Scope.extend({
  customizationId: z.string().min(1).max(500),
  selected: z.boolean(),
}).strict();
export const BuildSelectAgentPayloadSchema = Scope.extend({
  agentId: z.string().min(1).max(200).optional(),
  intendedAgentLabel: z.string().min(1).max(200).optional(),
  confirmed: z.literal(true),
})
  .strict()
  .refine(
    (value) => Boolean(value.agentId) !== Boolean(value.intendedAgentLabel),
    "Select one discovered agent or provide one unverified intended label.",
  );

export const CopilotCustomizationItemSchema = z
  .object({
    id: z.string().min(1).max(500),
    kind: z.enum(["instruction", "path-instruction", "agent", "skill", "prompt"]),
    name: z.string().min(1).max(500),
    description: z.string().max(2000).optional(),
    sourcePath: z.string().max(1024).optional(),
    scope: z.array(z.string().max(1024)).max(100).optional(),
    applicable: z.boolean(),
    applicabilityReason: z.string().max(2000).optional(),
    enabled: z.boolean(),
    trustState: z.enum(["trusted", "workspace", "untrusted"]),
    selected: z.boolean().default(false),
    fingerprint: z.string().max(256),
  })
  .strict();
export type CopilotCustomizationItem = z.infer<typeof CopilotCustomizationItemSchema>;

export const BuildReadinessCheckSchema = z
  .object({
    code: z.string().max(100),
    label: z.string().max(300),
    passed: z.boolean(),
    blocking: z.boolean(),
    explanation: z.string().max(2000),
    recoveryAction: z.string().max(2000),
  })
  .strict();
export type BuildReadinessCheck = z.infer<typeof BuildReadinessCheckSchema>;
export const BuildTaskQueueItemSchema = z
  .object({
    task: DevelopmentTaskSchema,
    group: z.enum([
      "ready",
      "in-progress",
      "blocked",
      "awaiting-validation",
      "awaiting-review",
      "completed",
    ]),
    owner: z.string().max(500).optional(),
    validationSummary: z.string().max(1000),
    blockerSummary: z.string().max(2000).optional(),
    readiness: z.array(BuildReadinessCheckSchema).max(30),
  })
  .strict();
export const BuildTaskQueueSchema = z
  .object({
    schemaVersion: z.literal(BUILD_SCHEMA_VERSION),
    workflowId: Id,
    selectedTaskId: Id.optional(),
    activeTaskId: Id.optional(),
    items: z.array(BuildTaskQueueItemSchema).max(500),
    repositoryGeneration: z.number().int().nonnegative(),
    branch: z.string().max(500).optional(),
    head: z.string().max(500).optional(),
  })
  .strict();
export type BuildTaskQueue = z.infer<typeof BuildTaskQueueSchema>;

export const BuildTaskStateSchema = z
  .object({
    schemaVersion: z.literal(BUILD_SCHEMA_VERSION),
    workflow: DevelopmentWorkflowSnapshotSchema,
    task: DevelopmentTaskSchema,
    queue: BuildTaskQueueSchema,
    readiness: z.array(BuildReadinessCheckSchema).max(30),
    capabilities: CopilotCapabilitiesSchema.optional(),
    agents: z.array(CopilotAgentDescriptorSchema).max(200),
    recommendedAgentId: z.string().max(200).optional(),
    customizations: z.array(CopilotCustomizationItemSchema).max(500),
    context: TaskContextPackageSchema.optional(),
    prepared: PreparedDelegationSchema.optional(),
    delegationSession: DelegationSessionSchema.optional(),
    execution: TaskExecutionSessionSchema.optional(),
    validationPlan: ValidationPlanSchema.optional(),
    validationRun: ValidationRunSchemaV2.optional(),
    retry: RetryPlanSchema.optional(),
    completion: CompletionDecisionSchema.optional(),
    nextAction: z.string().max(2000),
    diagnostics: z
      .array(
        z
          .object({
            id: z.string().max(100),
            message: z.string().max(2000),
            recoveryAction: z.string().max(2000),
            retrySafe: z.boolean(),
          })
          .strict(),
      )
      .max(100),
  })
  .strict();
export type BuildTaskState = z.infer<typeof BuildTaskStateSchema>;

export const BuildLifecycleEventSchema = z
  .object({
    workflowId: Id,
    taskId: Id,
    specificationRevision: z.number().int().positive(),
    intelligenceGeneration: z.number().int().nonnegative(),
    message: z.string().max(2000),
    at: z.string().datetime(),
  })
  .strict();
