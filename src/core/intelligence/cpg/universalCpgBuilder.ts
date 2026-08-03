import { createHash } from "node:crypto";
import path from "node:path";
import { analyzeLanguageFile } from "../languages/languageAnalysis";
import type { CodePropertyGraph, CpgEdge, CpgLocation, CpgNode } from "./types";

export interface UniversalCpgInput {
  readonly sourcePath: string;
  readonly content: string;
  readonly language: string;
  readonly resolveOkfId?: (location: CpgLocation, name?: string) => string | undefined;
}

/**
 * Parser-independent structural CPG frontend used for every text artifact that
 * does not have a stronger native frontend. It is deterministic and deliberately
 * records its non-compiler semantics in graph metadata.
 */
export function buildUniversalCpg(input: UniversalCpgInput): CodePropertyGraph {
  const sourcePath = input.sourcePath.split(path.sep).join("/");
  const lines = splitLines(input.content);
  const analysis = analyzeLanguageFile(sourcePath, input.content);
  const fileLocation = location(
    sourcePath,
    0,
    input.content.length,
    1,
    1,
    Math.max(lines.length, 1),
    (lines.at(-1)?.text.length ?? 0) + 1
  );
  const fileId = stableId("cpg-file", sourcePath);
  const fileNode: CpgNode = {
    id: fileId,
    kind: "file",
    language: input.language,
    syntaxKind: "SourceArtifact",
    location: fileLocation,
    metadata: {
      parser: analysis.syntaxTree.parser,
      deterministic: true,
      diagnostics: analysis.syntaxTree.diagnostics
    },
    okfId: input.resolveOkfId?.(fileLocation)
  };
  const nodes: CpgNode[] = [fileNode];
  const edges: CpgEdge[] = [];
  const syntaxById = new Map<string, CpgNode>();
  const syntaxByLine = new Map<number, CpgNode[]>();

  for (const syntax of analysis.syntaxTree.nodes) {
    const start = lines[syntax.startLine - 1]?.start ?? 0;
    const end = lines[syntax.endLine - 1]?.end ?? start;
    const loc = location(
      sourcePath,
      start,
      end,
      syntax.startLine,
      syntax.startColumn,
      syntax.endLine,
      syntax.endColumn
    );
    const relatedSymbols = analysis.symbols.filter(
      (symbol) => symbol.line >= syntax.startLine && symbol.line <= syntax.endLine
    );
    const name = syntax.name ?? relatedSymbols[0]?.name;
    const node: CpgNode = {
      id: stableId("cpg-structural", sourcePath, syntax.id),
      kind: syntax.kind === "declaration" ? "declaration" : "syntax",
      language: input.language,
      syntaxKind: structuralKind(syntax.kind),
      name,
      location: loc,
      metadata: {
        parser: analysis.syntaxTree.parser,
        structuralKind: syntax.kind,
        text: syntax.text,
        depth: syntax.depth,
        symbolKinds: relatedSymbols.map((symbol) => symbol.kind)
      },
      okfId: input.resolveOkfId?.(loc, name)
    };
    nodes.push(node);
    syntaxById.set(syntax.id, node);
    syntaxByLine.set(syntax.startLine, [...(syntaxByLine.get(syntax.startLine) ?? []), node]);
  }

  for (const syntax of analysis.syntaxTree.nodes) {
    const child = syntaxById.get(syntax.id)!;
    const parent =
      syntax.parentId === analysis.syntaxTree.rootId
        ? fileNode
        : (syntaxById.get(syntax.parentId) ?? fileNode);
    edges.push(edge(parent.id, child.id, "ast", { depth: syntax.depth }));
  }

  const ordered = analysis.syntaxTree.nodes.map((item) => syntaxById.get(item.id)!).filter(Boolean);
  for (let index = 1; index < ordered.length; index += 1) {
    edges.push(edge(ordered[index - 1].id, ordered[index].id, "eog", { order: index }));
    if (!["ReturnStatement", "ThrowStatement"].includes(ordered[index - 1].syntaxKind))
      edges.push(edge(ordered[index - 1].id, ordered[index].id, "cfg", { branch: "next" }));
  }

  for (const flow of analysis.controlFlow) {
    const controller =
      syntaxByLine.get(flow.line)?.find((node) => node.syntaxKind === "ControlStatement") ??
      syntaxByLine.get(flow.line)?.[0];
    if (!controller) continue;
    const controlled =
      ordered.find(
        (node) =>
          node.location.startLine > flow.line &&
          Number(node.metadata.depth ?? 0) > Number(controller.metadata.depth ?? 0)
      ) ?? ordered.find((node) => node.location.startLine > flow.line);
    if (controlled) {
      edges.push(edge(controller.id, controlled.id, "cdg", { branch: flow.kind }));
      edges.push(edge(controller.id, controlled.id, "cfg", { branch: flow.kind }));
    }
    const fallthrough = controlled
      ? ordered.find(
          (node) =>
            node.location.startLine > controlled.location.endLine &&
            Number(node.metadata.depth ?? 0) <= Number(controller.metadata.depth ?? 0)
        )
      : undefined;
    if (fallthrough)
      edges.push(edge(controller.id, fallthrough.id, "cfg", { branch: "fallthrough" }));
  }

  for (const flow of analysis.dataFlow) {
    const target = syntaxByLine.get(flow.line)?.[0];
    if (!target) continue;
    const source = [...ordered]
      .reverse()
      .find(
        (node) =>
          node.location.startLine <= flow.line &&
          wordPresent(String(node.metadata.text ?? ""), flow.source)
      );
    if (source && source.id !== target.id)
      edges.push(edge(source.id, target.id, "dfg", { source: flow.source, target: flow.target }));
    else
      edges.push(
        edge(fileId, target.id, "dfg", {
          source: flow.source,
          target: flow.target,
          unresolvedSource: true
        })
      );
  }

  for (const call of analysis.calls) {
    const callNode =
      syntaxByLine.get(call.line)?.find((node) => node.syntaxKind === "CallExpression") ??
      syntaxByLine.get(call.line)?.[0];
    if (!callNode) continue;
    const declaration = [...nodes]
      .reverse()
      .find((node) => node.name === call.callee.split(".").at(-1) && node.kind === "declaration");
    if (declaration)
      edges.push(
        edge(callNode.id, declaration.id, "call", { caller: call.caller, callee: call.callee })
      );
  }

  const okfByNode = new Map(nodes.map((node) => [node.id, node.okfId]));
  return Object.freeze({
    schemaVersion: 1 as const,
    language: input.language,
    sourcePath,
    contentHash: createHash("sha256").update(input.content).digest("hex"),
    capabilities: Object.freeze({
      analysisLevel: "structural" as const,
      ast: true,
      eog: true,
      cfg: true,
      dfg: true,
      cdg: true,
      typeResolution: false
    }),
    nodes: Object.freeze(nodes),
    edges: Object.freeze(
      edges.map((item) => ({
        ...item,
        okfSourceId: okfByNode.get(item.sourceId),
        okfTargetId: okfByNode.get(item.targetId)
      }))
    )
  });
}

function structuralKind(kind: string): string {
  const mapping: Record<string, string> = {
    declaration: "Declaration",
    import: "ImportDeclaration",
    control: "ControlStatement",
    assignment: "AssignmentExpression",
    call: "CallExpression",
    return: "ReturnStatement",
    schema: "SchemaDeclaration",
    markup: "MarkupElement",
    configuration: "ConfigurationEntry",
    directive: "Directive",
    statement: "Statement",
    document: "SourceArtifact"
  };
  return mapping[kind] ?? "Statement";
}

interface LineRecord {
  readonly line: number;
  readonly text: string;
  readonly start: number;
  readonly end: number;
}
function splitLines(content: string): LineRecord[] {
  const out: LineRecord[] = [];
  let offset = 0;
  const raw = content.split(/\r?\n/);
  raw.forEach((text, index) => {
    out.push({ line: index + 1, text, start: offset, end: offset + text.length });
    offset += text.length + 1;
  });
  return out;
}
function classifyLine(
  text: string,
  line: number,
  analysis: ReturnType<typeof analyzeLanguageFile>
): string {
  if (analysis?.symbols.some((symbol) => symbol.line === line)) return "Declaration";
  if (analysis?.dependencies.some((edge) => edge.from && dependencyLine(text)))
    return "ImportOrDependency";
  if (analysis?.controlFlow.some((flow) => flow.line === line)) return "ControlFlow";
  if (analysis?.dataFlow.some((flow) => flow.line === line)) return "Assignment";
  if (analysis?.calls.some((call) => call.line === line)) return "Call";
  if (/^\s*[<{[]/.test(text) || /:\s*(?:[^,]+),?\s*$/.test(text)) return "StructuredData";
  if (/^\s*#/.test(text)) return "Directive";
  return "Statement";
}
function dependencyLine(text: string): boolean {
  return /\b(import|from|require|include|using|use|source)\b|^\s*[-\w.]+\s*[:=]/.test(text);
}
function isCommentOnly(text: string, language: string): boolean {
  const trimmed = text.trim();
  if (!trimmed) return true;
  if (
    [
      "python",
      "ruby",
      "shell",
      "powershell",
      "r",
      "perl",
      "yaml",
      "toml",
      "make",
      "dockerfile"
    ].includes(language)
  )
    return trimmed.startsWith("#");
  if (language === "sql") return trimmed.startsWith("--");
  if (language === "html" || language === "xml" || language === "markdown")
    return /^<!--/.test(trimmed);
  return trimmed.startsWith("//") || trimmed.startsWith("/*") || trimmed.startsWith("*");
}
function indentation(text: string): number {
  return text.match(/^\s*/)?.[0].replace(/\t/g, "  ").length ?? 0;
}
function wordPresent(text: string, word: string): boolean {
  return new RegExp(`\\b${escapeRegExp(word)}\\b`).test(text);
}
function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
function location(
  sourcePath: string,
  startOffset: number,
  endOffset: number,
  startLine: number,
  startColumn: number,
  endLine: number,
  endColumn: number
): CpgLocation {
  return { path: sourcePath, startOffset, endOffset, startLine, startColumn, endLine, endColumn };
}
function edge(
  sourceId: string,
  targetId: string,
  kind: CpgEdge["kind"],
  metadata: Record<string, unknown>
): CpgEdge {
  return {
    id: stableId("cpg-edge", sourceId, targetId, kind, JSON.stringify(metadata)),
    sourceId,
    targetId,
    kind,
    metadata
  };
}
function stableId(...parts: string[]): string {
  return createHash("sha256").update(parts.join("\0")).digest("hex");
}
