import crypto from "node:crypto";

import type {
  ContextCompressionEvidence,
  ContextCompressionMetadata,
  ContextDiagnostic,
  ContextLogEntry
} from "./contextEngine";

export type SignalKind = "git-status" | "git-diff" | "git-log" | "build" | "diagnostics" | "search" | "directory" | "structured" | "generic";

export interface SignalCompressionResult {
  readonly content: string;
  readonly metadata: ContextCompressionMetadata;
  readonly original: string;
}

export interface SignalInput {
  readonly kind: SignalKind;
  readonly value: unknown;
  readonly tokenBudget?: number;
  readonly command?: string;
}

const bytes = (value: string): number => Buffer.byteLength(value, "utf8");
const hash = (value: string): string => crypto.createHash("sha256").update(value).digest("hex");

export class SignalCompressor {
  readonly git = new GitOutputReducer();
  readonly build = new BuildOutputReducer();
  readonly diagnostics = new DiagnosticReducer();
  readonly structured = new StructuredDataReducer();
  readonly search = new SearchOutputReducer();
  readonly directory = new DirectoryOutputReducer();
  readonly generic = new GenericOutputReducer();

  compress(input: SignalInput): SignalCompressionResult {
    switch (input.kind) {
      case "git-status":
      case "git-diff":
      case "git-log":
        return this.git.reduce(input.value, input.kind, input.tokenBudget);
      case "build":
        return this.build.reduce(input.value, input.tokenBudget, input.command);
      case "diagnostics":
        return this.diagnostics.reduce(input.value, input.tokenBudget);
      case "structured":
        return this.structured.reduce(input.value, input.tokenBudget);
      case "search":
        return this.search.reduce(input.value, input.tokenBudget);
      case "directory":
        return this.directory.reduce(input.value, input.tokenBudget);
      default:
        if (input.command && /(?:rg|grep|find|search)/i.test(input.command)) return this.search.reduce(input.value, input.tokenBudget);
        if (input.command && /(?:ls|tree|dir)/i.test(input.command)) return this.directory.reduce(input.value, input.tokenBudget);
        return this.generic.reduce(String(input.value ?? ""), input.tokenBudget);
    }
  }
}

export class GitOutputReducer {
  reduce(value: unknown, kind: "git-status" | "git-diff" | "git-log", tokenBudget = 1_200): SignalCompressionResult {
    const original = (Array.isArray(value) ? value.join("\n") : String(value ?? "")).replace(/\r\n/g, "\n");
    const lines = original.split("\n").filter(Boolean);
    let selected: string[];
    let preserved: string[];
    if (kind === "git-status") {
      const groups = groupBy(lines, (line) => line.slice(0, 2) || "other");
      selected = [
        `Git status: ${lines.length} changed path(s)`,
        ...[...groups.entries()].map(([state, entries]) => `${state}: ${entries.length} path(s)\n${entries.slice(0, 40).join("\n")}`)
      ];
      preserved = ["branch/status state", "change counts", "changed paths", "untracked paths"];
    } else if (kind === "git-log") {
      selected = [`Git log: ${lines.length} raw line(s)`, ...unique(lines).slice(0, 80)];
      preserved = ["commit identifiers", "authors/dates", "commit subjects"];
    } else {
      const files = unique(lines.filter((line) => /^(?:diff --git|\+\+\+ b\/|--- a\/)/.test(line)));
      const exact = lines.filter((line) => /^(?:diff --git|@@|\+[^+]|-[^-])/.test(line));
      selected = [`Git diff: ${files.length} file(s); ${exact.filter((line) => line.startsWith("+")).length} additions; ${exact.filter((line) => line.startsWith("-")).length} removals`, ...files, ...exact];
      preserved = ["changed files", "hunk locations", "exact additions", "exact removals"];
    }
    return result(kind, fit(selected, tokenBudget), original, preserved, [{ label: kind }]);
  }
}

export class BuildOutputReducer {
  reduce(value: unknown, tokenBudget = 1_600, command?: string): SignalCompressionResult {
    const original = (Array.isArray(value) ? value.join("\n") : String(value ?? "")).replace(/\r\n/g, "\n");
    const lines = original.split("\n").filter(Boolean);
    const failures = lines.filter((line) => /(?:error|fatal|failed|failure|exception)\b/i.test(line));
    const warnings = lines.filter((line) => /warning\b/i.test(line));
    const outcomes = lines.filter((line) => /(?:exit(?:ed)?|success|passed|completed|failed)\b/i.test(line));
    const uniqueErrors = uniqueBy(failures, normalizeDiagnosticLine);
    const uniqueWarnings = uniqueBy(warnings, normalizeDiagnosticLine);
    const content = fit([
      `Build outcome: ${outcomes.at(-1) ?? (failures.length ? "failed" : "completed")}${command ? ` · ${command}` : ""}`,
      `Root errors: ${uniqueErrors.length}; important warnings: ${uniqueWarnings.length}; raw lines: ${lines.length}`,
      "Errors:", ...uniqueErrors,
      ...(uniqueWarnings.length ? ["Warnings:", ...uniqueWarnings] : []),
      ...(outcomes.length ? ["Outcome signals:", ...unique(outcomes).slice(-4)] : [])
    ], tokenBudget);
    return result("build", content, original, ["command outcome", "root errors", "exact error codes", "source locations", "relevant messages", "distinct warnings"], uniqueErrors.map((line) => ({ label: line })));
  }
}

export class DiagnosticReducer {
  reduce(value: unknown, tokenBudget = 1_400): SignalCompressionResult {
    if (Array.isArray(value) && value.every((item) => isDiagnostic(item))) {
      const entries = value as Array<ContextDiagnostic | ContextLogEntry>;
      const groups = new Map<string, { entry: ContextDiagnostic | ContextLogEntry; count: number }>();
      for (const entry of entries) {
        const key = `${entry.code ?? ""}|${entry.path ?? ""}|${entry.startLine ?? ""}|${entry.message.trim()}`;
        const current = groups.get(key);
        if (current) current.count += 1;
        else groups.set(key, { entry, count: 1 });
      }
      const lines = [...groups.values()].map(({ entry, count }) => `${formatDiagnostic(entry)}; occurrences=${count}`);
      const original = JSON.stringify(value);
      return result("diagnostics", fit([`Diagnostics: ${groups.size} unique group(s); ${entries.length} raw record(s)`, ...lines], tokenBudget), original, ["exact error code", "source location", "relevant message", "severity", "duplicate count"], [...groups].map(([, item]) => ({ label: item.entry.message, ...(item.entry.path ? { path: item.entry.path } : {}) })));
    }
    return new BuildOutputReducer().reduce(value, tokenBudget);
  }
}

export class StructuredDataReducer {
  reduce(value: unknown, tokenBudget = 1_200): SignalCompressionResult {
    const original = typeof value === "string" ? value : JSON.stringify(value);
    let parsed: unknown = value;
    try { parsed = typeof value === "string" ? JSON.parse(value) : value; } catch { return result("structured", fit([String(value).replace(/\s+/g, " ")], tokenBudget), original, ["original scalar value"], []); }
    const projected = projectShape(parsed, 0);
    return result("structured", fit([JSON.stringify(projected)], tokenBudget), original, ["schema/shape", "field names", "counts", "identifiers", "numbers"], [{ label: "structured schema" }]);
  }
}

export class SearchOutputReducer {
  reduce(value: unknown, tokenBudget = 1_400): SignalCompressionResult {
    const original = (Array.isArray(value) ? value.join("\n") : String(value ?? "")).replace(/\r\n/g, "\n");
    const lines = original.split("\n").filter(Boolean);
    const groups = groupBy(lines, (line) => (line.match(/(?:^|\s)([^:\s]+\.[A-Za-z0-9]+)(?::\d+)?(?::\d+)?/)?.[1] ?? "unresolved"));
    const projected = [`Search results: ${lines.length} match(es) across ${groups.size} file group(s)`, ...[...groups.entries()].map(([file, matches]) => `${file}: ${matches.length} match(es)\n${uniqueBy(matches, normalizeSearchLine).slice(0, 12).join("\n")}`)];
    return result("search", fit(projected, tokenBudget), original, ["file grouping", "unique matches", "match categories", "symbol/location text"], [...groups.keys()].map((file) => ({ label: file })));
  }
}

export class DirectoryOutputReducer {
  reduce(value: unknown, tokenBudget = 1_000): SignalCompressionResult {
    const original = (Array.isArray(value) ? value.join("\n") : String(value ?? "")).replace(/\r\n/g, "\n");
    const paths = original.split("\n").filter(Boolean);
    const groups = groupBy(paths, (entry) => entry.split(/[\\/]/).slice(0, -1).join("/") || ".");
    const projected = [`Directory listing: ${paths.length} item(s) across ${groups.size} director(ies)`, ...[...groups.entries()].map(([directory, entries]) => `${directory}/ (${entries.length})\n${unique(entries).slice(0, 20).join("\n")}`)];
    return result("directory", fit(projected, tokenBudget), original, ["directory counts", "unique paths", "file names"], [...groups.keys()].map((directory) => ({ label: directory })));
  }
}

export class GenericOutputReducer {
  reduce(value: string, tokenBudget = 1_200): SignalCompressionResult {
    const original = value.replace(/\r\n/g, "\n");
    const lines = original.split("\n");
    const selected = uniqueBy(lines.filter((line) => line.trim()), normalizeDiagnosticLine);
    return result("generic", fit(selected, tokenBudget), original, ["unique output lines", "error/warning details", "first occurrence of repeated lines"], [{ label: "generic output" }]);
  }
}

function result(kind: SignalKind, content: string, original: string, preserved: string[], evidence: ContextCompressionEvidence[]): SignalCompressionResult {
  const reduced = bytes(content) < bytes(original) ? content : original;
  return {
    content: reduced,
    original,
    metadata: {
      type: "signal",
      strategy: `signal compressor: ${kind}`,
      deterministic: true,
      derived: reduced !== original,
      originalBytes: bytes(original),
      compressedBytes: bytes(reduced),
      originalHash: hash(original),
      evidence,
      preserved,
      originalReference: `signal://${hash(original)}`
    }
  };
}

function fit(lines: string[], tokenBudget: number): string {
  const output: string[] = [];
  for (const line of lines) {
    const next = [...output, line].join("\n");
    if (next.length > tokenBudget * 4 && output.length) break;
    output.push(line);
  }
  return output.join("\n");
}

function groupBy(values: string[], key: (value: string) => string): Map<string, string[]> {
  const groups = new Map<string, string[]>();
  for (const value of values) groups.set(key(value), [...(groups.get(key(value)) ?? []), value]);
  return groups;
}
function unique(values: string[]): string[] { return [...new Set(values)]; }
function uniqueBy(values: string[], key: (value: string) => string): string[] { const seen = new Set<string>(); return values.filter((value) => { const k = key(value); if (seen.has(k)) return false; seen.add(k); return true; }); }
function normalizeDiagnosticLine(value: string): string { return value.replace(/\d+/g, "#").replace(/\s+/g, " ").trim().toLowerCase(); }
function normalizeSearchLine(value: string): string { return value.replace(/:\d+(?::\d+)?(?=\s|$)/g, ":#").replace(/\s+/g, " ").trim().toLowerCase(); }
function formatDiagnostic(entry: ContextDiagnostic | ContextLogEntry): string { return `${entry.severity ? entry.severity.toUpperCase() + " " : ""}${entry.code !== undefined ? `[${entry.code}] ` : ""}${entry.message} @ ${entry.path ?? "unknown"}${entry.startLine !== undefined ? `:${entry.startLine + 1}` : ""}`; }
function isDiagnostic(value: unknown): value is ContextDiagnostic | ContextLogEntry { return Boolean(value && typeof value === "object" && "message" in value && typeof (value as { message?: unknown }).message === "string"); }
function projectShape(value: unknown, depth: number): unknown {
  if (depth > 3) return Array.isArray(value) ? `[${value.length} item(s)]` : typeof value;
  if (Array.isArray(value)) return { count: value.length, sample: value.slice(0, 3).map((item) => projectShape(item, depth + 1)) };
  if (value && typeof value === "object") return Object.fromEntries(Object.entries(value).slice(0, 40).map(([key, item]) => [key, projectShape(item, depth + 1)]));
  return value;
}
