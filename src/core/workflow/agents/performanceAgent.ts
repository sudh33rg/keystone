import type { ContextPack, PerformanceAnalysis, RiskLevel } from "../../domain/types";
import type { CanonicalContextSelection } from "../../intelligence/okf/canonicalContext";
import { canonicalGraphDigest, canonicalRiskAreas } from "./canonicalTaskEvidence";

// ---------------------------------------------------------------------------
// Pattern libraries for performance static analysis
// ---------------------------------------------------------------------------

const HIGH_RISK_PATTERNS = [
  // N+1: forEach/for...of loop with inner query
  {
    pattern: /\b(\.forEach|for\s*\(|for\s+of)\b[\s\S]*?\.(find|filter|map|select|query)\b/i,
    category: "n-plus-one"
  },
  // Chained array ops on one line
  {
    pattern: /\b(\.map|\.forEach)\s*[\s\S]*?\.(find|filter|map|forEach)\b/i,
    category: "chained-iteration"
  },
  {
    pattern: /\b(\.find|\.filter)\s*[\s\S]*?\.(find|filter|map|forEach)\b/i,
    category: "chained-iteration"
  },
  { pattern: /\b(fetch|axios|http\.get|http\.request|superagent)\b/i, category: "external-call" },
  { pattern: /\b(serialize|JSON\.stringify|deparse)\b/i, category: "serialization" },
  { pattern: /\b(\.sort|\.reverse)\b/i, category: "sorting" },
  { pattern: /\b(\.join\s*\(\s*""\)|\.join\s*\(\s*'\s*'\s*\))\b/i, category: "string-concat" },
  { pattern: /\b(bulk|batch)\s*(insert|update|delete)\b/i, category: "batch-op" },
  { pattern: /\b(stream|createReadStream|pipeline)\b/i, category: "streaming" },
  { pattern: /\b(file|fs)\.(write|append|copy|unlink|mkdir)\b/i, category: "file-io" },
  { pattern: /\b(console\.(log|debug|info|error|warn)\b)/i, category: "debug-logging" },
  { pattern: /\b(\.exec|\.execSync|\.execFile)\s*\(/i, category: "command-exec" },
  {
    pattern: /\b(\.length\s*>\s*\d+|\.length\s*===\s*\d+|\.length\s*<\s*\d+)\b/i,
    category: "length-check"
  }
];

const MEDIUM_RISK_PATTERNS = [
  {
    pattern: /\b(\.map|\.forEach|\.reduce|\.filter|\.find|\.some|\.every)\b/i,
    category: "iteration"
  },
  { pattern: /\b(\.then|\.catch|await|async)\b/i, category: "async" },
  { pattern: /\b(setTimeout|setInterval)\b/i, category: "timer" },
  { pattern: /\b(require|import|require\.resolve)\b/i, category: "import" },
  { pattern: /\b(console\.(log|debug|info))\b/i, category: "logging" },
  { pattern: /\b(\.filter|\.find|\.some)\b/i, category: "search" },
  { pattern: /\b(\.push|\.pop|\.shift|\.unshift)\b/i, category: "array-mut" }
];

/** Extract all source content from the context pack. */
function extractSource(pack: ContextPack, canonical?: CanonicalContextSelection): string {
  const parts: string[] = [];

  if (pack.contextSections) {
    for (const section of pack.contextSections) {
      parts.push(section.content);
    }
  }

  for (const file of pack.relevantFiles) {
    if (file.summary) parts.push(file.summary);
    parts.push(file.path);
  }

  for (const api of pack.relatedApis) {
    parts.push(`${api.method} ${api.path}`);
  }

  for (const svc of pack.impactedServices) {
    parts.push(svc.name, ...svc.hints);
  }

  const canonicalDigest = canonicalGraphDigest(canonical);
  return [...parts, canonicalDigest].filter(Boolean).join("\n").toLowerCase();
}

/**
 * Classify performance risk based on static analysis of code content.
 *
 * Scans source excerpts for known performance-sensitive patterns (N+1 queries,
 * chained iterations, external calls, serialization, sorting, file I/O, etc.)
 * and assigns a risk level accordingly.
 */
function classifyPerformanceRisk(source: string): {
  riskLevel: RiskLevel;
  sensitivePaths: string[];
} {
  const found: string[] = [];
  let hasHigh = false;
  let hasMedium = false;

  for (const { pattern, category } of HIGH_RISK_PATTERNS) {
    if (pattern.test(source)) {
      hasHigh = true;
      found.push(category);
    }
  }

  for (const { pattern, category } of MEDIUM_RISK_PATTERNS) {
    if (pattern.test(source)) {
      hasMedium = true;
      found.push(category);
    }
  }

  const riskLevel: RiskLevel = hasHigh ? "high" : hasMedium ? "medium" : "low";
  return { riskLevel, sensitivePaths: found };
}

export class PerformanceAgent {
  /**
   * Analyze a context pack for performance risks.
   *
   * Performs static pattern matching on source excerpts to identify
   * performance-sensitive areas (N+1 queries, chained iterations,
   * external calls, serialization, file I/O, etc.).
   */
  analyze(pack: ContextPack, canonical?: CanonicalContextSelection): PerformanceAnalysis {
    const source = extractSource(pack, canonical);
    const classified = classifyPerformanceRisk(source);
    const canonicalPaths = canonicalRiskAreas(canonical, "performance");
    const sensitivePaths = [...new Set([...classified.sensitivePaths, ...canonicalPaths])];
    const riskLevel =
      classified.riskLevel === "high" || canonicalPaths.length > 0 ? "high" : classified.riskLevel;

    // Build checklist based on what was found
    const checklist: string[] = [];
    if (sensitivePaths.includes("n-plus-one")) {
      checklist.push("No N+1 query pattern introduced in loops");
    }
    if (sensitivePaths.includes("chained-iteration")) {
      checklist.push("Chained array operations reviewed for potential single-pass optimization");
    }
    if (sensitivePaths.includes("external-call")) {
      checklist.push("External API calls are non-blocking or properly batched");
    }
    if (sensitivePaths.includes("serialization")) {
      checklist.push("Large object serialization reviewed for payload size");
    }
    if (sensitivePaths.includes("sorting")) {
      checklist.push("Sort operations reviewed for large datasets");
    }
    if (sensitivePaths.includes("streaming")) {
      checklist.push("Streaming used for large file/data transfers");
    }
    if (sensitivePaths.includes("file-io")) {
      checklist.push("File I/O operations reviewed for blocking behavior");
    }
    if (sensitivePaths.includes("command-exec")) {
      checklist.push("Command execution reviewed for timeout and resource limits");
    }
    if (sensitivePaths.includes("iteration")) {
      checklist.push("Array iteration patterns reviewed for efficiency");
    }
    if (sensitivePaths.includes("async")) {
      checklist.push("Async operations properly awaited");
    }

    // Always include baseline checks
    checklist.push("No unnecessary blocking calls in hot paths");
    checklist.push("Pagination considered for list endpoints");
    checklist.push("Query/index impact reviewed for database changes");
    checklist.push("Caching strategy reviewed for data access patterns");
    checklist.push("Async/concurrency impact reviewed");

    const benchmarkSuggestions: string[] = [];
    if (
      sensitivePaths.some((p) =>
        ["external-call", "serialization", "streaming", "file-io"].includes(p)
      )
    ) {
      benchmarkSuggestions.push(
        "Benchmark changed request path if external calls, serialization, or file I/O behavior changes."
      );
    }
    if (sensitivePaths.includes("n-plus-one")) {
      benchmarkSuggestions.push("Benchmark database query patterns after changes.");
    }
    if (sensitivePaths.includes("sorting")) {
      benchmarkSuggestions.push("Benchmark sort operations on large datasets.");
    }
    if (benchmarkSuggestions.length === 0) {
      benchmarkSuggestions.push(
        "Benchmark changed request path if database, export, upload, or search behavior changes."
      );
    }

    const prNotes = [
      `Performance risk classified as ${riskLevel}.`,
      ...(sensitivePaths.length > 0 ? [`Sensitive patterns: ${sensitivePaths.join(", ")}`] : [])
    ];

    const copilotFixPrompts = [
      "Inspect changed loops, queries, and external calls for blocking or N+1 behavior.",
      ...(!sensitivePaths.includes("n-plus-one")
        ? ["Check for N+1 query patterns in new code."]
        : []),
      ...(!sensitivePaths.includes("external-call")
        ? ["Verify external calls are non-blocking or batched."]
        : [])
    ];

    return {
      riskLevel,
      sensitivePaths,
      checklist,
      benchmarkSuggestions,
      acceptanceCriteria: [
        "No synchronous external call in hot request path.",
        "No large payload serialization introduced."
      ],
      prNotes,
      copilotFixPrompts
    };
  }
}
