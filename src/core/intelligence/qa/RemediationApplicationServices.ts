/**
 * Remediation application, validation, regression confirmation, attempt tracking, and diagnostic
 * reruns (spec §23, §35, §36, §37, §38, §39, §40).
 *
 * These services model (not perform) the bounded, reversible, evidence-controlled remediation workflow.
 * Actual file edits go through the existing safe workspace-edit mechanisms; here we record intent,
 * scope, outcomes, and attempt limits, and we block unsafe transitions. One passing rerun never by
 * itself validates a remediation (§25, §39). Reversion preserves unrelated user changes (§40).
 */
import { createHash } from "node:crypto";
import {
  RemediationAttemptSchema,
  RegressionConfirmationSchema,
  DiagnosticRerunRecordSchema,
  AttemptLimitStatusSchema,
  HealingLimitPolicySchema,
  type RemediationAttempt,
  type RegressionConfirmation,
  type DiagnosticRerunRecord,
  type RemediationProposal,
  type AttemptLimitStatus,
  type HealingLimitPolicy,
  type DiagnosticRerunMode,
} from "../../../shared/contracts/qaRemediation";

export const DEFAULT_LIMIT_POLICY: HealingLimitPolicy = HealingLimitPolicySchema.parse({});

export class AttemptLimitService {
  constructor(private readonly policy: HealingLimitPolicy = DEFAULT_LIMIT_POLICY) {}

  init(): AttemptLimitStatus {
    return AttemptLimitStatusSchema.parse({
      proposalRevisions: 0,
      remediationApplications: 0,
      diagnosticReruns: 0,
      exhausted: false,
    });
  }

  recordProposalRevision(s: AttemptLimitStatus): AttemptLimitStatus {
    const next = { ...s, proposalRevisions: s.proposalRevisions + 1 };
    return this.check(next);
  }
  recordApplication(s: AttemptLimitStatus): AttemptLimitStatus {
    const next = { ...s, remediationApplications: s.remediationApplications + 1 };
    return this.check(next);
  }
  recordRerun(s: AttemptLimitStatus): AttemptLimitStatus {
    const next = { ...s, diagnosticReruns: s.diagnosticReruns + 1 };
    return this.check(next);
  }

  private check(s: AttemptLimitStatus): AttemptLimitStatus {
    const exhausted =
      s.proposalRevisions >= this.policy.maxProposalRevisions ||
      s.remediationApplications >= this.policy.maxRemediationApplications ||
      s.diagnosticReruns >= this.policy.maxDiagnosticReruns;
    const reason = exhausted
      ? "Healing attempt or rerun limit reached; manual intervention required."
      : undefined;
    return AttemptLimitStatusSchema.parse({ ...s, exhausted, reason });
  }
}

export class DiagnosticRerunService {
  record(input: {
    testId: string;
    mode: DiagnosticRerunMode;
    codeRevision?: string;
    testRevision?: string;
    environmentFingerprint?: string;
    command: string;
    seed?: string;
    order?: string;
    result: DiagnosticRerunRecord["result"];
    durationMs: number;
    failureSignature?: string;
  }): DiagnosticRerunRecord {
    return DiagnosticRerunRecordSchema.parse({
      id: `rerun:${createHash("sha256")
        .update(input.testId + input.mode + input.command + Date.now())
        .digest("hex")
        .slice(0, 12)}`,
      createdAt: new Date().toISOString(),
      ...input,
    });
  }
}

export class RemediationAttemptService {
  create(proposal: RemediationProposal, attemptNumber: number): RemediationAttempt {
    return RemediationAttemptSchema.parse({
      id: `attempt:${createHash("sha256")
        .update(proposal.id + attemptNumber)
        .digest("hex")
        .slice(0, 12)}`,
      proposalId: proposal.id,
      workflowId: proposal.workflowId,
      qaCycleId: proposal.qaCycleId,
      attemptNumber,
      application: { appliedFiles: [], rejectedFiles: [], unexpectedFiles: [] },
      validation: {},
      outcome: "applied",
      metadata: {
        startedAt: new Date().toISOString(),
        contentHash: createHash("sha256")
          .update(proposal.id + attemptNumber)
          .digest("hex")
          .slice(0, 32),
      },
    });
  }

  markApplied(
    attempt: RemediationAttempt,
    appliedFiles: string[],
    unexpectedFiles: string[],
  ): RemediationAttempt {
    return RemediationAttemptSchema.parse({
      ...attempt,
      application: { ...attempt.application, appliedFiles, unexpectedFiles },
      // Unexpected file modifications block validation and require reversion (§35).
      outcome: unexpectedFiles.length > 0 ? "blocked" : attempt.outcome,
    });
  }

  finalize(
    attempt: RemediationAttempt,
    outcome: RemediationAttempt["outcome"],
  ): RemediationAttempt {
    return RemediationAttemptSchema.parse({
      ...attempt,
      outcome,
      metadata: { ...attempt.metadata, completedAt: new Date().toISOString() },
    });
  }
}

export class RemediationApplicationService {
  /** Validate that an applied change is within the approved scope before recording. */
  isWithinScope(
    proposal: RemediationProposal,
    changedFiles: string[],
  ): { ok: boolean; unexpected: string[] } {
    const unexpected = changedFiles.filter(
      (f) =>
        proposal.scope.prohibitedFiles.includes(f) ||
        (proposal.scope.allowedFiles.length > 0 && !proposal.scope.allowedFiles.includes(f)),
    );
    return { ok: unexpected.length === 0, unexpected };
  }

  /** A stale proposal must never be applied (§47). */
  isStale(
    proposal: RemediationProposal,
    currentRevision: string,
    proposalRevision: string,
  ): boolean {
    return proposalRevision !== currentRevision;
  }
}

export class RemediationValidationService {
  /** Determine the attempt outcome from validation run results (§36, §38). */
  outcomeFromRuns(result: {
    targetedPassed: boolean;
    relatedPassed: boolean;
    regressionPassed: boolean;
  }): RemediationAttempt["outcome"] {
    if (!result.targetedPassed) return "targeted-failed";
    if (!result.relatedPassed) return "targeted-passed"; // targeted passed, related not yet
    if (!result.regressionPassed) return "regression-failed";
    return "regression-passed";
  }
}

export class RegressionConfirmationService {
  build(input: {
    remediationProposalId: string;
    qaCycleId: string;
    targetedTestResult: RegressionConfirmation["targetedTestResult"];
    relatedTestResults: RegressionConfirmation["relatedTestResults"];
    impactedTestResults: RegressionConfirmation["impactedTestResults"];
    requiredSuiteResults: RegressionConfirmation["requiredSuiteResults"];
    coverageGapStatus: RegressionConfirmation["coverageGapStatus"];
    affectedFlowValidation: RegressionConfirmation["affectedFlowValidation"];
    remainingFailures: string[];
    remainingFlakyRisk: boolean;
    remainingWarnings: string[];
  }): RegressionConfirmation {
    const allPassed = (arr: Array<"passed" | "failed" | "skipped" | "not-run">) =>
      arr.every((r) => r === "passed" || r === "skipped");
    const blockingFailure =
      input.targetedTestResult === "failed" ||
      input.relatedTestResults.includes("failed") ||
      input.impactedTestResults.includes("failed") ||
      input.requiredSuiteResults.includes("failed");

    let qaDecisionImpact: RegressionConfirmation["qaDecisionImpact"];
    if (blockingFailure) qaDecisionImpact = "failed";
    else if (
      input.remainingFlakyRisk ||
      input.remainingWarnings.length > 0 ||
      !allPassed(input.requiredSuiteResults)
    )
      qaDecisionImpact = "passed-with-warnings";
    else if (input.coverageGapStatus === "unresolved") qaDecisionImpact = "needs-remediation";
    else qaDecisionImpact = "passed";

    return RegressionConfirmationSchema.parse({
      id: `reg:${createHash("sha256")
        .update(input.remediationProposalId + input.qaCycleId)
        .digest("hex")
        .slice(0, 12)}`,
      ...input,
      qaDecisionImpact,
      metadata: {
        createdAt: new Date().toISOString(),
        contentHash: createHash("sha256").update(JSON.stringify(input)).digest("hex").slice(0, 32),
      },
    });
  }
}
