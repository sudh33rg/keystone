export interface KeystoneOperation {
  id: string;
  kind: 'intelligence' | 'analysis' | 'validation' | 'delegation' | 'handoff';
  status: 'queued' | 'running' | 'paused' | 'completed' | 'failed' | 'cancelled';
  progress: number;
  message: string;
  updatedAt: string;
}

export interface KeystoneApplicationState {
  version: number;
  workspace?: { name: string; root: string; branch?: string };
  status: 'idle' | 'indexing' | 'ready' | 'analyzing' | 'error';
  intelligence?: unknown;
  intelligenceManifest?: unknown;
  intelligenceActivity: unknown[];
  ingestion?: unknown;
  activeTask?: unknown;
  taskAnalysis?: unknown;
  delegationResult?: unknown;
  sdlc?: unknown;
  valueEdgeFeature?: unknown;
  handoffs: unknown[];
  operations: KeystoneOperation[];
  notification?: { level: 'info' | 'error'; message: string };
}

export type StateListener = (state: Readonly<KeystoneApplicationState>) => void;

export class ApplicationStore {
  private state: KeystoneApplicationState;
  private readonly listeners = new Set<StateListener>();

  constructor(initial: Partial<KeystoneApplicationState> = {}) {
    this.state = {
      version: 1,
      status: 'idle',
      intelligenceActivity: [],
      handoffs: [],
      operations: [],
      ...initial,
    };
  }

  snapshot(): Readonly<KeystoneApplicationState> { return structuredClone(this.state); }

  update(patch: Partial<Omit<KeystoneApplicationState, 'version'>>): Readonly<KeystoneApplicationState> {
    this.state = { ...this.state, ...patch, version: this.state.version + 1 };
    const snapshot = this.snapshot();
    for (const listener of this.listeners) listener(snapshot);
    return snapshot;
  }

  mergeOperation(operation: KeystoneOperation): Readonly<KeystoneApplicationState> {
    const operations = this.state.operations.filter(item => item.id !== operation.id);
    operations.unshift(operation);
    return this.update({ operations: operations.slice(0, 100) });
  }

  subscribe(listener: StateListener): { dispose(): void } {
    this.listeners.add(listener);
    listener(this.snapshot());
    return { dispose: () => this.listeners.delete(listener) };
  }
}
