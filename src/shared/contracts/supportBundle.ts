import { z } from "zod";

/**
 * BundleItem represents a single item in the support bundle.
 */
export const BundleItemSchema = z.object({
  id: z.string().uuid(),
  category: z.string().max(100),
  title: z.string().max(200),
  level: z.enum(["info", "warning", "error", "critical"]),
  message: z.string().max(1000),
  details: z.string().max(5000).optional(),
  redacted: z.boolean().default(false),
  createdAt: z.string().datetime(),
});
export type BundleItem = z.infer<typeof BundleItemSchema>;

/**
 * SupportBundle represents the complete support bundle.
 */
export const SupportBundleSchema = z.object({
  id: z.string().uuid(),
  extensionVersion: z.string().max(100),
  vscodeVersion: z.string().max(100),
  operatingSystem: z.string().max(100),
  repositoryLanguageSummary: z.string().max(5000),
  schemaVersions: z.record(z.string().max(100), z.string().max(100)),
  capabilityAvailability: z.record(z.string().max(100), z.boolean()),
  recentErrors: z.array(BundleItemSchema).max(50),
  activitySummaries: z.array(BundleItemSchema).max(30),
  migrationWarnings: z.array(BundleItemSchema).max(20),
  performanceTimings: z.record(z.string().max(100), z.number().nonnegative()),
  redactedConfig: z.string().max(10000),
  logs: z.string().max(100_000),
  createdAt: z.string().datetime(),
});
export type SupportBundle = z.infer<typeof SupportBundleSchema>;

/**
 * BundleExportRequest is sent to request a support bundle.
 */
export const BundleExportRequestSchema = z.object({
  includeSourceCode: z.boolean().default(false),
  includeSecrets: z.boolean().default(false),
  includeRawPrompts: z.boolean().default(false),
  includeRawLogs: z.boolean().default(true),
});
export type BundleExportRequest = z.infer<typeof BundleExportRequestSchema>;

/**
 * BundleExportResult is the response from a bundle export.
 */
export const BundleExportResultSchema = z.object({
  bundle: SupportBundleSchema,
  sizeBytes: z.number().int().nonnegative(),
});
export type BundleExportResult = z.infer<typeof BundleExportResultSchema>;
