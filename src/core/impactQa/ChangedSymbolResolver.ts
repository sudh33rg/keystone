import type { IntelligenceSnapshot } from "../../shared/contracts/intelligence";
import type { Phase7ChangeSet, Phase7ChangedEntity } from "../../shared/contracts/impactQa";

export class ChangedSymbolResolver {
  constructor(private readonly snapshot: IntelligenceSnapshot) {}
  resolve(changeSet: Phase7ChangeSet, intelligenceRevision: string): Phase7ChangedEntity[] {
    const resolved: Phase7ChangedEntity[] = [];
    for (const changed of changeSet.files) {
      const file = this.snapshot.files.find((item) => item.relativePath === changed.path) ?? (changed.oldPath ? this.snapshot.files.find((item) => item.relativePath === changed.oldPath) : undefined);
      const canResolveSymbols = changed.changeType === "added" || changed.changeType === "deleted" || Boolean(changed.changedRanges?.length);
      const symbols = file && canResolveSymbols ? this.snapshot.symbols.filter((item) => item.fileId === file.id && overlaps(item.range.startLine, item.range.endLine, changed.changedRanges)) : [];
      if (!symbols.length) { resolved.push({ id: `changed:${changed.path}`, filePath: changed.path, changeType: "file-level", confidence: 0, evidenceIds: file?.evidenceIds ?? [], intelligenceRevision }); continue; }
      for (const symbol of symbols) resolved.push({ id: `changed:${symbol.id}:${changed.changeType}`, entityId: symbol.id, filePath: changed.path, changeType: changed.changeType === "deleted" ? "removed" : changed.changeType === "added" ? "added" : signatureChanged(changed.changedRanges, symbol.range.startLine) ? "signature-changed" : "modified", range: { startLine: symbol.range.startLine, endLine: symbol.range.endLine }, confidence: symbol.confidence, evidenceIds: symbol.evidenceIds, intelligenceRevision });
    }
    return [...new Map(resolved.map((item) => [item.id, item])).values()];
  }
}
function overlaps(start: number, end: number, ranges?: Array<{ oldStartLine?: number; oldEndLine?: number; newStartLine?: number; newEndLine?: number }>): boolean { if (!ranges?.length) return true; return ranges.some((range) => { const a = range.newStartLine ?? range.oldStartLine ?? 0; const b = range.newEndLine ?? range.oldEndLine ?? a; return !(b < start || a > end); }); }
function signatureChanged(ranges: Array<{ newStartLine?: number; oldStartLine?: number }> | undefined, symbolStart: number): boolean { return Boolean(ranges?.some((range) => (range.newStartLine ?? range.oldStartLine) === symbolStart)); }
