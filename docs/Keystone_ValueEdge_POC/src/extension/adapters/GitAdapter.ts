import * as vscode from "vscode";
import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execute = promisify(execFile);

export interface GitMetadata {
  branch?: string;
  headCommit?: string;
  remoteIdentity?: string;
  dirtyFingerprint?: string;
}

export interface GitFileChange {
  uri: string;
  originalUri?: string;
  kind: "added" | "modified" | "deleted" | "renamed";
}

export interface GitAdapter {
  getMetadata(rootUri: string): Promise<GitMetadata>;
  isGitRepository(rootUri: string): boolean;
  getCurrentBranch(rootUri: string): string | undefined;
  getHeadCommit(rootUri: string): string | undefined;
  getRemoteUrl(rootUri: string): string | undefined;
  getChangedFiles(rootUri: string, from?: string, to?: string): Promise<string[]>;
  getStagedFiles(rootUri: string): Promise<string[]>;
  getUntrackedFiles(rootUri: string): Promise<string[]>;
  getReconciliationChanges(rootUri: string, from?: string, to?: string): Promise<GitFileChange[]>;
  getRemoteIdentityHash(rootUri: string): string | undefined;
  onDidCommit(listener: () => void): { dispose(): void };
  onDidChangeState(listener: () => void): { dispose(): void };
}

interface GitChange {
  uri: vscode.Uri;
  originalUri?: vscode.Uri;
  status?: number;
}

interface GitRepository {
  rootUri: vscode.Uri;
  state: {
    HEAD?: { name?: string; commit?: string };
    remotes: Array<{ name: string; fetchUrl?: string; pushUrl?: string }>;
    indexChanges: GitChange[];
    workingTreeChanges: GitChange[];
    onDidChange(listener: () => void): vscode.Disposable;
  };
  diffBetween(from: string, to: string): Promise<GitChange[]>;
}

interface GitApi {
  repositories: GitRepository[];
  getRepository(uri: vscode.Uri): GitRepository | null;
  onDidCommit?(listener: () => void): vscode.Disposable;
  onDidOpenRepository?(listener: (repository: GitRepository) => void): vscode.Disposable;
  onDidCloseRepository?(listener: (repository: GitRepository) => void): vscode.Disposable;
}

interface GitExtensionExports {
  getAPI(version: 1): GitApi;
}

export class VsCodeGitAdapter implements GitAdapter {
  async getMetadata(rootUri: string): Promise<GitMetadata> {
    const api = await this.getApi(true);
    const repository = api?.getRepository(vscode.Uri.parse(rootUri));
    const executable = await executableMetadata(rootUri);
    if (!repository) return executable;
    const remote = repository.state.remotes.find((item) => item.name === "origin");
    const remoteUrl = executable.remoteUrl ?? remote?.pushUrl ?? remote?.fetchUrl;
    const dirty = [...repository.state.indexChanges, ...repository.state.workingTreeChanges];
    return {
      ...((executable.branch ?? repository.state.HEAD?.name)
        ? { branch: executable.branch ?? repository.state.HEAD?.name }
        : {}),
      ...((executable.headCommit ?? repository.state.HEAD?.commit)
        ? { headCommit: executable.headCommit ?? repository.state.HEAD?.commit }
        : {}),
      ...(remoteUrl ? { remoteIdentity: await digestRemote(remoteUrl) } : {}),
      ...(executable.dirtyFingerprint
        ? { dirtyFingerprint: executable.dirtyFingerprint }
        : dirty.length > 0
          ? { dirtyFingerprint: await digestChanges(dirty) }
          : {}),
    };
  }

  isGitRepository(rootUri: string): boolean {
    return this.repository(rootUri) !== undefined;
  }

  getCurrentBranch(rootUri: string): string | undefined {
    return this.repository(rootUri)?.state.HEAD?.name;
  }

  getHeadCommit(rootUri: string): string | undefined {
    return this.repository(rootUri)?.state.HEAD?.commit;
  }

  getRemoteUrl(rootUri: string): string | undefined {
    const remote = this.repository(rootUri)?.state.remotes.find((item) => item.name === "origin");
    return remote?.pushUrl ?? remote?.fetchUrl;
  }

  async getChangedFiles(rootUri: string, from?: string, to?: string): Promise<string[]> {
    const repository = this.repository(rootUri);
    if (!repository) return [];
    if (from && to)
      return (await repository.diffBetween(from, to)).map((item) => item.uri.toString());
    return repository.state.workingTreeChanges.map((item) => item.uri.toString());
  }

  getStagedFiles(rootUri: string): Promise<string[]> {
    return Promise.resolve(
      this.repository(rootUri)?.state.indexChanges.map((item) => item.uri.toString()) ?? [],
    );
  }

  getUntrackedFiles(rootUri: string): Promise<string[]> {
    return Promise.resolve(
      this.repository(rootUri)
        ?.state.workingTreeChanges.filter((item) => item.status === 7)
        .map((item) => item.uri.toString()) ?? [],
    );
  }

  async getReconciliationChanges(
    rootUri: string,
    from?: string,
    to?: string,
  ): Promise<GitFileChange[]> {
    const repository = this.repository(rootUri);
    if (!repository) return [];
    const committed = from && to ? await repository.diffBetween(from, to) : [];
    const changes = [
      ...committed,
      ...repository.state.indexChanges,
      ...repository.state.workingTreeChanges,
    ];
    const output = new Map<string, GitFileChange>();
    for (const change of changes) {
      const kind = gitChangeKind(change);
      const record: GitFileChange = {
        uri: change.uri.toString(),
        kind,
        ...(change.originalUri && change.originalUri.toString() !== change.uri.toString()
          ? { originalUri: change.originalUri.toString() }
          : {}),
      };
      output.set(record.uri, record);
    }
    return [...output.values()].sort((left, right) => left.uri.localeCompare(right.uri));
  }

  getRemoteIdentityHash(rootUri: string): string | undefined {
    const remote = this.getRemoteUrl(rootUri);
    if (!remote) return undefined;
    return legacyHash(remote);
  }

  onDidCommit(listener: () => void): { dispose(): void } {
    const api = this.getApi(false);
    return typeof api?.onDidCommit === "function"
      ? api.onDidCommit(listener)
      : { dispose: () => undefined };
  }

  onDidChangeState(listener: () => void): { dispose(): void } {
    const api = this.getApi(false);
    if (!api) return { dispose: () => undefined };
    const repositories = new Map<GitRepository, vscode.Disposable>();
    const subscribe = (repository: GitRepository): void => {
      if (!repositories.has(repository))
        repositories.set(repository, repository.state.onDidChange(listener));
    };
    const unsubscribe = (repository: GitRepository): void => {
      repositories.get(repository)?.dispose();
      repositories.delete(repository);
    };
    for (const repository of api.repositories) subscribe(repository);
    const apiDisposables = [
      ...(typeof api.onDidOpenRepository === "function"
        ? [api.onDidOpenRepository(subscribe)]
        : []),
      ...(typeof api.onDidCloseRepository === "function"
        ? [api.onDidCloseRepository(unsubscribe)]
        : []),
    ];
    return {
      dispose: () => {
        for (const disposable of repositories.values()) disposable.dispose();
        repositories.clear();
        for (const disposable of apiDisposables) disposable.dispose();
      },
    };
  }

  private repository(rootUri: string): GitRepository | undefined {
    return this.getApi(false)?.getRepository(vscode.Uri.parse(rootUri)) ?? undefined;
  }

  private getApi(activate: false): GitApi | undefined;
  private getApi(activate: true): Promise<GitApi | undefined>;
  private getApi(activate: boolean): GitApi | undefined | Promise<GitApi | undefined> {
    const extension = vscode.extensions.getExtension<GitExtensionExports>("vscode.git");
    if (!extension) return activate ? Promise.resolve(undefined) : undefined;
    if (!activate) return extension.isActive ? extension.exports.getAPI(1) : undefined;
    return Promise.resolve(extension.activate()).then((exports) => exports.getAPI(1));
  }
}

async function executableMetadata(rootUri: string): Promise<GitMetadata & { remoteUrl?: string }> {
  const cwd = vscode.Uri.parse(rootUri).fsPath;
  try {
    const [{ stdout: branch }, { stdout: head }, remote, status] = await Promise.all([
      execute("git", ["rev-parse", "--abbrev-ref", "HEAD"], { cwd }),
      execute("git", ["rev-parse", "HEAD"], { cwd }),
      execute("git", ["config", "--get", "remote.origin.url"], { cwd }).catch(() => ({
        stdout: "",
      })),
      execute("git", ["status", "--porcelain=v1", "-z"], { cwd }).catch(() => ({ stdout: "" })),
    ]);
    const branchName = branch.trim();
    const headCommit = head.trim();
    const remoteUrl = remote.stdout.trim();
    const dirty = status.stdout;
    return {
      ...(branchName ? { branch: branchName } : {}),
      ...(headCommit ? { headCommit } : {}),
      ...(remoteUrl ? { remoteUrl } : {}),
      ...(dirty ? { dirtyFingerprint: `sha256:${await digestRemote(dirty)}` } : {}),
    };
  } catch {
    return {};
  }
}

async function digestRemote(value: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

async function digestChanges(changes: readonly GitChange[]): Promise<string> {
  const value = changes
    .map(
      (change) =>
        `${change.status ?? -1}:${change.originalUri?.toString() ?? ""}:${change.uri.toString()}`,
    )
    .sort()
    .join("\n");
  return `sha256:${await digestRemote(value)}`;
}

function gitChangeKind(change: GitChange): GitFileChange["kind"] {
  if (change.originalUri && change.originalUri.toString() !== change.uri.toString())
    return "renamed";
  if (change.status === 1 || change.status === 7 || change.status === 9) return "added";
  if (change.status === 2 || change.status === 6) return "deleted";
  if (change.status === 3 || change.status === 10) return "renamed";
  return "modified";
}

function legacyHash(value: string): string {
  let hash = 0;
  for (const character of value) hash = ((hash << 5) - hash + character.charCodeAt(0)) | 0;
  return Math.abs(hash).toString(16);
}
