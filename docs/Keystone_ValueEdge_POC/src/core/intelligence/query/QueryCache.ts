import type { IntelligenceQueryResult } from "../../../shared/contracts/query";

interface CacheEntry {
  key: string;
  generation: number;
  versionIdentity: string;
  entityIds: Set<string>;
  result: IntelligenceQueryResult;
  accessedAt: number;
}

export class QueryCache {
  private readonly values = new Map<string, CacheEntry>();
  constructor(private readonly capacity = 100) {}

  get(
    key: string,
    generation: number,
    versionIdentity: string,
  ): IntelligenceQueryResult | undefined {
    const entry = this.values.get(key);
    if (!entry || entry.generation !== generation || entry.versionIdentity !== versionIdentity) {
      if (entry) this.values.delete(key);
      return undefined;
    }
    entry.accessedAt = Date.now();
    this.values.delete(key);
    this.values.set(key, entry);
    return structuredClone(entry.result);
  }

  set(
    key: string,
    generation: number,
    versionIdentity: string,
    entityIds: Iterable<string>,
    result: IntelligenceQueryResult,
  ): void {
    this.values.set(key, {
      key,
      generation,
      versionIdentity,
      entityIds: new Set(entityIds),
      result: structuredClone(result),
      accessedAt: Date.now(),
    });
    while (this.values.size > this.capacity)
      this.values.delete(this.values.keys().next().value as string);
  }

  invalidateGeneration(generation: number): number {
    return this.remove((entry) => entry.generation !== generation);
  }
  invalidateEntities(entityIds: Iterable<string>): number {
    const ids = new Set(entityIds);
    return this.remove((entry) => [...entry.entityIds].some((id) => ids.has(id)));
  }
  clear(): number {
    const count = this.values.size;
    this.values.clear();
    return count;
  }
  size(): number {
    return this.values.size;
  }
  private remove(predicate: (entry: CacheEntry) => boolean): number {
    let count = 0;
    for (const [key, entry] of this.values)
      if (predicate(entry)) {
        this.values.delete(key);
        count += 1;
      }
    return count;
  }
}
