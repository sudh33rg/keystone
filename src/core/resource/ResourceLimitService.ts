import { KeystoneError } from "../../shared/errors/KeystoneError";
import {
  type ResourceLimit,
  type ResourceLimitState,
} from "../../shared/contracts/resourceLimits";

/**
 * Resource limit definitions.
 */
const LIMITS: ResourceLimit[] = [
  {
    name: "maxWorkerConcurrency",
    description: "Maximum number of concurrent background workers",
    default: 8,
    maximum: 32,
    unit: "workers",
    enforced: true,
  },
  {
    name: "maxGraphNodeLimit",
    description: "Maximum number of nodes in the intelligence graph",
    default: 10000,
    maximum: 100_000,
    unit: "nodes",
    enforced: true,
  },
  {
    name: "maxQueryDepth",
    description: "Maximum depth for graph queries",
    default: 10,
    maximum: 20,
    unit: "depth",
    enforced: true,
  },
  {
    name: "maxContextCandidates",
    description: "Maximum number of context candidates retrieved",
    default: 50,
    maximum: 200,
    unit: "items",
    enforced: true,
  },
  {
    name: "maxRetainedLogSize",
    description: "Maximum size of retained logs",
    default: 100,
    maximum: 1000,
    unit: "lines",
    enforced: false,
  },
  {
    name: "maxReviewDiffSize",
    description: "Maximum size of review diff before progressive mode",
    default: 50000,
    maximum: 1_000_000,
    unit: "bytes",
    enforced: false,
  },
  {
    name: "maxSupportBundleSize",
    description: "Maximum size of support bundle",
    default: 10_000_000,
    maximum: 100_000_000,
    unit: "bytes",
    enforced: false,
  },
  {
    name: "maxCacheEntries",
    description: "Maximum number of cache entries",
    default: 1000,
    maximum: 10_000,
    unit: "entries",
    enforced: false,
  },
  {
    name: "maxHistoryRetention",
    description: "Maximum number of history items retained",
    default: 50,
    maximum: 500,
    unit: "items",
    enforced: false,
  },
];

/**
 * ResourceLimitService enforces resource limits.
 */
export class ResourceLimitService {
  private readonly limits: Map<string, ResourceLimit> = new Map(
    LIMITS.map((limit) => [limit.name, limit]),
  );
  private readonly states: Map<string, ResourceLimitState> = new Map();

  /**
   * Get the default limit for a resource.
   */
  getDefault(limitName: string): number {
    const limit = this.limits.get(limitName);
    if (!limit) throw new KeystoneError({
      code: "UNKNOWN_LIMIT",
      category: "RESOURCE",
      message: `Unknown resource limit: ${limitName}.`,
      technicalDetails: `Available limits: ${Array.from(this.limits.keys()).join(", ")}`,
      operation: "resource.limit",
      recoverable: true,
      recommendedAction: "Check the available limits.",
    });
    return limit.default;
  }

  /**
   * Get the maximum limit for a resource.
   */
  getMaximum(limitName: string): number {
    const limit = this.limits.get(limitName);
    if (!limit) throw new KeystoneError({
      code: "UNKNOWN_LIMIT",
      category: "RESOURCE",
      message: `Unknown resource limit: ${limitName}.`,
      technicalDetails: `Available limits: ${Array.from(this.limits.keys()).join(", ")}`,
      operation: "resource.limit",
      recoverable: true,
      recommendedAction: "Check the available limits.",
    });
    return limit.maximum ?? Infinity;
  }

  /**
   * Get the current state of a resource limit.
   */
  getState(limitName: string): ResourceLimitState {
    const limit = this.limits.get(limitName);
    if (!limit) throw new KeystoneError({
      code: "UNKNOWN_LIMIT",
      category: "RESOURCE",
      message: `Unknown resource limit: ${limitName}.`,
      technicalDetails: `Available limits: ${Array.from(this.limits.keys()).join(", ")}`,
      operation: "resource.limit",
      recoverable: true,
      recommendedAction: "Check the available limits.",
    });

    const current = this.states.get(limitName) ?? {
      name: limit.name,
      current: 0,
      limit: limit.default,
      unit: limit.unit,
      percentage: 0,
      exceeded: false,
    };

    const percentage = Math.round((current.current / current.limit) * 100);
    const exceeded = percentage >= 100;

    this.states.set(limitName, {
      ...current,
      percentage,
      exceeded,
    });

    return this.states.get(limitName)!;
  }

  /**
   * Record a resource usage.
   */
  recordUsage(limitName: string, amount: number): void {
    const current = this.getState(limitName);
    this.states.set(limitName, {
      ...current,
      current: current.current + amount,
    });
  }

  /**
   * Check if a resource usage is allowed.
   */
  checkUsage(limitName: string, amount: number): boolean {
    const limit = this.limits.get(limitName);
    if (!limit) throw new KeystoneError({
      code: "UNKNOWN_LIMIT",
      category: "RESOURCE",
      message: `Unknown resource limit: ${limitName}.`,
      technicalDetails: `Available limits: ${Array.from(this.limits.keys()).join(", ")}`,
      operation: "resource.check",
      recoverable: true,
      recommendedAction: "Check the available limits.",
    });

    const state = this.getState(limitName);
    const wouldExceed = state.current + amount > state.limit;

    if (wouldExceed) {
      this.recordUsage(limitName, amount);
      throw new KeystoneError({
        code: "RESOURCE_LIMIT_EXCEEDED",
        category: "RESOURCE",
        message: `Resource limit exceeded: ${limitName}`,
        technicalDetails: `${amount} would exceed the limit of ${state.limit} ${limit.unit}.`,
        operation: "resource.check",
        recoverable: true,
        recommendedAction: `The limit is ${limit.default} ${limit.unit}. You can increase it up to ${limit.maximum} ${limit.unit}.`,
      });
    }

    this.recordUsage(limitName, amount);
    return true;
  }

  /**
   * Get all limit states.
   */
  getAllStates(): ResourceLimitState[] {
    return Array.from(this.states.values());
  }

  /**
   * Get the limit that is closest to being exceeded.
   */
  getMostCritical(): ResourceLimitState | undefined {
    const sorted = Array.from(this.states.values())
      .filter((state) => state.exceeded)
      .sort((a, b) => b.percentage - a.percentage);
    return sorted[0];
  }

  /**
   * Get limits that are currently exceeded.
   */
  getExceeded(): ResourceLimitState[] {
    return Array.from(this.states.values()).filter((state) => state.exceeded);
  }

  /**
   * Get all limits.
   */
  getAllLimits(): ResourceLimit[] {
    return Array.from(this.limits.values());
  }

  /**
   * Get a limit by name.
   */
  getLimit(name: string): ResourceLimit | undefined {
    return this.limits.get(name);
  }
}
