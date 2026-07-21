import { crypto } from "node:crypto";
import { KeystoneError } from "../../shared/errors/KeystoneError";
import {
  RerunActionSchema,
  RerunPlanResultSchema,
  RerunPlanSchema,
  RerunPlanRequestSchema,
  RerunStageSchema,
  RerunTriggerSchema,
  type RerunAction,
  type RerunPlan,
  type RerunPlanResult,
  type RerunPlanRequest,
  type RerunStage,
  type RerunTrigger,
} from "../../shared/contracts/rerun";
import type { DevelopmentWorkflowSnapshot } from "../../shared/contracts/delegation";

/**
 * RerunPlanner provides deterministic rerun paths for various triggers.
 */
export class WorkflowRerunPlanner {
  private readonly seed = crypto.randomUUID();

  /**
   * Plan a rerun based on the trigger.
   */
  plan(request: RerunPlanRequest): RerunPlanResult {
    const { workflowId, trigger } = request;
    const plan = this.planRerun(workflowId, trigger);
    return RerunPlanResultSchema.parse({
      plan,
      totalAffectedWorkItems: plan.stages.reduce((sum, stage) => sum + stage.actions.length, 0),
    });
  }

  /**
   * Generate a rerun plan for a specific trigger.
   */
  planRerun(workflowId: string, trigger: RerunTrigger): RerunPlan {
    const now = new Date().toISOString();
    const seed = `${workflowId}:${trigger}:${now}`;
    const stages = this.generateStages(trigger, seed);
    const estimatedTokens = this.estimateTokens(stages);

    return RerunPlanSchema.parse({
      id: crypto.randomUUID(),
      trigger,
      stages,
      totalEstimatedTokens: estimatedTokens,
      createdAt: now,
    });
  }

  /**
   * Generate the stages to rerun based on the trigger.
   */
  private generateStages(trigger: RerunTrigger, seed: string): RerunAction[] {
    const stages: RerunAction[] = [];
    const stageMap: Record<RerunStage, RerunAction> = {
      intent: {
        stage: "intent",
        action: "Review intent for drift",
        reason: "Intent may no longer match current repository state.",
        dependencies: [],
      },
      specification: {
        stage: "specification",
        action: "Review specification for staleness",
        reason: "Specification may reference outdated context.",
        dependencies: ["intent"],
      },
      "task-plan": {
        stage: "task-plan",
        action: "Review task plan for validity",
        reason: "Task plan may be incomplete or stale.",
        dependencies: ["specification"],
      },
      context: {
        stage: "context",
        action: "Regenerate context package",
        reason: "Context may be missing changed files or stale code.",
        dependencies: ["task-plan"],
      },
      development: {
        stage: "development",
        action: "Regenerate development context and prompt",
        reason: "Development context may be stale.",
        dependencies: ["context"],
      },
      "impact-analysis": {
        stage: "impact-analysis",
        action: "Rerun impact analysis",
        reason: "Impact analysis may be based on stale change set.",
        dependencies: ["development"],
      },
      qa: {
        stage: "qa",
        action: "Rerun QA plan and affected tests",
        reason: "QA plan may be based on stale impact analysis.",
        dependencies: ["impact-analysis"],
      },
      security: {
        stage: "security",
        action: "Rerun security analysis",
        reason: "Security analysis may be based on stale change set.",
        dependencies: ["impact-analysis"],
      },
      performance: {
        stage: "performance",
        action: "Rerun performance analysis",
        reason: "Performance analysis may be based on stale change set.",
        dependencies: ["impact-analysis"],
      },
      review: {
        stage: "review",
        action: "Rerun PR review",
        reason: "Review may be based on stale evidence.",
        dependencies: ["qa", "security", "performance"],
      },
      completion: {
        stage: "completion",
        action: "Rerun completion readiness",
        reason: "Completion readiness may be based on stale evidence.",
        dependencies: ["review"],
      },
    };

    // Map triggers to stages
    const stageMapForTrigger: Record<RerunTrigger, RerunStage[]> = {
      "source-code-changed": ["context", "development", "impact-analysis", "qa", "security", "performance", "review", "completion"],
      "test-only-changed": ["qa", "review", "completion"],
      "documentation-only-changed": ["review", "completion"],
      "instruction-changed": ["context", "development", "review", "completion"],
      "context-stale": ["development", "review", "completion"],
      "intelligence-changed": ["context", "development", "impact-analysis", "review", "completion"],
      "specification-changed": ["task-plan", "context", "development", "review", "completion"],
      "workflow-config-changed": ["context", "development", "review", "completion"],
      "execution-profile-changed": ["context", "development", "review", "completion"],
      "skill-changed": ["context", "development", "review", "completion"],
    };

    const stagesToRerun = stageMapForTrigger[trigger] ?? [];
    const shuffledStages = this.shuffle([...stagesToRerun], seed);

    for (const stage of shuffledStages) {
      stages.push(stageMap[stage]);
    }

    return stages;
  }

  /**
   * Estimate the token cost of a rerun plan.
   */
  private estimateTokens(stages: RerunAction[]): number {
    const baseTokens = 5000;
    const perStageTokens = 15000;
    return baseTokens + stages.length * perStageTokens;
  }

  /**
   * Shuffle an array using a deterministic seed.
   */
  private shuffle<T>(array: T[], seed: string): T[] {
    const result = [...array];
    const hash = this.hash(seed);
    for (let i = result.length - 1; i > 0; i--) {
      const j = (hash * (i + 1)) % (i + 1);
      [result[i], result[j]] = [result[j], result[i]];
    }
    return result;
  }

  /**
   * Hash a string to a number.
   */
  private hash(str: string): number {
    return crypto
      .createHash("sha256")
      .update(str)
      .digest("hex")
      .slice(0, 8)
      .reduce((acc, char) => acc + char.charCodeAt(0), 0);
  }
}
