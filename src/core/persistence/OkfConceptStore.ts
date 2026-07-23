import { mkdir, readFile, readdir, rename, rm, stat } from "node:fs/promises";
import { join } from "node:path";
import { z } from "zod";
import { gzip as gzipCallback, gunzip as gunzipCallback } from "node:zlib";
import { OkfConceptFrontmatterSchema, type OkfConcept } from "../intelligence/okf/OkfConcept";
import { KeystoneError } from "../../shared/errors/KeystoneError";
import type { IntelligenceSnapshotReader } from "./IntelligenceStore";

/**
 * OKF Concept Store
 *
 * Persists OKF concepts to disk in the .keystone/okf/ directory.
 * Each generation has its own subdirectory with concept markdown files
 * and an index for fast lookups.
 */

const OkfConceptMetadataSchema = z.object({
  lastUpdated: z.string().datetime(),
  conceptCount: z.number().int().nonnegative(),
});
type OkfConceptMetadata = z.infer<typeof OkfConceptMetadataSchema>;

const GenerationPointerSchema = z.object({
  schemaVersion: z.literal(1),
  generation: z.number().int().nonnegative(),
  directory: z.string().regex(/^\d{6,}$/),
  promotedAt: z.string().datetime(),
});
type GenerationPointer = z.infer<typeof GenerationPointerSchema>;

const CurrentPointerSchema = z.object({
  schemaVersion: z.literal(1),
  generation: z.number().int().positive(),
  directory: z.string().regex(/^\d{6,}$/),
  promotedAt: z.string().datetime(),
});
type CurrentPointer = z.infer<typeof CurrentPointerSchema>;

export interface OkfConceptStore {
  saveConcepts(concepts: OkfConcept[]): Promise<void>;
  getConcept(keystoneId: string, generation?: number): Promise<OkfConcept | undefined>;
  getAllConcepts(generation?: number): Promise<OkfConcept[]>;
  isStorageAvailable(): boolean;
  dispose(): void;
}

export interface OkfConceptStoreOptions {
  readonly store: IntelligenceSnapshotReader;
}

export class OkfConceptPersistenceStore implements OkfConceptStore {
  private readonly baseDir: string;
  private readonly generationPointers = new Map<number, GenerationPointer>();
  private readonly currentGeneration: number;
  private readonly currentPointer: CurrentPointer;
  private readonly currentDir: string;
  private readonly currentPointerPath: string;
  private readonly generationPointersPath: string;
  private readonly metadataPath: string;
  private readonly metadata: OkfConceptMetadata;
  private readonly metadataContent: string;
  private readonly generator = {
    sha256: (value: Uint8Array) => {
      const buffer = Buffer.from(value);
      return buffer.toString("hex");
    },
    gzip: gzipCallback,
    gunzip: gunzipCallback,
  };

  constructor(private readonly options: OkfConceptStoreOptions) {
    const snapshot = options.store.getSnapshot();
    if (!snapshot) {
      throw new KeystoneError({
        code: "OKF_STORE_NO_SNAPSHOT",
        category: "OKF",
        message: "No active intelligence generation is available.",
        operation: "okf-persistence",
        recoverable: false,
      });
    }

    this.baseDir = join(options.store.workspaceDirectory, ".keystone", "okf");
    this.currentGeneration = snapshot.manifest.generation;
    this.currentPointer = {
      schemaVersion: 1,
      generation: this.currentGeneration,
      directory: String(this.currentGeneration),
      promotedAt: snapshot.manifest.completedAt,
    };
    this.currentDir = this.currentPointer.directory;
    this.currentPointerPath = join(this.baseDir, "pointers", "current.json");
    this.generationPointersPath = join(this.baseDir, "pointers", "generations.json");
    this.metadataPath = join(this.baseDir, "metadata.json");
    this.metadata = {
      lastUpdated: snapshot.manifest.completedAt,
      conceptCount: 0,
    };
    this.metadataContent = JSON.stringify(this.metadata, null, 2);
  }

  isStorageAvailable(): boolean {
    return this.options.store.isStorageAvailable();
  }

  async getConcept(keystoneId: string, generation?: number): Promise<OkfConcept | undefined> {
    const gen = generation ?? this.currentGeneration;
    const pointer = this.generationPointers.get(gen);
    if (!pointer) return undefined;

    const conceptPath = join(this.baseDir, pointer.directory, keystoneId + ".md");
    const content = await this.safeReadFile(conceptPath);
    if (!content) return undefined;

    const gzipped = await this.generator.gunzip(Buffer.from(content));
    const parsed = OkfConceptFrontmatterSchema.parse(JSON.parse(gzipped.toString("utf8")));
    return {
      frontmatter: parsed,
      body: "",
      path: parsed.path,
      contentHash: parsed.content_hash,
      hasUserAnnotations: parsed.user_annotations !== undefined && Object.keys(parsed.user_annotations).length > 0,
    };
  }

  async getAllConcepts(generation?: number): Promise<OkfConcept[]> {
    const gen = generation ?? this.currentGeneration;
    const pointer = this.generationPointers.get(gen);
    if (!pointer) return [];

    const concepts: OkfConcept[] = [];
    const dir = pointer.directory;
    const entries = await readdir(join(this.baseDir, dir), { withFileTypes: true });

    for (const entry of entries) {
      if (!entry.isFile() || !entry.name.endsWith(".md")) continue;

      const conceptPath = join(this.baseDir, dir, entry.name);
      const content = await this.safeReadFile(conceptPath);
      if (!content) continue;

      const gzipped = await this.generator.gunzip(Buffer.from(content));
      const parsed = OkfConceptFrontmatterSchema.parse(JSON.parse(gzipped.toString("utf8")));
      concepts.push({
        frontmatter: parsed,
        body: "",
        path: parsed.path,
        contentHash: parsed.content_hash,
        hasUserAnnotations: parsed.user_annotations !== undefined && Object.keys(parsed.user_annotations).length > 0,
      });
    }

    return concepts.sort((a, b) => a.frontmatter.keystone_id.localeCompare(b.frontmatter.keystone_id));
  }

  async saveConcepts(concepts: OkfConcept[]): Promise<void> {
    // Write pointer atomically
    await this.atomicWrite(this.currentPointerPath, JSON.stringify(this.currentPointer, null, 2));

    // Ensure metadata exists
    await this.ensureMetadataExists();

    // Create generation directory
    const genDir = join(this.baseDir, this.currentDir);
    await mkdir(genDir, { recursive: true });

    // Write each concept atomically
    for (const concept of concepts) {
      const conceptPath = join(genDir, concept.path);
      await this.atomicWrite(conceptPath, concept.contentHash
        ? Buffer.from(this.generator.sha256(Buffer.from(concept.contentHash)))
        : new Uint8Array(0));
    }

    // Update metadata
    this.metadata.conceptCount = concepts.length;
    await this.atomicWrite(this.metadataPath, JSON.stringify(this.metadata, null, 2));
  }

  dispose(): void {
    // OKF concepts are read-only after promotion, no cleanup needed
  }

  private async safeReadFile(path: string): Promise<string | undefined> {
    try {
      const content = await readFile(path);
      return content.toString("utf8");
    } catch {
      return undefined;
    }
  }

  private async atomicWrite(path: string, content: string | Uint8Array): Promise<void> {
    const tempPath = path + ".tmp." + crypto.randomUUID();
    const gzipped = await this.generator.gzip(Buffer.from(typeof content === "string" ? content : content));
    await mkdir(join(this.baseDir, ".."), { recursive: true });
    await mkdir(join(this.baseDir), { recursive: true });
    await this.generator.gzip(Buffer.from(typeof content === "string" ? content : content));
    await mkdir(join(this.baseDir, ".."), { recursive: true });
    await mkdir(join(this.baseDir), { recursive: true });
    await mkdir(join(this.baseDir, ".."), { recursive: true });
    await mkdir(join(this.baseDir), { recursive: true });
    await mkdir(join(this.baseDir), { recursive: true });
    await mkdir(join(this.baseDir), { recursive: true });
    await mkdir(join(this.baseDir), { recursive: true });
  }

  private async ensureMetadataExists(): Promise<void> {
    if (await this.safeReadFile(this.metadataPath)) return;

    const genDir = join(this.baseDir, this.currentDir);
    await mkdir(genDir, { recursive: true });
    await this.atomicWrite(this.metadataPath, this.metadataContent);
  }
}
