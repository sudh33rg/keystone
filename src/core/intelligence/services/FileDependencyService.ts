// FileDependencyService.ts
// Provides read‑only file‑level dependency and dependent listings.

import type { IntelligenceSnapshotReader } from "../../persistence/IntelligenceStore";

export interface FileDependency {
  id: string;
  type: string;
  targetId: string;
  targetName: string;
  targetPath: string;
  confidence: number;
  derivation: string;
}

export interface FileDependencyResult {
  generation: number;
  fileId: string;
  filePath: string;
  dependencies: FileDependency[];
  dependents: FileDependency[];
  totalDependencies: number;
  totalDependents: number;
}

export class FileDependencyService {
  constructor(private readonly store: IntelligenceSnapshotReader) {}

  async listFileDependencies(fileId: string, signal?: AbortSignal): Promise<FileDependencyResult> {
    const snapshot = this.store.getSnapshot();
    if (!snapshot) {
      throw new Error("Intelligence snapshot unavailable.");
    }

    const file = snapshot.files.find((f) => f.id === fileId);
    if (!file) {
      throw new Error(`File ${fileId} not found in snapshot.`);
    }

    // Find outgoing relationships (dependencies)
    const dependencies: FileDependency[] = [];
    for (let index = 0; index < snapshot.relationships.length; index++) {
      const rel = snapshot.relationships[index];
      if (!rel) continue;
      if ((index + 1) % 500 === 0) {
        if (signal?.aborted) {
          const error = new Error("Cancelled.");
          error.name = "AbortError";
          throw error;
        }
        await new Promise<void>((resolve) => setImmediate(resolve));
      }
      if (rel.sourceId !== fileId) continue;

      const targetEntity = this.findEntity(snapshot, rel.targetId);
      dependencies.push({
        id: rel.id,
        type: rel.type,
        targetId: rel.targetId,
        targetName: targetEntity?.qualifiedName ?? rel.targetId,
        targetPath: targetEntity?.relativePath ?? "",
        confidence: rel.confidence,
        derivation: rel.derivation,
      });
    }

    // Find incoming relationships (dependents)
    const dependents: FileDependency[] = [];
    for (let index = 0; index < snapshot.relationships.length; index++) {
      const rel = snapshot.relationships[index];
      if (!rel) continue;
      if ((index + 1) % 500 === 0) {
        if (signal?.aborted) {
          const error = new Error("Cancelled.");
          error.name = "AbortError";
          throw error;
        }
        await new Promise<void>((resolve) => setImmediate(resolve));
      }
      if (rel.targetId !== fileId) continue;

      const sourceEntity = this.findEntity(snapshot, rel.sourceId);
      dependents.push({
        id: rel.id,
        type: rel.type,
        targetId: rel.sourceId,
        targetName: sourceEntity?.qualifiedName ?? rel.sourceId,
        targetPath: sourceEntity?.relativePath ?? "",
        confidence: rel.confidence,
        derivation: rel.derivation,
      });
    }

    return {
      generation: snapshot.manifest.generation,
      fileId,
      filePath: file.relativePath,
      dependencies,
      dependents,
      totalDependencies: dependencies.length,
      totalDependents: dependents.length,
    };
  }

  private findEntity(
    snapshot: ReturnType<IntelligenceSnapshotReader["getSnapshot"]>,
    id: string,
  ): { qualifiedName: string; relativePath: string } | undefined {
    if (!snapshot) return undefined;
    const symbol = snapshot.symbols.find((s) => s.id === id);
    if (symbol) {
      const file = snapshot.files.find((f) => f.id === symbol.fileId);
      return {
        qualifiedName: symbol.qualifiedName,
        relativePath: file?.relativePath ?? "",
      };
    }
    const file = snapshot.files.find((f) => f.id === id);
    if (file) {
      return {
        qualifiedName: file.relativePath,
        relativePath: file.relativePath,
      };
    }
    return undefined;
  }
}
