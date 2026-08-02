import fs from "node:fs/promises";
import { createHash } from "node:crypto";
import path from "node:path";
import { scanFiles } from "../ingestion/fileScanner";
import type { InsightSeverity, RepositoryInsight, RepositoryInsightReport } from "./model";

type Rule = {
  category: string;
  severity: InsightSeverity;
  title: string;
  pattern: RegExp;
  explanation: string;
  remediation: string;
  confidence: number;
  redact?: boolean;
};
const CODE = /\.(?:[cm]?[jt]sx?|py|go|java|rs|rb|php|cs|kt|scala|swift)$/i;

const SECURITY_RULES: Rule[] = [
  rule(
    "secrets",
    "critical",
    "Possible hard-coded credential",
    /\b(?:password|passwd|api[_-]?key|secret|access[_-]?token)\s*[:=]\s*["'][^"']{6,}["']/i,
    "Credential-like material appears embedded in source.",
    "Move the value to an approved secret store and rotate any exposed credential.",
    0.94,
    true
  ),
  rule(
    "injection",
    "critical",
    "Dynamic code execution",
    /(?:^|[;{=(]\s*)(?:eval|exec)\s*\(|new\s+Function\s*\(/,
    "Untrusted input may reach dynamic execution.",
    "Remove dynamic execution or enforce a strict allowlist before evaluation.",
    0.92
  ),
  rule(
    "command-injection",
    "high",
    "Shell command construction",
    /\b(?:exec|execSync|system|popen|spawn)\s*\([^\n]*(?:\+|`|\$\{)/,
    "A shell/process command appears dynamically constructed.",
    "Use argument arrays, avoid a shell, and validate every external value.",
    0.88
  ),
  rule(
    "sql-injection",
    "high",
    "Dynamic SQL construction",
    /\b(?:select|insert|update|delete)\b[^\n]*(?:\+|\$\{|%s|\.format\()/i,
    "A query appears to interpolate values into SQL.",
    "Use parameterized queries and typed query bindings.",
    0.86
  ),
  rule(
    "transport",
    "high",
    "Insecure HTTP endpoint",
    /["']http:\/\/(?!127\.0\.0\.1|localhost)/i,
    "External traffic may use plaintext HTTP.",
    "Require HTTPS and validate certificates for external traffic.",
    0.9
  ),
  rule(
    "xss",
    "high",
    "Unsafe HTML injection",
    /\b(?:innerHTML|outerHTML|dangerouslySetInnerHTML)\b/,
    "HTML is inserted through an unsafe rendering surface.",
    "Use safe DOM APIs or a proven sanitizer with a restrictive policy.",
    0.9
  ),
  rule(
    "crypto",
    "medium",
    "Weak cryptographic primitive",
    /\b(?:md5|sha1|des|rc4)\b/i,
    "A deprecated cryptographic primitive is referenced.",
    "Use a current approved algorithm and a purpose-built password KDF where applicable.",
    0.88
  ),
  rule(
    "cors",
    "medium",
    "Permissive CORS policy",
    /(?:Access-Control-Allow-Origin|origin)\s*[:=]\s*["']\*["']/i,
    "The service may allow requests from every origin.",
    "Restrict origins to an explicit environment-specific allowlist.",
    0.82
  ),
  rule(
    "filesystem",
    "medium",
    "User-influenced filesystem path",
    /(?:readFile|writeFile|open|unlink)\s*\([^\n]*(?:req\.|request\.|params|query|input)/i,
    "External input may influence a filesystem operation.",
    "Resolve against an approved base directory and reject traversal or symlink escapes.",
    0.78
  ),
  rule(
    "logging",
    "medium",
    "Sensitive value may be logged",
    /(?:console\.|logger\.|logging\.)[^\n]*(?:token|secret|password|prompt|email|media[_ ]?path)/i,
    "A log statement references sensitive data.",
    "Log an opaque identifier or redacted metadata instead of the sensitive value.",
    0.84,
    true
  )
];

const PERFORMANCE_RULES: Rule[] = [
  rule(
    "blocking-io",
    "high",
    "Synchronous I/O on an execution path",
    /\b(?:readFileSync|writeFileSync|execSync|spawnSync|sleep\s*\()/i,
    "Synchronous work can block request or extension-host progress.",
    "Use async I/O or move the work to an isolated worker with a timeout.",
    0.9
  ),
  rule(
    "unbounded-query",
    "high",
    "Potentially unbounded data query",
    /\bselect\b(?![^;\n]*\blimit\b)[^;\n]*(?:from|join)\b/i,
    "A query has no visible bound or pagination.",
    "Add a limit, cursor pagination, and an index-backed ordering.",
    0.78
  ),
  rule(
    "loop-await",
    "high",
    "Sequential await inside loop",
    /\b(?:for|while)(?!\s+await\b)\s*[^\n{]*[{:]?[^\n]{0,160}\bawait\b/,
    "Independent asynchronous work may execute serially.",
    "Batch with bounded concurrency or aggregate with Promise.all where ordering is unnecessary.",
    0.76
  ),
  rule(
    "nested-iteration",
    "medium",
    "Nested collection traversal",
    /\b(?:for|forEach|map|filter)\b[^\n]*[\s\S]{0,120}\b(?:for|forEach|find|filter)\b/,
    "Nested traversal may become quadratic on large inputs.",
    "Index lookups in a Map/Set or combine the operation into one bounded pass.",
    0.72
  ),
  rule(
    "serialization",
    "medium",
    "Potentially large response serialization",
    /\b(?:JSON\.stringify|json\.dumps)\s*\([^\n]*(?:response|result|records|rows|payload|body)/i,
    "A potentially large response collection is serialized in one allocation.",
    "Bound payload size, stream where possible, and measure serialization latency.",
    0.72
  ),
  rule(
    "timer",
    "low",
    "Recurring timer requires lifecycle cleanup",
    /\bsetInterval\s*\(/,
    "A recurring timer can leak resources if it survives disposal.",
    "Store the handle and clear it during shutdown or cancellation.",
    0.82
  ),
  rule(
    "network",
    "medium",
    "External call without visible timeout",
    /\b(?:fetch|axios\.|requests\.|http\.request)\s*\(/,
    "External calls can hold resources indefinitely without a timeout.",
    "Provide cancellation, a bounded timeout, retry budget, and latency telemetry.",
    0.7
  )
];

export interface RepositoryInsightAnalysisOptions {
  /** Canonical OKF paths to inspect; an omitted scope preserves full discovery for compatibility. */
  scopePaths?: readonly string[];
}
export async function analyzeRepositorySecurity(
  root: string,
  options: RepositoryInsightAnalysisOptions = {}
): Promise<RepositoryInsightReport> {
  return analyze(root, "security", SECURITY_RULES, options);
}
export async function analyzeRepositoryPerformance(
  root: string,
  options: RepositoryInsightAnalysisOptions = {}
): Promise<RepositoryInsightReport> {
  return analyze(root, "performance", PERFORMANCE_RULES, options);
}

async function analyze(
  root: string,
  kind: RepositoryInsightReport["kind"],
  rules: Rule[],
  options: RepositoryInsightAnalysisOptions
): Promise<RepositoryInsightReport> {
  const scanned = options.scopePaths?.length
    ? await scanSelectedFiles(root, options.scopePaths)
    : await scanFiles(root);
  const files = scanned.filter((file) => CODE.test(file.path));
  const findings: RepositoryInsight[] = [];
  const safeguards: RepositoryInsightReport["safeguards"] = [];
  const skippedFiles: RepositoryInsightReport["skippedFiles"] = [];
  let truncated = false;
  for (const file of files) {
    let text: string;
    try {
      text = await fs.readFile(file.absolutePath, "utf8");
    } catch {
      skippedFiles.push({
        path: file.path,
        reason: "File became unavailable or unreadable during analysis."
      });
      continue;
    }
    const controls = detectedControls(kind, text);
    if (controls.length) safeguards.push({ path: file.path, controls });
    const lines = text.split(/\r?\n/);
    for (let index = 0; index < lines.length; index += 1) {
      if (/^\s*(?:\/\/|\/\*|\*|#)/.test(lines[index]) || /\brule\s*\(/.test(lines[index])) continue;
      for (const current of rules) {
        current.pattern.lastIndex = 0;
        if (!current.pattern.test(lines[index])) continue;
        findings.push({
          id: createHash("sha256")
            .update(`${kind}|${file.path}|${index + 1}|${current.category}`)
            .digest("hex")
            .slice(0, 16),
          category: current.category,
          severity: current.severity,
          title: current.title,
          path: file.path,
          line: index + 1,
          evidence: current.redact
            ? "[REDACTED sensitive expression]"
            : lines[index].trim().slice(0, 240),
          explanation: current.explanation,
          remediation: current.remediation,
          confidence: current.confidence
        });
      }
    }
  }
  const summary = {
    critical: count(findings, "critical"),
    high: count(findings, "high"),
    medium: count(findings, "medium"),
    low: count(findings, "low")
  };
  const riskScore = Math.min(
    100,
    summary.critical * 20 + summary.high * 8 + summary.medium * 3 + summary.low
  );
  const riskLevel: InsightSeverity =
    riskScore >= 80 ? "critical" : riskScore >= 45 ? "high" : riskScore >= 15 ? "medium" : "low";
  const recommendations = [
    ...new Set(
      findings
        .sort((a, b) => weight(b.severity) - weight(a.severity))
        .slice(0, 12)
        .map((item) => item.remediation)
    )
  ];
  if (skippedFiles.length)
    recommendations.unshift(
      `Re-run analysis after ${skippedFiles.length} unavailable file(s) become readable.`
    );
  return {
    kind,
    generatedAt: new Date().toISOString(),
    analyzedFiles: files.length - skippedFiles.length,
    discoveryMode: "unbounded-incremental",
    completedWithoutFileCap: true,
    riskScore,
    riskLevel,
    summary,
    findings,
    hotspots: hotspots(findings),
    safeguards,
    skippedFiles,
    recommendations,
    truncated: truncated || skippedFiles.length > 0
  };
}

async function scanSelectedFiles(
  root: string,
  scopePaths: readonly string[]
): Promise<
  Array<{ path: string; absolutePath: string; sizeBytes: number; modifiedTimeMs: number }>
> {
  const workspaceRoot = path.resolve(root);
  const files = await Promise.all(
    scopePaths.map(async (value) => {
      const relativePath = value.replace(/\\/g, "/").replace(/^\.\//, "");
      const absolutePath = path.resolve(workspaceRoot, relativePath);
      if (absolutePath !== workspaceRoot && !absolutePath.startsWith(`${workspaceRoot}${path.sep}`))
        return undefined;
      try {
        const stat = await fs.stat(absolutePath);
        return stat.isFile()
          ? { path: relativePath, absolutePath, sizeBytes: stat.size, modifiedTimeMs: stat.mtimeMs }
          : undefined;
      } catch {
        return undefined;
      }
    })
  );
  return files.filter(
    (
      file
    ): file is { path: string; absolutePath: string; sizeBytes: number; modifiedTimeMs: number } =>
      Boolean(file)
  );
}

function rule(
  category: string,
  severity: InsightSeverity,
  title: string,
  pattern: RegExp,
  explanation: string,
  remediation: string,
  confidence: number,
  redact = false
): Rule {
  return { category, severity, title, pattern, explanation, remediation, confidence, redact };
}
function count(findings: RepositoryInsight[], severity: InsightSeverity): number {
  return findings.filter((item) => item.severity === severity).length;
}
function weight(value: InsightSeverity): number {
  return value === "critical" ? 4 : value === "high" ? 3 : value === "medium" ? 2 : 1;
}
function hotspots(
  findings: RepositoryInsightReport["findings"]
): RepositoryInsightReport["hotspots"] {
  const map = new Map<string, RepositoryInsight[]>();
  for (const finding of findings)
    map.set(finding.path, [...(map.get(finding.path) ?? []), finding]);
  return [...map]
    .map(([file, items]) => ({
      path: file,
      findings: items.length,
      score: items.reduce((sum, item) => sum + weight(item.severity), 0)
    }))
    .sort((a, b) => b.score - a.score || a.path.localeCompare(b.path))
    .slice(0, 20);
}
function detectedControls(kind: RepositoryInsightReport["kind"], text: string): string[] {
  const controls: string[] = [];
  if (kind === "security") {
    if (/helmet\s*\(|Content-Security-Policy|csrf/i.test(text))
      controls.push("security headers / CSRF control");
    if (/parameterized|preparedStatement|\?\s*[,)]/i.test(text))
      controls.push("parameterized query");
    if (/redact|mask|sanitize/i.test(text)) controls.push("redaction / sanitization");
  } else {
    if (/AbortController|timeoutMs|timeout\s*[:=]/i.test(text))
      controls.push("timeout / cancellation");
    if (/cache|memo/i.test(text)) controls.push("caching");
    if (/limit|pagination|cursor/i.test(text)) controls.push("bounded retrieval");
  }
  return controls;
}
