/**
 * GraphSliceService — produces grouped, bounded slices of the intelligence
 * graph for the canvas (spec §6, §7, §22).
 *
 * - Groups architecture nodes by package/module/directory so the first view
 *   never shows every file and symbol.
 * - Expands a single group (drill-in) on demand.
 * - Caps members per group and emits truncation warnings.
 */
import type {
  IntelligenceSnapshot,
  IntelligenceSymbolRecord,
  IntelligenceFileRecord,
} from "../../../shared/contracts/intelligence";
import type {
  IntelligenceVisualGroup,
  IntelligenceGroupingBasis,
} from "../../../shared/contracts/visualization";
import { DEFAULT_PERFORMANCE } from "./VisualizationDefaults";
import { nodeIdForEntity } from "./mapping";

export interface GroupSpec {
  id: string;
  label: string;
  kind: IntelligenceVisualGroup["kind"];
  basis: IntelligenceGroupingBasis;
  memberEntityIds: string[];
  description?: string;
}

export class GraphSliceService {
  /** Group files/symbols by package then module (declared via manifest fields). */
  static buildArchitectureGroups(
    snapshot: IntelligenceSnapshot,
    maxMembersPerGroup = DEFAULT_PERFORMANCE.initialArchitectureNodes,
  ): GroupSpec[] {
    const groups = new Map<string, GroupSpec>();
    const pkgName = new Map<string, string>();
    for (const file of snapshot.files) {
      const key = `pkg:${file.packageId ?? "unknown"}|mod:${file.moduleId ?? "unknown"}`;
      if (!groups.has(key)) {
        groups.set(key, {
          id: `g:${key}`,
          label: `${file.packageId ?? "unknown"} / ${file.moduleId ?? "unknown"}`,
          kind: "module",
          basis: "declared",
          memberEntityIds: [],
          description: "Group derived from package + module manifest fields (declared).",
        });
      }
      groups.get(key)!.memberEntityIds.push(file.id);
      pkgName.set(file.packageId ?? "unknown", file.packageId ?? "unknown");
    }
    return Array.from(groups.values()).map((g) => ({
      ...g,
      memberEntityIds: g.memberEntityIds.slice(0, maxMembersPerGroup),
    }));
  }

  /** External-library group (inferred by source-root / node_modules). */
  static externalGroup(snapshot: IntelligenceSnapshot): GroupSpec | null {
    const externals = snapshot.files.filter(
      (f) => f.sourceRoot === "node_modules" || f.category === "asset",
    );
    if (externals.length === 0) return null;
    return {
      id: "g:external",
      label: "External dependencies",
      kind: "external-service",
      basis: "inferred",
      memberEntityIds: externals.map((f) => f.id),
      description: "Group of files under node_modules / asset roots (inferred external boundary).",
    };
  }

  /**
   * Given a set of already-visible entity ids and a chosen group, return the
   * entity ids that should be revealed when the group is expanded.
   */
  static expandGroup(
    group: GroupSpec,
    alreadyVisible: Set<string>,
    limitPerExpansion = 50,
  ): string[] {
    return group.memberEntityIds
      .filter((id) => !alreadyVisible.has(id))
      .slice(0, limitPerExpansion);
  }

  /**
   * Progressive expansion of a single entity's neighbourhood, capped so the
   * webview is never handed the whole repository graph.
   */
  static sliceNeighbourhood(
    snapshot: IntelligenceSnapshot,
    entityIds: string[],
    direction: "inbound" | "outbound" | "both",
    depth: number,
  ): { entityIds: Set<string>; truncated: boolean } {
    const adjOut = new Map<string, string[]>();
    const adjIn = new Map<string, string[]>();
    for (const rel of snapshot.relationships) {
      if (!adjOut.has(rel.sourceId)) adjOut.set(rel.sourceId, []);
      adjOut.get(rel.sourceId)!.push(rel.targetId);
      if (!adjIn.has(rel.targetId)) adjIn.set(rel.targetId, []);
      adjIn.get(rel.targetId)!.push(rel.sourceId);
    }
    const seen = new Set<string>(entityIds);
    const queue: Array<{ id: string; d: number }> = entityIds.map((id) => ({ id, d: 0 }));
    const cap = DEFAULT_PERFORMANCE.initialDetailedNodes;
    while (queue.length > 0 && seen.size <= cap) {
      const { id, d } = queue.shift()!;
      if (d >= depth) continue;
      const neigh =
        direction === "inbound"
          ? (adjIn.get(id) ?? [])
          : direction === "outbound"
            ? (adjOut.get(id) ?? [])
            : [...(adjOut.get(id) ?? []), ...(adjIn.get(id) ?? [])];
      for (const n of neigh) {
        if (!seen.has(n)) {
          seen.add(n);
          queue.push({ id: n, d: d + 1 });
        }
      }
    }
    return { entityIds: seen, truncated: seen.size > cap };
  }
}

/** Helper: resolve an entity id to its symbol/file record. */
export function resolveEntity(
  snapshot: IntelligenceSnapshot,
  entityId: string,
): { symbol?: IntelligenceSymbolRecord; file?: IntelligenceFileRecord } {
  const symbol = snapshot.symbols.find((s) => s.id === entityId);
  if (symbol) {
    return { symbol, file: snapshot.files.find((f) => f.id === symbol.fileId) };
  }
  const file = snapshot.files.find((f) => f.id === entityId);
  return { file };
}

export { nodeIdForEntity };
