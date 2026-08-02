import { createHash } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { gzip, gunzip } from "node:zlib";
import { promisify } from "node:util";
import type { CodePropertyGraph } from "./types";

const gzipAsync = promisify(gzip);
const gunzipAsync = promisify(gunzip);

export interface CpgShardManifestEntry {
  readonly sourcePath: string;
  readonly shard: string;
  readonly contentHash: string;
  readonly nodeCount: number;
  readonly edgeCount: number;
  readonly capabilities: CodePropertyGraph["capabilities"];
}

export interface CpgShardManifest {
  readonly version: 1;
  readonly generatedAt: string;
  readonly files: Readonly<Record<string, CpgShardManifestEntry>>;
}

export class CpgShardStore {
  private readonly root: string;
  private readonly current = new Map<string, CpgShardManifestEntry>();
  private reused = 0;
  private written = 0;
  private priorManifest?: CpgShardManifest;
  private priorLoaded = false;

  constructor(workspaceRoot: string) {
    this.root = path.join(workspaceRoot, ".keystone", "intelligence", "cpg");
  }

  async put(graph: CodePropertyGraph): Promise<void> {
    const previous = await this.previousManifest();
    const existing = previous?.files[graph.sourcePath];
    if (
      existing?.contentHash === graph.contentHash &&
      (await exists(path.join(this.root, existing.shard)))
    ) {
      this.current.set(graph.sourcePath, existing);
      this.reused += 1;
      return;
    }
    const shard = `${createHash("sha256").update(graph.sourcePath).digest("hex").slice(0, 24)}.json.gz`;
    const target = path.join(this.root, shard);
    const temporary = `${target}.tmp`;
    await fs.mkdir(this.root, { recursive: true });
    await fs.writeFile(temporary, await gzipAsync(Buffer.from(JSON.stringify(graph))));
    await fs.rename(temporary, target);
    this.current.set(graph.sourcePath, {
      sourcePath: graph.sourcePath,
      shard,
      contentHash: graph.contentHash,
      nodeCount: graph.nodes.length,
      edgeCount: graph.edges.length,
      capabilities: graph.capabilities
    });
    this.written += 1;
  }

  async finalize(): Promise<{
    manifest: CpgShardManifest;
    reused: number;
    written: number;
    deleted: number;
  }> {
    const previous = await this.previousManifest();
    let deleted = 0;
    for (const [sourcePath, entry] of Object.entries(previous?.files ?? {})) {
      if (!this.current.has(sourcePath)) {
        await fs.rm(path.join(this.root, entry.shard), { force: true });
        deleted += 1;
      }
    }
    const manifest: CpgShardManifest = {
      version: 1,
      generatedAt: new Date().toISOString(),
      files: Object.fromEntries([...this.current.entries()].sort(([a], [b]) => a.localeCompare(b)))
    };
    await fs.mkdir(this.root, { recursive: true });
    const target = path.join(this.root, "manifest.json");
    const temporary = `${target}.tmp`;
    await fs.writeFile(temporary, `${JSON.stringify(manifest, null, 2)}\n`, "utf8");
    await fs.rename(temporary, target);
    return { manifest, reused: this.reused, written: this.written, deleted };
  }

  async get(sourcePath: string): Promise<CodePropertyGraph | undefined> {
    const entry = (await this.manifest())?.files[sourcePath];
    if (!entry) return undefined;
    try {
      return JSON.parse(
        (await gunzipAsync(await fs.readFile(path.join(this.root, entry.shard)))).toString("utf8")
      ) as CodePropertyGraph;
    } catch {
      return undefined;
    }
  }

  async manifest(): Promise<CpgShardManifest | undefined> {
    try {
      return JSON.parse(
        await fs.readFile(path.join(this.root, "manifest.json"), "utf8")
      ) as CpgShardManifest;
    } catch {
      return undefined;
    }
  }

  private async previousManifest(): Promise<CpgShardManifest | undefined> {
    if (!this.priorLoaded) {
      this.priorManifest = await this.manifest();
      this.priorLoaded = true;
    }
    return this.priorManifest;
  }
}

async function exists(file: string): Promise<boolean> {
  try {
    await fs.access(file);
    return true;
  } catch {
    return false;
  }
}
