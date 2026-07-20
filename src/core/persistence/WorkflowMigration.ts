import { z } from "zod";
import { v4 as uuidv4 } from "uuid";
import type {
  Workflow,
  WorkflowStage,
  WorkItem,
  WorkflowWorkType,
  WorkflowStageType,
} from "../../shared/contracts/workflow";
import { RequirementKindSchema } from "../../shared/contracts/workflow";
import type { RequirementKind } from "../../shared/contracts/workflow";
import {
  DevelopmentWorkflowSnapshot,
  DevelopmentTask,
} from "../../shared/contracts/delegation";
import type { WorkflowInstance } from "../../shared/contracts/orchestration";
import {
  WorkbenchStageState,
  WorkbenchStageStateSchema,
} from "../../shared/contracts/workbench";
import type { WorkbenchStage } from "../../shared/contracts/domain";
import {
  IntentRecord,
  KeystoneSpecification,
  TaskGraph,
  TaskSchema,
} from "../../shared/contracts/domain";

// ============================================================================
// Helper: map task category to workflow stage type
// ============================================================================

function getStageTypeForTaskCategory(category: string): WorkflowStageType | undefined {
  switch (category) {
    case "feature":
    case "implementation":
      return "development";
    case "bug":
    case "debugging":
      return "failure-analysis";
    case "refactor":
      return "development";
    case "testing":
      return "test-generation";
    case "investigation":
    case "architecture":
      return "impact-analysis";
    case "security":
      return "security-analysis";
    case "performance":
      return "performance-analysis";
    case "documentation":
      return "plan";
    case "review":
      return "pr-review";
    case "validation":
      return "test-execution";
    case "manual":
      return "understand";
    default:
      return undefined;
  }
}

// ============================================================================
// Migration from DevelopmentWorkflowSnapshot
// ============================================================================

function generateStageIds(workType: WorkflowWorkType): Record<WorkflowStageType, string> {
  const allStages: WorkflowStageType[] = [
    "understand", "plan", "development", "impact-analysis",
    "test-generation", "test-execution", "failure-analysis", "test-healing",
    "security-analysis", "performance-analysis", "pr-review", "complete",
  ];
  switch (workType) {
    case "feature":
      return {
        understand: "u1", plan: "p1", development: "d1", "impact-analysis": "ia1",
        "test-generation": "tg1", "test-execution": "te1", "security-analysis": "sa1",
        "performance-analysis": "pa1", "pr-review": "pr1", complete: "c1",
        "failure-analysis": "fa1", "test-healing": "th1",
      };
    case "bug-fix":
      return {
        understand: "u1", plan: "p1", "impact-analysis": "ia1", development: "d1",
        "test-generation": "tg1", "test-execution": "te1", "failure-analysis": "fa1",
        "test-healing": "th1", "pr-review": "pr1", complete: "c1",
        "security-analysis": "sa1", "performance-analysis": "pa1",
      };
    case "refactoring":
      return {
        understand: "u1", "impact-analysis": "ia1", plan: "p1", development: "d1",
        "test-execution": "te1", "performance-analysis": "pa1", "pr-review": "pr1", complete: "c1",
        "test-generation": "tg1", "failure-analysis": "fa1",
        "test-healing": "th1", "security-analysis": "sa1",
      };
    case "test":
      return {
        understand: "u1", "impact-analysis": "ia1", "test-generation": "tg1",
        "test-execution": "te1", "failure-analysis": "fa1", "test-healing": "th1",
        "pr-review": "pr1", complete: "c1",
        "plan": "p1", "development": "d1",
        "security-analysis": "sa1", "performance-analysis": "pa1",
      };
    case "investigation":
      return {
        understand: "u1", "impact-analysis": "ia1", complete: "c1",
        "plan": "p1", "development": "d1",
        "test-generation": "tg1", "test-execution": "te1",
        "failure-analysis": "fa1", "test-healing": "th1",
        "security-analysis": "sa1", "performance-analysis": "pa1",
        "pr-review": "pr1",
      };
  }
}

function createDefaultStage(
  type: WorkflowStageType,
  id: string,
): WorkflowStage {
  return {
    id,
    type,
    displayName: type,
    enabled: true,
    order: 1,
    required: "required" as RequirementKind,
    executionMode: "automatic",
    entryConditions: [],
    completionConditions: [],
    failureBehaviour: "stop",
    retryLimit: 3,
    executionProfileId: undefined,
    contextProfileId: undefined,
    tokenBudget: 12_000,
    requiredEvidenceTypes: [],
    blockingFindingSeverities: ["critical", "high"],
    state: "not-ready",
    workItemIds: [],
    validationRunIds: [],
    reviewFindingIds: [],
    completionRecordId: undefined,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
}

function mapWorkbenchStageState(
  state: WorkbenchStageState,
  stageIds: Record<WorkflowStageType, string>,
): WorkflowStage {
  const parsed = WorkbenchStageStateSchema.parse(state);
  const workbenchStage = parsed.stage as WorkbenchStage;
  // Map workbench stage names to workflow stage types
  const stageTypeMap: Record<string, WorkflowStageType> = {
    define: "understand",
    plan: "plan",
    build: "development",
    validate: "test-execution",
    review: "pr-review",
    complete: "complete",
  };
  const type = stageTypeMap[workbenchStage] ?? "understand";
  const id = stageIds[type];

  return {
    id: id!,
    type,
    displayName: workbenchStage === "define" ? "Understand" : workbenchStage,
    enabled: true,
    order: 1,
    required: "required" as RequirementKind,
    executionMode: "automatic",
    entryConditions: [],
    completionConditions: [],
    failureBehaviour: "stop",
    retryLimit: 3,
    executionProfileId: undefined,
    contextProfileId: undefined,
    tokenBudget: 12_000,
    requiredEvidenceTypes: [],
    blockingFindingSeverities: ["critical", "high"],
    state: "not-ready",
    workItemIds: [],
    validationRunIds: [],
    reviewFindingIds: [],
    completionRecordId: undefined,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
}

export function migrateWorkflowSnapshot(
  snapshot: DevelopmentWorkflowSnapshot,
  workType: WorkflowWorkType,
): Workflow {
  const stageIds = generateStageIds(workType);
  const stages: WorkflowStage[] = [];

  // Map tasks to work items
  const workItems: WorkItem[] = snapshot.tasks.map((task: DevelopmentTask) => {
    const stageType = getStageTypeForTaskCategory(task.category);
    const stage = stages.find((s) => s.type === stageType);
    if (!stage) return null;
    return {
      id: uuidv4(),
      stageId: stage.id,
      title: task.title,
      description: task.description,
      objective: task.objective,
      category: task.category,
      dependencies: task.dependencies,
      requiredCapabilities: task.requiredCapabilities.map((c) => c),
      executionRoute: task.executionRoute,
      risk: task.risk,
      optional: task.optional,
      staleReasons: task.staleReasons,
      baseEntityFingerprints: task.baseEntityFingerprints,
      originalTaskId: task.id,
      createdAt: task.createdAt,
      updatedAt: task.updatedAt,
    };
  }).filter(Boolean) as WorkItem[];

  return {
    id: snapshot.id,
    repositoryId: snapshot.repositoryId,
    branch: snapshot.branch,
    baseCommit: snapshot.headCommit,
    intelligenceGeneration: snapshot.intelligenceGeneration,
    intentId: snapshot.intent.id,
    intentRevision: snapshot.intent.revision,
    specificationId: snapshot.specification?.id ?? "",
    specificationRevision: snapshot.specification?.revision ?? 1,
    workType,
    sdlcFlowConfigId: uuidv4(),
    stages,
    workItems,
    contextPackages: [],
    delegationRuns: [],
    validationRuns: [],
    reviewFindingIds: [],
    completionRecordId: undefined,
    status: "not-ready",
    currentStageId: undefined,
    blockingStageIds: [],
    createdAt: snapshot.createdAt,
    updatedAt: snapshot.updatedAt,
    startedAt: undefined,
    completedAt: undefined,
  };
}

// ============================================================================
// Migration from WorkflowInstance (orchestration)
// ============================================================================

function mapOrchestrationTaskState(
  taskState: {
    taskId: string;
    title: string;
    category?: string;
    dependencies: string[];
    requiredCapabilities: string[];
    route?: string;
    risk?: string;
    optional?: boolean;
  },
  stageIds: Record<WorkflowStageType, string>,
): WorkItem | undefined {
  const category = taskState.category ?? "implementation";
  const stageType = getStageTypeForTaskCategory(category);
  const id = stageIds[stageType ?? "understand"];
  if (!id) return undefined;
  return {
    id: uuidv4(),
    stageId: id,
    title: taskState.title,
    description: "",
    objective: "",
    category,
    dependencies: taskState.dependencies,
    requiredCapabilities: taskState.requiredCapabilities,
    executionRoute: taskState.route as "deterministic" | "github-copilot" | "manual" | "unsupported" | undefined,
    risk: taskState.risk as "low" | "medium" | "high" | "critical" | undefined,
    optional: taskState.optional,
    staleReasons: [],
    baseEntityFingerprints: {},
    originalTaskId: taskState.taskId,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
}

export function migrateOrchestrationWorkflow(
  instance: WorkflowInstance,
  workType: WorkflowWorkType,
): Workflow {
  const stageIds = generateStageIds(workType);
  const stages: WorkflowStage[] = [];

  // Create stages with default states
  const stageTypes: WorkflowStageType[] = [
    "understand", "plan", "development", "impact-analysis",
    "test-generation", "test-execution", "failure-analysis", "test-healing",
    "security-analysis", "performance-analysis", "pr-review", "complete",
  ];
  for (const type of stageTypes) {
    stages.push(createDefaultStage(type, stageIds[type]));
  }

  // Map task states to work items
  const workItems: WorkItem[] = instance.taskStates.map((ts) => {
    const wi = mapOrchestrationTaskState(ts, stageIds);
    if (wi) wi.originalTaskId = ts.taskId;
    return wi;
  }).filter(Boolean) as WorkItem[];

  // Map orchestration status to workflow status
  const statusMap: Record<string, import("../../shared/contracts/workflow").WorkflowStatus> = {
    "draft": "not-ready",
    "awaiting-review": "awaiting-approval",
    "awaiting-approval": "awaiting-approval",
    "ready": "ready",
    "running": "running",
    "paused": "blocked",
    "blocked": "blocked",
    "awaiting-user-action": "awaiting-approval",
    "validation-failed": "failed",
    "cancelling": "cancelled",
    "cancelled": "cancelled",
    "recovering": "preparing-context",
    "delivery-ready": "passed",
    "completed": "passed",
    "completed-with-warnings": "passed",
    "failed": "failed",
    "stale": "skipped",
    "superseded": "skipped",
  };

  return {
    id: instance.id,
    repositoryId: instance.repositoryId,
    branch: instance.branch,
    baseCommit: instance.baseCommit,
    intelligenceGeneration: instance.intelligenceGeneration,
    intentId: instance.intentId,
    intentRevision: instance.specificationRevision,
    specificationId: instance.specificationId,
    specificationRevision: instance.specificationRevision,
    workType,
    sdlcFlowConfigId: uuidv4(),
    stages,
    workItems,
    contextPackages: [],
    delegationRuns: [],
    validationRuns: instance.validationRunIds,
    reviewFindingIds: instance.findings.map((f) => f.id),
    completionRecordId: undefined,
    status: statusMap[instance.status] ?? "not-ready",
    currentStageId: instance.currentStage,
    blockingStageIds: [],
    createdAt: instance.createdAt,
    updatedAt: instance.updatedAt,
    startedAt: instance.startedAt,
    completedAt: instance.completedAt,
  };
}

// ============================================================================
// Migration from Intent/Specification/TaskGraph
// ============================================================================

export function createWorkflowFromIntent(
  intent: IntentRecord,
  specification: KeystoneSpecification,
  taskGraph: TaskGraph,
  repositoryId: string,
  workType: WorkflowWorkType,
): Workflow {
  const stageIds = generateStageIds(workType);
  const stages: WorkflowStage[] = [];

  const stageTypes: WorkflowStageType[] = [
    "understand", "plan", "development", "impact-analysis",
    "test-generation", "test-execution", "failure-analysis", "test-healing",
    "security-analysis", "performance-analysis", "pr-review", "complete",
  ];
  for (const type of stageTypes) {
    stages.push(createDefaultStage(type, stageIds[type]));
  }

  // Build work items from task IDs in the task graph
  const workItems: WorkItem[] = taskGraph.taskIds.map((taskId: string) => {
    const stageType: WorkflowStageType = "understand";
    return {
      id: uuidv4(),
      stageId: stageIds[stageType],
      title: `Task ${taskId.slice(0, 8)}`,
      description: "",
      objective: "",
      category: "implementation",
      dependencies: [],
      requiredCapabilities: [],
      executionRoute: undefined,
      risk: undefined,
      optional: false,
      staleReasons: [],
      baseEntityFingerprints: {},
      originalTaskId: taskId,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
  });

  return {
    id: uuidv4(),
    repositoryId,
    branch: specification.branch,
    baseCommit: specification.baseCommit,
    intelligenceGeneration: specification.indexVersion,
    intentId: intent.id,
    intentRevision: intent.revision,
    specificationId: specification.id,
    specificationRevision: specification.revision,
    workType,
    sdlcFlowConfigId: uuidv4(),
    stages,
    workItems,
    contextPackages: [],
    delegationRuns: [],
    validationRuns: [],
    reviewFindingIds: [],
    completionRecordId: undefined,
    status: "not-ready",
    currentStageId: undefined,
    blockingStageIds: [],
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    startedAt: undefined,
    completedAt: undefined,
  };
}

// ============================================================================
// Migration from Task (old model)
// ============================================================================

export function createWorkflowFromTask(
  task: z.infer<typeof TaskSchema>,
  specification: KeystoneSpecification,
  repositoryId: string,
  workType: WorkflowWorkType,
): Workflow {
  const stageIds = generateStageIds(workType);
  const stages: WorkflowStage[] = [];

  const stageTypes: WorkflowStageType[] = [
    "understand", "plan", "development", "impact-analysis",
    "test-generation", "test-execution", "failure-analysis", "test-healing",
    "security-analysis", "performance-analysis", "pr-review", "complete",
  ];
  for (const type of stageTypes) {
    stages.push(createDefaultStage(type, stageIds[type]));
  }

  const workItem: WorkItem = {
    id: uuidv4(),
    stageId: stageIds["understand"],
    title: task.title,
    description: task.description,
    objective: task.objective,
    category: "implementation",
    dependencies: task.dependencies,
    requiredCapabilities: [],
    executionRoute: undefined,
    risk: undefined,
    optional: false,
    staleReasons: [],
    baseEntityFingerprints: {},
    originalTaskId: task.id,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };

  return {
    id: uuidv4(),
    repositoryId,
    branch: specification.branch,
    baseCommit: specification.baseCommit,
    intelligenceGeneration: specification.indexVersion,
    intentId: uuidv4(),
    intentRevision: specification.revision,
    specificationId: specification.id,
    specificationRevision: specification.revision,
    workType,
    sdlcFlowConfigId: uuidv4(),
    stages,
    workItems: [workItem],
    contextPackages: [],
    delegationRuns: [],
    validationRuns: [],
    reviewFindingIds: [],
    completionRecordId: undefined,
    status: "not-ready",
    currentStageId: undefined,
    blockingStageIds: [],
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    startedAt: undefined,
    completedAt: undefined,
  };
}

// ============================================================================
// Exports
// ============================================================================

export type {
  Workflow,
  WorkflowStage,
  WorkItem,
  WorkflowWorkType,
};
