import { createHash } from "node:crypto";
import {
  ChangeReadinessDecisionSchema,
  type ChangeReadinessDecision,
  type ReviewGateResult,
  type ReviewContractAssessment,
  type ReviewTraceabilityAssessment,
  type ReviewTestAssessment,
  type ReviewFinding,
} from "../../shared/contracts/prReview";
import { PrReviewPersistenceStore } from "../persistence/PrReviewPersistenceStore";

export interface ReadinessInput {
  workflowId: string;
  reviewId: string;
  traceability: ReviewTraceabilityAssessment;
  contractAssessment: ReviewContractAssessment;
  testAssessment: ReviewTestAssessment;
  findings: ReviewFinding[];
  qaCurrent: boolean;
  securityCurrent: boolean;
  performanceCurrent: boolean;
  reviewCurrent: boolean;
  traceabilityCurrent: boolean;
  approvedByUser: boolean;
}

export interface ReadinessResult {
  decision: ChangeReadinessDecision["decision"];
  ready: boolean;
  blockedBy: string[];
}

/**
 * Deterministic PR review readiness evaluator (spec §36, §37).
 *
 * Produces a `ChangeReadinessDecision` with:
 * - gate results per criterion area
 * - aggregate counts (critical/high/warning/acceptedRisk/deferred)
 * - evidence flags for staleness
 * - final decision enum with explicit user approval gate.
 */
export class ReviewReadinessService {
  private readonly store: PrReviewPersistenceStore;

  constructor(store: PrReviewPersistenceStore) {
    this.store = store;
  }

  evaluate(input: ReadinessInput): ReadinessResult {
    const now = new Date().toISOString();

    // --- gate checks --------------------------------------------------------
    const gates: ReviewGateResult[] = [];
    const blockers: string[] = [];

    // Gate 1: Acceptance criteria satisfied.
    const unsatCrit = input.traceability.links.filter(
      (link) =>
        link.kind === "acceptance-criterion" &&
        ["not-satisfied", "conflicting-evidence", "not-verified", "partially-satisfied"].includes(
          link.state,
        ),
    );
    const acceptedRisk = input.findings.filter((f) => f.status === "accepted-risk");

    gates.push(
      gate(
        "acceptance-criteria",
        unsatCrit.length === 0 ? "passed" : "failed",
        unsatCrit.map((l) => `${l.id}: ${l.state}`),
        unsatCrit.length
          ? `${unsatCrit.length} acceptance criterion not satisfied.`
          : "All acceptance criteria satisfied.",
      ),
    );
    unsatCrit.forEach((c) => blockers.push(`AC ${c.id} is ${c.state}.`));

    // Gate 2: Open critical findings.
    const criticalOpen = input.findings.filter(
      (f) => f.severity === "critical" && f.status === "open",
    );
    gates.push(
      gate(
        "open-critical-findings",
        criticalOpen.length === 0 ? "passed" : "failed",
        criticalOpen.map((f) => f.id),
        criticalOpen.length
          ? `${criticalOpen.length} open critical finding(s).`
          : "No open critical findings.",
      ),
    );
    criticalOpen.forEach((f) => blockers.push(`Critical open: ${f.title}`));

    // Gate 3: Stale evidence.
    const staleFlags: string[] = [];
    if (!input.qaCurrent) staleFlags.push("QA evidence is stale.");
    if (!input.securityCurrent) staleFlags.push("Security evidence is stale.");
    if (!input.performanceCurrent) staleFlags.push("Performance evidence is stale.");
    if (!input.traceabilityCurrent) staleFlags.push("Traceability evidence is stale.");
    gates.push(
      gate(
        "current-evidence",
        staleFlags.length === 0 ? "passed" : "failed",
        staleFlags,
        staleFlags.length
          ? "Stale evidence detected."
          : "QA/Security/Performance/Traceability evidence is current.",
      ),
    );
    blockers.push(...staleFlags);

    // Gate 4: Breaking/unresolved contracts.
    const breaking = input.contractAssessment.changes.filter(
      (c) => c.classification === "breaking" || c.classification === "destructive",
    );
    const unresolvedContract = breaking.length > 0;
    gates.push(
      gate(
        "unresolved-breaking-contracts",
        unresolvedContract ? "failed" : "passed",
        breaking.map((c) => c.id),
        unresolvedContract
          ? `${breaking.length} unresolved breaking contract(s).`
          : "No unresolved breaking contracts.",
      ),
    );
    if (unresolvedContract)
      blockers.push("Unresolved breaking contract changes must be dispositioned before readiness.");

    // Gate 5: Accepted risks disclosed.
    gates.push(
      gate(
        "accepted-risks-disclosed",
        acceptedRisk.length === 0 ? "passed" : "warning",
        acceptedRisk.map((f) => f.id),
        acceptedRisk.length > 0
          ? `${acceptedRisk.length} accepted risk(s) — disclosed.`
          : "No accepted risks.",
      ),
    );

    // Gate 6: User approval.
    gates.push(
      gate(
        "user-approval",
        input.approvedByUser ? "passed" : "incomplete",
        input.approvedByUser ? ["user-approved"] : [],
        input.approvedByUser
          ? "Final readiness approved by user."
          : "User approval is required for final readiness.",
      ),
    );

    // --- counts -------------------------------------------------------------
    const highOpen = input.findings.filter((f) => f.severity === "high" && f.status === "open");
    const warningOpen = input.findings.filter((f) => f.severity === "warning" && f.status === "open");
    const deferred = input.findings.filter((f) => f.status === "deferred");
    const counts = {
      criticalOpen: criticalOpen.length,
      highOpen: highOpen.length,
      warningOpen: warningOpen.length,
      acceptedRisk: acceptedRisk.length,
      deferred: deferred.length,
    };

    // --- decision -----------------------------------------------------------
    let decision: ChangeReadinessDecision["decision"];
    if (criticalOpen.length > 0 || unresolvedContract) {
      decision = "blocked";
    } else if (staleFlags.length > 0) {
      decision = "remediation-required";
    } else if (highOpen.length > 0 || !input.approvedByUser) {
      decision = "incomplete";
    } else if (warningOpen.length > 0 || acceptedRisk.length > 0) {
      decision = "ready-with-warnings";
    } else {
      decision = "ready";
    }

    const evidence = {
      traceabilityCurrent: input.traceabilityCurrent,
      qaCurrent: input.qaCurrent,
      securityCurrent: input.securityCurrent,
      performanceCurrent: input.performanceCurrent,
      reviewCurrent: input.reviewCurrent,
    };

    const value = ChangeReadinessDecisionSchema.parse({
      schemaVersion: 1,
      id: crypto.randomUUID(),
      workflowId: input.workflowId,
      reviewId: input.reviewId,
      decision,
      gates,
      counts,
      evidence,
      approvedByUser: input.approvedByUser,
      createdAt: now,
      contentHash: hash({ gates, counts, evidence, decision }),
    });

    void this.store.update((state) => ({
      ...state,
      readinessDecisions: [
        ...state.readinessDecisions.filter((d) => d.reviewId !== input.reviewId),
        value,
      ].slice(-200),
    }));

    return {
      decision: value.decision,
      ready: value.decision === "ready" || value.decision === "ready-with-warnings",
      blockedBy: blockers,
    };
  }
}

function gate(
  name: string,
  result: ReviewGateResult["result"],
  evidence: string[],
  reason: string,
  requiredNextAction = "",
): ReviewGateResult {
  return {
    gate: name,
    result,
    evidence,
    reason,
    requiredNextAction,
  };
}

function hash(value: unknown): string {
  return `sha256:${createHash("sha256").update(JSON.stringify(value)).digest("hex")}`;
}
