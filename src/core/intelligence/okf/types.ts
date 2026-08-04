/** Authoritative local OKF profile used by every Keystone intelligence projection. */
export const KEYSTONE_OKF_PROFILE_ID =
  "https://keystone.local/okf/profiles/repository-intelligence/v2";
export const KEYSTONE_OKF_PROFILE_VERSION = "2.1.0";

export type OkfConfidenceLevel = "observed" | "derived" | "inferred";
/** How a relationship was established, kept separate from confidence. */
export type OkfRelationshipOrigin =
  | "EXTRACTED"
  | "RESOLVED"
  | "INFERRED"
  | "AMBIGUOUS";
export type OkfLifecycle = "active" | "deprecated" | "deleted";
export type KeystoneKnowledgeKind =
  | "repository"
  | "workspace"
  | "file"
  | "module"
  | "package"
  | "service"
  | "symbol"
  | "api"
  | "data-entity"
  | "configuration"
  | "test"
  | "documentation"
  | "call-flow"
  | "data-flow"
  | "architecture-boundary"
  | "risk-area"
  | "change-impact"
  | "database"
  | "table"
  | "orm-entity"
  | "query"
  | "feature-flag"
  | "fixture"
  | "ci-cd"
  | "infrastructure"
  | "component"
  | "event"
  | "build-system"
  | "package-manager"
  | "route"
  | "controller"
  | "middleware"
  | "handler"
  | "repository"
  | "entity"
  | "migration"
  | "contract"
  | "message"
  | "consumer"
  | "producer";
export type KeystoneRelationshipKind =
  | "contains"
  | "defines"
  | "imports"
  | "depends-on"
  | "calls"
  | "reads"
  | "writes"
  | "exposes"
  | "implements"
  | "extends"
  | "tests"
  | "covers"
  | "configured-by"
  | "documented-by"
  | "flows-to"
  | "may-impact"
  | "maps-to"
  | "declares"
  | "references"
  | "returns"
  | "uses"
  | "injects"
  | "provides"
  | "handles"
  | "authorizes"
  | "validates"
  | "persists"
  | "migrates"
  | "publishes"
  | "subscribes";

export interface OkfSourceLocation {
  readonly workspaceRelativePath: string;
  readonly startLine?: number;
  readonly startColumn?: number;
  readonly endLine?: number;
  readonly endColumn?: number;
  readonly symbol?: string;
}
export interface OkfEvidence {
  readonly id: string;
  readonly extractor: string;
  readonly extractorVersion: string;
  readonly extractionRunId: string;
  readonly method: string;
  readonly ruleId?: string;
  readonly source: OkfSourceLocation;
  readonly sourceDigest?: string;
  readonly repositoryRevision?: string;
  readonly observedAt: string;
  readonly freshness: "current" | "stale";
}
export interface OkfProvenance {
  readonly extractionRunId: string;
  readonly extractor: string;
  readonly extractorVersion: string;
  readonly workspaceId: string;
  readonly repositoryRevision?: string;
  readonly observedAt: string;
  readonly evidenceIds: readonly string[];
}
export interface OkfConfidence {
  readonly score: number;
  readonly level: OkfConfidenceLevel;
  readonly rationale?: string;
}
export interface KeystoneKnowledgeUnit {
  readonly id: string;
  readonly profile: typeof KEYSTONE_OKF_PROFILE_ID;
  readonly profileVersion: typeof KEYSTONE_OKF_PROFILE_VERSION;
  readonly kind: KeystoneKnowledgeKind;
  readonly name: string;
  readonly description?: string;
  readonly canonicalKey: string;
  readonly properties: Readonly<Record<string, unknown>>;
  readonly confidence: OkfConfidence;
  readonly provenance: OkfProvenance;
  readonly lifecycle: OkfLifecycle;
  readonly firstSeenAt: string;
  readonly lastSeenAt: string;
  readonly createdAt: string;
  readonly updatedAt: string;
}
export interface KeystoneKnowledgeRelationship {
  readonly id: string;
  readonly profile: typeof KEYSTONE_OKF_PROFILE_ID;
  readonly profileVersion: typeof KEYSTONE_OKF_PROFILE_VERSION;
  readonly kind: KeystoneRelationshipKind;
  readonly sourceId: string;
  readonly targetId: string;
  readonly properties: Readonly<Record<string, unknown>>;
  readonly origin: OkfRelationshipOrigin;
  /** Location of the relationship assertion, when the extractor can provide it. */
  readonly sourceLocation?: OkfSourceLocation;
  /** Human-readable deterministic resolution note for cross-file or uncertain edges. */
  readonly resolutionExplanation?: string;
  readonly confidence: OkfConfidence;
  readonly provenance: OkfProvenance;
  readonly lifecycle: OkfLifecycle;
  readonly firstSeenAt: string;
  readonly lastSeenAt: string;
  readonly createdAt: string;
  readonly updatedAt: string;
}
export interface KeystoneKnowledgeObservation {
  readonly id: string;
  readonly profile: typeof KEYSTONE_OKF_PROFILE_ID;
  readonly profileVersion: typeof KEYSTONE_OKF_PROFILE_VERSION;
  readonly subjectId: string;
  readonly predicate: string;
  readonly value: unknown;
  readonly valueType: "string" | "number" | "boolean" | "object" | "array" | "null";
  readonly confidence: OkfConfidence;
  readonly provenance: OkfProvenance;
  readonly observedAt: string;
}
export interface KeystoneOkfManifest {
  readonly format: "keystone-okf";
  readonly formatVersion: 2;
  readonly profile: typeof KEYSTONE_OKF_PROFILE_ID;
  readonly profileVersion: typeof KEYSTONE_OKF_PROFILE_VERSION;
  readonly profileDigest: string;
  readonly workspaceId: string;
  readonly generatedAt: string;
  readonly extractionRunId: string;
  readonly parentExtractionRunId?: string;
  readonly repositoryRevision?: string;
  readonly validation: {
    readonly valid: true;
    readonly validatorVersion: string;
    readonly validatedAt: string;
  };
  readonly projections: {
    readonly graphVersion: number;
    readonly cpgBindingVersion: number;
    readonly searchVersion: number;
  };
  readonly counts: {
    readonly units: number;
    readonly relationships: number;
    readonly observations: number;
    readonly evidence: number;
    readonly active: number;
    readonly deleted: number;
  };
  readonly digests: Readonly<Record<string, string>>;
}
export interface KeystoneOkfSnapshot {
  readonly manifest: KeystoneOkfManifest;
  readonly units: readonly KeystoneKnowledgeUnit[];
  readonly relationships: readonly KeystoneKnowledgeRelationship[];
  readonly observations: readonly KeystoneKnowledgeObservation[];
  readonly evidence: readonly OkfEvidence[];
}

/** Stable provenance carried by derived background-analysis artifacts. */
export interface OkfCanonicalEvidenceEnvelope {
  readonly snapshotDigest: string;
  readonly extractionRunId: string;
  readonly unitIds: readonly string[];
  readonly relationshipIds: readonly string[];
  readonly evidenceIds: readonly string[];
  readonly paths: readonly string[];
  readonly generatedAt: string;
}
