import { readFile, rename } from "node:fs/promises";
import { join } from "node:path";
import { AtomicFileWriter } from "../persistence/AtomicFileWriter";
import type { ImpactQaAggregate } from "../../shared/contracts/impactQa";

interface ImpactQaState { schemaVersion: 1; revision: number; workflows: Record<string, ImpactQaAggregate>; updatedAt: string }
export class ImpactQaPersistence {
  private state: ImpactQaState = { schemaVersion: 1, revision: 0, workflows: {}, updatedAt: new Date(0).toISOString() };
  private readonly path: string;
  constructor(root: string, private readonly writer = new AtomicFileWriter()) { this.path = join(root, "impact-qa", "phase-7.json"); }
  async initialize(): Promise<void> { try { const parsed = JSON.parse(await readFile(this.path, "utf8")) as ImpactQaState; if (parsed.schemaVersion === 1 && parsed.workflows && typeof parsed.workflows === "object") this.state = parsed; else throw new Error("Unsupported Phase 7 persistence schema."); const recovered = recoverInterrupted(this.state); if (recovered !== this.state) { await this.writer.writeJson(this.path, recovered); this.state = recovered; } } catch (cause) { if (!(cause instanceof Error && "code" in cause && cause.code === "ENOENT")) await rename(this.path, `${this.path}.invalid-${Date.now()}`).catch(() => undefined); await this.writer.writeJson(this.path, this.state); } }
  get(workflowId: string): ImpactQaAggregate | undefined { const value = this.state.workflows[workflowId]; return value ? structuredClone(value) : undefined; }
  async save(value: ImpactQaAggregate): Promise<void> { const next: ImpactQaState = { schemaVersion: 1, revision: this.state.revision + 1, workflows: { ...this.state.workflows, [value.workflowId]: structuredClone(value) }, updatedAt: new Date().toISOString() }; await this.writer.writeJson(this.path, next); this.state = next; }
}

function recoverInterrupted(state: ImpactQaState): ImpactQaState {
  let changed = false;
  const workflows = Object.fromEntries(Object.entries(state.workflows).map(([id, value]) => {
    if (value.execution?.status !== "running") return [id, value];
    changed = true;
    return [id, { ...value, qaPlan: value.qaPlan?.status === "executing" ? { ...value.qaPlan, status: "approved" as const } : value.qaPlan, execution: { ...value.execution, status: "interrupted" as const, completedAt: new Date().toISOString() }, decision: undefined }];
  }));
  return changed ? { ...state, revision: state.revision + 1, workflows, updatedAt: new Date().toISOString() } : state;
}
