import { z } from "zod";

/**
 * FreshnessStatus represents the validity state of a record relative to its upstream dependencies.
 */
export const FreshnessStatusSchema = z.enum([
  "current",
  "stale",
  "invalid",
  "unknown",
]);
export type FreshnessStatus = z.infer<typeof FreshnessStatusSchema>;

/**
 * StalenessReason explains why a record became stale.
 */
export const StalenessReasonSchema = z.object({
  code: z.string().min(1).max(100),
  description: z.string().min(1).max(1000),
  affectedUpstreamIds: z.array(z.string().max(100)).max(20),
});
export type StalenessReason = z.infer<typeof StalenessReasonSchema>;

/**
 * FreshnessRecord tracks the freshness of a specific record.
 */
export const FreshnessRecordSchema = z.object({
  id: z.string().uuid(),
  recordId: z.string().uuid(),
  recordType: z.string().max(100),
  status: FreshnessStatusSchema,
  reason: StalenessReasonSchema.optional(),
  invalidatedAt: z.string().datetime().optional(),
  invalidatedBy: z.string().max(200).optional(),
  updatedAt: z.string().datetime(),
});
export type FreshnessRecord = z.infer<typeof FreshnessRecordSchema>;

/**
 * FreshnessUpdate is emitted when a record's freshness changes.
 */
export const FreshnessUpdateSchema = z.object({
  recordId: z.string().uuid(),
  recordType: z.string().max(100),
  previousStatus: FreshnessStatusSchema.optional(),
  newStatus: FreshnessStatusSchema,
  reason: StalenessReasonSchema.optional(),
});
export type FreshnessUpdate = z.infer<typeof FreshnessUpdateSchema>;
