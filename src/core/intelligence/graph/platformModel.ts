export type KnowledgeNodeCategory =
  | "engineering"
  | "architecture"
  | "business"
  | "infrastructure"
  | "documentation"
  | "workflow"
  | "requirement"
  | "decision";

export type KnowledgeType =
  | "Repository"
  | "Workspace"
  | "System"
  | "Module"
  | "Package"
  | "Component"
  | "Service"
  | "API"
  | "Database"
  | "Configuration"
  | "Infrastructure"
  | "Build"
  | "Deployment"
  | "Test"
  | "Documentation"
  | "Class"
  | "Interface"
  | "Function"
  | "Library";

export type KnowledgeRelationshipType =
  | "Contains"
  | "Defines"
  | "Extends"
  | "Implements"
  | "Uses"
  | "References"
  | "Imports"
  | "DependsOn"
  | "Calls"
  | "Publishes"
  | "Consumes"
  | "Produces"
  | "Reads"
  | "Writes"
  | "Creates"
  | "Destroys"
  | "Owns"
  | "Exposes"
  | "Coordinates"
  | "Delegates"
  | "Aggregates"
  | "IsolatedFrom"
  | "CommunicatesWith"
  | "Documents";

export type KnowledgeLifecycle =
  "created" | "validated" | "active" | "updated" | "deprecated" | "archived";

export interface KnowledgeEvidence {
  readonly sourceAnalyzer: string;
  readonly repositoryEvidence: string;
  readonly discoveryMethod: string;
  readonly confidence: number;
  readonly timestamp: string;
}

export interface KnowledgeNode {
  readonly id: string;
  readonly type: KnowledgeType;
  readonly category: KnowledgeNodeCategory;
  readonly title: string;
  readonly description?: string;
  readonly metadata: Readonly<Record<string, unknown>>;
  readonly confidence: number;
  readonly version: number;
  readonly lifecycle: KnowledgeLifecycle;
  readonly evidence: readonly KnowledgeEvidence[];
}

export interface KnowledgeEdge {
  readonly id: string;
  readonly sourceId: string;
  readonly targetId: string;
  readonly relationship: KnowledgeRelationshipType;
  readonly confidence: number;
  readonly evidence: readonly KnowledgeEvidence[];
  readonly metadata: Readonly<Record<string, unknown>>;
  readonly version: number;
  readonly lifecycle: KnowledgeLifecycle;
}

export interface KnowledgePlatformGraph {
  readonly id: string;
  readonly repositoryId: string;
  readonly version: KnowledgeVersion;
  readonly nodes: readonly KnowledgeNode[];
  readonly edges: readonly KnowledgeEdge[];
}

export interface KnowledgeVersion {
  readonly id: string;
  readonly version: number;
  readonly parent?: string;
  readonly timestamp: string;
  readonly repositoryVersion: string;
}

export interface NodeQuery {
  readonly repositoryId?: string;
  readonly type?: KnowledgeType;
  readonly category?: KnowledgeNodeCategory;
  readonly title?: string;
  readonly minConfidence?: number;
}

export interface KnowledgeQuery extends NodeQuery {
  readonly text?: string;
  readonly limit?: number;
  readonly relationship?: KnowledgeRelationshipType;
  readonly includeEvidence?: boolean;
  readonly expandRelationships?: boolean;
}

export interface InferredKnowledge {
  readonly id: string;
  readonly repositoryId: string;
  readonly category: "structural" | "behavioral" | "architectural" | "business" | "quality";
  readonly statement: string;
  readonly nodeIds: readonly string[];
  readonly edgeIds: readonly string[];
  readonly confidence: number;
  readonly evidence: readonly KnowledgeEvidence[];
}

export interface KnowledgeRetrievalResult {
  readonly query: KnowledgeQuery;
  readonly nodes: readonly KnowledgeNode[];
  readonly relationships: readonly KnowledgeEdge[];
  readonly inferences: readonly InferredKnowledge[];
  readonly explanation: string;
  readonly versionId?: string;
}

export interface KnowledgeVersionDiff {
  readonly repositoryId: string;
  readonly fromVersion: string;
  readonly toVersion: string;
  readonly addedNodes: readonly KnowledgeNode[];
  readonly removedNodes: readonly KnowledgeNode[];
  readonly changedNodes: readonly KnowledgeNode[];
  readonly addedEdges: readonly KnowledgeEdge[];
  readonly removedEdges: readonly KnowledgeEdge[];
}

export interface KnowledgeQualityReport {
  readonly repositoryId: string;
  readonly versionId: string;
  readonly nodeCount: number;
  readonly edgeCount: number;
  readonly averageConfidence: number;
  readonly evidenceCoverage: number;
  readonly orphanNodes: readonly string[];
  readonly lowConfidenceNodes: readonly string[];
  readonly issues: readonly string[];
  readonly policy: {
    readonly minimumConfidence: number;
    readonly requireEvidence: boolean;
  };
}
