/**
 * EngineeringQueryParser (spec §6).
 *
 * Deterministic interpretation of a natural engineering question into:
 *   - intent (bounded taxonomy, §5)
 *   - subject text + target text
 *   - traversal direction / depth
 *   - entity-type / relationship hints
 *   - scope flags (tests/production/external/generated)
 *   - confidence threshold
 *   - desired result-view hint
 *   - modifiers (§11)
 *   - a plain-language explanation (never hidden)
 *
 * No LLM. Uses phrase dictionary + regex patterns + code-identifier recognition
 * + file-path / route / database-entity heuristics.
 */
import type {
  EngineeringQueryIntent,
  QueryModifier,
} from "../../../shared/contracts/engineeringQuery";
import type { QueryPhraseDictionary } from "./QueryPhraseDictionary";

export interface ParsedQuery {
  intent: EngineeringQueryIntent;
  subjectText: string;
  targetText?: string;
  direction?: "inbound" | "outbound" | "both";
  depthOverride?: number;
  subjectTypeHint?: string;
  targetTypeHint?: string;
  includeTests: boolean;
  includeProduction: boolean;
  includeExternal: boolean;
  includeGenerated: boolean;
  confidenceThreshold: number;
  modifiers: QueryModifier[];
  routeDetected: boolean;
  databaseDetected: boolean;
  explanation: string[];
  ambiguityNote?: string;
}

const ROUTE_RE = /\b(?:GET|POST|PUT|PATCH|DELETE)\s+(\/[A-Za-z0-9_./{}-]*)\b/i;
const DB_TABLE_RE = /\b(?:table|entity|model)\s+([A-Za-z][A-Za-z0-9_]*)\b/i;
const IDENTIFIER_RE = /[A-Za-z_][A-Za-z0-9_]*(?:\.[A-Za-z_][A-Za-z0-9_]*){0,3}/g;

// Modifier phrases (§11). Order matters: longer/more-specific first.
const MODIFIER_PHRASES: ReadonlyArray<{
  patterns: RegExp;
  modifier: QueryModifier;
  flag?: keyof ParsedQueryModFlags;
}> = [
  { patterns: /direct(?:ly)?\s+(?:only|callers?|callees?|calls?)/i, modifier: "direct-only" },
  { patterns: /direct(?:ly)?/i, modifier: "direct-only" },
  { patterns: /transitive(?:ly)?/i, modifier: "transitive" },
  { patterns: /one\s+level/i, modifier: "one-level" },
  { patterns: /up\s+to\s+(\d+)\s+levels?/i, modifier: "up-to-n-levels" },
  { patterns: /production\s+(?:only|code)?/i, modifier: "production-only" },
  { patterns: /tests?\s+only/i, modifier: "tests-only" },
  { patterns: /include\s+(?:the\s+)?tests?/i, modifier: "include-tests" },
  { patterns: /exclude\s+(?:the\s+)?tests?/i, modifier: "exclude-tests" },
  { patterns: /include\s+(?:external|third[- ]party)/i, modifier: "include-external" },
  { patterns: /exclude\s+(?:external|generated|third[- ]party)/i, modifier: "exclude-generated" },
  { patterns: /high[- ]confidence\s+(?:only|results?)?/i, modifier: "high-confidence-only" },
  { patterns: /only\s+(?:the\s+)?changed\s+(?:code|files?)/i, modifier: "changed-code-only" },
  { patterns: /current\s+module\s+only/i, modifier: "current-module-only" },
  { patterns: /current\s+package\s+only/i, modifier: "current-package-only" },
  { patterns: /all\s+implementations?/i, modifier: "all-implementations" },
  { patterns: /shortest\s+path/i, modifier: "shortest-path" },
  { patterns: /all\s+paths?/i, modifier: "all-paths" },
  { patterns: /writes?\s+only/i, modifier: "writes-only" },
  { patterns: /reads?\s+only/i, modifier: "reads-only" },
];

interface ParsedQueryModFlags {
  includeTests: boolean;
  includeProduction: boolean;
  includeExternal: boolean;
  includeGenerated: boolean;
}

export class EngineeringQueryParser {
  constructor(private readonly dictionary: QueryPhraseDictionary) {}

  parse(rawText: string): ParsedQuery {
    const text = this.dictionary.resolveAlias(rawText.trim());
    const explanation: string[] = [];

    // 1. Intent via phrase dictionary.
    const intentResult = this.matchIntent(text);
    const intent = intentResult?.intent ?? "find-entity";
    let direction = intentResult?.direction;
    const subjectTypeHint = intentResult?.subjectTypeHint;
    const targetTypeHint = intentResult?.targetTypeHint;
    if (intentResult) {
      explanation.push(
        `Matched phrase pattern -> intent "${intent}"${direction ? ` (direction: ${direction})` : ""}.`,
      );
    } else {
      explanation.push(`No phrase pattern matched; defaulting to "find-entity".`);
    }

    // 2. Route / database detection (§6).
    const routeMatch = ROUTE_RE.exec(text);
    const routeDetected = Boolean(routeMatch);
    const dbMatch = DB_TABLE_RE.exec(text);
    const databaseDetected = Boolean(dbMatch);
    if (routeDetected) explanation.push(`Detected API route "${routeMatch![1]}".`);
    if (databaseDetected) explanation.push(`Detected database entity "${dbMatch![1]}".`);

    // 3. Subject + target extraction (from/to, X and Y, "between").
    const { subjectText, targetText } = this.extractSubjectTarget(
      text,
      routeMatch?.[1],
      dbMatch?.[1],
    );
    if (subjectText) explanation.push(`Subject token: "${subjectText}".`);
    if (targetText) explanation.push(`Target token: "${targetText}".`);
    if (!subjectText)
      explanation.push(
        `No clear subject token extracted; resolution will rely on context or ask the user.`,
      );

    // 4. Modifiers + scope flags (§11).
    const modifiers: QueryModifier[] = [];
    const flags: ParsedQueryModFlags = {
      includeTests: false,
      includeProduction: true,
      includeExternal: false,
      includeGenerated: false,
    };
    for (const m of MODIFIER_PHRASES) {
      if (m.patterns.test(text)) {
        modifiers.push(m.modifier);
        if (m.modifier === "include-tests") flags.includeTests = true;
        if (m.modifier === "tests-only") {
          flags.includeTests = true;
          flags.includeProduction = false;
        }
        if (m.modifier === "production-only") flags.includeProduction = true;
        if (m.modifier === "include-external") flags.includeExternal = true;
        if (m.modifier === "exclude-generated") flags.includeGenerated = false;
        if (m.modifier === "exclude-tests") flags.includeTests = false;
      }
    }
    // Intent-driven test inclusion (e.g. related-tests always pulls tests).
    if (intent === "show-related-tests" || intent === "show-covered-code")
      flags.includeTests = true;

    // 5. Depth override.
    const depthMatch = /up\s+to\s+(\d+)\s+levels?/i.exec(text);
    const depthOverride = depthMatch ? Number(depthMatch[1]) : undefined;

    // 6. Confidence threshold.
    const confMatch = /confidence\s+(?:>=|at least|of)\s*(\d(?:\.\d+)?)/i.exec(text);
    const confidenceThreshold = confMatch ? Number(confMatch[1]) : 0;

    // 7. Direction fallback from intent verbs.
    if (!direction) direction = this.directionForIntent(intent);

    return {
      intent,
      subjectText,
      targetText,
      direction,
      depthOverride,
      subjectTypeHint,
      targetTypeHint,
      includeTests: flags.includeTests,
      includeProduction: flags.includeProduction,
      includeExternal: flags.includeExternal,
      includeGenerated: flags.includeGenerated,
      confidenceThreshold,
      modifiers,
      routeDetected,
      databaseDetected,
      explanation,
    };
  }

  private matchIntent(text: string):
    | {
        intent: EngineeringQueryIntent;
        direction?: "inbound" | "outbound" | "both";
        subjectTypeHint?: string;
        targetTypeHint?: string;
      }
    | undefined {
    // Longest-matching pattern wins to avoid "calls" hijacking "called by".
    let best:
      | { intent: EngineeringQueryIntent; direction?: "inbound" | "outbound" | "both"; len: number }
      | undefined;
    for (const entry of this.dictionary.entries_()) {
      for (const p of entry.patterns) {
        const idx = text.toLowerCase().indexOf(p.toLowerCase());
        if (idx >= 0) {
          if (!best || p.length > best.len) {
            best = { intent: entry.intent, direction: entry.direction, len: p.length };
          }
        }
      }
    }
    return best ? { intent: best.intent, direction: best.direction } : undefined;
  }

  private extractSubjectTarget(
    text: string,
    route?: string,
    dbTable?: string,
  ): { subjectText: string; targetText?: string } {
    // Explicit "from X to Y" / "between X and Y" / "X and Y".
    const fromTo = /from\s+([A-Za-z0-9_./{}-]+)\s+to\s+([A-Za-z0-9_./{}-]+)/i.exec(text);
    if (fromTo) return { subjectText: fromTo[1] ?? "", targetText: fromTo[2] ?? "" };
    const between = /between\s+([A-Za-z0-9_./{}-]+)\s+and\s+([A-Za-z0-9_./{}-]+)/i.exec(text);
    if (between) return { subjectText: between[1] ?? "", targetText: between[2] ?? "" };

    if (route && dbTable) return { subjectText: route, targetText: dbTable };
    if (route) return { subjectText: route };
    if (dbTable) return { subjectText: dbTable };

    // Fall back: first plausible code identifier (e.g. OrderService, createOrder).
    const ids = text.match(IDENTIFIER_RE) ?? [];
    const stop = new Set([
      "what",
      "which",
      "show",
      "who",
      "where",
      "how",
      "find",
      "the",
      "this",
      "that",
      "does",
      "do",
      "is",
      "are",
      "if",
      "i",
      "change",
      "modify",
      "affected",
      "impacted",
      "tests",
      "test",
      "flow",
      "path",
      "from",
      "to",
      "calls",
      "callees",
      "callers",
      "depends",
      "dependents",
      "api",
      "storage",
      "writes",
      "reads",
      "configuration",
      "config",
    ]);
    for (const id of ids) {
      if (id.length < 2) continue;
      if (stop.has(id.toLowerCase())) continue;
      // Drop leading verb-ish fragments like "ShowOrderService".
      const cleaned = id.replace(/^(Show|Find|What|Which|Who|Where|How)/i, "");
      if (cleaned.length >= 2) return { subjectText: cleaned };
    }
    return { subjectText: "" };
  }

  private directionForIntent(intent: EngineeringQueryIntent): "inbound" | "outbound" | "both" {
    switch (intent) {
      case "show-callers":
      case "show-dependents":
      case "show-entry-points":
        return "inbound";
      case "show-callees":
      case "show-dependencies":
      case "show-usages":
      case "show-data-reads":
      case "show-data-writes":
      case "show-data-flow":
      case "show-side-effects":
      case "show-configuration-usage":
        return "outbound";
      default:
        return "both";
    }
  }
}
