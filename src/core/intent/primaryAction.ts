export type IntentLifecycle =
  "DRAFT" | "UNDERSTANDING" | "READY" | "IN_PROGRESS" | "BLOCKED" | "REVIEW" | "COMPLETE";
export type IntentOperation =
  | "UNDERSTAND_INTENT"
  | "ANSWER_QUESTION"
  | "PLAN_CHANGE"
  | "IMPLEMENT"
  | "DEBUG"
  | "REVIEW_CHANGE"
  | "SECURITY_ANALYSIS"
  | "PERFORMANCE_ANALYSIS"
  | "EXPLAIN";

/**
 * The small, user-facing vocabulary for the next Intent action. The operation is
 * intentionally kept on the domain side of the boundary; the webview only renders
 * the label and description.
 */
export type IntentPrimaryActionId =
  "understand" | "clarify" | "develop" | "continue" | "resolve-blocker" | "review" | "follow-up";

export interface IntentPrimaryAction {
  id: IntentPrimaryActionId;
  label: string;
  description: string;
  operation?: IntentOperation;
  enabled: boolean;
}

export interface IntentActionState {
  lifecycle: IntentLifecycle;
  goal: string;
  currentObjective: string;
  openQuestions: readonly string[];
  blockers: readonly { summary: string; resolvedAt?: string }[];
}

/** Select the next Copilot operation from durable Intent state only. */
export function selectIntentPrimaryAction(state: IntentActionState): IntentPrimaryAction {
  const objective = sentence(state.currentObjective || state.goal);
  switch (state.lifecycle) {
    case "DRAFT":
      return {
        id: "understand",
        label: "Understand Intent",
        description: "Prepare a repository-backed understanding before work begins.",
        operation: "UNDERSTAND_INTENT",
        enabled: true
      };
    case "UNDERSTANDING": {
      const question = state.openQuestions.find(Boolean);
      return {
        id: "clarify",
        label: "Continue clarification",
        description: question ? `Resolve the key question: ${sentence(question)}` : objective,
        operation: question ? "ANSWER_QUESTION" : "UNDERSTAND_INTENT",
        enabled: true
      };
    }
    case "READY":
      return {
        id: "develop",
        label: "Develop approach",
        description: objective
          ? `Develop an approach for ${objective}`
          : "Develop the next approach.",
        operation: "PLAN_CHANGE",
        enabled: true
      };
    case "IN_PROGRESS":
      return {
        id: "continue",
        label: "Continue with Copilot",
        description: objective || "Continue the current objective with Copilot.",
        operation: operationForObjective(state.currentObjective),
        enabled: true
      };
    case "BLOCKED": {
      const blocker = state.blockers.find((item) => !item.resolvedAt)?.summary;
      return {
        id: "resolve-blocker",
        label: "Resolve Blocker",
        description: blocker
          ? `Discuss the required decision: ${sentence(blocker)}`
          : "Discuss the decision required to continue.",
        operation: "ANSWER_QUESTION",
        enabled: true
      };
    }
    case "REVIEW":
      return {
        id: "review",
        label: "Review Changes",
        description: "Inspect the current changes and validation evidence.",
        operation: "REVIEW_CHANGE",
        enabled: true
      };
    case "COMPLETE":
      return {
        id: "follow-up",
        label: "Follow up",
        description: "No automatic follow-up is needed. Choose an explicit follow-up when ready.",
        enabled: false
      };
  }
}

function operationForObjective(objective: string): IntentOperation {
  const value = objective.toLowerCase();
  if (/\b(review|inspect|validate|audit|check|assess)\b/.test(value)) return "REVIEW_CHANGE";
  if (/\b(debug|fix|bug|error|failure|broken|repair)\b/.test(value)) return "DEBUG";
  if (/\b(security|vulnerab|threat|permission|auth)\b/.test(value)) return "SECURITY_ANALYSIS";
  if (/\b(performance|latency|slow|benchmark|throughput)\b/.test(value))
    return "PERFORMANCE_ANALYSIS";
  if (/\b(explain|why|understand)\b/.test(value)) return "EXPLAIN";
  return "IMPLEMENT";
}

function sentence(value: string): string {
  const trimmed = value.trim();
  if (!trimmed) return "";
  return /[.!?]$/.test(trimmed) ? trimmed : `${trimmed}.`;
}
