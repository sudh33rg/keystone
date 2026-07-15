export type RepositoryChangeKind = "added" | "modified" | "deleted" | "replaced";
export type RepositoryChangeReason = "file" | "active-editor" | "git" | "startup" | "storage-recovery" | "workspace";

export interface RepositoryChange {
  kind: RepositoryChangeKind;
  rootUri: string;
  uri: string;
  relativePath: string;
  reason: RepositoryChangeReason;
}

export interface RepositoryChangeBatch {
  changes: RepositoryChange[];
  reason: RepositoryChangeReason;
  createdAt: string;
}

export type ChangeBatch = RepositoryChangeBatch;

const reasonRank: Record<RepositoryChangeReason, number> = {
  "active-editor": 0,
  git: 1,
  file: 2,
  workspace: 3,
  startup: 4,
  "storage-recovery": 5
};

export class ChangeCollector {
  private readonly pending = new Map<string, RepositoryChange>();
  private timer: ReturnType<typeof setTimeout> | undefined;

  constructor(
    private readonly onBatch: (batch: RepositoryChangeBatch) => void,
    private readonly windowMs = 200
  ) {}

  add(change: RepositoryChange): void {
    const key = `${change.rootUri}\u001f${change.relativePath}`;
    const previous = this.pending.get(key);
    this.pending.set(key, reduceChange(previous, change));
    if (this.timer) clearTimeout(this.timer);
    this.timer = setTimeout(() => this.flush(), this.windowMs);
  }

  addAll(changes: readonly RepositoryChange[]): void {
    for (const change of changes) this.add(change);
  }

  flush(): void {
    if (this.timer) clearTimeout(this.timer);
    this.timer = undefined;
    if (this.pending.size === 0) return;
    const changes = [...this.pending.values()].sort((left, right) => left.rootUri.localeCompare(right.rootUri) || left.relativePath.localeCompare(right.relativePath));
    this.pending.clear();
    const reason = changes.reduce<RepositoryChangeReason>((selected, item) => reasonRank[item.reason] < reasonRank[selected] ? item.reason : selected, changes[0]?.reason ?? "file");
    this.onBatch({ changes, reason, createdAt: new Date().toISOString() });
  }

  dispose(): void {
    if (this.timer) clearTimeout(this.timer);
    this.timer = undefined;
    this.pending.clear();
  }
}

function reduceChange(previous: RepositoryChange | undefined, current: RepositoryChange): RepositoryChange {
  if (!previous) return current;
  const reason = reasonRank[current.reason] < reasonRank[previous.reason] ? current.reason : previous.reason;
  if (current.kind === "deleted") return { ...current, reason };
  if (previous.kind === "deleted") return { ...current, kind: "replaced", reason };
  if (previous.kind === "added") return { ...current, kind: "added", reason };
  if (previous.kind === "replaced") return { ...current, kind: "replaced", reason };
  return { ...current, kind: current.kind === "added" ? "replaced" : "modified", reason };
}
