import type {
  IntelligenceDiagnostic,
  IntelligenceEvidenceRecord,
  IntelligenceFileRecord,
  IntelligenceRelationshipRecord,
  IntelligenceSnapshot,
  IntelligenceSymbolRecord,
  WorkspaceRootRecord
} from "../../../shared/contracts/intelligence";
import { normalizeRelativePath } from "../StableId";
import type { RepositoryChange } from "./ChangeCollector";

export interface IngestionDelta {
  files: IntelligenceFileRecord[];
  symbols: IntelligenceSymbolRecord[];
  relationships: IntelligenceRelationshipRecord[];
  evidence: IntelligenceEvidenceRecord[];
  diagnostics: IntelligenceDiagnostic[];
}

export interface FileIngestionJob {
  path: string;
  inputContentHash: string;
  jobRevision: number;
  baseGeneration: number;
  signal?: AbortSignal;
}

export function emptyIngestionDelta(): IngestionDelta {
  return { files: [], symbols: [], relationships: [], evidence: [], diagnostics: [] };
}

export class DependencyInvalidator {
  invalidate(snapshot: IntelligenceSnapshot, changes: readonly RepositoryChange[], roots: ReadonlyMap<string, WorkspaceRootRecord | undefined>): IngestionDelta {
    const rootIdByUri = new Map(changes.map((change) => [change.rootUri, roots.get(change.rootUri)?.id]));
    const changedKeys = new Set(changes.map((change) => `${rootIdByUri.get(change.rootUri) ?? ""}\u001f${normalizeRelativePath(change.relativePath)}`));
    const removedFiles = new Set(snapshot.files.filter((file) => changedKeys.has(`${file.workspaceRootId}\u001f${file.relativePath}`)).map((file) => file.id));
    const removedSymbols = new Set(snapshot.symbols.filter((symbol) => removedFiles.has(symbol.fileId)).map((symbol) => symbol.id));
    const removedEntities = new Set([...removedFiles, ...removedSymbols]);
    const relationships = snapshot.relationships.filter((relationship) => !removedEntities.has(relationship.sourceId) && !removedEntities.has(relationship.targetId));
    const retainedSubjectIds = new Set([
      ...snapshot.files.filter((file) => !removedFiles.has(file.id)).map((file) => file.id),
      ...snapshot.symbols.filter((symbol) => !removedSymbols.has(symbol.id)).map((symbol) => symbol.id),
      ...relationships.map((relationship) => relationship.id)
    ]);
    return {
      files: snapshot.files.filter((file) => !removedFiles.has(file.id)),
      symbols: snapshot.symbols.filter((symbol) => !removedSymbols.has(symbol.id)),
      relationships,
      evidence: snapshot.evidence.filter((item) => retainedSubjectIds.has(item.subjectId)),
      diagnostics: snapshot.diagnostics.filter((item) => !changedKeys.has(`${item.workspaceRootId ?? ""}\u001f${item.relativePath ?? ""}`))
    };
  }
}

export class DeltaMerger {
  merge(target: IngestionDelta, delta: IngestionDelta): void {
    target.files.push(...delta.files);
    target.symbols.push(...delta.symbols);
    target.relationships.push(...delta.relationships);
    target.evidence.push(...delta.evidence);
    target.diagnostics.push(...delta.diagnostics);
  }
}
