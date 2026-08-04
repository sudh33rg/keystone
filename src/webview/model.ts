export type Nav = "Home" | "Intelligence" | "Work" | "Activity";
export type StoryStatus =
  | "draft"
  | "ready"
  | "in-progress"
  | "awaiting-delegation-approval"
  | "delegated"
  | "awaiting-validation"
  | "review-required"
  | "completed"
  | "blocked"
  | "paused"
  | "cancelled"
  | "superseded"
  | "handed-off";
export interface EvidenceItem {
  id?: string;
  kind: string;
  label: string;
  path?: string;
  line?: number;
  startLine?: number;
  endLine?: number;
  entityId?: string;
  relationshipId?: string;
  evidenceId?: string;
  okfId?: string;
  confidence?: number;
  summary?: string;
  reason?: string;
  provenance?: string;
  source?: "context-package" | "copilot-assertion";
  verifiedAgainstContext?: boolean;
  score?: number;
  evidenceIds?: string[];
  relationshipPath?: string[];
}
export interface LanguageCapability {
  id: string;
  label: string;
  level: string;
  extensions: readonly string[];
  files?: number;
  baseline?: string;
  semanticProvider?: string;
  semanticFiles?: number;
  deterministicFiles?: number;
  failedSemanticFiles?: number;
  capabilities?: Record<string, boolean>;
  warnings?: readonly string[];
  frontend?: string;
}
export interface OkfSummary {
  profile: string;
  version: string;
  extractionRunId: string;
  units: number;
  relationships: number;
  observations: number;
  evidence: number;
  active: number;
  deleted: number;
  graphNodes: number;
  graphEdges: number;
  cpgBindings: number;
  validated: boolean;
  portableBundle?: {
    path: string;
    conceptFiles: number;
    validated: boolean;
    profile: string;
    generatedAt: string;
  };
  evidenceSamples: Array<{ id: string; path: string; method: string; observedAt: string }>;
}
export interface IntelligenceSummary {
  fileCount?: number;
  querySuggestions?: string[];
  projectTypes?: string[];
  projectFingerprints?: Array<{
    projectPath: string;
    name: string;
    languages: string[];
    frameworks: string[];
    persistence: string[];
    databases: string[];
    messaging: string[];
    contracts: string[];
    confidence: number;
  }>;
  architecture?: string;
  git?: { branch?: string; changedFiles?: string[] };
  languageCapabilities?: LanguageCapability[];
  universalTextFiles?: number;
  okf?: OkfSummary;
  stages?: Array<{
    id: string;
    label: string;
    status: string;
    progress?: number;
    itemCount?: number;
    durationMs?: number;
  }>;
  families?: Array<{ id: string; label: string; status?: string; itemCount?: number }>;
}
export interface ContextSection {
  path: string;
  reason: string;
  preview: string;
  estimatedTokens: number;
  score?: number;
  evidence?: EvidenceItem[];
}
export interface ContextPackageSummary {
  id: string;
  operation: string;
  tokenBudget: number;
  estimatedTransmittedTokens: number;
  allCandidateCount: number;
  selectedCandidateCount: number;
  transmittedCandidateCount: number;
  retainedCandidateCount: number;
  omittedContextCount: number;
  sourceRevision: string;
  sourceCounts: Array<{
    category: string;
    label: string;
    count: number;
    included: boolean;
  }>;
  candidates: Array<{
    id: string;
    category: string;
    sourceType: string;
    label: string;
    path?: string;
    relevance: number;
    estimatedTokenCost: number;
    evidence: EvidenceItem[];
    expandable: boolean;
    compressed: boolean;
    contextReference: string;
    reason: string;
    provenance?: {
      authoritativePath?: string;
      sourceHash?: string;
      sourceRevision: string;
      ranges: EvidenceItem[];
    };
  }>;
  retainedCandidates?: Array<{
    id: string;
    category: string;
    sourceType: string;
    label: string;
    path?: string;
    relevance: number;
    estimatedTokenCost: number;
    evidence: EvidenceItem[];
    expandable: boolean;
    compressed: boolean;
    contextReference: string;
    reason: string;
    provenance?: {
      authoritativePath?: string;
      sourceHash?: string;
      sourceRevision: string;
      ranges: EvidenceItem[];
    };
  }>;
  inspector?: {
    estimatedPreparedTokens: number;
    estimatedAvoidedTokens: number;
    mustPreserve: ContextInspectorItem[];
    included: ContextInspectorItem[];
    availableOnDemand: ContextInspectorItem[];
    excluded: ContextInspectorItem[];
  };
}
export type ContextInspectorItem = ContextPackageSummary["candidates"][number];
export interface ContextFragment {
  contextId: string;
  reference?: string;
  focus: string;
  level: "L0" | "L1" | "L2" | "L3" | "L4" | "summary" | "standard" | "full";
  candidates: Array<{
    id: string;
    category?: string;
    sourceType: string;
    payload: Record<string, unknown>;
    content?: string;
    stale?: boolean;
    provenance?: {
      authoritativePath?: string;
      sourceHash?: string;
      sourceRevision: string;
      ranges: EvidenceItem[];
    };
  }>;
  estimatedTokens: number;
  content: string;
  stale: boolean;
  staleSources: Array<{
    path: string;
    expectedHash?: string;
    currentHash?: string;
    message: string;
  }>;
}
export type ContextPacketSegmentKind = "summary" | "selected-intelligence" | "source-excerpts";
export interface ContextPacketSegment {
  kind: ContextPacketSegmentKind;
  path?: string;
  content: string;
  estimatedTokens: number;
}
export interface ContextPacketPayload {
  id: string;
  sequence: number;
  total: number;
  continuationToken?: string;
  segmentKinds: ContextPacketSegmentKind[];
  paths: string[];
  estimatedTokens: number;
  segments: ContextPacketSegment[];
  content: string;
}
export interface CorrectionPacket {
  id: string;
  taskId: string;
  reason: "validation-failure" | "delegation-failure" | "manual";
  createdAt: string;
  snapshotDigest: string;
  validation: { commands: string[]; failures: string[]; remediations: string[] };
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
  contextPackageId?: string;
  prompt: string;
}
export interface TaskResult {
  intentId: string;
  researchStatus: "ready" | "approved";
  researchDocument: ResearchDocument;
  intentType?: string;
  route?: string;
  reason?: string;
  tokenReduction?: number;
  relevantFiles: string[];
  relevantSymbols: string[];
  relatedTests: string[];
  missingTests: string[];
  qaChecklist: string[];
  securityRisk: string;
  performanceRisk: string;
  modernizationNotes: string[];
  copilotPrompt: string;
  prMarkdown?: string;
  validationCommands?: string[];
  contextTokens?: { raw: number; selected: number; prompt: number; packets: number; tier: string };
  contextSummary?: ContextPackageSummary;
  contextPackets?: Array<{
    id: string;
    sequence: number;
    total: number;
    continuationToken?: string;
    segmentKinds: string[];
    paths: string[];
    estimatedTokens: number;
  }>;
  contextManifest?: {
    delegationTokenBudget: number;
    usedTokens: number;
    selectedFiles: number;
    omittedFiles: number;
    protectedFiles: number;
    traceableEvidence: number;
    snapshotDigest?: string;
    generatedAt: string;
  };
  contextSections?: ContextSection[];
  boundedIntelligence?: string;
  omittedContext?: Array<{ path: string; reason: string; estimatedTokens: number }>;
  relatedApis?: string[];
  impactedServices?: string[];
  architectureConstraints?: string[];
  securityConstraints?: string[];
  performanceConstraints?: string[];
  acceptanceCriteria?: string[];
  repoSkills?: Array<{ id: string; name: string; description: string; guidance: string[] }>;
  copilotCustomizations?: {
    agents: Array<{ id: string; name: string; path: string; description: string }>;
    skills: Array<{ id: string; name: string; description: string; guidance: string[] }>;
    instructions: Array<{ id: string; path: string; description: string; guidance: string[] }>;
  };
  evidence?: EvidenceItem[];
  analysisEvidence?: {
    canonicalEvidence?: Partial<
      Record<
        "qa" | "security" | "performance" | "modernization",
        {
          snapshotDigest: string;
          extractionRunId: string;
          unitIds: string[];
          relationshipIds: string[];
          evidenceIds: string[];
          paths: string[];
          generatedAt: string;
        }
      >
    >;
    qa: {
      scanMode: string;
      gaps: Array<{ type: string; path: string; severity: number; reason: string }>;
      recommendations: string[];
    };
    security: {
      riskLevel: string;
      findings: Array<{
        id: string;
        severity: string;
        title: string;
        path: string;
        line: number;
        explanation: string;
        remediation: string;
        confidence: number;
      }>;
      intelligenceSignals: Array<{
        kind: string;
        label: string;
        path?: string;
        line?: number;
        okfId?: string;
        relationship?: string;
        relatedLabel?: string;
        summary: string;
      }>;
      recommendations?: string[];
    };
    performance: {
      riskLevel: string;
      findings: Array<{
        id: string;
        severity: string;
        title: string;
        path: string;
        line: number;
        explanation: string;
        remediation: string;
        confidence: number;
      }>;
      intelligenceSignals: Array<{
        kind: string;
        label: string;
        path?: string;
        line?: number;
        okfId?: string;
        relationship?: string;
        relatedLabel?: string;
        summary: string;
      }>;
      recommendations?: string[];
    };
    modernization: {
      proposalId?: string;
      coveragePercent?: number;
      gaps: Array<{
        id: string;
        area: string;
        title: string;
        priority: string;
        evidence: string[];
      }>;
      recommendations?: string[];
    };
    gitReview: {
      readOnly: true;
      branch?: string;
      changedFiles: string[];
      diffHash: string;
      diffArtifactPath?: string;
      diffBytes: number;
    };
  };
  testGeneration?: {
    scenarios: Array<{
      id: string;
      name: string;
      description: string;
      category: string;
      priority: string;
    }>;
    strategies: Array<{ layer: string; rationale: string; scenarios: string[] }>;
    tests: Array<{ id: string; name: string; layer: string; status: string; scenarioId: string }>;
    summary: {
      totalScenarios: number;
      totalTests: number;
      byLayer: Record<string, number>;
      byStatus: Record<string, number>;
    };
  };
  taskWorkspace?: { id?: string; name?: string };
}
export interface ResearchDocument {
  title: string;
  problemStatement: string;
  markdown: string;
  evidenceMatrix: EvidenceItem[];
  affectedArchitecture: string[];
  affectedFlows: string[];
  affectedTests: string[];
  risks: string[];
  constraints: string[];
  unknowns: string[];
  recommendedApproach?: string[];
  testingStrategy?: string[];
}
export interface SpecificationDocument {
  title: string;
  summary: string;
  functionalRequirements: string[];
  nonFunctionalRequirements: string[];
  architectureDecisions: string[];
  affectedInterfaces: string[];
  dataChanges: string[];
  constraints: string[];
  validationPlan: string[];
  acceptanceCriteria: string[];
  unknowns: string[];
  markdown: string;
  generatedAt: string;
}
export interface BacklogStory {
  id: string;
  kind: "user-story" | "quality-story";
  title: string;
  description: string;
  acceptanceCriteria: string[];
  evidence: string[];
  dependencies: string[];
  status: string;
  scope?: { files?: string[]; symbols?: string[]; interfaces?: string[] };
}
export interface Story {
  id: string;
  type: string;
  title: string;
  objective: string;
  status: StoryStatus;
  dependencies: string[];
  acceptanceCriteria: string[];
  satisfiedCriteria: string[];
  evidence: string[];
  blockers: string[];
  decisions: string[];
  validationRuns?: Array<{ id: string; status: string; commands: string[]; evidence: string[] }>;
  findings?: Array<{
    id: string;
    kind: string;
    severity: string;
    summary: string;
    status: string;
    evidence: string[];
  }>;
  delegation?: {
    id: string;
    status: string;
    agent: string;
    skills: string[];
    instructions: string[];
    completedAt?: string;
  };
}
export interface SdlcPlan {
  id: string;
  intent: string;
  specificationStatus: string;
  source?: { kind: string; featureId?: string; featureName?: string };
  researchDocument: ResearchDocument;
  specificationDocument: SpecificationDocument;
  backlogStories: BacklogStory[];
  stories: Story[];
}
export interface CopilotDelegationResult {
  success: boolean;
  captured: boolean;
  mode: string;
  model?: { id: string; vendor?: string; family?: string; version?: string; name?: string };
  text?: string;
  artifactPath?: string;
  storyId?: string;
  contextPackageId?: string;
  streaming?: boolean;
  startedAt: string;
  completedAt: string;
  error?: string;
  cancellation?: "requested" | "cancelled";
  structured?: CopilotResponseEnvelope;
  structuredStatus?: "complete" | "partial" | "absent";
  structuredSource?: "language-model-tool" | "json-recovery";
  structuredWarning?: string;
  observability?: {
    intentId: string;
    operation: string;
    contextPackageId?: string;
    contextUsage?: CopilotDelegationResult["contextUsage"];
    model?: CopilotDelegationResult["model"];
    startState: "started";
    endState: "completed" | "cancelled" | "failed";
    errorCode?: string;
  };
  contextUsage?: {
    estimatedTransmittedTokens: number;
    allCandidateCount: number;
    transmittedCandidateCount: number;
    retainedCandidateCount: number;
    omittedContextCount: number;
  };
}
export type IntentLifecycle =
  "DRAFT" | "UNDERSTANDING" | "READY" | "IN_PROGRESS" | "BLOCKED" | "REVIEW" | "COMPLETE";
export interface IntentDecision {
  id: string;
  title: string;
  recommendation: string;
  reason?: string;
  status: "PROPOSED" | "ACCEPTED" | "REJECTED" | "SUPERSEDED";
  provenance: string;
  createdAt: string;
  resolvedAt?: string;
}
export interface IntentState {
  id: string;
  goal: string;
  understanding: string[];
  scope: { included: string[]; excluded: string[]; boundaries: string[]; followUps: string[] };
  constraints: string[];
  decisions: IntentDecision[];
  currentObjective: string;
  completedWork: string[];
  openQuestions: string[];
  blockers: Array<{ id: string; summary: string; provenance: string; resolvedAt?: string }>;
  risks: string[];
  affectedAreas: string[];
  changes: string[];
  artifacts: string[];
  outcomes: Array<{
    id: string;
    category: string;
    text: string;
    provenance: string;
    evidence?: EvidenceItem[];
    createdAt: string;
  }>;
  contextReferences: string[];
  latestCopilotInteraction?: {
    summary?: string;
    contextPackageId?: string;
    structuredStatus: string;
    recordedAt: string;
    provenance: string;
  };
  provenance: Array<{
    field: string;
    value: string;
    provenance: string;
    recordedAt: string;
    sourceId?: string;
  }>;
  lifecycle: IntentLifecycle;
  updatedAt: string;
}
export interface CopilotResponseEnvelope {
  summary?: string;
  findings?: Array<{
    summary: string;
    severity?: string;
    evidence?: EvidenceItem[];
    provenance: string;
    claimedProvenance?: string;
  }>;
  recommendation?: string;
  affectedAreas?: string[];
  risks?: string[];
  blockers?: string[];
  decisionsProposed?: Array<{
    title: string;
    recommendation: string;
    reason?: string;
    evidence?: EvidenceItem[];
    provenance: string;
  }>;
  questions?: string[];
  proposedActions?: string[];
  scopeChange?: { summary: string; affectedAreas: string[]; reason?: string; options: string[] };
  artifacts?: string[];
  evidenceReferences?: EvidenceItem[];
  userVisibleResponse: string;
  provenance: string;
  claimedProvenance?: string;
  structuredStatus: string;
  operation?: string;
  details?: {
    operation: string;
    understanding?: string;
    likelyScope?: string[];
    constraintsDetected?: string[];
    repositoryEvidence?: EvidenceItem[];
    approach?: string;
    affectedAreas?: string[];
    dependencies?: string[];
    risks?: string[];
    proposedActions?: string[];
    workPerformed?: string[];
    changedAreas?: string[];
    unresolvedIssues?: string[];
    nextAction?: string;
    findings?: CopilotResponseEnvelope["findings"];
    severity?: string;
    evidence?: EvidenceItem[];
    recommendation?: string;
  };
}
export interface IntelligenceQueryResult {
  query: string;
  intent: string;
  answer: string;
  confidence: number;
  traversedRelationships: number;
  warnings: string[];
  items: EvidenceItem[];
  plan: {
    terms: string[];
    seedIds: string[];
    seedLabels: string[];
    relationshipKinds: string[];
    maxDepth: number;
    strategy: string;
  };
  traversals: Array<{
    sourceId: string;
    targetId: string;
    relationship: string;
    sourceLabel: string;
    targetLabel: string;
  }>;
}

export type IntelligenceView = "Overview" | "Explorer" | "Graph" | "CPG" | "Flows" | "Query";
export type IntelligenceGraphMode =
  "repository" | "architecture" | "dependencies" | "calls" | "tests" | "impact" | "flows";
export interface IntelligenceExplorerItem {
  id: string;
  label: string;
  kind: string;
  path?: string;
  line?: number;
  description?: string;
  confidence: number;
  evidenceIds: string[];
  incoming: number;
  outgoing: number;
}
export interface IntelligenceExplorerResult {
  query: string;
  kind?: string;
  cursor?: string;
  nextCursor?: string;
  pageSize: number;
  totalActive: number;
  totalMatching: number;
  kindCounts: Record<string, number>;
  items: IntelligenceExplorerItem[];
}
export interface IntelligenceGraphNode {
  id: string;
  label: string;
  kind: string;
  path?: string;
  line?: number;
  confidence: number;
  evidenceIds: string[];
  seed: boolean;
}
export interface IntelligenceGraphEdge {
  id: string;
  sourceId: string;
  targetId: string;
  kind: string;
  confidence: number;
  evidenceIds: string[];
}
export interface IntelligenceGraphResult {
  mode: IntelligenceGraphMode;
  query?: string;
  seedIds: string[];
  nodes: IntelligenceGraphNode[];
  edges: IntelligenceGraphEdge[];
  relationshipKinds: string[];
  truncated: boolean;
  warnings: string[];
}
export interface IntelligenceCpgFile {
  sourcePath: string;
  nodeCount: number;
  edgeCount: number;
  capabilities: Record<string, boolean>;
}
export interface IntelligenceCpgNode {
  id: string;
  label: string;
  kind: string;
  syntaxKind: string;
  path: string;
  line: number;
  okfId?: string;
}
export interface IntelligenceCpgEdge {
  id: string;
  sourceId: string;
  targetId: string;
  kind: string;
  okfSourceId?: string;
  okfTargetId?: string;
}
export interface IntelligenceCpgResult {
  files: IntelligenceCpgFile[];
  sourcePath?: string;
  capabilities?: Record<string, boolean>;
  nodes: IntelligenceCpgNode[];
  edges: IntelligenceCpgEdge[];
  edgeKinds: string[];
  truncated: boolean;
  warnings: string[];
}

export interface Operation {
  id: string;
  kind: string;
  status: string;
  progress: number;
  message: string;
  updatedAt: string;
}
export interface WorkerPoolProgress {
  maxWorkers: number;
  activeWorkers: number;
  completedStages: number;
  totalStages: number;
  queuedStages: number;
  currentStages: string[];
}
export interface IngestionState {
  active: boolean;
  progress: number;
  stage: string;
  message: string;
  persistedPath?: string;
  queuedRefresh?: boolean;
  workerPool?: WorkerPoolProgress;
}
export type BackgroundWorkerId = "qa" | "security" | "performance" | "modernization";
export interface BackgroundWorkerState {
  status: "idle" | "running" | "complete" | "cancelled" | "stale" | "failed";
  progress?: number;
  message?: string;
  error?: string;
  result?: unknown;
  canonicalEvidence?: {
    snapshotDigest: string;
    extractionRunId: string;
    unitIds: string[];
    relationshipIds: string[];
    evidenceIds: string[];
    paths: string[];
    generatedAt: string;
  };
  workerId?: string;
  snapshotDigest?: string;
  extractionRunId?: string;
  scopePaths?: string[];
  startedAt?: string;
  completedAt?: string;
  durationMs?: number;
  attempt?: number;
  maxAttempts?: number;
  retryCount?: number;
  retryAt?: string;
  updatedAt: string;
}
export interface ApplicationState {
  version: number;
  status: string;
  workspace?: { name: string; root: string; branch?: string };
  intelligence?: IntelligenceSummary;
  taskAnalysis?: TaskResult;
  delegationResult?: CopilotDelegationResult;
  intentState?: IntentState;
  correctionPacket?: CorrectionPacket;
  sdlc?: SdlcPlan;
  ingestion?: IngestionState;
  backgroundWorkers?: Partial<Record<BackgroundWorkerId, BackgroundWorkerState>>;
  intelligenceActivity?: Array<{
    id?: string;
    timestamp: string;
    type: string;
    message: string;
    progress?: number;
  }>;
  operations?: Operation[];
  handoffs?: unknown[];
  notification?: { level: string; message: string };
}
