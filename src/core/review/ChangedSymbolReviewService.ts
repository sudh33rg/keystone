import { createHash } from "node:crypto";
import {
  PR_REVIEW_SCHEMA_VERSION,
  ChangedSymbolSchema,
  type ChangedSymbol,
} from "../../shared/contracts/prReview";

export interface SymbolIndex {
  filePath: string;
  name: string;
  qualifiedName?: string;
  kind: string;
  range: { startLine: number; endLine: number };
  visibility: "public" | "protected" | "private" | "package" | "local";
  exported: boolean;
  defaultExport: boolean;
  signature?: string;
}

export interface SymbolRelationships {
  directCallers?: string[];
  directDependents?: string[];
  affectedFlows?: string[];
  mappedTests?: string[];
  relatedRequirementIds?: string[];
  entryPoint?: boolean;
}

export interface ChangedFile {
  path: string;
  changeType: "added" | "modified" | "deleted" | "renamed";
  changedRanges?: Array<{
    startLine: number;
    endLine: number;
    oldStartLine?: number;
    oldEndLine?: number;
    newStartLine?: number;
    newEndLine?: number;
  }>;
  oldPath?: string;
}

export interface ChangedSymbolReviewInput {
  workflowId: string;
  changedFiles: ChangedFile[];
  symbolsByFile: Record<string, SymbolIndex[]>;
  relationshipsBySymbol?: Record<string, SymbolRelationships>;
  entryPointSymbolIds?: Set<string>;
  publicContractSymbolIds?: Set<string>;
}

/**
 * Deterministic changed-symbol review (spec §8).
 * Maps changed ranges to real intelligence entities when available, marks
 * added/removed/signature-changed symbols, identifies public symbols and
 * entry points, falls back honestly to file-level review when unresolved,
 * and never fabricates symbols.
 */
export class ChangedSymbolReviewService {
  build(input: ChangedSymbolReviewInput): ChangedSymbol[] {
    const output: ChangedSymbol[] = [];
    const relationships = input.relationshipsBySymbol ?? {};

    for (const file of input.changedFiles) {
      const symbols = input.symbolsByFile[file.path] ?? [];
      if (symbols.length === 0) {
        output.push({
          name: file.path,
          kind: "file",
          file: file.path,
          changeType: file.changeType === "deleted" ? "removed" : file.changeType === "added" ? "added" : "modified",
          visibility: "unknown",
          publicContract: false,
          entryPoint: false,
          directCallers: [],
          directDependents: [],
          affectedFlows: [],
          mappedTests: [],
          relatedRequirementIds: [],
          resolved: false,
        });
        continue;
      }

      for (const symbol of symbols) {
        const visibility = symbol.exported ? "public" : toReviewVisibility(symbol.visibility);
        const symbolKey = symbol.qualifiedName ?? symbol.name;
        const rel = relationships[symbolKey] ?? {};
        const changeType = deriveChangeType(file, symbol);

        output.push(
          ChangedSymbolSchema.parse({
            name: symbol.name,
            kind: symbol.kind,
            file: symbol.filePath,
            changeType,
            visibility,
            oldSignature: symbol.signature,
            publicContract: symbol.exported || symbol.defaultExport || input.publicContractSymbolIds?.has(symbolKey) === true,
            entryPoint: rel.entryPoint ?? input.entryPointSymbolIds?.has(symbolKey) === true,
            directCallers: rel.directCallers ?? [],
            directDependents: rel.directDependents ?? [],
            affectedFlows: rel.affectedFlows ?? [],
            mappedTests: rel.mappedTests ?? [],
            relatedRequirementIds: rel.relatedRequirementIds ?? [],
            resolved: true,
          }),
        );
      }
    }

    const seen = new Set<string>();
    const deduped: ChangedSymbol[] = [];
    for (const symbol of output) {
      const key = `${symbol.file}:${symbol.name}:${symbol.changeType}`;
      if (!seen.has(key)) {
        seen.add(key);
        deduped.push(symbol);
      }
    }
    return deduped;
  }

  static signatureChanges(symbols: ChangedSymbol[]): ChangedSymbol[] {
    return symbols.filter((s) => s.changeType === "signature-changed");
  }

  static publicOrEntryPoints(symbols: ChangedSymbol[]): ChangedSymbol[] {
    return symbols.filter((s) => s.publicContract || s.entryPoint);
  }
}

function toReviewVisibility(
  visibility: SymbolIndex["visibility"],
): ChangedSymbol["visibility"] {
  switch (visibility) {
    case "public":
      return "public";
    case "protected":
      return "public";
    case "package":
      return "internal";
    case "private":
    case "local":
      return "private";
    default:
      return "internal";
  }
}

function deriveChangeType(file: ChangedFile, symbol: SymbolIndex): ChangedSymbol["changeType"] {
  if (file.changeType === "deleted") return "removed";
  if (file.changeType === "added") return "added";
  if (file.changeType === "renamed") return "modified";

  const hasRangeOverlap = file.changedRanges?.some((range) => {
    const start =
      range.startLine ?? range.oldStartLine ?? range.newStartLine ?? symbol.range.startLine;
    const end =
      range.endLine ?? range.oldEndLine ?? range.newEndLine ?? symbol.range.endLine;
    return !(end < symbol.range.startLine || start > symbol.range.endLine);
  });

  if (!hasRangeOverlap) return "modified";

  const signatureRange = file.changedRanges?.some(
    (range) =>
      (range.newStartLine ?? range.oldStartLine ?? 0) === symbol.range.startLine,
  );
  return signatureRange ? "signature-changed" : "modified";
}

function hash(value: unknown): string {
  return `sha256:${createHash("sha256").update(JSON.stringify(value)).digest("hex")}`;
}
