/**
 * VisualizationPersistenceStore (spec §20, §21, §28).
 *
 * Storage-backend-agnostic persistence for saved views, visualization snapshots,
 * and local user feedback. Follows the project's MementoLike contract so the
 * same code works with the file-backed FileMemento in the extension or an
 * in-memory memento in tests.
 *
 * Feedback never mutates the underlying parsed source truth — it is an overlay
 * (spec §28) used for visualization overrides, ranking, and future ingestion
 * quality diagnostics.
 */
import type { MementoLike } from "../../persistence/WorkspaceStateStore";
import { z } from "zod";
import {
  SavedIntelligenceViewSchema,
  VisualizationSnapshotSchema,
  VisualizationFeedbackSchema,
  type SavedIntelligenceView,
  type VisualizationSnapshot,
  type VisualizationFeedback,
} from "../../../shared/contracts/visualization";

const SAVED_VIEWS_KEY = "keystone.visualization.savedViews";
const SNAPSHOTS_KEY = "keystone.visualization.snapshots";
const FEEDBACK_KEY = "keystone.visualization.feedback";

function uuid(): string {
  return `v${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

const savedViewInputSchema = SavedIntelligenceViewSchema.omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});
const snapshotInputSchema = VisualizationSnapshotSchema.omit({ id: true, createdAt: true });
const feedbackInputSchema = VisualizationFeedbackSchema.omit({ id: true, createdAt: true });
type SavedViewInput = z.infer<typeof savedViewInputSchema>;
type SavedViewPatch = Partial<SavedViewInput>;
type SnapshotInput = z.infer<typeof snapshotInputSchema>;
type FeedbackInput = z.infer<typeof feedbackInputSchema>;

export class VisualizationPersistenceStore {
  private savedViews: SavedIntelligenceView[] = [];
  private snapshots: VisualizationSnapshot[] = [];
  private feedback: VisualizationFeedback[] = [];

  constructor(private memento: MementoLike) {}

  async initialize(): Promise<void> {
    const sv = this.memento.get<unknown>(SAVED_VIEWS_KEY);
    if (sv) {
      const parsed = SavedIntelligenceViewArraySchema.safeParse(sv);
      if (parsed.success) this.savedViews = parsed.data;
    }
    const sn = this.memento.get<unknown>(SNAPSHOTS_KEY);
    if (sn) {
      const parsed = SnapshotsArraySchema.safeParse(sn);
      if (parsed.success) this.snapshots = parsed.data;
    }
    const fb = this.memento.get<unknown>(FEEDBACK_KEY);
    if (fb) {
      const parsed = FeedbackArraySchema.safeParse(fb);
      if (parsed.success) this.feedback = parsed.data;
    }
  }

  // --- Saved views ---
  async saveView(input: SavedViewInput): Promise<SavedIntelligenceView> {
    const now = new Date().toISOString();
    const validated = savedViewInputSchema.parse(input);
    const view: SavedIntelligenceView = SavedIntelligenceViewSchema.parse({
      ...validated,
      id: uuid(),
      createdAt: now,
      updatedAt: now,
    });
    this.savedViews = [...this.savedViews, view];
    await this.persistSaved();
    return view;
  }

  async updateView(id: string, patch: SavedViewPatch): Promise<SavedIntelligenceView | null> {
    const existing = this.savedViews.find((v) => v.id === id);
    if (!existing) return null;
    const updated: SavedIntelligenceView = SavedIntelligenceViewSchema.parse({
      ...existing,
      ...patch,
      id,
      createdAt: existing.createdAt,
      updatedAt: new Date().toISOString(),
    });
    this.savedViews = this.savedViews.map((v) => (v.id === id ? updated : v));
    await this.persistSaved();
    return updated;
  }

  async deleteView(id: string): Promise<void> {
    this.savedViews = this.savedViews.filter((v) => v.id !== id);
    await this.persistSaved();
  }

  listViews(): SavedIntelligenceView[] {
    return [...this.savedViews];
  }

  getView(id: string): SavedIntelligenceView | undefined {
    return this.savedViews.find((v) => v.id === id);
  }

  // --- Snapshots ---
  async saveSnapshot(input: SnapshotInput): Promise<VisualizationSnapshot> {
    const snap: VisualizationSnapshot = VisualizationSnapshotSchema.parse({
      ...snapshotInputSchema.parse(input),
      id: uuid(),
      createdAt: new Date().toISOString(),
    });
    this.snapshots = [...this.snapshots, snap];
    await this.memento.update(SNAPSHOTS_KEY, this.snapshots);
    return snap;
  }

  listSnapshots(): VisualizationSnapshot[] {
    return [...this.snapshots];
  }

  getSnapshot(id: string): VisualizationSnapshot | undefined {
    return this.snapshots.find((s) => s.id === id);
  }

  async deleteSnapshot(id: string): Promise<void> {
    this.snapshots = this.snapshots.filter((s) => s.id !== id);
    await this.memento.update(SNAPSHOTS_KEY, this.snapshots);
  }

  // --- Feedback (local overlay, never mutates source truth) ---
  async addFeedback(input: FeedbackInput): Promise<VisualizationFeedback> {
    const fb: VisualizationFeedback = VisualizationFeedbackSchema.parse({
      ...feedbackInputSchema.parse(input),
      id: uuid(),
      createdAt: new Date().toISOString(),
    });
    this.feedback = this.feedback.filter(
      (f) =>
        !(f.targetKind === fb.targetKind && f.targetId === fb.targetId && f.action === fb.action),
    );
    this.feedback = [...this.feedback, fb];
    await this.memento.update(FEEDBACK_KEY, this.feedback);
    return fb;
  }

  listFeedback(): VisualizationFeedback[] {
    return [...this.feedback];
  }

  async clearFeedbackFor(
    targetKind: VisualizationFeedback["targetKind"],
    targetId: string,
  ): Promise<void> {
    this.feedback = this.feedback.filter(
      (f) => !(f.targetKind === targetKind && f.targetId === targetId),
    );
    await this.memento.update(FEEDBACK_KEY, this.feedback);
  }

  private async persistSaved(): Promise<void> {
    await this.memento.update(SAVED_VIEWS_KEY, this.savedViews);
  }
}

// Local array schemas (modules-level validation for persistence blobs).
const SavedIntelligenceViewArraySchema = z.array(SavedIntelligenceViewSchema);
const SnapshotsArraySchema = z.array(VisualizationSnapshotSchema);
const FeedbackArraySchema = z.array(VisualizationFeedbackSchema);
