import * as vscode from "vscode";
import { posix } from "node:path";
import { normalizeRelativePath } from "../../core/intelligence/StableId";

export interface WorkspaceRootReference {
  name: string;
  uri: string;
}

export interface WorkspaceFileReference {
  root: WorkspaceRootReference;
  uri: string;
  relativePath: string;
}

export interface WorkspaceFileStat {
  byteSize: number;
  modifiedAt: string;
  type: "file" | "directory" | "symbolic-link" | "unknown";
}

export interface IndexingConfiguration {
  enabled: boolean;
  onWorkspaceOpen: boolean;
  onBranchChange: boolean;
  maxFiles: number;
  maxFileSizeBytes: number;
  workerCount: number;
  retainedGenerations: number;
  exclusions: string[];
}

export interface ConfigurationReader {
  get<T>(section: string, defaultValue: T): T;
}

export interface WorkspaceAdapter {
  getRoots(): readonly WorkspaceRootReference[];
  getWorkspaceId(): string;
  getWorkspaceRoot(rootIndex: number): string;
  isTrusted(): boolean;
  listFiles(root: WorkspaceRootReference, maxFiles: number): Promise<WorkspaceFileReference[]>;
  resolveFile(uri: string): WorkspaceFileReference | undefined;
  fileReference(root: WorkspaceRootReference, relativePath: string): WorkspaceFileReference;
  statFile(uri: string): Promise<WorkspaceFileStat>;
  readFile(uri: string): Promise<Uint8Array>;
  readTextFile(uri: string): Promise<string>;
  getIndexingConfiguration(): IndexingConfiguration;
  getConfiguration(section: string): ConfigurationReader;
}

export class VsCodeWorkspaceAdapter implements WorkspaceAdapter {
  getRoots(): readonly WorkspaceRootReference[] {
    return (vscode.workspace.workspaceFolders ?? []).map((root) => ({ name: root.name, uri: root.uri.toString() }));
  }

  getWorkspaceId(): string {
    return this.getRoots().map((root) => root.uri).sort().join("|") || "no-workspace";
  }

  getWorkspaceRoot(rootIndex: number): string {
    return this.getRoots()[rootIndex]?.uri ?? "";
  }

  isTrusted(): boolean {
    return vscode.workspace.isTrusted;
  }

  async listFiles(root: WorkspaceRootReference, maxFiles: number): Promise<WorkspaceFileReference[]> {
    const rootUri = vscode.Uri.parse(root.uri);
    const uris = await vscode.workspace.findFiles(new vscode.RelativePattern(rootUri, "**/*"), undefined, maxFiles);
    const output: WorkspaceFileReference[] = [];
    for (let index = 0; index < uris.length; index++) {
      const uri = uris[index];
      if (!uri) continue;
      output.push({ root, uri: uri.toString(), relativePath: normalizeRelativePath(posix.relative(rootUri.path, uri.path)) });
      if ((index + 1) % 500 === 0) await new Promise<void>((resolve) => setImmediate(resolve));
    }
    return output;
  }

  resolveFile(uri: string): WorkspaceFileReference | undefined {
    const target = vscode.Uri.parse(uri);
    const root = this.getRoots()
      .filter((item) => {
        const rootUri = vscode.Uri.parse(item.uri);
        return rootUri.scheme === target.scheme && rootUri.authority === target.authority && (target.path === rootUri.path || target.path.startsWith(`${rootUri.path.replace(/\/$/, "")}/`));
      })
      .sort((left, right) => vscode.Uri.parse(right.uri).path.length - vscode.Uri.parse(left.uri).path.length)[0];
    if (!root) return undefined;
    const rootUri = vscode.Uri.parse(root.uri);
    return { root, uri: target.toString(), relativePath: normalizeRelativePath(posix.relative(rootUri.path, target.path)) };
  }

  fileReference(root: WorkspaceRootReference, relativePath: string): WorkspaceFileReference {
    const normalized = normalizeRelativePath(relativePath);
    return { root, relativePath: normalized, uri: vscode.Uri.joinPath(vscode.Uri.parse(root.uri), ...normalized.split("/")).toString() };
  }

  async statFile(uri: string): Promise<WorkspaceFileStat> {
    const stat = await vscode.workspace.fs.stat(vscode.Uri.parse(uri));
    return {
      byteSize: stat.size,
      modifiedAt: new Date(stat.mtime).toISOString(),
      type: fileType(stat.type)
    };
  }

  async readFile(uri: string): Promise<Uint8Array> {
    return vscode.workspace.fs.readFile(vscode.Uri.parse(uri));
  }

  async readTextFile(uri: string): Promise<string> {
    return new TextDecoder().decode(await this.readFile(uri));
  }

  getIndexingConfiguration(): IndexingConfiguration {
    const configuration = vscode.workspace.getConfiguration("keystone.indexing");
    return {
      enabled: configuration.get("enabled", true),
      onWorkspaceOpen: configuration.get("onWorkspaceOpen", true),
      onBranchChange: configuration.get("onBranchChange", true),
      maxFiles: configuration.get("maxFiles", 25_000),
      maxFileSizeBytes: configuration.get("maxFileSizeKb", 1024) * 1024,
      workerCount: configuration.get("workerCount", 0),
      retainedGenerations: configuration.get("retainedGenerations", 2),
      exclusions: configuration.get<string[]>("exclusions", [])
    };
  }

  getConfiguration(section: string): ConfigurationReader {
    return vscode.workspace.getConfiguration(section);
  }
}

function fileType(type: vscode.FileType): WorkspaceFileStat["type"] {
  if ((type & vscode.FileType.File) !== 0) return "file";
  if ((type & vscode.FileType.Directory) !== 0) return "directory";
  if ((type & vscode.FileType.SymbolicLink) !== 0) return "symbolic-link";
  return "unknown";
}
