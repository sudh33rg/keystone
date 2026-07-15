import type { IntelligencePersistenceHealth, IntelligenceStore } from "../../persistence/IntelligenceStore";

export interface IntelligenceHealthState {
  status: "healthy" | "missing" | "damaged" | "recovering";
  message?: string;
  pendingGenerations: number;
}

export class IntelligenceHealthService {
  private readonly listeners = new Set<(state: IntelligenceHealthState) => void>();
  private readonly subscription: { dispose(): void };
  private state: IntelligenceHealthState;

  constructor(private readonly store: IntelligenceStore) {
    this.state = fromPersistence(store.getHealth());
    this.subscription = store.onDidHealthChange((health) => {
      if (this.state.status === "recovering" && health.status !== "healthy") return;
      this.state = fromPersistence(health);
      this.emit();
    });
  }

  async refresh(): Promise<IntelligenceHealthState> {
    const health = await this.store.checkHealth();
    if (this.state.status !== "recovering" || health.status === "healthy") this.state = fromPersistence(health);
    this.emit();
    return this.getState();
  }

  markRecovering(message = "Reconstructing extension-managed intelligence."): void {
    this.state = { status: "recovering", message, pendingGenerations: this.state.pendingGenerations };
    this.emit();
  }

  markRecoveryFailed(message: string): void {
    this.state = { status: "damaged", message, pendingGenerations: this.state.pendingGenerations };
    this.emit();
  }

  getState(): IntelligenceHealthState {
    return { ...this.state };
  }

  onDidChange(listener: (state: IntelligenceHealthState) => void): { dispose(): void } {
    this.listeners.add(listener);
    return { dispose: () => this.listeners.delete(listener) };
  }

  dispose(): void {
    this.subscription.dispose();
    this.listeners.clear();
  }

  private emit(): void {
    const state = this.getState();
    for (const listener of this.listeners) listener(state);
  }
}

function fromPersistence(health: IntelligencePersistenceHealth): IntelligenceHealthState {
  return { status: health.status, pendingGenerations: health.pendingGenerations, ...(health.message ? { message: health.message } : {}) };
}
