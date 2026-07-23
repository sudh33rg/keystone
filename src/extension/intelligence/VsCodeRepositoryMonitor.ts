import * as vscode from "vscode";
import { posix } from "node:path";
import type { GitAdapter, GitMetadata } from "../adapters/GitAdapter";
import type { WorkspaceAdapter, WorkspaceRootReference } from "../adapters/WorkspaceAdapter";
import type { RepositoryChange } from "../../core/intelligence/runtime/ChangeCollector";
import { normalizeRelativePath } from "../../core/intelligence/StableId";
import type { KeystoneLogger } from "../../shared/logging/KeystoneLogger";
import type { IgnorePolicy } from "../../core/intelligence/IgnorePolicy";

export interface GitReconciliationEvent {
  changes: RepositoryChange[];
  fullRebuild: boolean;
  previous?: GitMetadata;
  current?: GitMetadata;
}

export interface RepositoryMonitor {
  onDidChange(listener: (change: RepositoryChange) => void): {
    dispose(): void;
  };
  onDidGitChange(listener: (event: GitReconciliationEvent) => void): {
    dispose(): void;
  };
  onDidChangeWorkspaceRoots(listener: () => void): { dispose(): void };
  start(): Promise<void>;
  dispose(): void;
}

export class VsCodeRepositoryMonitor implements RepositoryMonitor {
  private readonly disposables: vscode.Disposable[] = [];
  private readonly changeListeners = new Set<(change: RepositoryChange) => void>();
  private readonly gitListeners = new Set<(event: GitReconciliationEvent) => void>();
  private readonly rootListeners = new Set<() => void>();
  private readonly gitState = new Map<string, GitMetadata>();
  private gitCheckRevision = 0;
  private gitCheckTimer: ReturnType<typeof setTimeout> | undefined;
  private gitPollTimer: ReturnType<typeof setInterval> | undefined;
  private started = false;

  constructor(
    private readonly workspace: WorkspaceAdapter,
    private readonly git: GitAdapter,
    private readonly ignorePolicy: IgnorePolicy,
    private readonly logger: KeystoneLogger,
  ) {}

  onDidChange(listener: (change: RepositoryChange) => void): {
    dispose(): void;
  } {
    this.changeListeners.add(listener);
    return { dispose: () => this.changeListeners.delete(listener) };
  }

  onDidGitChange(listener: (event: GitReconciliationEvent) => void): {
    dispose(): void;
  } {
    this.gitListeners.add(listener);
    return { dispose: () => this.gitListeners.delete(listener) };
  }

  onDidChangeWorkspaceRoots(listener: () => void): { dispose(): void } {
    this.rootListeners.add(listener);
    return { dispose: () => this.rootListeners.delete(listener) };
  }

  async start(): Promise<void> {
    if (this.started) return;
    this.started = true;
    for (const root of this.workspace.getRoots())
      this.gitState.set(root.uri, await this.git.getMetadata(root.uri));
    const watcher = vscode.workspace.createFileSystemWatcher("**/*", false, false, false);
    this.disposables.push(
      watcher,
      watcher.onDidCreate((uri) => this.emitUri(uri, "added", "file")),
      watcher.onDidChange((uri) => this.emitUri(uri, "modified", "file")),
      watcher.onDidDelete((uri) => this.emitUri(uri, "deleted", "file")),
      vscode.workspace.onDidSaveTextDocument((document) =>
        this.emitUri(document.uri, "modified", "active-editor"),
      ),
      vscode.workspace.onDidRenameFiles((event) => {
        for (const item of event.files) {
          this.emitUri(item.oldUri, "deleted", "file");
          this.emitUri(item.newUri, "added", "file");
        }
      }),
      vscode.workspace.onDidChangeWorkspaceFolders(() => {
        for (const listener of this.rootListeners) listener();
      }),
      this.git.onDidCommit(() => this.scheduleGitCheck()),
      this.git.onDidChangeState(() => this.scheduleGitCheck()),
    );
    this.gitPollTimer = setInterval(() => this.scheduleGitCheck(), 1_000);
    this.gitPollTimer.unref?.();
  }

  dispose(): void {
    this.started = false;
    if (this.gitCheckTimer) clearTimeout(this.gitCheckTimer);
    this.gitCheckTimer = undefined;
    if (this.gitPollTimer) clearInterval(this.gitPollTimer);
    this.gitPollTimer = undefined;
    this.gitCheckRevision += 1;
    for (const disposable of this.disposables.splice(0)) disposable.dispose();
    this.changeListeners.clear();
    this.gitListeners.clear();
    this.rootListeners.clear();
  }

  private emitUri(
    uri: vscode.Uri,
    kind: RepositoryChange["kind"],
    reason: RepositoryChange["reason"],
  ): void {
    const change = this.toChange(uri, kind, reason);
    if (!change) return;
    for (const listener of this.changeListeners) listener(change);
  }

  private toChange(
    uri: vscode.Uri,
    kind: RepositoryChange["kind"],
    reason: RepositoryChange["reason"],
  ): RepositoryChange | undefined {
    const root = findRoot(this.workspace.getRoots(), uri);
    if (!root) return undefined;
    const rootUri = vscode.Uri.parse(root.uri);
    const relativePath = normalizeRelativePath(posix.relative(rootUri.path, uri.path));
    if (!relativePath || relativePath.startsWith("../")) return undefined;
    if (!this.ignorePolicy.decide(relativePath).included) return undefined;
    return {
      kind,
      rootUri: root.uri,
      uri: uri.toString(),
      relativePath,
      reason,
    };
  }

  private scheduleGitCheck(): void {
    const revision = ++this.gitCheckRevision;
    if (this.gitCheckTimer) clearTimeout(this.gitCheckTimer);
    this.gitCheckTimer = setTimeout(() => {
      this.gitCheckTimer = undefined;
      if (this.started && revision === this.gitCheckRevision) {
        void this.checkGit().catch((cause: unknown) =>
          this.logger.warning(
            "intelligence.git.monitor",
            "Git state monitoring failed; the next repository event will retry reconciliation.",
            cause,
          ),
        );
      }
    }, 300);
  }

  private async checkGit(): Promise<void> {
    const revision = this.gitCheckRevision;
    const batchedChanges: RepositoryChange[] = [];
    let requiresFullRebuild = false;
    let firstPrevious: GitMetadata | undefined;
    let firstCurrent: GitMetadata | undefined;
    for (const root of this.workspace.getRoots()) {
      const previous = this.gitState.get(root.uri);
      const current = await this.git.getMetadata(root.uri);
      if (!this.started || revision !== this.gitCheckRevision) return;
      this.gitState.set(root.uri, current);
      if (previous?.branch !== current.branch) {
        requiresFullRebuild = true;
        firstPrevious ??= previous;
        firstCurrent ??= current;
        continue;
      }
      if (previous?.headCommit === current.headCommit) continue;
      if (!this.workspace.getIndexingConfiguration().onBranchChange) {
        firstPrevious ??= previous;
        firstCurrent ??= current;
        continue;
      }
      const changes: RepositoryChange[] = [];
      let fullRebuild: boolean;
      if (previous) {
        try {
          const values = await this.git.getReconciliationChanges(
            root.uri,
            previous.headCommit,
            current.headCommit,
          );
          for (const value of values) {
            if (value.originalUri) {
              const removed = this.toChange(vscode.Uri.parse(value.originalUri), "deleted", "git");
              if (removed) changes.push(removed);
            }
            let kind: RepositoryChange["kind"] =
              value.kind === "added" || value.kind === "renamed"
                ? "added"
                : value.kind === "deleted"
                  ? "deleted"
                  : "modified";
            if (kind !== "deleted") {
              try {
                await this.workspace.statFile(value.uri);
              } catch {
                kind = "deleted";
              }
            }
            const change = this.toChange(vscode.Uri.parse(value.uri), kind, "git");
            if (change) changes.push(change);
          }
          fullRebuild = changes.length === 0;
        } catch (cause) {
          fullRebuild = true;
          this.logger.warning(
            "intelligence.git.reconcile",
            "Git diff reconciliation failed; a complete repair was scheduled.",
            cause,
          );
        }
      } else {
        fullRebuild = true;
      }
      firstPrevious ??= previous;
      firstCurrent ??= current;
      requiresFullRebuild ||= fullRebuild;
      batchedChanges.push(...changes);
    }
    if (!requiresFullRebuild && batchedChanges.length === 0 && !firstCurrent) return;
    const event: GitReconciliationEvent = {
      changes: requiresFullRebuild ? [] : deduplicateChanges(batchedChanges),
      fullRebuild: requiresFullRebuild,
      ...(firstPrevious ? { previous: firstPrevious } : {}),
      ...(firstCurrent ? { current: firstCurrent } : {}),
    };
    for (const listener of this.gitListeners) listener(event);
  }
}

function deduplicateChanges(changes: readonly RepositoryChange[]): RepositoryChange[] {
  const values = new Map<string, RepositoryChange>();
  for (const change of changes)
    values.set(`${change.rootUri}\u001f${change.relativePath}\u001f${change.kind}`, change);
  return [...values.values()].sort(
    (left, right) =>
      left.rootUri.localeCompare(right.rootUri) ||
      left.relativePath.localeCompare(right.relativePath),
  );
}

function findRoot(
  roots: readonly WorkspaceRootReference[],
  uri: vscode.Uri,
): WorkspaceRootReference | undefined {
  return roots
    .filter((root) => {
      const rootUri = vscode.Uri.parse(root.uri);
      return (
        rootUri.scheme === uri.scheme &&
        rootUri.authority === uri.authority &&
        (uri.path === rootUri.path || uri.path.startsWith(`${rootUri.path.replace(/\/$/, "")}/`))
      );
    })
    .sort(
      (left, right) =>
        vscode.Uri.parse(right.uri).path.length - vscode.Uri.parse(left.uri).path.length,
    )[0];
}
