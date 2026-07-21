import { z } from "zod";
import {
  DevelopmentSpecificationSchema,
  DevelopmentTaskSchema,
  DevelopmentWorkflowSnapshotSchema,
  DevelopmentWorkTypeSchema,
  RepositoryScopeSelectionSchema,
  WorkflowClarificationSchema,
} from "./delegation";
import { WorkbenchStageSchema } from "./domain";
import { RepositoryStateRefSchema, StalenessRecordSchema } from "./integration";

export const WORKBENCH_SCHEMA_VERSION = 1 as const;
const Id = z.string().uuid();
const Timestamp = z.string().datetime();
const WorkflowAware = z.object({ workflowId: Id }).strict();

export const WorkbenchConstraintKindSchema = z.enum([
  "avoid",
  "framework",
  "compatibility",
  "test",
  "security",
  "performance",
  "notes",
]);
export const WorkbenchConstraintInputSchema = z
  .object({ kind: WorkbenchConstraintKindSchema, value: z.string().min(1).max(5000) })
  .strict();
export const WorkbenchCreateContextSchema = z
  .object({
    schemaVersion: z.literal(WORKBENCH_SCHEMA_VERSION),
    repository: z
      .object({
        available: z.boolean(),
        trusted: z.boolean(),
        id: z.string().max(1000).optional(),
        name: z.string().max(500).optional(),
        branch: z.string().max(500).optional(),
        head: z.string().max(500).optional(),
      })
      .strict(),
    intelligence: z
      .object({
        status: z.enum(["ready", "partial", "building", "unavailable"]),
        generation: z.number().int().nonnegative(),
        message: z.string().max(2000),
      })
      .strict(),
    activeEditor: z.string().max(1024).optional(),
    selectedEntryEntityId: z.string().max(500).optional(),
    copilot: z
      .object({
        available: z.boolean(),
        directInvocation: z.boolean(),
        summary: z.string().max(1000),
      })
      .strict(),
    workflowDefinitions: z
      .array(
        z
          .object({
            workType: DevelopmentWorkTypeSchema,
            definitionId: z.string().max(100),
            label: z.string().max(100),
            description: z.string().max(1000),
          })
          .strict(),
      )
      .max(20),
  })
  .strict();
export type WorkbenchCreateContext = z.infer<typeof WorkbenchCreateContextSchema>;

export const WorkbenchCreateWorkflowPayloadSchema = z
  .object({
    workType: DevelopmentWorkTypeSchema,
    intent: z.string().min(1).max(50_000),
    repositoryScope: RepositoryScopeSelectionSchema,
    constraints: z.array(WorkbenchConstraintInputSchema).max(50).default([]),
    expectedRepositoryId: z.string().min(1).max(1000),
    expectedIntelligenceGeneration: z.number().int().nonnegative(),
  })
  .strict();
export const WorkbenchIntentUpdatePayloadSchema = WorkflowAware.extend({
  intent: z.string().min(1).max(50_000),
  reason: z.string().min(1).max(2000),
}).strict();
export const WorkbenchScopeUpdatePayloadSchema = WorkflowAware.extend({
  repositoryScope: RepositoryScopeSelectionSchema,
  reason: z.string().min(1).max(2000),
}).strict();
export const WorkbenchConstraintsUpdatePayloadSchema = WorkflowAware.extend({
  constraints: z.array(WorkbenchConstraintInputSchema).max(50),
  reason: z.string().min(1).max(2000),
}).strict();
export const WorkbenchClarificationPayloadSchema = WorkflowAware.extend({
  clarificationId: Id,
}).strict();
export const WorkbenchClarificationAnswerPayloadSchema = WorkbenchClarificationPayloadSchema.extend(
  { answer: z.string().min(1).max(5000), rationale: z.string().max(5000).optional() },
).strict();
export const WorkbenchSpecificationUpdatePayloadSchema = WorkflowAware.extend({
  expectedRevision: z.number().int().positive(),
  reason: z.string().min(1).max(2000),
  patch: DevelopmentSpecificationSchema.pick({
    title: true,
    objective: true,
    scope: true,
    requirements: true,
    constraints: true,
    acceptanceCriteria: true,
    testStrategy: true,
    sections: true,
  }).partial(),
}).strict();
export const WorkbenchSpecificationApprovePayloadSchema = WorkflowAware.extend({
  expectedRevision: z.number().int().positive(),
  rationale: z.string().max(2000).optional(),
}).strict();
export const WorkbenchTaskUpdatePayloadSchema = WorkflowAware.extend({
  taskId: Id,
  expectedPlanRevision: z.number().int().positive(),
  patch: DevelopmentTaskSchema.pick({
    title: true,
    objective: true,
    category: true,
    validationSteps: true,
    executionRoute: true,
    optional: true,
  }).partial(),
}).strict();
export const WorkbenchTaskAddPayloadSchema = WorkflowAware.extend({
  expectedPlanRevision: z.number().int().positive(),
  task: DevelopmentTaskSchema.pick({
    title: true,
    objective: true,
    description: true,
    category: true,
    requirementIds: true,
    acceptanceCriterionIds: true,
    expectedFiles: true,
    expectedEntityIds: true,
    validationSteps: true,
    executionRoute: true,
    risk: true,
    optional: true,
  }),
}).strict();
export const WorkbenchTaskRemovePayloadSchema = WorkflowAware.extend({
  taskId: Id,
  expectedPlanRevision: z.number().int().positive(),
}).strict();
export const WorkbenchTaskReorderPayloadSchema = WorkflowAware.extend({
  taskId: Id,
  direction: z.enum(["up", "down"]),
  expectedPlanRevision: z.number().int().positive(),
}).strict();
export const WorkbenchDependencyUpdatePayloadSchema = WorkflowAware.extend({
  taskId: Id,
  dependencyId: Id,
  action: z.enum(["add", "remove"]),
  expectedPlanRevision: z.number().int().positive(),
}).strict();
export const WorkbenchPlanApprovalPayloadSchema = WorkflowAware.extend({
  expectedPlanRevision: z.number().int().positive(),
}).strict();
export const WorkbenchStageNavigationPayloadSchema = WorkflowAware.extend({
  stage: WorkbenchStageSchema,
}).strict();

export const WorkbenchRepositoryEvidenceSchema = z
  .object({
    entityId: z.string().max(500),
    name: z.string().max(500),
    type: z.string().max(200),
    relativePath: z.string().max(1024).optional(),
    classification: z.enum(["exact", "candidate"]),
    confidence: z.number().min(0).max(1),
    reason: z.string().max(2000),
    evidenceIds: z.array(z.string().max(500)).max(50),
  })
  .strict();
export const WorkbenchRepositorySummarySchema = z
  .object({
    generation: z.number().int().nonnegative(),
    freshness: z.enum(["current", "stale", "unavailable"]),
    modules: z.array(WorkbenchRepositoryEvidenceSchema).max(20),
    entities: z.array(WorkbenchRepositoryEvidenceSchema).max(50),
    tests: z.array(WorkbenchRepositoryEvidenceSchema).max(30),
    apisAndData: z.array(WorkbenchRepositoryEvidenceSchema).max(30),
    patterns: z.array(z.string().max(2000)).max(30),
    limitations: z.array(z.string().max(2000)).max(30),
  })
  .strict();
export type WorkbenchRepositorySummary = z.infer<typeof WorkbenchRepositorySummarySchema>;

export const WorkbenchDiagnosticSchema = z
  .object({
    id: Id,
    code: z.string().max(100),
    severity: z.enum(["info", "warning", "error"]),
    message: z.string().max(2000),
    blocking: z.boolean(),
    recoveryAction: z.string().max(2000),
  })
  .strict();
export const WorkbenchStageBlockerSchema = z
  .object({
    code: z.string().max(100),
    message: z.string().max(2000),
    recoveryAction: z.string().max(2000),
  })
  .strict();
export const WorkbenchStageStateSchema = z
  .object({
    stage: WorkbenchStageSchema,
    status: z.enum(["complete", "current", "ready", "blocked", "optional", "unavailable"]),
    blockers: z.array(WorkbenchStageBlockerSchema).max(50),
    warnings: z.array(z.string().max(2000)).max(50),
    primaryAction: z
      .object({ id: z.string().max(100), label: z.string().max(200), enabled: z.boolean() })
      .strict()
      .optional(),
  })
  .strict();
export type WorkbenchStageState = z.infer<typeof WorkbenchStageStateSchema>;
export const WorkbenchSummarySchema = z
  .object({
    workflowId: Id,
    currentStage: WorkbenchStageSchema,
    specificationStatus: z.string().max(100),
    taskPlanStatus: z.string().max(100),
    taskCounts: z.record(z.string(), z.number().int().nonnegative()),
    currentReadyTaskId: Id.optional(),
    pendingApprovals: z.number().int().nonnegative(),
    blockingDiagnostics: z.number().int().nonnegative(),
    repositoryFreshness: z.enum(["current", "stale", "unavailable"]),
    intelligenceFreshness: z.enum(["current", "stale", "unavailable"]),
  })
  .strict();
export type WorkbenchSummary = z.infer<typeof WorkbenchSummarySchema>;
export const WorkbenchTaskPlanValidationSchema = z
  .object({
    valid: z.boolean(),
    diagnostics: z.array(WorkbenchDiagnosticSchema).max(100),
    topologicalOrder: z.array(Id).max(500),
    uncoveredCriterionIds: z.array(z.string().max(200)).max(200),
    unsupportedTaskIds: z.array(Id).max(500),
  })
  .strict();
export type WorkbenchTaskPlanValidation = z.infer<typeof WorkbenchTaskPlanValidationSchema>;

export const WorkbenchDefineStateSchema = z
  .object({
    schemaVersion: z.literal(WORKBENCH_SCHEMA_VERSION),
    workflow: DevelopmentWorkflowSnapshotSchema,
    repository: WorkbenchRepositorySummarySchema,
    clarifications: z.array(WorkflowClarificationSchema).max(100),
    diagnostics: z.array(WorkbenchDiagnosticSchema).max(100),
    staleness: z.array(StalenessRecordSchema).max(100),
    stageStates: z.array(WorkbenchStageStateSchema).length(6),
    summary: WorkbenchSummarySchema,
  })
  .strict();
export type WorkbenchDefineState = z.infer<typeof WorkbenchDefineStateSchema>;
export const WorkbenchPlanStateSchema = z
  .object({
    schemaVersion: z.literal(WORKBENCH_SCHEMA_VERSION),
    workflow: DevelopmentWorkflowSnapshotSchema,
    validation: WorkbenchTaskPlanValidationSchema,
    stageStates: z.array(WorkbenchStageStateSchema).length(6),
    summary: WorkbenchSummarySchema,
  })
  .strict();
export type WorkbenchPlanState = z.infer<typeof WorkbenchPlanStateSchema>;
export const WorkbenchWorkflowStateSchema = z
  .object({
    schemaVersion: z.literal(WORKBENCH_SCHEMA_VERSION),
    workflow: DevelopmentWorkflowSnapshotSchema,
    repositoryName: z.string().max(500).optional(),
    repositoryState: RepositoryStateRefSchema.optional(),
    staleness: z.array(StalenessRecordSchema).max(100),
    stageStates: z.array(WorkbenchStageStateSchema).length(6),
    summary: WorkbenchSummarySchema,
  })
  .strict();
export type WorkbenchWorkflowState = z.infer<typeof WorkbenchWorkflowStateSchema>;

export const WorkbenchLifecycleEventSchema = z
  .object({
    workflowId: Id,
    repositoryId: z.string().max(1000),
    specificationRevision: z.number().int().positive().optional(),
    taskPlanRevision: z.number().int().positive().optional(),
    stage: WorkbenchStageSchema.optional(),
    message: z.string().max(2000),
    at: Timestamp,
  })
  .strict();
export const WorkbenchStaleEventSchema = WorkbenchLifecycleEventSchema.extend({
  staleness: z.array(StalenessRecordSchema).max(100),
}).strict();

export type WorkbenchConstraintInput = z.infer<typeof WorkbenchConstraintInputSchema>;
export type WorkbenchDiagnostic = z.infer<typeof WorkbenchDiagnosticSchema>;
export type WorkbenchLifecycleEvent = z.infer<typeof WorkbenchLifecycleEventSchema>;
export type WorkbenchStaleEvent = z.infer<typeof WorkbenchStaleEventSchema>;
