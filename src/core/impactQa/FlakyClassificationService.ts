import { randomUUID } from "node:crypto";
import type { FlakyClassification, FlakyState, FlakyTestRun } from "../../shared/contracts/qaTestIntelligence";

export interface FlakyConfig {
  /** Runs with at least one pass and one fail for the same revision. */
  candidateMinRuns: number;
  /** Runs with mixed outcomes across at least this many meaningful runs. */
  probableMinMixedRuns: number;
  /** Stronger evidence for confirmed-flaky (order/seed/timing dependence). */
  confirmedRequires: Array<"order" | "seed" | "timing">;
}

export const DEFAULT_FLAKY_CONFIG: FlakyConfig = {
  candidateMinRuns: 1,
  probableMinMixedRuns: 3,
  confirmedRequires: ["order"],
};

export interface FlakyInput {
  workflowId: string;
  testId: string;
  revision: string;
  environmentFingerprint: string;
  runs: FlakyTestRun[];
}

/**
 * Deterministic flaky classification from repeated-run history. A single
 * pass/fail pair never confirms flakiness; stable failures are not flaky.
 */
export class FlakyClassificationService {
  private readonly now: () => string;
  private readonly config: FlakyConfig;

  constructor(now: () => string = () => new Date().toISOString(), config: FlakyConfig = DEFAULT_FLAKY_CONFIG) {
    this.now = now;
    this.config = config;
  }

  classify(input: FlakyInput): FlakyClassification {
    const relevant = input.runs.filter(
      (run) => run.revision === input.revision && run.environmentFingerprint === input.environmentFingerprint,
    );
    const passes = relevant.filter((r) => r.result === "passed").length;
    const failures = relevant.filter((r) => r.result === "failed").length;
    const timeouts = relevant.filter((r) => r.result === "timeout").length;
    const infra = relevant.filter((r) => r.result === "infrastructure-failed" || r.result === "cancelled").length;
    const runCount = relevant.length;
    const signatures = [...new Set(relevant.map((r) => r.failureSignature).filter((s): s is string => Boolean(s)))];

    const hasPass = passes > 0;
    const hasFail = failures > 0;
    const mixed = hasPass && hasFail;

    let state: FlakyState;
    let confidence: number;
    let evidenceRequiredForStronger: string;

    if (runCount === 0) {
      state = "insufficient-evidence";
      confidence = 0;
      evidenceRequiredForStronger = "Record at least one repeated-run history entry for this revision and environment.";
    } else if (hasFail && !hasPass) {
      state = "stable-fail";
      confidence = Math.min(1, 0.6 + failures * 0.1);
      evidenceRequiredForStronger = "A stable failure is not flaky. A single pass on a different revision could indicate a regression; collect more evidence only if a pass appears.";
    } else if (hasPass && !hasFail && timeouts === 0 && infra === 0) {
      state = "stable-pass";
      confidence = Math.min(1, 0.6 + passes * 0.1);
      evidenceRequiredForStronger = "A stable pass is not flaky. Evidence of a failure under the same revision and environment is required to escalate.";
    } else if (mixed) {
      const environmentDependent = relevant.some((r) => r.environmentFingerprint !== input.environmentFingerprint);
      const orderDependent = relevant.some((r) => typeof r.orderIndex === "number") && new Set(relevant.map((r) => r.orderIndex)).size > 1;
      const timingSensitive = signatures.length > 1;
      if (this.config.confirmedRequires.every((req) => (req === "order" ? orderDependent : req === "seed" ? relevant.some((r) => Boolean(r.seed)) : timingSensitive))) {
        state = "confirmed-flaky";
        confidence = 0.92;
        evidenceRequiredForStronger = "Confirmed-flaky already satisfied by reproducible order/seed/timing dependence.";
      } else if (runCount >= this.config.probableMinMixedRuns) {
        state = "probable-flaky";
        confidence = 0.8;
        evidenceRequiredForStronger = "Reproducible order dependence, seed dependence, or timing-sensitive behaviour across controlled runs is required to confirm flakiness.";
      } else {
        state = "flaky-candidate";
        confidence = 0.55;
        evidenceRequiredForStronger = `At least ${this.config.probableMinMixedRuns} mixed-outcome runs (currently ${runCount}) or reproducible order/seed/timing dependence is required to escalate.`;
      }
      if (environmentDependent && state !== "confirmed-flaky") state = "environment-dependent";
      else if (orderDependent && state !== "confirmed-flaky" && state !== "probable-flaky") state = "order-dependent";
      else if (timingSensitive && state !== "confirmed-flaky" && state !== "probable-flaky") state = "timing-sensitive";
    } else if (timeouts > 0 || infra > 0) {
      state = "environment-dependent";
      confidence = 0.6;
      evidenceRequiredForStronger = "Timeouts or infrastructure failures are not flakiness; resolve the environment or infrastructure before classifying.";
    } else {
      state = "insufficient-evidence";
      confidence = 0.3;
      evidenceRequiredForStronger = "Insufficient evidence: collect more repeated runs for this revision and environment.";
    }

    return {
      testId: input.testId,
      workflowId: input.workflowId,
      state,
      confidence,
      passes,
      failures,
      timeouts,
      infrastructureFailures: infra,
      runCount,
      signatures,
      revision: input.revision,
      environmentFingerprint: input.environmentFingerprint,
      evidenceRequiredForStronger,
      updatedAt: this.now(),
    };
  }

  createRun(input: {
    workflowId: string;
    testId: string;
    revision: string;
    environmentFingerprint: string;
    result: FlakyTestRun["result"];
    durationMs?: number;
    failureSignature?: string;
    seed?: string;
    orderIndex?: number;
  }): FlakyTestRun {
    return {
      id: randomUUID(),
      workflowId: input.workflowId,
      testId: input.testId,
      revision: input.revision,
      environmentFingerprint: input.environmentFingerprint,
      result: input.result,
      durationMs: input.durationMs,
      failureSignature: input.failureSignature,
      seed: input.seed,
      orderIndex: input.orderIndex,
      executedAt: this.now(),
    };
  }
}
