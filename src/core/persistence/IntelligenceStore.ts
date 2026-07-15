import { watch, type FSWatcher } from "node:fs";
import { link, mkdir, readFile, readdir, rename, rm, stat } from "node:fs/promises";
import { dirname, join } from "node:path";
import { gzip as gzipCallback, gunzip as gunzipCallback } from "node:zlib";
import { z } from "zod";
import {
  EvidenceRecordSchema,
  FileRecordSchema,
  IntelligenceDiagnosticSchema,
  IntelligenceManifestSchema,
  IntelligenceIndexesSchema,
  IntelligenceSnapshotSchema,
  FileContributionSchema,
  RelationshipRecordSchema,
  RepositoryRecordSchema,
  SymbolRecordSchema,
  type IntelligenceDiagnostic,
  type IntelligenceEvidenceRecord,
  type IntelligenceRelationshipRecord,
  type IntelligenceSnapshot,
  type IntelligenceSymbolRecord
} from "../../shared/contracts/intelligence";
import { KeystoneError } from "../../shared/errors/KeystoneError";
import type { CpgDelta, CpgGenerationManifest, CpgScopeArtifact } from "../../shared/contracts/cpg";
import { AtomicFileWriter } from "./AtomicFileWriter";
import { CpgShardStore } from "./CpgShardStore";
import { AdapterRegistryStateSchema, type AdapterRegistryState } from "../../shared/contracts/adapters";

export interface IntelligenceSnapshotReader {
  getSnapshot(): IntelligenceSnapshot | undefined;
  isStorageAvailable(): boolean;
  getLoadError(): KeystoneError | undefined;
  getCpgManifest?(): CpgGenerationManifest | undefined;
  readCpgScope?(scopeId: string): Promise<CpgScopeArtifact | undefined>;
  getAdapterState?(): AdapterRegistryState | undefined;
  getRetainedSnapshots?(): Promise<IntelligenceSnapshot[]>;
}

export interface IntelligenceJsonParser {
  parseJson(value: string): Promise<unknown>;
  stringifyJson?(value: unknown): Promise<string>;
  sha256?(value: Uint8Array): Promise<string>;
  gzip?(value: Uint8Array): Promise<Uint8Array>;
  parseGzipJson?(value: Uint8Array): Promise<unknown>;
}

export interface IntelligencePersistenceHealth {
  status: "healthy" | "missing" | "damaged";
  message?: string;
  pendingGenerations: number;
}

export interface IntelligenceContributionPartition {
  entities: IntelligenceSymbolRecord[];
  relationships: IntelligenceRelationshipRecord[];
  evidence: IntelligenceEvidenceRecord[];
  diagnostics: IntelligenceDiagnostic[];
}

const CurrentPointerSchema = z.object({
  schemaVersion: z.literal(1),
  generation: z.number().int().positive(),
  directory: z.string().regex(/^\d{6,}$/),
  promotedAt: z.string().datetime()
}).strict();

type CurrentPointer = z.infer<typeof CurrentPointerSchema>;

const SHARDS = ["manifest", "repository", "files", "symbols", "relationships", "evidence", "diagnostics", "contributions", "indexes", "adapters"] as const;
const OPTIONAL_SEMANTIC_SHARDS = new Set<(typeof SHARDS)[number]>(["contributions", "indexes", "adapters"]);
const SHARD_FILES: Record<(typeof SHARDS)[number], string> = {
  manifest: "manifest.json",
  repository: "repository.json",
  files: "files.json.gz",
  symbols: "symbols.json.gz",
  relationships: "relationships.json.gz",
  evidence: "evidence.json.gz",
  diagnostics: "diagnostics.json.gz",
  contributions: "contributions.json.gz",
  indexes: "indexes.json.gz",
  adapters: "adapters.json.gz"
};

const defaultJsonWorker: IntelligenceJsonParser = {
  parseJson: (value) => Promise.resolve(JSON.parse(value) as unknown),
  gzip: (value) => new Promise((resolve, reject) => gzipCallback(value, (error, output) => error ? reject(error) : resolve(output))),
  parseGzipJson: (value) => new Promise((resolve, reject) => gunzipCallback(value, (error, output) => {
    if (error) reject(error);
    else {
      try { resolve(JSON.parse(output.toString("utf8")) as unknown); }
      catch (cause) { reject(cause instanceof Error ? cause : new Error(String(cause))); }
    }
  }))
};

export class IntelligenceStore implements IntelligenceSnapshotReader {
  private activeSnapshot: IntelligenceSnapshot | undefined;
  private loadError: KeystoneError | undefined;
  private readonly intelligenceRoot: string | undefined;
  private readonly currentPath: string | undefined;
  private deletionWatcher: FSWatcher | undefined;
  private healthTimer: ReturnType<typeof setInterval> | undefined;
  private deletionKnownPresent = false;
  private readonly deletionListeners = new Set<() => void>();
  private readonly healthListeners = new Set<(health: IntelligencePersistenceHealth) => void>();
  private health: IntelligencePersistenceHealth = { status: "missing", pendingGenerations: 0 };
  private shardFingerprints = new Map<string, string>();
  private activeCpgManifest: CpgGenerationManifest | undefined;
  private activeAdapterState: AdapterRegistryState | undefined;
  private readonly cpgStore: CpgShardStore;
  private publicationTail: Promise<void> = Promise.resolve();

  constructor(
    private readonly storageRoot: string | undefined,
    private readonly writer = new AtomicFileWriter(),
    private readonly parser: IntelligenceJsonParser = defaultJsonWorker,
    private readonly retainedGenerations = 2
  ) {
    this.intelligenceRoot = storageRoot ? join(storageRoot, "intelligence") : undefined;
    this.currentPath = this.intelligenceRoot ? join(this.intelligenceRoot, "current.json") : undefined;
    this.cpgStore = new CpgShardStore(writer, parser);
  }

  isStorageAvailable(): boolean {
    return this.intelligenceRoot !== undefined;
  }

  getSnapshot(): IntelligenceSnapshot | undefined {
    return this.activeSnapshot;
  }

  getLoadError(): KeystoneError | undefined {
    return this.loadError;
  }

  getStorageRoot(): string | undefined {
    return this.intelligenceRoot;
  }

  getCpgManifest(): CpgGenerationManifest | undefined { return this.activeCpgManifest; }
  getAdapterState(): AdapterRegistryState | undefined { return this.activeAdapterState; }

  async getRetainedSnapshots(): Promise<IntelligenceSnapshot[]> {
    if (!this.intelligenceRoot) return this.activeSnapshot ? [this.activeSnapshot] : [];
    let directories: string[];
    try { directories = (await readdir(join(this.intelligenceRoot, "generations"), { withFileTypes: true })).filter((entry) => entry.isDirectory() && /^\d{6,}$/.test(entry.name)).map((entry) => entry.name).sort((left, right) => right.localeCompare(left)); }
    catch { return this.activeSnapshot ? [this.activeSnapshot] : []; }
    const snapshots: IntelligenceSnapshot[] = [];
    for (const directory of directories) {
      if (this.activeSnapshot && generationDirectory(this.activeSnapshot.manifest.generation) === directory) { snapshots.push(this.activeSnapshot); continue; }
      try { snapshots.push(await this.loadSnapshotOnly(directory)); } catch { /* A damaged retained generation is not exposed. */ }
    }
    return snapshots.sort((left, right) => right.manifest.generation - left.manifest.generation);
  }

  async readCpgScope(scopeId: string): Promise<CpgScopeArtifact | undefined> {
    if (!this.intelligenceRoot || !this.activeSnapshot || !this.activeCpgManifest) return undefined;
    const descriptor = this.activeCpgManifest.scopes.find((scope) => scope.id === scopeId);
    if (!descriptor) return undefined;
    const root = join(this.intelligenceRoot, "generations", generationDirectory(this.activeSnapshot.manifest.generation));
    return this.cpgStore.readScope(root, descriptor, this.activeSnapshot.manifest.generation);
  }

  async readContributionPartition(fileId: string): Promise<IntelligenceContributionPartition | undefined> {
    if (!this.intelligenceRoot || !this.activeSnapshot?.contributions?.some((item) => item.fileId === fileId)) return undefined;
    const root = join(this.intelligenceRoot, "generations", generationDirectory(this.activeSnapshot.manifest.generation));
    const key = partitionKey(fileId);
    const [entities, relationships, evidence, diagnostics] = await Promise.all([
      this.readJson(join(root, "entities", `${key}.json.gz`)),
      this.readJson(join(root, "relationships", `${key}.json.gz`)),
      this.readJson(join(root, "evidence", `${key}.json.gz`)),
      this.readJson(join(root, "diagnostics", `${key}.json.gz`))
    ]);
    return {
      entities: await parseArray(entities, (value) => SymbolRecordSchema.parse(value)),
      relationships: await parseArray(relationships, (value) => RelationshipRecordSchema.parse(value)),
      evidence: await parseArray(evidence, (value) => EvidenceRecordSchema.parse(value)),
      diagnostics: await parseArray(diagnostics, (value) => IntelligenceDiagnosticSchema.parse(value))
    };
  }

  onDidDelete(listener: () => void): { dispose(): void } {
    this.deletionListeners.add(listener);
    return { dispose: () => this.deletionListeners.delete(listener) };
  }

  onDidHealthChange(listener: (health: IntelligencePersistenceHealth) => void): { dispose(): void } {
    this.healthListeners.add(listener);
    return { dispose: () => this.healthListeners.delete(listener) };
  }

  getHealth(): IntelligencePersistenceHealth {
    return { ...this.health };
  }

  async initialize(): Promise<IntelligenceSnapshot | undefined> {
    if (!this.intelligenceRoot || !this.currentPath || !this.storageRoot) return undefined;
    await mkdir(this.storageRoot, { recursive: true });
    this.startDeletionMonitor();
    try {
      const pointer = CurrentPointerSchema.parse(await this.readJson(this.currentPath));
      this.activeSnapshot = await this.loadGeneration(pointer.directory);
      this.deletionKnownPresent = true;
      this.loadError = undefined;
      await this.finishInitialization();
      return this.activeSnapshot;
    } catch (cause) {
      if (isMissingFile(cause)) {
        const legacy = await this.loadLegacySnapshot();
        if (legacy) { await this.finishInitialization(); return legacy; }
        const recovered = await this.recoverLatestGeneration();
        if (recovered) { await this.finishInitialization(); return recovered; }
        await this.finishInitialization();
        return undefined;
      }
      await this.quarantineCurrentPointer();
      const recovered = await this.recoverLatestGeneration();
      if (recovered) { await this.finishInitialization(); return recovered; }
      this.loadError = persistenceError("INTELLIGENCE_LOAD_FAILED", "Keystone could not load a valid repository intelligence generation.", cause, "Run a new repository scan. Corrupt state was not exposed to queries.");
      await this.finishInitialization();
      return undefined;
    }
  }

  async save(snapshot: IntelligenceSnapshot, beforeCommit?: () => void, cpgDelta?: CpgDelta, adapterState?: AdapterRegistryState): Promise<void> {
    const previous = this.publicationTail;
    let release!: () => void;
    this.publicationTail = new Promise<void>((resolve) => { release = resolve; });
    await previous;
    try { await this.publishGeneration(snapshot, beforeCommit, cpgDelta, adapterState); }
    finally { release(); }
  }

  private async publishGeneration(snapshot: IntelligenceSnapshot, beforeCommit?: () => void, cpgDelta?: CpgDelta, adapterState?: AdapterRegistryState): Promise<void> {
    if (!this.intelligenceRoot || !this.currentPath) throw persistenceError("INTELLIGENCE_STORAGE_UNAVAILABLE", "Extension-managed workspace storage is unavailable.", undefined, "Open a saved local workspace before indexing.", false);
    const validated = await validateSnapshotYielding(snapshot);
    if (this.activeSnapshot && validated.manifest.generation <= this.activeSnapshot.manifest.generation) {
      throw persistenceError("INTELLIGENCE_STALE_GENERATION", "Keystone rejected a stale intelligence generation.", undefined, "Retry the repository update.");
    }

    const directory = generationDirectory(validated.manifest.generation);
    const generationsRoot = join(this.intelligenceRoot, "generations");
    const pendingDirectory = join(generationsRoot, `${directory}.pending`);
    const finalDirectory = join(generationsRoot, directory);
    try {
      await mkdir(generationsRoot, { recursive: true });
      await rm(pendingDirectory, { recursive: true, force: true });
      await mkdir(pendingDirectory, { recursive: true });
      const values: Record<(typeof SHARDS)[number], unknown> = {
        manifest: validated.manifest,
        repository: validated.repository,
        files: validated.files,
        symbols: validated.symbols,
        relationships: validated.relationships,
        evidence: validated.evidence,
        diagnostics: validated.diagnostics,
        contributions: validated.contributions ?? [],
        indexes: validated.indexes ?? { byName: {}, byQualifiedName: {}, byPath: {}, byType: {}, byLanguage: {}, incoming: {}, outgoing: {}, routeHandlers: {}, testTargets: {}, packageMembership: {}, configurationUsage: {} },
        adapters: adapterState ?? { schemaVersion: 1, generation: validated.manifest.generation, updatedAt: validated.manifest.completedAt, capabilities: [], detections: [], coverage: [], metrics: [] }
      };
      for (const shard of SHARDS) {
        const pendingShard = join(pendingDirectory, SHARD_FILES[shard]);
        const serialized = SHARD_FILES[shard].endsWith(".gz") ? this.serializeCompressed(values[shard]) : this.serialize(values[shard]);
        await this.writer.write(pendingShard, serialized, beforeCommit);
        await this.reusePreviousShard(shard, pendingShard);
      }
      await this.writeContributionShards(pendingDirectory, validated);
      const previousGeneration = this.activeSnapshot ? join(generationsRoot, generationDirectory(this.activeSnapshot.manifest.generation)) : undefined;
      const cpgManifest = cpgDelta ? await this.cpgStore.writeGeneration(pendingDirectory, previousGeneration, cpgDelta, beforeCommit) : undefined;
      beforeCommit?.();
      await rm(finalDirectory, { recursive: true, force: true });
      await rename(pendingDirectory, finalDirectory);
      beforeCommit?.();
      const pointer: CurrentPointer = { schemaVersion: 1, generation: validated.manifest.generation, directory, promotedAt: new Date().toISOString() };
      await this.writer.writeJson(this.currentPath, pointer, beforeCommit);
      this.activeSnapshot = validated;
      this.activeCpgManifest = cpgManifest;
      this.activeAdapterState = adapterState;
      this.loadError = undefined;
      this.deletionKnownPresent = true;
      await this.cleanupGenerations(directory);
      await this.checkHealth();
    } catch (cause) {
      await rm(pendingDirectory, { recursive: true, force: true }).catch(() => undefined);
      if (cause instanceof KeystoneError) throw cause;
      throw persistenceError("INTELLIGENCE_GENERATION_PUBLISH_FAILED", "Keystone could not publish the immutable intelligence generation.", cause, "The previous generation remains active. Retry the repository update.");
    }
  }

  async isPersisted(): Promise<boolean> {
    if (!this.currentPath) return false;
    try { await stat(this.currentPath); return true; } catch { return false; }
  }

  dispose(): void {
    this.deletionWatcher?.close();
    this.deletionWatcher = undefined;
    if (this.healthTimer) clearInterval(this.healthTimer);
    this.healthTimer = undefined;
    this.deletionListeners.clear();
    this.healthListeners.clear();
  }

  async checkHealth(): Promise<IntelligencePersistenceHealth> {
    const next = await this.inspectHealth();
    const changed = next.status !== this.health.status || next.message !== this.health.message || next.pendingGenerations !== this.health.pendingGenerations;
    const wasHealthy = this.health.status === "healthy";
    this.health = next;
    this.deletionKnownPresent = next.status === "healthy";
    if (changed) for (const listener of this.healthListeners) listener({ ...next });
    if (wasHealthy && next.status !== "healthy") for (const listener of this.deletionListeners) listener();
    return { ...next };
  }

  private async loadGeneration(directory: string): Promise<IntelligenceSnapshot> {
    if (!this.intelligenceRoot) throw new Error("Intelligence storage is unavailable.");
    const generationRoot = join(this.intelligenceRoot, "generations", directory);
    const [manifest, repository, files, symbols, relationships, evidence, diagnostics, contributions, indexes, adapters] = await Promise.all(SHARDS.map(async (shard) => {
      try { return await this.readJson(join(generationRoot, SHARD_FILES[shard])); }
      catch (cause) { if (OPTIONAL_SEMANTIC_SHARDS.has(shard) && isMissingFile(cause)) return undefined; throw cause; }
    }));
    const snapshot = await validateSnapshotYielding({ manifest, repository, files, symbols, relationships, evidence, diagnostics, ...(contributions ? { contributions } : {}), ...(indexes ? { indexes } : {}) });
    this.activeAdapterState = adapters ? AdapterRegistryStateSchema.parse(adapters) : undefined;
    await this.cpgStore.loadManifest(generationRoot, snapshot.manifest.generation);
    return snapshot;
  }

  private async loadSnapshotOnly(directory: string): Promise<IntelligenceSnapshot> {
    if (!this.intelligenceRoot) throw new Error("Intelligence storage is unavailable.");
    const root = join(this.intelligenceRoot, "generations", directory);
    const [manifest, repository, files, symbols, relationships, evidence, diagnostics, contributions, indexes] = await Promise.all([
      this.readJson(join(root, SHARD_FILES.manifest)), this.readJson(join(root, SHARD_FILES.repository)), this.readJson(join(root, SHARD_FILES.files)),
      this.readJson(join(root, SHARD_FILES.symbols)), this.readJson(join(root, SHARD_FILES.relationships)), this.readJson(join(root, SHARD_FILES.evidence)),
      this.readJson(join(root, SHARD_FILES.diagnostics)), this.readJson(join(root, SHARD_FILES.contributions)).catch((cause: unknown) => { if (isMissingFile(cause)) return undefined; throw cause instanceof Error ? cause : new Error(String(cause)); }),
      this.readJson(join(root, SHARD_FILES.indexes)).catch((cause: unknown) => { if (isMissingFile(cause)) return undefined; throw cause instanceof Error ? cause : new Error(String(cause)); })
    ]);
    return validateSnapshotYielding({ manifest, repository, files, symbols, relationships, evidence, diagnostics, ...(contributions ? { contributions } : {}), ...(indexes ? { indexes } : {}) });
  }

  private async readJson(path: string): Promise<unknown> {
    if (path.endsWith(".gz")) {
      const value = await readFile(path);
      if (this.parser.parseGzipJson) return this.parser.parseGzipJson(value);
      const decompressed = await new Promise<Buffer>((resolve, reject) => gunzipCallback(value, (error, output) => error ? reject(error) : resolve(output)));
      return this.parser.parseJson(decompressed.toString("utf8"));
    }
    return this.parser.parseJson(await readFile(path, "utf8"));
  }

  private async loadLegacySnapshot(): Promise<IntelligenceSnapshot | undefined> {
    if (!this.intelligenceRoot) return undefined;
    try {
      const snapshot = await validateSnapshotYielding(await this.readJson(join(this.intelligenceRoot, "active-snapshot.json")));
      this.activeSnapshot = snapshot;
      this.loadError = undefined;
      return snapshot;
    } catch (cause) {
      if (isMissingFile(cause)) return undefined;
      return undefined;
    }
  }

  private async recoverLatestGeneration(): Promise<IntelligenceSnapshot | undefined> {
    if (!this.intelligenceRoot || !this.currentPath) return undefined;
    const generationsRoot = join(this.intelligenceRoot, "generations");
    let directories: string[];
    try {
      directories = (await readdir(generationsRoot, { withFileTypes: true }))
        .filter((entry) => entry.isDirectory() && /^\d{6,}$/.test(entry.name))
        .map((entry) => entry.name)
        .sort((left, right) => right.localeCompare(left));
    } catch (cause) {
      if (isMissingFile(cause)) return undefined;
      throw cause;
    }
    for (const directory of directories) {
      try {
        const snapshot = await this.loadGeneration(directory);
        await this.writer.writeJson(this.currentPath, { schemaVersion: 1, generation: snapshot.manifest.generation, directory, promotedAt: new Date().toISOString() });
        this.activeSnapshot = snapshot;
        this.deletionKnownPresent = true;
        this.loadError = undefined;
        return snapshot;
      } catch {
        // Try the next complete immutable generation.
      }
    }
    return undefined;
  }

  private async quarantineCurrentPointer(): Promise<void> {
    if (!this.currentPath || !this.intelligenceRoot) return;
    try {
      const recovery = join(this.intelligenceRoot, "recovery");
      await mkdir(recovery, { recursive: true });
      await rename(this.currentPath, join(recovery, `current.${Date.now()}.corrupt.json`));
    } catch {
      // Recovery is best effort; invalid state is never exposed.
    }
  }

  private async cleanupGenerations(active: string): Promise<void> {
    if (!this.intelligenceRoot) return;
    const root = join(this.intelligenceRoot, "generations");
    const directories = (await readdir(root, { withFileTypes: true }))
      .filter((entry) => entry.isDirectory() && /^\d{6,}$/.test(entry.name))
      .map((entry) => entry.name)
      .sort((left, right) => right.localeCompare(left));
    const retained = new Set([active, ...directories.filter((item) => item !== active).slice(0, Math.max(0, this.retainedGenerations - 1))]);
    await Promise.all(directories.filter((item) => !retained.has(item)).map((item) => rm(join(root, item), { recursive: true, force: true })));
  }

  private startDeletionMonitor(): void {
    if (!this.storageRoot || this.deletionWatcher) return;
    this.deletionWatcher = watch(this.storageRoot, { persistent: false }, (_event, filename) => {
      if (filename?.toString() !== "intelligence") return;
      void this.checkDeletion();
    });
    this.deletionWatcher.on("error", () => undefined);
    this.healthTimer = setInterval(() => { void this.checkHealth(); }, 1_000);
    this.healthTimer.unref?.();
  }

  private async checkDeletion(): Promise<void> {
    await this.checkHealth();
  }

  private async finishInitialization(): Promise<void> {
    await this.cleanupPendingGenerations();
    if (this.intelligenceRoot && this.activeSnapshot) {
      const root = join(this.intelligenceRoot, "generations", generationDirectory(this.activeSnapshot.manifest.generation));
      this.activeCpgManifest = await this.cpgStore.loadManifest(root, this.activeSnapshot.manifest.generation);
    }
    await this.checkHealth();
  }

  private async cleanupPendingGenerations(): Promise<void> {
    if (!this.intelligenceRoot) return;
    const generationsRoot = join(this.intelligenceRoot, "generations");
    try {
      const entries = await readdir(generationsRoot, { withFileTypes: true });
      await Promise.all(entries.filter((entry) => entry.isDirectory() && entry.name.endsWith(".pending")).map((entry) => rm(join(generationsRoot, entry.name), { recursive: true, force: true })));
    } catch (cause) {
      if (!isMissingFile(cause)) throw cause;
    }
  }

  private async inspectHealth(): Promise<IntelligencePersistenceHealth> {
    if (!this.currentPath || !this.intelligenceRoot) return { status: "missing", message: "Extension-managed intelligence storage is unavailable.", pendingGenerations: 0 };
    const generationsRoot = join(this.intelligenceRoot, "generations");
    let pendingGenerations = 0;
    try {
      pendingGenerations = (await readdir(generationsRoot, { withFileTypes: true })).filter((entry) => entry.isDirectory() && entry.name.endsWith(".pending")).length;
    } catch (cause) {
      if (!isMissingFile(cause)) return { status: "damaged", message: safeMessage(cause), pendingGenerations };
    }
    let pointer: CurrentPointer;
    try {
      pointer = CurrentPointerSchema.parse(await this.readJson(this.currentPath));
    } catch (cause) {
      return isMissingFile(cause)
        ? { status: "missing", message: "The active intelligence pointer is missing.", pendingGenerations }
        : { status: "damaged", message: "The active intelligence pointer is invalid.", pendingGenerations };
    }
    const generationRoot = join(generationsRoot, pointer.directory);
    if (this.activeSnapshot && pointer.generation !== this.activeSnapshot.manifest.generation) {
      return { status: "damaged", message: "The active intelligence pointer changed outside the generation publisher.", pendingGenerations };
    }
    const observedFingerprints = new Map<string, string>();
    let contentChanged = false;
    for (const shard of SHARDS) {
      const path = join(generationRoot, SHARD_FILES[shard]);
      try {
        const value = await stat(path);
        const fingerprint = `${value.size}:${value.mtimeMs}`;
        observedFingerprints.set(path, fingerprint);
        const previous = this.shardFingerprints.get(path);
        if (previous !== undefined && previous !== fingerprint) contentChanged = true;
      }
      catch {
        if (OPTIONAL_SEMANTIC_SHARDS.has(shard)) continue;
        return { status: "damaged", message: `The active generation is missing ${SHARD_FILES[shard]}.`, pendingGenerations };
      }
    }
    if (this.activeCpgManifest) {
      for (const relative of [join("cpg", "manifest.json"), ...["scope-by-symbol", "calls", "reads", "writes", "data-flow"].map((file) => join("cpg", "indexes", `${file}.json.gz`)), ...this.activeCpgManifest.scopes.map((scope) => scope.shard)]) {
        const path = join(generationRoot, relative);
        try {
          const value = await stat(path); const fingerprint = `${value.size}:${value.mtimeMs}`; observedFingerprints.set(path, fingerprint);
          const previous = this.shardFingerprints.get(path); if (previous !== undefined && previous !== fingerprint) contentChanged = true;
        } catch { return { status: "damaged", message: `The active generation is missing ${relative}.`, pendingGenerations }; }
      }
    }
    if (contentChanged) {
      try { await this.loadGeneration(pointer.directory); }
      catch { return { status: "damaged", message: "An active intelligence shard changed or became corrupt outside the generation publisher.", pendingGenerations }; }
    }
    this.shardFingerprints = observedFingerprints;
    return { status: "healthy", pendingGenerations };
  }

  private async *serialize(value: unknown): AsyncGenerator<string> {
    if (!this.parser.stringifyJson) {
      yield JSON.stringify(value);
      return;
    }
    if (!Array.isArray(value)) {
      yield await this.parser.stringifyJson(value);
      return;
    }
    yield "[";
    for (let index = 0; index < value.length; index += 100) {
      if (index > 0) yield ",";
      const serialized = await this.parser.stringifyJson(value.slice(index, index + 100));
      yield serialized.slice(1, -1);
    }
    yield "]";
  }

  private async *serializeCompressed(value: unknown): AsyncGenerator<Uint8Array> {
    if (!this.parser.gzip) throw persistenceError("INTELLIGENCE_COMPRESSION_UNAVAILABLE", "A background compression worker is required for intelligence shards.", undefined, "Restart Keystone to restore the intelligence worker pool.");
    for await (const chunk of this.serialize(value)) yield await this.parser.gzip(new TextEncoder().encode(chunk));
  }

  private async reusePreviousShard(shard: (typeof SHARDS)[number], pendingPath: string): Promise<void> {
    if (!this.intelligenceRoot || !this.activeSnapshot || !this.parser.sha256) return;
    const previousPath = join(this.intelligenceRoot, "generations", generationDirectory(this.activeSnapshot.manifest.generation), SHARD_FILES[shard]);
    try {
      const [previous, pending] = await Promise.all([readFile(previousPath), readFile(pendingPath)]);
      if (previous.byteLength !== pending.byteLength) return;
      const [previousHash, pendingHash] = await Promise.all([this.parser.sha256(previous), this.parser.sha256(pending)]);
      if (previousHash !== pendingHash) return;
      const reusePath = `${pendingPath}.reuse`;
      await rm(reusePath, { force: true });
      await link(previousPath, reusePath);
      await rename(reusePath, pendingPath);
    } catch {
      await rm(`${pendingPath}.reuse`, { force: true }).catch(() => undefined);
      // Shard reuse is an optimization; a newly written shard remains valid.
    }
  }

  private async writeContributionShards(pendingDirectory: string, snapshot: IntelligenceSnapshot): Promise<void> {
    if (!snapshot.contributions?.length) return;
    const entitiesById = new Map(snapshot.symbols.map((item) => [item.id, item]));
    const relationshipsById = new Map(snapshot.relationships.map((item) => [item.id, item]));
    const evidenceById = new Map(snapshot.evidence.map((item) => [item.id, item]));
    const diagnosticsById = new Map(snapshot.diagnostics.flatMap((item) => item.id ? [[item.id, item] as const] : []));
    const previous = new Map((this.activeSnapshot?.contributions ?? []).map((item) => [item.fileId, item]));
    for (const contribution of snapshot.contributions) {
      const key = partitionKey(contribution.fileId);
      const values = {
        entities: contribution.entityIds.flatMap((id) => { const item = entitiesById.get(id); return item ? [item] : []; }),
        relationships: contribution.relationshipIds.flatMap((id) => { const item = relationshipsById.get(id); return item ? [item] : []; }),
        evidence: contribution.evidenceIds.flatMap((id) => { const item = evidenceById.get(id); return item ? [item] : []; }),
        diagnostics: contribution.diagnosticIds.flatMap((id) => { const item = diagnosticsById.get(id); return item ? [item] : []; })
      };
      const prior = previous.get(contribution.fileId);
      for (const [family, value] of Object.entries(values)) {
        const relative = join(family, `${key}.json.gz`);
        const target = join(pendingDirectory, relative);
        if (prior && sameContribution(prior, contribution) && await this.linkPreviousPartition(relative, target)) continue;
        await this.writer.write(target, this.serializeCompressed(value));
      }
    }
  }

  private async linkPreviousPartition(relative: string, target: string): Promise<boolean> {
    if (!this.intelligenceRoot || !this.activeSnapshot) return false;
    const previous = join(this.intelligenceRoot, "generations", generationDirectory(this.activeSnapshot.manifest.generation), relative);
    try {
      await mkdir(dirname(target), { recursive: true });
      await link(previous, target);
      return true;
    } catch { return false; }
  }
}

async function validateSnapshotYielding(raw: unknown): Promise<IntelligenceSnapshot> {
  if (!raw || typeof raw !== "object") return IntelligenceSnapshotSchema.parse(raw);
  const candidate = raw as Record<string, unknown>;
  const manifest = IntelligenceManifestSchema.parse(candidate.manifest);
  const repository = RepositoryRecordSchema.parse(candidate.repository);
  const files = await parseArray(candidate.files, (value) => FileRecordSchema.parse(value));
  const symbols = await parseArray(candidate.symbols, (value) => SymbolRecordSchema.parse(value));
  const relationships = await parseArray(candidate.relationships, (value) => RelationshipRecordSchema.parse(value));
  const evidence = await parseArray(candidate.evidence, (value) => EvidenceRecordSchema.parse(value));
  const diagnostics = await parseArray(candidate.diagnostics, (value) => IntelligenceDiagnosticSchema.parse(value));
  const contributions = candidate.contributions === undefined ? undefined : await parseArray(candidate.contributions, (value) => FileContributionSchema.parse(value));
  const indexes = candidate.indexes === undefined ? undefined : IntelligenceIndexesSchema.parse(candidate.indexes);
  const evidenceById = new Map(evidence.map((item) => [item.id, item]));
  for (const subject of [repository, ...repository.workspaceRoots, ...files, ...symbols, ...relationships]) {
    for (const evidenceId of subject.evidenceIds) {
      const record = evidenceById.get(evidenceId);
      if (!record) throw new Error(`Missing evidence record ${evidenceId}.`);
      if (record.subjectId !== subject.id) throw new Error(`Evidence record ${evidenceId} does not support ${subject.id}.`);
    }
  }
  const entityIds = new Set([repository.id, ...files.map((item) => item.id), ...symbols.map((item) => item.id)]);
  for (const relationship of relationships) {
    if (!entityIds.has(relationship.sourceId) || !entityIds.has(relationship.targetId)) throw new Error(`Relationship ${relationship.id} has an unresolved endpoint.`);
  }
  return { manifest, repository, files, symbols, relationships, evidence, diagnostics, ...(contributions ? { contributions } : {}), ...(indexes ? { indexes } : {}) };
}

async function parseArray<T>(raw: unknown, parse: (value: unknown) => T): Promise<T[]> {
  if (!Array.isArray(raw)) throw new Error("Intelligence snapshot record collection is not an array.");
  const output: T[] = [];
  for (let index = 0; index < raw.length; index++) {
    output.push(parse(raw[index]));
    if ((index + 1) % 200 === 0) await new Promise<void>((resolve) => setImmediate(resolve));
  }
  return output;
}

function generationDirectory(generation: number): string {
  return generation.toString().padStart(6, "0");
}

function partitionKey(fileId: string): string {
  return fileId.replace(/[^a-zA-Z0-9_-]/g, "_");
}

function sameContribution(left: NonNullable<IntelligenceSnapshot["contributions"]>[number], right: NonNullable<IntelligenceSnapshot["contributions"]>[number]): boolean {
  return left.sourceHash === right.sourceHash
    && left.structuralHash === right.structuralHash
    && left.parserId === right.parserId
    && left.parserVersion === right.parserVersion
    && sameIds(left.entityIds, right.entityIds)
    && sameIds(left.relationshipIds, right.relationshipIds)
    && sameIds(left.evidenceIds, right.evidenceIds)
    && sameIds(left.diagnosticIds, right.diagnosticIds)
    && sameIds(left.dependencyFileIds, right.dependencyFileIds);
}

function sameIds(left: readonly string[], right: readonly string[]): boolean {
  return left.length === right.length && left.every((value, index) => value === right[index]);
}

function persistenceError(code: string, message: string, cause: unknown, recommendedAction: string, retryable = true): KeystoneError {
  return new KeystoneError({
    code,
    category: "PERSISTENCE",
    message,
    ...(cause !== undefined ? { technicalDetails: cause instanceof Error ? cause.message : "Unknown persistence failure.", cause } : {}),
    operation: "intelligence.store",
    recoverable: retryable,
    recommendedAction,
    retryable
  });
}

function isMissingFile(value: unknown): boolean {
  return Boolean(value && typeof value === "object" && "code" in value && value.code === "ENOENT");
}

function safeMessage(value: unknown): string {
  return value instanceof Error ? value.message : String(value);
}
