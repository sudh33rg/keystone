import * as vscode from "vscode";
import type {
  BoundedGitDiff,
  GitRuntimeAdapter,
  GitRuntimeChange,
} from "../../core/delivery/GitDeliveryService";
import type { GitCapabilities, GitRepositoryState } from "../../shared/contracts/delivery";

interface SupportedGitRepository {
  rootUri: vscode.Uri;
  add?(resources: vscode.Uri[]): Promise<void>;
  createBranch?(name: string, checkout: boolean): Promise<void>;
  commit?(message: string): Promise<void>;
  push?(remote?: string, branch?: string, setUpstream?: boolean): Promise<void>;
}
interface SupportedGitApi {
  repositories: SupportedGitRepository[];
}
interface SupportedGitExtension {
  getAPI(version: 1): SupportedGitApi;
}

/** Uses only the documented built-in Git extension API methods that can be proven at runtime, with the controlled executable adapter as a fail-closed fallback. */
export class VsCodeGitDeliveryAdapter implements GitRuntimeAdapter {
  constructor(
    private readonly fallback: GitRuntimeAdapter & {
      compareCommits?(
        root: string,
        sender: string,
        receiver: string,
      ): Promise<"ahead" | "behind" | "diverged" | "missing-commits">;
    },
  ) {}
  async capabilities(root: string): Promise<GitCapabilities> {
    return this.fallback.capabilities(root);
  }
  async state(root: string): Promise<GitRepositoryState> {
    return this.fallback.state(root);
  }
  async changes(root: string, baseCommit?: string): Promise<GitRuntimeChange[]> {
    return this.fallback.changes(root, baseCommit);
  }
  async diff(
    root: string,
    path: string,
    mode: "working-head" | "index-head" | "working-index",
    maxBytes: number,
    signal?: AbortSignal,
  ): Promise<BoundedGitDiff> {
    return this.fallback.diff(root, path, mode, maxBytes, signal);
  }
  async stage(root: string, paths: string[]): Promise<{ output: string }> {
    const repository = await this.repository(root);
    if (!repository?.add) return this.fallback.stage(root, paths);
    await repository.add(
      paths.map((path) => vscode.Uri.joinPath(repository.rootUri, ...path.split("/"))),
    );
    return { output: "Staged through the supported VS Code Git API." };
  }
  async unstage(root: string, paths: string[]): Promise<{ output: string }> {
    return this.fallback.unstage(root, paths);
  }
  async createBranch(root: string, branch: string): Promise<{ output: string }> {
    const repository = await this.repository(root);
    if (!repository?.createBranch) return this.fallback.createBranch(root, branch);
    await repository.createBranch(branch, true);
    return { output: "Branch created through the supported VS Code Git API." };
  }
  async commit(
    root: string,
    message: string,
  ): Promise<{ hash: string; files: string[]; output: string }> {
    const repository = await this.repository(root);
    if (!repository?.commit) return this.fallback.commit(root, message);
    const before = await this.fallback.state(root);
    await repository.commit(message);
    const after = await this.fallback.state(root);
    if (!after.headCommit || after.headCommit === before.headCommit)
      throw new Error("VS Code Git API returned without a verifiable commit.");
    return {
      hash: after.headCommit,
      files: before.stagedFiles,
      output:
        "Commit created through the supported VS Code Git API and verified from repository state.",
    };
  }
  async push(
    root: string,
    remote: string,
    branch: string,
    setUpstream: boolean,
  ): Promise<{ output: string; verified: boolean }> {
    const repository = await this.repository(root);
    if (!repository?.push) return this.fallback.push(root, remote, branch, setUpstream);
    await repository.push(remote, branch, setUpstream);
    const after = await this.fallback.state(root);
    return {
      output: "Push requested through the supported VS Code Git API.",
      verified: after.ahead === 0 && after.upstreamBranch !== undefined,
    };
  }
  recentCommitSubjects(root: string, limit: number): Promise<string[]> {
    return this.fallback.recentCommitSubjects?.(root, limit) ?? Promise.resolve([]);
  }
  compareCommits(
    root: string,
    sender: string,
    receiver: string,
  ): Promise<"ahead" | "behind" | "diverged" | "missing-commits"> {
    return (
      this.fallback.compareCommits?.(root, sender, receiver) ?? Promise.resolve("missing-commits")
    );
  }
  private async repository(root: string): Promise<SupportedGitRepository | undefined> {
    const extension = vscode.extensions.getExtension<SupportedGitExtension>("vscode.git");
    if (!extension) return undefined;
    const exports = extension.isActive ? extension.exports : await extension.activate();
    if (!exports || typeof exports.getAPI !== "function") return undefined;
    const normalized = root.replace(/\\/g, "/").replace(/\/$/, "");
    return exports
      .getAPI(1)
      .repositories.find(
        (item) => item.rootUri.fsPath.replace(/\\/g, "/").replace(/\/$/, "") === normalized,
      );
  }
}
