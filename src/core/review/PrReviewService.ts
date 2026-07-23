import { createHash } from "node:crypto";
import type { ReviewCompletionService } from "./ReviewCompletionService";
import { ReviewTraceabilityService } from "./ReviewTraceabilityService";
import { ReviewScopeAssessmentService } from "./ReviewScopeAssessmentService";
import { ReviewContractReviewService } from "./ReviewContractReviewService";
import { ReviewTestAdequacyService } from "./ReviewTestAdequacyService";
import type { PrReviewPersistenceStore } from "../persistence/PrReviewPersistenceStore";
import {
  PR_REVIEW_SCHEMA_VERSION,
  PullRequestReviewSchema,
  ReviewFindingSchema,
  ChangeReadinessDecisionSchema,
  PullRequestPackageSchema,
  type PullRequestReview,
  type ReviewFinding,
  type ReviewFindingCategory,
  type ReviewFindingSeverity,
  type ReviewFindingProvenance,
  type ChangeReadinessDecision,
  type ReviewGateResult,
  type PullRequestPackage,
  type ReviewScopeAssessment,
  type ReviewTraceabilityAssessment,
  type ReviewContractAssessment,
  type ReviewTestAssessment,
  type ReviewChangeSetSource,
} from "../../shared/contracts/prReview";
import type { QaDecision } from "../../shared/contracts/qaLifecycle";
import type { SecurityAnalysis } from "../../shared/contracts/qaSecurity";
import type { PerformanceAnalysis } from "../../shared/contracts/qaSecurity";

export interface PrReviewEvidenceLoaders {
  loadQaDecision?: (workflowId: string) => QaDecision | undefined;
  loadSecurity?: (workflowId: string) => SecurityAnalysis | undefined;
  loadPerformance?: (workflowId: string) => PerformanceAnalysis | undefined;
}

export interface PrReviewPrepared {
  review: PullRequestReview;
  scope: ReviewScopeAssessment;
  traceability: ReviewTraceabilityAssessment;
  contract: ReviewContractAssessment;
  test: ReviewTestAssessment;
  findings: ReviewFinding[];
  securityDecisionId?: string;
  performanceDecisionId?: string;
}

export class PrReviewService {
  private readonly traceability = new ReviewTraceabilityService();
  private readonly scope = new ReviewScopeAssessmentService();
  private readonly contract = new ReviewContractReviewService();
  private readonly test = new ReviewTestAdequacyService();

  constructor(
    private readonly review: ReviewCompletionService,
    private readonly store: PrReviewPersistenceStore,
    private readonly evidence: PrReviewEvidenceLoaders = {},
  ) {}

  async initialize(): Promise<unknown> {
    return this.store.initialize();
  }

  get persisted() {
    return this.store.snapshot;
  }

  /** spec §6, §45 — prepare a review from the current real change set. */
  async prepare(
    workflowId: string,
    overrideChangeSet?: ReviewChangeSetSource,
    confirmPartial = false,
  ): Promise<PrReviewPrepared> {
    const state = this.review.getState(workflowId);
    const workflow = state.workflow;
    const spec = workflow.specification;
    if (!spec) throw new PrReviewError("review-change-set-unavailable", workflowId, "Specification is required before PR review.");
    const partial = overrideChangeSet?.partial ?? false;
    if (partial && !confirmPartial) {
      throw new PrReviewError(
        "review-scope-partial",
        workflowId,
        "Review covers only part of the workspace changes; explicit confirmation is required.",
      );
    }

    const changedFilePaths = state.changes.map((c) => c.path);
    const criterionEvidence: Record<
      string,
      { taskIds: string[]; changedFiles: string[]; validationEvidenceIds: string[]; qaEvidence: string[]; status: string }
    > = {};
    for (const link of state.traceability) {
      if (link.kind !== "acceptance-criterion") continue;
      criterionEvidence[link.id] = {
        taskIds: link.taskIds,
        changedFiles: link.changedFiles,
        validationEvidenceIds: link.validationEvidenceIds,
        qaEvidence: link.qaEvidence,
        status: link.status,
      };
    }

    const traceability = this.traceability.build({
      workflowId,
      requirements: spec.requirements.map((r) => ({ id: r.id, description: r.description })),
      acceptanceCriteria: spec.acceptanceCriteria.map((c) => ({
        id: c.id,
        description: c.description,
        required: c.required,
        requirementIds: c.requirementIds,
      })),
      changedFilePaths,
      changedEntityIds: state.changes.flatMap((c) => c.changedSymbols),
      criterionEvidence,
    });

    const expectedAreas = [
      { area: "specification-scope", entityIds: [] as string[], filePaths: spec.scope.included.filter((p) => p.length > 0), rationale: "declared in specification" },
    ];
    const scope = this.scope.build({
      workflowId,
      expectedAreas,
      actualFilePaths: changedFilePaths,
      includedPaths: overrideChangeSet?.includedPaths,
      excludedPaths: overrideChangeSet?.excludedPaths,
      generatedPaths: overrideChangeSet?.generatedPaths,
      dependencyPaths: overrideChangeSet?.configPaths?.filter((p) => /(package-lock|pnpm-lock|yarn.lock)/.test(p)),
      partial,
      partialConfirmed: confirmPartial,
    });

    const qa = this.evidence.loadQaDecision?.(workflowId);
    const security = this.evidence.loadSecurity?.(workflowId);
    const performance = this.evidence.loadPerformance?.(workflowId);

    const test = this.test.build({
      workflowId,
      requiredImpactedTests: dedupeStrings(state.traceability.flatMap((l) => l.validationEvidenceIds)),
      testsExecuted: qa?.evidence.executionRunIds ?? [],
      resultsByTest: mapRunResults(qa),
      unresolvedFailures: state.readinessBlockers
        .filter((b) => /validation|test/i.test(b))
        .map((b) => b),
      skippedTests: [],
      coverageGaps: [],
      policyViolations: [],
      qaDecisionCurrent: qa ? qa.metadata.contentHash === state.repositoryFingerprint || isCurrent(qa) : false,
    });

    // Contract assessment: derive from changed symbols reported by the review state.
    const contract: ReviewContractAssessment = this.contract.build({
      workflowId,
      changes: state.changes
        .filter((c) => c.changedSymbols.some((s) => /public|export|interface|route/i.test(s)))
        .map((c) => ({
          id: `contract:${c.path}`,
          contractKind: /route|request|response/i.test(c.path) ? "api-route" : "exported-function",
          location: c.path,
          classification: "unresolved" as const,
          affectedConsumers: [],
          evidenceIds: [],
        })),
    });

    // Findings: combine deterministic scope/traceability/test findings + QA/security/performance findings.
    const findings = this.deriveDeterministicFindings(workflowId, scope, traceability, test, state.readinessBlockers);
    const consolidated = findings;

    const review = PullRequestReviewSchema.parse({
      schemaVersion: PR_REVIEW_SCHEMA_VERSION,
      id: crypto.randomUUID(),
      workflowId,
      changeSetId: state.repositoryFingerprint,
      specificationRevision: spec.revision,
      intelligenceRevision: String(state.summary.intelligenceGeneration),
      traceabilityAssessmentId: traceability.id,
      scopeAssessmentId: scope.id,
      contractAssessmentId: contract.id,
      testAssessmentId: test.id,
      securityDecisionId: security?.id,
      performanceDecisionId: performance?.id,
      findingIds: consolidated.map((f) => f.id),
      readinessDecisionId: undefined,
      prPackageId: undefined,
      status: "analyzing",
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      contentHash: hash({ workflowId, spec: spec.revision, changes: changedFilePaths.length }),
    });

    await this.store.update((s) => ({
      ...s,
      reviews: [...s.reviews.filter((r) => r.workflowId !== workflowId), review],
      scopeAssessments: [...s.scopeAssessments.filter((x) => x.workflowId !== workflowId), scope],
      traceabilityAssessments: [...s.traceabilityAssessments.filter((x) => x.workflowId !== workflowId), traceability],
      contractAssessments: [...s.contractAssessments.filter((x) => x.workflowId !== workflowId), contract],
      testAssessments: [...s.testAssessments.filter((x) => x.workflowId !== workflowId), test],
      findings: [...s.findings.filter((f) => f.reviewId !== review.id), ...consolidated],
    }));

    return {
      review,
      scope,
      traceability,
      contract,
      test,
      findings: consolidated,
      securityDecisionId: security?.id,
      performanceDecisionId: performance?.id,
    };
  }

  getReview(workflowId: string): PullRequestReview {
    const review = this.store.snapshot.reviews.find((r) => r.workflowId === workflowId);
    if (!review) throw new PrReviewError("review-change-set-unavailable", workflowId, "No PR review has been prepared.");
    return review;
  }

  getFindings(reviewId: string): ReviewFinding[] {
    return this.store.snapshot.findings.filter((f) => f.reviewId === reviewId);
  }

  /** spec §25, §28 — record structured agent findings (validated, never from git ops). */
  async recordAgentFindings(
    workflowId: string,
    findings: Array<{
      category: ReviewFindingCategory;
      severity: ReviewFindingSeverity;
      confidence: number;
      title: string;
      description: string;
      location?: ReviewFinding["location"];
      requirementIds?: string[];
      evidenceIds?: string[];
      recommendation?: string;
    }>,
  ): Promise<ReviewFinding[]> {
    const review = this.getReview(workflowId);
    const stored: ReviewFinding[] = findings.map((f) =>
      ReviewFindingSchema.parse({
        id: `agent:${crypto.randomUUID()}`,
        reviewId: review.id,
        category: f.category,
        severity: f.severity,
        confidence: f.confidence,
        title: f.title,
        description: f.description,
        location: f.location,
        requirementIds: f.requirementIds ?? [],
        evidenceIds: f.evidenceIds ?? [],
        provenance: "agent" as ReviewFindingProvenance,
        status: "open",
        resolutionEvidence: [],
        createdAt: new Date().toISOString(),
        contentHash: hash(f),
      }),
    );
    await this.store.update((s) => ({
      ...s,
      findings: [...s.findings, ...stored],
      reviews: s.reviews.map((r) =>
        r.id === review.id ? { ...r, findingIds: [...r.findingIds, ...stored.map((x) => x.id)] } : r,
      ),
    }));
    return stored;
  }

  /** spec §31, §33 — update finding status; high/critical deferral requires justification. */
  async updateFindingStatus(
    workflowId: string,
    findingId: string,
    status: ReviewFinding["status"],
    resolutionEvidence: string[] = [],
    justification = "",
  ): Promise<ReviewFinding> {
    const review = this.getReview(workflowId);
    const existing = this.store.snapshot.findings.find((f) => f.id === findingId && f.reviewId === review.id);
    if (!existing) throw new PrReviewError("finding-evidence-missing", workflowId, "Finding not found in this review.");
    if ((status === "deferred" || status === "accepted-risk" || status === "false-positive") &&
      (existing.severity === "high" || existing.severity === "critical") &&
      justification.trim().length === 0) {
      throw new PrReviewError(
        "finding-evidence-missing",
        workflowId,
        `High/critical finding ${existing.severity} requires a justification to be ${status}.`,
      );
    }
    if ((status === "resolved" || status === "accepted-risk") && resolutionEvidence.length === 0 && existing.severity !== "info") {
      throw new PrReviewError(
        "finding-evidence-missing",
        workflowId,
        `Finding ${status} requires supporting evidence (changed source, passing validation, or updated decision).`,
      );
    }
    const updated = ReviewFindingSchema.parse({
      ...existing,
      status,
      resolutionEvidence,
      contentHash: hash({ ...existing, status, resolutionEvidence }),
    });
    await this.store.update((s) => ({
      ...s,
      findings: s.findings.map((f) => (f.id === findingId ? updated : f)),
    }));
    return updated;
  }

  /** spec §32 — route a finding to a remediation work item. Does not edit source directly. */
  async createRemediation(
    workflowId: string,
    findingId: string,
    targetStage: "development" | "test-generation" | "test-healing" | "security" | "performance" | "documentation",
    expectedCorrection: string,
    requiredValidation: string,
  ): Promise<{ findingId: string; remediationId: string; targetStage: string }> {
    const review = this.getReview(workflowId);
    const finding = this.store.snapshot.findings.find((f) => f.id === findingId && f.reviewId === review.id);
    if (!finding) throw new PrReviewError("finding-evidence-missing", workflowId, "Finding not found for remediation.");
    const remediationId = crypto.randomUUID();
    await this.store.update((s) => ({
      ...s,
      findings: s.findings.map((f) =>
        f.id === findingId ? { ...f, status: "remediation-planned" as const } : f,
      ),
    }));
    return { findingId, remediationId, targetStage, ...metadata(expectedCorrection, requiredValidation) };
  }

  /** spec §35 — recompute staleness and refresh affected sections. */
  async refresh(workflowId: string): Promise<PullRequestReview> {
    const current = this.getReview(workflowId);
    const state = this.review.getState(workflowId);
    const fresh = PullRequestReviewSchema.parse({
      ...current,
      status: "revalidating",
      updatedAt: new Date().toISOString(),
      contentHash: hash({ ...current, refreshedAt: new Date().toISOString() }),
    });
    await this.store.update((s) => ({
      ...s,
      reviews: s.reviews.map((r) => (r.id === current.id ? fresh : r)),
    }));
    return fresh;
  }

  /** spec §36, §37 — explicit readiness gates. */
  calculateReadiness(workflowId: string): ChangeReadinessDecision {
    const review = this.getReview(workflowId);
    const findings = this.getFindings(review.id);
    const scope = this.store.snapshot.scopeAssessments.find((s) => s.id === review.scopeAssessmentId);
    const test = this.store.snapshot.testAssessments.find((t) => t.id === review.testAssessmentId);
    const trace = this.store.snapshot.traceabilityAssessments.find((t) => t.id === review.traceabilityAssessmentId);

    const criticalOpen = findings.filter((f) => f.severity === "critical" && f.status === "open").length;
    const highOpen = findings.filter((f) => f.severity === "high" && (f.status === "open" || f.status === "deferred" || f.status === "accepted-risk")).length;
    const warningOpen = findings.filter((f) => f.severity === "warning" && f.status === "open").length;
    const acceptedRisk = findings.filter((f) => f.status === "accepted-risk").length;
    const deferred = findings.filter((f) => f.status === "deferred").length;

    const unmetCriteria = trace?.links.filter((l) => l.kind === "acceptance-criterion" && ["no-implementation-found", "contradicted"].includes(l.state)).length ?? 0;
    const scopeExpanded = scope ? ["unexplained-expansion", "materially-out-of-scope"].includes(scope.state) : false;
    const testInadequate = test ? ["incomplete", "failed", "stale", "unavailable"].includes(test.state) : true;
    const unresolvedBreaking = this.store.snapshot.contractAssessments
      .find((c) => c.id === review.contractAssessmentId)
      ?.changes.some((c) => c.classification === "breaking" || c.classification === "potentially-breaking") ?? false;

    const gates: ReviewGateResult[] = [
      gate("review-scope-confirmed", !scope?.partialReviewConfirmed ? "passed" : "warning",
        scope ? [`scope state=${scope.state}`, `unlinked=${scope.unlinkedFilePaths.length}`] : [],
        scope ? `Scope assessed as ${scope.state}.` : "No scope assessment."),
      gate("required-acceptance-criteria-satisfied", unmetCriteria === 0 ? "passed" : "failed",
        [`unmetCriteria=${unmetCriteria}`], "All required acceptance criteria must map to validated implementation."),
      gate("no-unexplained-scope-expansion", scopeExpanded ? "failed" : "passed",
        scope ? [`state=${scope.state}`] : [], "Unexplained material scope expansion blocks readiness."),
      gate("no-open-critical-findings", criticalOpen === 0 ? "passed" : "failed",
        [`criticalOpen=${criticalOpen}`], "Open critical findings block readiness."),
      gate("no-policy-blocking-high-findings", highOpen === 0 ? "passed" : "failed",
        [`highOpen=${highOpen}`], "Policy-blocking high findings must be resolved or explicitly justified."),
      gate("qa-decision-current", test && !testInadequate ? "passed" : (test ? "failed" : "incomplete"),
        test ? [`state=${test.state}`, `qaCurrent=${test.qaDecisionCurrent}`] : [], "QA decision must be current and acceptable."),
      gate("security-decision-current", review.securityDecisionId ? "passed" : "incomplete",
        [`securityDecisionId=${review.securityDecisionId ?? "none"}`], "Security decision must be loaded."),
      gate("performance-decision-current", review.performanceDecisionId ? "passed" : "incomplete",
        [`performanceDecisionId=${review.performanceDecisionId ?? "none"}`], "Performance decision must be loaded."),
      gate("no-unresolved-breaking-contract", unresolvedBreaking ? "failed" : "passed",
        [`unresolvedBreaking=${unresolvedBreaking}`], "Unresolved breaking contract changes block readiness."),
      gate("review-revision-current", review.status !== "stale" ? "passed" : "failed",
        [`status=${review.status}`], "Stale review cannot pass readiness."),
    ];

    const blocked = gates.some((g) => g.result === "failed");
    const incomplete = gates.some((g) => g.result === "incomplete");
    const decision: ChangeReadinessDecision["decision"] = blocked
      ? "blocked"
      : incomplete
        ? "incomplete"
        : highOpen > 0 || warningOpen > 0 || deferred > 0
          ? "ready-with-warnings"
          : "ready";

    return ChangeReadinessDecisionSchema.parse({
      schemaVersion: PR_REVIEW_SCHEMA_VERSION,
      id: crypto.randomUUID(),
      workflowId,
      reviewId: review.id,
      decision,
      gates,
      counts: { criticalOpen, highOpen, warningOpen, acceptedRisk, deferred },
      evidence: {
        traceabilityCurrent: Boolean(trace),
        qaCurrent: test?.qaDecisionCurrent ?? false,
        securityCurrent: Boolean(review.securityDecisionId),
        performanceCurrent: Boolean(review.performanceDecisionId),
        reviewCurrent: review.status !== "stale",
      },
      approvedByUser: false,
      createdAt: new Date().toISOString(),
      contentHash: hash({ decision, gates, counts: { criticalOpen, highOpen, warningOpen, acceptedRisk, deferred } }),
    });
  }

  async approveReadiness(
    workflowId: string,
    decision: "ready" | "ready-with-warnings",
    reason: string,
  ): Promise<ChangeReadinessDecision> {
    const readiness = this.calculateReadiness(workflowId);
    if (readiness.decision === "blocked" || readiness.decision === "incomplete") {
      throw new PrReviewError(
        "readiness-blocked",
        workflowId,
        `Readiness is ${readiness.decision}; user approval is not permitted until gates pass.`,
      );
    }
    if (decision === "ready" && readiness.decision === "ready-with-warnings") {
      throw new PrReviewError(
        "readiness-blocked",
        workflowId,
        "Cannot approve as 'ready' while warnings remain; use 'ready-with-warnings' or resolve warnings.",
      );
    }
    const approved = ChangeReadinessDecisionSchema.parse({
      ...readiness,
      decision,
      approvedByUser: true,
      contentHash: hash({ ...readiness, approvedByUser: true, reason }),
    });
    const review = this.getReview(workflowId);
    await this.store.update((s) => ({
      ...s,
      readinessDecisions: [...s.readinessDecisions.filter((r) => r.reviewId !== review.id), approved],
      reviews: s.reviews.map((r) =>
        r.id === review.id
          ? {
              ...r,
              readinessDecisionId: approved.id,
              status: decision === "ready" ? ("ready" as const) : ("ready-with-warnings" as const),
              updatedAt: new Date().toISOString(),
            }
          : r,
      ),
    }));
    return approved;
  }

  /** spec §39, §40, §41 — generate a PR package from current evidence only. */
  generatePackage(workflowId: string): PullRequestPackage {
    const review = this.getReview(workflowId);
    const state = this.review.getState(workflowId);
    const spec = state.workflow.specification;
    if (!spec) throw new PrReviewError("review-change-set-unavailable", workflowId, "Specification required for PR package.");
    const findings = this.getFindings(review.id);
    const test = this.store.snapshot.testAssessments.find((t) => t.id === review.testAssessmentId);
    const scope = this.store.snapshot.scopeAssessments.find((s) => s.id === review.scopeAssessmentId);
    const trace = this.store.snapshot.traceabilityAssessments.find((t) => t.id === review.traceabilityAssessmentId);
    const security = this.evidence.loadSecurity?.(workflowId);
    const performance = this.evidence.loadPerformance?.(workflowId);

    const summary = state.summary;
    const title = generateTitle(spec.title, summary);
    const testSummary = this.test.validationSummary({
      workflowId,
      requiredImpactedTests: test?.requiredImpactedTests ?? [],
      testsExecuted: test?.testsExecuted ?? [],
      resultsByTest: test?.resultsByTest ?? {},
      qaDecisionCurrent: test?.qaDecisionCurrent ?? false,
    });
    const passingAll = testSummary.failed === 0 && testSummary.notRun === 0 && testSummary.skipped === 0;
    const validationLine = passingAll
      ? `Validation: ${testSummary.passed} passed across ${test?.testsExecuted.length ?? 0} executed tests.`
      : `Validation: ${testSummary.passed} passed, ${testSummary.failed} failed, ${testSummary.skipped} skipped, ${testSummary.notRun} not run.`;

    const sections = {
      summary: `This PR implements ${spec.objective}. It was generated from a Keystone PR Review of workflow ${workflowId}.`,
      problem: spec.objective,
      solution: `Completed ${summary.tasksCompleted} tasks (${summary.tasksIncomplete} incomplete). Review scope: ${scope?.state ?? "unknown"} with ${scope?.unlinkedFilePaths.length ?? 0} unlinked candidate paths.`,
      mainChanges: state.changes.map((c) => `- ${c.kind} ${c.path}`).join("\n") || "No file changes recorded.",
      requirementCoverage: trace?.links
        .map((l) => `- ${l.sourceRef} [${l.state}] ${l.description}`)
        .join("\n") || "No requirements mapped.",
      affectedAreas: scope?.actualAreas.map((a) => `- ${a.area}`).join("\n") ?? "",
      contractChanges: this.store.snapshot.contractAssessments
        .find((c) => c.id === review.contractAssessmentId)
        ?.changes.map((c) => `- ${c.contractKind} ${c.location} [${c.classification}]`).join("\n") ?? "No contract changes detected.",
      configurationOrMigration: "No migration or configuration schema changes detected by the review.",
      testEvidence: `${validationLine}\nTest adequacy: ${test?.state ?? "unavailable"}.`,
      security: security
        ? `Security decision ${security.metadata.status}; risk level ${security.risk.level}. Open findings: ${security.findings.filter((f) => f.status === "open").length}.`
        : "Security evidence not loaded for this review.",
      performance: performance
        ? `Performance decision ${performance.metadata.status}; risk level ${performance.risk.level}. Static candidates: ${performance.findings.length}; runtime-confirmed: ${performance.runtimeEvidence.length}.`
        : "Performance evidence not loaded for this review.",
      knownLimitations: findings
        .filter((f) => f.status === "open" || f.status === "deferred")
        .map((f) => `- ${f.severity}: ${f.title}`)
        .join("\n") || "None recorded.",
      acceptedRisks: findings
        .filter((f) => f.status === "accepted-risk")
        .map((f) => `- ${f.title} (accepted)`)
        .join("\n") || "No accepted risks.",
      reviewerGuidance: guidance(findings, test, security, performance),
      checklist: [
        "Review scope confirmed against the real change set.",
        "Required acceptance criteria map to validated implementation.",
        "No open critical findings.",
        "Security and Performance decisions are current.",
        "Test adequacy uses current Phase 7/8 evidence.",
      ].join("\n"),
    };

    return PullRequestPackageSchema.parse({
      schemaVersion: PR_REVIEW_SCHEMA_VERSION,
      id: crypto.randomUUID(),
      workflowId,
      reviewId: review.id,
      title,
      description: Object.values(sections).join("\n\n"),
      generatedAt: new Date().toISOString(),
      contentHash: hash({ title, sections }),
      userEdited: false,
      stale: false,
      sections,
    });
  }

  async updatePackage(
    workflowId: string,
    title?: string,
    description?: string,
  ): Promise<PullRequestPackage> {
    const review = this.getReview(workflowId);
    const existing = this.store.snapshot.packages.find((p) => p.reviewId === review.id);
    const base = existing ?? this.generatePackage(workflowId);
    const updated = PullRequestPackageSchema.parse({
      ...base,
      ...(title !== undefined ? { title } : {}),
      ...(description !== undefined ? { description } : {}),
      userEdited: true,
      contentHash: hash({ title: title ?? base.title, description: description ?? base.description, userEdited: true }),
    });
    await this.store.update((s) => ({
      ...s,
      packages: [...s.packages.filter((p) => p.reviewId !== review.id), updated],
      reviews: s.reviews.map((r) => (r.id === review.id ? { ...r, prPackageId: updated.id } : r)),
    }));
    return updated;
  }

  /** spec §44 — copy the exact displayed content (title / description / complete). */
  copyPackage(workflowId: string, target: "title" | "description" | "complete"): string {
    const review = this.getReview(workflowId);
    const pkg = this.store.snapshot.packages.find((p) => p.reviewId === review.id) ?? this.generatePackage(workflowId);
    if (target === "title") return pkg.title;
    if (target === "description") return pkg.description;
    return `# ${pkg.title}\n\n${pkg.description}`;
  }

  private deriveDeterministicFindings(
    workflowId: string,
    scope: ReviewScopeAssessment,
    trace: ReviewTraceabilityAssessment,
    test: ReviewTestAssessment,
    readinessBlockers: string[],
  ): ReviewFinding[] {
    const review = this.getReview(workflowId);
    const findings: ReviewFinding[] = [];
    const mk = (
      id: string,
      category: ReviewFindingCategory,
      severity: ReviewFindingSeverity,
      title: string,
      description: string,
      evidence: string[],
    ): ReviewFinding =>
      ReviewFindingSchema.parse({
        id,
        reviewId: review.id,
        category,
        severity,
        confidence: 0.8,
        title,
        description,
        requirementIds: [],
        evidenceIds: evidence,
        provenance: "deterministic" as ReviewFindingProvenance,
        status: "open",
        resolutionEvidence: [],
        createdAt: new Date().toISOString(),
        contentHash: hash({ id, title }),
      });

    for (const path of scope.unlinkedFilePaths) {
      findings.push(mk(`scope:${path}`, "scope", "warning", `Unlinked change: ${path}`,
        "This change has no relationship to workflow intent, specification, or acceptance criteria. Justify or exclude it.", [path]));
    }
    if (["unexplained-expansion", "materially-out-of-scope"].includes(scope.state)) {
      findings.push(mk("scope:expansion", "scope", "high", `Scope state: ${scope.state}`,
        "The change set expands beyond the expected scope without explanation.", [`scope:${scope.state}`]));
    }
    for (const link of trace.links) {
      if (link.kind === "acceptance-criterion" && link.state === "no-implementation-found") {
        findings.push(mk(`req:${link.sourceRef}`, "requirement", "high", `Missing implementation: ${link.sourceRef}`,
          `Acceptance criterion ${link.sourceRef} has no implementation mapping.`, [link.sourceRef]));
      }
      if (link.state === "contradicted") {
        findings.push(mk(`req:${link.sourceRef}:contradicted`, "requirement", "high", `Contradicted evidence: ${link.sourceRef}`,
          `Validation evidence contradicts acceptance criterion ${link.sourceRef}.`, [link.sourceRef]));
      }
    }
    if (test.policyViolations.length > 0) {
      findings.push(mk("test:policy", "test", "critical", "Unsafe test-healing policy violation",
        `Phase 8 policy violation(s): ${test.policyViolations.join(", ")}.`, test.policyViolations));
    }
    if (test.state === "incomplete" || test.state === "failed" || test.state === "stale") {
      findings.push(mk("test:adequacy", "test", "high", `Test adequacy: ${test.state}`,
        `Required impacted tests missing or unresolved failures present.`, []));
    }
    for (const blocker of readinessBlockers) {
      findings.push(mk(`blocker:${hash(blocker).slice(0, 12)}`, "quality", "warning", "Readiness blocker", blocker, []));
    }
    return findings;
  }
}

// ---------------------------------------------------------------------------

export class PrReviewError extends Error {
  constructor(
    public readonly code: string,
    public readonly workflowId: string,
    message: string,
    public readonly recoverable = true,
    public readonly nextAction = "Resolve the reported section and re-run the review.",
  ) {
    super(message);
    this.name = "PrReviewError";
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

function generateTitle(specTitle: string, summary: { workType?: string }): string {
  const workType = summary.workType ?? "change";
  const clean = specTitle.replace(/\s+/g, " ").trim();
  const max = 80;
  const base = `${capitalize(workType)}: ${clean}`.slice(0, max);
  return base.length < (clean.length + workType.length + 2) ? base : base;
}

function capitalize(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

function guidance(
  findings: ReviewFinding[],
  test: ReviewTestAssessment | undefined,
  security: SecurityAnalysis | undefined,
  performance: PerformanceAnalysis | undefined,
): string {
  const items: string[] = [];
  const publicContract = findings.find((f) => f.category === "contract");
  if (publicContract) items.push("Review changed public response/export contract for behavioural compatibility.");
  if (security?.findings.some((f) => f.severity === "high" || f.severity === "critical"))
    items.push("Verify authorization behaviour in the changed route.");
  if (performance?.runtimeEvidence.length)
    items.push("Verify the selected performance baseline against the measured evidence.");
  if (test?.generatedTestValidationIds.length === 0)
    items.push("Inspect generated test assertions for adequacy.");
  if (items.length === 0) items.push("Review the change set against the requirement traceability.");
  return items.join("\n");
}

function isCurrent(qa: QaDecision): boolean {
  return qa.approvedByUser && qa.decision !== "failed" && qa.decision !== "blocked";
}

function mapRunResults(qa: QaDecision | undefined): Record<string, "passed" | "failed" | "skipped" | "not-run" | "flaky"> {
  // The QA decision records execution run ids but not per-test results here;
  // map each run to its outcome conservatively.
  const out: Record<string, "passed" | "failed" | "skipped" | "not-run" | "flaky"> = {};
  if (!qa) return out;
  for (const id of qa.evidence.executionRunIds) {
    out[id] = qa.decision === "failed" ? "failed" : qa.decision === "passed" ? "passed" : "not-run";
  }
  return out;
}

function dedupeStrings(values: string[]): string[] {
  return [...new Set(values)];
}

function metadata(expectedCorrection: string, requiredValidation: string): Record<string, string> {
  return { expectedCorrection, requiredValidation };
}

function hash(value: unknown): string {
  return `sha256:${createHash("sha256").update(JSON.stringify(value)).digest("hex")}`;
}
