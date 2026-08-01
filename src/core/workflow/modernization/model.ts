import type { RepositoryModel } from '../../intelligence/repository/model';
import type { KnowledgePlatformGraph } from '../../intelligence/graph/platformModel';
import type { ExecutionHandle, WorkflowRequest } from '../orchestration/model';
import type { TaskWorkspaceRef } from '../tasks/taskWorkspaceManager';

export type ModernizationSeverity = 'low' | 'medium' | 'high' | 'critical';
export type ModernizationStrategy =
  | 'rehost'
  | 'replatform'
  | 'refactor'
  | 'rearchitect'
  | 'replace'
  | 'retain'
  | 'retire'
  | 'strangler-fig'
  | 'incremental-upgrade';

export type ModernizationArea =
  | 'architecture'
  | 'business-capability'
  | 'dependency'
  | 'api'
  | 'database'
  | 'code'
  | 'security'
  | 'testing'
  | 'operations'
  | 'documentation'
  | 'technology-stack';

export interface ModernizationRequest {
  readonly repository: RepositoryModel;
  readonly knowledgeGraph?: KnowledgePlatformGraph;
  readonly objectives?: readonly string[];
  readonly targetArchitecture?: TargetArchitecture;
  readonly constraints?: readonly ModernizationConstraint[];
  /** Optional index evidence used to prove that discovery covered the target repository. */
  readonly scanScope?: RepositoryScanScope;
}

export interface RepositoryScanScope {
  readonly expectedFiles: number;
  readonly indexedFiles: number;
  readonly excludedPaths?: readonly string[];
}

export interface RepositoryScanCoverage {
  readonly expectedFiles: number;
  readonly analyzedFiles: number;
  readonly excludedPaths: readonly string[];
  readonly complete: boolean;
  readonly coveragePercent: number;
  readonly evidence: readonly string[];
}

export interface ModernizationConstraint {
  readonly id: string;
  readonly description: string;
  readonly severity: ModernizationSeverity;
}

export interface LegacyAssessmentReport {
  readonly id: string;
  readonly repositoryId: string;
  readonly generatedAt: string;
  readonly technicalDebtScore: number;
  readonly complexityScore: number;
  readonly readinessScore: number;
  readonly riskProfile: readonly ModernizationRisk[];
  readonly technologyInventory: readonly TechnologyInventoryItem[];
  readonly metrics: LegacyAssessmentMetrics;
  readonly recommendations: readonly string[];
  readonly evidence: readonly string[];
}

export interface LegacyAssessmentMetrics {
  readonly files: number;
  readonly languages: number;
  readonly dependencies: number;
  readonly frameworks: number;
  readonly tests: number;
  readonly documentation: number;
  readonly buildDefinitions: number;
  readonly averageFileLines: number;
  readonly maxFileLines: number;
}

export interface TechnologyInventoryItem {
  readonly name: string;
  readonly kind: 'language' | 'framework' | 'dependency' | 'build' | 'database' | 'unknown';
  readonly version?: string;
  readonly evidence: readonly string[];
}

export interface BusinessCapability {
  readonly id: string;
  readonly name: string;
  readonly parentId?: string;
  readonly assets: readonly string[];
  readonly criticality: ModernizationSeverity;
  readonly confidence: number;
}

export interface ArchitectureDiscovery {
  readonly id: string;
  readonly repositoryId: string;
  readonly style: 'modular-monolith' | 'layered' | 'service-oriented' | 'event-driven' | 'unknown';
  readonly components: readonly ArchitectureComponent[];
  readonly boundaries: readonly ArchitectureBoundary[];
  readonly evidence: readonly string[];
  readonly confidence: number;
}

export interface ArchitectureComponent {
  readonly id: string;
  readonly name: string;
  readonly kind: 'module' | 'package' | 'service' | 'api' | 'database' | 'library';
  readonly assets: readonly string[];
  readonly dependencies: readonly string[];
}

export interface ArchitectureBoundary {
  readonly id: string;
  readonly name: string;
  readonly assets: readonly string[];
  readonly risk: ModernizationSeverity;
}

export interface TargetArchitecture {
  readonly id: string;
  readonly name: string;
  readonly style: ArchitectureDiscovery['style'] | 'microservices' | 'serverless';
  readonly principles: readonly string[];
  readonly technologyPreferences: readonly string[];
}

export interface TargetArchitectureRecommendation {
  readonly target: TargetArchitecture;
  readonly score: number;
  readonly tradeoffs: {
    readonly migrationCost: ModernizationSeverity;
    readonly operationalRisk: ModernizationSeverity;
    readonly businessRisk: ModernizationSeverity;
    readonly reversibility: ModernizationSeverity;
  };
  readonly rationale: readonly string[];
}

export interface TechnologyRecommendation {
  readonly id: string;
  readonly category: 'runtime' | 'framework' | 'data' | 'testing' | 'delivery' | 'observability';
  readonly currentTechnology?: string;
  readonly recommendedTechnology: string;
  readonly alternatives: readonly string[];
  readonly rationale: readonly string[];
  readonly migrationNotes: readonly string[];
  readonly confidence: number;
}

export interface ModernizationProposal {
  readonly id: string;
  readonly repositoryId: string;
  readonly generatedAt: string;
  readonly status: 'awaiting-user-decision';
  readonly scanCoverage: RepositoryScanCoverage;
  readonly assessment: LegacyAssessmentReport;
  readonly architecture: ArchitectureDiscovery;
  readonly capabilities: readonly BusinessCapability[];
  readonly objectives: readonly string[];
  readonly constraints: readonly ModernizationConstraint[];
  readonly gaps: readonly ModernizationGap[];
  readonly architectureRecommendations: readonly TargetArchitectureRecommendation[];
  readonly technologyRecommendations: readonly TechnologyRecommendation[];
  readonly questions: readonly string[];
}

export interface ModernizationDecisionInput {
  readonly accepted: boolean;
  readonly selectedTargetId?: string;
  readonly customTarget?: TargetArchitecture;
  readonly acceptedTechnologies?: Readonly<Record<string, string>>;
  readonly notes?: readonly string[];
}

export interface ModernizationDecision {
  readonly proposalId: string;
  readonly acceptedAt: string;
  readonly source: 'keystone-recommendation' | 'user-defined';
  readonly targetArchitecture: TargetArchitecture;
  readonly technologies: Readonly<Record<string, string>>;
  readonly notes: readonly string[];
}

export interface ModernizationSpecification {
  readonly id: string;
  readonly title: string;
  readonly scope: readonly string[];
  readonly technologyDecisions: readonly string[];
  readonly functionalRequirements: readonly string[];
  readonly nonFunctionalRequirements: readonly string[];
  readonly acceptanceCriteria: readonly string[];
  readonly validation: readonly string[];
  readonly rollout: readonly string[];
  readonly rollback: readonly string[];
  readonly traceability: readonly string[];
}

export interface ModernizationGap {
  readonly id: string;
  readonly area: ModernizationArea;
  readonly title: string;
  readonly currentState: string;
  readonly targetState: string;
  readonly priority: ModernizationSeverity;
  readonly effort: 'low' | 'medium' | 'high';
  readonly evidence: readonly string[];
}

export interface ModernizationRisk {
  readonly id: string;
  readonly area: ModernizationArea;
  readonly description: string;
  readonly severity: ModernizationSeverity;
  readonly probability: number;
  readonly impact: ModernizationSeverity;
  readonly mitigation: readonly string[];
  readonly evidence: readonly string[];
}

export interface ModernizationImpact {
  readonly planId: string;
  readonly impactedAssets: readonly string[];
  readonly riskHeatMap: {
    readonly architecture: number;
    readonly repository: number;
    readonly business: number;
    readonly technology: number;
    readonly migration: number;
    readonly operational: number;
  };
  readonly mitigations: readonly string[];
}

export interface FunctionalEquivalenceCheck {
  readonly id: string;
  readonly scope: string;
  readonly verification: 'characterization-test' | 'contract-test' | 'integration-test' | 'manual-review';
  readonly acceptanceCriteria: readonly string[];
}

export interface MigrationPhase {
  readonly id: string;
  readonly name: string;
  readonly strategy: ModernizationStrategy;
  readonly order: number;
  readonly goals: readonly string[];
  readonly scope: readonly string[];
  readonly prerequisites: readonly string[];
  readonly risks: readonly string[];
  readonly transformations: readonly TransformationAction[];
  readonly validation: readonly FunctionalEquivalenceCheck[];
  readonly rollback: readonly string[];
  readonly estimatedEffortDays: number;
  readonly requiresApproval: boolean;
}

export interface TransformationAction {
  readonly id: string;
  readonly area: ModernizationArea;
  readonly description: string;
  readonly reversible: boolean;
  readonly affectedAssets: readonly string[];
}

export interface ModernizationPlan {
  readonly id: string;
  readonly repositoryId: string;
  readonly generatedAt: string;
  readonly strategy: ModernizationStrategy;
  readonly assessmentId: string;
  readonly targetArchitecture: TargetArchitecture;
  readonly capabilities: readonly BusinessCapability[];
  readonly gaps: readonly ModernizationGap[];
  readonly phases: readonly MigrationPhase[];
  readonly risks: readonly ModernizationRisk[];
  readonly metrics: ModernizationMetrics;
  readonly workflowRequest: WorkflowRequest;
  readonly decision?: ModernizationDecision;
  readonly specifications: readonly ModernizationSpecification[];
  readonly execution?: ExecutionHandle;
  /** Numbered, temporary Keystone workspace materialized after user acceptance. */
  readonly taskWorkspace?: TaskWorkspaceRef;
}

export interface ModernizationMetrics {
  readonly totalPhases: number;
  readonly estimatedEffortDays: number;
  readonly highRiskItems: number;
  readonly reversibleTransformations: number;
  readonly validationChecks: number;
  readonly readinessScore: number;
}

export interface ModernizationCostEstimate {
  readonly planId: string;
  readonly engineeringDays: number;
  readonly validationDays: number;
  readonly reviewDays: number;
  readonly totalDays: number;
  readonly complexityMultiplier: number;
  readonly assumptions: readonly string[];
}

export interface ModernizationExecutionStatus {
  readonly planId: string;
  readonly completedPhases: readonly string[];
  readonly activePhase?: string;
  readonly percentComplete: number;
  readonly remainingEffortDays: number;
  readonly blocked: boolean;
  readonly issues: readonly string[];
}

export interface ModernizationGovernanceReport {
  readonly planId: string;
  readonly approved: boolean;
  readonly requiredApprovals: readonly string[];
  readonly policyViolations: readonly string[];
  readonly auditEvidence: readonly string[];
}

export interface ModernizationValidationReport {
  readonly planId: string;
  readonly valid: boolean;
  readonly blockers: readonly string[];
  readonly warnings: readonly string[];
  readonly requiredApprovals: readonly string[];
}

export interface ModernizationPlatformStats {
  readonly assessments: number;
  readonly plans: number;
  readonly averageReadinessScore: number;
  readonly openHighRiskItems: number;
}
