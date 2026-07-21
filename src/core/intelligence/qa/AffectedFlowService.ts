/**
 * AffectedFlowService (spec §13).
 *
 * Identifies engineering flows affected by changed entities. Derives flows from the existing
 * IntelligenceSnapshot: route handlers (indexes.routeHandlers) and their call chains become
 * flow steps. A flow is "affected" when any step is a changed or impacted entity.
 */
import type { IntelligenceSnapshot } from "../../../shared/contracts/intelligence";
import type { ImpactedEntity, ImpactedFlow } from "../../../shared/contracts/qaLifecycle";

export class AffectedFlowService {
  constructor(private readonly snapshot: IntelligenceSnapshot) {}

  detect(entities: ImpactedEntity[]): ImpactedFlow[] {
    const impactedIds = new Set(entities.map((e) => e.entityId));
    const changedIds = new Set(
      entities.filter((e) => e.category === "changed-directly").map((e) => e.entityId),
    );
    const flows: ImpactedFlow[] = [];

    // Route-handler based flows.
    const routeHandlers = this.snapshot.indexes?.routeHandlers ?? {};
    for (const [route, handlerIds] of Object.entries(routeHandlers)) {
      for (const handlerId of handlerIds) {
        const chain = this.callChain(handlerId, 8);
        const changedSteps = chain.filter((id) => changedIds.has(id));
        const indirectly = chain.filter((id) => impactedIds.has(id) && !changedIds.has(id));
        if (changedSteps.length === 0 && indirectly.length === 0) continue;
        const testIds = this.testsReferencing(chain);
        flows.push({
          id: `flow:${route}:${handlerId}`,
          name: `Flow ${route}`,
          entry: handlerId,
          changedStepEntityIds: changedSteps,
          indirectlyImpactedStepEntityIds: indirectly,
          sideEffects: chain.filter((id) => this.isPersistence(id)),
          relatedTestIds: testIds,
          confidence: changedSteps.length > 0 ? 0.9 : 0.6,
          evidence: changedSteps.map((id) => ({
            id,
            kind: "flow-step",
            statement: `Changed step in ${route}`,
          })),
          riskCategory: changedSteps.length > 0 ? "high" : "medium",
        });
      }
    }
    return flows;
  }

  /** Collect all symbols reachable by outgoing CALLS relationships (bounded depth). */
  callChain(rootId: string, maxDepth: number): string[] {
    const seen = new Set<string>([rootId]);
    const queue: Array<{ id: string; depth: number }> = [{ id: rootId, depth: 0 }];
    while (queue.length > 0) {
      const cur = queue.shift()!;
      if (cur.depth >= maxDepth) continue;
      for (const r of this.snapshot.relationships) {
        if (r.sourceId === cur.id && r.type === "calls" && !seen.has(r.targetId)) {
          seen.add(r.targetId);
          queue.push({ id: r.targetId, depth: cur.depth + 1 });
        }
      }
    }
    return [...seen];
  }

  private testsReferencing(entityIds: string[]): string[] {
    const set = new Set(entityIds);
    const testSyms = this.snapshot.symbols.filter((s) => {
      const f = this.snapshot.files.find((x) => x.id === s.fileId);
      return f?.isTest;
    });
    return testSyms
      .filter((t) =>
        this.snapshot.relationships.some((r) => r.sourceId === t.id && set.has(r.targetId)),
      )
      .map((t) => t.id);
  }

  private isPersistence(id: string): boolean {
    const sym = this.snapshot.symbols.find((s) => s.id === id);
    const p = sym?.properties as Record<string, unknown> | undefined;
    return p?.["isPersistence"] === true;
  }
}
