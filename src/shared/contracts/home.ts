import { z } from "zod";
import { CanonicalWorkflowWorkTypeSchema } from "./canonicalWorkflow";

export const HomeRepositoryStateSchema = z.object({
  name: z.string().min(1),
  status: z.string().min(1),
  generation: z.number().int().nonnegative().optional(),
  lastSuccessfulUpdate: z.string().datetime().optional(),
  pendingUpdate: z.boolean().optional(),
  progress: z.object({ completed: z.number().int().nonnegative(), total: z.number().int().nonnegative(), label: z.string() }).strict().optional(),
  refreshSupported: z.boolean().optional(),
  error: z.string().optional(),
}).strict();

export const HomeActiveWorkflowSummarySchema = z.object({
  id: z.string().min(1),
  title: z.string().min(1),
  intent: z.string().min(1),
  workType: CanonicalWorkflowWorkTypeSchema.optional(),
  status: z.string().min(1),
  currentStage: z.string().min(1).optional(),
  currentStageStatus: z.string().min(1).optional(),
  nextRequiredAction: z.string().min(1).optional(),
  updatedAt: z.string().datetime(),
}).strict();

export const HomeActivitySummarySchema = z.object({
  id: z.string().min(1),
  title: z.string().min(1),
  status: z.string().min(1),
  updatedAt: z.string().datetime(),
}).strict();

export const HomeStateSchema = z.object({
  repository: HomeRepositoryStateSchema,
  activeWorkflow: HomeActiveWorkflowSummarySchema.nullable(),
  recentActivities: z.array(HomeActivitySummarySchema).max(10),
}).strict();

export type HomeRepositoryState = z.infer<typeof HomeRepositoryStateSchema>;
export type HomeActiveWorkflowSummary = z.infer<typeof HomeActiveWorkflowSummarySchema>;
export type HomeActivitySummary = z.infer<typeof HomeActivitySummarySchema>;
export type HomeState = z.infer<typeof HomeStateSchema>;
