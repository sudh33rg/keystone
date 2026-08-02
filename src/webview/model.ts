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
  okfId?: string;
  confidence?: number;
  summary?: string;
  reason?: string;
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
  projectTypes?: string[];
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
  contextManifest?: {
    delegationTokenBudget: number;
    usedTokens: number;
    selectedFiles: number;
    omittedFiles: number;
    protectedFiles: number;
    traceableEvidence: number;
    generatedAt: string;
  };
  contextSections?: ContextSection[];
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
  startedAt: string;
  completedAt: string;
  error?: string;
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
  totalActive: number;
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
export interface ApplicationState {
  version: number;
  status: string;
  workspace?: { name: string; root: string; branch?: string };
  intelligence?: IntelligenceSummary;
  taskAnalysis?: TaskResult;
  delegationResult?: CopilotDelegationResult;
  sdlc?: SdlcPlan;
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
