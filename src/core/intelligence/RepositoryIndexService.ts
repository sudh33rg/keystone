import * as vscode from "vscode";
import type { WorkspaceAdapter } from "../../extension/adapters/WorkspaceAdapter";
import type { GitAdapter } from "../../extension/adapters/GitAdapter";
import type { LanguageServiceAdapter } from "../../extension/adapters/LanguageServiceAdapter";
import type { IgnorePolicy } from "./IgnorePolicy";
import type { KeystoneLogger } from "../../shared/logging/KeystoneLogger";
import type { WorkspaceStateStore } from "../../core/persistence/WorkspaceStateStore";
import {
  type FileRecord,
  type SymbolRecord,
  type Relationship,
  type RepositoryIndex,
  type RepositoryIdentity,
  type ProjectCommand,
  type FrameworkSignal,
  type IndexStatus,
  IndexStatusSchema,
  FileRecordSchema,
  SymbolRecordSchema,
  RelationshipSchema,
  RepositoryIndexSchema,
  SCHEMA_VERSION
} from "../../shared/contracts/domain";
import { KeystoneError } from "../../shared/errors/KeystoneError";

export interface IndexProgress {
  stage: string;
  fileCount: number;
  totalFiles: number;
  estimatedRemainingMs?: number;
}

export interface IndexCallbacks {
  onProgress: (progress: IndexProgress) => void;
  onUpdate: (index: RepositoryIndex) => void;
  onError: (error: KeystoneError) => void;
}

export class RepositoryIndexService {
  private currentBranch = "HEAD";
  private currentCommit = "";
  private cancelToken: { cancelled: boolean } = { cancelled: false };
  private currentIndex: RepositoryIndex | null = null;

  constructor(
    private readonly workspace: WorkspaceAdapter,
    private readonly git: GitAdapter,
    private readonly language: LanguageServiceAdapter,
    private readonly ignorePolicy: IgnorePolicy,
    private readonly store: WorkspaceStateStore,
    private readonly logger: KeystoneLogger
  ) {}

  async start(branch?: string, callbacks?: IndexCallbacks): Promise<RepositoryIndex> {
    this.cancelToken = { cancelled: false };
    const roots = this.workspace.getRoots();
    if (roots.length === 0) {
      throw new KeystoneError({
        code: "INDEX_NO_WORKSPACE",
        category: "INDEXING",
        message: "No workspace folder open.",
        operation: "index.start",
        recoverable: false,
        recommendedAction: "Open a workspace folder and try again."
      });
    }

    const repositoryId = this.workspace.getWorkspaceId();
    const rootPath = this.workspace.getWorkspaceRoot(0);

    if (branch) {
      this.currentBranch = branch;
    }
    if (this.git.isGitRepository(rootPath)) {
      this.currentBranch = this.git.getCurrentBranch(rootPath) ?? "HEAD";
      this.currentCommit = this.git.getHeadCommit(rootPath) ?? "";
    }

    const branchKey = `${repositoryId}:${this.currentBranch}`;

    const index: RepositoryIndex = {
      id: crypto.randomUUID(),
      repositoryId,
      branchKey,
      status: "scanning",
      startedAt: new Date().toISOString(),
      indexVersion: this.currentIndex?.indexVersion ?? 0 + 1,
      fileIds: [],
      relationshipIds: [],
      commands: [],
      frameworks: [],
      errors: []
    };

    if (callbacks) callbacks.onUpdate(index);

    const files = this.currentIndex?.fileIds ?? [];
    const relationships = this.currentIndex?.relationshipIds ?? [];
    const commands = this.currentIndex?.commands ?? [];
    const frameworks = this.currentIndex?.frameworks ?? [];

    const fileRecords: FileRecord[] = [];
    const symbolRecords: SymbolRecord[] = [];
    const relationshipList: Relationship[] = [];

    try {
      const filesFound = await this.scanFiles(rootPath, callbacks);
      if (this.cancelToken.cancelled) {
        index.status = "cancelled";
        return index;
      }

      index.status = "extracting-symbols";
      if (callbacks) callbacks.onProgress({ stage: "extracting-symbols", fileCount: 0, totalFiles: filesFound.length });

      const fileSymbols = await this.extractSymbols(filesFound, callbacks);
      symbolRecords.push(...fileSymbols);

      if (this.cancelToken.cancelled) {
        index.status = "cancelled";
        return index;
      }

      index.status = "building-relationships";
      if (callbacks) callbacks.onProgress({ stage: "building-relationships", fileCount: 0, totalFiles: filesFound.length });

      const fileRelationships = this.buildRelationships(filesFound, symbolRecords);
      relationshipList.push(...fileRelationships);

      index.fileIds = files.map((id) => id).concat(fileRecords.map((f) => f.id));
      index.relationshipIds = relationships.map((id) => id).concat(relationshipList.map((r) => r.id));
      index.commands = commands;
      index.frameworks = frameworks;
      index.status = "ready";
      index.completedAt = new Date().toISOString();

      this.currentIndex = index;
      if (callbacks) callbacks.onUpdate(index);
      this.logger.info("index.complete", "Repository index completed.", {
        files: fileRecords.length,
        symbols: symbolRecords.length,
        relationships: relationshipList.length
      });
      return index;
    } catch (error) {
      index.status = "failed";
      index.errors.push({ message: error instanceof Error ? error.message : String(error), category: "INDEXING" });
      if (this.currentIndex) {
        index.fileIds = this.currentIndex.fileIds;
        index.relationshipIds = this.currentIndex.relationshipIds;
        index.commands = this.currentIndex.commands;
        index.frameworks = this.currentIndex.frameworks;
      }
      if (callbacks) callbacks.onError(KeystoneError.fromUnknown(error, "index.scan"));
      return index;
    }
  }

  cancel(): void {
    this.cancelToken.cancelled = true;
  }

  getIndex(): RepositoryIndex | null {
    return this.currentIndex;
  }

  getBranch(): string {
    return this.currentBranch;
  }

  getCommit(): string {
    return this.currentCommit;
  }

  private async scanFiles(rootPath: string, callbacks?: IndexCallbacks): Promise<vscode.Uri[]> {
    const patterns = ["**/*"];
    const maxFiles = this.workspace.getConfiguration("keystone.indexing").get("maxFiles", 25_000);

    const files = await vscode.workspace.findFiles(
      { base: vscode.Uri.parse(rootPath), pattern: "**/*" },
      { base: vscode.Uri.parse(rootPath), pattern: "**/.*" },
      maxFiles
    );

    const included: vscode.Uri[] = [];
    for (const uri of files) {
      if (this.cancelToken.cancelled) break;
      const relativePath = uri.path.replace(new RegExp(`^${rootPath.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}/`), "");
      if (this.ignorePolicy.isExcluded(relativePath)) continue;

      try {
        const content = await this.workspace.readFile(uri);
        if (this.ignorePolicy.isBinary(content)) continue;
        if (this.ignorePolicy.isSecret(relativePath)) continue;
        if (this.ignorePolicy.isGenerated(relativePath)) continue;

        included.push(uri);
        if (callbacks) {
          callbacks.onProgress({ stage: "scanning", fileCount: included.length, totalFiles: files.length });
        }
      } catch {
        // Skip files that cannot be read
      }
    }

    return included;
  }

  private async extractSymbols(
    files: vscode.Uri[],
    callbacks?: IndexCallbacks
  ): Promise<SymbolRecord[]> {
    const symbols: SymbolRecord[] = [];
    let processed = 0;

    for (const uri of files) {
      if (this.cancelToken.cancelled) break;
      try {
        const doc = await vscode.workspace.openTextDocument(uri);
        const docSymbols = await this.language.getDocumentSymbols(doc);
        for (const symbol of docSymbols) {
          if (this.cancelToken.cancelled) break;
          symbols.push({
            id: crypto.randomUUID(),
            name: symbol.name,
            kind: symbol.kind,
            fileId: uri.toString(),
            declarationRange: {
              startLine: symbol.location.range.start.line + 1,
              startColumn: symbol.location.range.start.character + 1,
              endLine: symbol.location.range.end.line + 1,
              endColumn: symbol.location.range.end.character + 1
            },
            isExported: false,
            containerId: symbol.containerName,
            signature: symbol.detail ?? undefined,
            parserSource: "vscode",
            confidence: 0.9
          });
        }
        processed++;
        if (processed % 50 === 0 && callbacks) {
          callbacks.onProgress({ stage: "extracting-symbols", fileCount: processed, totalFiles: files.length });
        }
      } catch {
        // Skip files that cannot be parsed
      }
    }

    return symbols;
  }

  private buildRelationships(
    files: vscode.Uri[],
    symbols: SymbolRecord[]
  ): Relationship[] {
    const relationships: Relationship[] = [];

    for (const uri of files) {
      const relativePath = uri.path;
      const symbolsForFile = symbols.filter((s) => s.fileId === uri.toString());

      for (const symbol of symbolsForFile) {
        if (symbol.kind === vscode.SymbolKind.Function || symbol.kind === vscode.SymbolKind.Method) {
          // Add call relationships
          relationships.push({
            id: crypto.randomUUID(),
            sourceFileId: uri.toString(),
            targetFileId: uri.toString(),
            sourceSymbolId: symbol.id,
            kind: "calls",
            confidence: 0.5,
            evidenceLocation: `symbol:${symbol.name}`,
            extractionMethod: "language-service"
          });
        }
      }
    }

    return relationships;
  }
}
