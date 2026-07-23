import { randomUUID } from "node:crypto";
import {
  HandoffPrivacyFindingCategorySchema,
  HandoffPrivacyReportSchema,
  PrivacyConfidenceSchema,
  PrivacySeveritySchema,
  type HandoffPrivacyFinding,
  type HandoffPrivacyFindingCategory,
  type HandoffPrivacyReport,
  type PrivacyConfidence,
  type PrivacySeverity,
} from "../../shared/contracts/handoff";

interface ScanRule {
  category: HandoffPrivacyFindingCategory;
  severity: PrivacySeverity;
  confidence: PrivacyConfidence;
  /** Pattern applied to the searchable text of a package section. */
  pattern: RegExp;
  /** Only consider matches inside values, not keys. */
  locationHint: string;
}

/**
 * Deterministic privacy scan. Patterns are intentionally conservative and
 * high-precision. A "high" confidence credential finding blocks export until it
 * is redacted or removed; lower-confidence candidates may be marked false positive.
 */
const RULES: ScanRule[] = [
  {
    category: "private-key",
    severity: "critical",
    confidence: "high",
    pattern:
      /-----BEGIN (?:RSA|EC|OPENSSH|DSA|PGP)? ?(?:PRIVATE KEY|BLOCK)[^-]*-----[\s\S]{0,4096}?-----END (?:RSA|EC|OPENSSH|DSA|PGP)? ?(?:PRIVATE KEY|BLOCK)-----/i,
    locationHint: "embedded private key block",
  },
  {
    category: "access-token",
    severity: "critical",
    confidence: "high",
    pattern:
      /\b(?:ghp|gho|ghu|ghs|ghr)_[a-z0-9]{36,}\b/i, // GitHub tokens
    locationHint: "GitHub access token",
  },
  {
    category: "access-token",
    severity: "critical",
    confidence: "high",
    pattern:
      /\b(?:ya29\.[a-z0-9_-]{50,}|AIza[0-9A-Za-z_-]{35}|xox[baprs]-[0-9A-Za-z-]{10,})\b/,
    locationHint: "cloud access token",
  },
  {
    category: "api-key",
    severity: "high",
    confidence: "medium",
    pattern:
      /\b(?:api[_-]?key|apikey|secret[_-]?key|client[_-]?secret)\s*[=:]\s*['"]?[a-z0-9/+_=-]{16,}['"]?/i,
    locationHint: "API key assignment",
  },
  {
    category: "authorization-header",
    severity: "high",
    confidence: "high",
    pattern: /\bauthorization\s*:\s*['"]?(?:bearer|basic|token)\s+[a-z0-9._-]{12,}/i,
    locationHint: "authorization header",
  },
  {
    category: "cookie",
    severity: "high",
    confidence: "medium",
    pattern: /\b(?:session|auth|sid|token)[_-]?cookie\s*[=:]\s*['"]?[a-z0-9._-]{12,}/i,
    locationHint: "session cookie",
  },
  {
    category: "password",
    severity: "high",
    confidence: "medium",
    pattern: /\b(?:password|passwd|pwd)\s*[=:]\s*['"]?[^\s'"]{6,}['"]?/i,
    locationHint: "password assignment",
  },
  {
    category: "connection-string",
    severity: "critical",
    confidence: "high",
    pattern:
      /\b(?:postgres|postgresql|mysql|mongodb|redis|amqp|mongodb\+srv):\/\/[^\s:'"]{1,200}/i,
    locationHint: "connection string with embedded credentials",
  },
  {
    category: "secret-env-value",
    severity: "high",
    confidence: "medium",
    pattern: /\b(?:AWS_SECRET_ACCESS_KEY|AZURE_CLIENT_SECRET|STRIPE_SECRET_KEY)\s*[=:]\s*[^\s'"]{8,}/i,
    locationHint: "secret environment value",
  },
  {
    category: "personal-absolute-path",
    severity: "medium",
    confidence: "high",
    pattern: /\/Users\/[a-z0-9_.-]+\/[^\s'"]*/i,
    locationHint: "absolute user-home path",
  },
  {
    category: "personal-absolute-path",
    severity: "medium",
    confidence: "high",
    pattern: /\/home\/[a-z0-9_.-]+\/[^\s'"]*/i,
    locationHint: "absolute home path",
  },
  {
    category: "email-address",
    severity: "low",
    confidence: "medium",
    pattern: /\b[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}\b/i,
    locationHint: "email address",
  },
  {
    category: "private-url",
    severity: "medium",
    confidence: "medium",
    pattern: /\bhttps?:\/\/[^\s@'"]*:[^\s@'"]*@[^\s'"]*/i,
    locationHint: "URL containing embedded credentials",
  },
  {
    category: "path-traversal",
    severity: "critical",
    confidence: "high",
    pattern: /(?:^|\s)(?:\.{1,2}\/){2,}[^\s'"]*/,
    locationHint: "path traversal reference",
  },
];

const CRITICAL_CATEGORIES: ReadonlySet<HandoffPrivacyFindingCategory> = new Set([
  "private-key",
  "access-token",
  "connection-string",
  "secret-env-value",
  "path-traversal",
]);

export class HandoffPrivacyService {
  constructor(private readonly now: () => string = () => new Date().toISOString()) {}

  /**
   * Scan a package draft. The `sections` map is section-name -> serialized text.
   * Returns a report with masked previews. Idempotent and deterministic.
   */
  scan(sections: Record<string, string>): HandoffPrivacyReport {
    const findings: HandoffPrivacyFinding[] = [];
    for (const [section, text] of Object.entries(sections)) {
      if (!text) continue;
      for (const rule of RULES) {
        const matches = text.match(new RegExp(rule.pattern.source, rule.pattern.flags));
        if (!matches || matches.length === 0) continue;
        const full = matches[0];
        if (full.length < 4 && rule.category !== "path-traversal") continue;
        findings.push({
          id: randomUUID(),
          category: rule.category,
          location: `${section}`,
          severity: rule.severity,
          confidence: rule.confidence,
          recommendedAction: CRITICAL_CATEGORIES.has(rule.category)
            ? rule.category === "path-traversal"
              ? "remove"
              : "redact"
            : "redact",
          maskedPreview: this.mask(full, rule.category),
          status: "open",
        });
      }
    }
    return HandoffPrivacyReportSchema.parse({
      scanPassed: findings.every((f) => f.status !== "open") || findings.length === 0,
      findings,
      scannedSections: Object.keys(sections),
      scannedAt: this.now(),
    });
  }

  /** Whether export is blocked: any open finding with high confidence or critical severity. */
  blocksExport(report: HandoffPrivacyReport): boolean {
    return report.findings.some(
      (f) => f.status === "open" && (f.severity === "critical" || f.confidence === "high"),
    );
  }

  /** Whether a high-confidence credential finding remains unresolved (cannot be overridden). */
  hasUnresolvedCredential(report: HandoffPrivacyReport): boolean {
    return report.findings.some(
      (f) =>
        f.status === "open" &&
        f.confidence === "high" &&
        (f.severity === "critical" || CRITICAL_CATEGORIES.has(f.category)),
    );
  }

  markRedacted(report: HandoffPrivacyReport, findingId: string): HandoffPrivacyReport {
    return this.applyStatus(report, findingId, "redacted");
  }

  markRemoved(report: HandoffPrivacyReport, findingId: string): HandoffPrivacyReport {
    return this.applyStatus(report, findingId, "removed");
  }

  markFalsePositive(
    report: HandoffPrivacyReport,
    findingId: string,
    reason: string,
  ): HandoffPrivacyReport {
    const finding = report.findings.find((f) => f.id === findingId);
    if (finding && finding.confidence === "high" && finding.severity === "critical") {
      throw new Error("High-confidence critical findings cannot be marked as false positives.");
    }
    return this.applyStatus(report, findingId, "false-positive", reason);
  }

  private applyStatus(
    report: HandoffPrivacyReport,
    findingId: string,
    status: HandoffPrivacyFinding["status"],
    reason?: string,
  ): HandoffPrivacyReport {
    const findings = report.findings.map((f) =>
      f.id === findingId ? { ...f, status, ...(reason ? { reason } : {}) } : f,
    );
    return HandoffPrivacyReportSchema.parse({
      ...report,
      findings,
      scanPassed: findings.every((f) => f.status !== "open"),
    });
  }

  private mask(value: string, category: HandoffPrivacyFindingCategory): string {
    if (category === "path-traversal" || value.length <= 8) {
      const head = value.slice(0, 4);
      return `${head}${"*".repeat(Math.min(8, Math.max(4, value.length - 4)))}`;
    }
    const head = value.slice(0, 4);
    const tail = value.slice(-4);
    const middle = "*".repeat(Math.min(12, Math.max(4, value.length - 8)));
    return `${head}${middle}${tail}`;
  }
}

export { PrivacyConfidenceSchema, PrivacySeveritySchema, HandoffPrivacyFindingCategorySchema };
