import type { ContextPack, RiskLevel, SecurityAnalysis } from "../../domain/types";

// ---------------------------------------------------------------------------
// Pattern libraries for static analysis
// ---------------------------------------------------------------------------

const HIGH_RISK_PATTERNS = [
  { pattern: /\b(password|passwd|pwd)\b/i, category: "auth" },
  { pattern: /\b(token|jwt|bearer|csrf|secret|apikey|api_key)\b/i, category: "auth" },
  {
    pattern: /\b(authorize|authorizeRequest|requireAuth|isAdmin|hasPermission)\b/i,
    category: "auth"
  },
  { pattern: /\b(encrypt|decrypt|aes|rsa|sha256|hash|bcrypt|argon2)\b/i, category: "crypto" },
  {
    pattern: /\b(sql|query|statement|execute)\b.*\b(insert|delete|update|drop)\b/i,
    category: "injection"
  },
  {
    pattern: /\b(innerHTML|document\.write|eval|Function\s*\(|setTimeout\s*\(\s*")/i,
    category: "xss"
  },
  { pattern: /\b(execute|exec|spawn|system|shell)\s*\(/i, category: "rce" },
  { pattern: /\b(file|fs|readFile|writeFile|unlink|mkdir)\s*\(/i, category: "file-access" },
  { pattern: /\b(email|ssn|social_security|credit_card|card_number|cvv|dob)\b/i, category: "pii" },
  { pattern: /\b(export|download|stream)\s*(file|csv|pdf|data)\b/i, category: "data-export" },
  { pattern: /\b(session|cookie|flash)\s*(set|create|destroy|regenerate)\b/i, category: "session" },
  { pattern: /\b(ratelimit|throttle|rate_limit)\b/i, category: "rate-limit" }
];

const MEDIUM_RISK_PATTERNS = [
  { pattern: /\b(console|log|debug|error|warn)\s*\(/i, category: "logging" },
  { pattern: /\b(request|response|req|res)\b/i, category: "http" },
  { pattern: /\b(upload|download|multipart|form-data)\b/i, category: "data-transfer" },
  { pattern: /\b(import|require|dynamic|webpack|vite)\b/i, category: "dependency" },
  { pattern: /\b(axios|fetch|http|https|superagent)\b/i, category: "network" },
  { pattern: /\b(database|db|mongoose|sequelize|prisma|typeorm)\b/i, category: "database" }
];

/** Extract all source content from the context pack. */
function extractSource(pack: ContextPack): string {
  const parts: string[] = [];

  // Direct excerpts are the richest signal
  if (pack.contextSections) {
    for (const section of pack.contextSections) {
      parts.push(section.content);
    }
  }

  // File summaries and paths as secondary signal
  for (const file of pack.relevantFiles) {
    if (file.summary) parts.push(file.summary);
    parts.push(file.path);
  }

  // API endpoints are security-sensitive by nature
  for (const api of pack.relatedApis) {
    parts.push(`${api.method} ${api.path}`);
  }

  // Services and constraints
  for (const svc of pack.impactedServices) {
    parts.push(svc.name, ...svc.hints);
  }

  return parts.join("\n").toLowerCase();
}

/**
 * Classify security risk based on static analysis of code content.
 *
 * Scans source excerpts for known security-sensitive patterns (auth, crypto,
 * injection, XSS, RCE, PII, data export, session management, rate limiting)
 * and assigns a risk level accordingly.
 */
function classifySecurityRisk(source: string): { riskLevel: RiskLevel; sensitiveAreas: string[] } {
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
  return { riskLevel, sensitiveAreas: found };
}

export class SecurityAgent {
  /**
   * Analyze a context pack for security risks.
   *
   * Performs static pattern matching on source excerpts, API contracts,
   * and file paths to identify security-sensitive areas.
   */
  analyze(pack: ContextPack): SecurityAnalysis {
    const source = extractSource(pack);
    const { riskLevel, sensitiveAreas } = classifySecurityRisk(source);

    // Build a checklist based on what was found
    const checklist: string[] = [];
    if (sensitiveAreas.includes("auth")) {
      checklist.push("Authentication and authorization checked for all endpoints");
      checklist.push("Token validation and expiration verified");
    }
    if (sensitiveAreas.includes("crypto")) {
      checklist.push("Cryptographic operations use approved algorithms");
      checklist.push("Secrets stored in vault, not source code");
    }
    if (sensitiveAreas.includes("injection")) {
      checklist.push("SQL injection prevention (parameterized queries) verified");
    }
    if (sensitiveAreas.includes("xss")) {
      checklist.push("XSS prevention (output encoding) verified");
    }
    if (sensitiveAreas.includes("rce")) {
      checklist.push("Command injection prevention verified");
    }
    if (sensitiveAreas.includes("pii")) {
      checklist.push("PII fields are not logged or exposed in error messages");
      checklist.push("Data minimization applied to PII handling");
    }
    if (sensitiveAreas.includes("data-export")) {
      checklist.push("Data export rules verified (authorization + audit)");
    }
    if (sensitiveAreas.includes("session")) {
      checklist.push("Session management follows secure defaults");
    }
    if (sensitiveAreas.includes("rate-limit")) {
      checklist.push("Rate limiting configured for external-facing APIs");
    }
    if (sensitiveAreas.includes("logging")) {
      checklist.push("Logging does not include PII or secrets");
    }
    if (sensitiveAreas.includes("database")) {
      checklist.push("Database access uses parameterized queries");
    }
    if (sensitiveAreas.includes("network")) {
      checklist.push("HTTPS enforced for all external calls");
    }

    // Always include baseline checks
    checklist.push("No secrets, tokens, or PII are logged");
    checklist.push("Error messages do not expose internal details");
    checklist.push("Security notes included in PR evidence");

    const sensitivePaths =
      sensitiveAreas.length > 0
        ? sensitiveAreas.map((area) => `${area}-sensitive areas detected`)
        : [];

    return {
      riskLevel,
      sensitiveAreas: sensitivePaths,
      checklist,
      acceptanceCriteria: [
        "No secrets, tokens, or PII are logged.",
        "Authorization behavior is preserved before sensitive actions.",
        "Security notes are included in PR evidence."
      ],
      prNotes: [
        `Security risk classified as ${riskLevel}.`,
        ...(sensitiveAreas.length > 0 ? [`Sensitive areas: ${sensitiveAreas.join(", ")}`] : [])
      ],
      copilotFixPrompts: [
        "Review logging statements for PII/secrets and replace unsafe fields with safe identifiers.",
        ...(!sensitiveAreas.includes("auth")
          ? ["Verify authentication is enforced on all new endpoints."]
          : []),
        ...(!sensitiveAreas.includes("pii")
          ? ["Check that PII fields are not exposed in responses or logs."]
          : [])
      ]
    };
  }
}
