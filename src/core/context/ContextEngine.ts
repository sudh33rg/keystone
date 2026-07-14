import type { RepositoryIndexService } from "../intelligence/RepositoryIndexService";
import type { AgentRegistry } from "../copilot/AgentRegistry";
import type { WorkspaceAdapter } from "../../extension/adapters/WorkspaceAdapter";
import type { IgnorePolicy } from "../intelligence/IgnorePolicy";
import {
  type ContextPackage,
  type ContextItem,
  ContextPackageSchema,
  SCHEMA_VERSION
} from "../../shared/contracts/domain";
import { KeystoneError } from "../../shared/errors/KeystoneError";

export interface ContextEngineResult {
  package: ContextPackage;
  estimate: { tokens: number; bytes: number };
}

export class ContextEngine {
  private policyVersion = 1;

  constructor(
    private readonly workspace: WorkspaceAdapter,
    private readonly index: RepositoryIndexService,
    private readonly agentRegistry: AgentRegistry,
    private readonly ignorePolicy: IgnorePolicy
  ) {}

  async buildPackage(
    taskId: string,
    specificationRevision: number,
    baseCommit?: string,
    pinnedItems?: string[]
  ): Promise<ContextEngineResult> {
    const fingerprint = this.computeFingerprint(taskId, specificationRevision, pinnedItems);
    const agentProfile = this.agentRegistry.getProfile("default");
    const budget = agentProfile?.defaultContextPolicy.maxEstimatedTokens ?? 12000;

    const candidates = this.selectCandidates(taskId, specificationRevision);
    const included = this.selectWithBudget(candidates, budget);
    const excluded = this.computeExcluded(candidates, included);

    const estimatedTokens = included.reduce((sum, item) => sum + item.estimatedTokens, 0);
    const estimatedBytes = included.reduce((sum, item) => sum + item.estimatedBytes, 0);

    const packageData: ContextPackage = {
      id: crypto.randomUUID(),
      taskId,
      specificationRevision,
      repositoryIndexVersion: this.index.getIndex()?.indexVersion ?? 0,
      baseCommit,
      createdAt: new Date().toISOString(),
      selectionPolicyVersion: this.policyVersion,
      budget,
      estimatedTokens,
      estimatedBytes,
      items: included,
      excludedCandidates: excluded,
      fingerprint,
      reviewStatus: "unreviewed"
    };

    const validated = ContextPackageSchema.safeParse(packageData);
    if (!validated.success) {
      throw new KeystoneError({
        code: "CONTEXT_PACKAGE_VALIDATION_FAILED",
        category: "CONTEXT",
        message: "Generated context package failed validation.",
        operation: "context.build",
        recoverable: false,
        recommendedAction: "Review the context selection and retry."
      });
    }

    return { package: validated.data, estimate: { tokens: estimatedTokens, bytes: estimatedBytes } };
  }

  private selectCandidates(taskId: string, specificationRevision: number): ContextItem[] {
    const items: ContextItem[] = [];

    // Seed: task objective
    items.push({
      kind: "objective",
      sourceReference: `task:${taskId}`,
      sourceFingerprint: `spec:${specificationRevision}`,
      selectionReason: "task-objective",
      rankScoreComponents: { explicitPin: 100 },
      compressionForm: "text",
      estimatedTokens: 200,
      estimatedBytes: 800,
      isMandatory: true,
      isPinned: true,
      included: true
    });

    // Add related tests if configured
    const config = this.workspace.getConfiguration("keystone.context");
    if (config.get("includeTests", true)) {
      items.push({
        kind: "related-test",
        sourceReference: `test:${taskId}`,
        sourceFingerprint: `spec:${specificationRevision}`,
        selectionReason: "related-test",
        rankScoreComponents: { relatedTestConfidence: 0.7 },
        compressionForm: "text",
        estimatedTokens: 500,
        estimatedBytes: 2000,
        isMandatory: false,
        isPinned: false,
        included: true
      });
    }

    return items;
  }

  private selectWithBudget(candidates: ContextItem[], budget: number): ContextItem[] {
    const included: ContextItem[] = [];
    let remaining = budget;

    // Include mandatory items first
    for (const candidate of candidates) {
      if (candidate.isMandatory) {
        if (remaining >= candidate.estimatedTokens) {
          included.push(candidate);
          remaining -= candidate.estimatedTokens;
        }
      }
    }

    // Include non-mandatory items in order
    const nonMandatory = candidates.filter((c) => !c.isMandatory);
    for (const candidate of nonMandatory) {
      if (remaining >= candidate.estimatedTokens) {
        included.push(candidate);
        remaining -= candidate.estimatedTokens;
      }
    }

    return included;
  }

  private computeExcluded(candidates: ContextItem[], included: ContextItem[]): { id: string; reason: string }[] {
    const includedIds = new Set(included.map((i) => i.sourceReference));
    return candidates
      .filter((c) => !includedIds.has(c.sourceReference))
      .map((c) => ({
        id: c.sourceReference,
        reason: c.estimatedTokens > 0 ? "over-budget" : "low-relevance"
      }));
  }

  private computeFingerprint(taskId: string, revision: number, pinnedItems?: string[]): string {
    const parts = [taskId, `rev:${revision}`];
    if (pinnedItems) {
      parts.push(...pinnedItems.sort());
    }
    return parts.join(":");
  }
}
