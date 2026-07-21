import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { KeystoneError } from "../../shared/errors/KeystoneError";
import {
  FreshnessRecordSchema,
  FreshnessStatusSchema,
  FreshnessUpdateSchema,
  type FreshnessRecord,
  type FreshnessStatus,
  type FreshnessUpdate,
} from "../../shared/contracts/freshness";
import { WorkspaceStateStore } from "../persistence/WorkspaceStateStore";

/**
 * FreshnessStore provides persistence for freshness records.
 */
class FreshnessStore {
  constructor(private readonly store: WorkspaceStateStore) {}

  async initialize(): Promise<void> {
    // Records are persisted via the workspace state store
    // Freshness tracking is done in-memory with periodic persistence
  }

  getRecord(recordId: string): FreshnessRecord | undefined {
    return this.store.snapshot.freshnessRecords?.find((record) => record.id === recordId);
  }

  getAllRecords(): FreshnessRecord[] {
    return this.store.snapshot.freshnessRecords ?? [];
  }

  async updateRecord(recordId: string, updates: Partial<FreshnessRecord>): Promise<void> {
    const current = this.getRecord(recordId);
    if (!current) throw new Error(`Freshness record ${recordId} not found.`);

    const next: FreshnessRecord = {
      ...current,
      ...updates,
      updatedAt: new Date().toISOString(),
    };

    const records = this.store.snapshot.freshnessRecords ?? [];
    const index = records.findIndex((r) => r.id === recordId);
    if (index >= 0) records[index] = next;
    else records.push(next);

    this.store.update("freshnessRecords", records);
  }

  async emitUpdate(update: FreshnessUpdate): Promise<void> {
    const records = this.store.snapshot.freshnessRecords ?? [];
    const existing = records.find((r) => r.recordId === update.recordId);
    if (existing) {
      await this.updateRecord(existing.id, {
        status: update.newStatus,
        ...(update.reason ? { reason: update.reason } : {}),
        ...(update.previousStatus
          ? { invalidatedAt: update.previousStatus !== update.newStatus
              ? update.previousStatus === "current"
                ? new Date().toISOString()
                : undefined
              : undefined,
            invalidatedBy: update.previousStatus === "current" ? "freshness-check" : undefined }
          : {}),
      });
    }
  }
}

/**
 * FreshnessDependency describes a dependency between two records.
 */
type FreshnessDependency = {
  sourceId: string;
  sourceType: string;
  targetType: string;
  targetId: string;
  reason: string;
};

/**
 * WorkflowFreshnessService evaluates whether records remain valid after changes.
 *
 * It tracks dependencies between:
 * - specification
 * - workflow configuration
 * - execution profiles
 * - instructions
 * - skills
 * - context packages
 * - source files
 * - intelligence revisions
 * - change sets
 * - impact analysis
 * - test plans
 * - execution results
 * - security analysis
 * - performance analysis
 * - PR review
 */
export class WorkflowFreshnessService {
  private readonly store: FreshnessStore;
  private readonly dependencies: FreshnessDependency[] = [];
  private readonly updates: Array<() => Promise<void>> = [];

  constructor(store: WorkspaceStateStore) {
    this.store = new FreshnessStore(store);
  }

  async initialize(): Promise<void> {
    await this.store.initialize();
  }

  /**
   * Register a dependency between two records.
   */
  register(
    sourceId: string,
    sourceType: string,
    targetType: string,
    targetId: string,
    reason: string,
  ): void {
    this.dependencies.push({ sourceId, sourceType, targetType, targetId, reason });
  }

  /**
   * Invalidate a record due to upstream changes.
   */
  async invalidate(
    recordId: string,
    recordType: string,
    reason?: string,
    invalidatedBy?: string,
  ): Promise<void> {
    const status: FreshnessStatus = reason ? "stale" : "invalid";
    const update: FreshnessUpdate = {
      recordId,
      recordType,
      newStatus: status,
      ...(reason ? { reason: { code: "INVALIDATED", description: reason, affectedUpstreamIds: [] } } : {}),
    };

    await this.store.emitUpdate(update);

    // Propagate to downstream records
    for (const dep of this.dependencies) {
      if (dep.sourceId === recordId && dep.sourceType === recordType) {
        await this.invalidate(dep.targetId, dep.targetType, `${reason} — ${dep.reason}`);
      }
    }
  }

  /**
   * Refresh a record's freshness status.
   */
  async refresh(
    recordId: string,
    recordType: string,
    isValid: boolean,
    reason?: string,
  ): Promise<void> {
    const current = this.store.getRecord(recordId);
    if (!current) throw new Error(`Freshness record ${recordId} not found.`);

    const status: FreshnessStatus = isValid ? "current" : "stale";
    const previousStatus = current.status;

    await this.store.updateRecord(recordId, {
      status,
      reason: reason
        ? {
            code: reason.split(":")[0] ?? "UNKNOWN",
            description: reason,
            affectedUpstreamIds: [],
          }
        : undefined,
    });

    if (previousStatus !== status) {
      // Propagate downstream
      for (const dep of this.dependencies) {
        if (dep.sourceId === recordId && dep.sourceType === recordType) {
          await this.refresh(dep.targetId, dep.targetType, isValid, `${reason} — ${dep.reason}`);
        }
      }
    }
  }

  /**
   * Get the freshness status of a record.
   */
  getStatus(recordId: string, recordType: string): FreshnessStatus {
    const record = this.store.getRecord(recordId);
    return record ? record.status : "unknown";
  }

  /**
   * Get all records.
   */
  getAllRecords(): FreshnessRecord[] {
    return this.store.getAllRecords();
  }

  /**
   * Get the freshness state of all records.
   */
  getState(): {
    currentCount: number;
    staleCount: number;
    invalidCount: number;
    unknownCount: number;
  } {
    const records = this.store.getAllRecords();
    const current = records.filter((r) => r.status === "current").length;
    const stale = records.filter((r) => r.status === "stale").length;
    const invalid = records.filter((r) => r.status === "invalid").length;
    const unknown = records.filter((r) => r.status === "unknown").length;

    return { currentCount: current, staleCount: stale, invalidCount: invalid, unknownCount: unknown };
  }

  /**
   * Check if a workflow is fresh.
   */
  async isWorkflowFresh(workflowId: string): Promise<boolean> {
    const records = this.store.getAllRecords();
    const workflowRecords = records.filter(
      (r) => r.recordType.includes("workflow") || r.recordType.includes("specification") || r.recordType.includes("context") || r.recordType.includes("delegation") || r.recordType.includes("execution"),
    );
    return workflowRecords.every((r) => r.status === "current");
  }

  /**
   * Get stale records.
   */
  getStaleRecords(): FreshnessRecord[] {
    return this.store.getAllRecords().filter((r) => r.status !== "current");
  }
}
