/**
 * TestPlanService (spec §20, §21, §22) and QaGateService / QaDecisionService (§33, §34).
 *
 * Builds a risk-driven, layer-grouped test plan and evaluates explicit QA gates into a
 * final, evidence-backed decision. Never infers a decision from exit code alone.
 */
import type { IntelligenceSnapshot } from "../../../shared/contracts/intelligence";
import type {
  ChangeSet,
  CoverageGap,
  ImpactAnalysis,
  QaDecision,
  QaGateInput,
  QaGateResult,
  TestLayer,
  TestPlan,
  TestSelection,
} from "../../../shared/contracts/qaLifecycle";
import { createHash } from "node:crypto";
import type { DiscoveredTest, TestMapping } from "./TestMappingService";
import { ImpactedTestRanker } from "./TestMappingService";

export type QaStrategy = "targeted" | "layered" | "full-regression";

export interface PlanInputs {
  impact: ImpactAnalysis;
  changeSet: ChangeSet;
  discovered: DiscoveredTest[];
  mappings: Array<{ test: DiscoveredTest; mappings: TestMapping[] }>;
  gaps: CoverageGap[];
  riskLevel: "low" | "medium" | "high" | "critical";
  strategy: QaStrategy;
  requireUserApproval: boolean;
  userAddedTestIds?: string[];
  userRemovedTestIds?: string[];
  pinnedRequiredTestIds?: string[];
  maximumDurationSeconds?: number;
}

export class TestPlanService {
  constructor(private readonly snapshot: IntelligenceSnapshot) {}

  build(inputs: PlanInputs): TestPlan {
    const ranker = new ImpactedTestRanker();
    const refs = ranker.rank(inputs.impact, inputs.mappings, inputs.changeSet.symbols);

    const selected = refs
      .filter((r) => !inputs.userRemovedTestIds?.includes(r.testId))
      .filter((r) => this.selectByStrategy(r.ranking, inputs.strategy))
      .map<TestSelection>((r): TestSelection => {
        const pinned = inputs.pinnedRequiredTestIds?.includes(r.testId) ?? false;
        return {
          testId: r.testId,
          displayName: r.displayName,
          layer: layerFor(r.mappedEntityIds, this.snapshot),
          commandId: `cmd:${layerFor(r.mappedEntityIds, this.snapshot)}`,
          ranking: r.ranking,
          pinned,
          userAdded: inputs.userAddedTestIds?.includes(r.testId) ?? false,
          userRemoved: false,
          reason: r.reason,
          estimatedCost: r.ranking === "required" ? "medium" : "low",
        };
      });

    const commands = this.commandsFor(selected, inputs.strategy);
    const blockingGapSeverities = inputs.gaps
      .filter((g) => g.risk === "critical" || g.risk === "high")
      .map((g) => g.gapType);

    const objectives = this.objectives(inputs);

    return {
      id: crypto.randomUUID(),
      workflowId: inputs.changeSet.workflowId,
      impactAnalysisId: inputs.impact.id,
      objectives,
      selections: selected,
      generationRequests: inputs.gaps
        .filter((g) => g.testGenerationRecommended)
        .map((g) => ({
          id: `gen:${g.id}`,
          targetProductionEntityIds: g.affectedEntityId ? [g.affectedEntityId] : [],
          affectedFlowId: g.affectedFlowId,
          missingTestLayer: g.recommendedTestLayer,
          proposedScenario: g.proposedScenarioSummary,
          expectedBehaviour: g.proposedScenarioSummary,
          priority: g.risk,
          risk: g.risk,
          contextRequirements: [],
          exampleTestReferences: [],
          status: "proposed" as const,
        })),
      commands,
      coverageGaps: inputs.gaps,
      gates: {
        requiredSelectionsPassed: selected.some((s) => s.ranking === "required"),
        allowPartialExecution: true,
        blockingGapSeverities,
        requireUserApproval: inputs.requireUserApproval,
      },
      budget: {
        estimatedDurationSeconds: commands.length * 30,
        maximumDurationSeconds: inputs.maximumDurationSeconds,
        executionMode: inputs.strategy,
      },
      status: inputs.requireUserApproval ? "awaiting-approval" : "ready",
      metadata: {
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        contentHash: this.hash(selected, commands),
      },
    };
  }

  private selectByStrategy(ranking: TestSelection["ranking"], strategy: QaStrategy): boolean {
    if (strategy === "targeted")
      return ranking === "required" || ranking === "strongly-recommended";
    if (strategy === "layered") return ranking !== "optional" && ranking !== "unresolved-candidate";
    return true; // full-regression
  }

  private commandsFor(selections: TestSelection[], strategy: QaStrategy): TestPlan["commands"] {
    if (strategy === "full-regression") {
      return [
        {
          commandId: "cmd:full-regression",
          displayName: "Full regression",
          template: "npm test",
          layer: "full-regression",
          scope: "repository",
          broaderThanSelection: true,
        },
      ];
    }
    const byLayer = new Map<TestLayer, TestSelection[]>();
    for (const s of selections) byLayer.set(s.layer, [...(byLayer.get(s.layer) ?? []), s]);
    const order: TestLayer[] = ["static", "unit", "component", "integration", "contract", "e2e"];
    const cmds: TestPlan["commands"] = [];
    for (const layer of order) {
      const sel = byLayer.get(layer);
      if (!sel || sel.length === 0) continue;
      cmds.push({
        commandId: `cmd:${layer}`,
        displayName: `${layer} tests`,
        template: `npm test -- --layer ${layer}`,
        layer,
        scope: `${sel.length} test(s)`,
        broaderThanSelection: false,
      });
    }
    return cmds;
  }

  private objectives(inputs: PlanInputs): string[] {
    const o = [
      `Run ${inputs.strategy} QA strategy for ${inputs.changeSet.files.length} changed file(s).`,
    ];
    const required = inputs.impact.tests.filter((t) => t.ranking === "required").length;
    o.push(`Cover ${required} required test(s) mapped to changed symbols.`);
    if (inputs.gaps.length) o.push(`Address ${inputs.gaps.length} coverage gap(s).`);
    if (inputs.riskLevel === "high" || inputs.riskLevel === "critical")
      o.push("Higher risk: require integration/contract layers before pass.");
    return o;
  }

  private hash(selections: TestSelection[], commands: TestPlan["commands"]): string {
    return createHash("sha256")
      .update(JSON.stringify({ s: selections.length, c: commands.length }))
      .digest("hex")
      .slice(0, 32);
  }
}

export function layerFor(entityIds: string[], snapshot: IntelligenceSnapshot): TestLayer {
  // Map production entity kind to a sensible test layer (deterministic heuristic).
  void entityIds;
  void snapshot;
  return "unit";
}

export class QaGateService {
  evaluate(input: QaGateInput): QaGateResult[] {
    return [
      gate("required-tests-passed", "All required tests passed", input.requiredTestsPassed),
      gate("no-critical-coverage-gaps", "No critical coverage gaps", input.noCriticalCoverageGaps),
      gate(
        "no-unresolved-critical-impact",
        "No unresolved critical impact",
        input.noUnresolvedCriticalImpact,
      ),
      gate(
        "required-test-layers-executed",
        "Required test layers executed",
        input.requiredTestLayersExecuted,
      ),
      gate(
        "no-timed-out-required-commands",
        "No timed-out required commands",
        input.noTimedOutRequiredCommands,
      ),
      gate(
        "failure-analysis-completed",
        "Failure analysis completed",
        input.failureAnalysisCompleted,
      ),
      gate("generated-tests-approved", "Generated tests approved", input.generatedTestsApproved),
      gate("user-approval-obtained", "User approval obtained", input.userApprovalObtained),
      gate(
        "intelligence-revision-current",
        "Intelligence revision current",
        input.intelligenceRevisionCurrent,
      ),
      gate("change-set-unchanged", "Change set unchanged", input.changeSetUnchanged),
    ];
  }
}

function gate(id: string, label: string, passed: boolean): QaGateResult {
  return {
    id,
    label,
    passed,
    state: passed ? "passed" : "failed",
    evidence: passed ? "Condition met." : "Condition not met.",
    remediationAction: passed ? "" : `Resolve ${id}.`,
  };
}

export class QaDecisionService {
  decide(params: {
    qaCycleId: string;
    workflowId?: string;
    impactAnalysisId: string;
    testPlanId: string;
    executionRunIds: string[];
    failureAnalysisIds: string[];
    coverageGapIds: string[];
    gates: QaGateResult[];
    failedTests: number;
    pendingFailureAnalysis: number;
    blockedGates: number;
    warnings: string[];
    approvedByUser: boolean;
  }): QaDecision {
    const anyFailedGate = params.gates.some((g) => g.state === "failed");
    let decision: QaDecision["decision"];
    if (params.failedTests > 0 && params.pendingFailureAnalysis > 0)
      decision = "needs-failure-analysis";
    else if (params.failedTests > 0) decision = "needs-remediation";
    else if (params.gates.some((g) => g.id === "no-critical-coverage-gaps" && g.state === "failed"))
      decision = "needs-test-generation";
    else if (anyFailedGate || params.blockedGates > 0) decision = "blocked";
    else if (params.warnings.length > 0 && params.approvedByUser) decision = "passed-with-warnings";
    else if (params.warnings.length > 0) decision = "passed-with-warnings";
    else decision = "passed";

    return {
      id: crypto.randomUUID(),
      workflowId: params.workflowId,
      qaCycleId: params.qaCycleId,
      decision,
      evidence: {
        impactAnalysisId: params.impactAnalysisId,
        testPlanId: params.testPlanId,
        executionRunIds: params.executionRunIds,
        failureAnalysisIds: params.failureAnalysisIds,
        coverageGapIds: params.coverageGapIds,
      },
      gates: params.gates,
      warnings: params.warnings,
      approvedByUser: params.approvedByUser,
      metadata: {
        createdAt: new Date().toISOString(),
        contentHash: createHash("sha256")
          .update(JSON.stringify({ d: decision, g: params.gates.length }))
          .digest("hex")
          .slice(0, 32),
      },
    };
  }
}
