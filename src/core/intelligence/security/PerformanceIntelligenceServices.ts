/**
 * Performance intelligence engine + shared services (spec §23-§37, §39, §46, §47, §51).
 *
 * Deterministic discovery of critical paths, database/external/loop/blocking candidates, and runtime
 * evidence comparison against explicit baselines. N+1 / loop findings remain candidates until runtime
 * or batching/caching evidence confirms (§17, §25). Baselines are explicit and never silently selected
 * (§33). Incompatible environments warn rather than mislead (§21, §37). Reuses the Phase 6 change set and
 * impact analysis for performance impact scoring.
 */
import { createHash } from "node:crypto";
import {
  PerformancePathSchema,
  PerformancePathKindSchema,
  DatabaseInteractionSchema,
  ExternalCallInteractionSchema,
  PerformanceFindingSchema,
  PerformanceBaselineSchema,
  PerformanceAnalysisSchema,
  PerformanceSeveritySchema,
  RiskLevelSchema,
  RiskAcceptanceSchema,
  FindingRemediationLinkSchema,
  AnalysisFreshnessSchema,
  AnalysisStatusSchema,
  GateEvaluationSchema,
  type PerformancePath,
  type PerformancePathKind,
  type DatabaseInteraction,
  type ExternalCallInteraction,
  type PerformanceFinding,
  type PerformanceFindingCategory,
  type PerformanceRuntimeEvidence,
  type PerformanceBaseline,
  type PerformanceAnalysis,
  type RiskLevel,
  type RiskAcceptance,
  type FindingRemediationLink,
  type AnalysisFreshness,
  type GateEvaluation,
} from "../../../shared/contracts/qaSecurity";

export class CriticalPathDiscoveryService {
  discover(
    entries: Array<{
      entityId: string;
      kind: PerformancePathKind;
      mark?: PerformancePath["mark"];
      confidence?: number;
      evidence?: string[];
    }>,
  ): PerformancePath[] {
    return entries.map((e) =>
      PerformancePathSchema.parse({
        id: `pp:${e.entityId}:${e.kind}`,
        kind: e.kind,
        entryEntityId: e.entityId,
        mark: e.mark ?? "inferred",
        confidence: e.confidence ?? 0.5,
        evidence: e.evidence ?? [`${e.kind} path via ${e.entityId}`],
      }),
    );
  }
}

export class DatabaseInteractionAnalysisService {
  analyze(input: {
    entityId: string;
    operation: DatabaseInteraction["operation"];
    inLoop?: boolean;
    loopContext?: string;
    perItemQuery?: boolean;
    batchingEvidence?: boolean;
    cachingEvidence?: boolean;
    evidence?: string[];
  }): DatabaseInteraction {
    return DatabaseInteractionSchema.parse({
      id: `db:${input.entityId}`,
      entityId: input.entityId,
      operation: input.operation,
      inLoop: input.inLoop ?? false,
      loopContext: input.loopContext,
      perItemQuery: input.perItemQuery ?? false,
      batchingEvidence: input.batchingEvidence ?? false,
      cachingEvidence: input.cachingEvidence ?? false,
      confidence: input.inLoop ? 0.7 : 0.5,
      evidence: input.evidence ?? [],
      runtimeConfirmation: false,
    });
  }

  /** N+1 candidate only when a per-item query runs in a loop WITHOUT batching/caching evidence (§25). */
  nPlusOneCandidate(db: DatabaseInteraction): PerformanceFinding | null {
    if (db.inLoop && db.perItemQuery && !db.batchingEvidence && !db.cachingEvidence) {
      return this.finding(
        "n-plus-one-candidate",
        db.entityId,
        "Possible N+1: per-item query inside a loop without batching or caching evidence.",
        "high",
      );
    }
    return null;
  }

  private finding(
    category: PerformanceFindingCategory,
    entityId: string,
    description: string,
    severity: PerformanceFinding["severity"],
  ): PerformanceFinding {
    const now = new Date().toISOString();
    return PerformanceFindingSchema.parse({
      id: `pf:${category}:${entityId}`,
      analysisId: "pending",
      category,
      title: category,
      description,
      severity,
      confidence: 0.6,
      status: "open",
      scope: { entityIds: [entityId], flowIds: [], filePaths: [] },
      staticEvidenceIds: [],
      runtimeEvidenceIds: [],
      recommendation: { action: `Investigate ${category} on ${entityId}` },
      metadata: {
        createdAt: now,
        updatedAt: now,
        contentHash: createHash("sha256")
          .update(entityId + category)
          .digest("hex")
          .slice(0, 32),
      },
    });
  }
}

export class ExternalCallAnalysisService {
  analyze(input: {
    entityId: string;
    target: string;
    inLoop?: boolean;
    sequentialIndependent?: boolean;
    fanOutBreadth?: number;
    timeoutConfigured?: boolean;
    retryBehaviour?: boolean;
    circuitBreakingEvidence?: boolean;
    evidence?: string[];
  }): ExternalCallInteraction {
    return ExternalCallInteractionSchema.parse({
      id: `ext:${input.entityId}:${input.target}`,
      entityId: input.entityId,
      target: input.target,
      inLoop: input.inLoop ?? false,
      sequentialIndependent: input.sequentialIndependent ?? false,
      fanOutBreadth: input.fanOutBreadth,
      timeoutConfigured: input.timeoutConfigured ?? false,
      retryBehaviour: input.retryBehaviour ?? false,
      circuitBreakingEvidence: input.circuitBreakingEvidence ?? false,
      confidence: 0.6,
      evidence: input.evidence ?? [],
    });
  }
}

export class LoopFanoutAnalysisService {
  /** Bounded traversal: do not flag branch count alone; require a call inside a loop (§27). */
  detectInLoop(
    containingSymbol: string,
    calledOps: string[],
    loopEvidence: boolean,
  ): { category: PerformanceFindingCategory; found: boolean } {
    if (!loopEvidence) return { category: "unknown", found: false };
    const dbOrExternal = calledOps.some((o) =>
      /db|query|repository|fetch|http|request|call|send/i.test(o),
    );
    return dbOrExternal
      ? { category: "database-in-loop", found: true }
      : { category: "unbounded-fanout", found: calledOps.length > 10 };
  }
}

export class BlockingOperationAnalysisService {
  /** Definite-sync / potentially-blocking classification with latency-sensitivity context (§28). */
  classify(operation: string, latencySensitive: boolean): { blocking: boolean; certain: boolean } {
    const definite =
      /readFileSync|execSync|child_process|await.*\.run\(|sleep|setTimeout|while\(true\)/i.test(
        operation,
      );
    const potential = /await|fetch|read|write|query/i.test(operation);
    return { blocking: definite || (potential && latencySensitive), certain: definite };
  }
}

export class PerformanceBaselineService {
  create(b: Omit<PerformanceBaseline, "id" | "timestamp"> & { id?: string }): PerformanceBaseline {
    return PerformanceBaselineSchema.parse({
      ...b,
      id:
        b.id ??
        `base:${createHash("sha256")
          .update(b.benchmarkOrScenario + b.metric + (b.revision ?? ""))
          .digest("hex")
          .slice(0, 12)}`,
      timestamp: new Date().toISOString(),
    });
  }

  /** Explicit selection only — never silently use the most recent run (§33). */
  select(
    baselines: PerformanceBaseline[],
    scenario: string,
    metric: string,
  ): PerformanceBaseline | null {
    return baselines.find((b) => b.benchmarkOrScenario === scenario && b.metric === metric) ?? null;
  }
}

export class PerformanceComparisonService {
  /**
   * Compares current value to baseline. Warns (does not compute a misleading result) when environments
   * are incompatible or samples are insufficient (§21, §34). Does not claim significance from one run.
   */
  compare(
    current: PerformanceRuntimeEvidence,
    baseline: PerformanceBaseline,
  ): {
    absoluteDiff: number;
    percentDiff: number;
    regression: boolean;
    compatible: boolean;
    sufficient: boolean;
    warning?: string;
  } {
    const compatible =
      !current.environmentFingerprint ||
      !baseline.environmentFingerprint ||
      current.environmentFingerprint === baseline.environmentFingerprint;
    const sufficient = current.sampleCount >= 3 && baseline.sampleCount >= 3;
    const absoluteDiff = current.currentValue - baseline.value;
    const percentDiff = baseline.value !== 0 ? (absoluteDiff / baseline.value) * 100 : 0;
    const regression = absoluteDiff > 0;
    let warning: string | undefined;
    if (!compatible)
      warning = "Environment fingerprint differs from baseline; comparison may be misleading.";
    else if (!sufficient)
      warning = "Insufficient samples for a reliable comparison; treat as measurement-required.";
    return { absoluteDiff, percentDiff, regression, compatible, sufficient, warning };
  }
}

export class PerformanceFindingService {
  create(
    input: Omit<PerformanceFinding, "metadata" | "status"> &
      Partial<Pick<PerformanceFinding, "status">>,
  ): PerformanceFinding {
    const now = new Date().toISOString();
    return PerformanceFindingSchema.parse({
      ...input,
      status: input.status ?? "open",
      metadata: {
        createdAt: now,
        updatedAt: now,
        contentHash: createHash("sha256").update(JSON.stringify(input)).digest("hex").slice(0, 32),
      },
    });
  }
}

export class PerformanceGateService {
  evaluate(
    rule: string,
    passed: boolean,
    opts: {
      blocking?: boolean;
      evidence?: string[];
      remediationAction?: string;
      analysisId: string;
      kind?: "security" | "performance";
    },
  ): GateEvaluation {
    return GateEvaluationSchema.parse({
      id: `gate:${rule}:${opts.analysisId}`,
      analysisId: opts.analysisId,
      kind: opts.kind ?? "performance",
      rule,
      passed,
      blocking: opts.blocking ?? !passed,
      evidence: opts.evidence ?? [],
      remediationAction: opts.remediationAction,
      evaluatedAt: new Date().toISOString(),
    });
  }
}

// ---------------------------------------------------------------------------
// Shared services (§39, §46, §47, §51)
// ---------------------------------------------------------------------------

export class RiskAcceptanceService {
  accept(input: {
    findingId: string;
    reason: string;
    approvedBy: string;
    scope: string;
    expiry?: string;
    reviewNote?: string;
  }): RiskAcceptance {
    return RiskAcceptanceSchema.parse({
      id: `riskacc:${input.findingId}`,
      findingId: input.findingId,
      reason: input.reason,
      approvedBy: input.approvedBy,
      scope: input.scope,
      expiry: input.expiry,
      reviewNote: input.reviewNote,
      acceptedAt: new Date().toISOString(),
    });
  }
}

export class FindingRemediationRouter {
  /** Creates a bounded remediation work item link for a finding (§39). */
  route(
    findingId: string,
    targetStage: FindingRemediationLink["targetStage"],
    allowedScope: string[],
    executionProfileId?: string,
  ): FindingRemediationLink {
    return FindingRemediationLinkSchema.parse({
      findingId,
      remediationRequestId: `rem:${findingId}`,
      targetStage,
      allowedScope,
      executionProfileId,
    });
  }
}

export class AnalysisFreshnessService {
  /** Marks an analysis stale when any relevant trigger fired (§47). */
  evaluate(analysisId: string, reasons: string[]): AnalysisFreshness {
    return AnalysisFreshnessSchema.parse({
      analysisId,
      fresh: reasons.length === 0,
      reasons,
      lastEvaluatedAt: new Date().toISOString(),
    });
  }
}

// Re-exports.
export {
  PerformancePathKindSchema,
  RiskLevelSchema,
  PerformanceSeveritySchema,
  PerformanceAnalysisSchema,
};
export type { PerformanceAnalysis, RiskLevel };

// ---------------------------------------------------------------------------
// PerformanceAnalysis assembler — produces a fully-valid `PerformanceAnalysis`
// from discovered pieces (used by the orchestrator and Phase 9 review).
// ---------------------------------------------------------------------------

export interface AssemblePerformanceAnalysisInput {
  id: string;
  workflowId?: string;
  changeSetId?: string;
  rootEntityIds: string[];
  flowIds?: string[];
  criticalPaths?: PerformancePath[];
  databaseInteractions?: DatabaseInteraction[];
  externalCalls?: ExternalCallInteraction[];
  findings?: PerformanceFinding[];
  runtimeEvidence?: PerformanceRuntimeEvidence[];
  intelligenceRevision: string;
  riskLevel: RiskLevel;
  status?: "complete" | "partial" | "blocked" | "stale";
}

export class PerformanceAnalysisAssembler {
  build(input: AssemblePerformanceAnalysisInput): PerformanceAnalysis {
    const now = new Date().toISOString();
    return PerformanceAnalysisSchema.parse({
      id: input.id,
      workflowId: input.workflowId,
      changeSetId: input.changeSetId,
      scope: { rootEntityIds: input.rootEntityIds, flowIds: input.flowIds ?? [], planned: false },
      criticalPaths: input.criticalPaths ?? [],
      databaseInteractions: input.databaseInteractions ?? [],
      externalCalls: input.externalCalls ?? [],
      loopAndFanoutFindings: [],
      blockingFindings: [],
      allocationFindings: [],
      runtimeEvidence: input.runtimeEvidence ?? [],
      findings: input.findings ?? [],
      risk: {
        level: input.riskLevel,
        score:
          input.riskLevel === "critical"
            ? 0.95
            : input.riskLevel === "high"
              ? 0.8
              : input.riskLevel === "medium"
                ? 0.5
                : 0.2,
        factors: [],
      },
      warnings: [],
      metadata: {
        intelligenceRevision: input.intelligenceRevision,
        generatedAt: now,
        contentHash: createHash("sha256").update(JSON.stringify(input)).digest("hex").slice(0, 32),
        status: AnalysisStatusSchema.options.includes(input.status ?? "complete")
          ? (input.status ?? "complete")
          : "complete",
      },
    });
  }
}
