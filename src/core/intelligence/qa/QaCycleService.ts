/**
 * QaCycleService (spec §3, §4, §9, §13, §16, §18, §19, §20, §22, §27, §31, §33, §34, §35).
 *
 * Orchestrates the canonical QA lifecycle against the existing IntelligenceSnapshot:
 *   change discovery -> impact analysis -> test discovery/mapping/ranking -> coverage gaps
 *   -> risk assessment -> test plan -> (execution via injected adapter) -> result parsing
 *   -> failure grouping -> QA gates -> evidence-backed decision.
 *
 * Deterministic and LLM-free. Persistence is backend-agnostic (QaStore). Staleness is
 * detected explicitly (§35) without invalidating unrelated work.
 */
import type { IntelligenceSnapshot } from "../../../shared/contracts/intelligence";
import type {
  ChangeSet,
  ImpactAnalysis,
  QaCycle,
  QaCycleStatus,
  TestPlan,
  TestExecutionRun,
  ParsedTestResult,
  FailureGroup,
  FailureAnalysisRequest,
  QaDecision,
  QaGateResult,
  CoverageGap,
} from "../../../shared/contracts/qaLifecycle";
import { ChangeSetService, type RawChangeInput } from "./ChangeSetService";
import { ImpactAnalysisService } from "./ImpactAnalysisService";
import { TestDiscoveryService, TestMappingService } from "./TestMappingService";
import { CoverageGapService, QaRiskAssessmentService } from "./CoverageGapService";
import {
  TestPlanService,
  QaGateService,
  QaDecisionService,
  type QaStrategy,
} from "./TestPlanService";
import type { TestResultParserRegistry } from "./TestExecutionService";
import { TestExecutionService, type TestExecutionAdapter } from "./TestExecutionService";
import { FailureGroupingService, FailureAnalysisRequestService } from "./FailureAnalysisService";
import type { QaStore } from "./QaStore";

export interface ConductImpactInput {
  changeSetInput: RawChangeInput;
  intelligenceRevision: string;
  planned?: boolean;
}

export interface ExecutePlanInput {
  strategy?: QaStrategy;
  requireUserApproval?: boolean;
  approved?: boolean;
  maximumDurationSeconds?: number;
  adapter: TestExecutionAdapter;
  parserRegistry: TestResultParserRegistry;
  env?: Record<string, string>;
  hasRuntimeCoverage?: boolean;
  timeoutMs?: number;
}

export class QaCycleService {
  private readonly changeSetService: ChangeSetService;
  private readonly impactService: ImpactAnalysisService;
  private readonly discovery: TestDiscoveryService;
  private readonly mapping: TestMappingService;
  private readonly gapService: CoverageGapService;
  private readonly risk: QaRiskAssessmentService;
  private readonly planService: TestPlanService;
  private readonly gateService: QaGateService;
  private readonly decisionService: QaDecisionService;
  private readonly execution: TestExecutionService;
  private readonly failureGrouping: FailureGroupingService;
  private readonly failureRequest: FailureAnalysisRequestService;

  constructor(
    private readonly snapshot: IntelligenceSnapshot,
    private readonly store: QaStore,
  ) {
    this.changeSetService = new ChangeSetService(snapshot);
    this.impactService = new ImpactAnalysisService(snapshot);
    this.discovery = new TestDiscoveryService(snapshot);
    this.mapping = new TestMappingService(snapshot);
    this.gapService = new CoverageGapService();
    this.risk = new QaRiskAssessmentService();
    this.planService = new TestPlanService(snapshot);
    this.gateService = new QaGateService();
    this.decisionService = new QaDecisionService();
    this.execution = new TestExecutionService();
    this.failureGrouping = new FailureGroupingService();
    this.failureRequest = new FailureAnalysisRequestService();
  }

  /** Stage 1+2: discover changes and analyze impact. Returns the cycle + analysis. */
  conductImpact(input: ConductImpactInput): {
    cycle: QaCycle;
    changeSet: ChangeSet;
    impact: ImpactAnalysis;
  } {
    const changeSet = this.changeSetService.build(input.changeSetInput);
    this.store.saveChangeSet(changeSet);
    const impact = this.impactService.analyze(changeSet, {
      intelligenceRevision: input.intelligenceRevision,
      planned: input.planned,
    });
    this.store.saveImpact(impact);

    const cycle: QaCycle = {
      id: crypto.randomUUID(),
      workflowId: input.changeSetInput.workflowId,
      source: {
        changeSetId: changeSet.id,
        specificationRevision: "spec-1",
        intelligenceRevision: input.intelligenceRevision,
        repositoryRevision: changeSet.revision.head,
      },
      impactAnalysisId: impact.id,
      executionRunIds: [],
      failureAnalysisIds: [],
      status: "analyzing-impact",
      metadata: {
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        version: 1,
      },
    };
    this.store.saveCycle(cycle);
    return { cycle, changeSet, impact };
  }

  /** Stage 3: build a risk-driven test plan for a conducted impact analysis. */
  buildPlan(
    cycle: QaCycle,
    impact: ImpactAnalysis,
    changeSet: ChangeSet,
    opts: {
      strategy?: QaStrategy;
      requireUserApproval?: boolean;
      hasRuntimeCoverage?: boolean;
      maximumDurationSeconds?: number;
    } = {},
  ): TestPlan {
    const discovered = this.discovery.discover();
    const mappings = this.mapping.map(discovered);
    const gaps = this.gapService.detect(impact, changeSet, opts.hasRuntimeCoverage ?? false);
    this.store.saveGaps(gaps);
    const risk = this.risk.assess(impact, gaps, changeSet);

    const plan = this.planService.build({
      impact,
      changeSet,
      discovered,
      mappings,
      gaps,
      riskLevel: risk.overallLevel,
      strategy: opts.strategy ?? "layered",
      requireUserApproval: opts.requireUserApproval ?? false,
      maximumDurationSeconds: opts.maximumDurationSeconds,
    });
    cycle.testPlanId = plan.id;
    cycle.status = opts.requireUserApproval ? "awaiting-approval" : "planning-tests";
    cycle.metadata.updatedAt = new Date().toISOString();
    this.store.saveCycle(cycle);
    this.store.saveTestPlan(plan);
    return plan;
  }

  /** Stage 4: execute the plan via the injected adapter, parse results, group failures. */
  async executePlan(
    cycle: QaCycle,
    plan: TestPlan,
    input: ExecutePlanInput,
    signal?: AbortSignal,
  ): Promise<{ run: TestExecutionRun; results: ParsedTestResult[] }> {
    cycle.executionRunIds.push(plan.id);
    cycle.status = "executing";
    cycle.metadata.updatedAt = new Date().toISOString();
    this.store.saveCycle(cycle);

    const commands = plan.commands.map((c) => ({
      command: {
        id: c.commandId,
        displayName: c.displayName,
        commandTemplate: c.template,
        workingDirectory: c.workingDirectory,
        layer: c.layer,
        source: "user-config" as const,
        confidence: 1,
        supportsFileTargeting: false,
        supportsTestNameTargeting: false,
        supportsCoverage: false,
        estimatedScope: "project" as const,
        requiredEnvironment: [],
        available: true,
      },
      selectedTestIds: plan.selections.map((s) => s.testId),
    }));

    const { run, results } = await this.execution.executePlan(
      {
        testPlanId: plan.id,
        workflowId: cycle.workflowId,
        commands,
        timeoutMs: input.timeoutMs ?? (input.maximumDurationSeconds ?? 600) * 1000,
        requireApproval: input.requireUserApproval ?? false,
        approved: input.approved ?? true,
        env: input.env,
        adapter: input.adapter,
        parserRegistry: input.parserRegistry,
      },
      signal,
    );
    this.store.saveExecution(run);
    cycle.executionRunIds.push(run.id);
    cycle.metadata.updatedAt = new Date().toISOString();
    this.store.saveCycle(cycle);
    return { run, results };
  }

  /** Stage 4b: failure grouping + Phase-7 handoff request. */
  handleFailures(
    cycle: QaCycle,
    run: TestExecutionRun,
    results: ParsedTestResult[],
  ): { groups: FailureGroup[]; request?: FailureAnalysisRequest } {
    const groups = this.failureGrouping.group(results);
    this.store.saveFailureGroups(groups);
    let request: FailureAnalysisRequest | undefined;
    if (groups.length > 0) {
      request = this.failureRequest.create({
        qaCycleId: cycle.id,
        executionRunId: run.id,
        groups,
        failedCommands: run.commands.filter((c) => c.status === "failed").map((c) => c.id),
        changedEntityIds: [],
        impactedFlowIds: [],
        relatedTestIds: results.map((r) => r.testCase ?? r.testFile ?? ""),
        acceptanceCriteria: [],
        relevantFixtureIds: [],
        requestedCategories: [
          "product-defect",
          "incorrect-expectation",
          "stale-test",
          "flaky-behaviour",
          "test-data-problem",
          "environment-issue",
          "infrastructure-issue",
          "unsupported-or-unknown",
        ],
      });
      this.store.saveFailureAnalysis(request);
      cycle.failureAnalysisIds.push(request.id);
    }
    cycle.status = groups.length > 0 ? "analyzing-failures" : "reviewing";
    cycle.metadata.updatedAt = new Date().toISOString();
    this.store.saveCycle(cycle);
    return { groups, request };
  }

  /** Stage 5: evaluate gates and produce an evidence-backed decision (never exit-code only). */
  decide(
    cycle: QaCycle,
    impact: ImpactAnalysis,
    plan: TestPlan,
    run: TestExecutionRun,
    gaps: CoverageGap[],
    groups: FailureGroup[],
    approvedByUser: boolean,
    intelligenceRevisionCurrent: boolean,
    changeSetUnchanged: boolean,
  ): QaDecision {
    const failedTests = run.summary.failedTests ?? 0;
    const passedRequired =
      run.summary.passedCommands >= plan.selections.filter((s) => s.ranking === "required").length;
    const gatesInput = {
      requiredTestsPassed: passedRequired && failedTests === 0,
      noCriticalCoverageGaps: !gaps.some(
        (g) => g.risk === "critical" && g.verificationStatus !== "verified",
      ),
      noUnresolvedCriticalImpact: !impact.entities.some(
        (e) => e.category === "unresolved-possible-impact" && e.confidence < 0.4,
      ),
      requiredTestLayersExecuted: run.commands.length > 0,
      noTimedOutRequiredCommands: !run.commands.some(
        (c) =>
          c.status === "timed-out" &&
          plan.selections.some((s) => s.commandId === c.commandId && s.ranking === "required"),
      ),
      failureAnalysisCompleted: groups.length === 0,
      generatedTestsApproved: true,
      userApprovalObtained: approvedByUser,
      intelligenceRevisionCurrent,
      changeSetUnchanged,
    };
    const gateResults: QaGateResult[] = this.gateService.evaluate(gatesInput);
    const decision = this.decisionService.decide({
      qaCycleId: cycle.id,
      workflowId: cycle.workflowId,
      impactAnalysisId: impact.id,
      testPlanId: plan.id,
      executionRunIds: cycle.executionRunIds,
      failureAnalysisIds: cycle.failureAnalysisIds,
      coverageGapIds: gaps.map((g) => g.id),
      gates: gateResults,
      failedTests,
      pendingFailureAnalysis: groups.length,
      blockedGates: gateResults.filter((g) => !g.passed).length,
      warnings: gaps.filter((g) => g.risk !== "low").map((g) => `Coverage gap: ${g.gapType}`),
      approvedByUser,
    });
    cycle.qaDecisionId = decision.id;
    cycle.status = mapDecisionToStatus(decision.decision);
    cycle.metadata.completedAt = new Date().toISOString();
    cycle.metadata.updatedAt = new Date().toISOString();
    this.store.saveCycle(cycle);
    this.store.saveDecision(decision);
    return decision;
  }

  /** Stage-aware staleness detection (§35). */
  detectStale(
    cycle: QaCycle,
    currentIntelligenceRevision: string,
    changeSetHash: string,
    storedChangeSetHash: string,
  ): string[] {
    const reasons: string[] = [];
    if (cycle.source.intelligenceRevision !== currentIntelligenceRevision)
      reasons.push("Repository intelligence changed in affected scope.");
    if (changeSetHash !== storedChangeSetHash) reasons.push("Change set changed.");
    if (cycle.testPlanId && cycle.status === "executing")
      reasons.push("Execution in progress; results may be superseded.");
    if (reasons.length > 0 && cycle.status !== "stale") {
      cycle.status = "stale";
      cycle.metadata.updatedAt = new Date().toISOString();
      this.store.saveCycle(cycle);
    }
    return reasons;
  }
}

function mapDecisionToStatus(d: QaDecision["decision"]): QaCycleStatus {
  switch (d) {
    case "passed":
      return "passed";
    case "passed-with-warnings":
      return "passed";
    case "failed":
      return "failed";
    case "blocked":
      return "blocked";
    case "needs-test-generation":
      return "awaiting-remediation";
    case "needs-failure-analysis":
      return "analyzing-failures";
    case "needs-remediation":
      return "awaiting-remediation";
    case "cancelled":
      return "cancelled";
  }
}
