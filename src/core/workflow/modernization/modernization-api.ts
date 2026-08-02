import type { EventBus } from "../../platform/events/EventBus";
/**
 * Minimal node shape used internally to derive capabilities from repository
 * modules. Kept local so modernization does not depend on a graph model.
 */
interface CapabilitySourceNode {
  readonly id: string;
  readonly type: "Module";
  readonly category: "architecture";
  readonly title: string;
  readonly description?: string;
}

import type { RepositoryDependency, RepositoryModel } from "../../intelligence/repository/model";
import type { WorkflowPlatformApi } from "../orchestration/workflow-api";
import type { WorkflowRequest } from "../orchestration/model";
import { actionFromPattern, patternsForArea } from "./pattern-library";
import type {
  ArchitectureBoundary,
  ArchitectureComponent,
  ArchitectureDiscovery,
  BusinessCapability,
  FunctionalEquivalenceCheck,
  LegacyAssessmentMetrics,
  LegacyAssessmentReport,
  MigrationPhase,
  ModernizationCostEstimate,
  ModernizationExecutionStatus,
  ModernizationGap,
  ModernizationGovernanceReport,
  ModernizationImpact,
  ModernizationMetrics,
  ModernizationDecision,
  ModernizationDecisionInput,
  ModernizationPlan,
  ModernizationProposal,
  ModernizationSpecification,
  ModernizationPlatformStats,
  ModernizationRequest,
  ModernizationRisk,
  ModernizationSeverity,
  ModernizationStrategy,
  ModernizationValidationReport,
  TargetArchitecture,
  TargetArchitectureRecommendation,
  TechnologyRecommendation,
  TechnologyInventoryItem,
  TransformationAction
} from "./model";

export class ModernizationPlatformApi {
  private readonly assessments = new Map<string, LegacyAssessmentReport>();
  private readonly plans = new Map<string, ModernizationPlan>();
  private readonly proposals = new Map<string, ModernizationProposal>();

  constructor(
    private readonly eventBus?: EventBus,
    private readonly now: () => Date = () => new Date()
  ) {}

  async assess(
    repository: RepositoryModel,
    correlationId?: string
  ): Promise<LegacyAssessmentReport> {
    const metrics = assessmentMetrics(repository);
    const risks = assessRisks(repository, metrics);
    const technicalDebtScore = clamp(
      risks.reduce((sum, risk) => sum + severityWeight(risk.severity) * 8, 0) +
        Math.max(0, metrics.averageFileLines - 200) / 8 +
        Math.max(0, repository.dependencies.length - 80) / 5,
      0,
      100
    );
    const complexityScore = clamp(
      (repository.symbols.length / Math.max(1, repository.files.length)) * 8 +
        metrics.maxFileLines / 20 +
        repository.dependencies.length / 3,
      0,
      100
    );
    const readinessScore = clamp(
      100 - (technicalDebtScore * 0.55 + complexityScore * 0.25) + readinessCredits(metrics),
      0,
      100
    );
    const report: LegacyAssessmentReport = deepFreeze({
      id: `assessment-${repository.id}-${repository.version}`,
      repositoryId: repository.id,
      generatedAt: this.now().toISOString(),
      technicalDebtScore: round(technicalDebtScore),
      complexityScore: round(complexityScore),
      readinessScore: round(readinessScore),
      riskProfile: risks,
      technologyInventory: technologyInventory(repository),
      metrics,
      recommendations: recommendationsFor(risks, metrics),
      evidence: [
        `${repository.files.length} file(s) analyzed`,
        `${repository.dependencies.length} dependency relationship(s) analyzed`,
        `${repository.frameworks.length} framework signal(s) analyzed`
      ]
    });
    this.assessments.set(report.id, report);
    await this.publish(
      "ModernizationAssessed",
      {
        assessmentId: report.id,
        repositoryId: repository.id,
        readinessScore: report.readinessScore
      },
      correlationId
    );
    return report;
  }

  async mapCapabilities(repository: RepositoryModel): Promise<readonly BusinessCapability[]> {
    const source = repository.modules.map(moduleToNode);
    const capabilities = source.map((node, index) => {
      const assets = assetReferencesFor(node, repository);
      return deepFreeze({
        id: `capability-${repository.id}-${slug(node.title)}-${index + 1}`,
        name: capabilityName(node.title),
        assets,
        criticality: assets.length > 4 ? "high" : "medium",
        confidence: round(0.6)
      } satisfies BusinessCapability);
    });
    if (capabilities.length > 0) return Object.freeze(capabilities);
    return Object.freeze([
      deepFreeze({
        id: `capability-${repository.id}-core`,
        name: "Core application capability",
        assets: repository.files.slice(0, 12).map((file) => file.id),
        criticality: "medium",
        confidence: 0.55
      } satisfies BusinessCapability)
    ]);
  }

  async discoverArchitecture(repository: RepositoryModel): Promise<ArchitectureDiscovery> {
    const components = buildComponents(repository);
    const boundaries = buildBoundaries(repository, components);
    const style = inferArchitectureStyle(repository, components);
    return deepFreeze({
      id: `architecture-${repository.id}-${repository.version}`,
      repositoryId: repository.id,
      style,
      components,
      boundaries,
      evidence: [
        `${components.length} component(s) inferred`,
        `${boundaries.length} boundary candidate(s) inferred`,
        `${repository.dependencies.length} dependency signal(s) considered`
      ],
      confidence: round(
        Math.min(0.9, 0.45 + components.length * 0.04 + repository.frameworks.length * 0.03)
      )
    });
  }

  async analyzeGaps(
    assessment: LegacyAssessmentReport,
    targetArchitecture: TargetArchitecture
  ): Promise<readonly ModernizationGap[]> {
    const gaps: ModernizationGap[] = [];
    if (assessment.metrics.tests === 0) {
      gaps.push(
        gap(
          "testing-safety-net",
          "testing",
          "No visible test safety net",
          "No test files detected",
          "Characterization tests protect behavior before migration",
          "critical",
          "medium",
          ["Repository file inventory"]
        )
      );
    }
    if (assessment.metrics.documentation === 0) {
      gaps.push(
        gap(
          "documentation-baseline",
          "documentation",
          "Missing documentation baseline",
          "No documentation files detected",
          "Architecture and migration decisions are documented",
          "medium",
          "low",
          ["Repository documentation inventory"]
        )
      );
    }
    if (assessment.metrics.dependencies > 40) {
      gaps.push(
        gap(
          "dependency-surface",
          "dependency",
          "Large dependency surface",
          `${assessment.metrics.dependencies} dependency signals`,
          "Dependencies are grouped, upgraded, and validated incrementally",
          "high",
          "high",
          ["Repository dependency index"]
        )
      );
    }
    if (
      targetArchitecture.style !== "unknown" &&
      assessment.riskProfile.some((risk) => risk.area === "architecture")
    ) {
      gaps.push(
        gap(
          "architecture-target",
          "architecture",
          "Architecture needs target alignment",
          "Current boundaries are inferred or weak",
          `${targetArchitecture.name} with explicit boundaries`,
          "high",
          "high",
          ["Architecture discovery"]
        )
      );
    }
    for (const risk of assessment.riskProfile.filter(
      (r) => r.area === "technology-stack" || r.area === "security"
    )) {
      gaps.push(
        gap(
          `risk-${risk.id}`,
          risk.area,
          risk.description,
          "Current stack contains migration risk",
          "Risk mitigated under target platform constraints",
          risk.severity,
          risk.severity === "critical" ? "high" : "medium",
          risk.evidence
        )
      );
    }
    return Object.freeze(gaps.map(deepFreeze));
  }

  recommendTargets(
    assessment: LegacyAssessmentReport,
    currentArchitecture?: ArchitectureDiscovery
  ): readonly TargetArchitectureRecommendation[] {
    const candidates: TargetArchitecture[] = [
      {
        id: "target-incremental-modular",
        name: "Incremental modular architecture",
        style: "modular-monolith",
        principles: ["Preserve behavior", "Clarify boundaries", "Keep deployments simple"],
        technologyPreferences: assessment.technologyInventory
          .filter((item) => item.kind === "language")
          .map((item) => item.name)
      },
      {
        id: "target-service-oriented",
        name: "Service-oriented architecture",
        style: "service-oriented",
        principles: [
          "Isolate capabilities",
          "Explicit API contracts",
          "Independent operational ownership"
        ],
        technologyPreferences: ["api-gateway", "contract-tests", "observability"]
      },
      {
        id: "target-strangler",
        name: "Strangler migration architecture",
        style: "microservices",
        principles: [
          "Route incrementally",
          "Dual-run critical behavior",
          "Retire legacy by capability"
        ],
        technologyPreferences: ["feature-flags", "eventing", "contract-tests"]
      }
    ];
    return Object.freeze(
      candidates
        .map((target) => {
          const score =
            target.style === "modular-monolith"
              ? 100 - assessment.technicalDebtScore * 0.35
              : target.style === currentArchitecture?.style
                ? 70
                : 82 - assessment.complexityScore * 0.25;
          return deepFreeze({
            target,
            score: round(clamp(score, 0, 100)),
            tradeoffs: {
              migrationCost:
                target.style === "microservices" ? ("high" as const) : ("medium" as const),
              operationalRisk:
                target.style === "microservices" ? ("high" as const) : ("medium" as const),
              businessRisk: assessment.riskProfile.some(
                (risk) => risk.area === "business-capability"
              )
                ? ("high" as const)
                : ("medium" as const),
              reversibility:
                target.style === "modular-monolith" ? ("low" as const) : ("medium" as const)
            },
            rationale: Object.freeze([
              `Readiness score ${assessment.readinessScore}`,
              `${assessment.riskProfile.length} risk item(s) considered`,
              currentArchitecture
                ? `Current style ${currentArchitecture.style}`
                : "Current architecture not supplied"
            ])
          });
        })
        .sort((a, b) => b.score - a.score)
    );
  }

  /** Runs the complete discovery pass and stops at an explicit user decision gate. */
  async propose(
    request: ModernizationRequest,
    correlationId?: string
  ): Promise<ModernizationProposal> {
    const coverage = scanCoverage(request);
    if (!coverage.complete) {
      throw new Error(
        `Modernization discovery requires a complete repository scan (${coverage.analyzedFiles}/${coverage.expectedFiles} files indexed)`
      );
    }
    const assessment = await this.assess(request.repository, correlationId);
    const architecture = await this.discoverArchitecture(request.repository);
    const capabilities = await this.mapCapabilities(request.repository);
    const architectureRecommendations = this.recommendTargets(assessment, architecture);
    const provisionalTarget = request.targetArchitecture ?? architectureRecommendations[0].target;
    const gaps = await this.analyzeGaps(assessment, provisionalTarget);
    const technologyRecommendations = recommendTechnologies(assessment);
    const proposal: ModernizationProposal = deepFreeze({
      id: `modernization-proposal-${request.repository.id}-${request.repository.version}`,
      repositoryId: request.repository.id,
      generatedAt: this.now().toISOString(),
      status: "awaiting-user-decision",
      scanCoverage: coverage,
      assessment,
      architecture,
      capabilities,
      objectives: Object.freeze([...(request.objectives ?? [])]),
      constraints: Object.freeze([...(request.constraints ?? [])]),
      gaps,
      architectureRecommendations,
      technologyRecommendations,
      questions: [
        "Do you accept Keystone’s recommended target architecture?",
        "Which recommended technologies do you accept or want to replace?",
        "What delivery, compliance, budget, or operational constraints must the plan honor?"
      ]
    });
    this.proposals.set(proposal.id, proposal);
    await this.publish(
      "ModernizationProposed",
      { proposalId: proposal.id, repositoryId: request.repository.id },
      correlationId
    );
    return proposal;
  }

  /** Converts an explicit user choice into the detailed, traceable plan and specifications. */
  async planAccepted(
    proposalId: string,
    input: ModernizationDecisionInput,
    correlationId?: string
  ): Promise<ModernizationPlan> {
    const proposal = this.proposals.get(proposalId);
    if (!proposal) throw new Error(`Modernization proposal not found: ${proposalId}`);
    if (!input.accepted)
      throw new Error("Modernization plan generation requires explicit user acceptance");
    const recommendationCategories = new Set(
      proposal.technologyRecommendations.map((item) => item.category)
    );
    for (const [category, technology] of Object.entries(input.acceptedTechnologies ?? {})) {
      if (!recommendationCategories.has(category as TechnologyRecommendation["category"]))
        throw new Error(`Unknown modernization technology category: ${category}`);
      if (!technology.trim()) throw new Error(`Select a non-empty technology for ${category}`);
      if (technology.length > 200)
        throw new Error(`Technology choice for ${category} exceeds 200 characters`);
    }
    const recommended = input.selectedTargetId
      ? proposal.architectureRecommendations.find(
          (item) => item.target.id === input.selectedTargetId
        )?.target
      : proposal.architectureRecommendations[0]?.target;
    const targetArchitecture = input.customTarget ?? recommended;
    if (!targetArchitecture)
      throw new Error("Select a Keystone target or provide a custom target architecture");
    if (!targetArchitecture.id.trim() || !targetArchitecture.name.trim())
      throw new Error("The selected target architecture requires a non-empty id and name");
    const technologies = Object.freeze(
      Object.fromEntries(
        proposal.technologyRecommendations.map((item) => [
          item.category,
          input.acceptedTechnologies?.[item.category] ?? item.recommendedTechnology
        ])
      )
    );
    const decision: ModernizationDecision = deepFreeze({
      proposalId,
      acceptedAt: this.now().toISOString(),
      source:
        input.customTarget ||
        proposal.technologyRecommendations.some(
          (item) =>
            input.acceptedTechnologies?.[item.category] &&
            input.acceptedTechnologies[item.category] !== item.recommendedTechnology
        )
          ? "user-defined"
          : "keystone-recommendation",
      targetArchitecture: deepFreeze({
        ...targetArchitecture,
        technologyPreferences: Object.values(technologies)
      }),
      technologies,
      notes: Object.freeze([...(input.notes ?? [])])
    });
    const plan = await this.buildPlanFromDiscovery(proposal, decision, correlationId);
    await this.publish(
      "ModernizationDecisionAccepted",
      { proposalId, planId: plan.id, source: decision.source },
      correlationId
    );
    return plan;
  }

  restoreProposal(proposal: ModernizationProposal): void {
    this.proposals.set(proposal.id, deepFreeze(proposal));
  }

  async plan(request: ModernizationRequest, correlationId?: string): Promise<ModernizationPlan> {
    const assessment = await this.assess(request.repository, correlationId);
    const capabilities = await this.mapCapabilities(request.repository);
    const architecture = await this.discoverArchitecture(request.repository);
    const targetArchitecture =
      request.targetArchitecture ?? defaultTargetArchitecture(request.repository, architecture);
    const gaps = await this.analyzeGaps(assessment, targetArchitecture);
    const strategy = chooseStrategy(assessment, gaps, architecture);
    const phases = buildPhases(assessment, capabilities, gaps, request.constraints ?? []);
    const metrics = planMetrics(phases, assessment);
    const workflowRequest = workflowFromPhases(`Modernize ${request.repository.name}`, phases);
    const plan: ModernizationPlan = deepFreeze({
      id: `modernization-plan-${request.repository.id}-${request.repository.version}`,
      repositoryId: request.repository.id,
      generatedAt: this.now().toISOString(),
      strategy,
      assessmentId: assessment.id,
      targetArchitecture,
      capabilities,
      gaps,
      phases,
      risks: assessment.riskProfile,
      metrics,
      workflowRequest,
      specifications: specificationsFor(phases, targetArchitecture, undefined)
    });
    this.plans.set(plan.id, plan);
    await this.publish(
      "ModernizationPlanned",
      {
        planId: plan.id,
        repositoryId: request.repository.id,
        phases: plan.phases.length,
        strategy
      },
      correlationId
    );
    return plan;
  }

  private async buildPlanFromDiscovery(
    proposal: ModernizationProposal,
    decision: ModernizationDecision,
    correlationId?: string
  ): Promise<ModernizationPlan> {
    const gaps = await this.analyzeGaps(proposal.assessment, decision.targetArchitecture);
    const strategy = chooseStrategy(proposal.assessment, gaps, proposal.architecture);
    const phases = buildPhases(
      proposal.assessment,
      proposal.capabilities,
      gaps,
      proposal.constraints
    );
    const plan: ModernizationPlan = deepFreeze({
      id: `modernization-plan-${proposal.repositoryId}-${slug(decision.targetArchitecture.id)}`,
      repositoryId: proposal.repositoryId,
      generatedAt: this.now().toISOString(),
      strategy,
      assessmentId: proposal.assessment.id,
      targetArchitecture: decision.targetArchitecture,
      capabilities: proposal.capabilities,
      gaps,
      phases,
      risks: proposal.assessment.riskProfile,
      metrics: planMetrics(phases, proposal.assessment),
      workflowRequest: workflowFromPhases(`Modernize ${proposal.repositoryId}`, phases),
      decision,
      specifications: specificationsFor(
        phases,
        decision.targetArchitecture,
        decision,
        proposal.objectives,
        proposal.constraints.map((item) => item.description)
      )
    });
    this.plans.set(plan.id, plan);
    await this.publish(
      "ModernizationPlanned",
      { planId: plan.id, repositoryId: proposal.repositoryId, phases: phases.length, strategy },
      correlationId
    );
    return plan;
  }

  async validate(
    plan: ModernizationPlan,
    correlationId?: string
  ): Promise<ModernizationValidationReport> {
    const blockers: string[] = [];
    const warnings: string[] = [];
    const phaseIds = new Set(plan.phases.map((phase) => phase.id));
    for (const phase of plan.phases) {
      for (const prerequisite of phase.prerequisites) {
        if (!phaseIds.has(prerequisite))
          blockers.push(`Phase ${phase.id} references missing prerequisite ${prerequisite}`);
      }
      if (phase.validation.length === 0)
        blockers.push(`Phase ${phase.id} has no functional-equivalence validation`);
      if (phase.rollback.length === 0) warnings.push(`Phase ${phase.id} has no rollback notes`);
      if (phase.transformations.some((action) => !action.reversible))
        warnings.push(`Phase ${phase.id} contains non-reversible transformation(s)`);
    }
    if (
      plan.gaps.some((g) => g.priority === "critical") &&
      !plan.phases.some((phase) => phase.requiresApproval)
    ) {
      blockers.push("Critical gaps require at least one approval-gated phase");
    }
    const report: ModernizationValidationReport = deepFreeze({
      planId: plan.id,
      valid: blockers.length === 0,
      blockers,
      warnings,
      requiredApprovals: plan.phases
        .filter((phase) => phase.requiresApproval)
        .map((phase) => phase.id)
    });
    await this.publish(
      "ModernizationValidated",
      { planId: plan.id, valid: report.valid, blockers: blockers.length },
      correlationId
    );
    return report;
  }

  impact(planId: string): ModernizationImpact {
    const plan = this.requirePlan(planId);
    const impactedAssets = [
      ...new Set(plan.phases.flatMap((phase) => phase.scope).filter(Boolean))
    ];
    return deepFreeze({
      planId,
      impactedAssets: Object.freeze(impactedAssets),
      riskHeatMap: {
        architecture: heat(plan.risks, "architecture"),
        repository: heat(plan.risks, "code"),
        business: heat(plan.risks, "business-capability"),
        technology: heat(plan.risks, "technology-stack"),
        migration: Math.min(100, plan.metrics.estimatedEffortDays * 2),
        operational: heat(plan.risks, "operations")
      },
      mitigations: Object.freeze([...new Set(plan.risks.flatMap((risk) => risk.mitigation))])
    });
  }

  estimateCost(planId: string): ModernizationCostEstimate {
    const plan = this.requirePlan(planId);
    const complexityMultiplier = round(
      1 + plan.metrics.highRiskItems * 0.15 + Math.max(0, plan.metrics.totalPhases - 3) * 0.05
    );
    const engineeringDays = Math.ceil(plan.metrics.estimatedEffortDays * complexityMultiplier);
    const validationDays = Math.ceil(plan.metrics.validationChecks * 0.5);
    const reviewDays = plan.phases.filter((phase) => phase.requiresApproval).length;
    return deepFreeze({
      planId,
      engineeringDays,
      validationDays,
      reviewDays,
      totalDays: engineeringDays + validationDays + reviewDays,
      complexityMultiplier,
      assumptions: Object.freeze([
        "One engineering day per estimated phase effort unit before risk multiplier",
        "Each validation check requires half a day",
        "Approval-gated phases require one review day"
      ])
    });
  }

  trackExecution(
    planId: string,
    completedPhases: readonly string[] = [],
    issues: readonly string[] = []
  ): ModernizationExecutionStatus {
    const plan = this.requirePlan(planId);
    const completed = new Set(completedPhases);
    const active = plan.phases.find(
      (phase) =>
        !completed.has(phase.id) &&
        phase.prerequisites.every((prerequisite) => completed.has(prerequisite))
    );
    const completedEffort = plan.phases
      .filter((phase) => completed.has(phase.id))
      .reduce((sum, phase) => sum + phase.estimatedEffortDays, 0);
    const totalEffort = Math.max(1, plan.metrics.estimatedEffortDays);
    return deepFreeze({
      planId,
      completedPhases: Object.freeze([...completedPhases]),
      activePhase: active?.id,
      percentComplete: round((completedEffort / totalEffort) * 100),
      remainingEffortDays: Math.max(0, totalEffort - completedEffort),
      blocked: issues.length > 0 || (!active && completed.size < plan.phases.length),
      issues: Object.freeze([...issues])
    });
  }

  async govern(
    planId: string,
    approvedPhases: readonly string[] = [],
    correlationId?: string
  ): Promise<ModernizationGovernanceReport> {
    const plan = this.requirePlan(planId);
    const validation = await this.validate(plan, correlationId);
    const approved = new Set(approvedPhases);
    const missingApprovals = validation.requiredApprovals.filter(
      (phaseId) => !approved.has(phaseId)
    );
    const policyViolations = [
      ...validation.blockers,
      ...(missingApprovals.length ? [`Missing approval(s): ${missingApprovals.join(", ")}`] : []),
      ...(plan.metrics.highRiskItems > 0 && plan.metrics.validationChecks === 0
        ? ["High-risk plan requires validation checks"]
        : [])
    ];
    return deepFreeze({
      planId,
      approved: policyViolations.length === 0,
      requiredApprovals: Object.freeze(validation.requiredApprovals),
      policyViolations: Object.freeze(policyViolations),
      auditEvidence: Object.freeze([
        `Assessment ${plan.assessmentId}`,
        `Strategy ${plan.strategy}`,
        `${plan.phases.length} migration phase(s)`,
        `${plan.metrics.validationChecks} validation check(s)`
      ])
    });
  }

  async execute(
    planId: string,
    workflows: WorkflowPlatformApi,
    correlationId?: string
  ): Promise<ModernizationPlan> {
    const plan = this.requirePlan(planId);
    const validation = await this.validate(plan, correlationId);
    if (!validation.valid) {
      throw new Error(
        `Cannot execute invalid modernization plan: ${validation.blockers.join("; ")}`
      );
    }
    const workflow = await workflows.create(plan.workflowRequest);
    const execution = await workflows.execute(workflow.id);
    const updated: ModernizationPlan = deepFreeze({ ...plan, execution });
    this.plans.set(plan.id, updated);
    await this.publish(
      "ModernizationExecutionStarted",
      { planId, workflowId: execution.workflowId, state: execution.state },
      correlationId
    );
    return updated;
  }

  assessment(id: string): LegacyAssessmentReport {
    const assessment = this.assessments.get(id);
    if (!assessment) throw new Error(`Assessment not found: ${id}`);
    return assessment;
  }

  modernizationPlan(id: string): ModernizationPlan {
    return this.requirePlan(id);
  }

  plansForRepository(repositoryId: string): readonly ModernizationPlan[] {
    return Object.freeze(
      [...this.plans.values()].filter((plan) => plan.repositoryId === repositoryId)
    );
  }

  statistics(): ModernizationPlatformStats {
    const assessments = [...this.assessments.values()];
    const plans = [...this.plans.values()];
    const readiness = assessments.reduce((sum, assessment) => sum + assessment.readinessScore, 0);
    return deepFreeze({
      assessments: assessments.length,
      plans: plans.length,
      averageReadinessScore: assessments.length ? round(readiness / assessments.length) : 0,
      openHighRiskItems: plans.reduce(
        (sum, plan) =>
          sum +
          plan.risks.filter((risk) => risk.severity === "high" || risk.severity === "critical")
            .length,
        0
      )
    });
  }

  private requirePlan(id: string): ModernizationPlan {
    const plan = this.plans.get(id);
    if (!plan) throw new Error(`Modernization plan not found: ${id}`);
    return plan;
  }

  private async publish(
    eventType: string,
    payload: Record<string, unknown>,
    correlationId?: string
  ): Promise<void> {
    if (!this.eventBus) return;
    await this.eventBus.publish({
      eventType,
      platform: "modernization",
      source: "modernization-platform",
      correlationId,
      payload
    });
  }
}

function assessmentMetrics(repository: RepositoryModel): LegacyAssessmentMetrics {
  const lineCounts = repository.files.map((file) => file.lineCount);
  return deepFreeze({
    files: repository.files.length,
    languages: repository.languages.length,
    dependencies: repository.dependencies.length,
    frameworks: repository.frameworks.length,
    tests: repository.files.filter((file) => isTestPath(file.path)).length,
    documentation: repository.documentation.length,
    buildDefinitions: repository.buildMetadata.length,
    averageFileLines: round(
      lineCounts.reduce((sum, lines) => sum + lines, 0) / Math.max(1, lineCounts.length)
    ),
    maxFileLines: lineCounts.length ? Math.max(...lineCounts) : 0
  });
}

function assessRisks(
  repository: RepositoryModel,
  metrics: LegacyAssessmentMetrics
): readonly ModernizationRisk[] {
  const risks: ModernizationRisk[] = [];
  if (metrics.tests === 0) {
    risks.push(
      risk(
        "missing-tests",
        "testing",
        "No test files were discovered before modernization.",
        "critical",
        0.85,
        "critical",
        ["Create characterization tests before code transformation"],
        ["Repository file inventory"]
      )
    );
  }
  if (metrics.documentation === 0) {
    risks.push(
      risk(
        "missing-docs",
        "documentation",
        "No documentation baseline was discovered.",
        "medium",
        0.7,
        "medium",
        ["Create architecture summary and migration ADR before execution"],
        ["Repository documentation inventory"]
      )
    );
  }
  if (metrics.maxFileLines > 500) {
    risks.push(
      risk(
        "large-files",
        "code",
        "Large source files increase transformation blast radius.",
        metrics.maxFileLines > 1000 ? "high" : "medium",
        0.65,
        "high",
        ["Split transformations by file and validate behavior after each phase"],
        [`Maximum file length ${metrics.maxFileLines}`]
      )
    );
  }
  if (repository.dependencies.length > 60) {
    risks.push(
      risk(
        "dependency-volume",
        "dependency",
        "Large dependency surface increases upgrade compatibility risk.",
        "high",
        0.72,
        "high",
        ["Modernize dependencies in isolated batches with lockfile validation"],
        [`${repository.dependencies.length} dependency signals`]
      )
    );
  }
  // Architecture boundaries are not modeled by the repository model on its own,
  // so this risk is always reported until an explicit boundary source exists.
  risks.push(
    risk(
      "architecture-unknowns",
      "architecture",
      "Architecture boundaries are not explicitly modeled.",
      "medium",
      0.6,
      "high",
      ["Run architecture discovery and require review for boundary changes"],
      ["No explicit architecture boundary model is available"]
    )
  );
  if (repository.frameworks.some((framework) => framework.category === "database")) {
    risks.push(
      risk(
        "database-coupling",
        "database",
        "Database framework signals require data compatibility validation.",
        "medium",
        0.55,
        "high",
        ["Add schema migration and rollback validation"],
        repository.frameworks.filter((f) => f.category === "database").map((f) => f.name)
      )
    );
  }
  return Object.freeze(risks.map(deepFreeze));
}

function technologyInventory(repository: RepositoryModel): readonly TechnologyInventoryItem[] {
  const items: TechnologyInventoryItem[] = [];
  for (const language of repository.languages) {
    items.push({
      name: language.language,
      kind: "language",
      evidence: [`${language.files} file(s)`]
    });
  }
  for (const framework of repository.frameworks) {
    items.push({
      name: framework.name,
      kind: framework.category === "database" ? "database" : "framework",
      evidence: framework.evidence
    });
  }
  for (const dep of uniqueDependencies(repository.dependencies).slice(0, 80)) {
    items.push({ name: dep.target, kind: "dependency", evidence: dep.evidence });
  }
  for (const build of repository.buildMetadata) {
    items.push({ name: build.command, kind: "build", evidence: [build.source, build.description] });
  }
  return Object.freeze(items.map(deepFreeze));
}

function uniqueDependencies(
  dependencies: readonly RepositoryDependency[]
): readonly RepositoryDependency[] {
  const byTarget = new Map<string, RepositoryDependency>();
  for (const dependency of dependencies) {
    if (!byTarget.has(dependency.target)) byTarget.set(dependency.target, dependency);
  }
  return [...byTarget.values()].sort((a, b) => a.target.localeCompare(b.target));
}

function recommendationsFor(
  risks: readonly ModernizationRisk[],
  metrics: LegacyAssessmentMetrics
): readonly string[] {
  const recommendations = ["Run modernization through approval-gated incremental phases"];
  if (risks.some((risk) => risk.area === "testing"))
    recommendations.push("Build characterization tests before transforming production code");
  if (risks.some((risk) => risk.area === "architecture"))
    recommendations.push("Confirm architecture boundaries before choosing a migration strategy");
  if (metrics.dependencies > 0)
    recommendations.push(
      "Group dependency upgrades by ecosystem and verify each batch independently"
    );
  if (metrics.documentation === 0)
    recommendations.push("Create migration ADRs and rollback runbooks as first-class deliverables");
  return Object.freeze(recommendations);
}

function moduleToNode(module: {
  readonly id: string;
  readonly name: string;
  readonly path: string;
}): CapabilitySourceNode {
  return {
    id: module.id,
    type: "Module",
    category: "architecture",
    title: module.name,
    description: module.path
  };
}

function assetReferencesFor(
  node: CapabilitySourceNode,
  repository: RepositoryModel
): readonly string[] {
  const title = node.title.toLowerCase();
  const matched = repository.files
    .filter(
      (file) =>
        file.path.toLowerCase().includes(title) ||
        file.symbols.some((symbol) => symbol.name.toLowerCase().includes(title))
    )
    .map((file) => file.id);
  return Object.freeze(matched.length ? matched : [node.id]);
}

function capabilityName(title: string): string {
  return title.replace(/[-_]/g, " ").replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function buildComponents(repository: RepositoryModel): readonly ArchitectureComponent[] {
  const directories = repository.directories
    .filter((dir) => !dir.parentPath || dir.parentPath === ".")
    .slice(0, 12);
  const components = directories.map((dir) => {
    const files = repository.files.filter((file) => file.path.startsWith(`${dir.path}/`));
    return deepFreeze({
      id: `component-${repository.id}-${slug(dir.path)}`,
      name: dir.path,
      kind: "module",
      assets: files.map((file) => file.id),
      dependencies: dependenciesForFiles(
        repository,
        files.map((file) => file.id)
      )
    } satisfies ArchitectureComponent);
  });
  if (components.length > 0) return Object.freeze(components);
  return Object.freeze([
    deepFreeze({
      id: `component-${repository.id}-root`,
      name: repository.name,
      kind: "module",
      assets: repository.files.map((file) => file.id),
      dependencies: uniqueDependencies(repository.dependencies).map((dep) => dep.target)
    } satisfies ArchitectureComponent)
  ]);
}

function dependenciesForFiles(
  repository: RepositoryModel,
  fileIds: readonly string[]
): readonly string[] {
  const fileSet = new Set(fileIds);
  return Object.freeze(
    repository.dependencies.filter((dep) => fileSet.has(dep.sourceAssetId)).map((dep) => dep.target)
  );
}

function buildBoundaries(
  repository: RepositoryModel,
  components: readonly ArchitectureComponent[]
): readonly ArchitectureBoundary[] {
  return Object.freeze(
    components.map((component) =>
      deepFreeze({
        id: `boundary-${component.id}`,
        name: `${component.name} boundary`,
        assets: component.assets,
        risk:
          component.dependencies.length > 15
            ? "high"
            : component.assets.length > 20
              ? "medium"
              : "low"
      } satisfies ArchitectureBoundary)
    )
  );
}

function inferArchitectureStyle(
  repository: RepositoryModel,
  components: readonly ArchitectureComponent[]
): ArchitectureDiscovery["style"] {
  if (components.filter((component) => component.kind === "service").length > 1)
    return "service-oriented";
  if (
    repository.frameworks.some(
      (framework) =>
        framework.name.toLowerCase().includes("express") ||
        framework.name.toLowerCase().includes("spring")
    )
  )
    return "layered";
  return components.length > 1 ? "modular-monolith" : "unknown";
}

function defaultTargetArchitecture(
  repository: RepositoryModel,
  architecture: ArchitectureDiscovery
): TargetArchitecture {
  return deepFreeze({
    id: `target-${repository.id}`,
    name:
      architecture.style === "unknown"
        ? "Incremental modular architecture"
        : `Modernized ${architecture.style} architecture`,
    style: architecture.style === "unknown" ? "modular-monolith" : architecture.style,
    principles: [
      "Preserve business behavior",
      "Modernize incrementally",
      "Keep rollback paths explicit"
    ],
    technologyPreferences: repository.languages.map((language) => language.language)
  });
}

function chooseStrategy(
  assessment: LegacyAssessmentReport,
  gaps: readonly ModernizationGap[],
  architecture: ArchitectureDiscovery
): ModernizationStrategy {
  if (assessment.readinessScore < 35 || gaps.some((gapItem) => gapItem.priority === "critical"))
    return "strangler-fig";
  if (architecture.style === "unknown") return "incremental-upgrade";
  if (gaps.some((gapItem) => gapItem.area === "architecture")) return "refactor";
  return "replatform";
}

function buildPhases(
  assessment: LegacyAssessmentReport,
  capabilities: readonly BusinessCapability[],
  gaps: readonly ModernizationGap[],
  constraints: readonly {
    readonly id: string;
    readonly description: string;
    readonly severity: ModernizationSeverity;
  }[]
): readonly MigrationPhase[] {
  const phases: MigrationPhase[] = [];
  phases.push(
    phase({
      id: "phase-1-safety-net",
      name: "Establish behavior preservation safety net",
      strategy: "incremental-upgrade",
      order: 1,
      goals: ["Capture current behavior", "Create migration baseline"],
      scope: ["Characterization tests", "Build validation", "Rollback runbook"],
      prerequisites: [],
      risks: assessment.riskProfile
        .filter((riskItem) => riskItem.area === "testing" || riskItem.area === "documentation")
        .map((riskItem) => riskItem.id),
      transformations: [
        actionFromPattern(
          patternsForArea("testing")[0],
          capabilities.flatMap((capability) => capability.assets).slice(0, 20)
        ),
        actionFromPattern(patternsForArea("documentation")[0], [])
      ],
      validation: [
        validationCheck("baseline-tests", "Critical current behavior", "characterization-test", [
          "Baseline behavior is reproducible before migration"
        ])
      ],
      rollback: ["Safety-net phase is additive; remove generated tests/docs if needed"],
      estimatedEffortDays: 3,
      requiresApproval: false
    })
  );

  const sortedGaps = [...gaps].sort(
    (a, b) => severityWeight(b.priority) - severityWeight(a.priority)
  );
  let order = 2;
  for (const gapItem of sortedGaps.slice(0, 8)) {
    phases.push(
      phase({
        id: `phase-${order}-${slug(gapItem.id)}`,
        name: gapItem.title,
        strategy: strategyForGap(gapItem.area),
        order,
        goals: [gapItem.targetState],
        scope: [gapItem.currentState, ...gapItem.evidence],
        prerequisites: ["phase-1-safety-net"],
        risks: assessment.riskProfile
          .filter(
            (riskItem) => riskItem.area === gapItem.area || riskItem.severity === gapItem.priority
          )
          .map((riskItem) => riskItem.id),
        transformations: transformationsForGap(gapItem),
        validation: validationForGap(gapItem),
        rollback: [
          "Keep previous implementation path available until validation passes",
          "Revert the phase changes as one unit if checks fail"
        ],
        estimatedEffortDays: effortDays(gapItem.effort, gapItem.priority),
        requiresApproval:
          gapItem.priority === "high" ||
          gapItem.priority === "critical" ||
          constraints.some((c) => c.severity === "critical")
      })
    );
    order += 1;
  }

  phases.push(
    phase({
      id: `phase-${order}-operational-readiness`,
      name: "Operational readiness and migration closure",
      strategy: "retain",
      order,
      goals: ["Validate modernization outcomes", "Close migration risks"],
      scope: ["Metrics", "Documentation", "Review evidence"],
      prerequisites: phases.slice(1).map((p) => p.id),
      risks: assessment.riskProfile.map((riskItem) => riskItem.id),
      transformations: [],
      validation: [
        validationCheck("final-equivalence", "Modernized system behavior", "integration-test", [
          "No functional regression",
          "All accepted risks are documented"
        ])
      ],
      rollback: ["Use the previous release checkpoint until closure is approved"],
      estimatedEffortDays: 2,
      requiresApproval: true
    })
  );

  return Object.freeze(phases.map(deepFreeze));
}

function strategyForGap(area: string): ModernizationStrategy {
  if (area === "architecture") return "strangler-fig";
  if (area === "dependency" || area === "technology-stack") return "incremental-upgrade";
  if (area === "api" || area === "code") return "refactor";
  if (area === "database") return "replatform";
  return "retain";
}

function transformationsForGap(gapItem: ModernizationGap): readonly TransformationAction[] {
  const patterns = patternsForArea(gapItem.area);
  if (patterns.length === 0) {
    return Object.freeze([
      deepFreeze({
        id: `action-${gapItem.id}`,
        area: gapItem.area,
        description: gapItem.targetState,
        reversible: true,
        affectedAssets: []
      })
    ]);
  }
  return Object.freeze(patterns.slice(0, 2).map((pattern) => actionFromPattern(pattern, [])));
}

function validationForGap(gapItem: ModernizationGap): readonly FunctionalEquivalenceCheck[] {
  const verification =
    gapItem.area === "api"
      ? "contract-test"
      : gapItem.area === "database" || gapItem.area === "architecture"
        ? "integration-test"
        : "characterization-test";
  return Object.freeze([
    validationCheck(`validation-${gapItem.id}`, gapItem.title, verification, [
      "Existing behavior remains compatible",
      `${gapItem.targetState} is demonstrably satisfied`
    ])
  ]);
}

function validationCheck(
  id: string,
  scope: string,
  verification: FunctionalEquivalenceCheck["verification"],
  acceptanceCriteria: readonly string[]
): FunctionalEquivalenceCheck {
  return deepFreeze({ id, scope, verification, acceptanceCriteria });
}

function planMetrics(
  phases: readonly MigrationPhase[],
  assessment: LegacyAssessmentReport
): ModernizationMetrics {
  return deepFreeze({
    totalPhases: phases.length,
    estimatedEffortDays: phases.reduce((sum, phaseItem) => sum + phaseItem.estimatedEffortDays, 0),
    highRiskItems: assessment.riskProfile.filter(
      (riskItem) => riskItem.severity === "high" || riskItem.severity === "critical"
    ).length,
    reversibleTransformations: phases
      .flatMap((phaseItem) => phaseItem.transformations)
      .filter((action) => action.reversible).length,
    validationChecks: phases.reduce((sum, phaseItem) => sum + phaseItem.validation.length, 0),
    readinessScore: assessment.readinessScore
  });
}

function workflowFromPhases(name: string, phases: readonly MigrationPhase[]): WorkflowRequest {
  return deepFreeze({
    name,
    type: "modernization",
    phases: phases.map((phaseItem) => ({
      id: phaseItem.id,
      name: phaseItem.name,
      tasks: [
        {
          id: `${phaseItem.id}-prepare`,
          name: `Prepare ${phaseItem.name}`,
          dependsOn: phaseItem.prerequisites.map((prereq) => `${prereq}-validate`),
          requiresApproval: false
        },
        {
          id: `${phaseItem.id}-transform`,
          name: `Transform ${phaseItem.name}`,
          dependsOn: [`${phaseItem.id}-prepare`],
          requiresApproval: phaseItem.requiresApproval
        },
        {
          id: `${phaseItem.id}-validate`,
          name: `Validate ${phaseItem.name}`,
          dependsOn: [`${phaseItem.id}-transform`],
          requiresApproval: false
        }
      ]
    })),
    metadata: {
      source: "modernization-platform",
      totalPhases: phases.length
    }
  });
}

function gap(
  id: string,
  area: ModernizationGap["area"],
  title: string,
  currentState: string,
  targetState: string,
  priority: ModernizationSeverity,
  effort: ModernizationGap["effort"],
  evidence: readonly string[]
): ModernizationGap {
  return deepFreeze({ id, area, title, currentState, targetState, priority, effort, evidence });
}

function risk(
  id: string,
  area: ModernizationRisk["area"],
  description: string,
  severity: ModernizationSeverity,
  probability: number,
  impact: ModernizationSeverity,
  mitigation: readonly string[],
  evidence: readonly string[]
): ModernizationRisk {
  return deepFreeze({
    id,
    area,
    description,
    severity,
    probability: round(probability),
    impact,
    mitigation,
    evidence
  });
}

function phase(input: MigrationPhase): MigrationPhase {
  return deepFreeze(input);
}

function readinessCredits(metrics: LegacyAssessmentMetrics): number {
  return (
    (metrics.tests > 0 ? 8 : 0) +
    (metrics.documentation > 0 ? 5 : 0) +
    (metrics.buildDefinitions > 0 ? 5 : 0)
  );
}

function severityWeight(severity: ModernizationSeverity): number {
  switch (severity) {
    case "critical":
      return 4;
    case "high":
      return 3;
    case "medium":
      return 2;
    case "low":
      return 1;
  }
}

function heat(risks: readonly ModernizationRisk[], area: string): number {
  const scoped = risks.filter((risk) => risk.area === area);
  return Math.min(
    100,
    scoped.reduce((sum, risk) => sum + severityWeight(risk.severity) * risk.probability * 25, 0)
  );
}

function effortDays(effort: ModernizationGap["effort"], priority: ModernizationSeverity): number {
  const base = effort === "high" ? 8 : effort === "medium" ? 5 : 2;
  return base + Math.max(0, severityWeight(priority) - 2);
}

function scanCoverage(request: ModernizationRequest) {
  const expectedFiles = request.scanScope?.expectedFiles ?? request.repository.files.length;
  const indexedFiles = request.scanScope?.indexedFiles ?? request.repository.files.length;
  const analyzedFiles = Math.min(indexedFiles, request.repository.files.length);
  const excludedPaths = Object.freeze([...(request.scanScope?.excludedPaths ?? [])]);
  const complete =
    expectedFiles === indexedFiles && indexedFiles === request.repository.files.length;
  return deepFreeze({
    expectedFiles,
    analyzedFiles,
    excludedPaths,
    complete,
    coveragePercent: expectedFiles === 0 ? 100 : round((analyzedFiles / expectedFiles) * 100),
    evidence: Object.freeze([
      `${analyzedFiles} indexed file(s) assessed`,
      `${request.repository.dependencies.length} dependency edge(s) assessed`,
      `${request.repository.modules.length} module(s), ${request.repository.packages.length} package(s), and ${request.repository.projects.length} project(s) assessed`,
      excludedPaths.length
        ? `Explicit exclusions: ${excludedPaths.join(", ")}`
        : "No repository paths were reported as excluded"
    ])
  });
}

function recommendTechnologies(
  assessment: LegacyAssessmentReport
): readonly TechnologyRecommendation[] {
  const languages = assessment.technologyInventory
    .filter((item) => item.kind === "language")
    .map((item) => item.name.toLowerCase());
  const runtime = languages.some((language) => language.includes("java"))
    ? ["Java 21 LTS", "Java 25 LTS"]
    : languages.some((language) => language.includes("python"))
      ? ["Python 3.13", "Python 3.12"]
      : languages.some((language) => language.includes("c#"))
        ? [".NET 10 LTS", ".NET 8 LTS"]
        : ["Node.js 24 LTS", "Node.js 22 LTS"];
  const framework = languages.some((language) => language.includes("java"))
    ? ["Spring Boot 4", "Quarkus"]
    : languages.some((language) => language.includes("python"))
      ? ["FastAPI", "Django"]
      : languages.some((language) => language.includes("c#"))
        ? ["ASP.NET Core", "Minimal APIs"]
        : ["TypeScript", "NestJS"];
  const entries: Array<
    [TechnologyRecommendation["category"], string | undefined, readonly string[]]
  > = [
    ["runtime", languages[0], runtime],
    [
      "framework",
      assessment.technologyInventory.find((item) => item.kind === "framework")?.name,
      framework
    ],
    [
      "testing",
      assessment.metrics.tests ? "Existing test stack" : undefined,
      ["Characterization + contract tests", "Integration test harness"]
    ],
    ["delivery", undefined, ["Containerized CI/CD", "Platform-native deployment"]],
    ["observability", undefined, ["OpenTelemetry", "Vendor-native telemetry"]]
  ];
  return Object.freeze(
    entries.map(([category, currentTechnology, choices]) =>
      deepFreeze({
        id: `technology-${category}`,
        category,
        currentTechnology,
        recommendedTechnology: choices[0],
        alternatives: Object.freeze(choices.slice(1)),
        rationale: Object.freeze([
          `Fits the detected ${languages.join(", ") || "unknown"} ecosystem`,
          "Supports incremental migration and automated validation"
        ]),
        migrationNotes: Object.freeze([
          "Validate compatibility in an isolated phase",
          "Keep the previous runtime path available until acceptance checks pass"
        ]),
        confidence: currentTechnology || languages.length ? 0.78 : 0.55
      })
    )
  );
}

function specificationsFor(
  phases: readonly MigrationPhase[],
  target: TargetArchitecture,
  decision: ModernizationDecision | undefined,
  objectives: readonly string[] = [],
  constraints: readonly string[] = []
): readonly ModernizationSpecification[] {
  const technologies = decision
    ? Object.entries(decision.technologies).map(
        ([category, technology]) => `${category}: ${technology}`
      )
    : target.technologyPreferences;
  return Object.freeze(
    phases.map((phaseItem) =>
      deepFreeze({
        id: `spec-${phaseItem.id}`,
        title: phaseItem.name,
        scope: phaseItem.scope,
        technologyDecisions: Object.freeze([...technologies]),
        functionalRequirements: Object.freeze([
          ...phaseItem.goals.map(
            (goal) => `The modernized system shall ${goal.charAt(0).toLowerCase()}${goal.slice(1)}.`
          ),
          ...objectives.map((objective) => `Objective: ${objective}`)
        ]),
        nonFunctionalRequirements: Object.freeze([
          "Existing security controls and data compatibility shall not regress.",
          "Performance shall remain within the accepted baseline for critical paths.",
          "Changes shall remain observable and reversible until phase approval.",
          ...constraints.map((constraint) => `Constraint: ${constraint}`)
        ]),
        acceptanceCriteria: Object.freeze(
          phaseItem.validation.flatMap((check) => check.acceptanceCriteria)
        ),
        validation: Object.freeze(
          phaseItem.validation.map((check) => `${check.verification}: ${check.scope}`)
        ),
        rollout: Object.freeze([
          "Deploy behind a controlled release boundary",
          "Collect validation evidence",
          `Obtain approval: ${phaseItem.requiresApproval ? "required" : "not required"}`
        ]),
        rollback: phaseItem.rollback,
        traceability: Object.freeze([
          `phase:${phaseItem.id}`,
          ...phaseItem.risks.map((riskId) => `risk:${riskId}`),
          ...(decision ? [`proposal:${decision.proposalId}`] : [])
        ])
      })
    )
  );
}

function isTestPath(filePath: string): boolean {
  const normalized = filePath.toLowerCase();
  return (
    normalized.includes("/test/") ||
    normalized.includes("/tests/") ||
    normalized.endsWith(".test.ts") ||
    normalized.endsWith(".spec.ts") ||
    normalized.endsWith(".test.js") ||
    normalized.endsWith(".spec.js")
  );
}

function slug(value: string): string {
  return (
    value
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-|-$/g, "") || "item"
  );
}

function round(value: number): number {
  return Math.round(value * 100) / 100;
}

function clamp(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) return min;
  return Math.max(min, Math.min(max, value));
}

function deepFreeze<T>(value: T): T {
  if (value && typeof value === "object") {
    Object.freeze(value);
    for (const nested of Object.values(value as Record<string, unknown>)) {
      if (nested && typeof nested === "object" && !Object.isFrozen(nested)) {
        deepFreeze(nested);
      }
    }
  }
  return value;
}
