import type { AdapterCapability, AdapterDetection } from "../../../shared/contracts/adapters";
import type { SemanticSourceFileInput } from "../semantic/SemanticModel";
import type { IntelligenceAdapter } from "./IntelligenceAdapter";

export class AdapterRegistry {
  private readonly adapters = new Map<string, IntelligenceAdapter>();

  constructor(adapters: readonly IntelligenceAdapter[] = []) {
    for (const adapter of adapters) this.register(adapter);
  }

  register(adapter: IntelligenceAdapter): void {
    const existing = this.adapters.get(adapter.id);
    if (existing && existing.version !== adapter.version)
      throw new Error(
        `Adapter ${adapter.id} is already registered at version ${existing.version}.`,
      );
    this.adapters.set(adapter.id, adapter);
  }

  all(): IntelligenceAdapter[] {
    return [...this.adapters.values()].sort((left, right) => left.id.localeCompare(right.id));
  }
  capabilities(): AdapterCapability[] {
    return this.all().map((adapter) => adapter.capability());
  }

  detect(files: readonly SemanticSourceFileInput[]): AdapterDetection[] {
    const byTechnology = new Map<string, AdapterDetection[]>();
    for (const adapter of this.all())
      for (const detection of adapter.detect(files)) {
        const values = byTechnology.get(detection.technologyId) ?? [];
        values.push(detection);
        byTechnology.set(detection.technologyId, values);
      }
    const selected: AdapterDetection[] = [];
    for (const values of byTechnology.values()) {
      values.sort(
        (left, right) =>
          right.confidence - left.confidence ||
          capabilityRank(left.capabilityLevel) - capabilityRank(right.capabilityLevel) ||
          left.adapterId.localeCompare(right.adapterId),
      );
      const winner = values[0];
      if (!winner) continue;
      selected.push({
        ...winner,
        conflicts: values.slice(1).map((item) => `${item.adapterId}:${item.capabilityLevel}`),
      });
    }
    return selected.sort((left, right) => left.technologyId.localeCompare(right.technologyId));
  }
}

function capabilityRank(level: AdapterDetection["capabilityLevel"]): number {
  return ["deep", "semantic", "structural", "metadata-only", "unsupported"].indexOf(level);
}
