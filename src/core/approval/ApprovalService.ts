import {
  type Approval,
  type ApprovalType,
} from "../../shared/contracts/approval";
import { WorkspaceStateStore } from "../persistence/WorkspaceStateStore";

/**
 * ApprovalStore provides persistence for approval records.
 */
class ApprovalStore {
  constructor(private readonly store: WorkspaceStateStore) {}

  async initialize(): Promise<void> {
    // Records are persisted via the workspace state store
  }

  getApproval(approvalId: string): Approval | undefined {
    return this.store.snapshot.approvalRecords?.find((approval) => approval.id === approvalId);
  }

  getAllApprovals(): Approval[] {
    return this.store.snapshot.approvalRecords ?? [];
  }

  async updateApproval(
    approvalId: string,
    updates: Partial<Approval>,
    emitUpdate: (approval: Approval) => void | Promise<void>,
  ): Promise<Approval> {
    const current = this.getApproval(approvalId);
    if (!current) throw new Error(`Approval ${approvalId} not found.`);

    const next: Approval = {
      ...current,
      ...updates,
      updatedAt: new Date().toISOString(),
    };

    const records = this.store.snapshot.approvalRecords ?? [];
    const index = records.findIndex((a) => a.id === approvalId);
    if (index >= 0) records[index] = next;
    else records.push(next);

    await this.store.update("approvalRecords", records);

    // Emit the update
    await emitUpdate(next);
    return next;
  }

  async createApproval(approval: Omit<Approval, "id" | "updatedAt" | "createdAt">): Promise<Approval> {
    const now = new Date().toISOString();
    const approvalWithId: Approval = {
      ...approval,
      id: crypto.randomUUID(),
      createdAt: now,
      updatedAt: now,
    };

    const records = this.store.snapshot.approvalRecords ?? [];
    records.push(approvalWithId);
    await this.store.update("approvalRecords", records);

    return approvalWithId;
  }
}

/**
 * ApprovalService manages the approval center.
 */
export class ApprovalService {
  private readonly store: ApprovalStore;
  private readonly updates: Array<(approval: Approval) => void | Promise<void>> = [];

  constructor(store: WorkspaceStateStore) {
    this.store = new ApprovalStore(store);
  }

  async initialize(): Promise<void> {
    await this.store.initialize();
  }

  /**
   * Create a new approval request.
   */
  async create(
    workflowId: string,
    stageId?: string,
    type: ApprovalType = "workflow-start",
    action: string = "Request approval",
    impact: string = "Unknown impact",
    exactScope: string = "Unknown scope",
    evidence: string[] = [],
    risks: string[] = [],
    expiryMinutes: number = 60,
  ): Promise<Approval> {
    const expiry = new Date(Date.now() + expiryMinutes * 60_000).toISOString();

    const approval = await this.store.createApproval({
      workflowId,
      stageId,
      type,
      action,
      impact,
      exactScope,
      evidence,
      risks,
      expiry,
      status: "pending",
    });

    // Notify listeners
    for (const callback of this.updates) {
      void callback(approval);
    }

    return approval;
  }

  /**
   * Approve an approval.
   */
  async approve(approvalId: string, reason?: string): Promise<Approval> {
    return this.update(approvalId, {
      status: "approved",
      actor: "user",
      reason,
    });
  }

  /**
   * Reject an approval.
   */
  async reject(approvalId: string, reason?: string): Promise<Approval> {
    return this.update(approvalId, {
      status: "rejected",
      actor: "user",
      reason,
    });
  }

  /**
   * Withdraw an approval.
   */
  async withdraw(approvalId: string, reason?: string): Promise<Approval> {
    return this.update(approvalId, {
      status: "withdrawn",
      actor: "user",
      reason,
    });
  }

  /**
   * Auto-reject expired approvals when they are observed.
   */
  async rejectExpired(approvalId: string): Promise<Approval> {
    const current = this.get(approvalId);
    if (!current) throw new Error(`Approval ${approvalId} not found.`);
    if (current.status !== "pending") return current;
    const expired = current.expiry ? Date.parse(current.expiry) <= Date.now() : false;
    if (!expired) return current;
    return this.update(approvalId, {
      status: "rejected",
      actor: "keystone",
      reason: "Approval expired before a decision was recorded.",
      previousStatus: current.status,
    });
  }

  /**
   * Update an approval.
   */
  private async update(
    approvalId: string,
    updates: Partial<Approval>,
  ): Promise<Approval> {
    return this.store.updateApproval(approvalId, updates, async (approval) => {
      for (const callback of this.updates) void callback(approval);
    });
  }

  /**
   * Get an approval.
   */
  get(approvalId: string): Approval | undefined {
    return this.store.getApproval(approvalId);
  }

  /**
   * Get all approvals.
   */
  getAll(): Approval[] {
    return this.store.getAllApprovals();
  }

  /**
   * Get approvals by workflow.
   */
  getByWorkflow(workflowId: string): Approval[] {
    return this.store.getAllApprovals().filter((a) => a.workflowId === workflowId);
  }

  /**
   * Get pending approvals.
   */
  getPending(): Approval[] {
    return this.store.getAllApprovals().filter((a) => a.status === "pending");
  }

  /**
   * Get approved approvals.
   */
  getApproved(): Approval[] {
    return this.store.getAllApprovals().filter((a) => a.status === "approved");
  }

  /**
   * Get rejected approvals.
   */
  getRejected(): Approval[] {
    return this.store.getAllApprovals().filter((a) => a.status === "rejected");
  }

  /**
   * Get withdrawals.
   */
  getWithdrawals(): Approval[] {
    return this.store.getAllApprovals().filter((a) => a.status === "withdrawn");
  }

  /**
   * Get approvals by type.
   */
  getByType(type: ApprovalType): Approval[] {
    return this.store.getAllApprovals().filter((a) => a.type === type);
  }

  /**
   * Get expired approvals.
   */
  getExpired(): Approval[] {
    const now = new Date().toISOString();
    return this.store.getAllApprovals().filter((a) => {
      if (!a.expiry) return false;
      return a.status === "pending" && a.expiry < now;
    });
  }

  /**
   * Get staleness warnings for pending approvals.
   */
  getStalenessWarnings(): Array<{ approvalId: string; message: string }> {
    const warnings: Array<{ approvalId: string; message: string }> = [];
    const now = new Date();

    for (const approval of this.store.getAllApprovals()) {
      if (approval.status !== "pending") continue;

      const age = now.getTime() - new Date(approval.createdAt).getTime();
      const ageMinutes = Math.floor(age / 60_000);

      if (ageMinutes >= 15 && ageMinutes < 30) {
        warnings.push({
          approvalId: approval.id,
          message: `This approval is ${ageMinutes} minutes old. Consider withdrawing and re-requesting.`,
        });
      } else if (ageMinutes >= 30) {
        warnings.push({
          approvalId: approval.id,
          message: `This approval is ${ageMinutes} minutes old. It should be withdrawn soon.`,
        });
      }
    }

    return warnings;
  }

  /**
   * Add a listener for approval updates.
   */
  on(
    callback: (approval: Approval) => void | Promise<void>,
  ): () => void {
    this.updates.push(callback);
    return () => {
      const index = this.updates.indexOf(callback);
      if (index >= 0) this.updates.splice(index, 1);
    };
  }
}
