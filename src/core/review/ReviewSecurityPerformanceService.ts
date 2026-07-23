import { createHash } from "node:crypto";
import { z } from "zod";

const SecurityPerformanceDecisionSchema = z.object({
  schemaVersion: z.literal(1),
  id: z.string().uuid(),
  workflowId: z.string().uuid(),
  securityStatus: z.enum(["reviewed", "stale", "open", "unavailable"]),
  performanceStatus: z.enum(["reviewed", "stale", "open", "unavailable"]),
  currentSecurityDecisionId: z.string().optional(),
  currentSecurityDecisionAt: z.string().datetime().optional(),
  securityDecisionAgeMs: z.number().nonnegative(),
  currentPerformanceDecisionId: z.string().optional(),
  currentPerformanceDecisionAt: z.string().datetime().optional(),
  performanceDecisionAgeMs: z.number().nonnegative(),
  acceptedRisks: z
    .array(
      z.object({
        id: z.string().min(1).max(200),
        category: z.string().min(1).max(200),
        title: z.string().min(1).max(500),
        justification: z.string().max(5000),
        acceptedAt: z.string().datetime(),
        expiresAt: z.string().datetime().optional(),
        expired: z.boolean(),
      }),
    )
    .default([]),
  openBlockingFindings: z.array(z.any()).default([]),
  confirmedRegressions: z
    .array(
      z.object({
        id: z.string().min(1).max(200),
        source: z.string().min(1).max(200),
        title: z.string().min(1).max(500),
        description: z.string().max(5000),
        severity: z.string().min(1).max(100),
        status: z.string().min(1).max(200),
        filePath: z.string().min(1).max(2000),
      }),
    )
    .default([]),
  blocked: z.boolean().default(false),
  createdAt: z.string().datetime(),
  contentHash: z.string(),
});

export type SecurityPerformanceDecision = z.infer<typeof SecurityPerformanceDecisionSchema>;

export interface AcceptedRiskInput {
  id: string;
  category: string;
  title: string;
  justification: string;
  acceptedAt: string;
  expiresAt?: string;
}

export interface ConfirmedRegressionInput {
  id: string;
  source: string;
  title: string;
  description: string;
  severity: string;
  status: string;
  filePath: string;
}

export interface SecurityPerformanceInput {
  workflowId: string;
  securityStatus: "reviewed" | "stale" | "open" | "unavailable";
  currentSecurityDecisionId?: string;
  currentSecurityDecisionAt?: string;
  securityDecisionAgeMs?: number;
  performanceStatus: "reviewed" | "stale" | "open" | "unavailable";
  currentPerformanceDecisionId?: string;
  currentPerformanceDecisionAt?: string;
  performanceDecisionAgeMs?: number;
  acceptedRisks?: AcceptedRiskInput[];
  openBlockingFindings?: unknown[];
  confirmedRegressions?: ConfirmedRegressionInput[];
  blocked?: boolean;
}

const MAX_STALENESS_MS = 1000 * 60 * 60 * 24 * 1;

export class ReviewSecurityPerformanceService {
  build(input: SecurityPerformanceInput): SecurityPerformanceDecision {
    const staleSecurity =
      input.securityStatus === "stale" ||
      (input.securityDecisionAgeMs ?? 0) > MAX_STALENESS_MS;
    const stalePerformance =
      input.performanceStatus === "stale" ||
      (input.performanceDecisionAgeMs ?? 0) > MAX_STALENESS_MS;

    const risks = (input.acceptedRisks ?? []).map((risk) => ({
      id: risk.id,
      category: risk.category,
      title: risk.title,
      justification: risk.justification,
      acceptedAt: risk.acceptedAt,
      expiresAt: risk.expiresAt,
      expired: Boolean(risk.expiresAt && new Date(risk.expiresAt).getTime() < Date.now()),
    }));

    return {
      schemaVersion: 1,
      id: crypto.randomUUID(),
      workflowId: input.workflowId,
      securityStatus: staleSecurity ? "stale" : input.securityStatus,
      performanceStatus: stalePerformance ? "stale" : input.performanceStatus,
      currentSecurityDecisionId: input.currentSecurityDecisionId,
      currentSecurityDecisionAt: input.currentSecurityDecisionAt,
      securityDecisionAgeMs: input.securityDecisionAgeMs ?? 0,
      currentPerformanceDecisionId: input.currentPerformanceDecisionId,
      currentPerformanceDecisionAt: input.currentPerformanceDecisionAt,
      performanceDecisionAgeMs: input.performanceDecisionAgeMs ?? 0,
      acceptedRisks: risks,
      openBlockingFindings: input.openBlockingFindings ?? [],
      confirmedRegressions: input.confirmedRegressions ?? [],
      blocked:
        input.blocked ??
        Boolean(
          staleSecurity ||
            stalePerformance ||
            (input.openBlockingFindings?.length ?? 0) > 0,
        ),
      createdAt: new Date().toISOString(),
      contentHash: hash(input),
    };
  }
}

function hash(value: unknown): string {
  return `sha256:${createHash("sha256").update(JSON.stringify(value)).digest("hex")}`;
}
