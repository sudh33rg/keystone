import { randomUUID, createHash } from "node:crypto";
import {
  type AppliedTestChange,
  type FlakyClassification,
  type FlakyTestRun,
  type PolicyAssessment,
  type ProposedFileChange,
  type QaTestIntelligenceAggregate,
  type TestChangeProposal,
  type TestFailureAnalysis,
  type TestFailureRecord,
  type TestGenerationRequest,
  type TestRemediationProposal,
  type TestScenario,
  type TestChangeValidation,
  type ValidationLevel,
  type ValidationLevelResult,
  type ValidationLevelStatus,
  type ValidationSource,
  TestIntelligenceError,
} from "../../shared/contracts/qaTestIntelligence";
import type { ImpactQaAggregate } from "../../shared/contracts/impactQa";
import type { ImpactQaService } from "./ImpactQaService";
import type { DevelopmentService } from "../development/DevelopmentService";
import { QaTestIntelligencePersistence } from "./QaTestIntelligencePersistence";
import { TestScenarioService, type ScenarioEvidenceInput } from "./TestScenarioService";
import { TestFailureClassifier, type FailureClassificationEvidence } from "./TestFailureClassifier";
import { FlakyClassificationService } from "./FlakyClassificationService";
import { TestChangePolicyService } from "./TestChangePolicyService";
import { TestGenerationContextService, type GenerationContextInput } from "./TestGenerationContextService";
import { TestHealingContextService } from "./TestHealingContextService";
import { SafeWorkspaceEditService } from "./SafeWorkspaceEditService";
import { TEST_GENERATION_SKILL_FRAGMENT } from "./TestGenerationSkill";
import { ControlledCommandRunner } from "./ControlledCommandRunner";
import type { QaCommandResult, TestCommandDefinition } from "../../shared/contracts/impactQa";

export interface TestIntelligenceHost {
  workspaceFiles(): Promise<Set<string>>;
  readSource(relativePath: string): Promise<string>;
}

interface TestIntelligenceState {
  workflowId: string;
  generationRequests: TestGenerationRequest[];
  scenarios: TestScenario[];
  generationProposals: TestChangeProposal[];
  failureAnalyses: TestFailureAnalysis[];
  failureRecords: TestFailureRecord[];
  flakyRuns: FlakyTestRun[];
  flakyClassifications: FlakyClassification[];
  remediationProposals: TestRemediationProposal[];
  policyAssessments: PolicyAssessment[];
  validations: TestChangeValidation[];
  appliedChanges: AppliedTestChange[];
  updatedAt: string;
}

const VALIDATION_ORDER: ValidationLevel[] = ["exact-test", "related-file", "impacted-tests", "required-regression"];

/**
 * Phase 8 orchestrator. Reuses Phase 7 records (coverage gaps, QA plan,
 * execution, decision) and the Phase 5 compression primitives. All changes are
 * gated by the deterministic policy service and applied through the safe
 * workspace-edit service.
 */
export class TestIntelligenceService {
  private readonly scenarios = new TestScenarioService();
  private readonly classifier = new TestFailureClassifier();
  private readonly flaky = new FlakyClassificationService();
  private readonly policy = new TestChangePolicyService();
  private readonly genContext = new TestGenerationContextService();
  private readonly healContext = new TestHealingContextService();
  private readonly safeEdit = new SafeWorkspaceEditService();
  private readonly runner: ControlledCommandRunner;

  constructor(
    private readonly root: string,
    private readonly persistence: QaTestIntelligencePersistence,
    private readonly impactQa: ImpactQaService,
    private readonly development: DevelopmentService,
    private readonly host: TestIntelligenceHost,
    runner?: ControlledCommandRunner,
    private readonly now: () => string = () => new Date().toISOString(),
    private readonly createId: () => string = randomUUID,
  ) {
    this.runner = runner ?? new ControlledCommandRunner(root);
  }

  async initialize(): Promise<void> { await this.persistence.initialize(); }

  async load(workflowId: string): Promise<QaTestIntelligenceAggregate> {
    return this.loadState(workflowId);
  }

  private async loadState(workflowId: string): Promise<TestIntelligenceState> {
    return this.persistence.get(workflowId) ?? this.empty(workflowId);
  }

  private empty(workflowId: string): TestIntelligenceState {
    return {
      workflowId,
      generationRequests: [],
      scenarios: [],
      generationProposals: [],
      failureAnalyses: [],
      failureRecords: [],
      flakyRuns: [],
      flakyClassifications: [],
      remediationProposals: [],
      policyAssessments: [],
      validations: [],
      appliedChanges: [],
      updatedAt: this.now(),
    };
  }

  private async save(state: QaTestIntelligenceAggregate): Promise<QaTestIntelligenceAggregate> {
    const next = { ...state, updatedAt: this.now() };
    await this.persistence.save(next);
    return next;
  }

  // --- Generation request --------------------------------------------------

  async createGenerationRequest(workflowId: string, coverageGapId: string): Promise<QaTestIntelligenceAggregate> {
    const qa = await this.impactQa.load(workflowId);
    const gap = qa.impactAnalysis?.coverageGaps.find((g) => g.id === coverageGapId);
    if (!gap) throw new TestIntelligenceError("coverage-gap-not-found", "The coverage gap was not found in the accepted impact analysis.", true, "Run impact analysis and confirm the coverage gap exists.");
    const existing = (await this.loadState(workflowId)).generationRequests.find((r) => r.coverageGapId === coverageGapId && (r.status === "applied" || r.status === "validated"));
    if (existing) throw new TestIntelligenceError("generation-request-duplicate", "This coverage gap already has a completed generation request.", true, "A resolved gap cannot create a new active generation request.");
    const existingOpen = (await this.loadState(workflowId)).generationRequests.find((r) => r.coverageGapId === coverageGapId && r.status !== "rejected" && r.status !== "stale" && r.status !== "applied" && r.status !== "validated");
    if (existingOpen) throw new TestIntelligenceError("generation-request-duplicate", "A generation request already exists for this coverage gap.", true, "Reuse the existing generation request or reject it first.");
    if (!qa.qaPlan) throw new TestIntelligenceError("coverage-gap-not-found", "A QA plan is required to link the generation request.", true, "Generate and approve the QA plan first.");
    const timestamp = this.now();
    const request: TestGenerationRequest = {
      id: this.createId(),
      workflowId,
      qaPlanId: qa.qaPlan.id,
      impactAnalysisId: qa.impactAnalysis!.id,
      coverageGapId,
      target: { entityIds: gap.entityId ? [gap.entityId] : [], flowIds: gap.flowId ? [gap.flowId] : [], filePaths: [] },
      testLayer: mapTestLayer(gap.recommendedTestLayer),
      status: "draft",
      createdAt: timestamp,
      updatedAt: timestamp,
    };
    const state = await this.loadState(workflowId);
    return this.save({ ...state, generationRequests: [...state.generationRequests, request] });
  }

  async deriveScenarios(workflowId: string, generationRequestId: string): Promise<QaTestIntelligenceAggregate> {
    const state = await this.loadState(workflowId);
    const request = state.generationRequests.find((r) => r.id === generationRequestId);
    if (!request) throw new TestIntelligenceError("coverage-gap-not-found", "Generation request not found.", true, "Create a generation request first.");
    const qa = await this.impactQa.load(workflowId);
    const gap = qa.impactAnalysis?.coverageGaps.find((g) => g.id === request.coverageGapId);
    if (!gap) throw new TestIntelligenceError("coverage-gap-not-found", "Coverage gap no longer present; the request is stale.", true, "Recreate the generation request after re-running impact analysis.");
    if (!this.impactFresh(qa)) {
      request.status = "stale";
      request.staleReason = "Impact analysis changed since this request was created.";
    }

    const input: ScenarioEvidenceInput = {
      workflowId,
      generationRequestId,
      intent: qa.impactAnalysis?.summary ?? "Generate tests for the coverage gap.",
      specification: extractSpecification(qa),
      acceptanceCriteria: [],
      affectedEntities: request.target.entityIds.map((id) => ({ id, label: id })),
      affectedFlows: request.target.flowIds.map((id) => ({ id, label: id })),
      coverageGapReason: gap.reason,
      recommendedLayer: mapTestLayer(gap.recommendedTestLayer),
      existingTestFilePaths: qa.impactAnalysis?.mappedTests.map((m) => m.testFilePath) ?? [],
      testFramework: qa.capabilities.find((c) => c.availability !== "unsupported")?.framework ?? "unknown",
      publicContractChanges: [],
    };
    let derived: TestScenario[];
    try {
      derived = this.scenarios.derive(input);
    } catch (cause) {
      if (cause instanceof Error && cause.name === "ScenarioEvidenceError") {
        throw new TestIntelligenceError("scenario-evidence-insufficient", cause.message, true, "Provide acceptance criteria, changed behaviour, or existing tests before deriving scenarios.");
      }
      throw cause;
    }
    const nextRequest: TestGenerationRequest = { ...request, status: request.status === "stale" ? "stale" : "scenarios-ready", updatedAt: this.now() };
    return this.save({
      ...state,
      generationRequests: state.generationRequests.map((r) => (r.id === generationRequestId ? nextRequest : r)),
      scenarios: [...state.scenarios.filter((s) => s.generationRequestId !== generationRequestId), ...derived],
    });
  }

  async updateScenario(workflowId: string, scenarioId: string, patch: { title?: string; behaviour?: string; selected?: boolean; removalReason?: string }): Promise<QaTestIntelligenceAggregate> {
    const state = await this.loadState(workflowId);
    const scenario = state.scenarios.find((s) => s.id === scenarioId);
    if (!scenario) throw new TestIntelligenceError("scenario-evidence-insufficient", "Scenario not found.", true, "Derive scenarios before updating them.");
    const next: TestScenario = {
      ...scenario,
      title: patch.title ?? scenario.title,
      behaviour: patch.behaviour ?? scenario.behaviour,
      selected: patch.selected ?? scenario.selected,
      removalReason: patch.removalReason ?? scenario.removalReason,
    };
    if (patch.selected === false && scenario.importance === "required" && !patch.removalReason) {
      throw new TestIntelligenceError("scenario-evidence-insufficient", "Removing a required scenario requires an explicit reason.", true, "Provide a removal reason for required scenarios.");
    }
    return this.save({ ...state, scenarios: state.scenarios.map((s) => (s.id === scenarioId ? next : s)) });
  }

  async approveScenarios(workflowId: string, generationRequestId: string): Promise<QaTestIntelligenceAggregate> {
    const state = await this.loadState(workflowId);
    const request = state.generationRequests.find((r) => r.id === generationRequestId);
    if (!request) throw new TestIntelligenceError("coverage-gap-not-found", "Generation request not found.", true, "Create a generation request first.");
    const mine = state.scenarios.filter((s) => s.generationRequestId === generationRequestId);
    const requiredUnselected = mine.filter((s) => s.importance === "required" && !s.selected);
    if (requiredUnselected.length) throw new TestIntelligenceError("scenario-evidence-insufficient", "Required scenarios must be selected or removed with a reason before approval.", true, "Select all required scenarios or provide removal reasons.");
    const nextRequest: TestGenerationRequest = { ...request, status: "awaiting-approval", updatedAt: this.now() };
    return this.save({ ...state, generationRequests: state.generationRequests.map((r) => (r.id === generationRequestId ? nextRequest : r)) });
  }

  // --- Generation context --------------------------------------------------

  async buildGenerationContext(workflowId: string, generationRequestId: string, budgetTokens: number): Promise<{ state: QaTestIntelligenceAggregate; contextPackageId: string; revision: number; fingerprint: string }> {
    const state = await this.loadState(workflowId);
    const request = state.generationRequests.find((r) => r.id === generationRequestId);
    if (!request) throw new TestIntelligenceError("coverage-gap-not-found", "Generation request not found.", true, "Create a generation request first.");
    const qa = await this.impactQa.load(workflowId);
    const gap = qa.impactAnalysis?.coverageGaps.find((g) => g.id === request.coverageGapId);
    if (!gap) throw new TestIntelligenceError("coverage-gap-not-found", "Coverage gap missing.", true, "Re-run impact analysis.");
    const scenarios = state.scenarios.filter((s) => s.generationRequestId === generationRequestId && s.selected);
    if (!scenarios.length) throw new TestIntelligenceError("generation-context-incomplete", "No approved scenarios to build a context from.", true, "Approve scenarios first.");
    const input: GenerationContextInput = {
      workflowId,
      stageId: "qa",
      workItemId: request.id,
      executionProfileId: "test-generation-profile",
      generationRequestId,
      coverageGapReason: gap.reason,
      scenarios,
      targetProduction: await readFiles(this.host, request.target.filePaths),
      affectedFlows: request.target.flowIds,
      acceptanceCriteria: [],
      existingTests: await readFiles(this.host, qa.impactAnalysis?.mappedTests.map((m) => m.testFilePath) ?? []),
      frameworkConfig: JSON.stringify(qa.capabilities.map((c) => ({ framework: c.framework, commands: c.commands.map((cmd) => cmd.executable + " " + cmd.arguments.join(" ")) }))),
      fixtureConventions: "Reuse repository test conventions.",
      skillFragment: TEST_GENERATION_SKILL_FRAGMENT,
      instructions: [],
      allowedOutputPaths: allowedTestPaths(request),
      excludedSources: [],
      budgetTokens,
    };
    const pkg = this.genContext.build(input);
    const nextRequest: TestGenerationRequest = { ...request, status: "prompt-prepared", updatedAt: this.now() };
    const next = await this.save({ ...state, generationRequests: state.generationRequests.map((r) => (r.id === generationRequestId ? nextRequest : r)) });
    return { state: next, contextPackageId: pkg.id, revision: pkg.metadata.version, fingerprint: pkg.metadata.contentHash };
  }

  // --- Record proposal (generation) --------------------------------------

  async recordProposal(workflowId: string, generationRequestId: string, ingest: { summary: string; scenarioMappings: TestChangeProposal["scenarioMappings"]; fileChanges: ProposedFileChange[]; assumptions: string[]; testsToRun: string[]; unresolvedIssues: string[] }): Promise<QaTestIntelligenceAggregate> {
    const state = await this.loadState(workflowId);
    const request = state.generationRequests.find((r) => r.id === generationRequestId);
    if (!request) throw new TestIntelligenceError("coverage-gap-not-found", "Generation request not found.", true, "Create a generation request first.");
    const validatedChanges = ingest.fileChanges.map((c) => ({ ...c, proposalId: "", classification: classifyChange(c) }));
    const policyAssessment = this.policy.assess({ proposalId: this.createId(), changes: validatedChanges, isRemediation: false });
    const proposal: TestChangeProposal = {
      id: this.createId(),
      generationRequestId,
      contextPackageId: cryptoRandomUuid(),
      summary: ingest.summary,
      scenarioMappings: ingest.scenarioMappings,
      fileChanges: validatedChanges.map((c) => ({ ...c, proposalId: "" })),
      assumptions: ingest.assumptions,
      testsToRun: ingest.testsToRun,
      unresolvedIssues: ingest.unresolvedIssues,
      policyAssessmentId: policyAssessment.id,
      status: policyAssessment.status === "blocked" ? "blocked" : "received",
      receivedAt: this.now(),
    };
    // attach real proposalId to file changes
    proposal.fileChanges = proposal.fileChanges.map((c) => ({ ...c, proposalId: proposal.id }));
    const nextRequest: TestGenerationRequest = { ...request, status: proposal.status === "blocked" ? "rejected" : "proposal-received", updatedAt: this.now() };
    return this.save({
      ...state,
      generationRequests: state.generationRequests.map((r) => (r.id === generationRequestId ? nextRequest : r)),
      generationProposals: [...state.generationProposals, proposal],
      policyAssessments: [...state.policyAssessments, policyAssessment],
    });
  }

  async applyProposal(workflowId: string, proposalId: string, selectedChangeIds: string[]): Promise<{ state: QaTestIntelligenceAggregate; applied: AppliedTestChange[] }> {
    const state = await this.loadState(workflowId);
    const proposal = state.generationProposals.find((p) => p.id === proposalId);
    if (!proposal) throw new TestIntelligenceError("proposal-invalid", "Proposal not found.", true, "Record a proposal first.");
    const assessment = this.findAssessment(state, proposal.policyAssessmentId);
    if (assessment?.status === "blocked") throw new TestIntelligenceError("policy-production-change", "Cannot apply a blocked proposal.", true, "Resolve all blocking policy findings first.");
    const selected = proposal.fileChanges.filter((c) => selectedChangeIds.includes(c.id));
    // Re-validate selected changes against the policy at apply time.
    const recheck = this.policy.assess({ proposalId, changes: selected.map((c) => ({ ...c, proposalId })), isRemediation: false });
    const blocking = recheck.findings.find((f) => f.severity === "blocking");
    if (blocking) throw new TestIntelligenceError(blocking.rule as never, `Selected change ${blocking.file} is blocked: ${blocking.recommendedAction}`, true, blocking.recommendedAction);
    const contents = await Promise.all(selected.map(async (c) => ({ change: { ...c, proposalId }, proposedContent: await proposedContentFor(c) })));
    const { applied } = await this.safeEdit.apply({ workflowId, source: "test-generation", sourceRecordId: proposal.id, root: this.root, changes: contents, selectedChangeIds });
    const nextRequest = state.generationRequests.find((r) => r.id === proposal.generationRequestId);
    return {
      state: await this.save({
        ...state,
        generationRequests: nextRequest ? state.generationRequests.map((r) => (r.id === nextRequest.id ? { ...r, status: "applied", updatedAt: this.now() } : r)) : state.generationRequests,
        generationProposals: state.generationProposals.map((p) => (p.id === proposalId ? { ...p, status: "applied" } : p)),
        appliedChanges: [...state.appliedChanges, ...applied],
      }),
      applied,
    };
  }

  // --- Failure analysis ----------------------------------------------------

  async createFailureAnalysis(workflowId: string, testFailureId: string, evidence: FailureClassificationEvidence): Promise<{ state: QaTestIntelligenceAggregate; analysis: TestFailureAnalysis }> {
    const record: TestFailureRecord = {
      id: testFailureId,
      workflowId,
      qaExecutionId: evidence.qaExecutionId,
      testName: evidence.testFailureId,
      testFilePath: evidence.testFilePath,
      message: evidence.message,
      stackFrames: evidence.stackFrames,
      normalizedMessage: evidence.normalizedMessage,
      exceptionType: evidence.exceptionType,
      assertionLocation: evidence.assertionLocation,
      failureSignature: this.classifier.classify({ ...evidence, testFailureId }).failureSignature,
    };
    const analysis = this.classifier.classify(evidence);
    const state = await this.loadState(workflowId);
    return {
      state: await this.save({
        ...state,
        failureRecords: upsert(state.failureRecords, record, (r) => r.id === record.id),
        failureAnalyses: upsert(state.failureAnalyses, analysis, (a) => a.id === analysis.id),
      }),
      analysis,
    };
  }

  async acceptFailureClassification(workflowId: string, analysisId: string, category: TestFailureAnalysis["category"]): Promise<QaTestIntelligenceAggregate> {
    const state = await this.loadState(workflowId);
    const analysis = state.failureAnalyses.find((a) => a.id === analysisId);
    if (!analysis) throw new TestIntelligenceError("failure-not-found", "Failure analysis not found.", true, "Create a failure analysis first.");
    const next: TestFailureAnalysis = { ...analysis, category, status: "accepted", updatedAt: this.now() };
    const nextState = await this.save({ ...state, failureAnalyses: state.failureAnalyses.map((a) => (a.id === analysisId ? next : a)) });
    if (category === "production-defect") {
      const defectId = await this.development.createDefectWorkItem(workflowId, `Fix production defect causing test failure: ${analysis.testFailureId}`, cryptoRandomUuid(), `Failure signature: ${analysis.failureSignature}\nEvidence: ${analysis.evidenceIds.join(", ")}`);
      void defectId;
    }
    return nextState;
  }

  // --- Repeated runs / flaky ----------------------------------------------

  async requestRepeatedRuns(workflowId: string, testId: string, count: number, mode: string, seed?: string): Promise<{ state: QaTestIntelligenceAggregate; runs: FlakyTestRun[] }> {
    const qa = await this.impactQa.load(workflowId);
    if (!qa.impactAnalysis) throw new TestIntelligenceError("repeated-run-not-supported", "Impact analysis is required for repeated runs.", true, "Run impact analysis first.");
    const command = qa.capabilities.flatMap((c) => c.commands).find((cmd) => cmd.scope === "test-file") ?? qa.capabilities.flatMap((c) => c.commands)[0];
    if (!command) throw new TestIntelligenceError("repeated-run-not-supported", "No test command is available to run.", true, "Configure the test framework first.");
    const fingerprint = environmentFingerprint();
    const revision = revisionOf(qa);
    const persisted = await this.loadState(workflowId);
    const priorRuns = persisted.flakyRuns.filter((r) => r.testId === testId && r.revision === revision && r.environmentFingerprint === fingerprint);
    const runs: FlakyTestRun[] = [];
    for (let index = 0; index < count; index++) {
      const cmd: TestCommandDefinition = { ...command, id: `${command.id}-rep-${index}`, arguments: [...command.arguments, testId] };
      const result = await this.runner.run(cmd, {});
      const signature = computeRunSignature(result, testId);
      const run = this.flaky.createRun({
        workflowId,
        testId,
        revision,
        environmentFingerprint: fingerprint,
        result: result.status === "completed" ? "passed" : result.status === "timed-out" ? "timeout" : "failed",
        durationMs: result.durationMs,
        failureSignature: signature,
        seed: mode === "seed" ? seed : undefined,
        orderIndex: mode === "suite-order" ? index : undefined,
      });
      runs.push(run);
    }
    const allRuns = [...priorRuns, ...runs];
    const classification = this.flaky.classify({ workflowId, testId, revision, environmentFingerprint: fingerprint, runs: allRuns });
    const state = await this.loadState(workflowId);
    const next = await this.save({
      ...state,
      flakyRuns: [...state.flakyRuns, ...runs],
      flakyClassifications: upsert(state.flakyClassifications, classification, (c) => c.testId === testId && c.environmentFingerprint === fingerprint && c.revision === revision),
    });
    return { state: next, runs };
  }

  async loadFlakyHistory(workflowId: string, _testId: string): Promise<QaTestIntelligenceAggregate> {
    return this.load(workflowId);
  }

  // --- Remediation ---------------------------------------------------------

  async createRemediationProposal(workflowId: string, analysisId: string, ingest: { summary: string; scenarioMappings: TestChangeProposal["scenarioMappings"]; fileChanges: ProposedFileChange[]; assumptions: string[]; testsToRun: string[]; unresolvedIssues: string[] }): Promise<QaTestIntelligenceAggregate> {
    const state = await this.loadState(workflowId);
    const analysis = state.failureAnalyses.find((a) => a.id === analysisId);
    if (!analysis) throw new TestIntelligenceError("failure-not-found", "Failure analysis not found.", true, "Create a failure analysis first.");
    if (analysis.category === "production-defect") throw new TestIntelligenceError("remediation-not-allowed", "Production defects are routed to Development, not healed in the test.", true, "Accept the production-defect routing and fix the source.");
    const validatedChanges = ingest.fileChanges.map((c) => ({ ...c, proposalId: "", classification: classifyChange(c) }));
    const policyAssessment = this.policy.assess({ proposalId: this.createId(), changes: validatedChanges, isRemediation: true, approvedRequirementEvidence: analysis.category === "stale-expectation" });
    const proposal: TestRemediationProposal = {
      id: this.createId(),
      failureAnalysisId: analysisId,
      diagnosis: ingest.summary,
      intendedCorrection: ingest.assumptions.join("\n"),
      fileChanges: validatedChanges.map((c) => ({ ...c, proposalId: "" })),
      expectedValidation: { exactTest: true, relatedFile: true, impactedTests: analysis.category !== "fixture-problem", requiredRegression: analysis.category !== "fixture-problem" },
      policyAssessmentId: policyAssessment.id,
      status: policyAssessment.status === "blocked" ? "blocked" : "received",
      receivedAt: this.now(),
    };
    proposal.fileChanges = proposal.fileChanges.map((c) => ({ ...c, proposalId: proposal.id }));
    return this.save({ ...state, remediationProposals: [...state.remediationProposals, proposal], policyAssessments: [...state.policyAssessments, policyAssessment] });
  }

  async applyRemediation(workflowId: string, proposalId: string, selectedChangeIds: string[]): Promise<{ state: QaTestIntelligenceAggregate; applied: AppliedTestChange[] }> {
    const state = await this.loadState(workflowId);
    const proposal = state.remediationProposals.find((p) => p.id === proposalId);
    if (!proposal) throw new TestIntelligenceError("proposal-invalid", "Remediation proposal not found.", true, "Create a remediation proposal first.");
    const assessment = this.findAssessment(state, proposal.policyAssessmentId);
    if (assessment?.status === "blocked") throw new TestIntelligenceError("policy-production-change", "Cannot apply a blocked remediation proposal.", true, "Resolve all blocking policy findings first.");
    const selected = proposal.fileChanges.filter((c) => selectedChangeIds.includes(c.id));
    const recheck = this.policy.assess({ proposalId, changes: selected.map((c) => ({ ...c, proposalId })), isRemediation: true });
    const blocking = recheck.findings.find((f) => f.severity === "blocking");
    if (blocking) throw new TestIntelligenceError(blocking.rule as never, `Selected remediation change ${blocking.file} is blocked: ${blocking.recommendedAction}`, true, blocking.recommendedAction);
    const contents = await Promise.all(selected.map(async (c) => ({ change: { ...c, proposalId }, proposedContent: await proposedContentFor(c) })));
    const { applied } = await this.safeEdit.apply({ workflowId, source: "test-remediation", sourceRecordId: proposal.id, root: this.root, changes: contents, selectedChangeIds });
    return {
      state: await this.save({
        ...state,
        remediationProposals: state.remediationProposals.map((p) => (p.id === proposalId ? { ...p, status: "applied" } : p)),
        appliedChanges: [...state.appliedChanges, ...applied],
      }),
      applied,
    };
  }

  // --- Validation sequence -------------------------------------------------

  async runValidationSequence(workflowId: string, source: ValidationSource, sourceRecordId: string, commands: TestCommandDefinition[]): Promise<QaTestIntelligenceAggregate> {
    const state = await this.loadState(workflowId);
    const existing = state.validations.find((v) => v.source === source && v.sourceRecordId === sourceRecordId);
    const validation: TestChangeValidation = existing ?? {
      id: this.createId(),
      workflowId,
      source,
      sourceRecordId,
      levels: VALIDATION_ORDER.map((level) => ({ level, status: "not-run" })),
      finalStatus: "not-started",
      createdAt: this.now(),
      updatedAt: this.now(),
    };
    const levels: ValidationLevelResult[] = [];
    let failed = false;
    for (const level of VALIDATION_ORDER) {
      const command = commands.find((c) => c.scope === scopeForLevel(level)) ?? commands[0];
      if (!command) { levels.push({ level, status: "incomplete" }); continue; }
      const result = await this.runner.run({ ...command, id: `${command.id}-val-${level}` }, {});
      const status: ValidationLevelStatus = result.status === "completed" ? "passed" : "failed";
      if (status === "failed") failed = true;
      levels.push({ level, executionId: result.id, status });
      if (failed) break; // stop and report on first required failure
    }
    const finalStatus: TestChangeValidation["finalStatus"] = failed ? "failed" : "validated";
    const nextValidation: TestChangeValidation = { ...validation, levels, finalStatus, updatedAt: this.now() };
    return this.save({ ...state, validations: upsert(state.validations, nextValidation, (v) => v.id === nextValidation.id) });
  }

  async loadValidationState(workflowId: string, _source: ValidationSource, _sourceRecordId: string): Promise<QaTestIntelligenceAggregate> {
    return this.load(workflowId);
  }

  // --- Revert --------------------------------------------------------------

  async revertApplied(workflowId: string, appliedChangeId: string): Promise<QaTestIntelligenceAggregate> {
    const state = await this.loadState(workflowId);
    const change = state.appliedChanges.find((c) => c.id === appliedChangeId);
    if (!change) throw new TestIntelligenceError("revert-conflict", "Applied change not found.", true, "Select an applied change to revert.");
    if (change.revertedAt) return state;
    await this.safeEdit.revert(change, this.root);
    const reverted: AppliedTestChange = { ...change, revertedAt: this.now() };
    return this.save({ ...state, appliedChanges: state.appliedChanges.map((c) => (c.id === appliedChangeId ? reverted : c)) });
  }

  // --- Staleness -----------------------------------------------------------

  async markStaleForInputs(workflowId: string, reason: string): Promise<QaTestIntelligenceAggregate> {
    const state = await this.loadState(workflowId);
    return this.save({
      ...state,
      generationRequests: state.generationRequests.map((r) => (r.status === "applied" || r.status === "validated" || r.status === "rejected" ? r : { ...r, status: "stale", staleReason: reason })),
      failureAnalyses: state.failureAnalyses.map((a) => (a.status === "accepted" || a.status === "rejected" ? a : { ...a, status: "stale", staleReason: reason })),
    });
  }

  private findAssessment(state: QaTestIntelligenceAggregate, id: string): { status: "blocked" | "allowed" } | undefined {
    const assessment = state.policyAssessments.find((a) => a.id === id);
    if (!assessment) return undefined;
    return { status: assessment.status === "blocked" ? "blocked" : "allowed" };
  }

  private impactFresh(qa: ImpactQaAggregate): boolean {
    return qa.impactAnalysis?.status === "accepted";
  }
}

function scopeForLevel(level: ValidationLevel): TestCommandDefinition["scope"] {
  switch (level) {
    case "exact-test": return "test-case";
    case "related-file": return "test-file";
    case "impacted-tests": return "test-file";
    case "required-regression": return "suite";
  }
}

function classifyChange(change: ProposedFileChange): ProposedFileChange["classification"] {
  const path = change.filePath.toLowerCase();
  if (/\.(test|spec)\.(ts|tsx|js|jsx|mjs)$/.test(path) || path.includes("test") || path.includes("spec")) return "test";
  if (path.includes("fixture") || path.includes("__fixtures__")) return "fixture";
  if (path.includes("mock")) return "mock";
  if (path.includes("snapshot")) return "snapshot";
  if (/\.(json|ya?ml|toml|env|config\.)|tsconfig/.test(path)) return "configuration";
  if (path.includes("src/") && !path.includes("test") && !path.includes("spec") && !path.includes("fixture") && !path.includes("mock")) return "production";
  return "unknown";
}

function allowedTestPaths(request: TestGenerationRequest): string[] {
  return [...request.target.filePaths, ...request.target.entityIds.map((id) => `tests/${id}.test.ts`)];
}

function extractSpecification(_qa: ImpactQaAggregate): string | undefined {
  return undefined;
}

function upsert<T>(items: T[], value: T, key: (item: T) => boolean): T[] {
  const index = items.findIndex(key);
  if (index === -1) return [...items, value];
  const next = [...items];
  next[index] = value;
  return next;
}

async function readFiles(host: TestIntelligenceHost, paths: string[]): Promise<Array<{ path: string; content: string }>> {
  const out: Array<{ path: string; content: string }> = [];
  for (const path of paths) {
    try { out.push({ path, content: await host.readSource(path) }); } catch { /* missing file is acceptable */ }
  }
  return out;
}

async function proposedContentFor(change: ProposedFileChange & { proposalId: string }, currentContent: string = ""): Promise<string> {
  // For create, the proposed content is the diff body. For modify, apply the
  // unified diff to the current file content. This reconstruction mirrors the
  // real assistant handoff where only the diff is returned.
  if (change.changeType === "create") {
    return change.diff;
  }
  return applyUnifiedDiff(currentContent, change.diff);
}

/**
 * Apply a minimal unified diff (context + +/- lines, no line numbers required)
 * to the current content. Supports hunk header `headings` when present but also
 * tolerates diffs that are just added/removed lines.
 */
function applyUnifiedDiff(current: string, diff: string): string {
  const lines = diff.split("\n");
  if (lines.every((line) => !line.startsWith("-") && !line.startsWith("+") && !line.startsWith("@@"))) {
    // No recognizable diff markers: treat the diff body as the full new content.
    return diff;
  }
  const _original = current.split("\n");
  const result: string[] = [];
  for (const line of lines) {
    if (line.startsWith("@@") || line.startsWith(" ") || line.startsWith("+")) {
      if (line.startsWith("+")) result.push(line.slice(1));
      else if (line.startsWith(" ")) result.push(line.slice(1));
      // '@@' heading lines are skipped.
    } else if (line.startsWith("-")) {
      // Removing a line: skip it in the output (best-effort; assumes it matches).
      continue;
    } else if (line.startsWith("diff") || line.startsWith("index") || line.startsWith("---") || line.startsWith("+++")) {
      continue;
    } else {
      result.push(line);
    }
  }
  return result.join("\n");
}

function environmentFingerprint(): string {
  return `${process.platform}:${process.version}`;
}

function revisionOf(qa: ImpactQaAggregate): string {
  return qa.impactAnalysis?.intelligenceRevision ?? "unknown";
}

function cryptoRandomUuid(): string {
  return randomUUID();
}

function mapTestLayer(layer: "unit" | "integration" | "contract" | "e2e"): "unit" | "integration" | "contract" | "end-to-end" {
  return layer === "e2e" ? "end-to-end" : layer;
}

/** Compute a stable failure signature from a command result, excluding unstable values. */
function computeRunSignature(result: QaCommandResult, testId: string): string | undefined {
  if (result.status === "completed") return undefined;
  const lines = String(result.rawOutput ?? "").split("\n");
  const message = normalize(lines.slice(0, 12).join("\n"));
  const frames = lines.filter((line: string) => /at\s/.test(line)).slice(0, 5).map((line: string) => line.replace(/:\d+:\d+/g, ":<line>:<col>"));
  const payload = [testId, message, ...frames].join("|");
  return `sig:${createHash("sha256").update(payload).digest("hex").slice(0, 24)}`;
}

function normalize(value: string): string {
  return value
    .replace(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi, "<uuid>")
    .replace(/\b\d{13,}\b/g, "<ts>")
    .replace(/\b0x[0-9a-f]+\b/gi, "<addr>")
    .replace(/\/tmp\/[^\s]*/g, "<tmp>")
    .replace(/\b\d+ms\b/g, "<dur>")
    .trim();
}
