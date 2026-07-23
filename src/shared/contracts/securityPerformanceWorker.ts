import { z } from "zod";

export const SECURITY_PERFORMANCE_WORKER_SCHEMA_VERSION = 1 as const;
const Id = z.string().uuid();
const Timestamp = z.string().datetime();
const Path = z.string().min(1).max(1024);

export const SecurityWorkerStatusSchema = z.object({
  phase: z.enum(["idle", "scanning", "analyzing", "complete", "error"]),
  progress: z.number().min(0).max(100),
  filesScanned: z.number().int().nonnegative(),
  findings: z.number().int().nonnegative(),
  message: z.string().max(2000),
  startedAt: Timestamp.optional(),
  finishedAt: Timestamp.optional(),
});
export type SecurityWorkerStatus = z.infer<typeof SecurityWorkerStatusSchema>;

export const PerformanceWorkerStatusSchema = z.object({
  phase: z.enum(["idle", "scanning", "analyzing", "complete", "error"]),
  progress: z.number().min(0).max(100),
  filesScanned: z.number().int().nonnegative(),
  pathsAnalyzed: z.number().int().nonnegative(),
  findings: z.number().int().nonnegative(),
  message: z.string().max(2000),
  startedAt: Timestamp.optional(),
  finishedAt: Timestamp.optional(),
});
export type PerformanceWorkerStatus = z.infer<typeof PerformanceWorkerStatusSchema>;

export const SecurityFindingWorkerSchema = z.object({
  id: Id,
  workflowId: Id.optional(),
  category: z.string().max(200),
  severity: z.enum(["info", "low", "medium", "high", "critical"]),
  confidence: z.number().min(0).max(1),
  title: z.string().min(1).max(500),
  description: z.string().max(10_000),
  location: z
    .object({
      filePath: Path,
      startLine: z.number().int().nonnegative().optional(),
      endLine: z.number().int().nonnegative().optional(),
      ruleId: z.string().max(200).optional(),
      tool: z.string().max(200).optional(),
      cwe: z.string().max(100).optional(),
      owasp: z.string().max(100).optional(),
    })
    .optional(),
  recommendation: z.string().max(10_000).optional(),
  evidence: z.array(z.string().max(2000)).max(50).default([]),
  references: z.array(z.string().url().max(1000)).max(20).default([]),
  status: z.enum(["open", "remediation-planned", "resolved", "accepted-risk", "false-positive", "deferred"]).default("open"),
  provenance: z.enum(["deterministic", "agent", "tool"]).default("tool"),
  createdAt: Timestamp,
  updatedAt: Timestamp,
  contentHash: z.string().min(1).max(200),
});
export type SecurityFindingWorker = z.infer<typeof SecurityFindingWorkerSchema>;

export const PerformanceFindingWorkerSchema = z.object({
  id: Id,
  workflowId: Id.optional(),
  category: z.enum([
    "allocation",
    "loop",
    "fanout",
    "serialization",
    "io-bound",
    "cpu-bound",
    "memory",
    "cache-miss",
    "db-query",
    "lock-contention",
    "other",
  ]),
  severity: z.enum(["info", "low", "medium", "high", "critical"]),
  confidence: z.number().min(0).max(1),
  title: z.string().min(1).max(500),
  description: z.string().max(10_000),
  location: z
    .object({
      filePath: Path,
      startLine: z.number().int().nonnegative().optional(),
      endLine: z.number().int().nonnegative().optional(),
      symbolId: z.string().max(500).optional(),
      path: z.array(z.string().max(500)).max(20).optional(),
    })
    .optional(),
  recommendation: z.string().max(10_000).optional(),
  evidence: z.array(z.string().max(2000)).max(50).default([]),
  status: z.enum(["open", "remediation-planned", "resolved", "accepted-risk", "false-positive", "deferred"]).default("open"),
  provenance: z.enum(["deterministic", "agent", "tool"]).default("tool"),
  createdAt: Timestamp,
  updatedAt: Timestamp,
  contentHash: z.string().min(1).max(200),
});
export type PerformanceFindingWorker = z.infer<typeof PerformanceFindingWorkerSchema>;

export const SecurityPerformanceWorkerRunSchema = z.object({
  id: Id,
  workflowId: Id.optional(),
  kind: z.enum(["security", "performance"]),
  status: z.enum(["queued", "running", "complete", "failed", "cancelled"]),
  root: Path,
  changedFiles: z.array(Path).max(5000).default([]),
  diffSummary: z
    .object({
      totalFiles: z.number().int().nonnegative(),
      totalAdditions: z.number().int().nonnegative(),
      totalDeletions: z.number().int().nonnegative(),
    })
    .optional(),
  startedAt: Timestamp.optional(),
  finishedAt: Timestamp.optional(),
  findings: z.array(SecurityFindingWorkerSchema).max(5000).default([]),
  errors: z.array(z.string().max(2000)).max(200).default([]),
  diagnostics: z.array(z.string().max(2000)).max(200).default([]),
  metadata: z.record(z.string(), z.any()).default(() => ({})),
  createdAt: Timestamp,
  updatedAt: Timestamp,
  contentHash: z.string().min(1).max(200),
});
export type SecurityPerformanceWorkerRun = z.infer<typeof SecurityPerformanceWorkerRunSchema>;

export const SecurityPerformancePersistentStateSchema = z.object({
  schemaVersion: z.literal(SECURITY_PERFORMANCE_WORKER_SCHEMA_VERSION),
  revision: z.number().int().nonnegative(),
  securityRuns: z.array(SecurityPerformanceWorkerRunSchema).max(200).default([]),
  performanceRuns: z.array(SecurityPerformanceWorkerRunSchema).max(200).default([]),
  updatedAt: Timestamp,
});
export type SecurityPerformancePersistentState = z.infer<typeof SecurityPerformancePersistentStateSchema>;
