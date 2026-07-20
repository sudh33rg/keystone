import { v4 as uuidv4 } from "uuid";
import type { WorkItem, WorkflowStageType, Workflow, WorkflowWorkType } from "../../shared/contracts/workflow";
import type { DevelopmentTask} from "../../shared/contracts/delegation";

/**
 * Work item categories derived from task categories.
 */
export const WORK_ITEM_CATEGORIES: Record<string, string> = {
  "feature": "feature",
  "bug-fix": "bug-fix",
  "refactoring": "refactoring",
  "testing": "test",
  "investigation": "investigation",
  "modernization": "modernization",
  "performance": "performance",
  "security": "security",
  "documentation": "documentation",
  "review": "review",
  "maintenance": "maintenance",
  "migration": "migration",
  "infrastructure": "infrastructure",
  "implementation": "development",
  "validation": "validation",
  "manual": "manual",
};

/**
 * Map a development task to a work item for a given stage.
 *
 * Tasks are distributed to stages based on their category and the stage type.
 * The original task ID is preserved if possible.
 */
export function createWorkItemFromTask(
  task: DevelopmentTask,
  stageId: string,
): WorkItem {
  const category = WORK_ITEM_CATEGORIES[task.category] || task.category;
  return {
    id: uuidv4(),
    stageId,
    title: task.title,
    description: task.description,
    objective: task.objective,
    category,
    dependencies: task.dependencies,
    requiredCapabilities: task.requiredCapabilities,
    executionRoute: task.executionRoute,
    risk: task.risk,
    optional: task.optional,
    staleReasons: task.staleReasons,
    baseEntityFingerprints: task.baseEntityFingerprints,
    originalTaskId: task.id,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
}

/**
 * Create a new work item for a stage.
 */
export function createWorkItem(
  stageId: string,
  title: string,
  description: string,
  objective: string,
  category: string,
  dependencies: string[] = [],
  requiredCapabilities: string[] = [],
  executionRoute?: "deterministic" | "github-copilot" | "manual" | "unsupported",
  risk?: "low" | "medium" | "high" | "critical",
  optional?: boolean,
  staleReasons: string[] = [],
  baseEntityFingerprints: Record<string, string> = {},
  originalTaskId?: string,
): WorkItem {
  return {
    id: uuidv4(),
    stageId,
    title,
    description,
    objective,
    category,
    dependencies,
    requiredCapabilities,
    executionRoute,
    risk,
    optional,
    staleReasons,
    baseEntityFingerprints,
    originalTaskId,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
}

/**
 * Find the stage ID for a given stage type in a workflow.
 */
export function findStageId(workflow: Workflow, type: WorkflowStageType): string | undefined {
  return workflow.stages.find((s) => s.type === type)?.id;
}

/**
 * Get all work items for a stage.
 */
export function getStageWorkItems(workflow: Workflow, stageId: string): WorkItem[] {
  return workflow.workItems.filter((wi) => wi.stageId === stageId);
}

/**
 * Get the next stage type after the given type.
 */
export function getNextStageType(stageType: WorkflowStageType): WorkflowStageType | undefined {
  switch (stageType) {
    case "understand": return "plan";
    case "plan": return "development";
    case "development": return "impact-analysis";
    case "impact-analysis": return "test-generation";
    case "test-generation": return "test-execution";
    case "test-execution": return "failure-analysis";
    case "failure-analysis": return "test-healing";
    case "test-healing": return "security-analysis";
    case "security-analysis": return "performance-analysis";
    case "performance-analysis": return "pr-review";
    case "pr-review": return "complete";
    case "complete": return undefined;
  }
}

/**
 * Get the previous stage type before the given type.
 */
export function getPreviousStageType(stageType: WorkflowStageType): WorkflowStageType | undefined {
  switch (stageType) {
    case "understand": return undefined;
    case "plan": return "understand";
    case "development": return "plan";
    case "impact-analysis": return "understand";
    case "test-generation": return "impact-analysis";
    case "test-execution": return "test-generation";
    case "failure-analysis": return "test-execution";
    case "test-healing": return "failure-analysis";
    case "security-analysis": return "test-execution";
    case "performance-analysis": return "test-execution";
    case "pr-review": return "security-analysis";
    case "complete": return "pr-review";
  }
}

/**
 * Get the work type from a task category.
 */
export function getWorkTypeFromCategory(category: string): WorkflowWorkType | undefined {
  switch (category) {
    case "feature": return "feature";
    case "bug-fix": return "bug-fix";
    case "refactoring": return "refactoring";
    case "testing": return "test";
    case "investigation": return "investigation";
    case "modernization": return "feature";
    case "performance": return "feature";
    case "security": return "feature";
    case "documentation": return "feature";
    case "review": return "feature";
    case "maintenance": return "feature";
    case "migration": return "feature";
    case "infrastructure": return "feature";
    case "implementation": return "feature";
    case "validation": return "feature";
    case "manual": return "feature";
    default: return undefined;
  }
}

/**
 * Get the stage type for a given work item category.
 */
export function getStageTypeForCategory(category: string): WorkflowStageType | undefined {
  switch (category) {
    case "feature": return "development";
    case "bug-fix": return "development";
    case "refactoring": return "development";
    case "testing": return "test-execution";
    case "investigation": return "understand";
    case "modernization": return "development";
    case "performance": return "performance-analysis";
    case "security": return "security-analysis";
    case "documentation": return "plan";
    case "review": return "pr-review";
    case "maintenance": return "development";
    case "migration": return "development";
    case "infrastructure": return "development";
    case "implementation": return "development";
    case "validation": return "test-execution";
    case "manual": return "understand";
    default: return "development";
  }
}

/**
 * Get the stage type for a given task category.
 */
export function getStageTypeForTaskCategory(category: string): WorkflowStageType {
  return getStageTypeForCategory(category) || "development";
}
