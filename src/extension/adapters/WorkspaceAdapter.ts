import * as vscode from "vscode";

export interface WorkspaceAdapter {
  getRoots(): readonly vscode.WorkspaceFolder[];
  getWorkspaceId(): string;
  getWorkspaceRoot(rootIndex: number): string;
  readFile(uri: vscode.Uri): Promise<Uint8Array>;
  readTextFile(uri: vscode.Uri): Promise<string>;
  getConfiguration(section: string): vscode.WorkspaceConfiguration;
  openTextDocument(uri: vscode.Uri): Promise<vscode.TextDocument>;
  onDidOpenTextDocument(listener: (doc: vscode.TextDocument) => void): vscode.Disposable;
  onDidCloseTextDocument(listener: (doc: vscode.TextDocument) => void): vscode.Disposable;
  onDidChangeTextDocument(listener: (e: vscode.TextDocumentChangeEvent) => void): vscode.Disposable;
  onDidCreateFiles(listener: (e: vscode.FileCreateEvent) => void): vscode.Disposable;
  onDidDeleteFiles(listener: (e: vscode.FileDeleteEvent) => void): vscode.Disposable;
  onDidRenameFiles(listener: (e: vscode.FileRenameEvent) => void): vscode.Disposable;
  onDidChangeConfiguration(listener: (e: vscode.ConfigurationChangeEvent) => void): vscode.Disposable;
  createFileSystemWatcher(globPattern: vscode.GlobPattern, ignoreCreate?: boolean, ignoreChange?: boolean, ignoreDelete?: boolean): vscode.FileSystemWatcher;
  getWorkspaceSettings(): {
    fileExclusions: Record<string, boolean>;
    trustedFolders: readonly vscode.WorkspaceFolder[];
  };
}

export class VsCodeWorkspaceAdapter implements WorkspaceAdapter {
  constructor(private readonly context: vscode.ExtensionContext) {}

  getRoots(): readonly vscode.WorkspaceFolder[] {
    return vscode.workspace.workspaceFolders ?? [];
  }

  getWorkspaceId(): string {
    const roots = this.getRoots();
    if (roots.length === 0) return "no-workspace";
    if (roots.length === 1) return roots[0].uri.toString();
    return roots.map((r) => r.uri.toString()).sort().join("|");
  }

  getWorkspaceRoot(rootIndex: number): string {
    const roots = this.getRoots();
    return roots[rootIndex]?.uri.toString() ?? "";
  }

  async readFile(uri: vscode.Uri): Promise<Uint8Array> {
    return vscode.workspace.fs.readFile(uri);
  }

  async readTextFile(uri: vscode.Uri): Promise<string> {
    const bytes = await this.readFile(uri);
    return new TextDecoder().decode(bytes);
  }

  getConfiguration(section: string): vscode.WorkspaceConfiguration {
    return vscode.workspace.getConfiguration(section);
  }

  async openTextDocument(uri: vscode.Uri): Promise<vscode.TextDocument> {
    return vscode.workspace.openTextDocument(uri);
  }

  onDidOpenTextDocument(listener: (doc: vscode.TextDocument) => void): vscode.Disposable {
    return vscode.workspace.onDidOpenTextDocument(listener);
  }

  onDidCloseTextDocument(listener: (doc: vscode.TextDocument) => void): vscode.Disposable {
    return vscode.workspace.onDidCloseTextDocument(listener);
  }

  onDidChangeTextDocument(listener: (e: vscode.TextDocumentChangeEvent) => void): vscode.Disposable {
    return vscode.workspace.onDidChangeTextDocument(listener);
  }

  onDidCreateFiles(listener: (e: vscode.FileCreateEvent) => void): vscode.Disposable {
    return vscode.workspace.onDidCreateFiles(listener);
  }

  onDidDeleteFiles(listener: (e: vscode.FileDeleteEvent) => void): vscode.Disposable {
    return vscode.workspace.onDidDeleteFiles(listener);
  }

  onDidRenameFiles(listener: (e: vscode.FileRenameEvent) => void): vscode.Disposable {
    return vscode.workspace.onDidRenameFiles(listener);
  }

  onDidChangeConfiguration(listener: (e: vscode.ConfigurationChangeEvent) => void): vscode.Disposable {
    return vscode.workspace.onDidChangeConfiguration(listener);
  }

  createFileSystemWatcher(
    globPattern: vscode.GlobPattern,
    ignoreCreate = false,
    ignoreChange = false,
    ignoreDelete = false
  ): vscode.FileSystemWatcher {
    return vscode.workspace.createFileSystemWatcher(globPattern, ignoreCreate, ignoreChange, ignoreDelete);
  }

  getWorkspaceSettings(): { fileExclusions: Record<string, boolean>; trustedFolders: readonly vscode.WorkspaceFolder[] } {
    const settings = vscode.workspace.getConfiguration("files");
    return {
      fileExclusions: settings.get("exclude", {}) as Record<string, boolean>,
      trustedFolders: vscode.workspace.workspaceFolders?.filter((f) => f.uri.scheme === "file" && vscode.workspace.isTrusted) ?? []
    };
  }
}
