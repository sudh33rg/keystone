import type { ContextPack } from "../../context/compression/types";
import type { ImpactedTestSuggestion } from "../quality/impactedTests";

export type SDLCIntent =
  | "feature"
  | "bug_fix"
  | "test_planning"
  | "review"
  | "explanation"
  | "implementation";

export type SDLCTaskPacket = {
  id: string;
  intent: SDLCIntent;
  userRequest: string;
  objective: string;
  workflowSteps: string[];
  completionCriteria: string[];
  nonGoals: string[];
  contextPack: ContextPack;
  validationCommands: string[];
  impactedTests: ImpactedTestSuggestion[];
  risks: string[];
  /** Rubric ID for post-edit verification (e.g., 'bug-fix', 'feature', 'review') */
  rubricId?: string;
};

export type WorkflowStepStatus = "pending" | "in_progress" | "done" | "blocked" | "skipped";

export type WorkflowStepExecution = {
  id: string;
  order: number;
  title: string;
  status: WorkflowStepStatus;
  updatedAt: string;
  notes?: string;
};

export type WorkflowExecutionState = {
  workflowId: string;
  status: "not_started" | "in_progress" | "blocked" | "done";
  currentStepId?: string;
  startedAt: string;
  updatedAt: string;
  steps: WorkflowStepExecution[];
};
