import type { KnowledgeGraph } from "../../intelligence/graph/types";
import type { SDLCTaskPacket, WorkflowExecutionState, WorkflowStepStatus } from "../../workflow/sdlc/types";
import type { ParsedValidationSummary } from "../../workflow/validation/validationParser";

export type WorkspaceSummary = {
  files?: Array<{ path: string; role: string; [key: string]: unknown }>;
  coverageMappings?: Array<{ testPath: string; coveredPath: string; [key: string]: unknown }>;
  imports?: Array<{ sourcePath: string; resolvedPath?: string; [key: string]: unknown }>;
  [key: string]: unknown;
};

export type RepoIndexMetadata = {
  schemaVersion: 1;
  workspaceId: string;
  repoId: string;
  indexedAt: string;
  fingerprint: string;
};

export type KnowledgeGraphStats = {
  nodeCount: number;
  edgeCount: number;
  fileNodeCount: number;
  directoryNodeCount: number;
  packageManifestNodeCount: number;
  packageScriptNodeCount: number;
  packageDependencyNodeCount: number;
  testNodeCount: number;
  routeNodeCount: number;
  configUsageNodeCount: number;
  runtimeBehaviorNodeCount: number;
  ownerNodeCount: number;
  changeNodeCount: number;
  symbolNodeCount: number;
  importEdgeCount: number;
  callEdgeCount: number;
  coverageEdgeCount: number;
  telemetryEdgeCount: number;
  ownershipEdgeCount: number;
  changeEdgeCount: number;
  boundCallReferenceCount: number;
  unresolvedCallReferenceCount: number;
};

export type RepoIndex = {
  metadata: RepoIndexMetadata;
  summary: WorkspaceSummary;
  graph: KnowledgeGraph;
  graphStats: KnowledgeGraphStats;
};

export type RepoIndexStorage = {
  save(index: RepoIndex): Promise<void>;
  load(workspaceId: string): Promise<RepoIndex | undefined>;
  cleanup(workspaceId: string): Promise<void>;
};

export type DelegationRecord = {
  id: string;
  workspaceId: string;
  repoId: string;
  createdAt: string;
  status: TaskProgressStatus;
  packet: SDLCTaskPacket;
  prompt: string;
  workflowState?: WorkflowExecutionState;
  validationResults: ValidationResult[];
  readinessResults?: ReadinessResult[];
};

export type TaskProgressStatus = "created" | "in_progress" | "validation_passed" | "validation_failed" | "blocked" | "done";

export type ValidationResult = {
  command: string;
  status: "passed" | "failed" | "skipped";
  recordedAt: string;
  notes?: string;
  summary?: ParsedValidationSummary;
};

export type ReadinessResult = {
  checkedAt: string;
  status: "ready" | "needs_attention" | "blocked";
  changedFiles: string[];
  reasons: string[];
  failedGateCount: number;
  warningGateCount: number;
};

export type DelegationHistory = {
  records: DelegationRecord[];
};

export type DelegationHistoryStorage = {
  append(record: DelegationRecord): Promise<DelegationHistory>;
  appendValidationResult(workspaceId: string, taskId: string, result: ValidationResult): Promise<DelegationHistory>;
  appendReadinessResult(workspaceId: string, taskId: string, result: ReadinessResult): Promise<DelegationHistory>;
  updateStatus(workspaceId: string, taskId: string, status: TaskProgressStatus): Promise<DelegationHistory>;
  updateWorkflowStep(
    workspaceId: string,
    taskId: string,
    stepId: string,
    status: WorkflowStepStatus,
    notes?: string
  ): Promise<DelegationHistory>;
  load(workspaceId: string): Promise<DelegationHistory>;
};
