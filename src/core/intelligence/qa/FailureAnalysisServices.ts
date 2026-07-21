/**
 * FailureEvidenceService (spec §16).
 *
 * Collects structured evidence for a failed test from the Phase 6 execution run, the parsed result,
 * the changed symbols, impacted flows, related acceptance criteria, and prior history. Representative
 * excerpts are kept (raw logs are referenced, not inlined) so the evidence package stays bounded.
 */
import {
  FailureEvidenceSchema,
  FlakyTestAssessmentSchema,
  type FailureEvidence,
  type FlakyTestAssessment,
} from "../../../shared/contracts/qaRemediation";
import type {
  ParsedTestResult,
  TestExecutionRun,
  ImpactAnalysis,
  FailureGroup,
} from "../../../shared/contracts/qaLifecycle";

export interface FailureEvidenceInput {
  result: ParsedTestResult;
  executionRun?: TestExecutionRun;
  impact?: ImpactAnalysis;
  failureGroup?: FailureGroup;
  acceptanceCriteria?: string[];
  repositoryRevision?: string;
  environmentFingerprint?: string;
  priorRuns?: ParsedTestResult[];
  previousPassHistory?: string[];
  retryHistory?: string[];
  relatedFailures?: string[];
  rawLogRef?: string;
}

export class FailureEvidenceService {
  collect(input: FailureEvidenceInput): FailureEvidence {
    const {
      result,
      executionRun,
      impact,
      failureGroup,
      acceptanceCriteria,
      repositoryRevision,
      environmentFingerprint,
    } = input;
    const changedSymbolIds = [
      ...new Set([
        ...(result.relatedChangedEntityIds ?? []),
        ...(failureGroup?.likelyAffectedScope ? [failureGroup.likelyAffectedScope] : []),
      ]),
    ];
    const impactedFlowIds =
      impact?.flows
        .filter((f) => f.relatedTestIds.includes(result.testCase ?? result.testFile ?? ""))
        .map((f) => f.id) ?? [];

    const stackFrames = this.extractStackFrames(result.stackTrace);
    const relatedProductionCode = (impact?.entities ?? [])
      .filter((e) => changedSymbolIds.includes(e.entityId))
      .map((e) => `${e.filePath ?? e.entityId}:${e.displayName}`);

    return FailureEvidenceSchema.parse({
      testResultId: this.resultKey(result),
      testSource: result.testCase,
      stackFrames,
      expectedValue: result.expectedValue,
      actualValue: result.actualValue,
      relatedProductionCode,
      changedSymbolIds,
      impactedFlowIds,
      fixtures: [],
      mocks: [],
      environmentFingerprint,
      previousRuns: (input.priorRuns ?? []).map((r) => this.resultKey(r)),
      recentPassHistory: input.previousPassHistory ?? [],
      retryHistory: input.retryHistory ?? [],
      relatedFailures: input.relatedFailures ?? [],
      acceptanceCriteria: acceptanceCriteria ?? [],
      repositoryRevision,
      testConfiguration: executionRun?.commands.find((c) => c.commandId)?.template,
      timeoutMs: result.durationMs !== undefined ? Math.round(result.durationMs * 4) : undefined,
      durationMs: result.durationMs,
      rawLogRef: input.rawLogRef,
    });
  }

  private resultKey(r: ParsedTestResult): string {
    return [r.testFile, r.testCase].filter(Boolean).join("#");
  }

  private extractStackFrames(stack?: string): string[] {
    if (!stack) return [];
    return stack
      .split("\n")
      .map((l) => l.trim())
      .filter((l) => l.length > 0)
      .slice(0, 20);
  }
}

/**
 * DeterministicFailureClassifier (spec §17, §18).
 *
 * Pre-classification runs BEFORE any agent delegation (per §12, §18). It applies explicit, evidenced
 * rules and records the result separately from any agent classification. When evidence is weak it
 * returns "unknown" with competing hypotheses and the missing evidence (never forces a confident call).
 */
import {
  DeterministicClassificationSchema,
  type DeterministicClassification,
  type FailureClassification,
} from "../../../shared/contracts/qaRemediation";

export interface DeterministicClassificationInput {
  result: ParsedTestResult;
  /** The test previously passed and the failure now reproduces consistently. */
  previouslyPassed: boolean;
  failureReproducesConsistently: boolean;
  /** Failure path intersects changed production code. */
  failureIntersectsChangedCode: boolean;
  /** Approved specification / public contract changed intentionally. */
  specificationChanged: boolean;
  contractChanged: boolean;
  relatedSpecRevision?: string;
  /** Rerun with no code change passed. */
  rerunPassedWithoutChange: boolean;
  /** Timing/order/shared-state signature present. */
  timingSensitive: boolean;
  orderDependent: boolean;
  sharedMutableState: boolean;
  /** Environment/infrastructure signals. */
  serviceUnavailable: boolean;
  portConflict: boolean;
  missingRuntime: boolean;
  dependencyInstallFailed: boolean;
  testRunnerCrash: boolean;
  resourceExhaustion: boolean;
  environmentConfigFailure: boolean;
  /** Test-data / fixture / mock signals. */
  fixtureMissing: boolean;
  mockContractMismatch: boolean;
}

export class DeterministicFailureClassifier {
  classify(input: DeterministicClassificationInput): DeterministicClassification {
    const evidence: string[] = [];
    const missing: string[] = [];
    const alternatives: Array<{
      category: FailureClassification;
      confidence: number;
      reason: string;
    }> = [];

    // Environment / infrastructure (highest precedence — not a code defect).
    if (
      input.serviceUnavailable ||
      input.portConflict ||
      input.missingRuntime ||
      input.dependencyInstallFailed ||
      input.testRunnerCrash ||
      input.resourceExhaustion ||
      input.environmentConfigFailure
    ) {
      const reason = [
        input.serviceUnavailable && "service unavailable",
        input.portConflict && "port conflict",
        input.missingRuntime && "missing runtime",
        input.dependencyInstallFailed && "dependency install failure",
        input.testRunnerCrash && "test runner crash",
        input.resourceExhaustion && "resource exhaustion",
        input.environmentConfigFailure && "environment configuration failure",
      ]
        .filter(Boolean)
        .join("; ");
      return this.build(
        "environment-issue",
        0.85,
        [reason],
        [],
        [],
        "Investigate environment before any code or test change.",
        false,
      );
    }

    // Flaky behaviour (timing/order/shared state, or rerun passes without change).
    if (
      input.rerunPassedWithoutChange ||
      input.timingSensitive ||
      input.orderDependent ||
      input.sharedMutableState
    ) {
      const reasons: string[] = [];
      if (input.rerunPassedWithoutChange) reasons.push("Rerun passed with no code change.");
      if (input.timingSensitive) reasons.push("Timing-sensitive failure signature.");
      if (input.orderDependent) reasons.push("Order-dependent failure.");
      if (input.sharedMutableState) reasons.push("Shared mutable state detected.");
      alternatives.push({
        category: "product-defect",
        confidence: 0.2,
        reason: "Could still be a real defect; confirm with a clean rerun.",
      });
      return this.build(
        "flaky-behaviour",
        0.7,
        reasons,
        alternatives,
        [],
        "Run diagnostic reruns (isolated, order-variation) before concluding.",
        false,
      );
    }

    // Stale test (spec/contract changed intentionally).
    if ((input.specificationChanged || input.contractChanged) && input.relatedSpecRevision) {
      const reasons = [
        input.specificationChanged && "Approved specification changed.",
        input.contractChanged && "Public contract changed intentionally.",
        `Supporting revision: ${input.relatedSpecRevision}.`,
      ].filter(Boolean) as string[];
      alternatives.push({
        category: "incorrect-expectation",
        confidence: 0.3,
        reason: "Verify the expectation is truly superseded.",
      });
      return this.build(
        "stale-test",
        0.75,
        reasons,
        alternatives,
        [],
        "Require specification/contract evidence; update the test to the new expected behaviour.",
        false,
      );
    }

    // Test-data / fixture / mock problems.
    if (input.fixtureMissing)
      return this.build(
        "fixture-problem",
        0.7,
        ["Missing fixture for the test."],
        [],
        [],
        "Repair or add the fixture.",
        false,
      );
    if (input.mockContractMismatch)
      return this.build(
        "mock-problem",
        0.7,
        ["Mock contract does not match the production contract."],
        [],
        [],
        "Update the mock to the current contract.",
        false,
      );

    // Product defect (strong signal).
    if (
      input.failureIntersectsChangedCode &&
      input.previouslyPassed &&
      input.failureReproducesConsistently &&
      input.relatedSpecRevision
    ) {
      evidence.push("Failure path intersects changed production code.");
      evidence.push("Test previously passed and now fails consistently.");
      evidence.push(`Acceptance criteria unchanged at revision ${input.relatedSpecRevision}.`);
      return this.build(
        "product-defect",
        0.8,
        evidence,
        [],
        [],
        "Route to bounded production remediation; preserve the failing test as regression evidence.",
        false,
      );
    }

    // Insufficient evidence → unknown, with what is missing.
    if (!input.previouslyPassed)
      missing.push("No prior-pass history to distinguish new defect from stale test.");
    if (!input.failureReproducesConsistently)
      missing.push("Failure not yet confirmed to reproduce consistently.");
    if (!input.relatedSpecRevision)
      missing.push("No specification/contract revision to evaluate expectation validity.");
    missing.push("Consider a diagnostic rerun or agent-assisted classification.");

    return this.build(
      "unknown",
      0.3,
      evidence.length ? evidence : ["Insufficient deterministic signals."],
      alternatives,
      missing,
      "Gather more evidence (rerun, history) or use agent-assisted classification.",
      false,
    );
  }

  private build(
    primary: FailureClassification,
    confidence: number,
    evidence: string[],
    alternatives: Array<{ category: FailureClassification; confidence: number; reason: string }>,
    missingEvidence: string[],
    recommendedNextAction: string,
    automaticRemediationAllowed: boolean,
  ): DeterministicClassification {
    return DeterministicClassificationSchema.parse({
      primary,
      confidence,
      evidence,
      competingHypotheses: alternatives,
      missingEvidence,
      recommendedNextAction,
      automaticRemediationAllowed,
      source: "deterministic",
    });
  }
}

/**
 * FlakyTestIntelligenceService (spec §21, §22).
 *
 * Assesses flakiness ONLY from local execution history (Phase 6 runs). Multiple signals are required;
 * a single failed-then-passed run does NOT label a test flaky (per §21). Produces a bounded
 * classification (not-enough-evidence | suspected | probable | confirmed | unlikely) plus likely causes.
 */
export class FlakyTestIntelligenceService {
  assess(
    testId: string,
    history: ParsedTestResult[],
    priorReruns: Array<{ passed: boolean; signature?: string }> = [],
  ): FlakyTestAssessment {
    const all = [
      ...history.map((r) => ({ passed: r.status === "passed", signature: this.signature(r) })),
      ...priorReruns.map((r) => ({ passed: r.passed, signature: r.signature })),
    ];
    const totalRuns = all.length;
    const passCount = all.filter((r) => r.passed).length;
    const failCount = all.filter((r) => !r.passed).length;
    const signatures = new Set(
      all
        .filter((r) => !r.passed)
        .map((r) => r.signature)
        .filter(Boolean) as string[],
    );
    const alternating = this.alternating(all.map((r) => r.passed));
    const rerunPassNoChange = priorReruns.length > 0 && priorReruns.some((r) => r.passed);

    let classification: FlakyTestAssessment["classification"] = "not-enough-evidence";
    let score = 0;
    const causes: FlakyTestAssessment["likelyCauses"] = [];

    if (totalRuns < 3) {
      classification = "not-enough-evidence";
      score = 0;
    } else if (failCount === 0) {
      classification = "unlikely";
      score = 0.05;
    } else if (alternating && (rerunPassNoChange || totalRuns >= 4)) {
      // Strong evidence: consistent alternation (or a clean unchanged rerun pass) across enough runs.
      classification = "confirmed";
      score = 0.95;
      causes.push({ cause: "timing", confidence: 0.6, evidenceIds: [] });
    } else if (alternating || rerunPassNoChange) {
      classification = "probable";
      score = 0.75;
      causes.push({ cause: "shared-state", confidence: 0.5, evidenceIds: [] });
    } else if (failCount > 0 && signatures.size > 1) {
      classification = "suspected";
      score = 0.5;
      causes.push({ cause: "unknown", confidence: 0.4, evidenceIds: [] });
    } else if (failCount > 0 && signatures.size <= 1) {
      // Consistent failure signature → likely deterministic, not flaky.
      classification = "unlikely";
      score = 0.2;
    }

    return FlakyTestAssessmentSchema.parse({
      id: `flaky:${testId}`,
      testId,
      classification,
      score,
      evidence: {
        totalRuns,
        passCount,
        failCount,
        relevantUnchangedReruns: priorReruns.length,
        failureSignatureCount: signatures.size,
      },
      likelyCauses: causes,
      metadata: { evaluatedAt: new Date().toISOString(), historyRevision: "local" },
    });
  }

  private signature(r: ParsedTestResult): string {
    return [r.errorMessage, r.stackTrace?.split("\n")[0], r.actualValue]
      .filter(Boolean)
      .join("|")
      .slice(0, 200);
  }

  private alternating(seq: boolean[]): boolean {
    if (seq.length < 2) return false;
    let alternations = 0;
    for (let i = 1; i < seq.length; i++) if (seq[i] !== seq[i - 1]) alternations++;
    return alternations >= 2 && seq.length >= 3;
  }
}
