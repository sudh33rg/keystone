/**
 * Service for persisting and loading execution profiles in Keystone.
 *
 * Execution profiles are stored as a single JSON document under the extension
 * storage root (`.keystone/workflow/execution-profiles.json`). Writes are
 * atomic via AtomicFileWriter and serialized through a Zod schema so that a
 * corrupt or schema-incompatible file is quarantined and replaced with an
 * empty profile set rather than crashing activation.
 */

import { join } from "node:path";
import { readFile, rename } from "node:fs/promises";
import { z } from "zod";
import { AtomicFileWriter } from "./AtomicFileWriter";
import type { ExecutionProfile } from "../execution/executionProfile";
import type { KeystoneLogger } from "../../shared/logging/KeystoneLogger";
import type { VSCodeAPI } from "../../shared/contracts/vscodeApi";

const ExecutionProfileDocumentSchema = z.object({
  schemaVersion: z.literal(1),
  profiles: z.array(
    z.custom<ExecutionProfile>(
      (value) => typeof value === "object" && value !== null && "id" in value,
    ),
  ),
  updatedAt: z.string(),
});

type ExecutionProfileDocument = z.infer<typeof ExecutionProfileDocumentSchema>;

export class ExecutionProfilePersistence {
  private readonly logger: KeystoneLogger;
  private readonly writer: AtomicFileWriter;
  private readonly path?: string;

  constructor(
    logger: KeystoneLogger,
    vscodeAPI?: VSCodeAPI,
    storageRoot?: string,
    writer = new AtomicFileWriter(),
  ) {
    this.logger = logger;
    this.writer = writer;
    this.path = storageRoot ? join(storageRoot, "workflow", "execution-profiles.json") : undefined;
  }

  /**
   * Load all persisted execution profiles.
   *
   * @returns Promise resolving to the list of loaded profiles (empty if none persisted yet)
   */
  async loadProfiles(): Promise<ExecutionProfile[]> {
    if (!this.path) return [];
    try {
      const raw = await readFile(this.path, "utf8");
      const parsed = ExecutionProfileDocumentSchema.safeParse(JSON.parse(raw));
      if (!parsed.success) {
        await rename(this.path, `${this.path}.invalid-${Date.now()}`).catch(() => undefined);
        this.logger.warning(
          "executionProfilePersistence.load",
          "Execution profile document failed validation; starting with an empty set.",
        );
        return [];
      }
      return parsed.data.profiles;
    } catch (error) {
      if (
        error instanceof Error &&
        "code" in error &&
        (error as NodeJS.ErrnoException).code === "ENOENT"
      ) {
        return [];
      }
      this.logger.warning(
        "executionProfilePersistence.load",
        `Could not read execution profiles: ${error instanceof Error ? error.message : String(error)}`,
      );
      return [];
    }
  }

  /**
   * Persist the full set of execution profiles.
   *
   * @param profiles The profiles to persist
   * @returns Promise resolving when the write is complete
   */
  async saveProfiles(profiles: ExecutionProfile[]): Promise<void> {
    if (!this.path) return;
    const document: ExecutionProfileDocument = {
      schemaVersion: 1,
      profiles,
      updatedAt: new Date().toISOString(),
    };
    await this.writer.writeJson(this.path, document);
  }
}
