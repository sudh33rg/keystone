import { WorkflowStageConfig, WorkflowStageType, WorkflowWorkType } from "../../shared/contracts/workflow";

interface DefaultFlowConfig {
  workType: WorkflowWorkType;
  stages: {
    id: string;
    type: WorkflowStageType;
    displayName: string;
    required: boolean;
    enabled: true;
    order: number;
  }[];
}

const STAGE_DISPLAY_NAMES: Record<WorkflowStageType, string> = {
  "understand": "Understand",
  "plan": "Plan",
  "development": "Development",
  "impact-analysis": "Impact Analysis",
  "test-generation": "Test Generation",
  "test-execution": "Test Execution",
  "failure-analysis": "Failure Analysis",
  "test-healing": "Test Healing",
  "security-analysis": "Security Analysis",
  "performance-analysis": "Performance Analysis",
  "pr-review": "PR Review",
  "complete": "Complete",
};

const DEFAULT_FLOWS: Record<WorkflowWorkType, DefaultFlowConfig> = {
  feature: {
    workType: "feature",
    stages: [
      { id: "u1", type: "understand", displayName: "Understand", required: true, enabled: true, order: 1 },
      { id: "p1", type: "plan", displayName: "Plan", required: true, enabled: true, order: 2 },
      { id: "d1", type: "development", displayName: "Development", required: true, enabled: true, order: 3 },
      { id: "ia1", type: "impact-analysis", displayName: "Impact Analysis", required: true, enabled: true, order: 4 },
      { id: "tg1", type: "test-generation", displayName: "Test Generation", required: true, enabled: true, order: 5 },
      { id: "te1", type: "test-execution", displayName: "Test Execution", required: true, enabled: true, order: 6 },
      { id: "sa1", type: "security-analysis", displayName: "Security Analysis", required: true, enabled: true, order: 7 },
      { id: "pa1", type: "performance-analysis", displayName: "Performance Analysis", required: true, enabled: true, order: 8 },
      { id: "pr1", type: "pr-review", displayName: "PR Review", required: true, enabled: true, order: 9 },
      { id: "c1", type: "complete", displayName: "Complete", required: true, enabled: true, order: 10 },
    ],
  },
  "bug-fix": {
    workType: "bug-fix",
    stages: [
      { id: "u1", type: "understand", displayName: "Understand", required: true, enabled: true, order: 1 },
      { id: "p1", type: "plan", displayName: "Plan", required: true, enabled: true, order: 2 },
      { id: "ia1", type: "impact-analysis", displayName: "Impact Analysis", required: true, enabled: true, order: 3 },
      { id: "d1", type: "development", displayName: "Development", required: true, enabled: true, order: 4 },
      { id: "tg1", type: "test-generation", displayName: "Test Generation", required: true, enabled: true, order: 5 },
      { id: "te1", type: "test-execution", displayName: "Test Execution", required: true, enabled: true, order: 6 },
      { id: "fa1", type: "failure-analysis", displayName: "Failure Analysis", required: true, enabled: true, order: 7 },
      { id: "th1", type: "test-healing", displayName: "Test Healing", required: true, enabled: true, order: 8 },
      { id: "pr1", type: "pr-review", displayName: "PR Review", required: true, enabled: true, order: 9 },
      { id: "c1", type: "complete", displayName: "Complete", required: true, enabled: true, order: 10 },
    ],
  },
  refactoring: {
    workType: "refactoring",
    stages: [
      { id: "u1", type: "understand", displayName: "Understand", required: true, enabled: true, order: 1 },
      { id: "ia1", type: "impact-analysis", displayName: "Impact Analysis", required: true, enabled: true, order: 2 },
      { id: "p1", type: "plan", displayName: "Plan", required: true, enabled: true, order: 3 },
      { id: "d1", type: "development", displayName: "Development", required: true, enabled: true, order: 4 },
      { id: "te1", type: "test-execution", displayName: "Test Execution", required: true, enabled: true, order: 5 },
      { id: "pa1", type: "performance-analysis", displayName: "Performance Analysis", required: true, enabled: true, order: 6 },
      { id: "pr1", type: "pr-review", displayName: "PR Review", required: true, enabled: true, order: 7 },
      { id: "c1", type: "complete", displayName: "Complete", required: true, enabled: true, order: 8 },
    ],
  },
  test: {
    workType: "test",
    stages: [
      { id: "u1", type: "understand", displayName: "Understand", required: true, enabled: true, order: 1 },
      { id: "ia1", type: "impact-analysis", displayName: "Impact Analysis", required: true, enabled: true, order: 2 },
      { id: "tg1", type: "test-generation", displayName: "Test Generation", required: true, enabled: true, order: 3 },
      { id: "te1", type: "test-execution", displayName: "Test Execution", required: true, enabled: true, order: 4 },
      { id: "fa1", type: "failure-analysis", displayName: "Failure Analysis", required: true, enabled: true, order: 5 },
      { id: "th1", type: "test-healing", displayName: "Test Healing", required: true, enabled: true, order: 6 },
      { id: "pr1", type: "pr-review", displayName: "PR Review", required: true, enabled: true, order: 7 },
      { id: "c1", type: "complete", displayName: "Complete", required: true, enabled: true, order: 8 },
    ],
  },
  investigation: {
    workType: "investigation",
    stages: [
      { id: "u1", type: "understand", displayName: "Understand", required: true, enabled: true, order: 1 },
      { id: "ia1", type: "impact-analysis", displayName: "Impact Analysis", required: true, enabled: true, order: 2 },
      { id: "c1", type: "complete", displayName: "Complete", required: true, enabled: true, order: 3 },
    ],
  },
};

function createStageConfig(stage: DefaultFlowConfig["stages"][0]): WorkflowStageConfig {
  return {
    id: stage.id,
    type: stage.type,
    displayName: stage.displayName,
    required: stage.required,
    enabled: stage.enabled,
    order: stage.order,
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
  };
}

/**
 * Generate the default SDLC flow configuration for a given work type.
 * Returns a list of stage configurations in the correct order.
 */
export function generateDefaultFlow(workType: WorkflowWorkType): WorkflowStageConfig[] {
  const config = DEFAULT_FLOWS[workType];
  if (!config) {
    throw new Error(`Unknown work type: ${workType}`);
  }
  return config.stages.map(createStageConfig);
}

/**
 * Get the default stage order for a given work type.
 * Returns the types of stages in order, without any optional/disabled stages.
 */
export function generateDefaultStageOrder(workType: WorkflowWorkType): WorkflowStageType[] {
  const config = DEFAULT_FLOWS[workType];
  if (!config) {
    throw new Error(`Unknown work type: ${workType}`);
  }
  return config.stages.map((s) => s.type);
}

/**
 * Get the display name for a workflow stage type.
 */
export function getStageDisplayName(type: WorkflowStageType): string {
  return STAGE_DISPLAY_NAMES[type];
}
