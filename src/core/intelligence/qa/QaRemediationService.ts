/**
 * QaRemediationService (spec §18, §19, §27, §42, §46, §48).
 *
 * Orchestrates the Phase 7 remediation lifecycle over persisted records (QaStore) and the Phase 6
 * pipeline. It coordinates scenario derivation → generation plan → (delegated) proposal → validation,
 * and failure evidence → deterministic classification → (optional) agent analysis → flaky assessment →
 * remediation proposal → bounded application → targeted rerun → regression confirmation.
 *
 * It does NOT reimplement Phase 2 (execution profiles), Phase 3 (context compression), Phase 4
 * (visualization), or Phase 5 (queries); it consumes their artifacts by reference and updates the Phase
 * 6 QA decision. The goal is always evidence-backed, reversible correction — never "make it green".
 */
import type { QaStore } from "./QaStore";
import { TestScenarioDerivationService } from "./TestScenarioDerivationService";
import {
  TestPatternDiscoveryService,
  TestLocationRecommendationService,
} from "./TestPatternDiscoveryService";
import { TestGenerationPlanService, GeneratedTestProposalService } from "./TestGenerationServices";
import { FailureEvidenceService } from "./FailureAnalysisServices";
import {
  DeterministicFailureClassifier,
  FlakyTestIntelligenceService,
} from "./FailureAnalysisServices";
import { RemediationProposalService } from "./RemediationServices";
import { TestHealingPolicyService } from "./TestHealingPolicyService";
import {
  AttemptLimitService,
  DiagnosticRerunService,
  RemediationAttemptService,
  RemediationApplicationService,
  RemediationValidationService,
  RegressionConfirmationService,
  DEFAULT_LIMIT_POLICY,
} from "./RemediationApplicationServices";
import {
  type TestGenerationRequest,
  type DerivedScenario,
  type RemediationProposal,
  type FailureAnalysis,
  type FlakyTestAssessment,
} from "../../../shared/contracts/qaRemediation";

export interface RemediationLifecycleInput {
  store: QaStore;
  request: TestGenerationRequest;
  /** Phase 2 execution profile id (defaults to built-in Test Generation profile). */
  generationProfileId?: string;
  /** Phase 3 compressed context package id (produced by the Phase 3 pipeline). */
  generationContextPackageId?: string;
}

export class QaRemediationService {
  readonly scenarios = new TestScenarioDerivationService();
  readonly patterns = new TestPatternDiscoveryService();
  readonly location = new TestLocationRecommendationService();
  readonly planSvc = new TestGenerationPlanService();
  readonly proposalScreen = new GeneratedTestProposalService();
  readonly evidence = new FailureEvidenceService();
  readonly classifier = new DeterministicFailureClassifier();
  readonly flaky = new FlakyTestIntelligenceService();
  readonly remediationProposal = new RemediationProposalService();
  readonly policy = new TestHealingPolicyService();
  readonly attempts = new AttemptLimitService(DEFAULT_LIMIT_POLICY);
  readonly reruns = new DiagnosticRerunService();
  readonly attemptSvc = new RemediationAttemptService();
  readonly apply = new RemediationApplicationService();
  readonly validation = new RemediationValidationService();
  readonly regression = new RegressionConfirmationService();

  constructor(private readonly store: QaStore) {}

  /** Persist a new generation request created from a Phase 6 coverage gap (spec §4, §5). */
  createGenerationRequest(req: TestGenerationRequest): TestGenerationRequest {
    this.store.saveGenerationRequest(req);
    return req;
  }

  /** Persist a derived scenario set keyed by request. */
  saveScenarios(requestId: string, scenarios: DerivedScenario[]): void {
    this.store.saveScenarioDerivation({
      requestId,
      scenarios,
      categoriesConsidered: [],
      categoriesSelected: [...new Set(scenarios.map((s) => s.category))],
      metadata: { createdAt: new Date().toISOString(), contentHash: "" },
    });
  }

  /** Persist a failure analysis produced by deterministic or agent classification. */
  saveFailureAnalysis(a: FailureAnalysis): void {
    this.store.saveFailureAnalysisRecord(a);
  }

  /** Persist a flaky assessment. */
  saveFlaky(a: FlakyTestAssessment): void {
    this.store.saveFlakyAssessment(a);
  }

  /** Persist a remediation proposal (already screened by RemediationProposalService). */
  saveRemediationProposal(p: RemediationProposal): void {
    this.store.saveRemediationProposal(p);
  }
}
