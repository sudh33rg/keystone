/**
 * Canonical domain contracts from docs/00-foundation.
 *
 * These types are platform-neutral and should be used at platform boundaries,
 * public APIs, events, persistence records, and generated engineering artifacts.
 */

export type KeystonePlatform =
  | "platform-services"
  | "repository"
  | "knowledge"
  | "context"
  | "reasoning"
  | "workflow"
  | "modernization"
  | "documentation"
  | "ai"
  | "observability"
  | "security"
  | "data"
  | "storage"
  | "execution"
  | "enterprise"
  | "analytics"
  | "testing-quality"
  | "deployment-operations"
  | "plugin-marketplace"
  | "engineering-standards"
  | "engineering"
  | "experience"
  | "plugin";

export type LifecycleState =
  "discovered" | "validated" | "active" | "updated" | "modified" | "deprecated" | "archived";

export type ConfidenceScore = number;

export type Metadata = Readonly<Record<string, unknown>>;

export interface RepositoryReference {
  readonly id: string;
  readonly name?: string;
  readonly provider?: string;
  readonly branch?: string;
  readonly revision?: string;
  readonly workspace?: string;
  readonly languages?: readonly string[];
  readonly technologies?: readonly string[];
  readonly metadata: Metadata;
}

export interface AuditInformation {
  readonly createdBy?: string;
  readonly updatedBy?: string;
  readonly createdAt: string;
  readonly updatedAt: string;
  readonly correlationId?: string;
  readonly traceId?: string;
}

export interface VersionRecord {
  readonly version: string;
  readonly timestamp: string;
  readonly changes: readonly string[];
  readonly author?: string;
  readonly evidence: readonly string[];
  readonly repositoryRevision?: string;
  readonly reason?: string;
}

export interface CanonicalEntity {
  readonly id: string;
  readonly version: string;
  readonly createdAt: string;
  readonly updatedAt: string;
  readonly source: string;
  readonly owner: KeystonePlatform | string;
  readonly metadata: Metadata;
  readonly relationships: readonly RelationshipReference[];
  readonly lifecycle: LifecycleState;
  readonly audit: AuditInformation;
}

export type EvidenceSource =
  | "source-code"
  | "git-history"
  | "documentation"
  | "configuration"
  | "runtime-analysis"
  | "generated-artifact"
  | "user-validation"
  | "manual-annotation"
  | "repository"
  | "architecture-decision";

export interface DomainEvidence extends CanonicalEntity {
  readonly evidenceType: EvidenceSource;
  readonly location?: string;
  readonly repository?: RepositoryReference;
  readonly content?: string;
  readonly strength: ConfidenceScore;
  readonly schemaVersion: string;
}

export type RelationKind =
  | "DEPENDS_ON"
  | "USES"
  | "IMPLEMENTS"
  | "EXTENDS"
  | "OWNS"
  | "CALLS"
  | "CONTAINS"
  | "GENERATES"
  | "READS"
  | "WRITES"
  | "PUBLISHES"
  | "SUBSCRIBES"
  | "DEPLOYS_TO"
  | "CONFIGURES"
  | "VALIDATES"
  | "DOCUMENTS"
  | "TESTS"
  | "REPLACES"
  | "SUPERSEDES"
  | "RELATED_TO"
  | "CONFLICTS_WITH"
  | "SUPPORTS"
  | "CONSUMES"
  | "PRODUCES";

export interface RelationshipReference {
  readonly id: string;
  readonly type: RelationKind | string;
  readonly targetId: string;
}

export interface EngineeringRelationship extends CanonicalEntity {
  readonly relationshipType: RelationKind | string;
  readonly sourceAssetId: string;
  readonly targetAssetId: string;
  readonly evidence: readonly DomainEvidence[];
  readonly confidence: ConfidenceScore;
  readonly schemaVersion: string;
}

export type EngineeringAssetCategory =
  "repository" | "architecture" | "application" | "infrastructure" | "engineering" | "knowledge";

export type EngineeringAssetStatus =
  "discovered" | "validated" | "active" | "modified" | "deprecated" | "archived";

export type EngineeringAssetType =
  | "Repository"
  | "Workspace"
  | "Solution"
  | "Package"
  | "Module"
  | "Project"
  | "SourceFolder"
  | "ResourceFolder"
  | "Architecture"
  | "Layer"
  | "Boundary"
  | "Component"
  | "Service"
  | "Gateway"
  | "Adapter"
  | "Port"
  | "Aggregate"
  | "Domain"
  | "Context"
  | "Feature"
  | "Capability"
  | "Workflow"
  | "BusinessProcess"
  | "API"
  | "Event"
  | "Message"
  | "Command"
  | "Query"
  | "Database"
  | "Queue"
  | "Cache"
  | "Storage"
  | "Container"
  | "KubernetesDeployment"
  | "ServiceMesh"
  | "Network"
  | "Secret"
  | "Configuration"
  | "Specification"
  | "ADR"
  | "Plan"
  | "Task"
  | "Review"
  | "TestStrategy"
  | "MigrationPlan"
  | "ArchitectureReport"
  | "Documentation"
  | "RepositorySummary"
  | "ArchitectureSummary"
  | "TechnologySummary"
  | "DependencyAnalysis"
  | "HistoricalAnalysis"
  | "TechnicalDebtAssessment"
  | "RiskAssessment";

export interface EngineeringAsset extends Omit<CanonicalEntity, "lifecycle"> {
  readonly schemaVersion: string;
  readonly type: EngineeringAssetType | string;
  readonly category: EngineeringAssetCategory;
  readonly name: string;
  readonly displayName: string;
  readonly description: string;
  readonly status: EngineeringAssetStatus;
  readonly repository?: RepositoryReference;
  readonly tags: readonly string[];
  readonly confidence: ConfidenceScore;
  readonly evidence: readonly DomainEvidence[];
  readonly history: readonly VersionRecord[];
}

export interface EngineeringFact extends CanonicalEntity {
  readonly factType: string;
  readonly location?: string;
  readonly repository: RepositoryReference;
  readonly observedAt: string;
  readonly schemaVersion: string;
}

export interface EngineeringKnowledge extends CanonicalEntity {
  readonly knowledgeId: string;
  readonly asset: EngineeringAsset;
  readonly evidence: readonly DomainEvidence[];
  readonly confidence: ConfidenceScore;
  readonly reasoning: readonly string[];
  readonly source: string;
  readonly schemaVersion: string;
}

export interface Alternative {
  readonly id: string;
  readonly title: string;
  readonly description: string;
  readonly evidence: readonly DomainEvidence[];
  readonly tradeoffs: readonly string[];
  readonly confidence: ConfidenceScore;
}

export interface EngineeringIntelligence extends CanonicalEntity {
  readonly intelligenceType: string;
  readonly knowledge: readonly EngineeringKnowledge[];
  readonly evidence: readonly DomainEvidence[];
  readonly reasoning: readonly string[];
  readonly confidence: ConfidenceScore;
  readonly alternatives: readonly Alternative[];
  readonly tradeoffs: readonly string[];
  readonly recommendations: readonly Recommendation[];
  readonly schemaVersion: string;
}

export type ArtifactType =
  | "ImplementationPlan"
  | "ArchitectureReport"
  | "ADR"
  | "Documentation"
  | "MigrationStrategy"
  | "Review"
  | "TestStrategy"
  | "ModernizationPlan"
  | "RiskAssessment"
  | "Specification";

export interface EngineeringArtifact extends CanonicalEntity {
  readonly artifactType: ArtifactType | string;
  readonly title: string;
  readonly description: string;
  readonly contentLocation?: string;
  readonly evidence: readonly DomainEvidence[];
  readonly reproducibility: {
    readonly inputs: readonly string[];
    readonly commands: readonly string[];
    readonly generatedAt: string;
  };
  readonly approvalState: "draft" | "pending" | "approved" | "rejected" | "superseded";
  readonly schemaVersion: string;
}

export type RecommendationType =
  | "architecture"
  | "planning"
  | "performance"
  | "security"
  | "testing"
  | "maintainability"
  | "documentation"
  | "modernization"
  | "reliability"
  | "developer-experience";

export interface Recommendation extends CanonicalEntity {
  readonly recommendationType: RecommendationType | string;
  readonly title: string;
  readonly description: string;
  readonly priority: "low" | "medium" | "high" | "critical";
  readonly confidence: ConfidenceScore;
  readonly risk: "low" | "medium" | "high" | "critical";
  readonly impact: string;
  readonly estimatedEffort: "low" | "medium" | "high";
  readonly expectedBenefit: string;
  readonly dependencies: readonly string[];
  readonly validationStrategy: readonly string[];
  readonly evidence: readonly DomainEvidence[];
  readonly assumptions: readonly string[];
  readonly alternatives: readonly Alternative[];
  readonly tradeoffs: readonly string[];
  readonly affectedAssets: readonly string[];
  readonly schemaVersion: string;
}

export interface CanonicalDecision extends CanonicalEntity {
  readonly title: string;
  readonly conclusion: string;
  readonly evidence: readonly DomainEvidence[];
  readonly reasoning: readonly string[];
  readonly alternatives: readonly Alternative[];
  readonly tradeoffs: readonly string[];
  readonly confidence: ConfidenceScore;
  readonly approvalState: "draft" | "proposed" | "approved" | "rejected" | "superseded";
  readonly author: string;
  readonly decidedAt: string;
  readonly schemaVersion: string;
}

export interface Constraint extends CanonicalEntity {
  readonly constraintType:
    | "business"
    | "technology"
    | "repository"
    | "architecture"
    | "security"
    | "compliance"
    | "performance"
    | string;
  readonly description: string;
  readonly severity: "low" | "medium" | "high" | "critical";
  readonly evidence: readonly DomainEvidence[];
  readonly schemaVersion: string;
}

export interface Risk extends CanonicalEntity {
  readonly riskType:
    | "migration"
    | "architecture"
    | "dependency"
    | "performance"
    | "operational"
    | "security"
    | string;
  readonly description: string;
  readonly probability: ConfidenceScore;
  readonly impact: "low" | "medium" | "high" | "critical";
  readonly severity: "low" | "medium" | "high" | "critical";
  readonly mitigation: readonly string[];
  readonly evidence: readonly DomainEvidence[];
  readonly status: "open" | "mitigated" | "accepted" | "closed";
  readonly schemaVersion: string;
}

export interface Workflow extends CanonicalEntity {
  readonly status: "pending" | "running" | "paused" | "completed" | "failed" | "cancelled";
  readonly currentStep?: string;
  readonly inputs: Metadata;
  readonly outputs: Metadata;
  readonly participants: readonly string[];
  readonly artifacts: readonly EngineeringArtifact[];
  readonly executionHistory: readonly VersionRecord[];
  readonly metrics: Metadata;
  readonly schemaVersion: string;
}
