import { z } from "zod";

/**
 * ResourceLimit defines a limit on a specific resource.
 */
export const ResourceLimitSchema = z.object({
  name: z.string().max(100),
  description: z.string().max(500),
  default: z.number().nonnegative(),
  maximum: z.number().nonnegative().optional(),
  unit: z.string().max(50).optional(),
  enforced: z.boolean().default(true),
});
export type ResourceLimit = z.infer<typeof ResourceLimitSchema>;

/**
 * ResourceLimitState tracks the current usage of a resource.
 */
export const ResourceLimitStateSchema = z.object({
  name: z.string().max(100),
  current: z.number().nonnegative(),
  limit: z.number().nonnegative(),
  unit: z.string().max(50).optional(),
  percentage: z.number().min(0).max(100),
  exceeded: z.boolean(),
});
export type ResourceLimitState = z.infer<typeof ResourceLimitStateSchema>;

/**
 * ResourceLimitExceeded is emitted when a limit is exceeded.
 */
export const ResourceLimitExceededSchema = z.object({
  limitName: z.string().max(100),
  current: z.number().nonnegative(),
  limit: z.number().nonnegative(),
  exceededBy: z.number().nonnegative(),
  recommendation: z.string().max(500),
});
export type ResourceLimitExceeded = z.infer<typeof ResourceLimitExceededSchema>;
