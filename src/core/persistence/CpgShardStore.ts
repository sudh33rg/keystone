import { link, mkdir, readFile, stat } from "node:fs/promises";
import { dirname, join } from "node:path";
import { gunzip as gunzipCallback, gzip as gzipCallback } from "node:zlib";
import { CpgGenerationManifestSchema, CpgScopeArtifactSchema } from "../../shared/contracts/cpg";
import type { CpgDelta, CpgGenerationManifest, CpgScopeArtifact } from "../../shared/contracts/cpg";
import type { IntelligenceJsonParser } from "./IntelligenceStore";
import type { AtomicFileWriter } from "./AtomicFileWriter";

export class CpgShardStore {
  constructor(private readonly writer: AtomicFileWriter, private readonly worker: IntelligenceJsonParser) {}

  async writeGeneration(pendingGeneration: string, previousGeneration: string | undefined, delta: CpgDelta, beforeCommit?: () => void): Promise<CpgGenerationManifest> {
    const cpgRoot = join(pendingGeneration, "cpg");
    await mkdir(join(cpgRoot, "scopes"), { recursive: true });
    const previousScopes = await this.loadPreviousScopes(previousGeneration);
    let shardBytes = 0;
    let scopesReused = 0;
    const concurrency = 8;
    for (let index = 0; index < delta.scopes.length; index += concurrency) {
      const sizes = await Promise.all(delta.scopes.slice(index, index + concurrency).map(async (artifact) => {
        beforeCommit?.();
        const target = join(pendingGeneration, artifact.descriptor.shard);
        const previousDescriptor = previousScopes.get(artifact.descriptor.id);
        const previous = previousGeneration && previousDescriptor && canReuse(previousDescriptor, artifact.descriptor)
          ? join(previousGeneration, previousDescriptor.shard)
          : undefined;
        let reused = false;
        if (previous) {
          try { await mkdir(dirname(target), { recursive: true }); await link(previous, target); reused = true; } catch { reused = false; }
        }
        if (!reused) await this.writer.write(target, this.serializeCompressed(artifact), beforeCommit);
        if (reused) scopesReused += 1;
        return (await stat(target)).size;
      }));
      shardBytes += sizes.reduce((sum, size) => sum + size, 0);
    }
    const manifest: CpgGenerationManifest = {
      schemaVersion: 1,
      semanticGeneration: delta.semanticGeneration,
      providerVersions: { [delta.providerId]: delta.providerVersion },
      scopes: delta.scopes.map((artifact) => artifact.descriptor).sort((left, right) => left.id.localeCompare(right.id)),
      indexes: buildIndexes(delta),
      metrics: {
        scopesBuilt: delta.scopes.length - scopesReused,
        scopesReused,
        buildTimeMs: delta.buildTimeMs,
        shardBytes,
        analysisFailures: delta.scopes.reduce((count, artifact) => count + artifact.diagnostics.filter((item) => item.severity === "error").length, 0),
        approximateResults: delta.scopes.reduce((count, artifact) => count + artifact.descriptor.summary.approximateFlows, 0),
        staleJobsDiscarded: 0
      }
    };
    CpgGenerationManifestSchema.parse(manifest);
    for (const [name, value] of Object.entries(manifest.indexes)) await this.writer.write(join(cpgRoot, "indexes", `${indexFile(name)}.json.gz`), this.serializeCompressed(value), beforeCommit);
    await this.writer.write(join(cpgRoot, "manifest.json"), this.serialize(manifest), beforeCommit);
    return manifest;
  }

  async loadManifest(generationRoot: string, expectedGeneration: number): Promise<CpgGenerationManifest | undefined> {
    try {
      const parsed = CpgGenerationManifestSchema.parse(await this.parseJson(await readFile(join(generationRoot, "cpg", "manifest.json"), "utf8")));
      if (parsed.semanticGeneration !== expectedGeneration) throw new Error("The CPG manifest targets a different semantic generation.");
      await statInBatches(parsed.scopes.map((descriptor) => join(generationRoot, descriptor.shard)));
      await Promise.all(["scope-by-symbol", "calls", "reads", "writes", "data-flow"].map((file) => stat(join(generationRoot, "cpg", "indexes", `${file}.json.gz`))));
      return parsed;
    } catch (cause) { if (isMissing(cause)) return undefined; throw cause; }
  }

  async readScope(generationRoot: string, descriptor: CpgGenerationManifest["scopes"][number], activeGeneration: number): Promise<CpgScopeArtifact> {
    const raw = await readFile(join(generationRoot, descriptor.shard));
    const artifact = CpgScopeArtifactSchema.parse(await this.parseGzipJson(raw));
    if (artifact.descriptor.id !== descriptor.id || artifact.descriptor.structuralHash !== descriptor.structuralHash) throw new Error("The CPG shard does not match its manifest descriptor.");
    return { ...artifact, descriptor: { ...descriptor, generation: activeGeneration }, nodes: artifact.nodes.map((node) => ({ ...node, generation: activeGeneration })), edges: artifact.edges.map((edge) => ({ ...edge, generation: activeGeneration })) };
  }

  private async *serialize(value: unknown): AsyncGenerator<string> { yield this.worker.stringifyJson ? await this.worker.stringifyJson(value) : JSON.stringify(value); }
  private async *serializeCompressed(value: unknown): AsyncGenerator<Uint8Array> { const serialized = this.worker.stringifyJson ? await this.worker.stringifyJson(value) : JSON.stringify(value); yield this.worker.gzip ? await this.worker.gzip(new TextEncoder().encode(serialized)) : await gzip(new TextEncoder().encode(serialized)); }
  private parseJson(value: string): Promise<unknown> { return this.worker.parseJson(value); }
  private async parseGzipJson(value: Uint8Array): Promise<unknown> { if (this.worker.parseGzipJson) return this.worker.parseGzipJson(value); const output = await gunzip(value); return this.worker.parseJson(new TextDecoder().decode(output)); }

  private async loadPreviousScopes(previousGeneration: string | undefined): Promise<Map<string, CpgGenerationManifest["scopes"][number]>> {
    if (!previousGeneration) return new Map();
    try {
      const manifest = CpgGenerationManifestSchema.parse(await this.parseJson(await readFile(join(previousGeneration, "cpg", "manifest.json"), "utf8")));
      return new Map(manifest.scopes.map((descriptor) => [descriptor.id, descriptor]));
    } catch {
      return new Map();
    }
  }
}

function gzip(value: Uint8Array): Promise<Uint8Array> { return new Promise((resolve, reject) => gzipCallback(value, (error, output) => error ? reject(error) : resolve(output))); }
function gunzip(value: Uint8Array): Promise<Uint8Array> { return new Promise((resolve, reject) => gunzipCallback(value, (error, output) => error ? reject(error) : resolve(output))); }
function isMissing(value: unknown): boolean { return Boolean(value && typeof value === "object" && "code" in value && value.code === "ENOENT"); }
function canReuse(previous: CpgGenerationManifest["scopes"][number], next: CpgGenerationManifest["scopes"][number]): boolean {
  return previous.structuralHash === next.structuralHash
    && previous.providerId === next.providerId
    && previous.providerVersion === next.providerVersion
    && previous.schemaVersion === next.schemaVersion;
}
async function statInBatches(paths: string[], concurrency = 64): Promise<void> { for (let index = 0; index < paths.length; index += concurrency) await Promise.all(paths.slice(index, index + concurrency).map((path) => stat(path))); }
function buildIndexes(delta: CpgDelta): CpgGenerationManifest["indexes"] { const scopeBySymbol: Record<string, string[]> = {}; const calls: Record<string, number> = {}; const reads: Record<string, number> = {}; const writes: Record<string, number> = {}; const dataFlow: Record<string, number> = {}; for (const artifact of delta.scopes) { (scopeBySymbol[artifact.descriptor.semanticSymbolId] ??= []).push(artifact.descriptor.id); calls[artifact.descriptor.id] = artifact.descriptor.summary.calls; reads[artifact.descriptor.id] = artifact.descriptor.summary.reads; writes[artifact.descriptor.id] = artifact.descriptor.summary.writes; dataFlow[artifact.descriptor.id] = artifact.edges.filter((edge) => ["FLOWS_TO", "REACHING_DEFINITION", "ARGUMENT_TO_PARAMETER", "RETURN_TO_CALL"].includes(edge.type)).length; } return { scopeBySymbol, calls, reads, writes, dataFlow }; }
function indexFile(name: string): string { return name === "scopeBySymbol" ? "scope-by-symbol" : name === "dataFlow" ? "data-flow" : name; }
