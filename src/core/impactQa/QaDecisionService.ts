import { createHash } from "node:crypto";
import type { QaDecision } from "../../shared/contracts/impactQa";

export class QaDecisionService {
  decide(input: { workflowId: string; qaPlanId: string; qaExecutionId?: string; planCurrent: boolean; impactCurrent: boolean; requiredExecuted: boolean; requiredPassed: boolean; executionSucceeded: boolean; blockingGapIds: string[]; warningGapIds: string[]; optionalSkipped: boolean; cancelled: boolean; evidenceIds: string[] }): QaDecision {
    const gates = [gate("plan-current", input.planCurrent, input.evidenceIds), gate("impact-current", input.impactCurrent, input.evidenceIds), gate("required-executed", input.requiredExecuted, input.evidenceIds), gate("required-passed", input.requiredPassed, input.evidenceIds), gate("execution-succeeded", input.executionSucceeded, input.evidenceIds), gate("no-blocking-gaps", input.blockingGapIds.length === 0, input.blockingGapIds)];
    let decision: QaDecision["decision"]; if (input.cancelled) decision = "cancelled"; else if (!input.planCurrent || !input.impactCurrent || !input.requiredExecuted) decision = "incomplete"; else if (!input.requiredPassed || !input.executionSucceeded || input.blockingGapIds.length) decision = "failed"; else if (input.optionalSkipped || input.warningGapIds.length) decision = "passed-with-warnings"; else decision = "passed";
    const createdAt = new Date().toISOString(); const unresolvedFailureIds = decision === "failed" ? input.evidenceIds : []; const coverageGapIds = [...input.blockingGapIds, ...input.warningGapIds]; const contentHash = `sha256:${createHash("sha256").update(JSON.stringify({ decision, gates, coverageGapIds })).digest("hex")}`;
    return { id: crypto.randomUUID(), workflowId: input.workflowId, qaPlanId: input.qaPlanId, qaExecutionId: input.qaExecutionId, decision, gates, unresolvedFailureIds, coverageGapIds, createdAt, contentHash };
  }
}
function gate(id: string, passed: boolean, evidenceIds: string[]) { return { id, passed, evidenceIds, message: passed ? `${id} passed.` : `${id} did not pass.` }; }
