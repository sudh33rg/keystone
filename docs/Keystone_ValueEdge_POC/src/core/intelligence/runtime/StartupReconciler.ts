import type { GitAdapter, GitFileChange } from "../../../extension/adapters/GitAdapter";
import type {
  WorkspaceAdapter,
  WorkspaceFileReference,
} from "../../../extension/adapters/WorkspaceAdapter";
import type { IntelligenceStore } from "../../persistence/IntelligenceStore";
import type { IntelligenceRuntimePhase } from "../../../shared/contracts/intelligence";
import { stableId } from "../StableId";
import type { RepositoryChange, RepositoryChangeReason } from "./ChangeCollector";

export interface StartupReconciliation {
  phase: IntelligenceRuntimePhase;
  action: "none" | "incremental" | "rebuild" | "recover";
  reason: RepositoryChangeReason;
  changes: RepositoryChange[];
  message: string;
}

export class StartupReconciler {
  constructor(
    private readonly workspace: WorkspaceAdapter,
    private readonly git: GitAdapter,
    private readonly store: IntelligenceStore,
    private readonly expectedExtractorVersions: Readonly<Record<string, string>> = {},
  ) {}

  async reconcile(): Promise<StartupReconciliation> {
    const snapshot = this.store.getSnapshot();
    const health = await this.store.checkHealth();
    if (!snapshot) {
      return {
        phase: health.status === "damaged" ? "recovering" : "rebuilding",
        action: health.status === "damaged" ? "recover" : "rebuild",
        reason: health.status === "damaged" ? "storage-recovery" : "startup",
        changes: [],
        message: "No complete intelligence generation is available.",
      };
    }
    if (health.status !== "healthy") {
      return {
        phase: "recovering",
        action: "recover",
        reason: "storage-recovery",
        changes: [],
        message: health.message ?? "Persisted intelligence is missing or damaged.",
      };
    }
    for (const [extractorId, version] of Object.entries(this.expectedExtractorVersions)) {
      if (snapshot.manifest.extractorVersions[extractorId] !== version)
        return {
          phase: "rebuilding",
          action: "rebuild",
          reason: "startup",
          changes: [],
          message: `Extractor ${extractorId} requires a version-compatible rebuild.`,
        };
    }

    const roots = this.workspace.getRoots();
    const metadata = await this.git.getMetadata(roots[0]?.uri ?? "");
    const expectedRepositoryId = await stableId(
      "repository",
      roots
        .map((root) => root.uri)
        .sort()
        .join("|"),
      metadata.remoteIdentity,
    );
    if (expectedRepositoryId !== snapshot.repository.id) {
      return {
        phase: "rebuilding",
        action: "rebuild",
        reason: "startup",
        changes: [],
        message: "The workspace repository identity changed.",
      };
    }

    const gitChanged =
      snapshot.repository.branch !== metadata.branch ||
      snapshot.repository.headCommit !== metadata.headCommit ||
      snapshot.repository.dirtyFingerprint !== metadata.dirtyFingerprint;
    if (gitChanged) {
      try {
        const values = await this.git.getReconciliationChanges(
          roots[0]?.uri ?? "",
          snapshot.repository.headCommit,
          metadata.headCommit,
        );
        const changes = await this.resolveGitChanges(values, "startup");
        if (changes.length > 0)
          return {
            phase: "reconciling",
            action: "incremental",
            reason: "startup",
            changes,
            message: "Git and worktree changes require incremental reconciliation.",
          };
      } catch {
        // A complete repair is safer than publishing an incomplete Git delta.
      }
      return {
        phase: "rebuilding",
        action: "rebuild",
        reason: "startup",
        changes: [],
        message: "Git state changed without a complete incremental delta.",
      };
    }

    const changes = await this.compareInventory(snapshot.repository.id);
    return changes.length > 0
      ? {
          phase: "reconciling",
          action: "incremental",
          reason: "startup",
          changes,
          message: "Workspace inventory changed while Keystone was not running.",
        }
      : {
          phase: "ready",
          action: "none",
          reason: "startup",
          changes: [],
          message: "The active intelligence generation matches the workspace.",
        };
  }

  private async compareInventory(repositoryId: string): Promise<RepositoryChange[]> {
    const snapshot = this.store.getSnapshot();
    if (!snapshot) return [];
    const roots = this.workspace.getRoots();
    const rootIds = new Map<string, string>();
    for (const root of roots)
      rootIds.set(root.uri, await stableId("workspace-root", repositoryId, root.uri));
    const existing = new Map(
      snapshot.files.map((file) => [`${file.workspaceRootId}\u001f${file.relativePath}`, file]),
    );
    const seen = new Set<string>();
    const changes: RepositoryChange[] = [];
    let remaining = this.workspace.getIndexingConfiguration().maxFiles;
    for (const root of roots) {
      const rootId = rootIds.get(root.uri);
      if (!rootId || remaining <= 0) continue;
      const files = await this.workspace.listFiles(root, remaining);
      remaining -= files.length;
      for (let index = 0; index < files.length; index++) {
        const file = files[index];
        if (!file) continue;
        const key = `${rootId}\u001f${file.relativePath}`;
        seen.add(key);
        const prior = existing.get(key);
        try {
          const current = await this.workspace.statFile(file.uri);
          if (!prior) changes.push(toChange(file, "added", "startup"));
          else if (prior.byteSize !== current.byteSize || prior.modifiedAt !== current.modifiedAt)
            changes.push(toChange(file, "modified", "startup"));
        } catch {
          changes.push(toChange(file, "deleted", "startup"));
        }
        if ((index + 1) % 100 === 0) await yieldToHost();
      }
    }
    const rootById = new Map(
      [...rootIds.entries()].map(([uri, id]) => [id, roots.find((root) => root.uri === uri)]),
    );
    for (const [key, file] of existing) {
      if (seen.has(key)) continue;
      const root = rootById.get(file.workspaceRootId);
      if (root)
        changes.push(
          toChange(this.workspace.fileReference(root, file.relativePath), "deleted", "startup"),
        );
    }
    return changes;
  }

  private async resolveGitChanges(
    values: readonly GitFileChange[],
    reason: RepositoryChangeReason,
  ): Promise<RepositoryChange[]> {
    const output: RepositoryChange[] = [];
    for (const value of values) {
      if (value.originalUri) {
        const original = this.workspace.resolveFile(value.originalUri);
        if (original) output.push(toChange(original, "deleted", reason));
      }
      const file = this.workspace.resolveFile(value.uri);
      if (!file) continue;
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
      output.push(toChange(file, kind, reason));
    }
    return output;
  }
}

function toChange(
  file: WorkspaceFileReference,
  kind: RepositoryChange["kind"],
  reason: RepositoryChangeReason,
): RepositoryChange {
  return { kind, rootUri: file.root.uri, uri: file.uri, relativePath: file.relativePath, reason };
}

function yieldToHost(): Promise<void> {
  return new Promise((resolve) => setImmediate(resolve));
}
