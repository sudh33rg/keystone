import type { IntelligenceIndexes, IntelligenceSnapshot } from "../../../shared/contracts/intelligence";

export class SemanticGraphBuilder {
  buildIndexes(snapshot: Pick<IntelligenceSnapshot, "files" | "symbols" | "relationships">): IntelligenceIndexes {
    const indexes = emptyIndexes();
    for (const file of snapshot.files) {
      add(indexes.byPath, file.relativePath.toLowerCase(), file.id);
      add(indexes.byLanguage, file.language, file.id);
      if (file.packageId) add(indexes.packageMembership, file.packageId, file.id);
    }
    for (const entity of snapshot.symbols) {
      add(indexes.byName, entity.name.toLowerCase(), entity.id);
      add(indexes.byQualifiedName, entity.qualifiedName.toLowerCase(), entity.id);
      add(indexes.byType, entity.type, entity.id);
      add(indexes.byLanguage, entity.language, entity.id);
    }
    for (const relationship of snapshot.relationships) {
      add(indexes.outgoing, relationship.sourceId, relationship.id);
      add(indexes.incoming, relationship.targetId, relationship.id);
      if (relationship.type === "keystone.core.TESTS") add(indexes.testTargets, relationship.targetId, relationship.sourceId);
      if (relationship.type === "keystone.core.READS_CONFIGURATION") add(indexes.configurationUsage, relationship.targetId, relationship.sourceId);
      if (relationship.type === "keystone.core.ROUTES_TO") add(indexes.routeHandlers, relationship.sourceId, relationship.targetId);
    }
    sortIndexes(indexes);
    return indexes;
  }

  async buildIndexesYielding(snapshot: Pick<IntelligenceSnapshot, "files" | "symbols" | "relationships">, signal?: AbortSignal): Promise<IntelligenceIndexes> {
    const indexes = emptyIndexes();
    let processed = 0;
    for (const file of snapshot.files) {
      add(indexes.byPath, file.relativePath.toLowerCase(), file.id);
      add(indexes.byLanguage, file.language, file.id);
      if (file.packageId) add(indexes.packageMembership, file.packageId, file.id);
      if (++processed % 500 === 0) await yieldForIndex(signal);
    }
    for (const entity of snapshot.symbols) {
      add(indexes.byName, entity.name.toLowerCase(), entity.id);
      add(indexes.byQualifiedName, entity.qualifiedName.toLowerCase(), entity.id);
      add(indexes.byType, entity.type, entity.id);
      add(indexes.byLanguage, entity.language, entity.id);
      if (++processed % 500 === 0) await yieldForIndex(signal);
    }
    for (const relationship of snapshot.relationships) {
      addRelationshipIndexes(indexes, relationship);
      if (++processed % 500 === 0) await yieldForIndex(signal);
    }
    sortIndexes(indexes);
    return indexes;
  }
}

export function emptyIndexes(): IntelligenceIndexes {
  return { byName: stringIndex(), byQualifiedName: stringIndex(), byPath: stringIndex(), byType: stringIndex(), byLanguage: stringIndex(), incoming: stringIndex(), outgoing: stringIndex(), routeHandlers: stringIndex(), testTargets: stringIndex(), packageMembership: stringIndex(), configurationUsage: stringIndex() };
}

function add(index: Record<string, string[]>, key: string, id: string): void {
  const existing = Object.prototype.hasOwnProperty.call(index, key) ? index[key] : undefined;
  const values = Array.isArray(existing) ? existing : (index[key] = []);
  if (!values.includes(id)) values.push(id);
}

function stringIndex(): Record<string, string[]> { return Object.create(null) as Record<string, string[]>; }

function addRelationshipIndexes(indexes: IntelligenceIndexes, relationship: IntelligenceSnapshot["relationships"][number]): void {
  add(indexes.outgoing, relationship.sourceId, relationship.id);
  add(indexes.incoming, relationship.targetId, relationship.id);
  if (relationship.type === "keystone.core.TESTS") add(indexes.testTargets, relationship.targetId, relationship.sourceId);
  if (relationship.type === "keystone.core.READS_CONFIGURATION") add(indexes.configurationUsage, relationship.targetId, relationship.sourceId);
  if (relationship.type === "keystone.core.ROUTES_TO") add(indexes.routeHandlers, relationship.sourceId, relationship.targetId);
}

async function yieldForIndex(signal?: AbortSignal): Promise<void> {
  if (signal?.aborted) { const error = new Error("Semantic index construction was cancelled."); error.name = "AbortError"; throw error; }
  await new Promise<void>((resolve) => setImmediate(resolve));
}

function sortIndexes(indexes: IntelligenceIndexes): void {
  for (const index of Object.values(indexes)) for (const values of Object.values(index)) values.sort();
}
