/**
 * Shared deterministic utilities for the context-compression pipeline.
 * No network, no LLM, no randomness — outputs depend only on inputs.
 */

import { redact } from "../../shared/logging/redaction";

/** Stable SHA-256 hex digest (browser/Node compatible). */
export async function sha256(value: string): Promise<string> {
  const data = new TextEncoder().encode(value);
  const hash = await crypto.subtle.digest("SHA-256", data);
  return Array.from(new Uint8Array(hash), (b) => b.toString(16).padStart(2, "0")).join("");
}

/** Synchronous, dependency-free FNV-1a 32-bit hash for cheap in-memory dedup keys. */
export function fnv1a(value: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < value.length; i++) {
    h ^= value.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(16).padStart(8, "0");
}

/** Normalize whitespace for structural comparison (preserve identifiers/structure). */
export function normalizeWhitespace(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

/** Collapse repeated blank lines and trailing whitespace for deterministic content. */
export function normalizeContent(value: string): string {
  return value
    .replace(/\r\n/g, "\n")
    .split("\n")
    .map((line) => line.replace(/\s+$/g, ""))
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

/**
 * Detect high-confidence secrets. Returns the matched secret kinds so the
 * caller can decide redaction vs. blocking. Reuses the shared redaction
 * patterns; adds Copilot/cloud token shapes and private-key blocks.
 */
export interface SecretMatch {
  kind:
    | "private-key"
    | "bearer-token"
    | "assignment-secret"
    | "gh-token"
    | "aws-key"
    | "generic-secret";
  /** The matched text (may contain the secret value — caller must not persist). */
  value: string;
}

const SECRET_PATTERNS: Array<{ kind: SecretMatch["kind"]; re: RegExp }> = [
  {
    kind: "private-key",
    re: /-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z ]*PRIVATE KEY-----/g,
  },
  { kind: "gh-token", re: /\bgh[pousr]_[A-Za-z0-9_]{20,}\b/g },
  { kind: "aws-key", re: /\bAKIA[0-9A-Z]{16}\b/g },
  { kind: "bearer-token", re: /\bBearer\s+[A-Za-z0-9._~+/=-]{12,}/g },
  {
    kind: "assignment-secret",
    re: /\b(?:password|passwd|pwd|secret|api[_-]?key|access[_-]?token|refresh[_-]?token|auth[_-]?token|client[_-]?secret|private[_-]?key)\b\s*[:=]\s*([^\s"',;}{]+)/gi,
  },
];

export function detectSecrets(text: string): SecretMatch[] {
  const matches: SecretMatch[] = [];
  for (const { kind, re } of SECRET_PATTERNS) {
    re.lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = re.exec(text)) !== null) {
      matches.push({ kind, value: m[0] });
      if (m.index === re.lastIndex) re.lastIndex++;
    }
  }
  return matches;
}

/** True if text contains at least one high-confidence secret. */
export function hasSecret(text: string): boolean {
  return detectSecrets(text).length > 0;
}

/**
 * Redact in-place secret *values* while preserving a structural reference.
 * The returned string has secrets replaced by a placeholder. Safe to persist.
 */
export function redactSecrets(text: string): { redacted: string; redactedCount: number } {
  let redactedCount = 0;
  let out = text;
  for (const pattern of SECRET_PATTERNS) {
    const re = new RegExp(
      pattern.re.source,
      pattern.re.flags.includes("g") ? pattern.re.flags : pattern.re.flags + "g",
    );
    re.lastIndex = 0;
    out = out.replace(re, (match) => {
      redactedCount++;
      if (pattern.kind === "private-key") return "[REDACTED PRIVATE KEY]";
      if (pattern.kind === "bearer-token") return "Bearer [REDACTED]";
      // assignment-secret: keep the key name, drop the value.
      const eq = match.match(/[:=]/);
      if (eq) return `${match.slice(0, match.indexOf(eq[0]))}${eq[0]}[REDACTED]`;
      return "[REDACTED SECRET]";
    });
  }
  return { redacted: out, redactedCount };
}

/** Token-shingle hashing for semantic-equivalence approximation. */
export function tokenShingles(text: string, size = 5): string[] {
  const words = normalizeWhitespace(text)
    .toLowerCase()
    .split(/\s+/)
    .filter((w) => w.length > 0);
  const shingles: string[] = [];
  for (let i = 0; i + size <= words.length; i++) {
    shingles.push(words.slice(i, i + size).join(" "));
  }
  return shingles;
}

/** Jaccard similarity between two shingle sets, in [0, 1]. */
export function shinglesJaccard(a: string[], b: string[]): number {
  if (a.length === 0 && b.length === 0) return 0;
  const setA = new Set(a);
  const setB = new Set(b);
  let inter = 0;
  for (const s of setA) if (setB.has(s)) inter++;
  const union = setA.size + setB.size - inter;
  return union === 0 ? 0 : inter / union;
}

export { redact };

/** Conservative shape-agnostic token estimation.
 *  Uses `Math.max(1, Math.ceil(value.length / charsPerToken))` so empty/short
 *  inputs still return a non-zero budget. Default `4` chars/token matches the
 *  reference heuristic from `code-review-graph` token budget utilities. */
export function estimateTokens(value: string, charsPerToken = 4): number {
  const length = typeof value === "string" ? value.length : 0;
  return Math.max(1, Math.ceil(length / charsPerToken));
}

export type TokenBudget = {
  readonly target: number;
  readonly reserved: number;
  readonly available: number;
};

export function estimateTokenBudget(input: { readonly targetTokens?: number; readonly reservedTokens?: number }): TokenBudget {
  const target = Math.max(0, input.targetTokens ?? 0);
  const reserved = Math.max(0, Math.min(target, input.reservedTokens ?? 0));
  return {
    target,
    reserved,
    available: Math.max(0, target - reserved),
  };
}
