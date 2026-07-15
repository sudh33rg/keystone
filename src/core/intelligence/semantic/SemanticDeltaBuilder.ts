import type { FileContribution, IntelligenceSnapshot } from "../../../shared/contracts/intelligence";
import type { SemanticProjectResult } from "./SemanticModel";

export class SemanticDeltaBuilder {
  merge(base: IntelligenceSnapshot, result: SemanticProjectResult): IntelligenceSnapshot {
    const previous = new Map((base.contributions ?? []).filter((item) => item.parserId === result.parserId).map((item) => [item.fileId, item]));
    const next = new Map(result.contributions.map((item) => [item.fileId, item]));
    const affected = new Set<string>();
    for (const [fileId, contribution] of next) {
      const prior = previous.get(fileId);
      if (!prior || prior.sourceHash !== contribution.sourceHash || prior.parserVersion !== contribution.parserVersion) affected.add(fileId);
    }
    for (const fileId of previous.keys()) if (!next.has(fileId)) affected.add(fileId);
    let expanded = true;
    while (expanded) {
      expanded = false;
      for (const contribution of [...previous.values(), ...next.values()]) {
        if (!affected.has(contribution.fileId) && contribution.dependencyFileIds.some((fileId) => affected.has(fileId))) {
          affected.add(contribution.fileId);
          expanded = true;
        }
      }
    }

    const hasPriorSemantic = previous.size > 0;
    const replaceFiles = hasPriorSemantic ? affected : new Set(next.keys());
    const removedEntityIds = new Set(base.symbols.filter((item) => replaceFiles.has(item.ownerFileId ?? item.fileId)).map((item) => item.id));
    const removedRelationshipIds = new Set(base.relationships.filter((item) => item.type !== "keystone.core.CONTAINS" && ((item.ownerFileId && replaceFiles.has(item.ownerFileId)) || removedEntityIds.has(item.sourceId) || removedEntityIds.has(item.targetId))).map((item) => item.id));
    const removedSubjects = new Set([...removedEntityIds, ...removedRelationshipIds]);
    const updatedFiles = new Map(result.fileUpdates.map((item) => [item.id, item]));
    const addFiles = hasPriorSemantic ? replaceFiles : new Set(result.contributions.map((item) => item.fileId));
    return {
      ...base,
      files: base.files.map((file) => ({ ...file, ...updatedFiles.get(file.id) })),
      symbols: [...base.symbols.filter((item) => !removedEntityIds.has(item.id)), ...result.entities.filter((item) => addFiles.has(item.ownerFileId ?? item.fileId))],
      relationships: [...base.relationships.filter((item) => !removedRelationshipIds.has(item.id)), ...result.relationships.filter((item) => addFiles.has(item.ownerFileId ?? ""))],
      evidence: [...base.evidence.filter((item) => !removedSubjects.has(item.subjectId)), ...result.evidence.filter((item) => addFiles.has(item.ownerFileId ?? ""))],
      diagnostics: [...base.diagnostics.filter((item) => !item.ownerFileId || !replaceFiles.has(item.ownerFileId)), ...result.diagnostics.filter((item) => addFiles.has(item.ownerFileId ?? ""))],
      contributions: mergeContributions(base.contributions ?? [], result.contributions, addFiles, result.parserId)
    };
  }

  async mergeYielding(base: IntelligenceSnapshot, result: SemanticProjectResult, signal?: AbortSignal): Promise<IntelligenceSnapshot> {
    const previous = new Map((base.contributions ?? []).filter((item) => item.parserId === result.parserId).map((item) => [item.fileId, item]));
    const next = new Map(result.contributions.map((item) => [item.fileId, item]));
    const affected = new Set<string>();
    for (const [fileId, contribution] of next) {
      const prior = previous.get(fileId);
      if (!prior || prior.sourceHash !== contribution.sourceHash || prior.parserVersion !== contribution.parserVersion) affected.add(fileId);
    }
    for (const fileId of previous.keys()) if (!next.has(fileId)) affected.add(fileId);
    let expanded = true;
    while (expanded) {
      expanded = false;
      for (const contribution of [...previous.values(), ...next.values()]) {
        if (!affected.has(contribution.fileId) && contribution.dependencyFileIds.some((fileId) => affected.has(fileId))) { affected.add(contribution.fileId); expanded = true; }
      }
      await yieldForMerge(signal);
    }
    const hasPriorSemantic = previous.size > 0;
    const replaceFiles = hasPriorSemantic ? affected : new Set(next.keys());
    const removedEntityIds = new Set((await filterYielding(base.symbols, (item) => replaceFiles.has(item.ownerFileId ?? item.fileId), signal)).map((item) => item.id));
    const removedRelationshipIds = new Set((await filterYielding(base.relationships, (item) => item.type !== "keystone.core.CONTAINS" && ((item.ownerFileId && replaceFiles.has(item.ownerFileId)) || removedEntityIds.has(item.sourceId) || removedEntityIds.has(item.targetId)), signal)).map((item) => item.id));
    const removedSubjects = new Set([...removedEntityIds, ...removedRelationshipIds]);
    const updatedFiles = new Map(result.fileUpdates.map((item) => [item.id, item]));
    const addFiles = hasPriorSemantic ? replaceFiles : new Set(result.contributions.map((item) => item.fileId));
    return {
      ...base,
      files: await mapYielding(base.files, (file) => ({ ...file, ...updatedFiles.get(file.id) }), signal),
      symbols: [...await filterYielding(base.symbols, (item) => !removedEntityIds.has(item.id), signal), ...await filterYielding(result.entities, (item) => addFiles.has(item.ownerFileId ?? item.fileId), signal)],
      relationships: [...await filterYielding(base.relationships, (item) => !removedRelationshipIds.has(item.id), signal), ...await filterYielding(result.relationships, (item) => addFiles.has(item.ownerFileId ?? ""), signal)],
      evidence: [...await filterYielding(base.evidence, (item) => !removedSubjects.has(item.subjectId), signal), ...await filterYielding(result.evidence, (item) => addFiles.has(item.ownerFileId ?? ""), signal)],
      diagnostics: [...await filterYielding(base.diagnostics, (item) => !item.ownerFileId || !replaceFiles.has(item.ownerFileId), signal), ...await filterYielding(result.diagnostics, (item) => addFiles.has(item.ownerFileId ?? ""), signal)],
      contributions: mergeContributions(base.contributions ?? [], result.contributions, addFiles, result.parserId)
    };
  }
}

async function filterYielding<T>(items: readonly T[], predicate: (item: T) => boolean, signal?: AbortSignal): Promise<T[]> {
  const output: T[] = [];
  for (let index = 0; index < items.length; index++) {
    const item = items[index];
    if (item !== undefined && predicate(item)) output.push(item);
    if ((index + 1) % 500 === 0) await yieldForMerge(signal);
  }
  return output;
}

async function mapYielding<T, U>(items: readonly T[], transform: (item: T) => U, signal?: AbortSignal): Promise<U[]> {
  const output: U[] = [];
  for (let index = 0; index < items.length; index++) {
    const item = items[index];
    if (item !== undefined) output.push(transform(item));
    if ((index + 1) % 500 === 0) await yieldForMerge(signal);
  }
  return output;
}

async function yieldForMerge(signal?: AbortSignal): Promise<void> {
  if (signal?.aborted) { const error = new Error("Semantic delta merge was cancelled."); error.name = "AbortError"; throw error; }
  await new Promise<void>((resolve) => setImmediate(resolve));
}

function mergeContributions(previous: FileContribution[], next: FileContribution[], replaceFiles: Set<string>, parserId: string): FileContribution[] {
  const nextByFile = new Map(next.map((item) => [item.fileId, item]));
  const retained = previous.filter((item) => item.parserId !== parserId || !replaceFiles.has(item.fileId) && nextByFile.has(item.fileId));
  return [...retained, ...next.filter((item) => replaceFiles.has(item.fileId))].sort((left, right) => left.fileId.localeCompare(right.fileId));
}
