import type { IntelligenceSnapshotReader } from "../../persistence/IntelligenceStore";
import type {
  IntelligenceFileRecord,
} from "../../../shared/contracts/intelligence";

export interface ArchitecturalHotspot {
  readonly id: string;
  readonly hotspotScore: number;
  readonly bridgeCount: number;
  readonly hubScore: number;
}

export interface ArchitecturalHotspotResult {
  readonly generation: number;
  readonly hotspots: ArchitecturalHotspot[];
  readonly totalHotspots: number;
  readonly averageHotspotScore: number;
  readonly maxHotspotScore: number;
}

export class ArchitecturalHotspotService {
  constructor(private readonly store: IntelligenceSnapshotReader) {}

  async compute(signal?: AbortSignal): Promise<ArchitecturalHotspotResult> {
    const snapshot = this.store.getSnapshot();
    if (!snapshot) {
      throw new Error("Intelligence snapshot unavailable.");
    }

    const relationships = snapshot.relationships;
    const typeCount = new Map<string, number>();
    const outDegree = new Map<string, number>();

    for (let index = 0; index < relationships.length; index++) {
      const rel = relationships[index]!;
      if ((index + 1) % 1000 === 0 && signal?.aborted) {
        const error = new Error("Cancelled.");
        error.name = "AbortError";
        throw error;
      }

      typeCount.set(rel.type, (typeCount.get(rel.type) ?? 0) + 1);
      typeCount.set(rel.targetId, (typeCount.get(rel.targetId) ?? 0) + 1);
      outDegree.set(rel.sourceId, (outDegree.get(rel.sourceId) ?? 0) + 1);
    }

    const hotspotScores = new Map<string, number>();
    for (const rel of relationships) {
      hotspotScores.set(
        rel.sourceId,
        (hotspotScores.get(rel.sourceId) ?? 0) + (typeCount.get(rel.type) ?? 0),
      );
      hotspotScores.set(
        rel.targetId,
        (hotspotScores.get(rel.targetId) ?? 0) + (typeCount.get(rel.type) ?? 0),
      );
    }

    const maxOutDegree = Math.max(...outDegree.values(), 0);
    const maxHotspotScore = Math.max(...hotspotScores.values(), 0);

    const fileById = new Map<string, IntelligenceFileRecord>();
    for (const file of snapshot.files) {
      fileById.set(file.id, file);
    }

    const allEntities: Array<{
      id: string;
      name: string;
      qualifiedName: string;
      relativePath: string;
    }> = [
      ...snapshot.symbols.map((symbol) => ({
        id: symbol.id,
        name: symbol.name,
        qualifiedName: symbol.qualifiedName,
        relativePath: fileById.get(symbol.fileId)?.relativePath ?? "",
      })),
      ...snapshot.files.map((file) => ({
        id: file.id,
        name: file.relativePath.split("/").at(-1) ?? file.relativePath,
        qualifiedName: file.relativePath,
        relativePath: file.relativePath,
      })),
    ];

    const hotspots = allEntities
      .map(({ id, name, qualifiedName, relativePath }) => {
        const normalizedHubScore = maxOutDegree > 0 ? (outDegree.get(id) ?? 0) / maxOutDegree : 0;
        const normalizedHotspotScore =
          maxHotspotScore > 0 ? (hotspotScores.get(id) ?? 0) / maxHotspotScore : 0;
        const hotspotScore = normalizedHubScore * 0.4 + normalizedHotspotScore * 0.6;

        return {
          id,
          name,
          qualifiedName,
          relativePath,
          hotspotScore,
          bridgeCount: typeCount.get(id) ?? 0,
          hubScore: normalizedHubScore,
        } as ArchitecturalHotspot;
      })
      .filter((item) => item.hotspotScore > 0 || item.bridgeCount > 0)
      .sort((a, b) => b.hotspotScore - a.hotspotScore || b.bridgeCount - a.bridgeCount);

    const totalHotspots = hotspots.length;
    const averageHotspotScore =
      totalHotspots > 0
        ? hotspots.reduce((sum, item) => sum + item.hotspotScore, 0) / totalHotspots
        : 0;
    const maxScore = totalHotspots > 0 ? hotspots[0]!.hotspotScore : 0;

    return {
      generation: snapshot.manifest.generation,
      hotspots,
      totalHotspots,
      averageHotspotScore,
      maxHotspotScore: maxScore,
    };
  }
}
