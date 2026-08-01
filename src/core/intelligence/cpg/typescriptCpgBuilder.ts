import { createHash } from 'node:crypto';
import path from 'node:path';
import ts from 'typescript';

import type { CodePropertyGraph, CpgEdge, CpgLocation, CpgNode } from './types';

export interface TypeScriptCpgInput {
  readonly sourcePath: string;
  readonly content: string;
  readonly resolveOkfId?: (location: CpgLocation, name?: string) => string | undefined;
}

/**
 * Phase-one CPG frontend for TypeScript and JavaScript.
 *
 * It deliberately advertises only the semantics it actually computes. Later
 * phases can add CFG/DFG/CDG edges without changing the graph envelope.
 */
export function buildTypeScriptCpg(input: TypeScriptCpgInput): CodePropertyGraph {
  const normalizedPath = input.sourcePath.split(path.sep).join('/');
  const language = isJavaScript(input.sourcePath) ? 'javascript' : 'typescript';
  const sourceFile = ts.createSourceFile(
    normalizedPath,
    input.content,
    ts.ScriptTarget.Latest,
    true,
    scriptKind(input.sourcePath)
  );
  const nodes: CpgNode[] = [];
  const edges: CpgEdge[] = [];
  const idByNode = new Map<ts.Node, string>();

  const visit = (node: ts.Node, parentId?: string): void => {
    const nodeId = stableId('cpg-node', normalizedPath, String(node.pos), String(node.end), String(node.kind));
    idByNode.set(node, nodeId);
    nodes.push({
      id: nodeId,
      kind: ts.isSourceFile(node) ? 'file' : 'syntax',
      language,
      syntaxKind: ts.SyntaxKind[node.kind],
      name: nodeName(node),
      location: locationOf(sourceFile, normalizedPath, node),
      metadata: ts.isSourceFile(node) ? { parser: 'typescript-compiler-api' } : {},
      okfId: input.resolveOkfId?.(locationOf(sourceFile, normalizedPath, node), nodeName(node))
    });
    if (parentId) edges.push(edge(parentId, nodeId, 'ast'));

    const children: ts.Node[] = [];
    node.forEachChild(child => {
      children.push(child);
    });
    for (const child of children) visit(child, nodeId);
    for (let index = 1; index < children.length; index += 1) {
      const previousId = idByNode.get(children[index - 1]);
      const nextId = idByNode.get(children[index]);
      if (previousId && nextId) {
        edges.push(edge(previousId, nextId, 'eog', { siblingIndex: index }));
      }
    }
  };

  visit(sourceFile);
  addControlFlow(sourceFile, idByNode, edges);
  addDataFlow(sourceFile, idByNode, edges);
  addControlDependence(sourceFile, idByNode, edges);
  const okfByNode = new Map(nodes.map(node => [node.id, node.okfId]));
  const linkedEdges = edges.map(item => ({ ...item, okfSourceId: okfByNode.get(item.sourceId), okfTargetId: okfByNode.get(item.targetId) }));
  return Object.freeze({
    schemaVersion: 1 as const,
    language,
    sourcePath: normalizedPath,
    contentHash: createHash('sha256').update(input.content).digest('hex'),
    capabilities: Object.freeze({
      ast: true,
      eog: true,
      cfg: true,
      dfg: true,
      cdg: true,
      typeResolution: false
    }),
    nodes: Object.freeze(nodes),
    edges: Object.freeze(linkedEdges)
  });
}

function addControlDependence(sourceFile: ts.SourceFile, ids: Map<ts.Node, string>, edges: CpgEdge[]): void {
  const connect = (controller: ts.Node, controlled: ts.Statement, branch: string): void => {
    const source = ids.get(controller);
    const statements = ts.isBlock(controlled) ? controlled.statements : [controlled];
    for (const statement of statements) {
      const target = ids.get(statement);
      if (source && target) edges.push(edge(source, target, 'cdg', { branch }));
    }
  };
  const visit = (node: ts.Node): void => {
    if (ts.isIfStatement(node)) {
      connect(node, node.thenStatement, 'true');
      if (node.elseStatement) connect(node, node.elseStatement, 'false');
    } else if (ts.isIterationStatement(node, false)) connect(node, node.statement, 'loop');
    else if (ts.isCaseClause(node) || ts.isDefaultClause(node)) {
      const source = ids.get(node.parent.parent);
      for (const statement of node.statements) {
        const target = ids.get(statement);
        if (source && target) edges.push(edge(source, target, 'cdg', { branch: ts.isDefaultClause(node) ? 'default' : 'case' }));
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(sourceFile);
}

function addControlFlow(sourceFile: ts.SourceFile, ids: Map<ts.Node, string>, edges: CpgEdge[]): void {
  const connectStatements = (statements: readonly ts.Statement[]): void => {
    for (let index = 1; index < statements.length; index += 1) {
      const source = ids.get(statements[index - 1]);
      const target = ids.get(statements[index]);
      if (source && target) edges.push(edge(source, target, 'cfg', { branch: 'next' }));
    }
  };
  const visit = (node: ts.Node): void => {
    if (ts.isSourceFile(node) || ts.isBlock(node)) connectStatements(node.statements);
    if (ts.isIfStatement(node)) {
      const source = ids.get(node);
      const thenTarget = ids.get(node.thenStatement);
      const elseTarget = node.elseStatement ? ids.get(node.elseStatement) : undefined;
      if (source && thenTarget) edges.push(edge(source, thenTarget, 'cfg', { branch: 'true' }));
      if (source && elseTarget) edges.push(edge(source, elseTarget, 'cfg', { branch: 'false' }));
    }
    if (ts.isIterationStatement(node, false)) {
      const source = ids.get(node);
      const body = ids.get(node.statement);
      if (source && body) {
        edges.push(edge(source, body, 'cfg', { branch: 'loop-body' }));
        edges.push(edge(body, source, 'cfg', { branch: 'loop-back' }));
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(sourceFile);
}

function addDataFlow(sourceFile: ts.SourceFile, ids: Map<ts.Node, string>, edges: CpgEdge[]): void {
  const definitions = new Map<string, ts.Identifier[]>();
  const declarationNames = new Set<ts.Identifier>();
  const collect = (node: ts.Node): void => {
    if (isValueDeclaration(node) && node.name && ts.isIdentifier(node.name)) {
      const items = definitions.get(node.name.text) ?? [];
      items.push(node.name);
      definitions.set(node.name.text, items);
      declarationNames.add(node.name);
    }
    ts.forEachChild(node, collect);
  };
  collect(sourceFile);
  const visit = (node: ts.Node): void => {
    if (ts.isIdentifier(node) && !declarationNames.has(node) && isValueReference(node)) {
      const candidates = definitions.get(node.text) ?? [];
      const before = candidates.filter(candidate => candidate.getStart(sourceFile) <= node.getStart(sourceFile));
      const definition = (before.length ? before : candidates).sort((a, b) => Math.abs(node.pos - a.pos) - Math.abs(node.pos - b.pos))[0];
      const source = definition ? ids.get(definition) : undefined;
      const target = ids.get(node);
      if (source && target) edges.push(edge(source, target, 'dfg', { variable: node.text, resolution: 'lexical' }));
    }
    ts.forEachChild(node, visit);
  };
  visit(sourceFile);
}

function isValueDeclaration(node: ts.Node): node is ts.Declaration & { name: ts.DeclarationName } {
  return ts.isVariableDeclaration(node) || ts.isParameter(node) || ts.isFunctionDeclaration(node) ||
    ts.isClassDeclaration(node) || ts.isMethodDeclaration(node) || ts.isPropertyDeclaration(node) ||
    ts.isImportClause(node) || ts.isImportSpecifier(node) || ts.isNamespaceImport(node);
}

function isValueReference(node: ts.Identifier): boolean {
  const parent = node.parent;
  if (ts.isPropertyAccessExpression(parent) && parent.name === node) return false;
  if (ts.isPropertyAssignment(parent) && parent.name === node) return false;
  return !ts.isTypeReferenceNode(parent) && !ts.isInterfaceDeclaration(parent) && !ts.isTypeAliasDeclaration(parent);
}

function locationOf(sourceFile: ts.SourceFile, sourcePath: string, node: ts.Node): CpgLocation {
  const startOffset = node.getStart(sourceFile, false);
  const endOffset = node.end;
  const start = sourceFile.getLineAndCharacterOfPosition(startOffset);
  const end = sourceFile.getLineAndCharacterOfPosition(endOffset);
  return {
    path: sourcePath,
    startOffset,
    endOffset,
    startLine: start.line + 1,
    startColumn: start.character + 1,
    endLine: end.line + 1,
    endColumn: end.character + 1
  };
}

function nodeName(node: ts.Node): string | undefined {
  if ('name' in node) {
    const name = (node as ts.NamedDeclaration).name;
    if (name && ts.isIdentifier(name)) return name.text;
  }
  if (ts.isIdentifier(node)) return node.text;
  if (ts.isStringLiteral(node) || ts.isNumericLiteral(node)) return node.text;
  return undefined;
}

function edge(
  sourceId: string,
  targetId: string,
  kind: CpgEdge['kind'],
  metadata: Readonly<Record<string, unknown>> = {}
): CpgEdge {
  return {
    id: stableId('cpg-edge', sourceId, kind, targetId),
    sourceId,
    targetId,
    kind,
    metadata
  };
}

function stableId(...parts: string[]): string {
  return createHash('sha256').update(parts.join('|')).digest('hex').slice(0, 24);
}

function isJavaScript(sourcePath: string): boolean {
  return /\.(?:js|jsx|mjs|cjs)$/i.test(sourcePath);
}

function scriptKind(sourcePath: string): ts.ScriptKind {
  const extension = path.extname(sourcePath).toLowerCase();
  if (extension === '.tsx') return ts.ScriptKind.TSX;
  if (extension === '.jsx') return ts.ScriptKind.JSX;
  if (isJavaScript(sourcePath)) return ts.ScriptKind.JS;
  return ts.ScriptKind.TS;
}
