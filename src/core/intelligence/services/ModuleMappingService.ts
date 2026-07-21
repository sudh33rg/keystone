// ModuleMappingService.ts
// Provides module‑to‑module dependency mapping and cross‑module relationship analysis.

import type { IntelligenceSnapshotReader } from "../../persistence/IntelligenceStore";
import type { IntelligenceFileRecord } from "../../../shared/contracts/intelligence";

export interface ModuleDependency {
  moduleId: string;
  moduleName: string;
  dependencyModuleId: string;
  dependencyModuleName: string;
  relationshipCount: number;
  relationshipTypes: string[];
}

export interface ModuleMappingResult {
  generation: number;
  modules: ModuleInfo[];
  dependencies: ModuleDependency[];
  totalModules: number;
  totalDependencies: number;
}

export interface ModuleInfo {
  moduleId: string;
  moduleName: string;
  fileCount: number;
  symbolCount: number;
  outgoingRelationships: number;
  incomingRelationships: number;
}

export class ModuleMappingService {
  constructor(private readonly store: IntelligenceSnapshotReader) {}

  async mapModules(signal?: AbortSignal): Promise<ModuleMappingResult> {
    const snapshot = this.store.getSnapshot();
    if (!snapshot) {
      throw new Error("Intelligence snapshot unavailable.");
    }

    // Build module → files map
    const moduleFiles = new Map<string, IntelligenceFileRecord[]>();
    for (const file of snapshot.files) {
      if (!file.moduleId) continue;
      const list = moduleFiles.get(file.moduleId) ?? [];
      list.push(file);
      moduleFiles.set(file.moduleId, list);
    }

    // Build module info
    const modules: ModuleInfo[] = [];
    for (const [moduleId, files] of moduleFiles) {
      const moduleName = moduleId.split(":").pop() ?? moduleId;
      const fileIds = new Set(files.map((f) => f.id));
      const symbols = snapshot.symbols.filter((s) => fileIds.has(s.fileId));
      const outgoing = snapshot.relationships.filter(
        (r) => fileIds.has(r.sourceId) && !fileIds.has(r.targetId),
      ).length;
      const incoming = snapshot.relationships.filter(
        (r) => fileIds.has(r.targetId) && !fileIds.has(r.sourceId),
      ).length;

      modules.push({
        moduleId,
        moduleName,
        fileCount: files.length,
        symbolCount: symbols.length,
        outgoingRelationships: outgoing,
        incomingRelationships: incoming,
      });
    }

    modules.sort((a, b) => a.moduleName.localeCompare(b.moduleName));

    // Build module-to-module dependency map
    const depMap = new Map<string, Map<string, ModuleDependency>>();

    for (let index = 0; index < snapshot.relationships.length; index++) {
      const rel = snapshot.relationships[index];
      if (!rel) continue;
      if ((index + 1) % 1000 === 0) {
        if (signal?.aborted) {
          const error = new Error("Cancelled.");
          error.name = "AbortError";
          throw error;
        }
        await new Promise<void>((resolve) => setImmediate(resolve));
      }
      const sourceFile = snapshot.files.find((f) => f.id === rel.sourceId);
      const targetFile = snapshot.files.find((f) => f.id === rel.targetId);
      if (!sourceFile?.moduleId || !targetFile?.moduleId) continue;
      if (sourceFile.moduleId === targetFile.moduleId) continue;

      const sourceDeps = depMap.get(sourceFile.moduleId) ?? new Map<string, ModuleDependency>();
      const existing = sourceDeps.get(targetFile.moduleId);
      if (existing) {
        existing.relationshipCount++;
        if (!existing.relationshipTypes.includes(rel.type)) {
          existing.relationshipTypes.push(rel.type);
        }
      } else {
        sourceDeps.set(targetFile.moduleId, {
          moduleId: sourceFile.moduleId,
          moduleName: sourceFile.moduleId.split(":").pop() ?? sourceFile.moduleId,
          dependencyModuleId: targetFile.moduleId,
          dependencyModuleName: targetFile.moduleId.split(":").pop() ?? targetFile.moduleId,
          relationshipCount: 1,
          relationshipTypes: [rel.type],
        });
      }
      depMap.set(sourceFile.moduleId, sourceDeps);
    }

    const dependencies: ModuleDependency[] = [];
    for (const moduleDeps of depMap.values()) {
      dependencies.push(...moduleDeps.values());
    }
    dependencies.sort(
      (a, b) =>
        a.moduleName.localeCompare(b.moduleName) ||
        a.dependencyModuleName.localeCompare(b.dependencyModuleName),
    );

    return {
      generation: snapshot.manifest.generation,
      modules,
      dependencies,
      totalModules: modules.length,
      totalDependencies: dependencies.length,
    };
  }

  async getModuleDependencies(moduleId: string, signal?: AbortSignal): Promise<ModuleDependency[]> {
    const result = await this.mapModules(signal);
    return result.dependencies.filter((d) => d.moduleId === moduleId);
  }

  async getModuleInfo(moduleId: string, signal?: AbortSignal): Promise<ModuleInfo | undefined> {
    const result = await this.mapModules(signal);
    return result.modules.find((m) => m.moduleId === moduleId);
  }
}
