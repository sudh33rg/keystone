/**
 * Tokenizer abstraction and registry for Keystone context compression.
 *
 * Keystone ships NO external model vocabulary and must run fully offline.
 * The pipeline therefore uses a *local* deterministic tokenizer that
 * approximates GPT/Codex-style subword tokenization far more faithfully than a
 * naive character/4 ratio. The approximation is explicitly labelled and never
 * presented as Copilot's exact billing count.
 *
 * Measurement policy (see {@link TokenMeasurement}):
 *  - `exact-local`  — the count is the exact output of a tokenizer Keystone
 *                      ships and trusts. Our `KeystoneGptApproxTokenizer` is
 *                      treated as the authoritative local tokenizer for the
 *                      GPT/Codex model family approximation; `confidence`
 *                      reflects closeness to the *real* target model, not the
 *                      determinism of the local count.
 *  - `estimated`    — an approximation of a target model family for which no
 *                      exact tokenizer is available (this is the default state
 *                      for every model we cannot perfectly reproduce).
 *  - `fallback`     — a character-based estimate used ONLY when no tokenizer
 *                      can load. It is always labelled `estimated`.
 */

import {
  TokenizerInfoSchema,
  type TokenMeasurement,
  type TokenizerInfo,
} from "../../shared/contracts/contextPackage";

/** A tokenizer that can count tokens in text and in sections. */
export interface TokenCounter {
  /** Stable identifier, e.g. `keystone:gpt-approx`. */
  readonly id: string;
  /** Count tokens in a single string. */
  count(text: string): number;
  /** Count tokens across several sections (sum of each + inter-section spacing). */
  countSections(sections: readonly string[]): number;
  /** Metadata describing how the count was obtained. */
  info(): TokenizerInfo;
}

const GPT2_SPLIT = /'s|'t|'re|'ve|'m|'ll|'d| ?\p{L}+| ?\p{N}+| ?[^\s\p{L}\p{N}]+|\s+(?!\S)|\s+/gu;

function gpt2Pieces(text: string): string[] {
  const out: string[] = [];
  const re = new RegExp(GPT2_SPLIT.source, "giu");
  let match: RegExpExecArray | null;
  while ((match = re.exec(text)) !== null) {
    out.push(match[0]);
    if (match.index === re.lastIndex) re.lastIndex++;
  }
  return out;
}

/** Split an alphanumeric code word into subword-ish chunks (camel/snake/digits). */
function subwordChunks(word: string): string[] {
  if (word.length <= 4) return [word];
  // Break snake_case and kebab-case.
  const byUnderscore = word.split(/[_-]+/).filter(Boolean);
  const chunks: string[] = [];
  for (const part of byUnderscore) chunks.push(...camelChunks(part));
  return chunks;
}

function camelChunks(part: string): string[] {
  // Lower-to-Upper, digit boundaries, repeated-upper then lower.
  const matches = part.match(/[A-Z]+(?=[A-Z][a-z]|[0-9]|$)|[A-Z][a-z]*|[a-z]+|[0-9]+/g);
  if (!matches) return [part];
  return matches;
}

/**
 * Deterministic local tokenizer approximating GPT/Codex-style tokenization.
 *
 * Strategy:
 *  1. Split using the GPT-2 regex (captures words, contractions, whitespace,
 *     and isolated symbols).
 *  2. Count whitespace runs as one token each.
 *  3. Count isolated punctuation/symbols as one token each.
 *  4. For alphanumeric words, segment camelCase / snake_case and long runs,
 *     counting each subword chunk as one token (min 1 per word).
 *
 * This is deterministic, dependency-free, and offline. It is NOT Copilot's
 * exact billing tokenizer; that is stated in {@link info}.
 */
export class KeystoneGptApproxTokenizer implements TokenCounter {
  readonly id = "keystone:gpt-approx";

  private readonly targetFamily: string | undefined;
  private readonly confidence: number;

  constructor(options: { targetFamily?: string; confidence?: number } = {}) {
    this.targetFamily = options.targetFamily;
    // Confidence reflects closeness to the real target model, not determinism.
    this.confidence = options.confidence ?? 0.85;
  }

  count(text: string): number {
    if (!text) return 0;
    let total = 0;
    for (const piece of gpt2Pieces(text)) {
      if (piece.trim().length === 0) {
        total += 1; // whitespace run
        continue;
      }
      if (/^[A-Za-z0-9]+$/.test(piece)) {
        const chunks = subwordChunks(piece);
        total += Math.max(1, chunks.length);
        continue;
      }
      // Punctuation / symbol / mixed piece.
      total += 1;
    }
    return total;
  }

  countSections(sections: readonly string[]): number {
    let total = 0;
    for (const section of sections) total += this.count(section);
    // Account for blank-line separators between sections.
    total += Math.max(0, sections.length - 1);
    return total;
  }

  info(): TokenizerInfo {
    return TokenizerInfoSchema.parse({
      id: this.id,
      targetFamily: this.targetFamily,
      measurement: "exact-local" as TokenMeasurement,
      confidence: this.confidence,
      fallback: false,
      note:
        "Local deterministic subword approximation of GPT/Codex-style tokenization. " +
        "This is Keystone's authoritative local tokenizer, not Copilot's exact billing count.",
    });
  }
}

/**
 * Deterministic character-based fallback used ONLY when no real tokenizer can
 * load. Always labelled `estimated` and `fallback`.
 */
export class CharacterFallbackTokenizer implements TokenCounter {
  readonly id = "keystone:char-fallback";
  private readonly charsPerToken: number;

  constructor(charsPerToken = 4) {
    this.charsPerToken = charsPerToken;
  }

  count(text: string): number {
    return Math.ceil((text ?? "").length / this.charsPerToken);
  }

  countSections(sections: readonly string[]): number {
    let total = 0;
    for (const section of sections) total += this.count(section);
    total += Math.max(0, sections.length - 1);
    return total;
  }

  info(): TokenizerInfo {
    return TokenizerInfoSchema.parse({
      id: this.id,
      measurement: "estimated",
      confidence: 0.4,
      fallback: true,
      note:
        "Fallback character-based estimate (~" +
        this.charsPerToken +
        " chars/token). No tokenizer could load; this is an estimate, not a measured count.",
    });
  }
}

/** A thin wrapper that marks any counter as an explicit estimate. */
export class EstimatedTokenizerWrapper implements TokenCounter {
  readonly id: string;
  private readonly inner: TokenCounter;
  private readonly targetFamily?: string;
  private readonly confidence: number;

  constructor(inner: TokenCounter, targetFamily?: string, confidence = 0.7) {
    this.inner = inner;
    this.id = inner.id;
    this.targetFamily = targetFamily;
    this.confidence = confidence;
  }

  count(text: string): number {
    return this.inner.count(text);
  }

  countSections(sections: readonly string[]): number {
    return this.inner.countSections(sections);
  }

  info(): TokenizerInfo {
    const base = this.inner.info();
    return TokenizerInfoSchema.parse({
      ...base,
      targetFamily: this.targetFamily ?? base.targetFamily,
      measurement: "estimated",
      confidence: this.confidence,
      note:
        (base.note ? base.note + " " : "") +
        "Approximates target model family; not an exact Copilot token count.",
    });
  }
}

/**
 * Registry that resolves a tokenizer for a given model/tokenizer family.
 *
 * Keystone ships one local tokenizer (`keystone:gpt-approx`). If a request
 * names a different family we cannot exactly reproduce, we return the local
 * tokenizer wrapped as an explicit estimate and surface a warning. If the local
 * tokenizer fails to construct, we fall back to the character estimator.
 */
export class TokenCounterRegistry {
  private readonly counters = new Map<string, TokenCounter>();
  private readonly fallback = new CharacterFallbackTokenizer();
  private readonly defaultCounter: TokenCounter;

  constructor(defaultCounter?: TokenCounter) {
    this.defaultCounter = defaultCounter ?? new KeystoneGptApproxTokenizer();
    this.counters.set(this.defaultCounter.id, this.defaultCounter);
  }

  /** Register a custom tokenizer (e.g. a future exact BPE loader). */
  register(counter: TokenCounter): void {
    this.counters.set(counter.id, counter);
  }

  /** The default local tokenizer. */
  default(): TokenCounter {
    return this.defaultCounter;
  }

  /**
   * Resolve the best available tokenizer for a (possibly unknown) family.
   * Returns `{ counter, warning }` — `warning` is present when the requested
   * family could not be matched exactly and an approximation is used, or when
   * the fallback had to be used.
   */
  resolve(family?: string): { counter: TokenCounter; warning?: string } {
    if (!family) return { counter: this.defaultCounter };
    const exact = this.counters.get(family);
    if (exact) return { counter: exact };
    // Unknown family: approximate with the local tokenizer, labelled estimated.
    const wrapped = new EstimatedTokenizerWrapper(this.defaultCounter, family);
    return {
      counter: wrapped,
      warning: `Tokenizer for '${family}' is unavailable. Using Keystone's local approximation (${this.defaultCounter.id}); counts are estimated, not an exact Copilot token count.`,
    };
  }

  /** Resolve with guaranteed success, falling back to char estimate on failure. */
  resolveSafe(family?: string): { counter: TokenCounter; warning?: string } {
    try {
      const result = this.resolve(family);
      if (result.counter) return result;
    } catch {
      /* fall through */
    }
    return {
      counter: this.fallback,
      warning:
        "No tokenizer could load; using the character-based estimate fallback. Counts are estimated.",
    };
  }
}

export const defaultTokenCounterRegistry = new TokenCounterRegistry();
