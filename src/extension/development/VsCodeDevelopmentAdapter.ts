import * as vscode from "vscode";
import { relative, resolve, sep } from "node:path";
import type { IntelligenceQueryService } from "../../core/intelligence/IntelligenceQueryService";
import type { LanguageServiceAdapter } from "../adapters/LanguageServiceAdapter";
import type { DevelopmentScopeItem } from "../../shared/contracts/development";

export const DEVELOPMENT_FILE_EXCLUDE_GLOB = "{**/node_modules/**,**/dist/**,**/out/**,**/build/**,**/.git/**,**/.keystone/**,**/coverage/**,**/.venv/**,**/venv/**}";

export class VsCodeDevelopmentAdapter {
  constructor(private readonly root: vscode.Uri, private readonly language: LanguageServiceAdapter, private readonly intelligence: IntelligenceQueryService) {}

  repositoryName(): string { return this.root.path.split("/").filter(Boolean).at(-1) ?? "workspace"; }
  async readScopeContent(workspaceRelativePath: string, range?: { startLine: number; endLine: number }): Promise<string> { const bytes = await vscode.workspace.fs.readFile(vscode.Uri.joinPath(this.root, ...workspaceRelativePath.split("/"))); const text = new TextDecoder().decode(bytes); if (!range) return text; return text.split(/\r?\n/).slice(range.startLine, range.endLine + 1).join("\n"); }
  async exists(workspaceRelativePath: string): Promise<boolean> {
    try { const stat = await vscode.workspace.fs.stat(vscode.Uri.joinPath(this.root, ...workspaceRelativePath.split("/"))); return (stat.type & vscode.FileType.Directory) === 0; } catch { return false; }
  }
  currentFileUri(): string {
    const editor = selectDevelopmentEditor(vscode.window.activeTextEditor, vscode.window.visibleTextEditors);
    if (!editor) throw developmentHostError("no-active-editor", "Open a workspace file before using Add Current File.");
    if (editor.document.isUntitled || editor.document.uri.scheme !== "file") throw developmentHostError("no-active-editor", "Untitled editors cannot be added to source scope.");
    this.relativePath(editor.document.uri);
    return editor.document.uri.toString();
  }
  async pickFileUris(): Promise<string[]> {
    const files = await vscode.workspace.findFiles(new vscode.RelativePattern(this.root, "**/*.{ts,tsx,js,jsx,mjs,cjs,json,md,mdx,txt,yaml,yml,toml,xml,html,css,scss,py,go,rs,java,kt,kts,cs,cpp,cc,c,h,hpp,rb,php,swift,sql,sh}"), DEVELOPMENT_FILE_EXCLUDE_GLOB, 5000);
    const choices = files.map((uri) => ({ label: uri.path.split("/").at(-1) ?? uri.path, description: this.relativePath(uri), uri }));
    const selected = await vscode.window.showQuickPick(choices, { canPickMany: true, matchOnDescription: true, placeHolder: "Select source or documentation files for Development scope", title: "Add Workspace Files" });
    return selected ? [...new Set(selected.map((item) => item.uri.toString()))] : [];
  }
  async pickInstructionPath(): Promise<string | undefined> {
    const files = await vscode.workspace.findFiles(new vscode.RelativePattern(this.root, "**/*.{md,mdx,txt}"), DEVELOPMENT_FILE_EXCLUDE_GLOB, 5000);
    const choices = files.map((uri) => ({ label: uri.path.split("/").at(-1) ?? uri.path, description: this.relativePath(uri), uri }));
    const selected = await vscode.window.showQuickPick(choices, { canPickMany: false, matchOnDescription: true, placeHolder: "Select an existing Markdown or text instruction file", title: "Add Instruction File" });
    return selected ? this.relativePath(selected.uri) : undefined;
  }
  async currentSelectionSymbol(): Promise<{ fileUri: string; symbol: NonNullable<DevelopmentScopeItem["symbol"]> } | undefined> {
    const editor = selectDevelopmentEditor(vscode.window.activeTextEditor, vscode.window.visibleTextEditors);
    if (!editor || editor.selection.isEmpty || editor.document.uri.scheme !== "file") return undefined;
    const relativePath = this.relativePath(editor.document.uri);
    const extracted = await this.language.extractSymbols(editor.document.uri.toString());
    const line = editor.selection.active.line;
    const candidates = extracted.symbols.filter((item) => item.range.startLine <= line && item.range.endLine >= line).sort((left, right) => (left.range.endLine - left.range.startLine) - (right.range.endLine - right.range.startLine));
    for (const candidate of candidates) {
      const search = await this.intelligence.search({ query: candidate.qualifiedName || candidate.name, limit: 50 });
      const match = search.items.find((item) => item.relativePath === relativePath && (item.qualifiedName === candidate.qualifiedName || item.name === candidate.name));
      if (match) return { fileUri: editor.document.uri.toString(), symbol: { entityId: match.id, name: match.qualifiedName || match.name, kind: match.type, range: { startLine: candidate.range.startLine, endLine: candidate.range.endLine } } };
    }
    return undefined;
  }
  async intelligenceSymbol(entityId: string): Promise<{ fileUri: string; symbol: NonNullable<DevelopmentScopeItem["symbol"]> } | undefined> {
    const details = await this.intelligence.entity(entityId);
    if (!details || !details.entity.fileId || !details.entity.relativePath) return undefined;
    const uri = vscode.Uri.joinPath(this.root, ...details.entity.relativePath.split("/"));
    if (!await this.exists(details.entity.relativePath)) return undefined;
    return { fileUri: uri.toString(), symbol: { entityId: details.entity.id, name: details.entity.qualifiedName || details.entity.name, kind: details.entity.type, ...(details.entity.sourceRange ? { range: { startLine: details.entity.sourceRange.startLine, endLine: details.entity.sourceRange.endLine } } : {}) } };
  }
  relativePath(uri: vscode.Uri): string {
    const root = resolve(this.root.fsPath); const candidate = resolve(uri.fsPath); const value = relative(root, candidate);
    if (!value || value === ".." || value.startsWith(`..${sep}`) || value.startsWith(sep)) throw developmentHostError("file-outside-workspace", "Only files inside the current workspace can be added.");
    return value.split(sep).join("/");
  }
}

export function selectDevelopmentEditor(
  active: vscode.TextEditor | undefined,
  visible: readonly vscode.TextEditor[],
): vscode.TextEditor | undefined {
  if (active?.document.uri.scheme === "file") return active;
  return [...visible].reverse().find((editor) => editor.document.uri.scheme === "file");
}

function developmentHostError(code: string, message: string): Error & { code: string; recoverable: boolean } { return Object.assign(new Error(message), { code, recoverable: true }); }
