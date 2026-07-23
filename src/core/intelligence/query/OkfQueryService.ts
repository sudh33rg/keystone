import type { IntelligenceSnapshotReader } from "../../persistence/IntelligenceStore";
import type {
  IntelligenceEvidenceRecord,
  IntelligenceFileRecord,
  IntelligenceSnapshot,
  IntelligenceSymbolRecord,
} from "../../../shared/contracts/intelligence";
import {
  type CompiledIntelligenceQuery,
  type QueryDiagnostic,
  type QueryResultItem,
} from "../../../shared/contracts/query";

type Entity = IntelligenceSymbolRecord | IntelligenceFileRecord;

/**
 * OKF Query Service
 *
 * Provides queries for Open Knowledge Graph concepts derived from
 * the intelligence layer. Returns concepts as structured data
 * with full provenance evidence.
 */
export class OkfQueryService {
  constructor(
    private readonly store: IntelligenceSnapshotReader,
  ) {}

  async query(
    context: QueryContext,
    selector: { id?: string; value?: string },
): Promise<QueryResultItem[]> {
  const stableId = selector?.id ?? selector?.value;
    if (stableId) {
      const exact = context.entityById.get(stableId);
      if (exact) {
        if (
          !matchesEntityFilters(
            exact,
            context.query.filters.entityTypes,
            context.query.filters.languages,
            context,
          )
        )
          return [];
        const score = selector.id === stableId ? 1200 : 900;
        return [toItem(exact, score, ["OKF concept entity"])] as QueryResultItem[];
      }
      return [];
    }

    const results: QueryResultItem[] = [];
    let index = 0;
    for (const entity of context.entityById.values()) {
      await context.yield(++index);
      if (
        !matchesEntityFilters(
          entity,
          context.query.filters.entityTypes,
          context.query.filters.languages,
          context,
        )
      )
        continue;
      const score = rankOkfEntity(entity, selector ?? {});
      if (score < 200) continue;
      results.push(toItem(entity, score, ["OKF concept entity"]));
    }
    return results.sort((a, b) => b.score - a.score);
  }
}

interface QueryContext {
  readonly query: CompiledIntelligenceQuery;
  readonly snapshot: IntelligenceSnapshot;
  readonly signal?: AbortSignal;
  readonly entityById: Map<string, Entity>;
  readonly evidenceById: Map<string, IntelligenceEvidenceRecord>;
  readonly diagnostics: QueryDiagnostic[];
  check(): void;
  yield(index: number, interval?: number): Promise<void>;
}

function matchesEntityFilters(
  entity: Entity,
  types: readonly string[] | undefined,
  languages: readonly string[] | undefined,
  _context: QueryContext,
): boolean {
  if (types?.length && !types.includes(entityType(entity))) return false;
  if (languages?.length && !languages.includes(entity.language)) return false;
  return true;
}

function entityType(entity: Entity): string {
  return "type" in entity ? entity.type : "keystone.core.File";
}

function rankOkfEntity(entity: Entity, selector: { id?: string; value?: string }): number {
  const value = normalize(selector.value ?? selector.id ?? "");
  const name = normalize(entityName(entity));
  const qualified = normalize(entityQualifiedName(entity));
  const path = normalize(entityPath(entity));
  let score = 0;
  if (selector.id === entity.id || value === normalize(entity.id)) {
    score += 1200;
  }
  if (value && value === qualified) {
    score += 1000;
  }
  if (value && value === name) {
    score += 900;
  }
  if (value && value === path) {
    score += 950;
  }
  if (value && qualified.startsWith(value)) {
    score += 650;
  }
  const wanted = tokens(selector.value ?? selector.id ?? "");
  const entityTokens = tokens(`${name} ${qualified} ${path}`);
  const matched = wanted.filter((token) => entityTokens.includes(token)).length;
  if (matched) {
    score += matched * 120;
  }
  if ("confidence" in entity) {
    score += entity.confidence * 100;
  }
  return Math.max(0, score);
}

function normalize(value: string): string {
  return value.trim().toLowerCase().replace(/\\/g, "/");
}

function entityName(entity: Entity): string {
  return "name" in entity ? entity.name : entity.relativePath.split("/").at(-1) ?? entity.relativePath;
}

function entityQualifiedName(entity: Entity): string {
  return "qualifiedName" in entity ? entity.qualifiedName : entity.relativePath;
}

function entityPath(entity: Entity): string {
  return "relativePath" in entity ? entity.relativePath : "";
}

function tokens(value: string): string[] {
  return normalize(value.replace(/([a-z0-9])([A-Z])/g, "$1 $2"))
    .split(/[^a-z0-9]+/)
    .filter(Boolean);
}

function toItem(
  entity: Entity,
  score: number,
  reasons: string[],
): QueryResultItem {
  return {
    id: entity.id,
    type: entityType(entity),
    name: entityName(entity),
    qualifiedName: entityQualifiedName(entity),
    relativePath: entityPath(entity),
    score,
    confidence: "confidence" in entity ? entity.confidence : 1,
    classification: "exact",
    rankingReasons: reasons.slice(0, 20),
  };
}
