/**
 * ImpactAnalysisService (spec §9, §10, §12, §14).
 *
 * Orchestrates traversal, confidence explanation, public-contract change detection, and
 * affected-flow tagging. Produces a canonical ImpactAnalysis. Deterministic and LLM-free.
 */
import type { IntelligenceSnapshot } from "../../../shared/contracts/intelligence";
import type {
  ChangeSet,
  ImpactAnalysis,
  ImpactedEntity,
  ImpactedFlow,
  ImpactRoot,
  ImpactWarning,
} from "../../../shared/contracts/qaLifecycle";
import { createHash } from "node:crypto";
import { ImpactTraversalService, type TraversalConfig } from "./ImpactTraversalService";
import { AffectedFlowService } from "./AffectedFlowService";

export interface AnalyzeOptions {
  traversalDepth?: number;
  maximumEntities?: number;
  productionOnly?: boolean;
  includeTests?: boolean;
  includeExternal?: boolean;
  confidenceThreshold?: number;
  intelligenceRevision: string;
  planned?: boolean;
}

export class ImpactAnalysisService {
  constructor(
    private readonly snapshot: IntelligenceSnapshot,
    private readonly flows: AffectedFlowService = new AffectedFlowService(snapshot),
  ) {}

  analyze(changeSet: ChangeSet, options: AnalyzeOptions): ImpactAnalysis {
    const traversal = new ImpactTraversalService(this.snapshot);
    const cfg: Partial<TraversalConfig> = {
      traversalDepth: options.traversalDepth ?? 4,
      maximumEntities: options.maximumEntities ?? 2000,
      productionOnly: options.productionOnly ?? false,
      includeTests: options.includeTests ?? true,
      includeExternal: options.includeExternal ?? true,
      confidenceThreshold: options.confidenceThreshold ?? 0,
    };
    const roots: ImpactRoot[] = changeSet.symbols.map((s) => ({
      entityId: s.symbolId,
      displayName: this.nameOf(s.symbolId, s.filePath),
      kind: s.kind,
      filePath: s.filePath,
      changeType: s.changeType,
      planned: options.planned ?? false,
    }));
    // File-level fallback roots when no symbols resolved.
    if (roots.length === 0) {
      for (const f of changeSet.files) {
        const file = this.snapshot.files.find((x) => x.relativePath === f.path);
        if (file)
          roots.push({
            entityId: file.id,
            displayName: f.path,
            kind: "keystone.core.File",
            filePath: f.path,
            changeType: f.changeType,
            planned: options.planned ?? false,
          });
      }
    }

    const { entities, paths, truncated } = traversal.run(changeSet.symbols, cfg);
    const contracts = this.detectPublicContractChanges(changeSet, entities);
    for (const c of contracts) {
      const e = entities.find((x) => x.entityId === c.entityId);
      if (e) {
        e.isPublicContract = true;
        e.contractChangeType = c.changeType;
      }
    }
    const affectedFlows = this.flows.detect(entities);
    for (const flow of affectedFlows) {
      for (const e of entities)
        if (
          flow.changedStepEntityIds.includes(e.entityId) ||
          flow.indirectlyImpactedStepEntityIds.includes(e.entityId)
        )
          e.affectedFlowIds.push(flow.id);
    }

    const warnings: ImpactWarning[] = [];
    if (truncated)
      warnings.push({
        code: "impact-truncated",
        message: `Impact traversal truncated at ${cfg.maximumEntities} entities. Increase maximumEntities or narrow scope.`,
        severity: "warning",
        omitted: "",
        refineHint: "Increase maximumEntities or set productionOnly.",
      });
    if (changeSet.metadata.partial)
      warnings.push({
        code: "symbol-resolution-partial",
        message: "Change set is partial; some symbols could not be resolved.",
        severity: "warning",
        omitted: "",
        refineHint: "Provide more change scope or wait for intelligence rebuild.",
      });

    return {
      id: crypto.randomUUID(),
      workflowId: changeSet.workflowId,
      changeSetId: changeSet.id,
      roots,
      entities,
      paths,
      flows: affectedFlows,
      tests: [],
      gaps: [],
      risk: { overallLevel: "low", score: 0, factors: [] },
      limits: {
        traversalDepth: cfg.traversalDepth ?? 4,
        maximumEntities: cfg.maximumEntities ?? 2000,
        truncated,
      },
      warnings,
      metadata: {
        intelligenceRevision: options.intelligenceRevision,
        generatedAt: new Date().toISOString(),
        contentHash: this.hash(entities, affectedFlows),
        status: truncated ? "partial" : "complete",
      },
    };
  }

  private explainConfidence(entities: ImpactedEntity[]): Record<string, string> {
    const out: Record<string, string> = {};
    for (const e of entities) {
      if (e.category === "changed-directly") {
        out[e.entityId] = "Changed directly in the change set.";
        continue;
      }
      const evidence = e.evidence.length
        ? `static evidence ${e.evidence.map((x) => x.id).join(", ")}`
        : "no static evidence";
      if (e.distance === 1)
        out[e.entityId] =
          `High confidence: ${e.category} of changed entity; distance 1; ${evidence}.`;
      else
        out[e.entityId] =
          `Medium confidence: ${e.category}; distance ${e.distance}; ${evidence}. Dynamic dispatch cannot be uniquely resolved.`;
    }
    return out;
  }

  private detectPublicContractChanges(
    changeSet: ChangeSet,
    entities: ImpactedEntity[],
  ): PublicContractChange[] {
    const out: PublicContractChange[] = [];
    for (const s of changeSet.symbols) {
      if (!s.isPublicContract) continue;
      const changeType =
        s.changeType === "deleted"
          ? "removed"
          : s.changeType === "added"
            ? "added"
            : "signature-change";
      out.push({ entityId: s.symbolId, changeType });
      const e = entities.find((x) => x.entityId === s.symbolId);
      if (e) e.isPublicContract = true;
    }
    return out;
  }

  private nameOf(id: string, fallbackPath: string): string {
    const sym = this.snapshot.symbols.find((s) => s.id === id);
    if (sym) return sym.name;
    const file = this.snapshot.files.find((f) => f.id === id);
    if (file) return file.relativePath.split("/").pop() ?? file.relativePath;
    return fallbackPath;
  }

  private hash(entities: ImpactedEntity[], flows: ImpactedFlow[]): string {
    const raw = JSON.stringify({ e: entities.length, f: flows.length });
    return createHash("sha256").update(raw).digest("hex").slice(0, 32);
  }
}

export interface PublicContractChange {
  entityId: string;
  changeType:
    | "added"
    | "removed"
    | "signature-change"
    | "type-change"
    | "required-field-change"
    | "response-shape-change"
    | "event-payload-change"
    | "persistence-schema-change";
}
