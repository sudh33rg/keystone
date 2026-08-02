import { createHash } from "node:crypto";

export type StructuralNodeKind =
  | "document"
  | "declaration"
  | "import"
  | "control"
  | "assignment"
  | "call"
  | "return"
  | "schema"
  | "markup"
  | "configuration"
  | "directive"
  | "statement";

export interface StructuralSyntaxNode {
  readonly id: string;
  readonly kind: StructuralNodeKind;
  readonly text: string;
  readonly name?: string;
  readonly startLine: number;
  readonly endLine: number;
  readonly startColumn: number;
  readonly endColumn: number;
  readonly parentId: string;
  readonly depth: number;
}

export interface StructuralSyntaxTree {
  readonly parser: "keystone-structural-grammar";
  readonly languageId: string;
  readonly rootId: string;
  readonly nodes: readonly StructuralSyntaxNode[];
  readonly diagnostics: readonly string[];
}

/**
 * A deterministic, dependency-free grammar frontend for every text language.
 * It is intentionally not a compiler: it builds a stable nested statement tree,
 * respecting strings/comments, braces, indentation, XML/HTML tags, and common
 * language terminators. Language services or compiler frontends enrich this tree.
 */
export function parseStructuralSyntax(languageId: string, source: string): StructuralSyntaxTree {
  const rootId = stable("syntax-root", languageId);
  const nodes: StructuralSyntaxNode[] = [];
  const diagnostics: string[] = [];
  const lines = source.replace(/\r\n/g, "\n").split("\n");
  const stack: Array<{ id: string; indent: number; braceDepth: number; tag?: string }> = [
    { id: rootId, indent: -1, braceDepth: 0 }
  ];
  let braceDepth = 0;
  let blockComment = false;

  for (let index = 0; index < lines.length; index += 1) {
    const raw = lines[index];
    const line = index + 1;
    const cleaned = stripCommentsAndStrings(raw, languageId, blockComment);
    blockComment = cleaned.blockComment;
    const text = cleaned.text.trim();
    if (!text) continue;
    const indent = indentation(raw);
    const leadingClosers =
      countLeading(text, "}") + countLeading(text, "]") + countLeading(text, ")");
    braceDepth = Math.max(0, braceDepth - leadingClosers);
    while (stack.length > 1 && shouldClose(stack.at(-1)!, indent, braceDepth, text, languageId))
      stack.pop();
    const kind = classify(text, languageId);
    const name = extractName(text, kind, languageId);
    const parentId = stack.at(-1)!.id;
    const id = stable("syntax", languageId, String(line), kind, name ?? "", text);
    const node: StructuralSyntaxNode = {
      id,
      kind,
      text: raw.trim().slice(0, 1_000),
      name,
      startLine: line,
      endLine: line,
      startColumn: Math.max(1, raw.search(/\S/) + 1),
      endColumn: raw.length + 1,
      parentId,
      depth: stack.length - 1
    };
    nodes.push(node);

    const opens =
      countOutside(cleaned.text, "{") +
      countOutside(cleaned.text, "[") +
      countOutside(cleaned.text, "(");
    const closes = Math.max(
      0,
      countOutside(cleaned.text, "}") +
        countOutside(cleaned.text, "]") +
        countOutside(cleaned.text, ")") -
        leadingClosers
    );
    braceDepth = Math.max(0, braceDepth + opens - closes);
    const tag = openTag(text, languageId);
    if (opens > closes || opensBlock(text, kind, languageId) || tag)
      stack.push({ id, indent, braceDepth, tag });
    const closingTag = closeTag(text, languageId);
    if (closingTag) {
      const match = [...stack].reverse().findIndex((item) => item.tag === closingTag);
      if (match >= 0) stack.splice(stack.length - match - 1);
    }
  }
  if (blockComment) diagnostics.push("Unterminated block comment detected by structural frontend.");
  if (braceDepth > 0) diagnostics.push(`Unclosed structural delimiter depth: ${braceDepth}.`);
  return Object.freeze({
    parser: "keystone-structural-grammar" as const,
    languageId,
    rootId,
    nodes: Object.freeze(nodes),
    diagnostics: Object.freeze(diagnostics)
  });
}

function classify(text: string, language: string): StructuralNodeKind {
  if (
    /^(?:import|from\s+\S+\s+import|require\b|use\b|using\b|include\b|#include\b|source\b|Import-Module\b|-include\b)/i.test(
      text
    )
  )
    return "import";
  if (
    /^(?:class|interface|struct|record|enum|trait|protocol|object|module|namespace|defmodule|type\b|typedef\b|typealias\b|function\b|func\b|fn\b|def\b|sub\b|procedure\b|CREATE\s+(?:TABLE|VIEW|FUNCTION|PROCEDURE|TRIGGER)|message\b|service\b|resource\b|data\b|module\s+")/i.test(
      text
    ) ||
    looksLikeFunction(text, language)
  )
    return "declaration";
  if (
    /^(?:if|else\s+if|elif|unless|for|foreach|while|switch|case|match|when|try|catch|except|guard|select)\b/i.test(
      text
    )
  )
    return "control";
  if (/^(?:return|yield|throw|raise|break|continue)\b/i.test(text)) return "return";
  if (
    /^(?:CREATE|ALTER|DROP|SELECT|INSERT|UPDATE|DELETE|type\b|input\b|scalar\b|union\b|syntax\s*=)/i.test(
      text
    ) &&
    ["sql", "graphql", "protobuf"].includes(language)
  )
    return "schema";
  if (/^<\/?[A-Za-z][\w:.-]*/.test(text)) return "markup";
  if (
    /^(?:FROM|RUN|COPY|ADD|CMD|ENTRYPOINT|ENV|ARG|WORKDIR|EXPOSE|VOLUME|USER|HEALTHCHECK)\b/i.test(
      text
    ) ||
    (/^\w[\w.-]*\s*:\s*(?:$|[^:=])/.test(text) && ["yaml", "kubernetes", "make"].includes(language))
  )
    return "directive";
  if (
    /^[\w"'`.-]+\s*(?:=|:=|<-|=>)\s*/.test(text) ||
    /\b[A-Za-z_$][\w$]*\s*(?:=|:=|<-|\+=|-=|\*=|\/=)\s*/.test(text)
  )
    return "assignment";
  if (
    /^[\[{]/.test(text) ||
    (/^["']?[^:]+["']?\s*:\s*/.test(text) && ["json", "yaml", "toml"].includes(language))
  )
    return "configuration";
  if (
    /\b[A-Za-z_$][\w$.:!?-]*\s*\(/.test(text) ||
    (/\b[A-Za-z_$][\w$.:!?-]*\s+[A-Za-z_$][\w$]*\s*$/.test(text) &&
      ["shell", "powershell"].includes(language))
  )
    return "call";
  if (/^(?:#|@|\[|\*\s)/.test(text)) return "directive";
  return "statement";
}

function looksLikeFunction(text: string, language: string): boolean {
  if (
    [
      "java",
      "csharp",
      "c",
      "cpp",
      "objective-c",
      "swift",
      "kotlin",
      "scala",
      "dart",
      "groovy"
    ].includes(language)
  )
    return /(?:^|\s)[A-Za-z_$][\w$:<>,?\[\]*&\s]*\s+[A-Za-z_$][\w$]*\s*\([^;]*\)\s*(?:\{|=>|$)/.test(
      text
    );
  if (language === "haskell") return /^[a-z][\w']*\s+.*=/.test(text);
  if (language === "erlang") return /^[a-z][\w@]*\s*\([^)]*\)\s*->/.test(text);
  return false;
}
function extractName(text: string, kind: StructuralNodeKind, language: string): string | undefined {
  if (kind !== "declaration" && kind !== "schema") return undefined;
  const patterns = [
    /\b(?:class|interface|struct|record|enum|trait|protocol|object|module|namespace|defmodule|message|service)\s+([A-Za-z_$][\w$]*)/i,
    /\b(?:function|func|fn|def|sub|procedure)\s+([A-Za-z_$][\w$!?=-]*)/i,
    /\bCREATE\s+(?:OR\s+REPLACE\s+)?(?:TABLE|VIEW|FUNCTION|PROCEDURE|TRIGGER)\s+(?:IF\s+NOT\s+EXISTS\s+)?["`[]?([\w.]+)/i,
    /\b(?:type|input|scalar|union|typedef|typealias)\s+([A-Za-z_$][\w$]*)/i
  ];
  for (const pattern of patterns) {
    const match = text.match(pattern);
    if (match?.[1]) return match[1];
  }
  if (looksLikeFunction(text, language))
    return (
      text.match(/([A-Za-z_$][\w$]*)\s*\([^)]*\)/)?.[1] ?? text.match(/^([a-z][\w']*)\s+/)?.[1]
    );
  return undefined;
}
function opensBlock(text: string, kind: StructuralNodeKind, language: string): boolean {
  if (kind === "declaration" || kind === "control") {
    if (
      [
        "python",
        "ruby",
        "haskell",
        "r",
        "julia",
        "elixir",
        "erlang",
        "shell",
        "powershell",
        "lua"
      ].includes(language)
    )
      return /(?:[:]|\b(?:do|then|begin)\b|->)\s*$/.test(text) || kind === "declaration";
  }
  return false;
}
function shouldClose(
  top: { indent: number; braceDepth: number; tag?: string },
  indent: number,
  braceDepth: number,
  text: string,
  language: string
): boolean {
  if (top.tag) return false;
  if (braceDepth < top.braceDepth) return true;
  if (
    indent <= top.indent &&
    usesIndentation(language) &&
    !/^(?:else|elif|except|catch|finally|when|case)\b/.test(text)
  )
    return true;
  if (/^(?:end|fi|done|esac|endfunction|endif|endfor|endforeach|endwhile)\b/i.test(text))
    return true;
  return false;
}
function usesIndentation(language: string): boolean {
  return [
    "python",
    "ruby",
    "haskell",
    "r",
    "julia",
    "elixir",
    "shell",
    "powershell",
    "lua",
    "yaml",
    "make"
  ].includes(language);
}
function openTag(text: string, language: string): string | undefined {
  if (!["html", "xml", "markdown"].includes(language)) return undefined;
  const match = text.match(/^<([A-Za-z][\w:.-]*)\b[^>]*?(?<!\/)>(?!.*<\/\1>)/);
  return match?.[1];
}
function closeTag(text: string, language: string): string | undefined {
  if (!["html", "xml", "markdown"].includes(language)) return undefined;
  return text.match(/^<\/([A-Za-z][\w:.-]*)\s*>/)?.[1];
}
function indentation(value: string): number {
  return value.match(/^\s*/)?.[0].replace(/\t/g, "  ").length ?? 0;
}
function countLeading(value: string, character: string): number {
  let count = 0;
  for (const item of value) {
    if (item === character) count += 1;
    else if (!/\s/.test(item)) break;
  }
  return count;
}
function countOutside(value: string, character: string): number {
  return [...value].filter((item) => item === character).length;
}
function stripCommentsAndStrings(
  line: string,
  language: string,
  startsInBlock: boolean
): { text: string; blockComment: boolean } {
  let block = startsInBlock;
  let quote: string | undefined;
  let escaped = false;
  let output = "";
  for (let index = 0; index < line.length; index += 1) {
    const current = line[index];
    const next = line[index + 1];
    if (block) {
      if (current === "*" && next === "/") {
        block = false;
        output += "  ";
        index += 1;
      } else output += " ";
      continue;
    }
    if (quote) {
      output += " ";
      if (escaped) escaped = false;
      else if (current === "\\") escaped = true;
      else if (current === quote) quote = undefined;
      continue;
    }
    if (current === '"' || current === "'" || current === "`") {
      quote = current;
      output += " ";
      continue;
    }
    if (current === "/" && next === "*") {
      block = true;
      output += "  ";
      index += 1;
      continue;
    }
    if (current === "/" && next === "/") {
      output += " ".repeat(line.length - index);
      break;
    }
    if (current === "-" && next === "-" && language === "sql") {
      output += " ".repeat(line.length - index);
      break;
    }
    if (
      current === "#" &&
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
      ].includes(language) &&
      !line.slice(0, index).trim()
    ) {
      output += " ".repeat(line.length - index);
      break;
    }
    output += current;
  }
  return { text: output, blockComment: block };
}
function stable(...parts: string[]): string {
  return createHash("sha256").update(parts.join("\0")).digest("hex");
}
