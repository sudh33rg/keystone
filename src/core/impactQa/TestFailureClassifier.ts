import { randomUUID } from "node:crypto";
import type {
  FailureAlternativeCategory,
  FailureCategory,
  FailureRecommendedAction,
  TestFailureAnalysis,
} from "../../shared/contracts/qaTestIntelligence";
import { TestFailureSignature } from "./TestFailureSignature";

export interface FailureClassificationEvidence {
  workflowId: string;
  qaExecutionId: string;
  testFailureId: string;
  /** The changed production files (relative paths) for this workflow. */
  changedProductionFiles: string[];
  /** The changed test files for this workflow. */
  changedTestFiles: string[];
  /** The changed fixture files for this workflow. */
  changedFixtureFiles: string[];
  /** The failed test's source file path. */
  testFilePath: string;
  /** The failed test's message. */
  message: string;
  /** The failed test's normalized message. */
  normalizedMessage: string;
  exceptionType?: string;
  assertionLocation?: string;
  stackFrames: string[];
  /** Approved specification text for requirement-evidence checks. */
  specification?: string;
  /** Expected (old) contract text that the test asserts, if known. */
  expectedContractText?: string;
  /** Current (new) contract text, if known. */
  currentContractText?: string;
  /** Detected environment problems, e.g. missing executable. */
  environmentProblems: string[];
  /** Detected infra problems, e.g. process termination. */
  infrastructureProblems: string[];
  /** Previous executions of this test: pass/fail per revision. */
  previousOutcomes: Array<{ revision: string; result: "passed" | "failed" }>;
  /** Timeout flag from the command result. */
  timedOut: boolean;
  /** Whether the failure signature varies across recent runs. */
  signatureVariesAcrossRuns: boolean;
  /** Whether the test is order or timing sensitive (observed). */
  orderOrTimingSensitive: boolean;
}

interface ClassificationResult {
  category: FailureCategory;
  confidence: number;
  evidenceIds: string[];
  alternatives: FailureAlternativeCategory[];
  recommendedAction: FailureRecommendedAction;
}

/**
 * Deterministic failure classifier. Runs before any optional agent analysis.
 * It never declares a product defect from a single vague stack trace; it
 * requires actual evidence (changed production code, fixture changes, mock
 * signature drift, environment/infrastructure signals, or mixed outcomes).
 */
export class TestFailureClassifier {
  private readonly now: () => string;
  private readonly createId: () => string;
  private readonly signature: TestFailureSignature;

  constructor(
    now: () => string = () => new Date().toISOString(),
    createId: () => string = randomUUID,
    signature: TestFailureSignature = new TestFailureSignature(),
  ) {
    this.now = now;
    this.createId = createId;
    this.signature = signature;
  }

  classify(input: FailureClassificationEvidence): TestFailureAnalysis {
    const result = this.decide(input);
    const failureSignature = this.signature.build({
      testId: input.testFailureId,
      testName: input.testFailureId,
      normalizedMessage: input.normalizedMessage,
      exceptionType: input.exceptionType,
      assertionLocation: input.assertionLocation,
      topStackFrames: input.stackFrames,
    });
    return {
      id: this.createId(),
      workflowId: input.workflowId,
      qaExecutionId: input.qaExecutionId,
      testFailureId: input.testFailureId,
      failureSignature,
      category: result.category,
      confidence: result.confidence,
      evidenceIds: result.evidenceIds,
      alternativeCategories: result.alternatives,
      recommendedAction: result.recommendedAction,
      status: "ready-for-review",
      createdAt: this.now(),
      updatedAt: this.now(),
    };
  }

  private decide(input: FailureClassificationEvidence): ClassificationResult {
    const evidenceId = (label: string) => `ev:${input.testFailureId}:${label}`;

    // 1. Infrastructure problem — process termination, runner crash, etc.
    if (input.infrastructureProblems.length) {
      return {
        category: "infrastructure-problem",
        confidence: 0.85,
        evidenceIds: input.infrastructureProblems.map((p) => evidenceId(p.slice(0, 40))),
        alternatives: [],
        recommendedAction: "fix-environment",
      };
    }

    // 2. Environment problem — missing executable, env var, service.
    if (input.environmentProblems.length) {
      return {
        category: "environment-problem",
        confidence: 0.85,
        evidenceIds: input.environmentProblems.map((p) => evidenceId(p.slice(0, 40))),
        alternatives: [],
        recommendedAction: "fix-environment",
      };
    }

    // 3. Timeout.
    if (input.timedOut) {
      return {
        category: "timeout",
        confidence: 0.8,
        evidenceIds: [evidenceId("timeout")],
        alternatives: [alt("infrastructure-problem", 0.2, [evidenceId("timeout")])],
        recommendedAction: "collect-more-evidence",
      };
    }

    // 4. Flaky candidate — mixed outcomes for the same revision, varying signature.
    const sameRevisionMixed = hasMixedOutcomesSameRevision(input.previousOutcomes);
    if (input.signatureVariesAcrossRuns || sameRevisionMixed) {
      return {
        category: "flaky-candidate",
        confidence: 0.7,
        evidenceIds: [evidenceId("signature-variation"), evidenceId("mixed-outcomes")],
        alternatives: [alt("production-defect", 0.2, [evidenceId("mixed-outcomes")])],
        recommendedAction: "rerun",
      };
    }

    // 5. Stale expectation — expected value conflicts with approved spec change.
    if (
      input.expectedContractText &&
      input.currentContractText &&
      input.expectedContractText !== input.currentContractText &&
      input.specification &&
      /change|update|modify|revise|new|intend/i.test(input.specification)
    ) {
      return {
        category: "stale-expectation",
        confidence: 0.78,
        evidenceIds: [evidenceId("contract-drift"), evidenceId("spec-change")],
        alternatives: [alt("production-defect", 0.2, [evidenceId("contract-drift")])],
        recommendedAction: "propose-test-remediation",
      };
    }

    // 6. Fixture problem — failure originates in changed fixtures.
    if (isFailureInChangedFiles(input) && input.changedFixtureFiles.some((f) => input.testFilePath.includes(f) || input.stackFrames.some((s) => s.includes(f)))) {
      return {
        category: "fixture-problem",
        confidence: 0.72,
        evidenceIds: input.changedFixtureFiles.map((f) => evidenceId(f)),
        alternatives: [alt("production-defect", 0.25, input.changedProductionFiles.map((f) => evidenceId(f)))],
        recommendedAction: "propose-test-remediation",
      };
    }

    // 7. Mock problem — mock signature no longer matches production interface.
    if (input.message.toLowerCase().includes("mock") || /mock .* (signature|interface|argument|arity)/i.test(input.message)) {
      return {
        category: "mock-problem",
        confidence: 0.7,
        evidenceIds: [evidenceId("mock-mismatch")],
        alternatives: [alt("production-defect", 0.25, [evidenceId("mock-mismatch")])],
        recommendedAction: "propose-test-remediation",
      };
    }

    // 8. Production defect — failure in changed production code, test unchanged,
    //    and related tests fail consistently.
    if (
      input.changedProductionFiles.some((f) => input.stackFrames.some((s) => s.includes(f))) &&
      !input.changedTestFiles.some((f) => input.testFilePath.includes(f))
    ) {
      return {
        category: "production-defect",
        confidence: 0.8,
        evidenceIds: input.changedProductionFiles.map((f) => evidenceId(f)),
        alternatives: [alt("fixture-problem", 0.15, input.changedFixtureFiles.map((f) => evidenceId(f)))],
        recommendedAction: "return-to-development",
      };
    }

    // 9. Unknown — require manual investigation / more evidence.
    return {
      category: "unknown",
      confidence: 0.4,
      evidenceIds: [evidenceId("insufficient-signals")],
      alternatives: [],
      recommendedAction: "collect-more-evidence",
    };
  }
}

function hasMixedOutcomesSameRevision(outcomes: Array<{ revision: string; result: "passed" | "failed" }>): boolean {
  const byRevision = new Map<string, Set<string>>();
  for (const outcome of outcomes) {
    const set = byRevision.get(outcome.revision) ?? new Set<string>();
    set.add(outcome.result);
    byRevision.set(outcome.revision, set);
  }
  for (const set of byRevision.values()) {
    if (set.has("passed") && set.has("failed")) return true;
  }
  return false;
}

function isFailureInChangedFiles(input: FailureClassificationEvidence): boolean {
  return [...input.changedProductionFiles, ...input.changedTestFiles, ...input.changedFixtureFiles].some(
    (f) => input.stackFrames.some((s) => s.includes(f)),
  );
}

function alt(category: string, confidence: number, evidenceIds: string[]): FailureAlternativeCategory {
  return { category, confidence, evidenceIds };
}
