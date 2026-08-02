import path from "node:path";
import * as vscode from "vscode";
import type { CodeSymbol, EvidenceMetadata, SemanticCall } from "@core/domain/types";
import type {
  SemanticEnrichmentProvider,
  SemanticEnrichmentRequest,
  SemanticEnrichmentResult
} from "@core/intelligence/languages/semanticEnrichment";

/**
 * Uses whatever language service is active in VS Code for the document. This
 * makes semantic enrichment language-neutral: built-in and installed language
 * extensions can contribute symbols, definitions, references, implementations,
 * and call hierarchy without Keystone embedding every compiler.
 */
export class VscodeLanguageServiceEnricher implements SemanticEnrichmentProvider {
  async enrich(request: SemanticEnrichmentRequest): Promise<SemanticEnrichmentResult | undefined> {
    request.signal?.throwIfAborted();
    const uri = vscode.Uri.file(request.absolutePath);
    const document = await vscode.workspace.openTextDocument(uri);
    request.signal?.throwIfAborted();

    const rawSymbols =
      (await vscode.commands.executeCommand<unknown[]>(
        "vscode.executeDocumentSymbolProvider",
        uri
      )) ?? [];
    const flattened = flattenSymbols(rawSymbols, request.relativePath, document.languageId);
    if (!flattened.length) {
      return {
        provider: "vscode-language-service",
        providerLanguageId: document.languageId,
        capabilities: {
          documentSymbols: false,
          definitions: false,
          references: false,
          implementations: false,
          callHierarchy: false
        },
        symbols: [],
        warnings: ["No document-symbol provider returned semantic symbols for this file."]
      };
    }

    let definitions = false;
    let references = false;
    let implementations = false;
    let callHierarchy = false;
    let referenceCount = 0;
    const calls: SemanticCall[] = [];
    const warnings: string[] = [];

    for (const item of flattened) {
      request.signal?.throwIfAborted();
      const position = new vscode.Position(
        Math.max(item.line - 1, 0),
        Math.max(item.column - 1, 0)
      );
      try {
        const result =
          (await vscode.commands.executeCommand<unknown[]>(
            "vscode.executeDefinitionProvider",
            uri,
            position
          )) ?? [];
        definitions ||= result.length > 0;
      } catch (error) {
        warnings.push(`Definition provider failed at ${item.line}: ${message(error)}`);
      }
      try {
        const result =
          (await vscode.commands.executeCommand<unknown[]>(
            "vscode.executeReferenceProvider",
            uri,
            position
          )) ?? [];
        references ||= result.length > 0;
        referenceCount += result.length;
      } catch (error) {
        warnings.push(`Reference provider failed at ${item.line}: ${message(error)}`);
      }
      try {
        const result =
          (await vscode.commands.executeCommand<unknown[]>(
            "vscode.executeImplementationProvider",
            uri,
            position
          )) ?? [];
        implementations ||= result.length > 0;
      } catch (error) {
        warnings.push(`Implementation provider failed at ${item.line}: ${message(error)}`);
      }
      if (item.symbol.kind === "function" || item.symbol.kind === "method") {
        try {
          const prepared =
            (await vscode.commands.executeCommand<unknown[]>(
              "vscode.prepareCallHierarchy",
              uri,
              position
            )) ?? [];
          for (const hierarchyItem of prepared) {
            const outgoing =
              (await vscode.commands.executeCommand<any[]>(
                "vscode.provideOutgoingCalls",
                hierarchyItem
              )) ?? [];
            if (outgoing.length) callHierarchy = true;
            for (const outgoingCall of outgoing) {
              const target = outgoingCall?.to?.name;
              if (typeof target === "string" && target)
                calls.push({
                  filePath: request.relativePath,
                  caller: item.symbol.name,
                  callee: target,
                  line: item.line,
                  evidence: semanticEvidence(request.relativePath, item.line, document.languageId)
                });
            }
          }
        } catch (error) {
          warnings.push(`Call hierarchy provider failed at ${item.line}: ${message(error)}`);
        }
      }
      await new Promise<void>((resolve) => setImmediate(resolve));
    }

    return {
      provider: "vscode-language-service",
      providerLanguageId: document.languageId,
      capabilities: {
        documentSymbols: true,
        definitions,
        references,
        implementations,
        callHierarchy
      },
      symbols: flattened.map((item) => item.symbol),
      calls,
      referenceCount,
      warnings: [...new Set(warnings)].slice(0, 50)
    };
  }
}

interface FlattenedSymbol {
  readonly symbol: CodeSymbol;
  readonly line: number;
  readonly column: number;
}

export function flattenSymbols(
  values: readonly unknown[],
  relativePath: string,
  providerLanguageId = "unknown"
): FlattenedSymbol[] {
  const output: FlattenedSymbol[] = [];
  const visit = (value: any): void => {
    if (!value || typeof value !== "object") return;
    const name = typeof value.name === "string" ? value.name : undefined;
    const range = value.selectionRange ?? value.location?.range ?? value.range;
    const start = range?.start;
    if (name && typeof start?.line === "number") {
      const line = start.line + 1;
      const column = (typeof start.character === "number" ? start.character : 0) + 1;
      output.push({
        line,
        column,
        symbol: {
          name,
          kind: mapSymbolKind(value.kind),
          filePath: normalizePath(relativePath),
          line,
          exportStatus: visibility(value),
          evidence: semanticEvidence(normalizePath(relativePath), line, providerLanguageId)
        }
      });
    }
    if (Array.isArray(value.children)) for (const child of value.children) visit(child);
  };
  for (const value of values) visit(value);
  const seen = new Set<string>();
  return output.filter((item) => {
    const key = `${item.symbol.kind}:${item.symbol.name}:${item.line}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function mapSymbolKind(kind: unknown): CodeSymbol["kind"] {
  // VS Code SymbolKind: Method=5, Function=11, Class=4, Interface=10,
  // Constant=13, TypeParameter=25, Struct=22, Enum=9.
  if (kind === 5 || kind === 6) return "method";
  if (kind === 11 || kind === 12) return "function";
  if (kind === 4 || kind === 22 || kind === 9) return "class";
  if (kind === 10) return "interface";
  if (kind === 13 || kind === 14) return "constant";
  if (kind === 25 || kind === 23) return "type";
  return "unknown";
}

function visibility(value: any): CodeSymbol["exportStatus"] {
  const detail = `${value?.detail ?? ""} ${value?.containerName ?? ""}`.toLowerCase();
  if (/\b(public|export|pub)\b/.test(detail)) return "exported";
  if (/\b(private|protected|internal|local)\b/.test(detail)) return "local";
  return "unknown";
}

function semanticEvidence(filePath: string, line: number, languageId: string): EvidenceMetadata {
  return {
    source: "language-service",
    confidence: 0.96,
    evidencePath: filePath,
    evidenceLine: line,
    extractorVersion: `vscode-language-service:${languageId}`
  };
}
function normalizePath(value: string): string {
  return value.split(path.sep).join("/");
}
function message(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
