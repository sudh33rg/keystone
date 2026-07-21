/**
 * TaskContextService — single, canonical context-compression pipeline.
 *
 * Phase 3 replaced the Phase-1 character-estimate pipeline with the measured,
 * stage-aware compression engine (ContextPackageService). TaskContextService is
 * now a thin compatibility facade: it builds the canonical ContextPackage and
 * still exposes the legacy helper classes (ContextRanker / ContextCompressor /
 * ContextBudgetService / ContextDiagnosticsService) re-exported via ContextEngine
 * so existing tests continue to pass.
 *
 * There is exactly ONE compression pipeline. The legacy TaskContextPackage /
 * delegation.ts ContextItem models are retained only for backward-compatible
 * persistence and the legacy test; they are no longer the active path.
 */

import type { DelegationPersistenceStore } from "../persistence/DelegationPersistenceStore";
import {
  ContextBudgetSchema,
  type ContextBudget,
  type ContextItem,
  type DevelopmentSpecification,
  type DevelopmentTask,
  type TaskContextPackage,
} from "../../shared/contracts/delegation";
import {
  type ContextPackage,
  type ContextPackageBuildInput,
} from "../../shared/contracts/contextPackage";
import type { ContextPackageService } from "./ContextPackageService";
import type { ContextPersistenceStore } from "./ContextPersistenceStore";

export interface ContextBuildInput {
  task: DevelopmentTask;
  specification: DevelopmentSpecification;
  selectedAgentId?: string;
  budget?: Partial<ContextBudget>;
  pinnedEntityIds?: string[];
  pinnedFiles?: string[];
  currentFile?: string;
  currentSelection?: { relativePath: string; startLine: number; endLine: number };
  signal?: AbortSignal;
}

export const CONTEXT_RANKING_WEIGHTS = Object.freeze({
  required: 1000,
  userPin: 500,
  directTaskReference: 300,
  acceptanceCriterion: 250,
  expectedFile: 220,
  primaryEntity: 210,
  directRelationship: 150,
  testMapping: 140,
  apiOrData: 130,
  sameModule: 90,
  samePackage: 80,
  recentChange: 60,
  confidence: 100,
  stale: -300,
  sizePerK: -2,
});

/**
 * Legacy helper classes retained for ContextEngine.test.ts (deterministic
 * ranking / compression / budgeting over the legacy ContextItem shape).
 */
export class ContextRanker {
  rank(items: ContextItem[]): ContextItem[] {
    return items
      .map((value) => ({ ...value, priority: score(value) }))
      .sort((left, right) => right.priority - left.priority || left.id.localeCompare(right.id));
  }
}

export class ContextBudgetService {
  resolve(input?: Partial<ContextBudget>): ContextBudget {
    return ContextBudgetSchema.parse(input ?? {});
  }
  fits(items: ContextItem[], budget: ContextBudget): boolean {
    return (
      sum(items, "estimatedTokens") <= budget.maxEstimatedTokens &&
      sum(items, "estimatedCharacters") <= budget.maxCharacters
    );
  }
}

export class ContextCompressor {
  constructor(private readonly budgets = new ContextBudgetService()) {}
  compress(
    candidates: ContextItem[],
    budget: ContextBudget,
  ): {
    included: ContextItem[];
    excluded: TaskContextPackage["exclusions"];
    diagnostics: TaskContextPackage["diagnostics"];
  } {
    const unique = new Map<string, ContextItem>();
    const excluded: TaskContextPackage["exclusions"] = [];
    for (const candidate of candidates) {
      const key = `${candidate.kind}:${candidate.sourceEntityId ?? candidate.relativePath ?? candidate.content}`;
      const existing = unique.get(key);
      if (!existing || candidate.required || candidate.priority > existing.priority) {
        if (existing) excluded.push({ item: existing, reason: "duplicate", restorable: false });
        unique.set(key, candidate);
      } else excluded.push({ item: candidate, reason: "duplicate", restorable: false });
    }
    const required = [...unique.values()].filter((item) => item.required);
    const included = [...required];
    const diagnostics: TaskContextPackage["diagnostics"] = [];
    if (!this.budgets.fits(required, budget))
      diagnostics.push({
        code: "required-context-over-budget",
        severity: "error",
        message: "Required context exceeds the configured budget; delegation is blocked.",
      });
    for (const candidate of [...unique.values()]
      .filter((item) => !item.required)
      .sort(
        (left, right) =>
          tierRank(right.tier) - tierRank(left.tier) || right.priority - left.priority,
      )) {
      if (this.budgets.fits([...included, candidate], budget)) included.push(candidate);
      else excluded.push({ item: candidate, reason: "over-budget", restorable: true });
    }
    return { included, excluded, diagnostics };
  }
}

export class ContextDiagnosticsService {
  validate(packageData: TaskContextPackage): TaskContextPackage["diagnostics"] {
    const diagnostics = [...packageData.diagnostics];
    if (packageData.items.some((item) => secretLike(item.content)))
      diagnostics.push({
        code: "secret-like-context",
        severity: "error",
        message: "Secret-like content was detected; the package cannot be delegated.",
      });
    if (!packageData.items.some((item) => item.kind === "acceptance-criterion"))
      diagnostics.push({
        code: "missing-criteria",
        severity: "error",
        message: "No task-linked acceptance criterion is present.",
      });
    return diagnostics.slice(0, 100);
  }
}

/**
 * Active context service. Delegates to the canonical measured compression
 * engine and persists the canonical ContextPackage.
 */
export class TaskContextService {
  private cache = new Map<string, ContextPackage>();
  readonly ranker = new ContextRanker();
  readonly compressor = new ContextCompressor();
  readonly budgets = new ContextBudgetService();
  readonly diagnostics = new ContextDiagnosticsService();
  private engine: ContextPackageService | undefined;

  constructor(
    collector: unknown,
    private readonly persistence: DelegationPersistenceStore,
    private readonly store: ContextPersistenceStore,
  ) {
    void collector;
  }

  /** Inject the canonical engine (constructed in extension.ts with full deps). */
  useEngine(engine: ContextPackageService): void {
    this.engine = engine;
  }

  async build(input: ContextBuildInput): Promise<ContextPackage> {
    if (!this.engine)
      throw new Error("ContextPackageService engine is not wired into TaskContextService.");
    const buildInput: ContextPackageBuildInput = {
      workflowId: input.task.workflowId,
      stageId: input.budget ? "development" : "development",
      workItemId: input.task.id,
      executionProfileId: "default",
      profileId: undefined,
      budgetTokens: input.budget?.maxEstimatedTokens,
      pinnedItemIds: [...(input.pinnedEntityIds ?? []), ...(input.pinnedFiles ?? [])],
      instructionIds: [],
      skillIds: [],
      includeWorkflowIntent: true,
      includeSpecification: true,
      includeAcceptanceCriteria: true,
      includeStageHistory: true,
      includeValidationEvidence: true,
      includeUserPinnedContext: true,
    };
    const pkg = await this.engine.build(buildInput, {
      task: input.task,
      specification: input.specification,
      instructionContents: [],
      skillContents: [],
      intelligenceGeneration: 0,
      repositoryRevision: undefined,
      instructionRevisionHash: "legacy",
      currentFile: input.currentFile,
      currentSelection: input.currentSelection,
      signal: input.signal,
    });
    this.cache.set(pkg.id, pkg);
    return pkg;
  }

  get(taskId: string): ContextPackage | undefined {
    return this.cache.get(taskId) ?? this.store.getByWorkItem(taskId);
  }

  async pin(taskId: string, itemId: string, pinned: boolean): Promise<ContextPackage> {
    const engine = this.requireEngine();
    return engine.pin(taskId, itemId, pinned);
  }
  async remove(taskId: string, itemId: string, overrideRequired = false): Promise<ContextPackage> {
    return this.requireEngine().remove(taskId, itemId, overrideRequired);
  }
  async restore(taskId: string, itemId: string): Promise<ContextPackage> {
    return this.requireEngine().restore(taskId, itemId);
  }
  async review(taskId: string, fingerprint: string): Promise<ContextPackage> {
    return this.requireEngine().approve(taskId, fingerprint);
  }
  async invalidate(taskId: string, reason: string): Promise<void> {
    await this.store.markStale(taskId, reason);
  }

  private requireEngine(): ContextPackageService {
    if (!this.engine)
      throw new Error("ContextPackageService engine is not wired into TaskContextService.");
    return this.engine;
  }
}

export class ContextPreviewService {
  preview(packageData: ContextPackage): ContextPackage {
    return structuredClone(packageData);
  }
}

export class ContextEngine extends TaskContextService {}

// --- legacy helpers used by ContextEngine.test.ts ---

function score(value: ContextItem): number {
  return (
    value.priority +
    (value.required ? CONTEXT_RANKING_WEIGHTS.required : 0) +
    (value.pinned ? CONTEXT_RANKING_WEIGHTS.userPin : 0) +
    value.confidence * CONTEXT_RANKING_WEIGHTS.confidence +
    Math.ceil(value.estimatedCharacters / 1000) * CONTEXT_RANKING_WEIGHTS.sizePerK +
    (value.freshness === "stale" ? CONTEXT_RANKING_WEIGHTS.stale : 0)
  );
}
function tierRank(value: ContextItem["tier"]): number {
  return value === "required" ? 3 : value === "supporting" ? 2 : 1;
}
function sum<K extends "estimatedTokens" | "estimatedCharacters">(
  items: ContextItem[],
  key: K,
): number {
  return items.reduce((total, item) => total + item[key], 0);
}
function secretLike(value: string): boolean {
  return /gh[pousr]_[A-Za-z0-9_]{20,}|AKIA[0-9A-Z]{16}|-----BEGIN [A-Z ]*PRIVATE KEY-----/i.test(
    value,
  );
}
