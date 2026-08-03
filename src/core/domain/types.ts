import type { ContextPackage } from "../context/contextEngine";

export type IntentType =
  | "feature"
  | "bugfix"
  | "explain"
  | "test"
  | "refactor"
  | "modernization"
  | "security-review"
  | "performance-review"
  | "pr-summary"
  | "qa-analysis"
  | "unknown";

export type RouteKind = "graph-only" | "copilot" | "hybrid" | "human-review";

export type RiskLevel = "low" | "medium" | "high";

export type EvidenceSource =
  | "filesystem"
  | "regex"
  | "typescript-ast"
  | "typescript-checker"
  | "language-service"
  | "coverage"
  | "git"
  | "runtime"
  | "heuristic";

export interface EvidenceMetadata {
  source: EvidenceSource;
  confidence: number;
  evidencePath?: string;
  evidenceLine?: number;
  extractorVersion: string;
  stale?: boolean;
  warnings?: string[];
}

export interface DeveloperIntent {
  id: string;
  text: string;
  workspaceRoot: string;
  createdAt: string;
  filesHint?: string[];
}

export interface IntentAnalysis {
  intentType: IntentType;
  confidence: number;
  summary: string;
  keywords: string[];
  needsCodeChange: boolean;
  riskHints: string[];
}

export interface RouteStep {
  id: string;
  label: string;
  owner: "keystone" | "copilot" | "human";
  status: "pending" | "requires-approval" | "ready" | "complete";
  description: string;
}

export interface RouteDecision {
  selectedRoute: RouteKind;
  confidence: number;
  reason: string;
  steps: RouteStep[];
  estimatedTokenSaving: number;
  requiredApprovals: string[];
  risks: string[];
  fallbackPath: RouteKind;
}

export interface RepoFile {
  path: string;
  language: string;
  sizeBytes: number;
  lineCount: number;
  isTest: boolean;
  isGenerated: boolean;
  summary: string;
  /** Filesystem modification time recorded for fast incremental reuse. */
  modifiedTimeMs?: number;
  /** SHA-256 of exact file contents, used for incremental ingestion. */
  contentHash?: string;
  /** SHA-256 of extracted symbols, imports, and API signatures. */
  structuralHash?: string;
  evidence?: EvidenceMetadata;
  frameworkHints?: string[];
  ownershipHints?: string[];
  securitySensitiveAreas?: string[];
  performanceSensitivePaths?: string[];
  modernizationCandidates?: string[];
  /** Detected framework/persistence capabilities for this artifact. */
  technologyHints?: string[];
}

export interface CodeSymbol {
  name: string;
  kind: "function" | "class" | "interface" | "type" | "method" | "constant" | "route" | "unknown";
  filePath: string;
  line: number;
  exportStatus: "exported" | "local" | "unknown";
  evidence?: EvidenceMetadata;
}

export interface DependencyEdge {
  from: string;
  to: string;
  kind: "import" | "require" | "local" | "package";
  evidence?: EvidenceMetadata;
}

export interface TestMapping {
  testFile: string;
  targetFile?: string;
  confidence: number;
  reason: string;
  evidence?: EvidenceMetadata;
}

export interface ApiEndpoint {
  method: string;
  path: string;
  filePath: string;
  line: number;
  evidence?: EvidenceMetadata;
}

export interface ServiceNode {
  name: string;
  filePath: string;
  hints: string[];
  evidence?: EvidenceMetadata;
}

export interface SemanticCall {
  filePath: string;
  caller?: string;
  callee: string;
  line: number;
  /** Resolved declaration location when a project-aware semantic provider supplies it. */
  targetFilePath?: string;
  targetLine?: number;
  evidence?: EvidenceMetadata;
}
export interface ControlFlowFact {
  filePath: string;
  kind: string;
  line: number;
  evidence?: EvidenceMetadata;
}
export interface DataFlowFact {
  filePath: string;
  source: string;
  target: string;
  line: number;
  evidence?: EvidenceMetadata;
}
export interface TypeRelationshipFact {
  filePath: string;
  source: string;
  target: string;
  kind: "extends" | "implements";
  line: number;
  /** Resolved declaration location for cross-file type relationships. */
  targetFilePath?: string;
  targetLine?: number;
  evidence?: EvidenceMetadata;
}

export type EngineeringEntityKind =
  | "project"
  | "package"
  | "namespace"
  | "assembly"
  | "crate"
  | "build-target"
  | "external-package"
  | "controller"
  | "route"
  | "endpoint"
  | "middleware"
  | "guard"
  | "filter"
  | "interceptor"
  | "handler"
  | "repository"
  | "dao"
  | "entity"
  | "model"
  | "schema"
  | "database"
  | "table"
  | "column"
  | "relation"
  | "orm-entity"
  | "query"
  | "migration"
  | "configuration"
  | "environment-variable"
  | "feature-flag"
  | "contract"
  | "message"
  | "consumer"
  | "producer"
  | "job"
  | "worker"
  | "fixture"
  | "ci-cd"
  | "infrastructure"
  | "component"
  | "event"
  | "build-system"
  | "package-manager";

export interface TechnologyFingerprint {
  projectPath: string;
  name: string;
  languages: string[];
  runtimes: string[];
  frameworks: string[];
  persistence: string[];
  databases: string[];
  messaging: string[];
  contracts: string[];
  packageEcosystems: string[];
  buildSystems: string[];
  evidencePaths: string[];
  confidence: number;
}

export type EngineeringEntityRelationKind =
  | "contains"
  | "declares"
  | "reads"
  | "writes"
  | "depends-on"
  | "references"
  | "calls"
  | "returns"
  | "implements"
  | "extends"
  | "uses"
  | "injects"
  | "provides"
  | "configured-by"
  | "maps-to"
  | "flows-to"
  | "exposes"
  | "handles"
  | "authorizes"
  | "validates"
  | "persists"
  | "migrates"
  | "publishes"
  | "subscribes";

export interface EngineeringEntityRelation {
  kind: EngineeringEntityRelationKind;
  targetKind: EngineeringEntityKind;
  targetName: string;
  targetPath?: string;
}

export interface EngineeringEntityFact {
  kind: EngineeringEntityKind;
  name: string;
  filePath: string;
  line: number;
  properties: Record<string, unknown>;
  relations?: EngineeringEntityRelation[];
  evidence?: EvidenceMetadata;
}

/** A normalized relationship that can link any extracted entities, including across languages. */
export interface SemanticRelationshipFact {
  sourceKind: EngineeringEntityKind;
  sourceName: string;
  sourcePath?: string;
  targetKind: EngineeringEntityKind;
  targetName: string;
  targetPath?: string;
  kind: EngineeringEntityRelationKind;
  confidence: number;
  resolution: "exact" | "probable" | "ambiguous" | "unresolved";
  evidence: EvidenceMetadata;
}

export interface RepositoryLanguageSupport {
  id: string;
  label: string;
  files: number;
  baseline: "compiler" | "deterministic-structural" | "structural-artifact" | "universal-text";
  semanticProvider: "typescript-compiler" | "vscode-language-service" | "none";
  semanticFiles: number;
  deterministicFiles: number;
  failedSemanticFiles: number;
  capabilities: {
    symbols: boolean;
    definitions: boolean;
    references: boolean;
    implementations: boolean;
    calls: boolean;
    controlFlow: boolean;
    dataFlow: boolean;
    cpg: boolean;
  };
  warnings: string[];
}

export interface RepoIntelligence {
  workspaceRoot: string;
  indexedAt: string;
  files: RepoFile[];
  symbols: CodeSymbol[];
  dependencies: DependencyEdge[];
  tests: TestMapping[];
  apis: ApiEndpoint[];
  services: ServiceNode[];
  calls?: SemanticCall[];
  controlFlows?: ControlFlowFact[];
  dataFlows?: DataFlowFact[];
  typeRelationships?: TypeRelationshipFact[];
  engineeringEntities?: EngineeringEntityFact[];
  semanticRelationships?: SemanticRelationshipFact[];
  ownershipHints: string[];
  frameworkHints: string[];
  securitySensitiveAreas: string[];
  performanceSensitivePaths: string[];
  modernizationCandidates: string[];
  languageSupport?: RepositoryLanguageSupport[];
  projectFingerprints?: TechnologyFingerprint[];
  incrementalStats?: {
    reusedFiles: number;
    analyzedFiles: number;
  };
}

export interface RepoSkill {
  id: string;
  name: string;
  description: string;
  appliesToFiles: string[];
  appliesToKeywords: string[];
  guidance: string[];
  version: number;
  confidence: number;
  updatedAt: string;
}

export type ContextPacketSegmentKind = "summary" | "selected-intelligence" | "source-excerpts";

export interface ContextPacket {
  id: string;
  sequence: number;
  total: number;
  continuationToken?: string;
  segmentKinds: ContextPacketSegmentKind[];
  paths: string[];
  estimatedTokens: number;
}

export interface ContextPacketSegment {
  kind: ContextPacketSegmentKind;
  path?: string;
  content: string;
  estimatedTokens: number;
}

export interface ContextPacketPayload extends ContextPacket {
  segments: ContextPacketSegment[];
  content: string;
}

export type CorrectionPacketReason = "validation-failure" | "delegation-failure" | "manual";

export interface CorrectionPacket {
  id: string;
  taskId: string;
  reason: CorrectionPacketReason;
  createdAt: string;
  snapshotDigest: string;
  validation: {
    commands: string[];
    failures: string[];
    remediations: string[];
  };
  copilot: {
    captured: boolean;
    mode?: string;
    artifactPath?: string;
    responseExcerpt?: string;
  };
  canonical: {
    unitIds: string[];
    relationshipIds: string[];
    evidenceIds: string[];
    paths: string[];
  };
  changedPaths?: string[];
  affectedPaths?: string[];
  diffHash?: string;
  resolvedAt?: string;
  resolvedByValidation?: string[];
  selectedPaths: string[];
  prompt: string;
}

export interface ContextPack {
  id: string;
  taskSummary: string;
  routeDecision: RouteDecision;
  relevantFiles: RepoFile[];
  relevantSymbols: CodeSymbol[];
  relatedTests: TestMapping[];
  relatedApis: ApiEndpoint[];
  impactedServices: ServiceNode[];
  repoSkills: RepoSkill[];
  architectureConstraints: string[];
  qaExpectations: string[];
  securityConstraints: string[];
  performanceConstraints: string[];
  modernizationConstraints: string[];
  thingsToAvoid: string[];
  acceptanceCriteria: string[];
  copilotPrompt: string;
  estimatedRawTokens: number;
  estimatedPackedTokens: number;
  estimatedReductionPercent: number;
  /** Intent-ranked, evidence-backed excerpts included in the delegation prompt. */
  contextSections?: Array<{
    path: string;
    reason: string;
    content: string;
    estimatedTokens: number;
    sourceHash?: string;
    score?: number;
    evidence?: Array<{
      okfId?: string;
      kind: string;
      label: string;
      startLine?: number;
      endLine?: number;
    }>;
  }>;
  /** Compact OKF/graph intelligence digest passed to Copilot with the selected excerpts. */
  boundedIntelligence?: string;
  omittedContext?: Array<{ path: string; reason: string; estimatedTokens: number }>;
  contextPackets?: ContextPacket[];
  contextPacketPayloads?: ContextPacketPayload[];
  contextManifest?: {
    delegationTokenBudget: number;
    usedTokens: number;
    selectedFiles: number;
    omittedFiles: number;
    protectedFiles: number;
    traceableEvidence: number;
    packetCount?: number;
    packetIds?: string[];
    snapshotDigest?: string;
    generatedAt: string;
  };
  selectedContextTokens?: number;
  compressionTier?: "off" | "standard" | "aggressive";
  retrievalMetrics?: {
    mode: string;
    candidates: number;
    selectedFiles: number;
    lexicalEvidenceRate: number;
    graphEvidenceRate: number;
    intentTermCoverage: number;
    meanRetrievalScore: number;
    mappedTestRate: number;
    warnings: string[];
    cacheHit?: boolean;
    cpgFiles: number;
    cpgSymbols: number;
    cpgRelations: number;
  };
}

export interface QaAnalysis {
  impactedTests: TestMapping[];
  missingTestAreas: string[];
  recommendedTests: string[];
  checklist: string[];
  coverageConfidence: number;
  regressionNeeds: string[];
  copilotFeedbackPrompt: string;
  flakyTests?: FlakyTest[];
  repairProposals?: TestRepairProposal[];
  quarantineEntries?: QuarantineEntry[];
  approvalGates?: ApprovalGate[];
}

export interface SecurityAnalysis {
  riskLevel: RiskLevel;
  sensitiveAreas: string[];
  checklist: string[];
  acceptanceCriteria: string[];
  prNotes: string[];
  copilotFixPrompts: string[];
}

export interface PerformanceAnalysis {
  riskLevel: RiskLevel;
  sensitivePaths: string[];
  checklist: string[];
  benchmarkSuggestions: string[];
  acceptanceCriteria: string[];
  prNotes: string[];
  copilotFixPrompts: string[];
}

export interface ModernizationAssessment {
  riskLevel: RiskLevel;
  candidates: string[];
  behaviorMapping: string[];
  safetyRequirements: string[];
  phasedPlan: string[];
  requiresApproval: boolean;
  copilotReadyTasks: string[];
}

export interface PrEvidence {
  markdown: string;
  changedSummary: string;
  route: RouteDecision;
  filesImpacted: string[];
  testsImpacted: string[];
  risks: string[];
  assumptions: string[];
}

export interface KeystoneMetrics {
  taskId: string;
  intentType: IntentType;
  selectedRoute: RouteKind;
  copilotRecommended: boolean;
  copilotPromptGenerated: boolean;
  estimatedRawTokens: number;
  estimatedPackedTokens: number;
  estimatedTokenReductionPercentage: number;
  contextPackSize: number;
  filesIncluded: number;
  filesExcluded: number;
  qaConfidence: number;
  impactedTestsCount: number;
  missingTestAreasCount: number;
  securityRiskLevel: RiskLevel;
  performanceRiskLevel: RiskLevel;
  modernizationRiskLevel: RiskLevel;
  prEvidenceGenerated: boolean;
  userApprovedRoute: boolean;
  userCopiedPrompt: boolean;
  userRegeneratedContext: boolean;
  createdAt: string;
}

export interface KeystoneRunResult {
  intent: DeveloperIntent;
  intentAnalysis: IntentAnalysis;
  routeDecision: RouteDecision;
  intelligence: RepoIntelligence;
  contextPack: ContextPack;
  contextPackage: ContextPackage;
  qa: QaAnalysis;
  security: SecurityAnalysis;
  performance: PerformanceAnalysis;
  modernization: ModernizationAssessment;
  prEvidence: PrEvidence;
  metrics: KeystoneMetrics;
}

// ─── QA Agent Types ────────────────────────────────────────────────────────────

export type QAAgentCommand =
  | "discover-tests"
  | "generate-tests"
  | "detect-flaky"
  | "repair-tests"
  | "run-impact"
  | "execute-tests"
  | "quarantine";

export interface QAContext {
  workspaceRoot: string;
  baseRef?: string;
  changedFiles?: string[];
  requirements?: string;
  sourceFiles?: string[];
  applyPolicy: "auto" | "ask" | "dry-run";
  cancellation?: any;
}

export interface QAAgentMetrics {
  totalTests: number;
  impactedCount: number;
  flakyCount: number;
  coverageRatio: number;
  riskLevel: "low" | "medium" | "high" | "critical";
}

export interface FlakyTest {
  testPath: string;
  testName: string;
  flakinessScore: number;
  failures: number;
  totalRuns: number;
  lastFailure: string;
  classification: "BROKEN_LOCATOR" | "REAL_BUG" | "FLAKY" | "ENV_ISSUE";
}

export interface TestRepairProposal {
  testPath: string;
  testName: string;
  failureMessage: string;
  failureType: "BROKEN_LOCATOR" | "REAL_BUG" | "FLAKY" | "ENV_ISSUE";
  proposedFix: string;
  confidence: number;
  requiresApproval: boolean;
}

export interface TestRepairResult {
  proposals: TestRepairProposal[];
  appliedFixes: string[];
  failures: string[];
}

export interface QuarantineEntry {
  testPath: string;
  testName: string;
  reason: string;
  quarantinedAt: number;
  quarantinedBy: string;
  severity: "high" | "medium" | "low";
  autoQuarantine: boolean;
}

export interface GeneratedTest {
  testPath: string;
  testName: string;
  testLayer: "unit" | "api" | "component" | "e2e";
  source: string;
  requiresApproval: boolean;
}

export interface ApprovalGate {
  id: string;
  type: "test-repair" | "test-deletion" | "test-generation" | "quarantine";
  description: string;
  riskLevel: "low" | "medium" | "high" | "critical";
  changes: string[];
  requiresApproval: boolean;
  status: "pending" | "approved" | "rejected" | "auto-approved";
  approvedBy?: string;
  approvedAt?: number;
  rejectionReason?: string;
}

export interface TestExecutionResult {
  command: string;
  exitCode: number;
  durationMs: number;
  passed: number;
  failed: number;
  skipped: number;
  output: string;
}

/** ValueEdge API configuration. */
export interface ValueEdgeConfig {
  baseUrl: string;
  clientId: string;
  sharedSpaceUid: string;
  workspaceId: string;
  /** Enable strict TLS certificate verification (default: true). Set false only for self-signed certs in enterprise environments. */
  strictTls?: boolean;
}

export interface QAReport {
  command: QAAgentCommand;
  status: "success" | "warning" | "failed";
  summary: string;
  impactedTests?: string[];
  generatedTests?: GeneratedTest[];
  flakyTests?: FlakyTest[];
  repairProposals?: TestRepairProposal[];
  quarantine?: QuarantineEntry[];
  executionResult?: TestExecutionResult;
  approvalRequired?: ApprovalGate[];
  metrics: QAAgentMetrics;
}
