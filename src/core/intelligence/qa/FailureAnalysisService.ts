/**
 * FailureGroupingService (spec §31) + FailureAnalysisRequestService (spec §32).
 *
 * Groups failed tests by likely common cause (deterministic signals). Creates
 * FailureAnalysisRequest handoffs for Phase 7. Does NOT classify root cause in this phase
 * (classification categories are prepared for Phase 7).
 */
import type {
  FailureGroup,
  FailureAnalysisRequest,
  ParsedTestResult,
  QaGateInput,
} from "../../../shared/contracts/qaLifecycle";
import { createHash } from "node:crypto";

export class FailureGroupingService {
  group(results: ParsedTestResult[]): FailureGroup[] {
    const failures = results.filter(
      (r) => r.status === "failed" || r.status === "timed-out" || r.status === "cancelled",
    );
    const groups: FailureGroup[] = [];
    const assigned = new Set<string>();

    // Group by exact error message / stack root.
    const byError = new Map<string, ParsedTestResult[]>();
    for (const f of failures) {
      const key = (f.errorMessage ?? f.stackTrace ?? "unknown").split("\n")[0] ?? "unknown";
      const arr = byError.get(key) ?? [];
      arr.push(f);
      byError.set(key, arr);
    }
    for (const [key, items] of byError) {
      if (items.length <= 1) continue;
      const id = items[0]!.testFile ?? key;
      if (assigned.has(id)) continue;
      items.forEach((i) => assigned.add(i.testFile ?? i.testCase ?? id));
      groups.push(
        this.makeGroup(`grp:${shortId(key)}`, items, `Shared error: ${key.slice(0, 120)}`, 0.9),
      );
    }

    // Remaining ungrouped failures each become their own singleton group.
    for (const f of failures) {
      const k = f.testFile ?? f.testCase ?? f.suite ?? "unknown";
      if (assigned.has(k)) continue;
      assigned.add(k);
      groups.push(this.makeGroup(`grp:${shortId(k)}`, [f], `Isolated failure in ${k}`, 0.6));
    }
    return groups;
  }

  private makeGroup(
    id: string,
    items: ParsedTestResult[],
    evidence: string,
    confidence: number,
  ): FailureGroup {
    const changed = new Set<string>();
    for (const i of items) i.relatedChangedEntityIds.forEach((c) => changed.add(c));
    return {
      id,
      failureIds: items.map((i) => i.testCase ?? i.testFile ?? i.suite ?? id),
      commonEvidence: [evidence],
      likelyAffectedScope: changed.size
        ? `Changed entities: ${[...changed].join(", ")}`
        : "Scope not linked to changed entities",
      confidence,
      suggestedNextAction: "Route to Phase 7 failure analysis for classification.",
      classificationCategories: ["unsupported-or-unknown"],
    };
  }
}

export class FailureAnalysisRequestService {
  create(params: {
    qaCycleId: string;
    executionRunId: string;
    groups: FailureGroup[];
    failedCommands: string[];
    changedEntityIds: string[];
    impactedFlowIds: string[];
    relatedTestIds: string[];
    acceptanceCriteria: string[];
    relevantFixtureIds: string[];
    compressedContextProfile?: string;
    executionProfileId?: string;
    requestedCategories: FailureAnalysisRequest["requestedClassificationCategories"];
  }): FailureAnalysisRequest {
    const stackTraces = params.groups.flatMap((g) => g.commonEvidence);
    return {
      id: crypto.randomUUID(),
      qaCycleId: params.qaCycleId,
      executionRunId: params.executionRunId,
      failureIds: params.groups.flatMap((g) => g.failureIds),
      failedCommandIds: params.failedCommands,
      stackTraces,
      changedEntityIds: params.changedEntityIds,
      impactedFlowIds: params.impactedFlowIds,
      relatedTestIds: params.relatedTestIds,
      acceptanceCriteria: params.acceptanceCriteria,
      relevantFixtureIds: params.relevantFixtureIds,
      compressedContextProfile: params.compressedContextProfile,
      executionProfileId: params.executionProfileId,
      requestedClassificationCategories: params.requestedCategories,
      status: "open",
    };
  }
}

function shortId(s: string): string {
  return createHash("sha256").update(s).digest("hex").slice(0, 12);
}

// Re-export for convenience.
export type { QaGateInput };
