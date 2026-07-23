import { createHash } from "node:crypto";
import {
  PR_REVIEW_SCHEMA_VERSION,
  ReviewTestAssessmentSchema,
  type ReviewTestAssessment,
} from "../../shared/contracts/prReview";

export type TestResult = "passed" | "failed" | "skipped" | "not-run" | "flaky";

export interface TestAssessmentInput {
  workflowId: string;
  requiredImpactedTests: string[];
  testsExecuted: string[];
  resultsByTest: Record<string, TestResult>;
  generatedTestValidationIds?: string[];
  remediationValidationIds?: string[];
  unresolvedFailures?: string[];
  flakyStateIds?: string[];
  skippedTests?: string[];
  coverageGaps?: string[];
  policyViolations?: string[];
  qaDecisionCurrent: boolean;
}

export class ReviewTestAdequacyService {
  build(input: TestAssessmentInput): ReviewTestAssessment {
    const required = input.requiredImpactedTests;
    const executed = new Set(input.testsExecuted);
    const missing = required.filter((t) => !executed.has(t));
    const policyViolations = input.policyViolations ?? [];
    const unresolvedFailures = input.unresolvedFailures ?? [];
    const skipped = input.skippedTests ?? [];
    const flaky = input.flakyStateIds ?? [];

    const passedCount = input.testsExecuted.filter((t) => input.resultsByTest[t] === "passed").length;

    const state = deriveState(
      input.qaDecisionCurrent,
      policyViolations,
      unresolvedFailures,
      missing,
      required,
      skipped,
      flaky,
      input.coverageGaps,
      input.generatedTestValidationIds,
      passedCount,
      required.length,
    );

    return ReviewTestAssessmentSchema.parse({
      schemaVersion: PR_REVIEW_SCHEMA_VERSION,
      id: crypto.randomUUID(),
      workflowId: input.workflowId,
      state,
      requiredImpactedTests: required,
      testsExecuted: input.testsExecuted,
      resultsByTest: input.resultsByTest,
      generatedTestValidationIds: input.generatedTestValidationIds ?? [],
      remediationValidationIds: input.remediationValidationIds ?? [],
      unresolvedFailures,
      flakyStateIds: flaky,
      skippedTests: skipped,
      coverageGaps: input.coverageGaps ?? [],
      policyViolations,
      qaDecisionCurrent: input.qaDecisionCurrent,
      createdAt: new Date().toISOString(),
      contentHash: hash(input),
    });
  }

  static summary(input: TestAssessmentInput): {
    passed: number;
    failed: number;
    skipped: number;
    notRun: number;
  } {
    let passed = 0;
    let failed = 0;
    let skipped = 0;
    let notRun = 0;
    for (const t of input.testsExecuted) {
      const r = input.resultsByTest[t];
      if (r === "passed") passed++;
      else if (r === "failed") failed++;
      else if (r === "skipped") skipped++;
      else if (r === "flaky") failed++;
      else notRun++;
    }
    for (const t of input.requiredImpactedTests) {
      if (!input.testsExecuted.includes(t)) notRun++;
    }
    return { passed, failed, skipped, notRun };
  }

  validationSummary(input: TestAssessmentInput): {
    passed: number;
    failed: number;
    skipped: number;
    notRun: number;
  } {
    return ReviewTestAdequacyService.summary(input);
  }
}

function deriveState(
  qaDecisionCurrent: boolean,
  policyViolations: string[],
  unresolvedFailures: string[],
  missing: string[],
  required: string[],
  skipped: string[],
  flaky: string[],
  coverageGaps: string[] | undefined,
  generatedTestValidationIds: string[] | undefined,
  passedCount: number,
  requiredCount: number,
): ReviewTestAssessment["state"] {
  if (!qaDecisionCurrent) return "stale";
  if (policyViolations.length > 0) return "failed";
  if (unresolvedFailures.length > 0 || missing.length > 0 || required.length === 0) return "incomplete";
  if (!generatedTestValidationIds || generatedTestValidationIds.length === 0) return "incomplete";
  if (skipped.length > 0 || flaky.length > 0 || (coverageGaps && coverageGaps.length > 0))
    return "sufficient-with-warnings";
  if (passedCount >= requiredCount && requiredCount > 0) return "sufficient";
  return "incomplete";
}

function hash(value: unknown): string {
  return `sha256:${createHash("sha256").update(JSON.stringify(value)).digest("hex")}`;
}
