import fs from "node:fs/promises";
import { createReadStream } from "node:fs";
import path from "node:path";
import { createInterface } from "node:readline";
import type { KeystoneOkfManifest, KeystoneOkfSnapshot, OkfEvidence } from "./types";
import { serializeOkfSnapshot } from "./serialization";
import {
  projectCpgBindings,
  projectOkfGraph,
  projectOkfSearch,
  type OkfCpgBinding,
  type OkfGraphProjection
} from "./projections";
import { writePortableOkfBundle } from "./bundle";

export interface OkfSnapshotSummaryProjection {
  readonly manifest: KeystoneOkfManifest;
  readonly cpgBindings: number;
  readonly evidenceSamples: readonly OkfEvidence[];
}
export interface OkfSnapshotWriteOptions {
  readonly onProgress?: (message: string) => void;
}
async function readJsonLines<T>(file: string): Promise<T[]> {
  try {
    return (await fs.readFile(file, "utf8"))
      .split(/\r?\n/)
      .filter(Boolean)
      .map((line) => JSON.parse(line) as T);
  } catch {
    return [];
  }
}

async function readJsonLinesHead<T>(file: string, limit: number): Promise<T[]> {
  if (limit <= 0) return [];
  const values: T[] = [];
  const stream = createReadStream(file, { encoding: "utf8" });
  const lines = createInterface({ input: stream, crlfDelay: Infinity });
  try {
    for await (const line of lines) {
      if (!line.trim()) continue;
      values.push(JSON.parse(line) as T);
      if (values.length >= limit) {
        lines.close();
        stream.destroy();
        break;
      }
    }
  } finally {
    lines.close();
    stream.destroy();
  }
  return values;
}
export class OkfSnapshotStore {
  constructor(private readonly workspaceRoot: string) {}
  get intelligenceRoot(): string {
    return path.join(this.workspaceRoot, ".keystone", "intelligence");
  }
  get root(): string {
    return path.join(this.intelligenceRoot, "okf");
  }
  async read(): Promise<KeystoneOkfSnapshot | undefined> {
    try {
      const [manifest, units, relationships, observations, evidence] = await Promise.all([
        JSON.parse(await fs.readFile(path.join(this.root, "manifest.json"), "utf8")),
        readJsonLines(path.join(this.root, "knowledge/units.jsonl")),
        readJsonLines(path.join(this.root, "knowledge/relationships.jsonl")),
        readJsonLines(path.join(this.root, "knowledge/observations.jsonl")),
        readJsonLines(path.join(this.root, "knowledge/evidence.jsonl"))
      ]);
      return { manifest, units, relationships, observations, evidence } as KeystoneOkfSnapshot;
    } catch {
      return undefined;
    }
  }
  async readCpgBindings(): Promise<OkfCpgBinding[]> {
    return readJsonLines<OkfCpgBinding>(path.join(this.root, "projections/cpg-bindings.jsonl"));
  }
  async readGraphProjection(): Promise<OkfGraphProjection | undefined> {
    try {
      return JSON.parse(
        await fs.readFile(path.join(this.root, "projections/graph.json"), "utf8")
      ) as OkfGraphProjection;
    } catch {
      return undefined;
    }
  }
  async readSummaryProjection(
    evidenceLimit = 20
  ): Promise<OkfSnapshotSummaryProjection | undefined> {
    try {
      const [manifest, bindings, evidenceSamples] = await Promise.all([
        JSON.parse(
          await fs.readFile(path.join(this.root, "manifest.json"), "utf8")
        ) as KeystoneOkfManifest,
        this.readCpgBindings(),
        readJsonLinesHead<OkfEvidence>(
          path.join(this.root, "knowledge/evidence.jsonl"),
          evidenceLimit
        )
      ]);
      return { manifest, cpgBindings: bindings.length, evidenceSamples };
    } catch {
      return undefined;
    }
  }
  async write(snapshot: KeystoneOkfSnapshot, options: OkfSnapshotWriteOptions = {}): Promise<void> {
    options.onProgress?.("Serializing the validated OKF snapshot...");
    const files = serializeOkfSnapshot(snapshot);
    const candidate = `${this.root}.candidate-${snapshot.manifest.extractionRunId}`;
    await fs.rm(candidate, { recursive: true, force: true });
    for (const [relative, content] of Object.entries(files)) {
      const target = path.join(candidate, relative);
      await fs.mkdir(path.dirname(target), { recursive: true });
      await fs.writeFile(target, content, "utf8");
    }
    options.onProgress?.("Writing OKF graph, search, and CPG projections...");
    const graph = projectOkfGraph(snapshot),
      search = projectOkfSearch(snapshot),
      bindings = projectCpgBindings(snapshot);
    await fs.mkdir(path.join(candidate, "projections"), { recursive: true });
    await fs.writeFile(
      path.join(candidate, "projections", "graph.json"),
      `${JSON.stringify(graph)}\n`
    );
    await fs.writeFile(
      path.join(candidate, "projections", "search.jsonl"),
      search.map((v) => JSON.stringify(v)).join("\n") + "\n"
    );
    await fs.writeFile(
      path.join(candidate, "projections", "cpg-bindings.jsonl"),
      bindings.map((v) => JSON.stringify(v)).join("\n") + "\n"
    );
    const snapshots = path.join(this.intelligenceRoot, "snapshots");
    await fs.mkdir(snapshots, { recursive: true });
    const archive = path.join(snapshots, snapshot.manifest.extractionRunId);
    await fs.rm(archive, { recursive: true, force: true });
    await copyDirectory(candidate, archive);
    const previous = `${this.root}.previous`;
    await fs.rm(previous, { recursive: true, force: true });
    try {
      await fs.rename(this.root, previous);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    }
    await fs.rename(candidate, this.root);
    await fs.writeFile(
      path.join(this.intelligenceRoot, "current.json"),
      `${JSON.stringify({ extractionRunId: snapshot.manifest.extractionRunId, path: "okf", promotedAt: new Date().toISOString() }, null, 2)}\n`
    );
    await fs.rm(previous, { recursive: true, force: true });
    // Remove the obsolete parallel cognition store. OKF is the only authoritative knowledge store.
    await fs.rm(path.join(this.workspaceRoot, ".keystone", "knowledge"), {
      recursive: true,
      force: true
    });
    options.onProgress?.("Generating the portable Markdown OKF bundle...");
    await writePortableOkfBundle(
      this.workspaceRoot,
      snapshot,
      path.join(this.intelligenceRoot, "okf-bundle"),
      { onProgress: options.onProgress }
    );
    options.onProgress?.("OKF snapshot promotion complete.");
  }
}
async function copyDirectory(source: string, target: string): Promise<void> {
  await fs.mkdir(target, { recursive: true });
  for (const entry of await fs.readdir(source, { withFileTypes: true })) {
    const from = path.join(source, entry.name),
      to = path.join(target, entry.name);
    if (entry.isDirectory()) await copyDirectory(from, to);
    else await fs.copyFile(from, to);
  }
}
