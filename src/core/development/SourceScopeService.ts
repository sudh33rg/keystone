import { randomUUID } from "node:crypto";
import { relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import type { DevelopmentScopeItem } from "../../shared/contracts/development";

export class SourceScopeError extends Error {
  constructor(public readonly code: string, message: string, public readonly recoverable = true) { super(message); this.name = "SourceScopeError"; }
}

export interface ScopeFileSystem { exists(workspaceRelativePath: string): Promise<boolean>; }
type ScopeIds = { workflowId: string; workItemId: string; fileUri: string; source: DevelopmentScopeItem["source"]; existing: DevelopmentScopeItem[] };

export class SourceScopeService {
  constructor(private readonly workspaceRoot: string, private readonly files: ScopeFileSystem, private readonly now: () => string = () => new Date().toISOString(), private readonly createId: () => string = randomUUID) {}

  async createFileItem(input: ScopeIds): Promise<DevelopmentScopeItem> {
    const workspaceRelativePath = this.validateWorkspacePath(input.fileUri);
    this.assertNotDuplicate(workspaceRelativePath, undefined, input.existing);
    if (!await this.files.exists(workspaceRelativePath)) throw new SourceScopeError("file-not-found", "The selected workspace file could not be found.");
    return { id: this.createId(), workflowId: input.workflowId, workItemId: input.workItemId, kind: "file", fileUri: input.fileUri, workspaceRelativePath, source: input.source, availability: "available", createdAt: this.now() };
  }

  async createSymbolItem(input: ScopeIds & { symbol?: DevelopmentScopeItem["symbol"] }): Promise<DevelopmentScopeItem> {
    if (!input.symbol) throw new SourceScopeError("symbol-unresolved", "Keystone could not resolve a repository symbol for this selection.");
    const workspaceRelativePath = this.validateWorkspacePath(input.fileUri);
    this.assertNotDuplicate(workspaceRelativePath, input.symbol.entityId, input.existing);
    if (!await this.files.exists(workspaceRelativePath)) throw new SourceScopeError("file-not-found", "The selected symbol's workspace file could not be found.");
    return { id: this.createId(), workflowId: input.workflowId, workItemId: input.workItemId, kind: "symbol", fileUri: input.fileUri, workspaceRelativePath, symbol: input.symbol, source: input.source, availability: "available", createdAt: this.now() };
  }

  remove(id: string, items: DevelopmentScopeItem[]): DevelopmentScopeItem[] {
    if (!items.some((item) => item.id === id)) throw new SourceScopeError("scope-item-not-found", "The selected source-scope item was not found.");
    return items.filter((item) => item.id !== id);
  }

  async refreshAvailability(items: DevelopmentScopeItem[]): Promise<DevelopmentScopeItem[]> {
    return Promise.all(items.map(async (item) => ({ ...item, availability: await this.files.exists(item.workspaceRelativePath) ? "available" as const : "missing" as const })));
  }

  private validateWorkspacePath(fileUri: string): string {
    let absolute: string;
    try { absolute = fileURLToPath(fileUri); } catch { throw new SourceScopeError("file-not-found", "The selected file URI is invalid."); }
    const root = resolve(this.workspaceRoot);
    const candidate = resolve(absolute);
    const workspaceRelativePath = relative(root, candidate);
    if (!workspaceRelativePath || workspaceRelativePath === ".." || workspaceRelativePath.startsWith(`..${sep}`) || workspaceRelativePath.startsWith(sep)) throw new SourceScopeError("file-outside-workspace", "Only files inside the current workspace can be added.");
    return workspaceRelativePath.split(sep).join("/");
  }

  private assertNotDuplicate(path: string, entityId: string | undefined, items: DevelopmentScopeItem[]): void {
    if (items.some((item) => item.workspaceRelativePath === path && (entityId ? item.symbol?.entityId === entityId : item.kind === "file"))) throw new SourceScopeError("duplicate-scope-item", "That source item is already in the Development scope.");
  }
}
