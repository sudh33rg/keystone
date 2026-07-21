import { readFile, rename } from "node:fs/promises";
import { join } from "node:path";
import {
  CompletionPersistentStateSchema,
  REVIEW_SCHEMA_VERSION,
  type CompletionPersistentState,
} from "../../shared/contracts/review";
import { AtomicFileWriter } from "./AtomicFileWriter";

export class ReviewPersistenceStore {
  private state = emptyState();
  private chain = Promise.resolve();
  private readonly path?: string;

  constructor(
    storageRoot?: string,
    private readonly writer = new AtomicFileWriter(),
  ) {
    this.path = storageRoot ? join(storageRoot, "workflow", "review-state.json") : undefined;
  }

  get snapshot(): CompletionPersistentState {
    return structuredClone(this.state);
  }

  async initialize(): Promise<CompletionPersistentState> {
    if (!this.path) return this.snapshot;
    try {
      this.state = CompletionPersistentStateSchema.parse(
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
    mutate: (state: CompletionPersistentState) => CompletionPersistentState,
  ): Promise<CompletionPersistentState> {
    let output: CompletionPersistentState | undefined;
    this.chain = this.chain
      .catch(() => undefined)
      .then(async () => {
        const next = CompletionPersistentStateSchema.parse({
          ...mutate(this.snapshot),
          revision: this.state.revision + 1,
          updatedAt: new Date().toISOString(),
        });
        await this.persist(next);
        this.state = next;
        output = this.snapshot;
      });
    await this.chain;
    return output!;
  }

  private persist(value: CompletionPersistentState): Promise<void> {
    return this.path ? this.writer.writeJson(this.path, value) : Promise.resolve();
  }
}

function emptyState(): CompletionPersistentState {
  return {
    schemaVersion: REVIEW_SCHEMA_VERSION,
    revision: 0,
    notes: [],
    dispositions: [],
    decisions: [],
    completions: [],
    archivedWorkflowIds: [],
    updatedAt: new Date().toISOString(),
  };
}
