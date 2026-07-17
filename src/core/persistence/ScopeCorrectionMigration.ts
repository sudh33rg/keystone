import { rename } from "node:fs/promises";
import { join } from "node:path";

export interface ScopeCorrectionMigrationResult {
  archived: string[];
  diagnostics: string[];
}

/** Archives obsolete development-only roadmap state without touching workflow or Intelligence data. */
export class ScopeCorrectionMigration {
  constructor(private readonly globalStorageRoot?: string) {}

  async run(): Promise<ScopeCorrectionMigrationResult> {
    if (!this.globalStorageRoot) return { archived: [], diagnostics: ["Global file storage is unavailable; no obsolete roadmap state was inspected."] };
    const archived: string[] = []; const diagnostics: string[] = [];
    for (const directory of ["hub", "local-models"]) {
      const source = join(this.globalStorageRoot, directory); const target = join(this.globalStorageRoot, `retired-roadmap-${directory}-${Date.now()}`);
      try { await rename(source, target); archived.push(directory); }
      catch (cause) { if (cause instanceof Error && "code" in cause && cause.code === "ENOENT") continue; diagnostics.push(`Could not archive obsolete ${directory} state: ${cause instanceof Error ? cause.message : String(cause)}`.slice(0, 2_000)); }
    }
    return { archived, diagnostics };
  }
}
