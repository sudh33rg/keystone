/**
 * Tokenizer-free estimate used by the context engine.
 *
 * The extension deliberately has no model tokenizer dependency. Four
 * characters per token is a useful conservative approximation for the ASCII
 * source and prose this project sends to Copilot. Non-ASCII code points are
 * charged at two characters per token because byte-pair tokenizers generally
 * split those text runs more aggressively. Callers may provide a small
 * capability hint when they know the target model has a different average.
 */
export interface TokenEstimatorCapability {
  /** Average characters per token for the target model, when known. */
  readonly charactersPerToken?: number;
}

export function estimateTokens(
  text: string,
  capability: TokenEstimatorCapability = {}
): number {
  if (!text) return 0;
  const charactersPerToken = capability.charactersPerToken;
  if (charactersPerToken && Number.isFinite(charactersPerToken) && charactersPerToken > 0) {
    return Math.ceil(text.length / charactersPerToken);
  }
  let weightedCharacters = 0;
  for (const character of text) {
    weightedCharacters += character.codePointAt(0)! > 0x7f ? 0.5 : 0.25;
  }
  return Math.max(1, Math.ceil(weightedCharacters));
}
