export type CopilotActivityState = "QUEUED" | "RUNNING" | "COMPLETED" | "FAILED" | "CANCELLED";

export type CopilotActivityPhase =
  | "understanding"
  | "finding-pattern"
  | "inspecting-components"
  | "checking-workspace"
  | "expanding-context"
  | "comparing-options"
  | "preparing-changes"
  | "reviewing-files"
  | "preparing-recommendation";

export interface CopilotActivityEvent {
  id: string;
  intentId?: string;
  phase: CopilotActivityPhase;
  label: string;
  state: CopilotActivityState;
  progress?: number;
  timestamp: string;
  detail?: string;
}

export const COPILOT_ACTIVITY_LABELS: Record<CopilotActivityPhase, string> = {
  understanding: "Understanding authentication architecture",
  "finding-pattern": "Finding an existing repository pattern",
  "inspecting-components": "Inspecting affected components",
  "checking-workspace": "Checking current workspace changes",
  "expanding-context": "Expanding relevant context",
  "comparing-options": "Comparing implementation options",
  "preparing-changes": "Preparing changes",
  "reviewing-files": "Reviewing modified files",
  "preparing-recommendation": "Preparing recommendation"
};

export function copilotActivityPhase(stage: string, message = ""): CopilotActivityPhase {
  const value = `${stage} ${message}`.toLowerCase();
  if (value.includes("reuse") || value.includes("pattern")) return "finding-pattern";
  if (value.includes("intelligence") && value.includes("impact")) return "inspecting-components";
  if (value.includes("intelligence") && value.includes("flow")) return "expanding-context";
  if (value.includes("intelligence")) return "finding-pattern";
  if (value.includes("context") && (value.includes("expand") || value.includes("retriev"))) return "expanding-context";
  if (value.includes("impact") || value.includes("relationship") || value.includes("symbol")) return "inspecting-components";
  if (value.includes("pattern")) return "finding-pattern";
  if (value.includes("workspace") || value.includes("change")) return "checking-workspace";
  if (value.includes("structured") || value.includes("response") || value.includes("recommend")) return "preparing-recommendation";
  if (value.includes("stream") || value.includes("request") || value.includes("model")) return "comparing-options";
  if (value.includes("prepar")) return "preparing-changes";
  return "understanding";
}
