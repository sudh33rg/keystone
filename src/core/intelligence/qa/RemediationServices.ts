/**
 * RemediationProposalService (spec §26, §34).
 *
 * Builds a structured remediation proposal from a failure analysis and screens it against the healing
 * policy (TestHealingPolicyService). Proposals that violate the policy are marked `blocked`; high-risk
 * proposals require approval. The user reviews the exact diff / scope before any application (see
 * RemediationApplicationService). Healing is evidence-controlled: a green result alone never validates.
 */
import { createHash } from "node:crypto";
import {
  RemediationProposalSchema,
  type RemediationProposal,
  type ProposedChange,
  type RemediationType,
  type FailureClassification,
} from "../../../shared/contracts/qaRemediation";
import { TestHealingPolicyService, DEFAULT_HEALING_POLICY } from "./TestHealingPolicyService";

export interface BuildProposalInput {
  failureAnalysisId: string;
  qaCycleId: string;
  workflowId?: string;
  type: RemediationType;
  rationale: string;
  classification: FailureClassification;
  scope: { allowedFiles: string[]; prohibitedFiles: string[]; targetEntityIds: string[] };
  changes: ProposedChange[];
  validation: { targetedTests: string[]; relatedTests: string[]; regressionScope: string[] };
  riskLevel: "low" | "medium" | "high" | "critical";
  /** Evidence context for policy screening. */
  policyCtx: {
    timeoutEvidenceMs?: number;
    snapshotDiffAvailable?: boolean;
    specificationEvidence?: boolean;
  };
}

export class RemediationProposalService {
  constructor(
    private readonly policy: TestHealingPolicyService = new TestHealingPolicyService(
      DEFAULT_HEALING_POLICY,
    ),
  ) {}

  build(input: BuildProposalInput): RemediationProposal {
    const now = new Date().toISOString();
    const id = `prop:${createHash("sha256")
      .update(input.failureAnalysisId + input.type + now)
      .digest("hex")
      .slice(0, 12)}`;
    const contentHash = createHash("sha256")
      .update(JSON.stringify(input))
      .digest("hex")
      .slice(0, 32);

    const screened = this.policy.screenProposal(
      RemediationProposalSchema.parse({
        id,
        failureAnalysisId: input.failureAnalysisId,
        qaCycleId: input.qaCycleId,
        workflowId: input.workflowId,
        type: input.type,
        rationale: input.rationale,
        scope: input.scope,
        changes: input.changes,
        validation: input.validation,
        risk: { level: input.riskLevel, warnings: [] },
        policy: { violations: [], approvalRequired: false },
        status: "draft",
        metadata: { createdAt: now, updatedAt: now, contentHash },
      }),
      input.policyCtx,
    );

    const blocking = screened.violations.some((v) => v.severity === "blocking");
    const status: RemediationProposal["status"] = blocking ? "blocked" : "ready";

    return RemediationProposalSchema.parse({
      id,
      failureAnalysisId: input.failureAnalysisId,
      qaCycleId: input.qaCycleId,
      workflowId: input.workflowId,
      type: input.type,
      rationale: input.rationale,
      scope: input.scope,
      changes: input.changes,
      validation: input.validation,
      risk: {
        level: input.riskLevel,
        warnings: screened.violations.filter((v) => v.severity === "warning").map((v) => v.detail),
      },
      policy: { violations: screened.violations, approvalRequired: screened.approvalRequired },
      status,
      metadata: { createdAt: now, updatedAt: now, contentHash },
    });
  }
}
