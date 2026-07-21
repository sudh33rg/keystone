import { z } from "zod";

/**
 * RelationshipType identifies a relationship to validate.
 */
export const RelationshipTypeSchema = z.enum([
  "workflow-references-existing-stages",
  "stage-references-valid-execution-profile",
  "delegation-references-context-package",
  "context-package-references-current-sources",
  "qa-cycle-references-change-set",
  "review-references-current-evidence",
  "handoff-references-existing-records",
  "change-set-references-workflow",
  "commit-plan-references-change-set",
  "approval-references-valid-state",
  "activity-references-valid-workflow",
  "freshness-record-references-valid-source",
  "rerun-plan-references-current-workflow",
]);
export type RelationshipType = z.infer<typeof RelationshipTypeSchema>;

/**
 * RelationshipViolation describes a broken relationship.
 */
export const RelationshipViolationSchema = z.object({
  type: RelationshipTypeSchema,
  leftId: z.string().uuid(),
  leftType: z.string().max(100),
  rightId: z.string().uuid().optional(),
  rightType: z.string().max(100).optional(),
  message: z.string().max(500),
  severity: z.enum(["warning", "error"]),
});
export type RelationshipViolation = z.infer<typeof RelationshipViolationSchema>;

/**
 * ConsistencyCheckResult is the result of a consistency check.
 */
export const ConsistencyCheckResultSchema = z.object({
  passed: z.boolean(),
  violations: z.array(RelationshipViolationSchema).max(100),
  checkedRelationships: z.number().int().nonnegative(),
  checkedAt: z.string().datetime(),
});
export type ConsistencyCheckResult = z.infer<typeof ConsistencyCheckResultSchema>;

/**
 * MigrateResult records the outcome of a migration.
 */
export const MigrateResultSchema = z.object({
  success: z.boolean(),
  warnings: z.array(z.string().max(500)).max(20),
  migratedRecords: z.number().int().nonnegative(),
  recordsSkipped: z.number().int().nonnegative(),
  recordsFailed: z.number().int().nonnegative(),
  failedRecordIds: z.array(z.string().uuid()).max(100),
});
export type MigrateResult = z.infer<typeof MigrateResultSchema>;
