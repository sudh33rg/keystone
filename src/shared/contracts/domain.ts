import { z } from "zod";

export const SCHEMA_VERSION = 1 as const;

export const NavigationSectionSchema = z.enum([
  "home",
  "intent",
  "specifications",
  "tasks",
  "intelligence",
  "context",
  "validation",
  "settings"
]);

export type NavigationSection = z.infer<typeof NavigationSectionSchema>;

export const NAVIGATION_SECTIONS: readonly NavigationSection[] = NavigationSectionSchema.options;

export const ActivitySchema = z.object({
  operation: z.string().min(1),
  detail: z.string(),
  status: z.enum(["idle", "running", "waiting", "completed", "warning", "failed"]),
  progress: z.number().min(0).max(100).optional(),
  cancellable: z.boolean(),
  updatedAt: z.string().datetime()
});

export type Activity = z.infer<typeof ActivitySchema>;

export const WorkspaceSummarySchema = z.object({
  name: z.string().min(1),
  rootCount: z.number().int().nonnegative(),
  trust: z.enum(["trusted", "restricted"]),
  indexStatus: z.enum(["not-started", "unavailable"])
});

export type WorkspaceSummary = z.infer<typeof WorkspaceSummarySchema>;

export const PersistedFoundationStateSchema = z.object({
  schemaVersion: z.literal(SCHEMA_VERSION),
  revision: z.number().int().nonnegative(),
  activeSection: NavigationSectionSchema,
  workflowCount: z.number().int().nonnegative(),
  updatedAt: z.string().datetime()
});

export type PersistedFoundationState = z.infer<typeof PersistedFoundationStateSchema>;

export const BootstrapSnapshotSchema = z.object({
  extensionVersion: z.string(),
  workspace: WorkspaceSummarySchema,
  state: PersistedFoundationStateSchema,
  activity: ActivitySchema,
  implementation: z.object({
    phase: z.number().int().nonnegative(),
    phaseName: z.string(),
    completedTasks: z.array(z.string()),
    nextTask: z.string()
  })
});

export type BootstrapSnapshot = z.infer<typeof BootstrapSnapshotSchema>;
