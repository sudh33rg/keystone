/**
 * QaStore (spec §48, §4, §17, §20, §28, §32, §33, §46, §48).
 *
 * Backend-agnostic persistence contract for all QA lifecycle records (Phase 6 + Phase 7). The
 * extension supplies a Memento-backed implementation (mirroring Phase 4 VisualizationPersistenceStore);
 * unit and integration tests use the in-memory implementation below. All records are recoverable after
 * restart (per §48).
 */
import type {
  QaCycle,
  ChangeSet,
  ImpactAnalysis,
  TestPlan,
  TestExecutionRun,
  FailureGroup,
  FailureAnalysisRequest,
  QaDecision,
  CoverageGap,
} from "../../../shared/contracts/qaLifecycle";
import type {
  TestGenerationRequest,
  TestScenarioDerivationResult,
  TestGenerationPlan,
  GeneratedTestProposal,
  FailureEvidence,
  FailureAnalysis,
  FlakyTestAssessment,
  DiagnosticRerunRecord,
  RemediationProposal,
  RemediationAttempt,
  RegressionConfirmation,
} from "../../../shared/contracts/qaRemediation";
import type {
  SecurityAnalysis,
  SecurityFinding,
  PerformanceAnalysis,
  PerformanceFinding,
  PerformanceBaseline,
  PerformanceRuntimeEvidence,
  GateEvaluation,
  RiskAcceptance,
  FindingRemediationLink,
  AnalysisFreshness,
} from "../../../shared/contracts/qaSecurity";

export interface QaStore {
  saveCycle(c: QaCycle): void;
  getCycle(id: string): QaCycle | undefined;
  listCycles(workflowId?: string): QaCycle[];

  saveChangeSet(c: ChangeSet): void;
  getChangeSet(id: string): ChangeSet | undefined;

  saveImpact(a: ImpactAnalysis): void;
  getImpact(id: string): ImpactAnalysis | undefined;

  saveTestPlan(p: TestPlan): void;
  getTestPlan(id: string): TestPlan | undefined;

  saveExecution(r: TestExecutionRun): void;
  getExecution(id: string): TestExecutionRun | undefined;

  saveFailureGroups(g: FailureGroup[]): void;
  getFailureGroups(runId: string): FailureGroup[];

  saveFailureAnalysis(a: FailureAnalysisRequest): void;
  getFailureAnalysis(id: string): FailureAnalysisRequest | undefined;

  saveDecision(d: QaDecision): void;
  getDecision(id: string): QaDecision | undefined;

  saveGaps(gaps: CoverageGap[]): void;
  getGaps(impactAnalysisId: string): CoverageGap[];

  // --- Phase 7 records ---
  saveGenerationRequest(r: TestGenerationRequest): void;
  getGenerationRequest(id: string): TestGenerationRequest | undefined;
  listGenerationRequests(qaCycleId?: string): TestGenerationRequest[];

  saveScenarioDerivation(r: TestScenarioDerivationResult): void;
  getScenarioDerivation(requestId: string): TestScenarioDerivationResult | undefined;

  saveGenerationPlan(p: TestGenerationPlan): void;
  getGenerationPlan(id: string): TestGenerationPlan | undefined;

  saveGeneratedProposal(p: GeneratedTestProposal): void;
  getGeneratedProposal(id: string): GeneratedTestProposal | undefined;

  saveFailureEvidence(e: FailureEvidence): void;
  getFailureEvidence(testResultId: string): FailureEvidence | undefined;

  saveFailureAnalysisRecord(a: FailureAnalysis): void;
  getFailureAnalysisRecord(id: string): FailureAnalysis | undefined;

  saveFlakyAssessment(a: FlakyTestAssessment): void;
  getFlakyAssessment(testId: string): FlakyTestAssessment | undefined;

  saveDiagnosticRerun(r: DiagnosticRerunRecord): void;
  listDiagnosticReruns(testId: string): DiagnosticRerunRecord[];

  saveRemediationProposal(p: RemediationProposal): void;
  getRemediationProposal(id: string): RemediationProposal | undefined;

  saveRemediationAttempt(a: RemediationAttempt): void;
  getRemediationAttempt(id: string): RemediationAttempt | undefined;

  saveRegressionConfirmation(c: RegressionConfirmation): void;
  getRegressionConfirmation(id: string): RegressionConfirmation | undefined;

  // --- Phase 8 records (security + performance intelligence) ---
  saveSecurityAnalysis(a: SecurityAnalysis): void;
  getSecurityAnalysis(id: string): SecurityAnalysis | undefined;
  listSecurityAnalyses(changeSetId?: string): SecurityAnalysis[];

  saveSecurityFinding(f: SecurityFinding): void;
  getSecurityFinding(id: string): SecurityFinding | undefined;
  listSecurityFindings(analysisId?: string): SecurityFinding[];

  savePerformanceAnalysis(a: PerformanceAnalysis): void;
  getPerformanceAnalysis(id: string): PerformanceAnalysis | undefined;
  listPerformanceAnalyses(changeSetId?: string): PerformanceAnalysis[];

  savePerformanceFinding(f: PerformanceFinding): void;
  getPerformanceFinding(id: string): PerformanceFinding | undefined;
  listPerformanceFindings(analysisId?: string): PerformanceFinding[];

  savePerformanceBaseline(b: PerformanceBaseline): void;
  getPerformanceBaseline(id: string): PerformanceBaseline | undefined;
  listPerformanceBaselines(scenario?: string): PerformanceBaseline[];

  savePerformanceRuntimeEvidence(e: PerformanceRuntimeEvidence): void;
  getPerformanceRuntimeEvidence(id: string): PerformanceRuntimeEvidence | undefined;

  saveGateEvaluation(g: GateEvaluation): void;
  getGateEvaluation(id: string): GateEvaluation | undefined;
  listGateEvaluations(analysisId?: string): GateEvaluation[];

  saveRiskAcceptance(r: RiskAcceptance): void;
  getRiskAcceptance(findingId: string): RiskAcceptance | undefined;

  saveFindingRemediationLink(l: FindingRemediationLink): void;
  getFindingRemediationLink(findingId: string): FindingRemediationLink | undefined;

  saveAnalysisFreshness(f: AnalysisFreshness): void;
  getAnalysisFreshness(analysisId: string): AnalysisFreshness | undefined;
}

export class InMemoryQaStore implements QaStore {
  private cycles = new Map<string, QaCycle>();
  private changeSets = new Map<string, ChangeSet>();
  private impacts = new Map<string, ImpactAnalysis>();
  private plans = new Map<string, TestPlan>();
  private executions = new Map<string, TestExecutionRun>();
  private failureGroups = new Map<string, FailureGroup[]>();
  private failureAnalyses = new Map<string, FailureAnalysisRequest>();
  private decisions = new Map<string, QaDecision>();
  private gaps = new Map<string, CoverageGap[]>();

  private generationRequests = new Map<string, TestGenerationRequest>();
  private scenarioDerivations = new Map<string, TestScenarioDerivationResult>();
  private generationPlans = new Map<string, TestGenerationPlan>();
  private generatedProposals = new Map<string, GeneratedTestProposal>();
  private failureEvidences = new Map<string, FailureEvidence>();
  private failureAnalysisRecords = new Map<string, FailureAnalysis>();
  private flakyAssessments = new Map<string, FlakyTestAssessment>();
  private diagnosticReruns = new Map<string, DiagnosticRerunRecord[]>();
  private remediationProposals = new Map<string, RemediationProposal>();
  private remediationAttempts = new Map<string, RemediationAttempt>();
  private regressionConfirmations = new Map<string, RegressionConfirmation>();

  // --- Phase 8 maps ---
  private securityAnalyses = new Map<string, SecurityAnalysis>();
  private securityFindings = new Map<string, SecurityFinding>();
  private performanceAnalyses = new Map<string, PerformanceAnalysis>();
  private performanceFindings = new Map<string, PerformanceFinding>();
  private performanceBaselines = new Map<string, PerformanceBaseline>();
  private performanceRuntimeEvidence = new Map<string, PerformanceRuntimeEvidence>();
  private gateEvaluations = new Map<string, GateEvaluation>();
  private riskAcceptances = new Map<string, RiskAcceptance>();
  private findingRemediationLinks = new Map<string, FindingRemediationLink>();
  private analysisFreshness = new Map<string, AnalysisFreshness>();

  saveCycle(c: QaCycle): void {
    this.cycles.set(c.id, c);
  }
  getCycle(id: string): QaCycle | undefined {
    return this.cycles.get(id);
  }
  listCycles(workflowId?: string): QaCycle[] {
    return [...this.cycles.values()].filter((c) => !workflowId || c.workflowId === workflowId);
  }
  saveChangeSet(c: ChangeSet): void {
    this.changeSets.set(c.id, c);
  }
  getChangeSet(id: string): ChangeSet | undefined {
    return this.changeSets.get(id);
  }
  saveImpact(a: ImpactAnalysis): void {
    this.impacts.set(a.id, a);
  }
  getImpact(id: string): ImpactAnalysis | undefined {
    return this.impacts.get(id);
  }
  saveTestPlan(p: TestPlan): void {
    this.plans.set(p.id, p);
  }
  getTestPlan(id: string): TestPlan | undefined {
    return this.plans.get(id);
  }
  saveExecution(r: TestExecutionRun): void {
    this.executions.set(r.id, r);
  }
  getExecution(id: string): TestExecutionRun | undefined {
    return this.executions.get(id);
  }
  saveFailureGroups(g: FailureGroup[]): void {
    for (const grp of g) this.failureGroups.set(grp.id, [grp]);
  }
  getFailureGroups(runId: string): FailureGroup[] {
    return this.failureGroups.get(runId) ?? [];
  }
  saveFailureAnalysis(a: FailureAnalysisRequest): void {
    this.failureAnalyses.set(a.id, a);
  }
  getFailureAnalysis(id: string): FailureAnalysisRequest | undefined {
    return this.failureAnalyses.get(id);
  }
  saveDecision(d: QaDecision): void {
    this.decisions.set(d.id, d);
  }
  getDecision(id: string): QaDecision | undefined {
    return this.decisions.get(id);
  }
  saveGaps(gaps: CoverageGap[]): void {
    for (const g of gaps) {
      const arr = this.gaps.get(g.affectedEntityId ?? g.affectedFlowId ?? g.id) ?? [];
      arr.push(g);
      this.gaps.set(g.affectedEntityId ?? g.affectedFlowId ?? g.id, arr);
    }
  }
  getGaps(impactAnalysisId: string): CoverageGap[] {
    return this.gaps.get(impactAnalysisId) ?? [];
  }

  saveGenerationRequest(r: TestGenerationRequest): void {
    this.generationRequests.set(r.id, r);
  }
  getGenerationRequest(id: string): TestGenerationRequest | undefined {
    return this.generationRequests.get(id);
  }
  listGenerationRequests(qaCycleId?: string): TestGenerationRequest[] {
    return [...this.generationRequests.values()].filter(
      (r) => !qaCycleId || r.qaCycleId === qaCycleId,
    );
  }
  saveScenarioDerivation(r: TestScenarioDerivationResult): void {
    this.scenarioDerivations.set(r.requestId, r);
  }
  getScenarioDerivation(requestId: string): TestScenarioDerivationResult | undefined {
    return this.scenarioDerivations.get(requestId);
  }
  saveGenerationPlan(p: TestGenerationPlan): void {
    this.generationPlans.set(p.id, p);
  }
  getGenerationPlan(id: string): TestGenerationPlan | undefined {
    return this.generationPlans.get(id);
  }
  saveGeneratedProposal(p: GeneratedTestProposal): void {
    this.generatedProposals.set(p.id, p);
  }
  getGeneratedProposal(id: string): GeneratedTestProposal | undefined {
    return this.generatedProposals.get(id);
  }
  saveFailureEvidence(e: FailureEvidence): void {
    this.failureEvidences.set(e.testResultId, e);
  }
  getFailureEvidence(testResultId: string): FailureEvidence | undefined {
    return this.failureEvidences.get(testResultId);
  }
  saveFailureAnalysisRecord(a: FailureAnalysis): void {
    this.failureAnalysisRecords.set(a.id, a);
  }
  getFailureAnalysisRecord(id: string): FailureAnalysis | undefined {
    return this.failureAnalysisRecords.get(id);
  }
  saveFlakyAssessment(a: FlakyTestAssessment): void {
    this.flakyAssessments.set(a.testId, a);
  }
  getFlakyAssessment(testId: string): FlakyTestAssessment | undefined {
    return this.flakyAssessments.get(testId);
  }
  saveDiagnosticRerun(r: DiagnosticRerunRecord): void {
    const arr = this.diagnosticReruns.get(r.testId) ?? [];
    arr.push(r);
    this.diagnosticReruns.set(r.testId, arr);
  }
  listDiagnosticReruns(testId: string): DiagnosticRerunRecord[] {
    return this.diagnosticReruns.get(testId) ?? [];
  }
  saveRemediationProposal(p: RemediationProposal): void {
    this.remediationProposals.set(p.id, p);
  }
  getRemediationProposal(id: string): RemediationProposal | undefined {
    return this.remediationProposals.get(id);
  }
  saveRemediationAttempt(a: RemediationAttempt): void {
    this.remediationAttempts.set(a.id, a);
  }
  getRemediationAttempt(id: string): RemediationAttempt | undefined {
    return this.remediationAttempts.get(id);
  }
  saveRegressionConfirmation(c: RegressionConfirmation): void {
    this.regressionConfirmations.set(c.id, c);
  }
  getRegressionConfirmation(id: string): RegressionConfirmation | undefined {
    return this.regressionConfirmations.get(id);
  }

  // --- Phase 8 implementations ---
  saveSecurityAnalysis(a: SecurityAnalysis): void {
    this.securityAnalyses.set(a.id, a);
  }
  getSecurityAnalysis(id: string): SecurityAnalysis | undefined {
    return this.securityAnalyses.get(id);
  }
  listSecurityAnalyses(changeSetId?: string): SecurityAnalysis[] {
    return [...this.securityAnalyses.values()].filter(
      (a) => !changeSetId || a.changeSetId === changeSetId,
    );
  }
  saveSecurityFinding(f: SecurityFinding): void {
    this.securityFindings.set(f.id, f);
  }
  getSecurityFinding(id: string): SecurityFinding | undefined {
    return this.securityFindings.get(id);
  }
  listSecurityFindings(analysisId?: string): SecurityFinding[] {
    return [...this.securityFindings.values()].filter(
      (f) => !analysisId || f.analysisId === analysisId,
    );
  }
  savePerformanceAnalysis(a: PerformanceAnalysis): void {
    this.performanceAnalyses.set(a.id, a);
  }
  getPerformanceAnalysis(id: string): PerformanceAnalysis | undefined {
    return this.performanceAnalyses.get(id);
  }
  listPerformanceAnalyses(changeSetId?: string): PerformanceAnalysis[] {
    return [...this.performanceAnalyses.values()].filter(
      (a) => !changeSetId || a.changeSetId === changeSetId,
    );
  }
  savePerformanceFinding(f: PerformanceFinding): void {
    this.performanceFindings.set(f.id, f);
  }
  getPerformanceFinding(id: string): PerformanceFinding | undefined {
    return this.performanceFindings.get(id);
  }
  listPerformanceFindings(analysisId?: string): PerformanceFinding[] {
    return [...this.performanceFindings.values()].filter(
      (f) => !analysisId || f.analysisId === analysisId,
    );
  }
  savePerformanceBaseline(b: PerformanceBaseline): void {
    this.performanceBaselines.set(b.id, b);
  }
  getPerformanceBaseline(id: string): PerformanceBaseline | undefined {
    return this.performanceBaselines.get(id);
  }
  listPerformanceBaselines(scenario?: string): PerformanceBaseline[] {
    return [...this.performanceBaselines.values()].filter(
      (b) => !scenario || b.benchmarkOrScenario === scenario,
    );
  }
  savePerformanceRuntimeEvidence(e: PerformanceRuntimeEvidence): void {
    this.performanceRuntimeEvidence.set(e.id, e);
  }
  getPerformanceRuntimeEvidence(id: string): PerformanceRuntimeEvidence | undefined {
    return this.performanceRuntimeEvidence.get(id);
  }
  saveGateEvaluation(g: GateEvaluation): void {
    this.gateEvaluations.set(g.id, g);
  }
  getGateEvaluation(id: string): GateEvaluation | undefined {
    return this.gateEvaluations.get(id);
  }
  listGateEvaluations(analysisId?: string): GateEvaluation[] {
    return [...this.gateEvaluations.values()].filter(
      (g) => !analysisId || g.analysisId === analysisId,
    );
  }
  saveRiskAcceptance(r: RiskAcceptance): void {
    this.riskAcceptances.set(r.findingId, r);
  }
  getRiskAcceptance(findingId: string): RiskAcceptance | undefined {
    return this.riskAcceptances.get(findingId);
  }
  saveFindingRemediationLink(l: FindingRemediationLink): void {
    this.findingRemediationLinks.set(l.findingId, l);
  }
  getFindingRemediationLink(findingId: string): FindingRemediationLink | undefined {
    return this.findingRemediationLinks.get(findingId);
  }
  saveAnalysisFreshness(f: AnalysisFreshness): void {
    this.analysisFreshness.set(f.analysisId, f);
  }
  getAnalysisFreshness(analysisId: string): AnalysisFreshness | undefined {
    return this.analysisFreshness.get(analysisId);
  }
}
