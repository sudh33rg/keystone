import * as vscode from "vscode";
import type { SharedArtifactAdapter } from "../../core/team/TeamWorkflowService";

export class VsCodeTeamArtifactAdapter implements SharedArtifactAdapter {
  constructor(private readonly repositoryRoot: vscode.Uri | undefined) {}

  async exportJson(suggestedName: string, content: string): Promise<string | undefined> {
    const uri = await vscode.window.showSaveDialog({
      defaultUri: this.repositoryRoot ? vscode.Uri.joinPath(this.repositoryRoot, suggestedName) : undefined,
      filters: { "Keystone handoff": ["json"] },
      saveLabel: "Export reviewed handoff",
    });
    if (!uri) return undefined;
    await vscode.workspace.fs.writeFile(uri, new TextEncoder().encode(content));
    return uri.fsPath;
  }

  async exportZip(suggestedName: string, content: Uint8Array): Promise<string | undefined> {
    const uri = await vscode.window.showSaveDialog({
      defaultUri: this.repositoryRoot ? vscode.Uri.joinPath(this.repositoryRoot, suggestedName) : undefined,
      filters: { "Keystone handoff archive": ["zip"] },
      saveLabel: "Export reviewed handoff",
    });
    if (!uri) return undefined;
    await vscode.workspace.fs.writeFile(uri, content);
    return uri.fsPath;
  }

  async exportRepositoryArtifact(relativePath: string, content: string): Promise<string> {
    if (!this.repositoryRoot) throw new Error("No workspace repository is open.");
    if (!relativePath.startsWith(".keystone/handoffs/") || relativePath.split("/").includes("..")) throw new Error("Repository artifact path is outside the explicit handoff directory.");
    const uri = vscode.Uri.joinPath(this.repositoryRoot, ...relativePath.split("/"));
    await vscode.workspace.fs.createDirectory(vscode.Uri.joinPath(this.repositoryRoot, ".keystone", "handoffs"));
    await vscode.workspace.fs.writeFile(uri, new TextEncoder().encode(content));
    return relativePath;
  }

  async importArtifact(): Promise<{ source: "file"; label: string; bytes: Uint8Array } | undefined> {
    const [uri] = await vscode.window.showOpenDialog({ canSelectMany: false, canSelectFiles: true, canSelectFolders: false, filters: { "Keystone handoff": ["json", "zip"] }, openLabel: "Review handoff artifact" }) ?? [];
    if (!uri) return undefined;
    return { source: "file", label: uri.fsPath, bytes: await vscode.workspace.fs.readFile(uri) };
  }

  async writeClipboard(value: string): Promise<void> {
    await vscode.env.clipboard.writeText(value);
  }
}
