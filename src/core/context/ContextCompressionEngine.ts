import type { ContextPackage, ContextItem } from "../../shared/contracts/domain";

export interface CompressionResult {
  package: ContextPackage;
  removed: ContextItem[];
  preserved: ContextItem[];
  compressionRatio: number;
}

export class ContextCompressionEngine {
  private hooks: CompressionHook[] = [];

  constructor(private readonly defaultBudget: number = 12000) {}

  registerHook(hook: CompressionHook): void {
    this.hooks.push(hook);
  }

  compress(packageData: ContextPackage, budget?: number): CompressionResult {
    const targetBudget = budget ?? this.defaultBudget;
    let current = { ...packageData };
    const removed: ContextItem[] = [];
    const preserved: ContextItem[] = [];

    // Run pre-computation hooks
    for (const hook of this.hooks) {
      if (hook.phase === "pre") {
        current = this.applyHook(current);
      }
    }

    // Apply lossless compression: keep items within budget
    const remaining = targetBudget - (current.items.filter(i => i.isMandatory).reduce((sum, i) => sum + i.estimatedTokens, 0));
    const optional = current.items.filter(i => !i.isMandatory);

    for (const item of optional) {
      if (remaining >= item.estimatedTokens) {
        preserved.push(item);
      } else {
        removed.push(item);
      }
    }

    // Post-computation hooks
    for (const hook of this.hooks) {
      if (hook.phase === "post") {
        current = this.applyHook(current);
      }
    }

    const compressionRatio = current.items.length > 0
      ? removed.length / current.items.length
      : 0;

    return {
      package: current,
      removed,
      preserved,
      compressionRatio
    };
  }

  private applyHook(current: ContextPackage): ContextPackage {
    // Hook applies biases to rank scores
    return current;
  }
}

export interface CompressionHook {
  phase: "pre" | "post" | "computeBiases";
  name: string;
  apply: (item: ContextItem, biases: Record<string, number>) => ContextItem;
}

// Default hooks: pre/post/computeBiases
export const DEFAULT_COMPRESSION_HOOKS: CompressionHook[] = [
  {
    phase: "computeBiases",
    name: "git-bias",
    apply: (item) => item
  }
];
