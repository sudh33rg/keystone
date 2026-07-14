import * as vscode from "vscode";

export interface GitAdapter {
  isGitRepository(root: string): boolean;
  getRepository(root: string): vscode.SourceControl | undefined;
  getCurrentBranch(root: string): string | undefined;
  getHeadCommit(root: string): string | undefined;
  getRemoteUrl(root: string): string | undefined;
  getChangedFiles(root: string, from?: string, to?: string): Promise<vscode.Uri[]>;
  getStagedFiles(root: string): Promise<vscode.Uri[]>;
  getUntrackedFiles(root: string): Promise<vscode.Uri[]>;
  getRemoteIdentityHash(root: string): string | undefined;
  onDidCommit(listener: () => void): vscode.Disposable;
  onDidChangeState(listener: (state: vscode.SourceControlState) => void): vscode.Disposable;
}

export class VsCodeGitAdapter implements GitAdapter {
  constructor(private readonly context: vscode.ExtensionContext) {}

  getRepository(root: string): vscode.SourceControl | undefined {
    const extensions = vscode.extensions.all;
    const gitExtension = extensions.find((ext) => ext.id === "vscode.git");
    if (!gitExtension?.isActive) return undefined;

    const gitExports = gitExtension.exports as { getAPI(version: number): vscode.GitAPI | undefined };
    const api = gitExports.getAPI(1);
    if (!api) return undefined;

    const repo = api.getRepository(vscode.Uri.parse(root));
    return repo?.sourceControl;
  }

  isGitRepository(root: string): boolean {
    return this.getRepository(root) !== undefined;
  }

  getCurrentBranch(root: string): string | undefined {
    const extensions = vscode.extensions.all;
    const gitExtension = extensions.find((ext) => ext.id === "vscode.git");
    if (!gitExtension?.isActive) return undefined;

    const gitExports = gitExtension.exports as { getAPI(version: number): vscode.GitAPI | undefined };
    const api = gitExports.getAPI(1);
    if (!api) return undefined;

    const repo = api.getRepository(vscode.Uri.parse(root));
    return repo?.state.HEAD?.name;
  }

  getHeadCommit(root: string): string | undefined {
    const extensions = vscode.extensions.all;
    const gitExtension = extensions.find((ext) => ext.id === "vscode.git");
    if (!gitExtension?.isActive) return undefined;

    const gitExports = gitExtension.exports as { getAPI(version: number): vscode.GitAPI | undefined };
    const api = gitExports.getAPI(1);
    if (!api) return undefined;

    const repo = api.getRepository(vscode.Uri.parse(root));
    return repo?.state.HEAD?.commit;
  }

  getRemoteUrl(root: string): string | undefined {
    const extensions = vscode.extensions.all;
    const gitExtension = extensions.find((ext) => ext.id === "vscode.git");
    if (!gitExtension?.isActive) return undefined;

    const gitExports = gitExtension.exports as { getAPI(version: number): vscode.GitAPI | undefined };
    const api = gitExports.getAPI(1);
    if (!api) return undefined;

    const repo = api.getRepository(vscode.Uri.parse(root));
    const remote = repo?.state.remotes?.find((r) => r.name === "origin");
    return remote?.pushUrl ?? remote?.fetchUrl;
  }

  async getChangedFiles(root: string, from?: string, to?: string): Promise<vscode.Uri[]> {
    const extensions = vscode.extensions.all;
    const gitExtension = extensions.find((ext) => ext.id === "vscode.git");
    if (!gitExtension?.isActive) return [];

    const gitExports = gitExtension.exports as { getAPI(version: number): vscode.GitAPI | undefined };
    const api = gitExports.getAPI(1);
    if (!api) return [];

    const repo = api.getRepository(vscode.Uri.parse(root));
    if (!repo) return [];

    const diff = from && to ? await repo.diff(from, to) : repo.state.index;
    return diff.map((entry) => entry.uri);
  }

  async getStagedFiles(root: string): Promise<vscode.Uri[]> {
    const extensions = vscode.extensions.all;
    const gitExtension = extensions.find((ext) => ext.id === "vscode.git");
    if (!gitExtension?.isActive) return [];

    const gitExports = gitExtension.exports as { getAPI(version: number): vscode.GitAPI | undefined };
    const api = gitExports.getAPI(1);
    if (!api) return [];

    const repo = api.getRepository(vscode.Uri.parse(root));
    if (!repo) return [];

    return repo.state.index.map((entry) => entry.uri);
  }

  async getUntrackedFiles(root: string): Promise<vscode.Uri[]> {
    const extensions = vscode.extensions.all;
    const gitExtension = extensions.find((ext) => ext.id === "vscode.git");
    if (!gitExtension?.isActive) return [];

    const gitExports = gitExtension.exports as { getAPI(version: number): vscode.GitAPI | undefined };
    const api = gitExports.getAPI(1);
    if (!api) return [];

    const repo = api.getRepository(vscode.Uri.parse(root));
    if (!repo) return [];

    return repo.state.workingTreeChanges
      .filter((entry) => entry.original?.type === vscode.SourceControlInputBoxState.Untracked)
      .map((entry) => entry.uri);
  }

  getRemoteIdentityHash(root: string): string | undefined {
    const extensions = vscode.extensions.all;
    const gitExtension = extensions.find((ext) => ext.id === "vscode.git");
    if (!gitExtension?.isActive) return undefined;

    const gitExports = gitExtension.exports as { getAPI(version: number): vscode.GitAPI | undefined };
    const api = gitExports.getAPI(1);
    if (!api) return undefined;

    const repo = api.getRepository(vscode.Uri.parse(root));
    const remote = repo?.state.remotes?.find((r) => r.name === "origin");
    if (!remote?.pushUrl && !remote?.fetchUrl) return undefined;

    const url = remote.pushUrl ?? remote.fetchUrl;
    return url ? hashString(url) : undefined;
  }

  onDidCommit(listener: () => void): vscode.Disposable {
    const extensions = vscode.extensions.all;
    const gitExtension = extensions.find((ext) => ext.id === "vscode.git");
    if (!gitExtension?.isActive) return { dispose: () => {} };

    const gitExports = gitExtension.exports as { getAPI(version: number): vscode.GitAPI | undefined };
    const api = gitExports.getAPI(1);
    if (!api) return { dispose: () => {} };

    return api.onDidCommit(listener);
  }

  onDidChangeState(listener: (state: vscode.SourceControlState) => void): vscode.Disposable {
    const extensions = vscode.extensions.all;
    const gitExtension = extensions.find((ext) => ext.id === "vscode.git");
    if (!gitExtension?.isActive) return { dispose: () => {} };

    const gitExports = gitExtension.exports as { getAPI(version: number): vscode.GitAPI | undefined };
    const api = gitExports.getAPI(1);
    if (!api) return { dispose: () => {} };

    return api.onDidChangeState(listener);
  }
}

function hashString(input: string): string {
  let hash = 0;
  for (let i = 0; i < input.length; i++) {
    const char = input.charCodeAt(i);
    hash = ((hash << 5) - hash) + char;
    hash |= 0;
  }
  return Math.abs(hash).toString(16);
}
