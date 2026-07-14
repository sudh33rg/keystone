import * as vscode from "vscode";

export interface SymbolInfo {
  name: string;
  kind: vscode.SymbolKind;
  location: vscode.Location;
  containerName: string;
}

export interface LanguageServiceAdapter {
  getDocumentSymbols(document: vscode.TextDocument): Promise<vscode.SymbolInformation[]>;
  getTypeDefinition(document: vscode.TextDocument, position: vscode.Position): Promise<vscode.Location[]>;
  getReferences(document: vscode.TextDocument, position: vscode.Position): Promise<vscode.Location[]>;
  getImplementations(document: vscode.TextDocument, position: vscode.Position): Promise<vscode.Location[]>;
  getHover(document: vscode.TextDocument, position: vscode.Position): Promise<vscode.Hover | null>;
  getDocumentHighlights(document: vscode.TextDocument, position: vscode.Position): Promise<vscode.DocumentHighlight[]>;
  getWorkspaceSymbols(query: string): Promise<vscode.SymbolInformation[]>;
  getLanguageForDocument(document: vscode.TextDocument): string;
}

export class VsCodeLanguageServiceAdapter implements LanguageServiceAdapter {
  async getDocumentSymbols(document: vscode.TextDocument): Promise<vscode.SymbolInformation[]> {
    return vscode.commands.executeCommand<vscode.SymbolInformation[]>("vscode.executeDocumentSymbolProvider", document.uri);
  }

  async getTypeDefinition(document: vscode.TextDocument, position: vscode.Position): Promise<vscode.Location[]> {
    return vscode.commands.executeCommand<vscode.Location[]>("vscode.executeTypeDefinitionProvider", document.uri, position);
  }

  async getReferences(document: vscode.TextDocument, position: vscode.Position): Promise<vscode.Location[]> {
    return vscode.commands.executeCommand<vscode.Location[]>("vscode.executeReferenceProvider", document.uri, position);
  }

  async getImplementations(document: vscode.TextDocument, position: vscode.Position): Promise<vscode.Location[]> {
    return vscode.commands.executeCommand<vscode.Location[]>("vscode.executeImplementationProvider", document.uri, position);
  }

  async getHover(document: vscode.TextDocument, position: vscode.Position): Promise<vscode.Hover | null> {
    const hovers = await vscode.commands.executeCommand<vscode.Hover[]>("vscode.executeHoverProvider", document.uri, position);
    return hovers?.[0] ?? null;
  }

  async getDocumentHighlights(document: vscode.TextDocument, position: vscode.Position): Promise<vscode.DocumentHighlight[]> {
    return vscode.commands.executeCommand<vscode.DocumentHighlight[]>("vscode.executeDocumentHighlightProvider", document.uri, position);
  }

  async getWorkspaceSymbols(query: string): Promise<vscode.SymbolInformation[]> {
    return vscode.commands.executeCommand<vscode.SymbolInformation[]>("vscode.executeWorkspaceSymbolProvider", query);
  }

  getLanguageForDocument(document: vscode.TextDocument): string {
    return document.languageId;
  }
}
