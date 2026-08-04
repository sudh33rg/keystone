import { mkdir, readFile, rename } from "node:fs/promises";
import { join } from "node:path";
import { AtomicFileWriter } from "./AtomicFileWriter";
import { z } from "zod";
import { OkfConceptFrontmatterSchema, OkfConceptBodySchema } from "../intelligence/okf/OkfConcept";

/**
 * OKF Persistence Store
 *
 * Persists OKF concepts as markdown files under .keystone/okf/
 * with recovery from previous generations.
 */
export interface OkfConceptRecord {
  frontmatter: OkfConceptFrontmatter;
  body: OkfConceptBody;
  path: string;
  contentHash: string;
  hasUserAnnotations: boolean;
}

export interface OkfConceptFrontmatter {
  type: string;
  title: string;
  keystone_id: string;
  repository_id: string;
  branch: string;
  head_commit?: string;
  generation: number;
  language?: string;
  qualified_name?: string;
  module?: string;
  visibility?: string;
  source?: {
    path: string;
    start_line: number;
    end_line: number;
  };
  derivation: string;
  confidence: number;
  content_hash?: string;
  parser_id?: string;
  parser_version?: string;
  tags?: string[];
  user_annotations?: Record<string, string>;
}

export interface OkfConceptBody {
  signature?: string;
  declaration?: string;
  belongs_to?: Array<{
    type: string;
    id: string;
    title: string;
    path: string;
  }>;
  calls?: Array<{
    id: string;
    title: string;
    path: string;
    confidence: number;
    derivation: string;
    evidence: string;
  }>;
  called_by?: Array<{
    id: string;
    title: string;
    path: string;
    confidence: number;
    derivation: string;
    evidence: string;
  }>;
  imports?: Array<{
    id: string;
    title: string;
    path: string;
    kind: string;
    confidence: number;
    derivation: string;
    evidence: string;
  }>;
  exports?: Array<{
    id: string;
    title: string;
    path: string;
    kind: string;
    confidence: number;
    derivation: string;
    evidence: string;
  }>;
  references?: Array<{
    id: string;
    title: string;
    path: string;
    kind: string;
    confidence: number;
    derivation: string;
    evidence: string;
  }>;
  reads?: Array<{
    id: string;
    title: string;
    path: string;
    kind: string;
    confidence: number;
    derivation: string;
    evidence: string;
  }>;
  writes?: Array<{
    id: string;
    title: string;
    path: string;
    kind: string;
    confidence: number;
    derivation: string;
    evidence: string;
  }>;
  routes?: Array<{
    method?: string;
    route_path: string;
    id: string;
    title: string;
    path: string;
    confidence: number;
    derivation: string;
    evidence: string;
  }>;
  middleware?: Array<{
    id: string;
    title: string;
    path: string;
    position: number;
    confidence: number;
    derivation: string;
    evidence: string;
  }>;
  tests?: Array<{
    id: string;
    title: string;
    path: string;
    kind: string;
    coverage: number;
    confidence: number;
    derivation: string;
    evidence: string;
  }>;
  covered_by?: Array<{
    id: string;
    title: string;
    path: string;
    coverage: number;
    confidence: number;
    derivation: string;
    evidence: string;
  }>;
  configuration?: Array<{
    id: string;
    title: string;
    path: string;
    kind: string;
    confidence: number;
    derivation: string;
    evidence: string;
  }>;
  changes?: Array<{
    kind: string;
    branch: string;
    commit: string;
    generation: number;
    confidence: number;
    derivation: string;
  }>;
  evidence?: Array<{
    source_kind: string;
    path: string;
    start_line: number;
    end_line: number;
    parser_id: string;
    parser_version: string;
    derivation: string;
    content_hash: string;
    branch: string;
    commit: string;
    generation: number;
    confidence: number;
    statement: string;
  }>;
  limitations?: Array<{
    kind: string;
    message: string;
    confidence: number;
    derivation: string;
    evidence: string;
  }>;
  backlinks?: Array<{
    id: string;
    title: string;
    path: string;
    kind: string;
    confidence: number;
    derivation: string;
    evidence: string;
  }>;
  user_annotation?: Record<string, string>;
}

export interface OkfPersistenceHealth {
  status: "healthy" | "missing" | "damaged";
  message?: string;
  pendingGenerations: number;
}

export interface OkfPersistenceState {
  version: number;
  generation: number;
  concepts: OkfConceptRecord[];
  revision: number;
  updatedAt: string;
}

const OKF_SCHEMA_VERSION = 1;
const OKF_STORE_PATH = ".keystone/okf";

export class OkfPersistenceStore {
  private state = emptyState();
  private writeChain = Promise.resolve();
  private readonly path?: string;
  private readonly writer = new AtomicFileWriter();

  constructor(storageRoot?: string) {
    this.path = storageRoot ? join(storageRoot, OKF_STORE_PATH) : undefined;
  }

  get snapshot(): OkfPersistenceState {
    return structuredClone(this.state);
  }

  async initialize(): Promise<OkfPersistenceState> {
    if (!this.path) return this.snapshot;
    try {
      this.state = OkfPersistenceStateSchema.parse(
        JSON.parse(await readFile(this.path, "utf8")),
      );
    } catch (cause) {
      if (!(cause instanceof Error && "code" in cause && cause.code === "ENOENT")) {
        await rename(this.path, `${this.path}.invalid-${Date.now()}`);
      }
      await this.persist(this.state);
    }
    return this.snapshot;
  }

  async update(
    mutator: (current: OkfPersistenceState) => OkfPersistenceState,
  ): Promise<OkfPersistenceState> {
    let result: OkfPersistenceState | undefined;
    this.writeChain = this.writeChain
      .catch(() => undefined)
      .then(async () => {
        const next = OkfPersistenceStateSchema.parse({
          ...mutator(this.snapshot),
          revision: this.state.revision + 1,
          updatedAt: new Date().toISOString(),
        });
        await this.persist(next);
        this.state = next;
        result = this.snapshot;
      });
    await this.writeChain;
    return result!;
  }

  async addConcept(concept: OkfConceptRecord): Promise<void> {
    await this.update((state) => {
      const existingIndex = state.concepts.findIndex(
        (c) => c.path === concept.path && c.frontmatter.generation === concept.frontmatter.generation,
      );
      if (existingIndex >= 0) {
        state.concepts[existingIndex] = concept;
      } else {
        state.concepts.push(concept);
      }
      return state;
    });
  }

  async removeConcept(path: string): Promise<void> {
    await this.update((state) => {
      const index = state.concepts.findIndex((c) => c.path === path);
      if (index >= 0) state.concepts.splice(index, 1);
      return state;
    });
  }

  async persist(state: OkfPersistenceState): Promise<void> {
    if (!this.path) return;
    await mkdir(this.path, { recursive: true });
    await this.writer.writeJson(this.path, state);
  }

  async getConcepts(): Promise<OkfConceptRecord[]> {
    return this.snapshot.concepts;
  }

  async getConcept(path: string): Promise<OkfConceptRecord | undefined> {
    return this.snapshot.concepts.find((c) => c.path === path);
  }

  async deleteOldGenerations(maxGenerations: number): Promise<void> {
    await this.update((state) => {
      const cutoff = state.generation - maxGenerations;
      return {
        ...state,
        concepts: state.concepts.filter((c) => c.frontmatter.generation >= cutoff),
      };
    });
  }

  async dispose(): Promise<void> {
    await this.writeChain;
  }
}

function emptyState(): OkfPersistenceState {
  return {
    version: OKF_SCHEMA_VERSION,
    generation: 0,
    revision: 0,
    concepts: [],
    updatedAt: new Date().toISOString(),
  };
}

const OkfPersistenceStateSchema = z.object({
  version: z.number(),
  generation: z.number(),
  revision: z.number(),
  concepts: z.array(
    z.object({
      frontmatter: OkfConceptFrontmatterSchema,
      body: OkfConceptBodySchema,
      path: z.string(),
      contentHash: z.string(),
      hasUserAnnotations: z.boolean(),
    }),
  ),
  updatedAt: z.string(),
});
