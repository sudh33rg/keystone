// src/context/IntentClassifier.ts
// IntentClassifier — heuristic + LLM-enhanced intent classification

import type { DeveloperIntent, IntentAnalysis } from "../domain/types";

// ─── Types ──────────────────────────────────────────────────────

export type Intent =
  | 'search'
  | 'refactor'
  | 'migrate'
  | 'analyze'
  | 'debug'
  | 'document'
  | 'review'
  | 'test'
  | 'explain'
  | 'implement'
  | 'unknown';

export interface IntentResult {
  intent: Intent;
  confidence: number;
  subIntents: string[];
  entities: string[];
  complexity: 'low' | 'medium' | 'high';
}

export interface IntentClassifierConfig {
  /** Root of the repository (for entity resolution) */
  root: string;
  /** LLM provider function for LLM-enhanced classification. When absent, heuristic-only. */
  llmClassify?: (query: string) => Promise<{intent: string; confidence: number}>;
  /** Entities to extract from the query (file names, class names, function names) */
  entityPatterns?: RegExp[];
}

interface ResolvedIntentClassifierConfig {
  root: string;
  llmClassify?: (query: string) => Promise<{intent: string; confidence: number}>;
  entityPatterns: RegExp[];
}

// ─── Intent classification ──────────────────────────────────────

const INTENT_KEYWORDS = {
  search: ['find', 'search', 'lookup', 'retrieve', 'where is', 'locate', 'find file', 'find function', 'find class'],
  refactor: ['refactor', 'clean', 'restructure', 'reorganize', 'modernize code', 'simplify', 'extract', 'rename'],
  migrate: ['migrate', 'upgrade', 'modernize', 'convert', 'port', 'migrate to', 'upgrade to'],
  analyze: ['analyze', 'inspect', 'explain', 'understand', 'how does', 'what does', 'review code', 'assess'],
  debug: ['debug', 'fix', 'error', 'bug', 'crash', 'throw', 'fail', 'issue', 'problem', 'trace'],
  document: ['document', 'doc', 'comment', 'readme', 'docs', 'write docs', 'generate docs'],
  review: ['review', 'code review', 'pr', 'pull request', 'check', 'audit', 'security scan'],
  test: ['test', 'unit test', 'integration test', 'e2e', 'spec', 'jest', 'vitest', 'write test'],
  explain: ['explain', 'what is', 'how to', 'why does', 'describe', 'summarize', 'clarify'],
  implement: ['implement', 'add feature', 'create', 'build', 'implement', 'write code', 'develop'],
  unknown: [],
};

const INTENT_PHRASES = {
  search: ['where is', 'find file', 'find function', 'find class', 'locate', 'which file', 'what file'],
  refactor: ['refactor', 'restructure', 'reorganize', 'clean up', 'simplify', 'extract method', 'rename'],
  migrate: ['migrate to', 'upgrade to', 'convert to', 'port to', 'upgrade from'],
  analyze: ['how does', 'what does', 'review code', 'assess', 'inspect', 'understand'],
  debug: ['fix', 'error', 'bug', 'crash', 'throw', 'fail', 'issue', 'trace', 'investigate', 'root cause'],
  document: ['document', 'write docs', 'generate docs', 'add comments', 'readme'],
  review: ['code review', 'pr', 'pull request', 'audit', 'security scan'],
  test: ['unit test', 'integration test', 'write test', 'e2e', 'spec'],
  explain: ['what is', 'how to', 'why does', 'describe', 'summarize'],
  implement: ['add feature', 'create', 'build', 'write code', 'develop'],
  unknown: [],
};

const ENTITY_PATTERNS = [
  /(?:class|interface|type|function|const|let|var)\s+([A-Z]\w+)/,
  /(?:import)\s+(?:.*from\s+)?['"]([^'"]+)['"]/,
  /(?:file|path)\s+['"]([^'"]+)['"]/,
  /(?:class|module|function|file)\s+['"]([^'"]+)['"]/,
];

const COMPLEXITY_PATTERNS = {
  long: 1000,
  medium: 200,
};

/**
 * IntentClassifier — classifies user intent and extracts entities.
 * Uses layered approach: phrase matching → keyword scoring → LLM-enhanced (when available) → fallback.
 */
export class IntentClassifier {
  private config: ResolvedIntentClassifierConfig;

  constructor(config: IntentClassifierConfig) {
    this.config = {
      root: config.root,
      llmClassify: config.llmClassify,
      entityPatterns: config.entityPatterns ?? ENTITY_PATTERNS,
    };
  }

  /**
   * Classify intent from a query string.
   * Returns IntentResult with intent, confidence, sub-intents, entities, and complexity.
   */
  async classify(query: string): Promise<IntentResult> {
    const trimmed = query.trim();
    if (!trimmed) {
      return this._result('unknown', 0, [], [], 'low');
    }

    // Layer 1: Phrase-based classification (higher precision)
    const phraseResult = this._classifyByPhrases(trimmed);

    // Layer 2: Keyword scoring (broader coverage)
    const keywordResult = this._classifyKeywords(trimmed);

    // Layer 3: Combine phrase and keyword signals
    const combined = this._combineResults(phraseResult, keywordResult);

    // Layer 4: LLM-enhanced classification (if available and confidence is low)
    let finalResult = combined;
    if (this.config.llmClassify && combined.confidence < 0.6) {
      try {
        const llmResult = await this.config.llmClassify(trimmed);
        if (llmResult.confidence > combined.confidence) {
          finalResult = {
            ...combined,
            intent: llmResult.intent as Intent,
            confidence: llmResult.confidence,
          };
        }
      } catch {
        // Fall back to combined heuristic result
      }
    }

    // Extract entities
    const entities = this._extractEntities(trimmed);

    // Determine complexity
    const complexity = this._classifyComplexity(trimmed, entities);

    return this._result(
      finalResult.intent,
      finalResult.confidence,
      finalResult.subIntents,
      entities,
      complexity,
    );
  }

  // ─── Phrase classification (higher precision) ───────────────

  private _classifyByPhrases(query: string): { intent: Intent; confidence: number; subIntents: string[] } {
    const lower = query.toLowerCase();
    let bestIntent: Intent = 'unknown';
    let bestScore = 0;
    const subIntents: string[] = [];

    for (const [intent, phrases] of Object.entries(INTENT_PHRASES) as [Intent, string[]][]) {
      if (intent === 'unknown') continue;
      for (const phrase of phrases) {
        if (lower.includes(phrase)) {
          const score = 3;
          if (score > bestScore) {
            bestScore = score;
            bestIntent = intent;
          }
          subIntents.push(phrase);
        }
      }
    }

    const confidence = Math.min(bestScore / 3, 1);
    return { intent: bestIntent, confidence, subIntents };
  }

  // ─── Keyword classification (broader coverage) ──────────────

  private _classifyKeywords(query: string): { intent: Intent; confidence: number; subIntents: string[] } {
    const lower = query.toLowerCase();
    const scores = new Map<Intent, number>();
    const subIntents: string[] = [];

    for (const [intent, keywords] of Object.entries(INTENT_KEYWORDS) as [Intent, string[]][]) {
      if (intent === 'unknown') continue;
      let score = 0;
      for (const keyword of keywords) {
        if (lower.includes(keyword)) {
          score += 1;
          subIntents.push(keyword);
        }
      }
      if (score > 0) {
        scores.set(intent, score);
      }
    }

    let bestIntent: Intent = 'unknown';
    let bestScore = 0;
    for (const [intent, score] of Array.from(scores)) {
      if (score > bestScore) {
        bestScore = score;
        bestIntent = intent;
      }
    }

    const confidence = Math.min(bestScore / Math.max(bestScore, 2), 1);
    return { intent: bestIntent, confidence, subIntents };
  }

  // ─── Combine phrase and keyword results ─────────────────────

  private _combineResults(phrase: { intent: Intent; confidence: number; subIntents: string[] },
                          keyword: { intent: Intent; confidence: number; subIntents: string[] }):
    { intent: Intent; confidence: number; subIntents: string[] } {
    // If phrase classifier found a strong signal, prefer it
    if (phrase.confidence >= 0.6) {
      return { ...phrase, confidence: Math.min(phrase.confidence + keyword.confidence * 0.2, 1) };
    }
    // Otherwise fall back to keyword scoring
    return { ...keyword, confidence: Math.max(phrase.confidence, keyword.confidence) };
  }

  // ─── Entity extraction ──────────────────────────────────────

  private _extractEntities(query: string): string[] {
    const entities: string[] = [];
    for (const pattern of this.config.entityPatterns) {
      const match = query.match(pattern);
      if (match?.[1]) {
        entities.push(match[1]);
      }
    }
    return entities;
  }

  // ─── Complexity classification ──────────────────────────────

  private _classifyComplexity(query: string, entities: string[]): 'low' | 'medium' | 'high' {
    if (query.length > COMPLEXITY_PATTERNS.long) return 'high';
    if (query.length > COMPLEXITY_PATTERNS.medium) return 'medium';
    if (entities.length > 3) return 'high';
    if (entities.length > 0) return 'medium';
    return 'low';
  }

  // ─── Helpers ────────────────────────────────────────────────

  private _result(
    intent: Intent,
    confidence: number,
    subIntents: string[],
    entities: string[],
    complexity: 'low' | 'medium' | 'high',
  ): IntentResult {
    return { intent, confidence, subIntents, entities, complexity };
  }
}

/** Convenience function: classify a DeveloperIntent and return IntentAnalysis. */
export async function classifyIntent(intent: DeveloperIntent): Promise<IntentAnalysis> {
  const classifier = new IntentClassifier({ root: intent.workspaceRoot });
  const result = await classifier.classify(intent.text);
  const requestedChange = /^(?:add|create|build|implement|develop)\b/i.test(intent.text.trim());
  const intentType: IntentAnalysis["intentType"] = requestedChange || result.intent === 'implement' ? 'feature'
    : result.intent === 'debug' ? 'bugfix'
      : result.intent === 'migrate' ? 'modernization'
        : result.intent === 'review' ? 'security-review'
          : result.intent === 'analyze' ? 'qa-analysis'
            : result.intent === 'document' || result.intent === 'search' ? 'explain'
              : result.intent as IntentAnalysis["intentType"];
  return {
    intentType,
    confidence: result.confidence,
    summary: result.subIntents.length > 0 ? `Task: ${result.intent}, sub-tasks: ${result.subIntents.join(", ")}` : `Task: ${result.intent}`,
    keywords: result.entities,
    needsCodeChange: requestedChange || result.intent === "implement" || result.intent === "refactor" || result.intent === "migrate",
    riskHints: result.intent === "migrate" ? ["modernization"] : result.intent === "refactor" ? ["code change"] : [],
  };
}
