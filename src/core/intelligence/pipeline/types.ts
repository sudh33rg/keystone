import type { RepoIntelligence } from "../../domain/types";
import type { IntelligenceHealthReport } from "./health";
import type { IncrementalUpdatePlan } from "./incremental";
import type { IntelligenceFinding } from "./findings";
import type { RuntimeVerification } from "./runtime";
import type { TypeScriptSemanticResult } from "../cpg";
import type { RepositoryEvolution } from "./evolution";
import type { DeadCodeCandidate } from "./deadCode";
import type { SemanticEnrichmentProvider } from "../languages/semanticEnrichment";

export const INTELLIGENCE_FAMILIES = [
  "repository-structure",
  "code-graph",
  "build-test-qa",
  "architecture-sdlc",
  "context-token",
  "runtime-analysis"
] as const;
export type IntelligenceFamily = (typeof INTELLIGENCE_FAMILIES)[number];

export const INTELLIGENCE_STAGES = [
  "structural",
  "language-framework",
  "build-script",
  "configuration",
  "symbol",
  "dependency",
  "api-route",
  "data-persistence",
  "test",
  "call-graph",
  "code-property-graph",
  "architecture",
  "git-change",
  "impact",
  "context",
  "sdlc-workflow",
  "risk",
  "security",
  "performance",
  "documentation",
  "runtime-observability"
] as const;
export type IntelligenceStageId = (typeof INTELLIGENCE_STAGES)[number];
export type IntelligenceStageStatus = "pending" | "running" | "complete" | "cancelled" | "failed";

export interface IntelligenceStageResult {
  id: IntelligenceStageId;
  order: number;
  label: string;
  family: IntelligenceFamily;
  status: IntelligenceStageStatus;
  startedAt: string;
  completedAt: string;
  durationMs: number;
  itemCount: number;
  summary: string;
  items: string[];
  metrics: Record<string, number | string | boolean>;
  cognitivelyEnriched: boolean;
  error?: string;
}

export interface IntelligenceFamilySummary {
  id: IntelligenceFamily;
  label: string;
  stageCount: number;
  completedStages: number;
  itemCount: number;
  status: IntelligenceStageStatus;
}

export interface RepositoryIntelligenceSnapshot {
  version: 1;
  status: "ready" | "degraded";
  workspaceRoot: string;
  runId: string;
  startedAt: string;
  completedAt: string;
  intelligence: RepoIntelligence;
  stages: IntelligenceStageResult[];
  families: IntelligenceFamilySummary[];
  ingestion: IntelligenceIngestionSummary;
  health: IntelligenceHealthReport;
  incremental: IncrementalUpdatePlan;
  findings: readonly IntelligenceFinding[];
  runtime: RuntimeVerification;
  semantic: TypeScriptSemanticResult;
  evolution: RepositoryEvolution;
  deadCode: readonly DeadCodeCandidate[];
}

export interface IntelligenceIngestionSummary {
  inputFingerprint: string;
  indexedFiles: number;
  indexedBytes: number;
  discoveryMode: "unbounded-incremental";
  completedWithoutFileCap: boolean;
  cpgEligibleFiles: number;
  cpgIndexedFiles: number;
  warnings: string[];
  reusedFiles: number;
  analyzedFiles: number;
  cpgShardsWritten: number;
  cpgShardsReused: number;
  cpgShardsDeleted: number;
}

export interface IntelligenceProgressEvent {
  stage: IntelligenceStageId;
  order: number;
  total: number;
  progress: number;
  message: string;
  workerPool?: IntelligenceWorkerPoolProgress;
}

export interface IntelligenceWorkerPoolProgress {
  maxWorkers: number;
  activeWorkers: number;
  completedStages: number;
  totalStages: number;
  queuedStages: number;
  currentStages: string[];
}

export interface IntelligencePipelineOptions {
  signal?: AbortSignal;
  onProgress?: (event: IntelligenceProgressEvent) => void;
  persist?: boolean;
  cognitive?: boolean;
  semanticEnricher?: SemanticEnrichmentProvider;
  maxWorkers?: number;
}
