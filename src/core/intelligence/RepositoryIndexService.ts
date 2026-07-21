import type { GitAdapter } from "../../extension/adapters/GitAdapter";
import type { LanguageServiceAdapter } from "../../extension/adapters/LanguageServiceAdapter";
import type {
  WorkspaceAdapter,
  WorkspaceFileReference,
} from "../../extension/adapters/WorkspaceAdapter";
import type {
  ClassificationDecision,
  IntelligenceDiagnostic,
  IntelligenceEvidenceRecord,
  IntelligenceFileRecord,
  IntelligenceSnapshot,
  IntelligenceStatus,
  IntelligenceSymbolRecord,
  WorkspaceRootRecord,
} from "../../shared/contracts/intelligence";
import { KeystoneError } from "../../shared/errors/KeystoneError";
import type { KeystoneLogger } from "../../shared/logging/KeystoneLogger";
import type { IntelligenceStore } from "../persistence/IntelligenceStore";
import type { IgnorePolicy } from "./IgnorePolicy";
import { normalizeRelativePath, normalizeSignature, sha256Bytes, stableId } from "./StableId";
import type { RepositoryChange, RepositoryChangeReason } from "./runtime/ChangeCollector";
import {
  DeltaMerger,
  DependencyInvalidator,
  emptyIngestionDelta,
  type FileIngestionJob,
  type IngestionDelta,
} from "./runtime/IngestionDelta";
import type { SemanticExtractor } from "./semantic/SemanticExtractionWorker";
import { SemanticDeltaBuilder } from "./semantic/SemanticDeltaBuilder";
import { SemanticGraphBuilder } from "./semantic/SemanticGraphBuilder";
import type { SemanticSourceFileInput } from "./semantic/SemanticModel";
import type { CpgDelta } from "../../shared/contracts/cpg";
import type { AdapterOutput, AdapterRegistryState } from "../../shared/contracts/adapters";

export interface IndexProgress {
  stage: "inventory" | "symbols" | "publishing";
  fileCount: number;
  totalFiles: number;
  currentFiles: string[];
}

export interface IntelligenceRuntimeState {
  status: IntelligenceStatus;
  pendingUpdate: boolean;
  scanRevision: number;
  trigger?: RepositoryChangeReason | "manual";
  progress?: IndexProgress;
  error?: { code: string; message: string; technicalDetails?: string; recommendedAction?: string };
}

export interface IntelligenceHasher {
  sha256(
    value: Uint8Array,
    options?: { signal?: AbortSignal; priority?: 0 | 1 | 2 | 3 },
  ): Promise<string>;
}

interface ScanRun {
  revision: number;
  cancelled: boolean;
  changes?: readonly RepositoryChange[];
  trigger: RepositoryChangeReason | "manual";
  signal?: AbortSignal;
  resolve(): void;
  reject(cause: unknown): void;
}

type RuntimeListener = (state: IntelligenceRuntimeState) => void;

export class RepositoryIndexService {
  private activeRun: ScanRun | undefined;
  private scanRevision = 0;
  private disposed = false;
  private readonly listeners = new Set<RuntimeListener>();
  private state: IntelligenceRuntimeState;

  constructor(
    private readonly workspace: WorkspaceAdapter,
    private readonly git: GitAdapter,
    private readonly language: LanguageServiceAdapter,
    private readonly ignorePolicy: IgnorePolicy,
    private readonly store: IntelligenceStore,
    private readonly logger: KeystoneLogger,
    private readonly hasher: IntelligenceHasher = { sha256: sha256Bytes },
    private readonly invalidator = new DependencyInvalidator(),
    private readonly deltaMerger = new DeltaMerger(),
    private readonly semantic?: SemanticExtractor,
    private readonly semanticDelta = new SemanticDeltaBuilder(),
    private readonly graphBuilder = new SemanticGraphBuilder(),
  ) {
    this.state = {
      status: store.isStorageAvailable() ? "not-indexed" : "storage-unavailable",
      pendingUpdate: false,
      scanRevision: 0,
    };
  }

  async initialize(): Promise<void> {
    const snapshot = await this.store.initialize();
    this.scanRevision = snapshot?.manifest.scanRevision ?? 0;
    const loadError = this.store.getLoadError();
    this.state = loadError
      ? {
          status: "failed",
          pendingUpdate: false,
          scanRevision: this.scanRevision,
          error: { code: loadError.code, message: loadError.message },
        }
      : {
          status:
            snapshot?.manifest.status ??
            (this.store.isStorageAvailable() ? "not-indexed" : "storage-unavailable"),
          pendingUpdate: false,
          scanRevision: this.scanRevision,
        };
    this.emit();
  }

  start(): { scanRevision: number } {
    const run = this.beginRun(undefined, "manual");
    void run.completion.catch(() => undefined);
    return { scanRevision: run.revision };
  }

  async reconcile(
    changes: readonly RepositoryChange[],
    trigger: RepositoryChangeReason,
    signal?: AbortSignal,
  ): Promise<void> {
    const run = this.beginRun(changes, trigger, signal);
    await run.completion;
  }

  async rebuild(trigger: RepositoryChangeReason | "manual", signal?: AbortSignal): Promise<void> {
    const run = this.beginRun(undefined, trigger, signal);
    await run.completion;
  }

  cancel(): void {
    const run = this.activeRun;
    if (!run) return;
    run.cancelled = true;
    this.activeRun = undefined;
    run.reject(abortError());
    const snapshot = this.store.getSnapshot();
    this.state = {
      status: snapshot?.manifest.status ?? "not-indexed",
      pendingUpdate: false,
      scanRevision: this.scanRevision,
    };
    this.emit();
  }

  dispose(): void {
    this.disposed = true;
    this.cancel();
    this.listeners.clear();
  }

  getState(): IntelligenceRuntimeState {
    return {
      ...this.state,
      ...(this.state.progress ? { progress: { ...this.state.progress } } : {}),
    };
  }

  onDidChange(listener: RuntimeListener): { dispose(): void } {
    this.listeners.add(listener);
    return { dispose: () => this.listeners.delete(listener) };
  }

  getIndex(): { indexVersion: number } | null {
    const snapshot = this.store.getSnapshot();
    return snapshot ? { indexVersion: snapshot.manifest.generation } : null;
  }

  getBranch(): string {
    return this.store.getSnapshot()?.repository.branch ?? "";
  }
  getCommit(): string {
    return this.store.getSnapshot()?.repository.headCommit ?? "";
  }

  private beginRun(
    changes: readonly RepositoryChange[] | undefined,
    trigger: ScanRun["trigger"],
    signal?: AbortSignal,
  ): { revision: number; completion: Promise<void> } {
    this.assertCanStart();
    if (this.activeRun) {
      this.activeRun.cancelled = true;
      this.activeRun.reject(abortError());
    }
    let resolve!: () => void;
    let reject!: (cause: unknown) => void;
    const completion = new Promise<void>((resolvePromise, rejectPromise) => {
      resolve = resolvePromise;
      reject = rejectPromise;
    });
    const run: ScanRun = {
      revision: ++this.scanRevision,
      cancelled: false,
      ...(changes ? { changes } : {}),
      trigger,
      ...(signal ? { signal } : {}),
      resolve,
      reject,
    };
    this.activeRun = run;
    const abort = (): void => {
      if (this.activeRun === run) this.cancel();
      else run.cancelled = true;
    };
    signal?.addEventListener("abort", abort, { once: true });
    this.state = {
      status: "scanning",
      pendingUpdate: true,
      scanRevision: run.revision,
      trigger,
      progress: {
        stage: "inventory",
        fileCount: 0,
        totalFiles: changes?.length ?? 0,
        currentFiles: [],
      },
    };
    this.emit();
    void this.executeRun(run)
      .then(() => run.resolve())
      .catch((cause: unknown) => this.failRun(run, cause))
      .finally(() => signal?.removeEventListener("abort", abort));
    return { revision: run.revision, completion };
  }

  private assertCanStart(): void {
    if (this.disposed)
      throw this.error(
        "INTELLIGENCE_DISPOSED",
        "Repository intelligence has been disposed.",
        false,
      );
    if (!this.store.isStorageAvailable())
      throw this.error(
        "INTELLIGENCE_STORAGE_UNAVAILABLE",
        "Extension-managed workspace storage is unavailable.",
        false,
      );
    if (!this.workspace.isTrusted())
      throw this.error(
        "INDEX_WORKSPACE_UNTRUSTED",
        "Repository indexing is disabled in Restricted Mode.",
        false,
      );
    if (this.workspace.getRoots().length === 0)
      throw this.error("INDEX_NO_WORKSPACE", "No workspace folder is open.", false);
  }

  private async executeRun(run: ScanRun): Promise<void> {
    const createdAt = new Date().toISOString();
    const roots = this.workspace.getRoots();
    const configuration = this.workspace.getIndexingConfiguration();
    if (!configuration.enabled)
      throw this.error(
        "INDEX_DISABLED",
        "Repository indexing is disabled by configuration.",
        false,
      );
    const git = await this.git.getMetadata(roots[0]?.uri ?? "");
    this.assertCurrent(run);
    const rootIdentity = roots
      .map((root) => root.uri)
      .sort()
      .join("|");
    const repositoryId = await stableId("repository", rootIdentity, git.remoteIdentity);
    const previous = this.store.getSnapshot();
    const incremental = run.changes !== undefined && previous?.repository.id === repositoryId;
    const generation = (previous?.manifest.generation ?? 0) + 1;
    const rootRecords = await Promise.all(
      roots.map(async (root) => {
        const id = await stableId("workspace-root", repositoryId, root.uri);
        return {
          id,
          name: root.name,
          evidenceIds: [await stableId("evidence", id, "workspace-inventory", generation)],
        };
      }),
    );
    const rootByUri = new Map(roots.map((root, index) => [root.uri, rootRecords[index]]));
    const records =
      incremental && previous
        ? this.invalidator.invalidate(previous, run.changes ?? [], rootByUri)
        : emptyIngestionDelta();
    const semanticFiles: SemanticSourceFileInput[] = [];
    const repositoryEvidenceId = await stableId(
      "evidence",
      repositoryId,
      "workspace-inventory",
      generation,
    );
    addRepositoryEvidence(
      records.evidence,
      repositoryId,
      repositoryEvidenceId,
      rootRecords,
      generation,
      git.branch,
      git.headCommit,
    );

    let candidates: WorkspaceFileReference[];
    if (incremental) {
      candidates = (run.changes ?? [])
        .filter((change) => change.kind !== "deleted")
        .flatMap((change) => {
          const root = roots.find((item) => item.uri === change.rootUri);
          return root
            ? [{ root, uri: change.uri, relativePath: normalizeRelativePath(change.relativePath) }]
            : [];
        });
    } else {
      candidates = await this.enumerateAll(roots, configuration.maxFiles, run);
    }
    if (incremental && records.files.length + candidates.length > configuration.maxFiles) {
      const allowed = Math.max(0, configuration.maxFiles - records.files.length);
      candidates = candidates.slice(0, allowed);
      records.diagnostics.push(
        diagnostic(
          "MAX_FILES_REACHED",
          "warning",
          "Additional changed files were not indexed because the configured file limit was reached.",
        ),
      );
    }

    this.progress(run, {
      stage: "inventory",
      fileCount: 0,
      totalFiles: candidates.length,
      currentFiles: [],
    });
    const concurrency = Math.max(1, Math.min(4, configuration.workerCount || 1));
    for (let index = 0; index < candidates.length; index += concurrency) {
      this.assertCurrent(run);
      const batch = candidates.slice(index, index + concurrency);
      await Promise.all(
        batch.map(async (candidate) => {
          const rootRecord = rootByUri.get(candidate.root.uri);
          if (rootRecord)
            await this.indexFile({
              run,
              candidate,
              rootRecord,
              repositoryId,
              generation,
              branch: git.branch,
              commit: git.headCommit,
              maxFileSizeBytes: configuration.maxFileSizeBytes,
              exclusions: configuration.exclusions,
              semanticFiles,
              ...records,
            });
        }),
      );
      this.progress(run, {
        stage: "inventory",
        fileCount: Math.min(candidates.length, index + batch.length),
        totalFiles: candidates.length,
        currentFiles: batch.map((item) => item.relativePath).slice(0, 20),
      });
      await yieldToHost();
    }

    this.assertCurrent(run);
    this.progress(run, {
      stage: this.semantic ? "symbols" : "publishing",
      fileCount: candidates.length,
      totalFiles: candidates.length,
      currentFiles: semanticFiles.map((item) => item.relativePath).slice(0, 20),
    });
    let status: "ready" | "partial" = records.diagnostics.some(
      (item) => item.severity === "error" || item.severity === "warning",
    )
      ? "partial"
      : "ready";
    records.files.sort(
      (left, right) =>
        left.workspaceRootId.localeCompare(right.workspaceRootId) ||
        left.relativePath.localeCompare(right.relativePath),
    );
    records.symbols.sort((left, right) => left.id.localeCompare(right.id));
    records.relationships.sort((left, right) => left.id.localeCompare(right.id));
    records.evidence.sort((left, right) => left.id.localeCompare(right.id));
    records.diagnostics.sort(
      (left, right) =>
        (left.relativePath ?? "").localeCompare(right.relativePath ?? "") ||
        left.code.localeCompare(right.code),
    );
    const firstRoot = rootRecords[0];
    if (!firstRoot) throw this.error("INDEX_NO_WORKSPACE", "No workspace folder is open.", false);
    let snapshot: IntelligenceSnapshot = {
      manifest: {
        schemaVersion: 1,
        generation,
        scanRevision: run.revision,
        repositoryId,
        status,
        createdAt,
        completedAt: new Date().toISOString(),
        extractorVersions: {
          "keystone.workspace-inventory": "1",
          ...(this.semantic
            ? { "keystone.typescript": "runtime" }
            : { "vscode.document-symbol-provider": "runtime" }),
        },
      },
      repository: {
        id: repositoryId,
        displayName: roots.length === 1 ? firstRoot.name : `${firstRoot.name} +${roots.length - 1}`,
        workspaceRoots: rootRecords,
        ...(git.branch ? { branch: git.branch } : {}),
        ...(git.headCommit ? { headCommit: git.headCommit } : {}),
        ...(git.dirtyFingerprint ? { dirtyFingerprint: git.dirtyFingerprint } : {}),
        evidenceIds: [repositoryEvidenceId],
      },
      files: records.files,
      symbols: records.symbols,
      relationships: records.relationships,
      evidence: records.evidence,
      diagnostics: records.diagnostics,
      contributions: incremental ? (previous?.contributions ?? []) : [],
    };
    let cpgDelta: CpgDelta | undefined;
    let adapterState: AdapterRegistryState | undefined;
    if (this.semantic) {
      let semantic;
      try {
        semantic = await this.semantic.extract(
          {
            repositoryId,
            projectKey: repositoryId,
            generation,
            jobRevision: run.revision,
            reset: !incremental,
            ...(git.branch ? { branch: git.branch } : {}),
            ...(git.headCommit ? { commit: git.headCommit } : {}),
            changedFiles: semanticFiles,
            removedPaths: (run.changes ?? [])
              .filter((change) => change.kind === "deleted")
              .map(
                (change) =>
                  previous?.files.find(
                    (file) =>
                      file.workspaceRootId === rootByUri.get(change.rootUri)?.id &&
                      file.relativePath === normalizeRelativePath(change.relativePath),
                  )?.id ?? change.relativePath,
              ),
            ...(!incremental && previous
              ? {
                  adapterCacheSeeds: buildAdapterCacheSeeds(
                    previous,
                    this.store.getAdapterState(),
                    run.revision,
                  ),
                }
              : {}),
          },
          run.signal,
        );
      } catch (cause) {
        if (safeMessage(cause).includes("SEMANTIC_CONTEXT_MISSING"))
          throw this.error(
            "INTELLIGENCE_SEMANTIC_CONTEXT_MISSING",
            "The semantic worker needs a complete repository context after restart.",
            true,
          );
        throw cause;
      }
      this.assertCurrent(run);
      if (semantic.jobRevision !== run.revision)
        throw this.error(
          "INTELLIGENCE_SEMANTIC_STALE",
          "The semantic worker returned an obsolete job revision.",
          true,
        );
      for (const file of semanticFiles) {
        if (semantic.sourceHashes[file.fileId] !== file.contentHash)
          throw this.error(
            "INTELLIGENCE_SEMANTIC_STALE",
            `The semantic worker used stale content for ${file.relativePath}.`,
            true,
          );
        const currentHash = await this.hasher.sha256(await this.workspace.readFile(file.uri), {
          signal: run.signal,
          priority: workerPriority(run.trigger),
        });
        if (currentHash !== file.contentHash)
          throw this.error(
            "INTELLIGENCE_SOURCE_STALE",
            `The file changed during semantic analysis: ${file.relativePath}.`,
            true,
          );
      }
      snapshot = await this.semanticDelta.mergeYielding(snapshot, semantic, run.signal);
      snapshot.manifest.extractorVersions[semantic.parserId] = semantic.parserVersion;
      cpgDelta = semantic.cpg;
      adapterState = semantic.adapterState;
      for (const capability of adapterState?.capabilities ?? [])
        snapshot.manifest.extractorVersions[capability.adapterId] ??= capability.version;
      if (cpgDelta && cpgDelta.semanticGeneration !== generation)
        throw this.error(
          "INTELLIGENCE_CPG_STALE",
          "The CPG worker result targets a different semantic generation.",
          true,
        );
      if (cpgDelta)
        snapshot.manifest.extractorVersions[cpgDelta.providerId] = cpgDelta.providerVersion;
    }
    status = snapshot.diagnostics.some(
      (item) => item.severity === "error" || item.severity === "warning",
    )
      ? "partial"
      : "ready";
    snapshot.manifest.status = status;
    snapshot.manifest.completedAt = new Date().toISOString();
    snapshot.files.sort(
      (left, right) =>
        left.workspaceRootId.localeCompare(right.workspaceRootId) ||
        left.relativePath.localeCompare(right.relativePath),
    );
    snapshot.symbols.sort((left, right) => left.id.localeCompare(right.id));
    snapshot.relationships.sort((left, right) => left.id.localeCompare(right.id));
    snapshot.evidence.sort((left, right) => left.id.localeCompare(right.id));
    snapshot.diagnostics.sort(
      (left, right) =>
        (left.relativePath ?? "").localeCompare(right.relativePath ?? "") ||
        left.code.localeCompare(right.code),
    );
    snapshot.contributions = await completeFileContributions(snapshot, run.signal);
    snapshot.indexes = await this.graphBuilder.buildIndexesYielding(snapshot, run.signal);
    this.progress(run, {
      stage: "publishing",
      fileCount: candidates.length,
      totalFiles: candidates.length,
      currentFiles: [],
    });
    this.assertCurrent(run);
    await this.store.save(snapshot, () => this.assertCurrent(run), cpgDelta, adapterState);
    this.assertCurrent(run);
    this.activeRun = undefined;
    this.state = { status, pendingUpdate: false, scanRevision: run.revision, trigger: run.trigger };
    this.logger.info(
      "intelligence.update.complete",
      "Repository intelligence generation was promoted.",
      {
        generation,
        trigger: run.trigger,
        incremental,
        files: records.files.length,
        changedFiles: run.changes?.length ?? candidates.length,
      },
    );
    this.emit();
  }

  private async enumerateAll(
    roots: readonly WorkspaceFileReference["root"][],
    maxFiles: number,
    run: ScanRun,
  ): Promise<WorkspaceFileReference[]> {
    const candidates: WorkspaceFileReference[] = [];
    let remaining = maxFiles;
    for (const root of roots) {
      if (remaining <= 0) break;
      const found = await this.workspace.listFiles(root, remaining);
      const relevant = found.filter((file) => {
        const decision = this.ignorePolicy.decide(file.relativePath);
        return (
          decision.included ||
          ![
            "exclude.directory",
            "exclude.generated",
            "exclude.binary",
            "exclude.keystone-intelligence",
          ].includes(decision.ruleId)
        );
      });
      candidates.push(...relevant);
      remaining -= relevant.length;
      await yieldToHost();
      this.assertCurrent(run);
    }
    return candidates;
  }

  private async indexFile(input: IndexFileInput): Promise<void> {
    const { candidate, rootRecord, repositoryId, generation } = input;
    const relativePath = normalizeRelativePath(candidate.relativePath);
    let classification = applyCustomExclusions(
      this.ignorePolicy.decide(relativePath),
      relativePath,
      input.exclusions,
    );
    let observed;
    try {
      observed = await this.workspace.statFile(candidate.uri);
    } catch (cause) {
      input.diagnostics.push(
        diagnostic("FILE_STAT_FAILED", "warning", safeMessage(cause), rootRecord.id, relativePath),
      );
      return;
    }
    if (observed.type !== "file") return;
    if (
      observed.byteSize > input.maxFileSizeBytes &&
      classification.included &&
      classification.analysisLevel !== "metadata-only"
    ) {
      classification = {
        ...classification,
        analysisLevel: "metadata-only",
        ruleId: "limit.file-size",
        reason: "File exceeds the configured deep-analysis size limit.",
      };
    }

    let contentHash: string | undefined;
    let indexedContent: Uint8Array | undefined;
    if (
      classification.included &&
      !classification.sensitive &&
      classification.analysisLevel !== "metadata-only"
    ) {
      try {
        const content = await this.workspace.readFile(candidate.uri);
        indexedContent = content;
        classification = applyCustomExclusions(
          this.ignorePolicy.decide(relativePath, content),
          relativePath,
          input.exclusions,
        );
        if (classification.included && !classification.binary)
          contentHash = await this.hasher.sha256(content, {
            signal: input.run.signal,
            priority: workerPriority(input.run.trigger),
          });
      } catch (cause) {
        input.diagnostics.push(
          diagnostic(
            "FILE_READ_FAILED",
            "warning",
            safeMessage(cause),
            rootRecord.id,
            relativePath,
          ),
        );
        classification = {
          ...classification,
          analysisLevel: "metadata-only",
          ruleId: "read.failed",
          reason: "File could not be read; metadata was retained.",
        };
      }
    }

    const local = emptyRecords();
    const fileJob: FileIngestionJob | undefined = contentHash
      ? {
          path: relativePath,
          inputContentHash: contentHash,
          jobRevision: input.run.revision,
          baseGeneration: generation - 1,
          ...(input.run.signal ? { signal: input.run.signal } : {}),
        }
      : undefined;
    const fileId = await stableId("file", repositoryId, rootRecord.id, relativePath);
    const fileEvidenceId = await stableId("evidence", fileId, "inventory", contentHash, generation);
    const sensitiveStatement = classification.sensitive
      ? " Sensitive content was not read or persisted."
      : "";
    local.evidence.push(
      evidenceRecord(
        fileEvidenceId,
        fileId,
        rootRecord.id,
        relativePath,
        generation,
        input.branch,
        input.commit,
        contentHash,
        "workspace-inventory",
        "keystone.workspace-inventory",
        `File metadata was observed. Classification ${classification.ruleId}: ${classification.reason}${sensitiveStatement}`,
        undefined,
        "1",
        fileId,
      ),
    );
    const file: IntelligenceFileRecord = {
      id: fileId,
      repositoryId,
      workspaceRootId: rootRecord.id,
      relativePath,
      language: languageFromPath(relativePath),
      category: classification.category,
      analysisLevel: classification.analysisLevel,
      byteSize: observed.byteSize,
      modifiedAt: observed.modifiedAt,
      ...(contentHash ? { contentHash } : {}),
      classification,
      evidenceIds: [fileEvidenceId],
      generation,
    };
    local.files.push(file);
    const containsId = await stableId(
      "relationship",
      repositoryId,
      fileId,
      "keystone.core.CONTAINS",
    );
    const containsEvidenceId = await stableId("evidence", containsId, fileEvidenceId);
    local.evidence.push(
      evidenceRecord(
        containsEvidenceId,
        containsId,
        rootRecord.id,
        relativePath,
        generation,
        input.branch,
        input.commit,
        contentHash,
        "workspace-inventory",
        "keystone.workspace-inventory",
        "The repository contains the inventoried file.",
        undefined,
        "1",
        fileId,
      ),
    );
    local.relationships.push({
      id: containsId,
      repositoryId,
      sourceId: repositoryId,
      targetId: fileId,
      type: "keystone.core.CONTAINS",
      ownerFileId: fileId,
      targetFileId: fileId,
      resolution: "exact",
      evidenceIds: [containsEvidenceId],
      derivation: "extracted",
      confidence: 1,
      generation,
    });

    if (this.semantic && indexedContent && contentHash && shouldUseSemanticParser(file)) {
      input.semanticFiles.push({
        uri: candidate.uri,
        relativePath,
        workspaceRootId: rootRecord.id,
        fileId,
        language: file.language,
        category: file.category,
        contentHash,
        content: new TextDecoder().decode(indexedContent),
      });
    }

    if (
      (!this.semantic || !isTypeScriptJavaScript(file.language)) &&
      classification.analysisLevel === "deep" &&
      classification.included &&
      !classification.sensitive &&
      !classification.binary &&
      contentHash
    ) {
      this.progress(input.run, {
        stage: "symbols",
        fileCount: input.symbols.length,
        totalFiles: input.files.length + 1,
        currentFiles: [relativePath],
      });
      try {
        const extracted = await this.language.extractSymbols(candidate.uri);
        file.language = extracted.language || file.language;
        if (!extracted.available)
          local.diagnostics.push(
            diagnostic(
              "SYMBOL_PROVIDER_UNAVAILABLE",
              "info",
              "No declaration provider is available for this file.",
              rootRecord.id,
              relativePath,
            ),
          );
        else await this.addSymbols(extracted, file, input, local, contentHash);
      } catch (cause) {
        local.diagnostics.push(
          diagnostic(
            "SYMBOL_EXTRACTION_FAILED",
            "warning",
            safeMessage(cause),
            rootRecord.id,
            relativePath,
          ),
        );
      }
    }

    if (fileJob && indexedContent) {
      const current = await this.workspace.statFile(candidate.uri);
      if (current.modifiedAt !== observed.modifiedAt || current.byteSize !== observed.byteSize)
        throw this.error(
          "INTELLIGENCE_SOURCE_STALE",
          `The file changed during analysis: ${relativePath}`,
          true,
        );
      const currentHash = await this.hasher.sha256(await this.workspace.readFile(candidate.uri), {
        signal: input.run.signal,
        priority: workerPriority(input.run.trigger),
      });
      if (currentHash !== fileJob.inputContentHash)
        throw this.error(
          "INTELLIGENCE_SOURCE_STALE",
          `The file content changed during analysis: ${relativePath}`,
          true,
        );
    }
    this.deltaMerger.merge(input, local);
  }

  private async addSymbols(
    extracted: Awaited<ReturnType<LanguageServiceAdapter["extractSymbols"]>>,
    file: IntelligenceFileRecord,
    input: IndexFileInput,
    local: MutableRecords,
    contentHash: string,
  ): Promise<void> {
    const duplicateCounts = new Map<string, number>();
    for (const fact of extracted.symbols) {
      this.assertCurrent(input.run);
      const signature = normalizeSignature(fact.signature);
      const collisionKey = [fact.type, fact.qualifiedName, signature ?? ""].join("|");
      const ordinal = duplicateCounts.get(collisionKey) ?? 0;
      duplicateCounts.set(collisionKey, ordinal + 1);
      const symbolId = await stableId(
        "entity",
        input.repositoryId,
        file.id,
        extracted.extractorId,
        fact.type,
        fact.qualifiedName,
        signature,
        ordinal,
      );
      const symbolEvidenceId = await stableId(
        "evidence",
        symbolId,
        file.relativePath,
        fact.range.startLine,
        fact.range.startColumn,
        contentHash,
        extracted.extractorVersion,
      );
      local.evidence.push({
        id: symbolEvidenceId,
        subjectId: symbolId,
        ownerFileId: file.id,
        sourceKind: "language-provider",
        workspaceRootId: input.rootRecord.id,
        relativePath: file.relativePath,
        range: fact.range,
        extractorId: extracted.extractorId,
        extractorVersion: extracted.extractorVersion,
        derivation: "extracted",
        contentHash,
        ...(input.branch ? { branch: input.branch } : {}),
        ...(input.commit ? { commit: input.commit } : {}),
        generation: input.generation,
        confidence: 1,
        statement: `The language provider reported the declaration ${fact.qualifiedName}.`,
      });
      const symbol: IntelligenceSymbolRecord = {
        id: symbolId,
        repositoryId: input.repositoryId,
        fileId: file.id,
        ownerFileId: file.id,
        type: fact.type,
        name: fact.name,
        qualifiedName: fact.qualifiedName,
        language: extracted.language,
        ...(signature ? { signature } : {}),
        range: fact.range,
        evidenceIds: [symbolEvidenceId],
        confidence: 1,
        generation: input.generation,
      };
      local.symbols.push(symbol);
      const declaresId = await stableId(
        "relationship",
        file.id,
        symbolId,
        "keystone.core.DECLARES",
      );
      const declaresEvidenceId = await stableId("evidence", declaresId, symbolEvidenceId);
      local.evidence.push(
        evidenceRecord(
          declaresEvidenceId,
          declaresId,
          input.rootRecord.id,
          file.relativePath,
          input.generation,
          input.branch,
          input.commit,
          contentHash,
          "language-provider",
          extracted.extractorId,
          `The file declares ${fact.qualifiedName} at the provider-reported source range.`,
          fact.range,
          extracted.extractorVersion,
          file.id,
        ),
      );
      local.relationships.push({
        id: declaresId,
        repositoryId: input.repositoryId,
        sourceId: file.id,
        targetId: symbolId,
        type: "keystone.core.DECLARES",
        ownerFileId: file.id,
        targetFileId: file.id,
        resolution: "exact",
        evidenceIds: [declaresEvidenceId],
        derivation: "extracted",
        confidence: 1,
        generation: input.generation,
      });
    }
  }

  private progress(run: ScanRun, progress: IndexProgress): void {
    if (this.activeRun !== run || run.cancelled) return;
    this.state = {
      status: "scanning",
      pendingUpdate: true,
      scanRevision: run.revision,
      trigger: run.trigger,
      progress,
    };
    this.emit();
  }

  private assertCurrent(run: ScanRun): void {
    if (this.disposed || run.cancelled || this.activeRun !== run)
      throw this.error("INTELLIGENCE_SCAN_STALE", "The update was cancelled or superseded.", true);
  }

  private failRun(run: ScanRun, cause: unknown): void {
    if (run.cancelled || this.disposed || this.activeRun !== run) {
      run.reject(abortError());
      return;
    }
    this.activeRun = undefined;
    const error = KeystoneError.fromUnknown(cause, "intelligence.update");
    this.logger.error(error);
    const snapshot = this.store.getSnapshot();
    this.state = {
      status: snapshot?.manifest.status ?? "failed",
      pendingUpdate: false,
      scanRevision: run.revision,
      trigger: run.trigger,
      error: {
        code: error.code,
        message: error.message,
        ...(error.technicalDetails ? { technicalDetails: error.technicalDetails } : {}),
        recommendedAction: error.recommendedAction,
      },
    };
    this.emit();
    run.reject(error);
  }

  private emit(): void {
    const state = this.getState();
    for (const listener of this.listeners) listener(state);
  }

  private error(code: string, message: string, retryable: boolean): KeystoneError {
    return new KeystoneError({
      code,
      category: "INDEXING",
      message,
      operation: "intelligence.update",
      recoverable: retryable,
      recommendedAction: retryable
        ? "Retry the repository update."
        : "Review the workspace and Keystone settings.",
      retryable,
    });
  }
}

export function buildAdapterCacheSeeds(
  snapshot: IntelligenceSnapshot,
  state: AdapterRegistryState | undefined,
  jobRevision: number,
): AdapterOutput[] {
  if (!state || state.generation !== snapshot.manifest.generation) return [];
  const evidenceById = new Map(snapshot.evidence.map((item) => [item.id, item]));
  const fileById = new Map(snapshot.files.map((item) => [item.id, item]));
  return state.capabilities.flatMap((capability) => {
    if (
      !capability.adapterId.startsWith("keystone.adapter.") ||
      capability.adapterId.includes("cross-technology")
    )
      return [];
    const detections = state.detections.filter((item) => item.adapterId === capability.adapterId);
    const fileIds = [...new Set(detections.flatMap((item) => item.fileIds))];
    const sourceContentHashes = Object.fromEntries(
      fileIds.flatMap((id) => {
        const hash = fileById.get(id)?.contentHash;
        return hash ? [[id, hash]] : [];
      }),
    );
    if (Object.keys(sourceContentHashes).length !== fileIds.length) return [];
    const evidence = snapshot.evidence.filter((item) => item.extractorId === capability.adapterId);
    const supported = (evidenceIds: readonly string[]): boolean =>
      evidenceIds.some((id) => evidenceById.get(id)?.extractorId === capability.adapterId);
    const entities = snapshot.symbols.filter((item) => supported(item.evidenceIds));
    const relationships = snapshot.relationships.filter((item) => supported(item.evidenceIds));
    const diagnostics = snapshot.diagnostics
      .filter((item) => item.adapterId === capability.adapterId)
      .flatMap((item) => (item.adapterId ? [{ ...item, adapterId: item.adapterId }] : []));
    const metrics = state.metrics.find((item) => item.adapterId === capability.adapterId) ?? {
      adapterId: capability.adapterId,
      executionTimeMs: 0,
      filesConsidered: fileIds.length,
      filesParsed: fileIds.length,
      filesFailed: 0,
      cacheReused: 0,
      entitiesExtracted: entities.length,
      relationshipsResolved: relationships.length,
      crossLinksResolved: 0,
      unsupportedFiles: 0,
      memoryWarning: false,
    };
    return [
      {
        adapterId: capability.adapterId,
        adapterVersion: capability.version,
        sourceContentHashes,
        jobRevision,
        generationCompatibility: snapshot.manifest.generation,
        detections,
        entities,
        relationships,
        evidence,
        diagnostics,
        exclusions: [],
        invalidations: fileIds,
        indexUpdates: [],
        okfProjectionHints: [],
        metrics,
      },
    ];
  });
}

type MutableRecords = IngestionDelta;

interface IndexFileInput extends MutableRecords {
  run: ScanRun;
  candidate: WorkspaceFileReference;
  rootRecord: WorkspaceRootRecord;
  repositoryId: string;
  generation: number;
  branch?: string;
  commit?: string;
  maxFileSizeBytes: number;
  exclusions: string[];
  semanticFiles: SemanticSourceFileInput[];
}

function emptyRecords(): MutableRecords {
  return emptyIngestionDelta();
}

function addRepositoryEvidence(
  evidence: IntelligenceEvidenceRecord[],
  repositoryId: string,
  repositoryEvidenceId: string,
  roots: readonly WorkspaceRootRecord[],
  generation: number,
  branch?: string,
  commit?: string,
): void {
  const firstRoot = roots[0];
  if (!firstRoot) return;
  evidence.push({
    id: repositoryEvidenceId,
    subjectId: repositoryId,
    sourceKind: "workspace-inventory",
    workspaceRootId: firstRoot.id,
    relativePath: "",
    extractorId: "keystone.workspace-inventory",
    extractorVersion: "1",
    derivation: "extracted",
    ...(branch ? { branch } : {}),
    ...(commit ? { commit } : {}),
    generation,
    confidence: 1,
    statement: "Repository identity was derived from the active workspace roots.",
  });
  for (const root of roots)
    evidence.push({
      id: root.evidenceIds[0]!,
      subjectId: root.id,
      sourceKind: "workspace-inventory",
      workspaceRootId: root.id,
      relativePath: "",
      extractorId: "keystone.workspace-inventory",
      extractorVersion: "1",
      derivation: "extracted",
      ...(branch ? { branch } : {}),
      ...(commit ? { commit } : {}),
      generation,
      confidence: 1,
      statement: "The workspace root was observed in the active VS Code workspace.",
    });
}

function evidenceRecord(
  id: string,
  subjectId: string,
  workspaceRootId: string,
  relativePath: string,
  generation: number,
  branch: string | undefined,
  commit: string | undefined,
  contentHash: string | undefined,
  sourceKind: IntelligenceEvidenceRecord["sourceKind"],
  extractorId: string,
  statement: string,
  range?: IntelligenceEvidenceRecord["range"],
  extractorVersion = "1",
  ownerFileId?: string,
): IntelligenceEvidenceRecord {
  return {
    id,
    subjectId,
    ...(ownerFileId ? { ownerFileId } : {}),
    sourceKind,
    workspaceRootId,
    relativePath,
    ...(range ? { range } : {}),
    extractorId,
    extractorVersion,
    derivation: "extracted",
    ...(contentHash ? { contentHash } : {}),
    ...(branch ? { branch } : {}),
    ...(commit ? { commit } : {}),
    generation,
    confidence: 1,
    statement,
  };
}

function diagnostic(
  code: string,
  severity: IntelligenceDiagnostic["severity"],
  message: string,
  workspaceRootId?: string,
  relativePath?: string,
): IntelligenceDiagnostic {
  return {
    code,
    severity,
    message,
    ...(workspaceRootId ? { workspaceRootId } : {}),
    ...(relativePath ? { relativePath } : {}),
  };
}

function safeMessage(value: unknown): string {
  return value instanceof Error ? value.message : String(value);
}

function languageFromPath(path: string): string {
  const extension = path.split(".").at(-1)?.toLowerCase();
  const languages: Record<string, string> = {
    c: "c",
    cc: "cpp",
    cpp: "cpp",
    cs: "csharp",
    go: "go",
    h: "c",
    hpp: "cpp",
    java: "java",
    js: "javascript",
    jsx: "javascriptreact",
    kt: "kotlin",
    kts: "kotlin",
    php: "php",
    py: "python",
    rb: "ruby",
    rs: "rust",
    scala: "scala",
    swift: "swift",
    ts: "typescript",
    tsx: "typescriptreact",
    vue: "vue",
    svelte: "svelte",
  };
  return extension ? (languages[extension] ?? extension) : "unknown";
}

function applyCustomExclusions(
  decision: ClassificationDecision,
  path: string,
  exclusions: string[],
): ClassificationDecision {
  if (!exclusions.some((pattern) => globMatches(path, pattern))) return decision;
  return {
    ...decision,
    included: false,
    analysisLevel: "excluded",
    ruleId: "exclude.user",
    reason: "Matched a configured Keystone exclusion.",
  };
}

function globMatches(path: string, pattern: string): boolean {
  const doubleStar = "__KEYSTONE_DOUBLE_STAR__";
  const escaped = normalizeRelativePath(pattern)
    .replace(/[.+^${}()|[\]\\]/g, "\\$&")
    .replace(/\*\*/g, doubleStar)
    .replace(/\*/g, "[^/]*")
    .replaceAll(doubleStar, ".*");
  return new RegExp(`^${escaped}$`).test(path);
}

function yieldToHost(): Promise<void> {
  return new Promise((resolve) => setImmediate(resolve));
}
function abortError(): Error {
  const error = new Error("The intelligence update was cancelled.");
  error.name = "AbortError";
  return error;
}

function workerPriority(trigger: ScanRun["trigger"]): 0 | 1 | 2 | 3 {
  if (trigger === "manual" || trigger === "active-editor") return 0;
  if (trigger === "file") return 1;
  if (trigger === "git" || trigger === "startup") return 2;
  return 3;
}

function isTypeScriptJavaScript(language: string): boolean {
  return ["typescript", "typescriptreact", "javascript", "javascriptreact"].includes(language);
}

function shouldUseSemanticParser(file: IntelligenceFileRecord): boolean {
  return (
    file.classification.included &&
    !file.classification.sensitive &&
    !file.classification.binary &&
    (file.analysisLevel === "deep" || file.analysisLevel === "structural")
  );
}

async function completeFileContributions(
  snapshot: IntelligenceSnapshot,
  signal?: AbortSignal,
): Promise<NonNullable<IntelligenceSnapshot["contributions"]>> {
  const previous = new Map((snapshot.contributions ?? []).map((item) => [item.fileId, item]));
  const entitiesByFile = new Map<string, string[]>();
  const relationshipsByFile = new Map<string, string[]>();
  const evidenceByFile = new Map<string, string[]>();
  const diagnosticsByFile = new Map<string, string[]>();
  const dependenciesByFile = new Map<string, Set<string>>();
  for (const item of snapshot.symbols)
    addOwned(entitiesByFile, item.ownerFileId ?? item.fileId, item.id);
  for (const item of snapshot.relationships) {
    if (!item.ownerFileId) continue;
    addOwned(relationshipsByFile, item.ownerFileId, item.id);
    if (item.targetFileId && item.targetFileId !== item.ownerFileId) {
      const values = dependenciesByFile.get(item.ownerFileId) ?? new Set<string>();
      values.add(item.targetFileId);
      dependenciesByFile.set(item.ownerFileId, values);
    }
  }
  for (const item of snapshot.evidence)
    if (item.ownerFileId) addOwned(evidenceByFile, item.ownerFileId, item.id);
  for (const item of snapshot.diagnostics)
    if (item.ownerFileId && item.id) addOwned(diagnosticsByFile, item.ownerFileId, item.id);
  const contributions = [];
  for (let index = 0; index < snapshot.files.length; index++) {
    const file = snapshot.files[index];
    if (!file) continue;
    const prior = previous.get(file.id);
    const entities = entitiesByFile.get(file.id) ?? [];
    const relationships = relationshipsByFile.get(file.id) ?? [];
    const evidence = evidenceByFile.get(file.id) ?? [];
    const diagnostics = diagnosticsByFile.get(file.id) ?? [];
    contributions.push({
      fileId: file.id,
      ...(file.contentHash ? { sourceHash: file.contentHash } : {}),
      ...(file.structuralHash ? { structuralHash: file.structuralHash } : {}),
      parserId: file.parserId ?? prior?.parserId ?? "keystone.workspace-inventory",
      parserVersion: file.parserVersion ?? prior?.parserVersion ?? "1",
      entityIds: entities,
      relationshipIds: relationships,
      evidenceIds: evidence,
      diagnosticIds: diagnostics,
      dependencyFileIds: [...(dependenciesByFile.get(file.id) ?? [])].sort(),
      generation:
        prior &&
        prior.sourceHash === file.contentHash &&
        prior.entityIds.every((id) => entities.includes(id)) &&
        prior.relationshipIds.every((id) => relationships.includes(id))
          ? prior.generation
          : snapshot.manifest.generation,
    });
    if ((index + 1) % 200 === 0) {
      if (signal?.aborted) throw abortError();
      await yieldToHost();
    }
  }
  return contributions.sort((left, right) => left.fileId.localeCompare(right.fileId));
}

function addOwned(values: Map<string, string[]>, fileId: string, id: string): void {
  const items = values.get(fileId) ?? [];
  items.push(id);
  values.set(fileId, items);
}
