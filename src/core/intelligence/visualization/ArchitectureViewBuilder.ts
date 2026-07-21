/**
 * ArchitectureViewBuilder (spec §6).
 *
 * Derived from the existing intelligence. Progressively reveals:
 *   repository -> packages -> modules -> directories -> files -> symbols.
 * First view emphasizes major applications, libraries, services, domain modules,
 * entry points, storage/external boundaries, test areas, configuration.
 *
 * Grouping is deterministic (package/module manifest fields, source roots,
 * node_modules detection). Groups are marked declared / derived / inferred.
 */
import type {
  IntelligenceVisualNode,
  IntelligenceVisualEdge,
  IntelligenceVisualGroup,
} from "../../../shared/contracts/visualization";
import type { BuilderContext } from "./BaseViewBuilder";
import { BaseViewBuilder } from "./BaseViewBuilder";
import type { GroupSpec } from "./GraphSliceService";
import { GraphSliceService, resolveEntity } from "./GraphSliceService";
import { nodeIdForEntity } from "./mapping";

export class ArchitectureViewBuilder extends BaseViewBuilder {
  build(): {
    nodes: IntelligenceVisualNode[];
    edges: IntelligenceVisualEdge[];
    groups: IntelligenceVisualGroup[];
  } {
    const groups: GroupSpec[] = [];
    // Emphasize by grouping: external first (collapsed), then packages/modules.
    const external = GraphSliceService.externalGroup(this.snapshot);
    if (external) groups.push(external);

    const archGroups = GraphSliceService.buildArchitectureGroups(this.snapshot);
    for (const g of archGroups) groups.push(g);

    // For seeds, expand their immediate containment chain (file contains symbol).
    const nodes: IntelligenceVisualNode[] = [];
    const edges: IntelligenceVisualEdge[] = [];
    const seen = new Set<string>();

    const addEntity = (entityId: string) => {
      if (seen.has(entityId)) return;
      seen.add(entityId);
      nodes.push(this.buildNode(entityId));
    };

    // Repository root node.
    addEntity(this.snapshot.repository.id);
    // Package/module group representative nodes (one node per group, collapsed).
    const visualGroups: IntelligenceVisualGroup[] = [];
    for (const g of groups) {
      visualGroups.push(this.toVisualGroup(g));
      if (g.memberEntityIds.length === 0) continue;
      // Add the group's first member as a representative + a CONTAINS edge to repo.
      const rep = g.memberEntityIds[0] ?? "";
      if (!rep) continue;
      addEntity(rep);
      edges.push(
        this.buildEdge(
          {
            id: `arch-contains-${rep}`,
            repositoryId: this.snapshot.repository.id,
            sourceId: this.snapshot.repository.id,
            targetId: rep,
            type: "keystone.core.CONTAINS",
            ownerFileId: rep,
            targetFileId: rep,
            resolution: "exact",
            properties: {},
            evidenceIds: [],
            derivation: "extracted",
            confidence: 1,
            generation: 1,
          },
          {
            state: {
              highlighted: false,
              inferred: false,
              unresolved: false,
              collapsed: true,
            },
          },
        ),
      );
    }

    // If seeds provided, reveal their containment (file -> symbols).
    for (const seed of this.ctx.seeds) {
      addEntity(seed);
      const { symbol, file } = resolveEntity(this.snapshot, seed);
      const containerId = symbol?.fileId ?? file?.id;
      if (containerId && containerId !== seed) {
        addEntity(containerId);
        edges.push(
          this.buildEdge({
            id: `arch-cont-${containerId}-${seed}`,
            repositoryId: this.snapshot.repository.id,
            sourceId: containerId,
            targetId: seed,
            type: "keystone.core.CONTAINS",
            ownerFileId: containerId,
            targetFileId: containerId,
            resolution: "exact",
            properties: {},
            evidenceIds: [],
            derivation: "extracted",
            confidence: 1,
            generation: 1,
          }),
        );
      }
    }

    return { nodes, edges, groups: visualGroups };
  }

  private toVisualGroup(g: GroupSpec): IntelligenceVisualGroup {
    return {
      id: g.id,
      label: g.label,
      kind: g.kind,
      basis: g.basis,
      childNodeIds: g.memberEntityIds.map((m) => nodeIdForEntity(m)),
      collapsed: true,
      description: g.description,
    };
  }

  static async build(ctx: BuilderContext): Promise<{
    nodes: IntelligenceVisualNode[];
    edges: IntelligenceVisualEdge[];
  }> {
    return new ArchitectureViewBuilder(ctx).build();
  }
}
