// ExportedSymbolsService.ts
// Provides read‑only listing of exported symbols from a file or across the graph.

import type { IntelligenceSnapshotReader } from "../../persistence/IntelligenceStore";
import type { IntelligenceSymbolRecord } from "../../../shared/contracts/intelligence";

export interface ExportedSymbol {
  id: string;
  type: string;
  name: string;
  qualifiedName: string;
  relativePath: string;
  visibility: string | undefined;
  exported: boolean;
  defaultExport: boolean;
  static: boolean;
  async: boolean;
  abstract: boolean;
  returnType: string | undefined;
  parameters: Array<{ name: string; type?: string }>;
  confidence: number;
}

export interface ExportedSymbolsResult {
  generation: number;
  fileId: string;
  filePath: string;
  exported: ExportedSymbol[];
  defaultExports: ExportedSymbol[];
  total: number;
}

export class ExportedSymbolsService {
  constructor(private readonly store: IntelligenceSnapshotReader) {}

  async listFileExports(
    fileId: string,
    signal?: AbortSignal,
  ): Promise<ExportedSymbolsResult> {
    const snapshot = this.store.getSnapshot();
    if (!snapshot) {
      throw new Error("Intelligence snapshot unavailable.");
    }
    const file = snapshot.files.find((f) => f.id === fileId);
    if (!file) {
      throw new Error(`File ${fileId} not found in snapshot.`);
    }

    const exported: ExportedSymbol[] = [];
    const defaultExports: ExportedSymbol[] = [];

    for (let index = 0; index < snapshot.symbols.length; index++) {
      const symbol = snapshot.symbols[index];
      if (!symbol) continue;
      if ((index + 1) % 500 === 0) {
        if (signal?.aborted) {
          const error = new Error("Cancelled.");
          error.name = "AbortError";
          throw error;
        }
        await new Promise<void>((resolve) => setImmediate(resolve));
      }
      if (symbol.fileId !== fileId) continue;
      if (!symbol.exported && !symbol.defaultExport) continue;

      exported.push(toExportedSymbol(symbol));
      if (symbol.defaultExport) {
        defaultExports.push(toExportedSymbol(symbol));
      }
    }

    exported.sort((a, b) =>
      a.qualifiedName.localeCompare(b.qualifiedName),
    );
    defaultExports.sort((a, b) =>
      a.qualifiedName.localeCompare(b.qualifiedName),
    );

    return {
      generation: snapshot.manifest.generation,
      fileId,
      filePath: file.relativePath,
      exported,
      defaultExports,
      total: exported.length,
    };
  }

  async listAllExported(
    signal?: AbortSignal,
  ): Promise<Array<{ fileId: string; filePath: string; exported: ExportedSymbol[] }>> {
    const snapshot = this.store.getSnapshot();
    if (!snapshot) {
      throw new Error("Intelligence snapshot unavailable.");
    }

    const fileExports = new Map<string, ExportedSymbol[]>();

    for (let index = 0; index < snapshot.symbols.length; index++) {
      const symbol = snapshot.symbols[index];
      if (!symbol) continue;
      if ((index + 1) % 500 === 0) {
        if (signal?.aborted) {
          const error = new Error("Cancelled.");
          error.name = "AbortError";
          throw error;
        }
        await new Promise<void>((resolve) => setImmediate(resolve));
      }
      if (!symbol.exported && !symbol.defaultExport) continue;

      const file = snapshot.files.find((f) => f.id === symbol.fileId);
      if (!file) continue;

      const list = fileExports.get(file.id) ?? [];
      list.push(toExportedSymbol(symbol));
      fileExports.set(file.id, list);
    }

    const result: Array<{ fileId: string; filePath: string; exported: ExportedSymbol[] }> = [];
    for (const [fileId, symbols] of fileExports) {
      const file = snapshot.files.find((f) => f.id === fileId);
      if (!file) continue;
      result.push({
        fileId,
        filePath: file.relativePath,
        exported: symbols.sort((a, b) => a.qualifiedName.localeCompare(b.qualifiedName)),
      });
    }

    result.sort((a, b) => a.filePath.localeCompare(b.filePath));
    return result;
  }
}

function toExportedSymbol(symbol: IntelligenceSymbolRecord): ExportedSymbol {
  return {
    id: symbol.id,
    type: symbol.type,
    name: symbol.name,
    qualifiedName: symbol.qualifiedName,
    relativePath: "",
    visibility: symbol.visibility,
    exported: symbol.exported ?? false,
    defaultExport: symbol.defaultExport ?? false,
    static: symbol.static ?? false,
    async: symbol.async ?? false,
    abstract: symbol.abstract ?? false,
    returnType: symbol.returnType,
    parameters: symbol.parameters?.map((p) => ({ name: p.name, type: p.type })) ?? [],
    confidence: symbol.confidence,
  };
}
