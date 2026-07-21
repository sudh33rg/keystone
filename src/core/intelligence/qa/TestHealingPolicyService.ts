/**
 * TestHealingPolicyService (spec §25).
 *
 * Encodes the NON-NEGOTIABLE safe-healing rules. Every generated change and every remediation proposal
 * is screened; any blocking violation prevents automatic remediation. This is the core guard that stops
 * "make it green" behaviour: assertion weakening, test deletion, silent skipping, arbitrary sleeps,
 * unjustified snapshot updates, unsupported timeout increases, and out-of-scope file edits.
 */
import {
  PolicyViolationSchema,
  type PolicyViolation,
  type RemediationProposal,
  type ProposedChange,
} from "../../../shared/contracts/qaRemediation";

export interface HealingPolicyConfig {
  /** Disallow any automatic remediation (everything requires manual approval). */
  requireManualApprovalForAll: boolean;
  /** Maximum allowed timeout increase (ms) when timing evidence exists. */
  maxTimeoutIncreaseMs: number;
  /** Whether local timeout changes are permitted by repository policy. */
  allowLocalTimeoutChanges: boolean;
}

export const DEFAULT_HEALING_POLICY: HealingPolicyConfig = {
  requireManualApprovalForAll: false,
  maxTimeoutIncreaseMs: 5000,
  allowLocalTimeoutChanges: false,
};

export class TestHealingPolicyService {
  constructor(private readonly config: HealingPolicyConfig = DEFAULT_HEALING_POLICY) {}

  /**
   * Screen a single proposed change. Returns violations (warning or blocking).
   * A blocking violation must prevent automatic application (per §25, §34).
   */
  screenChange(
    change: ProposedChange,
    ctx: { timeoutEvidenceMs?: number; snapshotDiffAvailable?: boolean },
  ): PolicyViolation[] {
    const violations: PolicyViolation[] = [];

    if (change.changeType === "delete") {
      violations.push(
        this.v(
          "never-delete-test",
          "blocking",
          "Proposal deletes a file; automatic deletion of tests is forbidden.",
        ),
      );
    }
    if (change.assertionChange) {
      violations.push(
        this.v(
          "never-weaken-assertion",
          "blocking",
          "Proposal weakens or removes an assertion. Assertions must not be replaced with weaker existence checks merely to pass.",
        ),
      );
    }
    if (change.changeType === "modify" && this.looksLikeDisable(change)) {
      violations.push(
        this.v(
          "never-disable-test",
          "blocking",
          "Proposal appears to disable or skip a test (e.g. .skip / xit / @Disabled).",
        ),
      );
    }
    if (change.snapshotChange && !ctx.snapshotDiffAvailable) {
      violations.push(
        this.v(
          "never-silent-snapshot",
          "blocking",
          "Proposal updates a snapshot without showing the diff for review.",
        ),
      );
    }
    if (change.timeoutChange) {
      if (!this.config.allowLocalTimeoutChanges) {
        violations.push(
          this.v(
            "timeout-policy",
            "blocking",
            "Repository policy does not allow local timeout changes.",
          ),
        );
      } else if (ctx.timeoutEvidenceMs === undefined) {
        violations.push(
          this.v(
            "timeout-evidence",
            "blocking",
            "Timeout increase proposed without timing evidence that the test consistently exceeds the old threshold.",
          ),
        );
      } else if (ctx.timeoutEvidenceMs > this.config.maxTimeoutIncreaseMs) {
        violations.push(
          this.v(
            "timeout-too-large",
            "blocking",
            `Timeout increase (${ctx.timeoutEvidenceMs}ms) exceeds the maximum allowed (${this.config.maxTimeoutIncreaseMs}ms).`,
          ),
        );
      }
    }
    return violations;
  }

  /**
   * Screen a full remediation proposal against the policy and the approved scope.
   */
  screenProposal(
    proposal: RemediationProposal,
    ctx: {
      timeoutEvidenceMs?: number;
      snapshotDiffAvailable?: boolean;
      specificationEvidence?: boolean;
    },
  ): { violations: PolicyViolation[]; approvalRequired: boolean } {
    const violations: PolicyViolation[] = [];

    for (const change of proposal.changes) {
      const inScope = proposal.scope.allowedFiles.includes(change.filePath);
      const prohibited = proposal.scope.prohibitedFiles.includes(change.filePath);
      if (prohibited || (proposal.scope.allowedFiles.length > 0 && !inScope)) {
        violations.push(
          this.v(
            "scope-violation",
            "blocking",
            `Change to ${change.filePath} is outside the approved scope.`,
          ),
        );
      }
      violations.push(...this.screenChange(change, ctx));
    }

    const blocking = violations.some((v) => v.severity === "blocking");
    const highRisk = proposal.risk.level === "high" || proposal.risk.level === "critical";
    const approvalRequired = this.config.requireManualApprovalForAll || highRisk || blocking;

    return { violations, approvalRequired };
  }

  /** Bounded retry / attempt enforcement (spec §27, §37). */
  isRetryAllowed(attemptsSoFar: number, maxAttempts: number): boolean {
    return attemptsSoFar < maxAttempts;
  }

  private looksLikeDisable(change: ProposedChange): boolean {
    return /skip|xit\b|@Disabled|todo|only\(/i.test(change.description);
  }

  private v(rule: string, severity: "warning" | "blocking", detail: string): PolicyViolation {
    return PolicyViolationSchema.parse({ rule, severity, detail });
  }
}
