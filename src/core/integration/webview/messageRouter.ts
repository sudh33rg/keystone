import type {
  ContextPack,
  ContextPacketPayload,
  ContextPacketSegmentKind,
  CorrectionPacket,
  RepoFile
} from "../../domain/types";
import type { EnhancementMode, EnhancementSession } from "../../context/promptEnhancer";
import type {
  IntelligenceFamilySummary,
  IntelligenceStageResult,
  IntelligenceWorkerPoolProgress
} from "../../intelligence/pipeline";
import type { ValidationRunResult } from "../../workflow/validation/validationRunner";
import type { TaskStatePackageInput } from "../../workflow/handoff/taskStatePackage";
import type { TaskStatePackage } from "../../workflow/handoff/contracts";
import type { GapAnalysisResult } from "../../workflow/quality/qaGapAnalysis";
import type { TestGenerationResult } from "../../workflow/quality/generation";
import type {
  ModernizationDecisionInput,
  ModernizationPlan,
  ModernizationProposal
} from "../../workflow/modernization/model";
import type {
  TaskWorkspaceRef,
  TaskWorkspaceSnapshot
} from "../../workflow/tasks/taskWorkspaceManager";
import type { CpgEdgeKind } from "../../intelligence/cpg/types";
import type {
  IntelligenceCpgResult,
  IntelligenceExplorerResult,
  IntelligenceGraphMode,
  IntelligenceGraphResult
} from "../../intelligence/explorer";
import type { SDLCResearchDocument } from "../../workflow/sdlc/engine";
import type { OkfCanonicalEvidenceEnvelope } from "../../intelligence/okf/types";
import type { ContextFragment, ContextPackageSummary } from "../../context/contextEngine";
import type {
  CopilotResponseEnvelope,
  StructuredResponseSource
} from "../../copilot/responseContract";
import type { IntentLifecycle, IntentState } from "../../intent/intentState";

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
  structuredSource?: StructuredResponseSource;
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

export type CopilotContextToolOperation =
  | "get_intelligence"
  | "get_symbols"
  | "get_relationships"
  | "get_flows"
  | "get_impact"
  | "get_intent"
  | "expand_context";

export interface CopilotContextToolInput {
  packageId: string;
  operation: CopilotContextToolOperation;
  query?: string;
  contextReference?: string;
  level?: "L0" | "L1" | "L2" | "L3" | "L4" | "summary" | "standard" | "full";
  limit?: number;
}

export interface CockpitSettings {
  compressionTier?: "off" | "standard" | "aggressive";
  patterns: string;
  keywords: string;
  thresholds: { security: number; performance: number; modernization: number };
  thingsToAvoid: string;
  codingStandards: string;
}

export type WebviewToExtensionMessage =
  | { type: "WEBVIEW_READY" }
  | { type: "INDEX_REPO"; force?: boolean }
  | { type: "LOAD_INTELLIGENCE" }
  | { type: "LOAD_RESTORED_TASK_HANDOFF" }
  | { type: "CLEAR_CONTEXT_CACHE" }
  | { type: "ENHANCE_INTENT"; text: string; mode: EnhancementMode; sessionId?: string }
  | { type: "LOAD_ENHANCEMENT_SESSIONS" }
  | { type: "DELETE_ENHANCEMENT_SESSION"; sessionId: string }
  | { type: "RETRIEVE_CONTEXT_ORIGINAL"; path: string; expectedHash?: string }
  | { type: "LOAD_CONTEXT_PACKET"; packetId: string; segmentKinds?: ContextPacketSegmentKind[] }
  | {
      type: "EXPAND_CONTEXT";
      contextId?: string;
      contextReference?: string;
      focus: string;
      level: "L0" | "L1" | "L2" | "L3" | "L4" | "summary" | "standard" | "full";
    }
  | {
      type: "RECORD_CONTEXT_FEEDBACK";
      intent: string;
      path?: string;
      rating: "useful" | "irrelevant" | "helpful" | "unhelpful";
    }
  | { type: "REQUEST_CORRECTION_PACKET" }
  | { type: "REINDEX_AFFECTED_AND_VALIDATE" }
  | { type: "CANCEL_INGESTION" }
  | { type: "CANCEL_ANALYSIS" }
  | { type: "CANCEL_COPILOT" }
  | { type: "ANALYZE_INTENT"; text: string }
  | { type: "APPROVE_INTENT_RESEARCH"; intentId: string }
  | { type: "RUN_VALIDATION"; scope: "impacted" | "all"; storyId?: string }
  | { type: "COMPLETE_TASK" }
  | { type: "ANALYZE_MODERNIZATION" }
  | { type: "ACCEPT_MODERNIZATION"; proposalId: string; decision: ModernizationDecisionInput }
  | {
      type: "APPROVE_DELEGATION";
      mode: string;
      prompt: string;
      storyId?: string;
      agent?: string;
      skills?: string[];
      instructions?: string[];
      contextPackId?: string;
      correctionPacketId?: string;
      continuation?: boolean;
    }
  | { type: "COPY_COPILOT_PROMPT"; prompt: string }
  | { type: "COPY_PR_MARKDOWN"; markdown: string }
  | { type: "SAVE_SETTINGS"; settings: CockpitSettings }
  | { type: "OPEN_BROWSER_VIEW" }
  | { type: "CONFIGURE_VALUEEDGE" }
  | { type: "IMPORT_VALUEEDGE_FEATURE"; featureId: string }
  | { type: "PUBLISH_VALUEEDGE_STORIES" }
  | { type: "CREATE_TASK_HANDOFF"; passphrase: string }
  | {
      type: "RESTORE_TASK_HANDOFF";
      packageText: string;
      passphrase: string;
      manualSyncConfirmed: boolean;
    }
  | { type: "CREATE_SDLC_PLAN"; intent: string }
  | {
      type: "SDLC_TRANSITION";
      storyId: string;
      status: import("../../workflow/sdlc/engine").SDLCStoryStatus;
      evidence?: string[];
      satisfiedCriteria?: string[];
      blockers?: string[];
    }
  | { type: "APPROVE_SPECIFICATION" }
  | { type: "QUERY_INTELLIGENCE"; query: string }
  | { type: "EXPLORE_INTELLIGENCE"; query?: string; kind?: string; cursor?: string }
  | {
      type: "LOAD_INTELLIGENCE_GRAPH";
      mode: IntelligenceGraphMode;
      query?: string;
      seedIds?: string[];
    }
  | {
      type: "LOAD_CPG_VIEW";
      sourcePath?: string;
      edgeKind?: CpgEdgeKind | "all";
      focusNodeId?: string;
    }
  | { type: "OPEN_SOURCE_LOCATION"; path: string; line?: number }
  | {
      type: "RESOLVE_SDLC_FINDING";
      storyId: string;
      findingId: string;
      status: "accepted" | "resolved";
    }
  | { type: "RECORD_DECISION"; category: "task" | "risk"; action: string; subject: string }
  | { type: "ACCEPT_INTENT_DECISION"; decisionId: string }
  | { type: "REJECT_INTENT_DECISION"; decisionId: string; reason?: string }
  | { type: "DISCUSS_INTENT_DECISION"; decisionId: string; message: string }
  | { type: "ADD_INTENT_BLOCKER"; summary: string }
  | { type: "RESOLVE_INTENT_BLOCKER"; blockerId: string }
  | { type: "SET_INTENT_LIFECYCLE"; lifecycle: IntentLifecycle }
  | { type: "EXPAND_INTENT_SCOPE"; proposalId?: string; areas?: string[]; reason?: string }
  | { type: "KEEP_INTENT_SCOPE"; proposalId?: string; reason?: string }
  | { type: "CREATE_INTENT_FOLLOW_UP"; proposalId?: string; reason?: string }
  | { type: "ASK_ABOUT_INTENT"; question: string };

export type ExtensionToWebviewMessage =
  | { type: "STATE_UPDATE"; state: Partial<KeystoneWebviewState> }
  | {
      type: "INDEX_PROGRESS";
      message: string;
      progress?: number;
      stage?: string;
      workerPool?: IntelligenceWorkerPoolProgress;
    }
  | { type: "ERROR"; message: string; operation?: "intelligence" | "analysis" | "validation" }
  | { type: "TASK_RESULT"; result: KeystoneTaskResult }
  | { type: "INTENT_ENHANCED"; session: EnhancementSession }
  | { type: "ENHANCEMENT_SESSIONS_RESULT"; sessions: EnhancementSession[] }
  | {
      type: "CONTEXT_ORIGINAL_RESULT";
      path: string;
      content: string;
      truncated: boolean;
      changed: boolean;
      currentHash: string;
    }
  | {
      type: "CONTEXT_PACKET_RESULT";
      taskId: string;
      packetId: string;
      stale: boolean;
      snapshotDigest?: string;
      currentSnapshotDigest?: string;
      segmentKinds?: ContextPacketSegmentKind[];
      packet?: ContextPacketPayload;
    }
  | { type: "CONTEXT_FRAGMENT_RESULT"; fragment: ContextFragment }
  | { type: "CORRECTION_PACKET_RESULT"; packet: CorrectionPacket }
  | { type: "VALIDATION_RESULT"; results: ValidationRunResult[] }
  | {
      type: "QA_BACKGROUND_STATUS";
      status: "running" | "complete" | "cancelled" | "stale" | "failed";
      message?: string;
      progress?: number;
      result?: GapAnalysisResult;
      workerId?: string;
      reason?: string;
      snapshotDigest?: string;
      extractionRunId?: string;
      scopePaths?: readonly string[];
      startedAt?: string;
      completedAt?: string;
      durationMs?: number;
      attempt?: number;
      maxAttempts?: number;
      retryCount?: number;
      retryAt?: string;
      retrying?: boolean;
    }
  | {
      type: "BACKGROUND_ANALYSIS_STATUS";
      worker: "security" | "performance" | "modernization";
      status: "running" | "complete" | "cancelled" | "stale" | "failed";
      result?: any;
      error?: string;
      reason?: string;
      workerId?: string;
      snapshotDigest?: string;
      extractionRunId?: string;
      scopePaths?: readonly string[];
      startedAt?: string;
      completedAt?: string;
      durationMs?: number;
      attempt?: number;
      maxAttempts?: number;
      retryCount?: number;
      retryAt?: string;
      retrying?: boolean;
    }
  | { type: "MODERNIZATION_PROPOSAL"; proposal: ModernizationProposal }
  | { type: "MODERNIZATION_PLAN"; plan: ModernizationPlan }
  | ({ type: "DELEGATION_RESULT" } & CopilotDelegationResult)
  | {
      type: "DECISION_DISCUSSION_RESULT";
      decisionId: string;
      result: CopilotDelegationResult;
    }
  | {
      type: "COPILOT_ACTIVITY";
      storyId?: string;
      contextPackageId?: string;
      stage: string;
      message: string;
      progress: number;
    }
  | {
      type: "COPILOT_STREAM";
      storyId?: string;
      discussionId?: string;
      contextPackageId?: string;
      text: string;
      done?: boolean;
    }
  | { type: "TASK_COMPLETION_RESULT"; success: boolean; error?: string }
  | { type: "TASK_DECISION_RESULT"; success: boolean; action: string; error?: string }
  | {
      type: "TASK_HANDOFF_CREATED";
      redactionCategories: string[];
      checksum: string;
      encryptedPackage: string;
    }
  | {
      type: "TASK_HANDOFF_RESTORED";
      packageValue: TaskStatePackage;
      warnings: string[];
      continuationBriefing: string;
      restoredNow?: boolean;
    }
  | {
      type: "TASK_HANDOFFS_RESULT";
      sessions: Array<{
        packageValue: TaskStatePackage;
        status: "Shared" | "Restored";
        warnings: string[];
        activity: Array<{ at: string; actor: string; action: string }>;
      }>;
    }
  | {
      type: "APPLICATION_STATE";
      state: import("../../application/applicationStore").KeystoneApplicationState;
    }
  | { type: "SDLC_PLAN_RESULT"; plan: import("../../workflow/sdlc/engine").SDLCPlan }
  | { type: "BROWSER_VIEW_OPENED"; url: string }
  | { type: "VALUEEDGE_FEATURE_RESULT"; feature: import("../valueedge/types").ValueEdgeFeature }
  | {
      type: "VALUEEDGE_PUBLISH_RESULT";
      published: import("../valueedge/types").ValueEdgePublishResult[];
    }
  | {
      type: "INTELLIGENCE_QUERY_RESULT";
      result: {
        query: string;
        intent: string;
        answer: string;
        confidence: number;
        traversedRelationships: number;
        warnings: string[];
        plan: {
          terms: readonly string[];
          seedIds: readonly string[];
          seedLabels: readonly string[];
          relationshipKinds: readonly string[];
          maxDepth: number;
          strategy: string;
        };
        traversals: readonly {
          sourceId: string;
          targetId: string;
          relationship: string;
          sourceLabel: string;
          targetLabel: string;
        }[];
        items: Array<{
          id: string;
          label: string;
          kind: string;
          path?: string;
          line?: number;
          summary: string;
          reason: string;
          score: number;
          confidence: number;
          evidenceIds: string[];
          relationshipPath: string[];
        }>;
      };
    }
  | { type: "INTELLIGENCE_EXPLORER_RESULT"; result: IntelligenceExplorerResult }
  | { type: "INTELLIGENCE_GRAPH_RESULT"; result: IntelligenceGraphResult }
  | { type: "CPG_VIEW_RESULT"; result: IntelligenceCpgResult }
  | { type: "NOTIFICATION"; level: "info" | "error"; message: string };

export interface WorkspaceSummary {
  fileCount: number;
  files: RepoFile[];
  querySuggestions?: string[];
  projectTypes: string[];
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
  architecture: string;
  git: { branch: string; changedFiles: string[] };
  stages?: IntelligenceStageResult[];
  families?: IntelligenceFamilySummary[];
  languageCapabilities?: Array<{
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
    capabilities?: object;
    warnings?: readonly string[];
  }>;
  universalTextFiles?: number;
  okf?: {
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
  };
}

export interface IntelligenceManifest {
  status: "empty" | "ready" | "indexing" | "error" | "stale";
  indexedAt?: string;
  updatedAt: string;
  summaryPath: string;
  activityPath: string;
  fileCount: number;
  branch?: string;
  reason?: string;
  error?: string;
  completedStages?: number;
  totalStages?: number;
}

export interface IntelligenceActivityEvent {
  id: string;
  timestamp: string;
  type: string;
  message: string;
  progress?: number;
}

export interface KeystoneWebviewState {
  status: "idle" | "indexing" | "ready" | "analyzing" | "error";
  intelligence?: WorkspaceSummary;
  intelligenceManifest?: IntelligenceManifest;
  intelligenceActivity?: IntelligenceActivityEvent[];
  ingestion?: {
    active: boolean;
    progress: number;
    stage: string;
    message: string;
    persistedPath: string;
  };
  modernizationProposal?: ModernizationProposal;
  modernizationPlan?: ModernizationPlan;
  backgroundAnalysis?: Partial<Record<"qa" | "security" | "performance" | "modernization", any>>;
  backgroundWorkers?: Partial<
    Record<
      "qa" | "security" | "performance" | "modernization",
      {
        status: "idle" | "running" | "complete" | "cancelled" | "stale" | "failed";
        progress?: number;
        message?: string;
        error?: string;
        result?: unknown;
        canonicalEvidence?: OkfCanonicalEvidenceEnvelope;
        workerId?: string;
        snapshotDigest?: string;
        extractionRunId?: string;
        scopePaths?: string[];
        startedAt?: string;
        completedAt?: string;
        durationMs?: number;
        updatedAt: string;
      }
    >
  >;
  settings?: CockpitSettings;
  activeTask?: TaskWorkspaceSnapshot;
  correctionPacket?: CorrectionPacket;
  intentState?: IntentState;
}

export interface RouteEvidence {
  matchedRule: string;
  confidence: number;
  reason: string;
  whyNot: string[];
}

export interface TaskIntelligenceSignal {
  kind: "risk-area" | "flow" | "call" | "data-access";
  label: string;
  path?: string;
  line?: number;
  okfId?: string;
  relationship?: string;
  relatedLabel?: string;
  summary: string;
}

export interface KeystoneTaskResult {
  intentId: string;
  researchStatus: "ready" | "approved";
  researchDocument: SDLCResearchDocument;
  intentType: string;
  matchedRule?: string;
  textKeywords?: string[];
  confidence?: number;
  confidenceDetails?: {
    overall: number;
    signals: Array<{ name: string; score: number; weight: number }>;
  };
  route: string;
  reason: string;
  routeEvidence?: RouteEvidence;
  tokenReduction: number;
  relevantFiles: string[];
  relevantSymbols: string[];
  relatedTests: string[];
  missingTests: string[];
  coverageConfidence: number;
  validationCommands: string[];
  qaChecklist: string[];
  securityRisk: "low" | "medium" | "high";
  performanceRisk: "low" | "medium" | "high";
  modernizationNotes: string[];
  copilotPrompt: string;
  prMarkdown: string;
  detailedRisks: Record<
    "architectureImpact" | "securityRisk" | "performanceRisk" | "testGaps" | "dependencyChanges",
    { area: string; level: "low" | "medium" | "high"; detail: string }
  >;
  excludedPaths: Array<{ path: string; reason: string }>;
  contextTokens?: { raw: number; selected: number; prompt: number; packets: number; tier: string };
  contextSummary?: ContextPackageSummary;
  contextPackets?: NonNullable<ContextPack["contextPackets"]>;
  retrievalMetrics?: NonNullable<ContextPack["retrievalMetrics"]>;
  contextSections?: Array<{
    path: string;
    reason: string;
    preview: string;
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
  contextManifest?: ContextPack["contextManifest"];
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
  evidence?: Array<{
    kind: string;
    label: string;
    path?: string;
    okfId?: string;
    confidence?: number;
    summary?: string;
  }>;
  analysisEvidence?: {
    canonicalEvidence?: Partial<
      Record<"qa" | "security" | "performance" | "modernization", OkfCanonicalEvidenceEnvelope>
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
      intelligenceSignals: TaskIntelligenceSignal[];
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
      intelligenceSignals: TaskIntelligenceSignal[];
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
  testGeneration?: TestGenerationResult;
  taskWorkspace?: TaskWorkspaceRef;
}
