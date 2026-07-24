/**
 * SecurityScanQueryService — exposes the existing deterministic security
 * intelligence engine (SecurityIntelligenceServices.ts) as a bounded query
 * operation (`SECURITY_SCAN`).
 *
 * Derives entity inputs from the intelligence snapshot (routes, handlers,
 * exported entry points, configuration keys, columns), runs attack-surface
 * discovery + sensitive-data classification, and assembles the results into
 * `QueryData` with severity-grouped sections. Read-only, evidence-backed,
 * no LLM, bounded by the query limits.
 */
import type {
  IntelligenceEvidenceRecord,
  IntelligenceFileRecord,
  IntelligenceRelationshipRecord,
  IntelligenceSnapshot,
  IntelligenceSymbolRecord,
} from "../../../shared/contracts/intelligence";
import {
  QueryDataSchema,
  type CompiledIntelligenceQuery,
  type QueryData,
  type QueryDiagnostic,
  type QueryResultItem,
} from "../../../shared/contracts/query";
import {
  AttackSurfaceDiscoveryService,
  SensitiveDataClassificationService,
  type EntityInput,
} from "../security/SecurityIntelligenceServices";

type Entity = IntelligenceSymbolRecord | IntelligenceFileRecord;

interface QueryContext {
  readonly query: CompiledIntelligenceQuery;
  readonly snapshot: IntelligenceSnapshot;
  readonly entityById: Map<string, Entity>;
  readonly evidenceById: Map<string, IntelligenceEvidenceRecord>;
  readonly diagnostics: QueryDiagnostic[];
  readonly incoming: Map<string, string[]>;
  readonly outgoing: Map<string, string[]>;
  check(): void;
  relationships(
    id: string,
    direction: "incoming" | "outgoing" | "both",
  ): IntelligenceRelationshipRecord[];
}

const ENTRY_POINT_TYPES =
  /Route|Endpoint|Handler|Controller|Command|Consumer|Subscriber|Webhook|Job|Pipeline/i;
const DATA_CARRIER_TYPES = /Column|Field|ConfigurationKey|Parameter|Property/i;

export class SecurityScanQueryService {
  /** Off switch for environments that do not want scan results surfaced. */
  enabled = true;

  private readonly attackSurface = new AttackSurfaceDiscoveryService();
  private readonly sensitiveData = new SensitiveDataClassificationService();

  scan(context: QueryContext): QueryData {
    if (!this.enabled) {
      context.diagnostics.push({
        code: "security-scan-disabled",
        severity: "info",
        message: "Security scanning is disabled by configuration.",
        limitation: true,
      });
      return QueryDataSchema.parse({ kind: "security-scan" });
    }
    context.check();

    const entryPoints: EntityInput[] = [];
    for (const symbol of context.snapshot.symbols) {
      if (!ENTRY_POINT_TYPES.test(symbol.type) && symbol.exported !== true) continue;
      entryPoints.push(this.toEntityInput(symbol, context));
      if (entryPoints.length >= context.query.limits.nodes) break;
    }
    const surface = this.attackSurface.discover(entryPoints);
    const { exposed, unauthenticated } = this.collectAttackSurface(context, surface);

    const sensitive = this.collectSensitiveData(context);

    const limit = context.query.limits.results;
    const items = [...unauthenticated, ...exposed.filter((i) => !unauthenticated.includes(i))]
      .slice(0, limit);
    return QueryDataSchema.parse({
      kind: "security-scan",
      items,
      nodes: exposed.slice(0, context.query.limits.nodes),
      relationships: [],
      paths: [],
      sections: {
        attackSurface: exposed.slice(0, limit),
        unauthenticatedExposure: unauthenticated.slice(0, limit),
        sensitiveData: sensitive.slice(0, limit),
      },
      metrics: {
        attackSurfaceEntries: exposed.length,
        unauthenticatedExposures: unauthenticated.length,
        sensitiveDataCarriers: sensitive.length,
        scannedEntryPoints: entryPoints.length,
      },
    });
  }

  private toEntityInput(symbol: IntelligenceSymbolRecord, context: QueryContext): EntityInput {
    const roles: string[] = [symbol.type.replace(/^keystone\.core\./, "").toLowerCase()];
    const properties = symbol.properties ?? {};
    if (typeof properties.layer === "string") roles.push(properties.layer);
    if (typeof properties.method === "string") roles.push("route", "http");
    if (symbol.exported === true) roles.push("public");
    if (/auth|login|session|token/i.test(symbol.name)) roles.push("auth");
    if (/admin/i.test(symbol.name)) roles.push("admin");
    const registration =
      typeof properties.method === "string" && typeof properties.path === "string"
        ? `${properties.method} ${properties.path}`
        : undefined;
    const file = context.snapshot.files.find((item) => item.id === symbol.fileId);
    return {
      entityId: symbol.id,
      displayName: symbol.name,
      filePath: file?.relativePath,
      roles,
      frameworkRegistration: registration,
      evidence: symbol.evidenceIds.slice(0, 5),
    };
  }

  private collectAttackSurface(
    context: QueryContext,
    surface: { entries: Array<{ entityId: string; exposure: string; authenticationRequired: boolean; authorizationRequired: boolean; protocolOrTrigger: string; sensitiveOperations: string[]; confidence: number }> },
  ): { exposed: QueryResultItem[]; unauthenticated: QueryResultItem[] } {
    const exposed: QueryResultItem[] = [];
    const unauthenticated: QueryResultItem[] = [];
    for (const entry of surface.entries) {
      const entity = context.entityById.get(entry.entityId);
      if (!entity) continue;
      const item = this.toItem(entity, entry.confidence, [
        `exposure ${entry.exposure}`,
        entry.authenticationRequired ? "authentication evidence" : "no authentication evidence",
      ]);
      const enriched: QueryResultItem = {
        ...item,
        group: entry.exposure,
        details: {
          exposure: entry.exposure,
          authenticationRequired: entry.authenticationRequired,
          authorizationRequired: entry.authorizationRequired,
          protocolOrTrigger: entry.protocolOrTrigger,
          sensitiveOperations: entry.sensitiveOperations,
        },
      };
      exposed.push(enriched);
      const externallyReachable =
        entry.exposure === "public-external" ||
        entry.exposure === "partner-or-service-external" ||
        entry.exposure === "administrative";
      if (externallyReachable && !entry.authenticationRequired) unauthenticated.push(enriched);
    }
    return { exposed, unauthenticated };
  }

  private collectSensitiveData(context: QueryContext): QueryResultItem[] {
    const sensitive: QueryResultItem[] = [];
    for (const symbol of context.snapshot.symbols) {
      if (!DATA_CARRIER_TYPES.test(symbol.type)) continue;
      const classified = this.sensitiveData.classify(symbol.name);
      if (classified.category === "unknown-sensitive-data") continue;
      sensitive.push({
        ...this.toItem(symbol, classified.confidence, [
          `sensitive data category ${classified.category}`,
        ]),
        group: classified.category,
        details: { category: classified.category },
      });
      if (sensitive.length >= context.query.limits.results) break;
    }
    return sensitive;
  }

  private toItem(entity: Entity, confidence: number, reasons: string[]): QueryResultItem {
    return {
      id: entity.id,
      type: "type" in entity ? entity.type : "keystone.core.File",
      name:
        "name" in entity
          ? entity.name
          : (entity.relativePath.split("/").at(-1) ?? entity.relativePath),
      qualifiedName: "qualifiedName" in entity ? entity.qualifiedName : entity.relativePath,
      relativePath: "relativePath" in entity ? entity.relativePath : undefined,
      score: Math.round(confidence * 100),
      confidence,
      classification: "structurally-inferred",
      rankingReasons: reasons.slice(0, 20),
    };
  }
}
