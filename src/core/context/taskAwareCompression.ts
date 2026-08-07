import crypto from "node:crypto";

import type {
  ContextCompressionEvidence,
  ContextCompressionMetadata,
  ContextDiagnostic,
  ContextLogEntry
} from "./contextEngine";
import { estimateTokens } from "./tokenEstimator";

export type TaskContextType =
  | "source-code"
  | "intelligence"
  | "conversation-history"
  | "diff"
  | "diagnostics"
  | "documentation"
  | "structured-data";

export interface CompressionResult {
  readonly content: string;
  readonly metadata: ContextCompressionMetadata;
}

export interface SourceCompressionRange {
  readonly startLine: number;
  readonly endLine?: number;
  readonly label: string;
  readonly kind?: string;
}

export interface SourceCompressionOptions {
  readonly query?: string;
  readonly tokenBudget?: number;
  readonly aggressive?: boolean;
  readonly relevantRanges?: readonly SourceCompressionRange[];
}

export interface IntelligenceCompressionInput {
  readonly task: string;
  readonly indexedAt: string;
  readonly selectedFiles?: readonly Record<string, unknown>[];
  readonly okfItems?: readonly Record<string, unknown>[];
  readonly graphNodes?: readonly Record<string, unknown>[];
  readonly graphEdges?: readonly Record<string, unknown>[];
  readonly relationships?: readonly Record<string, unknown>[];
  readonly facts?: readonly Record<string, unknown>[];
  readonly findings?: readonly Record<string, unknown>[];
  readonly retrievalBasis?: readonly Record<string, unknown>[];
  readonly tokenBudget?: number;
}

type DiagnosticLike = ContextDiagnostic | ContextLogEntry;

const SIGNAL_PATTERNS: ReadonlyArray<{ pattern: RegExp; label: string; weight: number }> = [
  { pattern: /^\s*(?:import|export)\b/, label: "dependency", weight: 8 },
  {
    pattern:
      /^\s*(?:(?:export|default|abstract|async|public|private|protected|static|readonly)\s+)*(?:function|class|interface|type|enum|namespace|const|let|var)\b/,
    label: "symbol/signature",
    weight: 10
  },
  {
    pattern: /\b(?:if|else|switch|case|default|for|while|do|try|catch|finally)\b/,
    label: "control-flow",
    weight: 7
  },
  { pattern: /\b(?:throw|reject|Error|exception|finally)\b/i, label: "exception/error", weight: 10 },
  {
    pattern: /\b(?:await|return|yield|break|continue)\b/,
    label: "control-effect",
    weight: 7
  },
  {
    pattern: /\b(?:save|insert|update|delete|remove|write|emit|publish|send|set|push)\s*\(/i,
    label: "side-effect",
    weight: 9
  },
  { pattern: /(?:=>|\b(?:app|router|route)\s*\.|@(?:Get|Post|Put|Patch|Delete)\b)/, label: "contract", weight: 9 },
  { pattern: /(?:!==|===|!=|==|\b(?:not|never|without|false|null|undefined)\b)/i, label: "negation/guard", weight: 9 },
  { pattern: /\b\d+(?:\.\d+)?\b/, label: "literal", weight: 4 },
  { pattern: /\([^)]*\)|\.[A-Za-z_$][\w$]*\s*\(/, label: "call", weight: 4 }
];

export function compressSourceCode(
  source: string,
  options: SourceCompressionOptions = {}
): CompressionResult {
  const normalized = source.replace(/\r\n/g, "\n");
  const lines = normalized.split("\n");
  const queryTerms = new Set(
    (options.query ?? "")
      .toLowerCase()
      .match(/[a-z0-9_$./-]+/g)
      ?.filter((term) => term.length > 2) ?? []
  );
  const scores = lines.map((line, index) => {
    const signals = SIGNAL_PATTERNS.filter(({ pattern }) => pattern.test(line));
    const queryMatches = [...queryTerms].filter((term) => line.toLowerCase().includes(term)).length;
    const rangeMatch = (options.relevantRanges ?? []).some(
      (range) => index + 1 >= range.startLine && index + 1 <= (range.endLine ?? range.startLine)
    );
    return {
      index,
      score:
        signals.reduce((sum, signal) => sum + signal.weight, 0) +
        queryMatches * 8 +
        (rangeMatch ? 14 : 0),
      labels: signals.map((signal) => signal.label),
      rangeMatch
    };
  });
  const semanticLines = scores.filter((item) => item.score > 0 || item.rangeMatch);
  const targetTokens = options.tokenBudget ?? Number.MAX_SAFE_INTEGER;
  if (!semanticLines.length) {
    return compressionResult(
      "source-code",
      "deterministic source preserved; no safe structural projection available",
      normalized,
      source,
      [{ label: "full source", startLine: 1, endLine: lines.length }],
      ["exact source lines"]
    );
  }
  if (estimateTokens(normalized) <= targetTokens) {
    return compressionResult("source-code", "deterministic source preserved", normalized, source, rangesForLines(scores, lines.length), [
      "symbols",
      "signatures",
      "contracts",
      "control flow",
      "calls/dependencies",
      "side effects",
      "exceptions/errors",
      "exact source lines"
    ]);
  }

  const selected = new Set<number>();
  for (const item of semanticLines) {
    selected.add(item.index);
    if (!options.aggressive) {
      if (item.index > 0) selected.add(item.index - 1);
      if (item.index + 1 < lines.length) selected.add(item.index + 1);
    }
  }
  for (const range of options.relevantRanges ?? []) {
    for (let line = range.startLine - 1; line < (range.endLine ?? range.startLine); line += 1) {
      if (line >= 0 && line < lines.length) selected.add(line);
    }
  }
  const mandatory = new Set(
    semanticLines
      .filter((item) => item.labels.some((label) => !["call", "literal"].includes(label)))
      .map((item) => item.index)
  );
  const suffixFor = (omittedLines: number): string =>
    `\n/* omitted ${omittedLines} unrelated source line(s); expand using the authoritative source ranges */`;
  const ranked = [...selected].filter((index) => !mandatory.has(index)).sort((left, right) => scores[right].score - scores[left].score || left - right);
  const kept = new Set<number>(mandatory);
  for (const index of ranked) {
    const candidate = [...kept, index].sort((left, right) => left - right);
    const candidateText = renderSelectedLines(lines, candidate);
    if (estimateTokens(`${candidateText}${suffixFor(lines.length - candidate.length)}`) <= targetTokens)
      kept.add(index);
  }
  const keptIndexes = [...kept].sort((left, right) => left - right);
  const compressed = renderSelectedLines(lines, keptIndexes);
  const omitted = lines.length - kept.size;
  const content = `${compressed}${suffixFor(omitted)}`;
  return compressionResult(
    "source-code",
    options.aggressive ? "deterministic structural source projection" : "deterministic source projection",
    content,
    source,
    rangesForLines(keptIndexes.map((index) => scores[index]), lines.length),
    [
      "symbols",
      "signatures",
      "contracts",
      "control flow",
      "calls/dependencies",
      "side effects",
      "exceptions/errors",
      "negations and literals on retained lines"
    ]
  );
}

export function compressDiff(diff: string, tokenBudget = Number.MAX_SAFE_INTEGER): CompressionResult {
  const normalized = diff.replace(/\r\n/g, "\n");
  const lines = normalized.split("\n");
  const files = lines
    .filter((line) => line.startsWith("+++ b/") || line.startsWith("--- a/"))
    .map((line) => line.slice(6).trim())
    .filter((value) => value && value !== "/dev/null");
  const changed = lines.filter((line) => /^[+-]/.test(line) && !line.startsWith("---") && !line.startsWith("+++"));
  const categories = unique(
    changed.flatMap((line) => {
      const labels: string[] = [];
      if (/\b(?:function|class|interface|type|export|import)\b/.test(line)) labels.push("API/symbol");
      if (/\b(?:route|router|endpoint|schema|contract|public|export)\b/i.test(line)) labels.push("contract");
      if (/\b(?:throw|catch|Error|exception|reject)\b/i.test(line)) labels.push("error behavior");
      if (/\b(?:if|else|switch|case|for|while|try|finally|return|await)\b/.test(line)) labels.push("control flow");
      if (/\b(?:save|insert|update|delete|write|emit|publish|send)\s*\(/i.test(line)) labels.push("side effect");
      return labels;
    })
  );
  const header = [
    `Changed files: ${unique(files).join(", ") || "none recorded"}`,
    `Behavioral signals: ${categories.join(", ") || "textual change; inspect exact hunk"}`,
    `Added lines: ${changed.filter((line) => line.startsWith("+")).length}; removed lines: ${changed.filter((line) => line.startsWith("-")).length}`,
    "Exact changed lines below are authoritative evidence; unchanged hunk context may be omitted."
  ];
  const exact = lines.filter((line) => line.startsWith("@@") || /^[+-]/.test(line));
  const rendered = [...header, "", ...exact].join("\n");
  // Changed lines are the behavioral evidence. A budget may remove unchanged
  // context, but it must never silently remove a removal or an added contract.
  const content = rendered;
  return compressionResult(
    "diff",
    "deterministic hunk projection",
    content,
    diff,
    exact.map((line, index) => ({ label: `diff line ${index + 1}`, startLine: index + 1, endLine: index + 1 })),
    ["behavioral change", "API/contract change", "affected components", "important additions", "important removals", "risk-relevant signals"]
  );
}

export function compressDiagnostics(entries: readonly DiagnosticLike[], tokenBudget = Number.MAX_SAFE_INTEGER): CompressionResult {
  const groups = new Map<string, { entry: DiagnosticLike; count: number }>();
  for (const entry of entries) {
    const key = `${entry.code ?? ""}|${entry.path ?? ""}|${entry.message.trim()}`;
    const existing = groups.get(key);
    if (existing) existing.count += 1;
    else groups.set(key, { entry, count: 1 });
  }
  const ordered = [...groups.values()].sort((left, right) => severityRank(right.entry.severity) - severityRank(left.entry.severity));
  const lines = [
    `Unique failure groups: ${ordered.length}; raw records: ${entries.length}`,
    ...ordered.map(({ entry, count }) => {
      const location = entry.path
        ? `${entry.path}${entry.startLine !== undefined ? `:${entry.startLine + 1}` : ""}${entry.startColumn !== undefined ? `:${entry.startColumn + 1}` : ""}`
        : "location unavailable";
      const exactCode = entry.code === undefined ? "" : ` [${entry.code}]`;
      const severity = entry.severity ? ` ${entry.severity.toUpperCase()}` : "";
      const command = entry.command ? ` command=${entry.command}` : "";
      const outcome = entry.outcome ? ` outcome=${entry.outcome}` : "";
      return `- root${severity}${exactCode} ${entry.message} @ ${location}; occurrences=${count}${command}${outcome}`;
    })
  ];
  const content = fitLines(lines, tokenBudget);
  return compressionResult(
    "diagnostics",
    "deterministic unique failure grouping",
    content,
    JSON.stringify(entries),
    ordered.map(({ entry }) => ({
      label: entry.message,
      ...(entry.path ? { path: entry.path } : {}),
      ...(entry.startLine !== undefined
        ? {
            startLine: entry.startLine + 1,
            endLine:
              "endLine" in entry && entry.endLine !== undefined
                ? entry.endLine + 1
                : entry.startLine + 1
          }
        : {})
    })),
    ["root error", "exact error code/message", "originating location", "unique failure groups", "decisive warnings", "command outcome"]
  );
}

export function compressDocumentation(document: string, tokenBudget = Number.MAX_SAFE_INTEGER): CompressionResult {
  const normalized = document.replace(/\r\n/g, "\n");
  const lines = normalized.split("\n");
  const requirement = /\b(?:must|shall|required|requirement|constraint|do not|don't|never|only|unless|without|not|should|decision|architecture|contract|api|risk|trade[- ]?off)\b/i;
  const selected = lines
    .map((line, index) => ({ line, index }))
    .filter(({ line }) => /^\s*#{1,6}\s|^\s*(?:[-*]|\d+[.)])\s/.test(line) || requirement.test(line) || /`[^`]+`|\b\d+(?:\.\d+)?\b/.test(line));
  const projected = selected.length ? selected.map(({ line }) => line).join("\n") : normalized;
  const mandatory = selected
    .filter(({ line }) => requirement.test(line) || /`[^`]+`|\b\d+(?:\.\d+)?\b/.test(line))
    .map(({ line }) => line);
  const content = selected.length
    ? fitLinesPreserving(projected.split("\n"), mandatory, tokenBudget)
    : normalized;
  return compressionResult(
    "documentation",
    "deterministic requirement/architecture projection",
    content,
    document,
    selected.map(({ index, line }) => ({ label: line.trim().slice(0, 120), startLine: index + 1, endLine: index + 1 })),
    ["task-relevant requirements", "architecture", "constraints", "decisions", "negations", "identifiers", "numbers and units"]
  );
}

export function compressStructuredData(value: unknown, tokenBudget = 1_200): CompressionResult {
  const original = typeof value === "string" ? value : serialize(value);
  let content: string;
  try {
    const parsed = typeof value === "string" ? JSON.parse(value) : value;
    content = JSON.stringify(compactStructure(parsed));
  } catch {
    content = typeof value === "string" ? value.trim().replace(/\s+/g, " ") : String(value);
  }
  return compressionResult(
    "structured-data",
    "deterministic structural compaction",
    fitLines([content], tokenBudget),
    original,
    [{ label: "structured value" }],
    ["all identifiers", "all numbers and units", "field names", "array/object structure"]
  );
}

export function compressConversationHistory(value: unknown, tokenBudget = Number.MAX_SAFE_INTEGER): CompressionResult {
  const buckets: Record<string, string[]> = {
    goal: [],
    constraints: [],
    decisions: [],
    rejected: [],
    completed: [],
    currentObjective: [],
    blockers: [],
    openQuestions: []
  };
  const evidence: ContextCompressionEvidence[] = [];
  visitHistory(value, "", buckets, evidence);
  for (const key of Object.keys(buckets)) {
    if (!buckets[key].length) buckets[key].push("none recorded in the available history");
  }
  const sections = (Object.keys(buckets) as Array<keyof typeof buckets>)
    .map((key) => [key, unique(buckets[key])] as const)
    .filter(([, values]) => values.length)
    .flatMap(([key, values]) => [`${key}:`, ...values.map((entry) => `- ${entry}`)]);
  const content = fitLines(
    ["Durable task work state (derived from retrievable history):", ...sections],
    tokenBudget
  );
  return compressionResult(
    "conversation-history",
    "deterministic durable work-state projection",
    content,
    serialize(value),
    evidence,
    ["goal", "constraints", "accepted decisions", "rejected approaches", "completed work", "current objective", "blockers", "open questions"]
  );
}

export function compressIntelligence(input: IntelligenceCompressionInput): CompressionResult {
  const selectedPaths = new Set(
    (input.selectedFiles ?? []).map((file) => String(file.path ?? "")).filter(Boolean)
  );
  const lines = [
    "Source: persisted Keystone intelligence; this is a task-relevant graph/subgraph projection.",
    `Indexed at: ${input.indexedAt}`,
    `Task: ${input.task}`,
    `Selected files: ${selectedPaths.size}`,
    ...compactRecords("OKF items", input.okfItems ?? [], ["kind", "label", "path", "line", "reason", "confidence"]),
    ...compactRecords("Graph edges", input.graphEdges ?? [], ["kind", "sourceId", "targetId", "confidence"]),
    ...compactRecords("Relationships and flow facts", input.relationships ?? [], ["kind", "source", "target", "sourcePath", "targetPath", "filePath", "line"]),
    ...compactRecords("Task-relevant findings", input.findings ?? [], ["severity", "category", "title", "filePath", "description"]),
    ...compactRecords("Graph nodes", input.graphNodes ?? [], ["id", "kind", "label", "path", "line", "confidence"]),
    ...compactRecords("Symbols, APIs, services, and tests", input.facts ?? [], ["name", "kind", "filePath", "line", "method", "path", "testFile", "targetFile", "reason", "confidence", "hints"]),
    ...compactRecords("files", input.selectedFiles ?? [], ["path", "language", "lineCount", "summary"]),
    ...compactRecords("Retrieval basis", input.retrievalBasis ?? [], ["path", "reasons", "score"]),
    `Projection preserves ${selectedPaths.size ? "the selected file neighborhood" : "the selected canonical facts"}; unrelated intelligence remains retrievable.`,
    `Graph projection paths: ${[...selectedPaths].join(", ") || "none"}`
  ];
  const content = fitLines(lines, input.tokenBudget ?? 1_800);
  return compressionResult(
    "intelligence",
    "deterministic relevant graph/subgraph projection",
    content,
    JSON.stringify(input),
    [
      { label: "selected intelligence projection" },
      ...[...(input.graphEdges ?? []), ...(input.relationships ?? [])].slice(0, 32).map((record) => ({
        label: `${String(record.kind ?? "relationship")}: ${String(record.sourceId ?? record.source ?? "?")} -> ${String(record.targetId ?? record.target ?? "?")}`,
        ...(typeof record.filePath === "string" ? { path: record.filePath } : {})
      }))
    ],
    ["relevant nodes", "relevant relationships", "flows", "API facts", "findings", "source paths"]
  );
}

function compressionResult(
  type: TaskContextType,
  strategy: string,
  content: string,
  original: string,
  evidence: readonly ContextCompressionEvidence[],
  preserved: readonly string[]
): CompressionResult {
  return {
    content,
    metadata: {
      type,
      strategy,
      deterministic: true,
      derived: true,
      originalBytes: Buffer.byteLength(original, "utf8"),
      compressedBytes: Buffer.byteLength(content, "utf8"),
      originalHash: crypto.createHash("sha256").update(original).digest("hex"),
      evidence: Object.freeze(evidence.map((item) => Object.freeze({ ...item }))),
      preserved: Object.freeze([...preserved])
    }
  };
}

function serialize(value: unknown): string {
  return typeof value === "string" ? value : JSON.stringify(value) ?? String(value);
}

function rangesForLines(values: readonly { index: number; labels: readonly string[] }[], lineCount: number): ContextCompressionEvidence[] {
  if (!values.length) return [{ label: "source", startLine: 1, endLine: lineCount }];
  return values.slice(0, 64).map((value) => ({
    label: value.labels.join(", ") || "source evidence",
    startLine: value.index + 1,
    endLine: value.index + 1
  }));
}

function renderSelectedLines(lines: readonly string[], indexes: readonly number[]): string {
  const output: string[] = [];
  let previous = -2;
  for (const index of indexes) {
    if (index > previous + 1) output.push("/* omitted unrelated source lines */");
    output.push(`${index + 1}: ${lines[index]}`);
    previous = index;
  }
  return output.join("\n");
}

function truncateDiffByWholeLines(header: readonly string[], lines: readonly string[], tokenBudget: number): string {
  const output = [...header, ""];
  for (const line of lines) {
    const candidate = [...output, line].join("\n");
    if (estimateTokens(candidate) > tokenBudget && output.length > header.length + 1) break;
    output.push(line);
  }
  return `${output.join("\n")}\n… diff projection bounded at a whole-line boundary; expand the authoritative diff for remaining hunks …`;
}

function fitLines(lines: readonly string[], tokenBudget: number): string {
  const rendered = lines.join("\n").trim();
  if (estimateTokens(rendered) <= tokenBudget) return rendered;
  const marker = "… projection bounded; expand the authoritative evidence for remaining records …";
  if (estimateTokens(marker) >= tokenBudget) return truncateToTokenBudget(marker, tokenBudget);
  const output: string[] = [];
  for (const line of lines) {
    const candidate = [...output, line, marker].join("\n");
    if (estimateTokens(candidate) > tokenBudget) break;
    output.push(line);
  }
  if (!output.length) return truncateToTokenBudget(lines[0]?.trim() || marker, tokenBudget);
  return [...output, marker].join("\n");
}

function truncateToTokenBudget(value: string, tokenBudget: number): string {
  if (tokenBudget <= 0) return "";
  if (estimateTokens(value) <= tokenBudget) return value;
  let lower = 0;
  let upper = value.length;
  while (lower < upper) {
    const middle = Math.ceil((lower + upper) / 2);
    if (estimateTokens(value.slice(0, middle)) <= tokenBudget) lower = middle;
    else upper = middle - 1;
  }
  return value.slice(0, lower).trimEnd();
}

function fitLinesPreserving(
  lines: readonly string[],
  mandatory: readonly string[],
  tokenBudget: number
): string {
  const required = [...new Set(mandatory)];
  const output = [...required];
  for (const line of lines) {
    if (output.includes(line)) continue;
    const candidate = [...output, line].join("\n");
    if (estimateTokens(candidate) > tokenBudget) continue;
    output.push(line);
  }
  return `${output.join("\n").trim()}${output.length < lines.length ? "\n… projection bounded while preserving all requirement and contract lines …" : ""}`;
}

function compactRecords(
  heading: string,
  records: readonly Record<string, unknown>[],
  fields: readonly string[]
): string[] {
  if (!records.length) return [];
  return [
    `${heading} (${records.length}):`,
    ...records.slice(0, 64).map((record) => {
      const selected = Object.fromEntries(
        fields.filter((field) => record[field] !== undefined).map((field) => [field, record[field]])
      );
      return `- ${JSON.stringify(selected)}`;
    })
  ];
}

function compactStructure(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map((item) => compactStructure(item));
  }
  if (!value || typeof value !== "object") return value;
  const entries = Object.entries(value as Record<string, unknown>);
  const important = entries.filter(([key]) => importantStructuredKey(key));
  const kept = entries.filter(([key, child]) => {
    if (importantStructuredKey(key)) return true;
    if (Array.isArray(child)) return true;
    if (child === null || typeof child !== "object") return String(child).length <= 240;
    return false;
  });
  const output: Record<string, unknown> = {};
  for (const [key, child] of kept) {
    if (Array.isArray(child)) {
      // Keep every compacted record so identifiers, paths, codes, and numeric
      // fields remain available. The reduction comes from dropping redundant
      // nested metadata, not from silently sampling away records.
      output[key] =
        child.length > 24
          ? {
              count: child.length,
              identifiers: child.map((item) => extractStructuredIdentity(item)),
              items: child.slice(0, 2).concat(child.slice(-2)).map((item) => compactStructure(item))
            }
          : { count: child.length, items: child.map((item) => compactStructure(item)) };
    } else {
      output[key] = compactStructure(child);
    }
  }
  const omitted = entries.length - kept.length;
  if (omitted > 0) output.__omittedFields = omitted;
  if (!important.length && entries.length > kept.length) output.__shape = entries.map(([key]) => key);
  return output;
}

function importantStructuredKey(key: string): boolean {
  return /(?:^|_)(?:id|path|name|label|kind|type|method|code|message|status|severity|line|column|count|version|hash|from|to|source|target|unit|value|summary|description|reason|command|outcome|timestamp)(?:$|_)/i.test(key);
}

function extractStructuredIdentity(value: unknown): unknown {
  if (!value || typeof value !== "object" || Array.isArray(value)) return value;
  const output: Record<string, unknown> = {};
  for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
    if (importantStructuredKey(key) && (child === null || typeof child !== "object")) output[key] = child;
  }
  return Object.keys(output).length ? output : "record";
}

function visitHistory(
  value: unknown,
  keyPath: string,
  buckets: Record<string, string[]>,
  evidence: ContextCompressionEvidence[]
): void {
  if (Array.isArray(value)) {
    if (/relevantfiles$/i.test(keyPath)) {
      const paths = value.filter((item): item is string => typeof item === "string");
      if (paths.length) buckets.completed.push(`Selected source paths (${paths.length}): ${paths.join(", ")}`);
    }
    if (/(?:relevantsymbols|qachecks|tests|contextpackets)$/i.test(keyPath) && value.length) {
      buckets.completed.push(`${keyPath.split(".").at(-1) ?? "history"}: ${value.length} recorded item(s)`);
    }
    value.forEach((item, index) => visitHistory(item, `${keyPath}[${index}]`, buckets, evidence));
    return;
  }
  if (!value || typeof value !== "object") return;
  for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
    const normalizedKey = key.toLowerCase().replace(/[^a-z]/g, "");
    const text = typeof child === "string" ? child.trim() : undefined;
    const bucket = historyBucket(normalizedKey) ?? inferredHistoryBucket(normalizedKey, text);
    if (text && bucket) {
      buckets[bucket].push(text);
      evidence.push({ label: `${keyPath ? `${keyPath}.` : ""}${key}`, });
    }
    visitHistory(child, `${keyPath ? `${keyPath}.` : ""}${key}`, buckets, evidence);
  }
}

function inferredHistoryBucket(key: string, text: string | undefined): keyof Record<string, string[]> | undefined {
  if (!text || !/^(message|description|detail|reason|status|result|outcome)$/.test(key)) return undefined;
  if (/\b(?:blocked|blocker|failed|failure|error|cannot|unable)\b/i.test(text)) return "blockers";
  if (/\b(?:completed|complete|implemented|finished|done|passed|validated)\b/i.test(text)) return "completed";
  if (/\b(?:approved|accepted|decided|chosen|resolved)\b/i.test(text)) return "decisions";
  if (/\?|\b(?:open|unknown|todo|follow[- ]?up)\b/i.test(text)) return "openQuestions";
  return undefined;
}

function historyBucket(key: string): keyof Record<string, string[]> | undefined {
  if (/^(goal|objective|intent|task|summary|request)$/.test(key)) return "goal";
  if (/(constraint|requirement|avoid|must|security|scope|acceptance|standard)/.test(key)) return "constraints";
  if (/(decision|accepted|approved|chosen|resolution)/.test(key)) return "decisions";
  if (/(reject|rejected|declined|discarded|wont|wontdo)/.test(key)) return "rejected";
  if (/(completed|complete|done|finished|implemented|validated|result)/.test(key)) return "completed";
  if (/(qa|check|test|validation)/.test(key)) return "completed";
  if (/(currentobjective|nextstep|currenttask)/.test(key)) return "currentObjective";
  if (/(blocker|blocked|failure|error|impediment)/.test(key)) return "blockers";
  if (/(question|open|unknown|todo|followup)/.test(key)) return "openQuestions";
  return undefined;
}

function severityRank(severity: string | undefined): number {
  if (/error|critical|fatal/i.test(severity ?? "")) return 4;
  if (/warning|warn/i.test(severity ?? "")) return 3;
  if (/info/i.test(severity ?? "")) return 1;
  return 2;
}

function unique(values: readonly string[]): string[] {
  return [...new Set(values.filter((value) => value.trim()))];
}
