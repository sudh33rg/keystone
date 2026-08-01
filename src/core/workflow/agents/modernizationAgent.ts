import type { ContextPack, ModernizationAssessment, RiskLevel } from "../../domain/types";

export class ModernizationAgent {
  assess(pack: ContextPack): ModernizationAssessment {
    const candidates = pack.modernizationConstraints.concat(
      pack.relevantFiles
        .filter((file) => file.lineCount > 500 || /legacy|old|deprecated/i.test(file.path))
        .map((file) => `${file.path}: modernization hotspot`)
    );
    const riskLevel: RiskLevel = candidates.length > 1 ? "medium" : "low";
    return {
      riskLevel,
      candidates,
      behaviorMapping: ["Map current inputs, outputs, side effects, error behavior, and tests before implementation."],
      safetyRequirements: [
        "current behavior mapped",
        "regression tests identified",
        "security impact reviewed",
        "performance impact reviewed",
        "user approval captured"
      ],
      phasedPlan: [
        "Assess legacy area",
        "Map behavior",
        "Identify risk",
        "Build regression safety net",
        "Create phased plan",
        "Request user approval",
        "Delegate scoped work to Copilot",
        "Run QA/security/performance validation",
        "Prepare PR evidence"
      ],
      requiresApproval: true,
      copilotReadyTasks: ["No modernization implementation task is Copilot-ready until approval and safety requirements are complete."]
    };
  }
}
