import * as vscode from "vscode";
import type { SourceRange } from "../../shared/contracts/intelligence";

export interface ExtractedSymbolFact {
  name: string;
  qualifiedName: string;
  type: string;
  signature?: string;
  range: SourceRange;
}

export interface SymbolExtractionResult {
  language: string;
  extractorId: string;
  extractorVersion: string;
  available: boolean;
  symbols: ExtractedSymbolFact[];
}

export interface LanguageServiceAdapter {
  extractSymbols(uri: string): Promise<SymbolExtractionResult>;
}

export class VsCodeLanguageServiceAdapter implements LanguageServiceAdapter {
  async extractSymbols(uri: string): Promise<SymbolExtractionResult> {
    const document = await vscode.workspace.openTextDocument(vscode.Uri.parse(uri));
    const raw = await vscode.commands.executeCommand<Array<vscode.DocumentSymbol | vscode.SymbolInformation> | undefined>(
      "vscode.executeDocumentSymbolProvider",
      document.uri
    );
    return {
      language: document.languageId || "unknown",
      extractorId: "vscode.document-symbol-provider",
      extractorVersion: vscode.version,
      available: raw !== undefined,
      symbols: await normalizeSymbols(raw ?? [])
    };
  }
}

async function normalizeSymbols(raw: Array<vscode.DocumentSymbol | vscode.SymbolInformation>): Promise<ExtractedSymbolFact[]> {
  const output: ExtractedSymbolFact[] = [];
  const pending = raw.map((symbol) => ({ symbol, parents: [] as string[] }));
  let visited = 0;
  while (pending.length > 0) {
    const current = pending.pop();
    if (!current) continue;
    const { symbol, parents } = current;
    if (isDocumentSymbol(symbol)) {
      const qualifiedName = [...parents, symbol.name].join(".");
      const signature = symbol.detail.trim() || undefined;
      output.push({ name: symbol.name, qualifiedName, type: mapSymbolKind(symbol.kind), ...(signature ? { signature } : {}), range: toRange(symbol.selectionRange) });
      for (let index = symbol.children.length - 1; index >= 0; index--) {
        const child = symbol.children[index];
        if (child) pending.push({ symbol: child, parents: [...parents, symbol.name] });
      }
    }
    else {
      const parent = symbol.containerName.trim();
      output.push({
        name: symbol.name,
        qualifiedName: parent ? `${parent}.${symbol.name}` : symbol.name,
        type: mapSymbolKind(symbol.kind),
        range: toRange(symbol.location.range)
      });
    }
    visited += 1;
    if (visited % 200 === 0) await new Promise<void>((resolve) => setImmediate(resolve));
  }
  return output;
}

function isDocumentSymbol(symbol: vscode.DocumentSymbol | vscode.SymbolInformation): symbol is vscode.DocumentSymbol {
  return "children" in symbol && "selectionRange" in symbol;
}

function toRange(range: vscode.Range): SourceRange {
  return {
    startLine: range.start.line,
    startColumn: range.start.character,
    endLine: range.end.line,
    endColumn: range.end.character
  };
}

function mapSymbolKind(kind: vscode.SymbolKind): string {
  const names: Partial<Record<vscode.SymbolKind, string>> = {
    [vscode.SymbolKind.File]: "keystone.core.FileSymbol",
    [vscode.SymbolKind.Module]: "keystone.core.Module",
    [vscode.SymbolKind.Namespace]: "keystone.core.Namespace",
    [vscode.SymbolKind.Package]: "keystone.core.Package",
    [vscode.SymbolKind.Class]: "keystone.core.Class",
    [vscode.SymbolKind.Method]: "keystone.core.Method",
    [vscode.SymbolKind.Property]: "keystone.core.Property",
    [vscode.SymbolKind.Field]: "keystone.core.Field",
    [vscode.SymbolKind.Constructor]: "keystone.core.Constructor",
    [vscode.SymbolKind.Enum]: "keystone.core.Enum",
    [vscode.SymbolKind.Interface]: "keystone.core.Interface",
    [vscode.SymbolKind.Function]: "keystone.core.Function",
    [vscode.SymbolKind.Variable]: "keystone.core.Variable",
    [vscode.SymbolKind.Constant]: "keystone.core.Constant",
    [vscode.SymbolKind.String]: "keystone.core.String",
    [vscode.SymbolKind.Number]: "keystone.core.Number",
    [vscode.SymbolKind.Boolean]: "keystone.core.Boolean",
    [vscode.SymbolKind.Array]: "keystone.core.Array",
    [vscode.SymbolKind.Object]: "keystone.core.Object",
    [vscode.SymbolKind.Key]: "keystone.core.Key",
    [vscode.SymbolKind.Null]: "keystone.core.Null",
    [vscode.SymbolKind.EnumMember]: "keystone.core.EnumMember",
    [vscode.SymbolKind.Struct]: "keystone.core.Struct",
    [vscode.SymbolKind.Event]: "keystone.core.Event",
    [vscode.SymbolKind.Operator]: "keystone.core.Operator",
    [vscode.SymbolKind.TypeParameter]: "keystone.core.TypeParameter"
  };
  return names[kind] ?? "keystone.core.Symbol";
}
