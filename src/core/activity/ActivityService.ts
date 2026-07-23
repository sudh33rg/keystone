import {
  type Activity,
  type ActivityStatus,
  type ActivityCategory,
} from "../../shared/contracts/activity";
import { WorkspaceStateStore } from "../persistence/WorkspaceStateStore";

/**
 * ActivityStore provides persistence for activity records.
 */
class ActivityStore {
  constructor(private readonly store: WorkspaceStateStore) {}

  async initialize(): Promise<void> {
    // Records are persisted via the workspace state store
  }

  getActivity(activityId: string): Activity | undefined {
    return this.store.snapshot.activityRecords?.find((activity) => activity.id === activityId);
  }

  getAllActivities(): Activity[] {
    return this.store.snapshot.activityRecords ?? [];
  }

  async updateActivity(
    activityId: string,
    updates: Partial<Activity>,
    emitUpdate: (activity: Activity) => void | Promise<void>,
  ): Promise<Activity> {
    const current = this.getActivity(activityId);
    if (!current) throw new Error(`Activity ${activityId} not found.`);

    const next: Activity = {
      ...current,
      ...updates,
      updatedAt: new Date().toISOString(),
    };

    const records = this.store.snapshot.activityRecords ?? [];
    const index = records.findIndex((a) => a.id === activityId);
    if (index >= 0) records[index] = next;
    else records.push(next);

    await this.store.update("activityRecords", records);

    // Emit the update
    await emitUpdate(next);
    return next;
  }

  async createActivity(activity: Omit<Activity, "id" | "updatedAt" | "createdAt" | "startedAt">): Promise<Activity> {
    const now = new Date().toISOString();
    const activityWithId: Activity = {
      ...activity,
      id: crypto.randomUUID(),
      createdAt: now,
      startedAt: now,
      updatedAt: now,
    };

    const records = this.store.snapshot.activityRecords ?? [];
    records.push(activityWithId);
    await this.store.update("activityRecords", records);

    return activityWithId;
  }
}

/**
 * ActivityService tracks and manages long-running operations.
 */
export class ActivityService {
  private readonly store: ActivityStore;
  private readonly updates: Array<(activity: Activity) => void | Promise<void>> = [];

  constructor(store: WorkspaceStateStore) {
    this.store = new ActivityStore(store);
  }

  async initialize(): Promise<void> {
    await this.store.initialize();
  }

  /**
   * Create a new activity.
   */
  async create(
    workflowId?: string,
    stageId?: string,
    category: ActivityCategory = "recovery",
    title: string = "Unknown activity",
    progress: number = 0,
    currentAction: string = "Starting",
  ): Promise<Activity> {
    const activity = await this.store.createActivity({
      workflowId,
      stageId,
      category,
      title,
      status: "queued",
      progress,
      currentAction,
      cancellationRequested: false,
    });

    // Notify listeners
    for (const callback of this.updates) {
      void callback(activity);
    }

    return activity;
  }

  /**
   * Update an activity's status.
   */
  async setStatus(
    activityId: string,
    status: ActivityStatus,
    currentAction?: string,
  ): Promise<Activity> {
    return this.update(activityId, {
      status,
      ...(currentAction ? { currentAction } : {}),
    });
  }

  /**
   * Update an activity's progress.
   */
  async setProgress(
    activityId: string,
    progress: number,
    currentAction?: string,
  ): Promise<Activity> {
    return this.update(activityId, {
      progress,
      ...(currentAction ? { currentAction } : {}),
    });
  }

  /**
   * Update an activity's current action.
   */
  async setCurrentAction(activityId: string, currentAction: string): Promise<Activity> {
    return this.update(activityId, { currentAction });
  }

  /**
   * Complete an activity.
   */
  async complete(activityId: string, resultReference?: string): Promise<Activity> {
    return this.update(activityId, {
      status: "completed",
      completedAt: new Date().toISOString(),
      ...(resultReference ? { resultReference } : {}),
      currentAction: "Completed",
    });
  }

  /**
   * Fail an activity.
   */
  async fail(activityId: string, errorReference?: string): Promise<Activity> {
    return this.update(activityId, {
      status: "failed",
      completedAt: new Date().toISOString(),
      ...(errorReference ? { errorReference } : {}),
      currentAction: "Failed",
    });
  }

  /**
   * Cancel an activity.
   */
  async cancel(activityId: string): Promise<Activity> {
    return this.update(activityId, {
      status: "cancelled",
      cancelledAt: new Date().toISOString(),
      currentAction: "Cancelled",
    });
  }

  /**
   * Pause an activity.
   */
  async pause(activityId: string): Promise<Activity> {
    return this.update(activityId, {
      status: "paused",
      currentAction: "Paused",
    });
  }

  /**
   * Resume a paused activity.
   */
  async resume(activityId: string): Promise<Activity> {
    return this.update(activityId, {
      status: "running",
      currentAction: "Resumed",
    });
  }

  /**
   * Interrupt an activity.
   */
  async interrupt(activityId: string): Promise<Activity> {
    return this.update(activityId, {
      status: "interrupted",
      currentAction: "Interrupted",
    });
  }

  /**
   * Mark an activity as superseded.
   */
  async supersede(activityId: string, reason?: string): Promise<Activity> {
    return this.update(activityId, {
      status: "superseded",
      currentAction: `Superseded: ${reason ?? "Unknown reason"}`,
    });
  }

  /**
   * Request cancellation of an activity.
   */
  async requestCancellation(activityId: string): Promise<void> {
    await this.update(activityId, { cancellationRequested: true });
  }

  /**
   * Update an activity.
   */
  private async update(
    activityId: string,
    updates: Partial<Activity>,
  ): Promise<Activity> {
    return this.store.updateActivity(activityId, updates, async (activity) => {
      for (const callback of this.updates) {
        void callback(activity);
      }
    });
  }

  /**
   * Get an activity.
   */
  get(activityId: string): Activity | undefined {
    return this.store.getActivity(activityId);
  }

  /**
   * Get all activities.
   */
  getAll(): Activity[] {
    return this.store.getAllActivities();
  }

  /**
   * Get activities by workflow.
   */
  getByWorkflow(workflowId: string): Activity[] {
    return this.store.getAllActivities().filter((a) => a.workflowId === workflowId);
  }

  /**
   * Get activities by category.
   */
  getByCategory(category: string): Activity[] {
    return this.store.getAllActivities().filter((a) => a.category === category);
  }

  /**
   * Get activities by status.
   */
  getByStatus(status: ActivityStatus): Activity[] {
    return this.store.getAllActivities().filter((a) => a.status === status);
  }

  /**
   * Get active activities.
   */
  getActive(): Activity[] {
    return this.store.getAllActivities().filter(
      (a) => ["running", "preparing", "awaiting-approval", "awaiting-user-input"].includes(a.status),
    );
  }

  /**
   * Get completed activities.
   */
  getCompleted(): Activity[] {
    return this.store.getAllActivities().filter((a) => a.status === "completed");
  }

  /**
   * Get failed activities.
   */
  getFailed(): Activity[] {
    return this.store.getAllActivities().filter((a) => a.status === "failed");
  }

  /**
   * Get cancelled activities.
   */
  getCancelled(): Activity[] {
    return this.store.getAllActivities().filter((a) => a.status === "cancelled");
  }

  /**
   * Get interrupted activities.
   */
  getInterrupted(): Activity[] {
    return this.store.getAllActivities().filter((a) => a.status === "interrupted");
  }

  /**
   * Add a listener for activity updates.
   */
  on(
    callback: (activity: Activity) => void | Promise<void>,
  ): () => void {
    this.updates.push(callback);
    return () => {
      const index = this.updates.indexOf(callback);
      if (index >= 0) this.updates.splice(index, 1);
    };
  }
}
