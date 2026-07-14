import type { ContextPackage, ContextItem } from "../../shared/contracts/domain";
import { KeystoneError } from "../../shared/errors/KeystoneError";
import type { ContextCompressionEngine } from "./ContextCompressionEngine";

export interface ContextPreview {
  package: ContextPackage;
  summary: {
    totalItems: number;
    includedItems: number;
    excludedItems: number;
    estimatedTokens: number;
    estimatedBytes: number;
    budget: number;
    utilization: number;
  };
  items: ContextItem[];
}

export class ContextPreviewService {
  constructor(
    private readonly compressionEngine: ContextCompressionEngine
  ) {}

  generatePreview(packageData: ContextPackage): ContextPreview {
    const summary = {
      totalItems: packageData.items.length,
      includedItems: packageData.items.filter(i => i.included).length,
      excludedItems: packageData.items.filter(i => !i.included).length,
      estimatedTokens: packageData.estimatedTokens,
      estimatedBytes: packageData.estimatedBytes,
      budget: packageData.budget,
      utilization: packageData.budget > 0
        ? Math.round((packageData.estimatedTokens / packageData.budget) * 100)
        : 0
    };

    return {
      package: packageData,
      summary,
      items: packageData.items
    };
  }

  applyPin(packageData: ContextPackage, pinTargets: string[]): ContextPackage {
    const updated = {
      ...packageData,
      items: packageData.items.map(item => ({
        ...item,
        isPinned: pinTargets.includes(item.sourceReference),
        included: pinTargets.includes(item.sourceReference) || item.included
      }))
    };
    return updated;
  }

  applyExclude(packageData: ContextPackage, excludeTargets: string[]): ContextPackage {
    const updated = {
      ...packageData,
      items: packageData.items.map(item => ({
        ...item,
        included: !excludeTargets.includes(item.sourceReference) && item.included
      }))
    };
    return updated;
  }

  applyBudget(packageData: ContextPackage, newBudget: number): ContextPackage {
    const result = this.compressionEngine.compress(packageData, newBudget);
    return result.package;
  }
}
