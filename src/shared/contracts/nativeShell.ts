import { z } from "zod";
import { AppRouteSchema, WorkbenchStageSchema } from "./domain";

export const NATIVE_SHELL_SCHEMA_VERSION = 1 as const;
const Id = z.string().min(1).max(500);
export const KeystoneLaunchSourceSchema = z.enum([
  "activity-bar",
  "command-palette",
  "status-bar",
  "editor-context",
  "code-lens",
  "notification",
  "workflow-action",
  "task-action",
  "diagnostics",
  "handoff-import",
  "restore",
]);
export type KeystoneLaunchSource = z.infer<typeof KeystoneLaunchSourceSchema>;
const DestinationSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("home") }).strict(),
  z
    .object({
      type: z.literal("new-workflow"),
      workType: z
        .enum([
          "feature",
          "bug",
          "refactor",
          "test",
          "modernization",
          "investigation",
        ])
        .optional(),
    })
    .strict(),
  z
    .object({
      type: z.literal("workflow"),
      workflowId: z.string().uuid(),
      stage: WorkbenchStageSchema.optional(),
    })
    .strict(),
  z
    .object({
      type: z.literal("task"),
      workflowId: z.string().uuid(),
      taskId: z.string().uuid(),
    })
    .strict(),
  z
    .object({
      type: z.literal("approval"),
      workflowId: z.string().uuid(),
      approvalId: Id,
    })
    .strict(),
  z
    .object({
      type: z.literal("finding"),
      workflowId: z.string().uuid(),
      findingId: Id,
    })
    .strict(),
  z
    .object({
      type: z.literal("intelligence-query"),
      query: z.string().max(2000).optional(),
    })
    .strict(),
  z
    .object({
      type: z.literal("entity"),
      repositoryId: Id,
      entityId: Id,
      previousName: z.string().max(500).optional(),
    })
    .strict(),
  z
    .object({
      type: z.literal("flow"),
      repositoryId: Id,
      flowId: Id.optional(),
      seedEntityId: Id.optional(),
    })
    .strict(),
  z
    .object({ type: z.literal("impact"), repositoryId: Id, entityId: Id })
    .strict(),
  z.object({ type: z.literal("import-handoff") }).strict(),
  z.object({ type: z.literal("history") }).strict(),
  z
    .object({ type: z.literal("diagnostics"), diagnosticId: Id.optional() })
    .strict(),
  z
    .object({
      type: z.literal("settings"),
      section: z.string().max(200).optional(),
    })
    .strict(),
]);
export const OpenKeystoneRequestSchema = z
  .object({
    schemaVersion: z.literal(1).default(1),
    destination: DestinationSchema,
    repositoryId: Id.optional(),
    source: KeystoneLaunchSourceSchema.default("command-palette"),
    requestedAt: z
      .string()
      .datetime()
      .default(() => new Date().toISOString()),
  })
  .strict();
export type OpenKeystoneRequest = z.infer<typeof OpenKeystoneRequestSchema>;

export const LaunchRecoverySchema = z
  .object({
    code: z.enum([
      "workflow-missing",
      "task-missing",
      "entity-missing",
      "repository-mismatch",
      "invalid-stage",
      "workspace-missing",
      "target-unavailable",
    ]),
    title: z.string().max(500),
    message: z.string().max(2000),
    fallbackRoute: AppRouteSchema,
    actions: z
      .array(
        z
          .object({
            label: z.string().max(200),
            destination: DestinationSchema,
          })
          .strict(),
      )
      .max(5),
  })
  .strict();
export type LaunchRecovery = z.infer<typeof LaunchRecoverySchema>;
export const ValidatedNavigationSchema = z
  .object({
    request: OpenKeystoneRequestSchema,
    valid: z.boolean(),
    route: AppRouteSchema,
    repositoryId: Id.optional(),
    workflowId: z.string().uuid().optional(),
    taskId: z.string().uuid().optional(),
    query: z.string().max(2000).optional(),
    entityId: Id.optional(),
    focusTarget: z.string().max(200).default("main-heading"),
    recovery: LaunchRecoverySchema.optional(),
    validationDurationMs: z.number().nonnegative(),
  })
  .strict();
export type ValidatedNavigation = z.infer<typeof ValidatedNavigationSchema>;

export const DashboardItemSchema = z
  .object({
    id: Id,
    section: z.enum(["repository", "workflow", "attention", "actions"]),
    label: z.string().min(1).max(500),
    description: z.string().max(500).optional(),
    tooltip: z.string().min(1).max(2000),
    icon: z.string().max(100),
    contextValue: z.string().max(100),
    accessibilityLabel: z.string().min(1).max(1000),
    destination: DestinationSchema.optional(),
    severity: z.enum(["info", "warning", "error"]).default("info"),
  })
  .strict();
export type DashboardItem = z.infer<typeof DashboardItemSchema>;
export const DashboardSectionSchema = z
  .object({
    id: z.enum(["repository", "workflow", "attention", "actions"]),
    label: z.string().max(200),
    items: z.array(DashboardItemSchema).max(30),
  })
  .strict();
export const KeystoneDashboardStateSchema = z
  .object({
    schemaVersion: z.literal(1),
    status: z.enum([
      "no-workspace",
      "repository-detecting",
      "intelligence-unavailable",
      "intelligence-indexing",
      "no-workflow",
      "workflow-loading",
      "degraded",
      "ready",
    ]),
    repositoryId: Id.optional(),
    repositoryName: z.string().max(500).optional(),
    branch: z.string().max(500).optional(),
    trusted: z.boolean(),
    sections: z.array(DashboardSectionSchema).max(4),
    generatedAt: z.string().datetime(),
    refreshDurationMs: z.number().nonnegative(),
    diagnostics: z
      .array(z.object({ id: Id, message: z.string().max(2000) }).strict())
      .max(20),
  })
  .strict();
export type KeystoneDashboardState = z.infer<
  typeof KeystoneDashboardStateSchema
>;

export const KeystonePanelStateSchema = z
  .object({
    schemaVersion: z.literal(1),
    wasOpen: z.boolean(),
    visible: z.boolean(),
    ready: z.boolean(),
    column: z.number().int().min(1).max(9),
    lastRoute: AppRouteSchema,
    lastWorkflowId: z.string().uuid().optional(),
    lastTaskId: z.string().uuid().optional(),
    lastIntelligenceQuery: z.string().max(2000).optional(),
    lastEntityId: Id.optional(),
    lastDrawer: z.string().max(200).optional(),
    pendingNavigation: ValidatedNavigationSchema.optional(),
    navigationSequence: z.number().int().nonnegative(),
    updatedAt: z.string().datetime(),
  })
  .strict();
export type KeystonePanelState = z.infer<typeof KeystonePanelStateSchema>;
export const KeystoneInitializationSchema = z
  .object({
    schemaVersion: z.literal(1),
    extensionVersion: z.string().max(100),
    workspace: z
      .object({
        available: z.boolean(),
        name: z.string().max(500),
        trusted: z.boolean(),
      })
      .strict(),
    repository: z
      .object({
        id: Id,
        name: z.string().max(500),
        branch: z.string().max(500).optional(),
        intelligenceStatus: z.string().max(100),
      })
      .strict()
      .optional(),
    workflow: z
      .object({
        id: z.string().uuid(),
        title: z.string().max(500),
        stage: WorkbenchStageSchema,
        currentTaskId: z.string().uuid().optional(),
      })
      .strict()
      .optional(),
    capabilities: z
      .object({ copilotAvailable: z.boolean(), toolsAvailable: z.boolean() })
      .strict(),
    restoredRoute: AppRouteSchema,
    restoredContext: z
      .object({
        workflowId: z.string().uuid().optional(),
        taskId: z.string().uuid().optional(),
        intelligenceQuery: z.string().max(2000).optional(),
        entityId: Id.optional(),
        drawer: z.string().max(200).optional(),
      })
      .strict()
      .optional(),
    pendingNavigation: ValidatedNavigationSchema.optional(),
    recovery: LaunchRecoverySchema.optional(),
    initializedAt: z.string().datetime(),
  })
  .strict();
export type KeystoneInitialization = z.infer<
  typeof KeystoneInitializationSchema
>;

export const WebviewReadyPayloadSchema = z
  .object({ instanceId: z.string().uuid(), protocolVersion: z.literal(1) })
  .strict();
export const InitializationAcknowledgedPayloadSchema = z
  .object({ instanceId: z.string().uuid(), route: AppRouteSchema })
  .strict();
export const NavigationAcknowledgedPayloadSchema = z
  .object({
    instanceId: z.string().uuid(),
    sequence: z.number().int().nonnegative(),
    route: AppRouteSchema,
  })
  .strict();
export const WebviewStateChangedPayloadSchema = z
  .object({
    route: AppRouteSchema,
    workflowId: z.string().uuid().optional(),
    taskId: z.string().uuid().optional(),
    intelligenceQuery: z.string().max(2000).optional(),
    entityId: Id.optional(),
    drawer: z.string().max(200).optional(),
  })
  .strict();
