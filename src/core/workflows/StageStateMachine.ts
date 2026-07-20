import { WorkflowState, WorkflowStage, WorkflowStageType } from "../../shared/contracts/workflow";

/**
 * Transition error types for invalid state changes.
 */
export type WorkflowTransitionError =
  | { kind: "invalid-state" }
  | { kind: "invalid-transition"; from: WorkflowState; to: WorkflowState }
  | { kind: "blocking"; reason: string };

/**
 * Transitions from each state to allowed next states.
 */
const TRANSITIONS: Record<WorkflowState, WorkflowState[]> = {
  "not-ready": ["ready"],
  "ready": ["preparing-context"],
  "preparing-context": ["awaiting-approval", "delegating"],
  "awaiting-approval": ["delegating", "ready"],
  "delegating": ["running", "skipped"],
  "running": ["awaiting-result-review"],
  "awaiting-result-review": ["validating"],
  "validating": ["passed", "failed", "blocked"],
  "passed": ["ready"],
  "failed": ["ready"],
  "blocked": ["ready"],
  "skipped": ["ready"],
  "cancelled": [],
};

/**
 * Check if a stage is ready to begin execution.
 *
 * A stage becomes ready only when:
 * - It is enabled
 * - All required predecessor stages have passed or were explicitly skipped
 * - Required specification information exists
 * - Required intelligence generation is available
 * - Required execution capabilities are available
 */
export function isStageReady(
  stage: WorkflowStage,
  enabled: boolean,
  predecessorStates: Record<string, WorkflowState>,
  specInfoAvailable: boolean,
  intelligenceAvailable: boolean,
  capabilitiesAvailable: boolean,
): boolean {
  if (!stage.enabled) return false;
  if (!specInfoAvailable) return false;
  if (!intelligenceAvailable) return false;
  if (!capabilitiesAvailable) return false;
  if (stage.required === "required") {
    const predecessors = getPredecessorStageIds(stage.type);
    for (const predId of predecessors) {
      const predState = predecessorStates[predId];
      if (predState !== "passed" && predState !== "skipped") return false;
    }
  }
  return true;
}

/**
 * Check if a transition from one state to another is valid.
 */
export function canTransition(stage: WorkflowStage, from: WorkflowState, to: WorkflowState): boolean {
  if (!TRANSITIONS[from].includes(to)) return false;
  if (to === "ready" && from !== "passed" && from !== "failed" && from !== "blocked" && from !== "skipped") return false;
  return true;
}

/**
 * Validate a state transition and return an error if invalid.
 */
export function validateTransition(
  stage: WorkflowStage,
  from: WorkflowState,
  to: WorkflowState,
  conditionsMet: boolean,
): WorkflowTransitionError | null {
  if (!canTransition(stage, from, to)) {
    return { kind: "invalid-transition", from, to };
  }
  if (!conditionsMet && to !== "cancelled") {
    return { kind: "blocking", reason: "Preconditions not met" };
  }
  return null;
}

/**
 * Get the predecessor stage IDs for a given stage type.
 */
function getPredecessorStageIds(stageType: WorkflowStageType): WorkflowStageType[] {
  switch (stageType) {
    case "understand": return [];
    case "plan": return ["understand"];
    case "development": return ["understand", "plan"];
    case "impact-analysis": return ["understand"];
    case "test-generation": return ["impact-analysis"];
    case "test-execution": return ["test-generation"];
    case "failure-analysis": return ["test-execution"];
    case "test-healing": return ["failure-analysis"];
    case "security-analysis": return ["test-execution"];
    case "performance-analysis": return ["test-execution"];
    case "pr-review": return ["security-analysis", "performance-analysis"];
    case "complete": return ["pr-review"];
  }
}

/**
 * Get the successor stage IDs for a given stage type.
 */
export function getSuccessorStageIds(stageType: WorkflowStageType): WorkflowStageType[] {
  switch (stageType) {
    case "understand": return ["plan", "impact-analysis"];
    case "plan": return ["development", "impact-analysis"];
    case "development": return ["impact-analysis", "test-generation"];
    case "impact-analysis": return ["plan", "development", "test-generation"];
    case "test-generation": return ["test-execution"];
    case "test-execution": return ["failure-analysis", "security-analysis", "performance-analysis"];
    case "failure-analysis": return ["test-healing"];
    case "test-healing": return [];
    case "security-analysis": return ["pr-review"];
    case "performance-analysis": return ["pr-review"];
    case "pr-review": return ["complete"];
    case "complete": return [];
  }
}

/**
 * Get the next ready stage type given the current stage type and predecessor states.
 * Returns undefined if no next stage is ready.
 */
export function getNextReadyStageType(
  currentStageType: WorkflowStageType,
  enabledStages: WorkflowStageType[],
  predecessorStates: Record<string, WorkflowState>,
): WorkflowStageType | undefined {
  for (const type of getSuccessorStageIds(currentStageType)) {
    if (!enabledStages.includes(type)) continue;
    const preds = getPredecessorStageIds(type);
    if (preds.every((p) => predecessorStates[p] === "passed" || predecessorStates[p] === "skipped")) {
      return type;
    }
  }
  return undefined;
}
